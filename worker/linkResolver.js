const PLATFORM_HOSTS = {
  xiaohongshu: ['xiaohongshu.com', 'xhslink.com'],
  douyin: ['douyin.com', 'iesdouyin.com'],
};

const MEDIA_HOSTS = {
  xiaohongshu: ['xhscdn.com', 'xiaohongshu.com'],
  douyin: ['douyinpic.com', 'byteimg.com', 'ibytedtos.com', 'douyinstatic.com'],
};

const PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  Accept: 'text/html,application/xhtml+xml',
};

function hostMatches(hostname, allowed) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return allowed.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function safeHttpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  if (url.port && !['80', '443'].includes(url.port)) return null;
  url.protocol = 'https:';
  url.port = '';
  url.hash = '';
  return url;
}

export function extractSharedUrl(input) {
  const text = String(input || '').trim();
  const candidates = text.match(/https?:\/\/[^\s<>"']+/gi) || [];
  for (const candidate of candidates) {
    const cleaned = candidate.replace(/[，。！？、；：)）\]}]+$/g, '');
    const url = safeHttpsUrl(cleaned);
    if (!url) continue;
    const platform = Object.entries(PLATFORM_HOSTS).find(([, hosts]) => hostMatches(url.hostname, hosts))?.[0];
    if (platform) return { url, platform };
  }
  throw new Error('只支持抖音或小红书的公开分享链接');
}

export function validateMediaUrl(value, platform) {
  const url = safeHttpsUrl(value);
  if (!url || !MEDIA_HOSTS[platform] || !hostMatches(url.hostname, MEDIA_HOSTS[platform])) return null;
  return url;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/');
}

function tagAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? decodeHtml(match[2]) : '';
}

function metaContent(html, key) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = tagAttribute(tag, 'property') || tagAttribute(tag, 'name');
    if (name.toLowerCase() === key.toLowerCase()) return tagAttribute(tag, 'content');
  }
  return '';
}

function cleanTitle(value) {
  return decodeHtml(value).replace(/\s*[-_|｜].*?(小红书|抖音).*$/i, '').trim().slice(0, 100);
}

function isLikelyVideo(html, finalUrl, platform) {
  if (platform === 'douyin' && /\/(video|shipin)\//i.test(finalUrl.pathname)) return true;
  const type = metaContent(html, 'og:type').toLowerCase();
  if (type.includes('video')) return true;
  return /<meta\b[^>]*(?:og:video|twitter:player)[^>]*>/i.test(html);
}

function normalizedImageCandidates(html) {
  const decoded = decodeHtml(html);
  const candidates = [
    metaContent(decoded, 'og:image'),
    metaContent(decoded, 'twitter:image'),
  ];
  for (const tag of decoded.match(/<img\b[^>]*>/gi) || []) {
    candidates.push(tagAttribute(tag, 'src'), tagAttribute(tag, 'data-src'));
  }
  for (const match of decoded.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)) candidates.push(match[0]);
  return candidates.filter(Boolean).map((value) => value.replace(/[),;]+$/g, ''));
}

function findObject(value, predicate) {
  if (!value || typeof value !== 'object') return null;
  if (predicate(value)) return value;
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const found = findObject(child, predicate);
    if (found) return found;
  }
  return null;
}

function parseDouyinRouterData(html) {
  const match = html.match(/window\._ROUTER_DATA\s*=\s*({[\s\S]*?})<\/script>/i);
  if (!match) return null;
  let routerData;
  try {
    routerData = JSON.parse(match[1]);
  } catch {
    return null;
  }
  const item = findObject(routerData, (value) => (
    !Array.isArray(value)
    && Array.isArray(value.images)
    && value.images.length > 0
    && value.images.every((image) => Array.isArray(image?.url_list))
  ));
  if (!item) return null;
  const images = item.images
    .map((image) => image.url_list.map((candidate) => validateMediaUrl(candidate, 'douyin')).find(Boolean))
    .filter(Boolean)
    .map((url) => url.href);
  if (!images.length) return null;
  return {
    platform: 'douyin',
    title: cleanTitle(String(item.desc || '').split(/\r?\n/)[0] || '链接图纸'),
    author: cleanTitle(item.author?.nickname || item.author?.unique_id || ''),
    images: images.slice(0, 20),
  };
}

