import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSharedUrl,
  fetchProxiedImage,
  parsePostHtml,
  resolveSharedPost,
  validateMediaUrl,
} from '../worker/linkResolver.js';

test('从完整分享文案中提取小红书短链接', () => {
  const result = extractSharedUrl('复制打开小红书 这张图纸很好看 https://xhslink.com/a/AbCdE ！');
  assert.equal(result.platform, 'xiaohongshu');
  assert.equal(result.url.href, 'https://xhslink.com/a/AbCdE');
});

test('拒绝非平台链接和带异常端口的链接', () => {
  assert.throws(() => extractSharedUrl('https://example.com/test'), /只支持抖音或小红书/);
  assert.throws(() => extractSharedUrl('https://www.douyin.com:8443/note/1'), /只支持抖音或小红书/);
});

test('小红书图文页面可提取标题并过滤头像', () => {
  const html = `
    <meta property="og:title" content="兔子拼豆图纸 - 小红书" />
    <meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/cover/abc" />
    <img src="https://sns-avatar-qc.xhscdn.com/avatar/abc" />
    <script>window.__DATA__={"url":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/note\\/second"}</script>
  `;
  const result = parsePostHtml(html, new URL('https://www.xiaohongshu.com/explore/123'), 'xiaohongshu');
  assert.equal(result.title, '兔子拼豆图纸');
  assert.deepEqual(result.images, [
    'https://sns-webpic-qc.xhscdn.com/cover/abc',
    'https://sns-webpic-qc.xhscdn.com/note/second',
  ]);
});

test('抖音视频作品会明确拒绝', () => {
  assert.throws(
    () => parsePostHtml('<meta property="og:image" content="https://p3.douyinpic.com/cover/1">', new URL('https://www.douyin.com/video/123'), 'douyin'),
    /当前只支持抖音图文/,
  );
});

test('短链接只允许跳转到同平台页面并解析图文图片', async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: 'https://www.douyin.com/note/456' } });
    return new Response('<meta property="og:title" content="拼豆图"><meta property="og:image" content="https://p3.douyinpic.com/note/a.webp">', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  };
  const result = await resolveSharedPost('https://v.douyin.com/abc/', fetcher);
  assert.equal(result.platform, 'douyin');
  assert.equal(result.sourceUrl, 'https://www.douyin.com/note/456');
  assert.deepEqual(result.images, ['https://p3.douyinpic.com/note/a.webp']);
});

test('图片代理只允许已知图片 CDN 且要求图片响应', async () => {
  assert.equal(validateMediaUrl('https://127.0.0.1/private', 'xiaohongshu'), null);
  const response = await fetchProxiedImage('https://sns-webpic-qc.xhscdn.com/note/abc', 'xiaohongshu', async () => (
    new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
  ));
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  await assert.rejects(
    () => fetchProxiedImage('https://sns-webpic-qc.xhscdn.com/note/abc', 'xiaohongshu', async () => new Response('html', { status: 200, headers: { 'content-type': 'text/html' } })),
    /格式不受支持/,
  );
});

test('抖音图文优先读取结构化作品图片并保持原始顺序', () => {
  const routerData = {
    loaderData: {
      page: {
        item_list: [{
          desc: '拼豆图纸｜嘎子姐\n第二行说明',
          author: { nickname: '鱼干儿' },
          images: [
            { uri: 'first', url_list: ['https://p3-sign.douyinpic.com/note/first.webp'] },
            { uri: 'second', url_list: ['https://p26-sign.douyinpic.com/note/second.webp'] },
          ],
          music: { play_url: { url_list: ['https://sf11-cdn-tos.douyinstatic.com/music/test.mp3'] } },
        }],
      },
    },
  };
  const html = `<script>window._ROUTER_DATA = ${JSON.stringify(routerData)}</script>`;
  const result = parsePostHtml(html, new URL('https://www.iesdouyin.com/share/note/123'), 'douyin');
  assert.equal(result.title, '拼豆图纸｜嘎子姐');
  assert.equal(result.author, '鱼干儿');
  assert.deepEqual(result.images, [
    'https://p3-sign.douyinpic.com/note/first.webp',
    'https://p26-sign.douyinpic.com/note/second.webp',
  ]);
});