function imageScore(url, position) {
  const text = `${url.hostname}${url.pathname}`.toLowerCase();
  let score = 1000 - position;
  if (/avatar|icon|logo|favicon|emoji|qrcode|qr_code/.test(text)) score -= 10000;
  if (/cover|note|image|photo|origin|large|webpic/.test(text)) score += 60;
  if (/thumbnail|thumb|small/.test(text)) score -= 30;
  return score;
}

export function parsePostHtml(html, finalUrl, platform) {
  if (platform === 'douyin') {
    const structured = parseDouyinRouterData(html);
    if (structured) return structured;
  }
  if (isLikelyVideo(html, finalUrl, platform)) {
    const error = new Error('这是视频作品，当前只支持抖音图文或小红书图文笔记');
    error.code = 'UNSUPPORTED_VIDEO';
    throw error;
  }
  const seen = new Set();
  const images = [];
  normalizedImageCandidates(html).forEach((candidate, position) => {
    const url = validateMediaUrl(candidate, platform);
    if (!url) return;
    if (/\.(?:mp3|m4a|mp4|mov|m3u8)(?:$|[?#])/i.test(url.href)) return;
    url.hash = '';
    const key = `${url.hostname}${url.pathname}`;
    if (seen.has(key)) return;
    seen.add(key);
    const score = imageScore(url, position);
    if (score > 0) images.push({ url: url.href, score });
  });
  images.sort((a, b) => b.score - a.score);
  if (!images.length) {
    const error = new Error('没有从这个链接中找到可导入的公开图片');
    error.code = 'NO_IMAGES';
    throw error;
  }
  return {
    platform,
    title: cleanTitle(metaContent(html, 'og:title') || metaContent(html, 'twitter:title') || '链接图纸'),
    author: cleanTitle(metaContent(html, 'author')),
    images: images.slice(0, 20).map((image) => image.url),
  };
}

async function fetchPageWithRedirects(initialUrl, platform, fetcher) {
  let current = initialUrl;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    if (!hostMatches(current.hostname, PLATFORM_HOSTS[platform])) throw new Error('分享链接跳转到了不受支持的网站');
    const response = await fetcher(current.href, { headers: PAGE_HEADERS, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('分享链接跳转地址无效');
      const next = safeHttpsUrl(new URL(location, current).href);
      if (!next) throw new Error('分享链接跳转地址无效');
      current = next;
      continue;
    }
    if (!response.ok) throw new Error(`平台页面读取失败（${response.status}）`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 4 * 1024 * 1024) throw new Error('平台页面内容过大，无法解析');
    const html = await response.text();
    if (html.length > 4 * 1024 * 1024) throw new Error('平台页面内容过大，无法解析');
    if (/captcha|验证中心|安全验证|verifycenter/i.test(html)) throw new Error('平台要求安全验证，请稍后再试或直接上传截图');
    return { html, finalUrl: current };
  }
  throw new Error('分享链接跳转次数过多');
}

export async function resolveSharedPost(input, fetcher = fetch) {
  if (String(input || '').length > 4000) throw new Error('分享文案过长，请只保留作品链接');
  const shared = extractSharedUrl(input);
  const { html, finalUrl } = await fetchPageWithRedirects(shared.url, shared.platform, fetcher);
  return {
    ...parsePostHtml(html, finalUrl, shared.platform),
    sourceUrl: finalUrl.href,
  };
}

export async function fetchProxiedImage(source, platform, fetcher = fetch) {
  let current = validateMediaUrl(source, platform);
  if (!current) throw new Error('图片地址不受支持');
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetcher(current.href, {
      redirect: 'manual',
      headers: {
        'User-Agent': PAGE_HEADERS['User-Agent'],
        Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
        Referer: platform === 'xiaohongshu' ? 'https://www.xiaohongshu.com/' : 'https://www.douyin.com/',
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      current = location ? validateMediaUrl(new URL(location, current).href, platform) : null;
      if (!current) throw new Error('图片跳转地址不受支持');
      continue;
    }
    if (!response.ok) throw new Error(`图片读取失败（${response.status}）`);
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new Error('链接返回的图片格式不受支持');
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 20 * 1024 * 1024) throw new Error('图片超过 20MB，无法通过链接导入');
    const body = await response.arrayBuffer();
    if (body.byteLength > 20 * 1024 * 1024) throw new Error('图片超过 20MB，无法通过链接导入');
    return new Response(body, { status: 200, headers: response.headers });
  }
  throw new Error('图片跳转次数过多');
}
