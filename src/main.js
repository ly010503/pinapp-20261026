import 'cropperjs/dist/cropper.css';
import './styles/app.css';
import paletteJson from './data/palettes/mard-221.json';
import {
  PATTERN_SIZES,
  COLOR_OPTIONS,
  MAX_FILE_BYTES,
  SUPPORTED_TYPES,
  physicalSizeCm,
} from './state/config.js';
import { store } from './state/store.js';
import { preparePalette } from './color/colorMatcher.js';
import {
  MANUAL_BLANK_COLOR,
  getColorDisplayCode,
  getColorDisplayLabel,
} from './color/manualBlankColor.js';
import { sortPaletteByRecent, updateRecentColorCodes } from './color/recentPalette.js';
import { createAdjustedCanvas, getGridPixels } from './image/imageProcessor.js';
import { getColorStyleAdjustments } from './image/colorStyle.js';
import { CropperController } from './image/cropperController.js';
import { generatePattern } from './pattern/patternGenerator.js';
import { calculateStatistics, countPatternBeans, statisticsTotal } from './pattern/statistics.js';
import { createWhiteBackgroundMask } from './pattern/backgroundMask.js';
import { replacePatternCell, replacePatternColor } from './pattern/colorReplacement.js';
import { ResultCanvasRenderer } from './canvas/resultCanvasRenderer.js';
import {
  DEFAULT_TILED_WATERMARK,
  normalizeWatermarkText,
} from './canvas/tiledWatermark.js';
import { exportEffectPng, exportPatternPng } from './export/pngExporter.js';
import { notify } from './ui/notifications.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const number = new Intl.NumberFormat('zh-CN');
const RECENT_COLORS_KEY = 'perler-recent-replacement-colors';
const state = store.get();
state.palette = preparePalette([...paletteJson, MANUAL_BLANK_COLOR]);

let generationVersion = 0;
let showAllColors = false;
let replacementSourceIndex = null;
let replacementTargetIndex = null;
let replacementCell = null;
let recentReplacementCodes = loadRecentReplacementCodes();
const renderer = new ResultCanvasRenderer(
  $('#resultCanvas'),
  $('#resultStage'),
  () => state,
  (cell) => openReplaceCellDialog(cell),
);

function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function loadRecentReplacementCodes() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) || '[]');
    return Array.isArray(value) ? value.filter((code) => typeof code === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

function rememberReplacementColor(code) {
  recentReplacementCodes = updateRecentColorCodes(recentReplacementCodes, code, 12);
  try {
    localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recentReplacementCodes));
  } catch {
    // Safari隐私模式可能禁用本地存储；当前页面内仍保留最近颜色。
  }
}

function makeButton(className, attributes = {}) {
  const button = document.createElement('button');
  button.className = className;
  Object.entries(attributes).forEach(([key, value]) => button.setAttribute(key, value));
  return button;
}

function buildChoices() {
  PATTERN_SIZES.forEach((size) => {
    const button = makeButton('size-card', { role: 'radio', 'aria-checked': String(Boolean(size.recommended)) });
    button.dataset.width = size.width;
    button.dataset.height = size.height;
    button.dataset.id = size.id;
    const header = document.createElement('span');
    const label = document.createElement('strong'); label.textContent = size.label;
    header.append(label);
    if (size.recommended) { const badge = document.createElement('em'); badge.className = 'recommend-tag'; badge.textContent = '推荐'; header.append(badge); }
    const dimensions = document.createElement('b'); dimensions.textContent = `${size.width} × ${size.height}格`;
    const total = document.createElement('span'); total.textContent = `总计 ${number.format(size.width * size.height)}颗`;
    const description = document.createElement('small'); description.textContent = size.description;
    button.append(header, dimensions, total, description);
    button.classList.toggle('active', Boolean(size.recommended));
    $('#sizeCards').append(button);
  });
  const custom = makeButton('size-card custom-card', { role: 'radio', 'aria-checked': 'false' });
  custom.dataset.id = 'custom';
  const customHeader = document.createElement('span');
  const customLabel = document.createElement('strong'); customLabel.textContent = '自定义'; customHeader.append(customLabel);
  const customTitle = document.createElement('b'); customTitle.textContent = '自己填写格数';
  const customText = document.createElement('span'); customText.textContent = '10～200格宽';
  const customHint = document.createElement('small'); customHint.textContent = '适合特别尺寸';
  custom.append(customHeader, customTitle, customText, customHint);
  $('#sizeCards').append(custom);

  COLOR_OPTIONS.forEach((option) => {
    const button = makeButton('color-card', { role: 'radio', 'aria-checked': String(option.value === 24) });
    button.dataset.colors = option.value;
    const top = document.createElement('span');
    const label = document.createElement('strong'); label.textContent = option.label;
    const status = document.createElement('b'); status.className = 'limit-status'; status.textContent = option.recommended ? '推荐上限' : '颜色上限';
    top.append(label, status);
    const description = document.createElement('small'); description.textContent = option.description;
    button.append(top, description);
    button.classList.toggle('active', option.value === 24);
    $('#colorCards').append(button);
  });
}

function setChoiceActive(container, selected) {
  [...container.children].forEach((button) => {
    const active = button === selected;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
}

function markDirty() {
  generationVersion += 1;
  if (state.currentPattern) {
    state.dirty = true;
    $('#dirtyNotice').hidden = false;
    $('#generateButton').lastChild.textContent = ' 重新生成拼豆图纸';
  }
}

function drawSourcePreview() {
  if (!state.image) return;
  const source = createAdjustedCanvas(state.image, state.transform, getColorStyleAdjustments(state.adjustments, state.colorStyle), 1000, state.crop);
  const canvas = $('#sourcePreview');
  const frame = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const cssWidth = Math.max(280, frame.width);
  const cssHeight = Math.max(250, frame.height);
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#F4F0EA'; ctx.fillRect(0, 0, cssWidth, cssHeight);
  const scale = Math.min(cssWidth / source.width, cssHeight / source.height);
  const width = source.width * scale, height = source.height * scale;
  ctx.drawImage(source, Math.round((cssWidth - width) / 2), Math.round((cssHeight - height) / 2), Math.round(width), Math.round(height));
}

async function decodeImage(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('图片解码失败，请更换图片后重试'));
    image.src = url;
  });
  return { image, url };
}

async function loadFile(file) {
  if (!file) return;
  if (!SUPPORTED_TYPES.includes(file.type)) return notify('请选择 JPG、PNG 或 WebP 图片', 'error');
  if (file.size > MAX_FILE_BYTES) return notify('图片超过 40MB，请压缩后再试', 'error');
  let decoded;
  try {
    decoded = await decodeImage(file);
    const { image, url } = decoded;
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸无效');
    if (image.naturalWidth * image.naturalHeight > 80_000_000) throw new Error('图片像素过大，请先缩小图片');
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    Object.assign(state, {
      image, imageUrl: url, file,
      imageInfo: { width: image.naturalWidth, height: image.naturalHeight, size: file.size },
      crop: null, transform: { rotation: 0, flipH: false, flipV: false },
      currentPattern: null, statistics: [], highlightedCode: null, dirty: false,
    });
    generationVersion += 1;
    $('#uploadPrompt').hidden = true;
    $('#uploadedSummary').hidden = false;
    $('#uploadThumbnail').src = url;
    $('#uploadedName').textContent = file.name;
    $('#uploadedMeta').textContent = `${image.naturalWidth} × ${image.naturalHeight} · ${formatBytes(file.size)}`;
    $('#settingsArea').hidden = false;
    $('#welcomeCard').hidden = true;
    $('#sourceCard').hidden = false;
    $('#cropBadge').hidden = true;
    $('#dirtyNotice').hidden = true;
    $('#resultSection').hidden = true;
    requestAnimationFrame(drawSourcePreview);
    notify('图片已读取，只会在本地处理', 'success');
  } catch (error) {
    if (decoded?.url) URL.revokeObjectURL(decoded.url);
    notify(error.message || '图片读取失败，请重试', 'error', 5000);
  }
}

function updateProgress(progress) {
  const label = progress < 34 ? '正在分析图片……'
    : progress < 68 ? '正在挑选合适的颜色……'
      : progress < 94 ? '正在整理拼豆格子……' : '图纸马上完成啦！';
  $('#progressLabel').textContent = label;
  $('#progressFill').style.width = `${Math.max(8, progress)}%`;
}

function renderColorList() {
  const list = $('#colorList'); list.replaceChildren();
  const visible = showAllColors ? state.statistics : state.statistics.slice(0, 8);
  visible.forEach((item) => {
    const row = makeButton('color-row'); row.dataset.code = item.code;
    row.classList.toggle('active', state.highlightedCode === item.code);
    const dot = document.createElement('i'); dot.className = 'color-dot'; dot.style.backgroundColor = item.hex;
    const code = document.createElement('strong'); code.className = 'color-code'; code.textContent = item.code;
    const name = document.createElement('span'); name.className = 'color-name'; name.textContent = item.name;
    const count = document.createElement('b'); count.className = 'color-count'; count.textContent = `${number.format(item.count)}颗`;
    row.append(dot, code, name, count); list.append(row);
  });
  $('#toggleColors').hidden = state.statistics.length <= 8;
  $('#toggleColors').textContent = showAllColors ? '收起' : `展开全部（${state.statistics.length}色）`;
  $('#replaceSelectedColor').disabled = !state.highlightedCode;
}

function renderStatistics() {
  const total = statisticsTotal(state.statistics);
  const actual = state.statistics.length;
  $('#summaryTotal').textContent = `${number.format(total)}颗`;
  $('#summaryColors').textContent = `${actual}种颜色`;
  const physicalWidth = physicalSizeCm(state.currentPattern.width);
  const physicalHeight = physicalSizeCm(state.currentPattern.height);
  $('#summaryPhysical').textContent = `约${physicalWidth.toFixed(1)}cm × ${physicalHeight.toFixed(1)}cm`;
  $('#actualColorBadge').textContent = `实际 ${actual} 色`;
  renderColorList();
}

async function generate() {
  if (!state.image) return notify('请先上传一张图片', 'error');
  if (state.generating) return;
  state.generating = true;
  const version = ++generationVersion;
  const button = $('#generateButton'); button.disabled = true;
  $('#progressSection').hidden = false;
  $('#progressFill').style.width = '8%'; updateProgress(8);
  try {
    await new Promise(requestAnimationFrame);
    const adjusted = createAdjustedCanvas(state.image, state.transform, getColorStyleAdjustments(state.adjustments, state.colorStyle), 1800, state.crop);
    const { width, height } = state.currentSize;
    const pixels = getGridPixels(adjusted, width, height);
    const pattern = await generatePattern({
      pixels, width, height,
      palette: state.palette
        .filter((color) => !color.manualOnly)
        .map(({ code, name, hex, rgb }) => ({ code, name, hex, rgb })),
      maxColors: state.maxColors,
      reduceIsolated: true,
      mergeColors: true,
      onProgress: updateProgress,
    });
    if (version !== generationVersion) return;
    pattern.sourcePixels = pixels;
    pattern.backgroundMask = createWhiteBackgroundMask(pattern, state.palette, pixels);
    const statistics = calculateStatistics(pattern.indices, state.palette, pattern.backgroundMask);
    if (statisticsTotal(statistics) !== countPatternBeans(pattern.indices, state.palette, pattern.backgroundMask)) {
      throw new Error('颜色统计校验失败，请重新生成');
    }
    Object.assign(state, { currentPattern: pattern, statistics, highlightedCode: null, dirty: false, previewMode: 'effect' });
    showAllColors = false;
    $('#dirtyNotice').hidden = true;
    $('#resultSection').hidden = false;
    $$('.mode-switch button').forEach((item) => {
      const active = item.dataset.mode === 'effect'; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active));
    });
    updateProgress(100);
    renderer.rebuild(); renderer.fit(); renderStatistics();
    requestAnimationFrame(() => $('#resultSection').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    notify('图纸生成完成啦', 'success');
  } catch (error) {
    notify(error.message || '生成失败，请重新生成', 'error', 5000);
    $('#dirtyNotice').hidden = false;
    $('#dirtyNotice').textContent = '生成失败，请点击下方按钮重新生成';
  } finally {
    state.generating = false; button.disabled = false;
    button.lastChild.textContent = state.currentPattern ? ' 重新生成拼豆图纸' : ' 生成我的拼豆图纸';
    setTimeout(() => { if (!state.generating) $('#progressSection').hidden = true; }, 700);
  }
}

function changeTransform(action) {
  if (!state.image) return;
  if (action === 'rotateLeft') state.transform.rotation = (state.transform.rotation - 90) % 360;
  if (action === 'rotateRight') state.transform.rotation = (state.transform.rotation + 90) % 360;
  if (action === 'flipH') state.transform.flipH = !state.transform.flipH;
  if (action === 'reset') {
    state.transform = { rotation: 0, flipH: false, flipV: false };
    state.crop = null; $('#cropBadge').hidden = true;
  }
  markDirty(); drawSourcePreview();
}

function setMode(mode) {
  state.previewMode = mode;
  state.viewport = { zoom: 1, x: 0, y: 0 };
  $$('.mode-switch button').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
  });
  renderer.rebuild(); renderer.fit();
  if (mode === 'pattern' && window.matchMedia('(max-width: 760px)').matches) {
    const rect = $('#resultStage').getBoundingClientRect();
    renderer.zoomAt(1.7, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
}

async function copyList() {
  const text = state.statistics.map((item) => `${item.code} ${item.name}：${item.count}颗`).join('\n');
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const area = document.createElement('textarea'); area.value = text; document.body.append(area); area.select(); document.execCommand('copy'); area.remove();
    }
    notify('用豆清单已复制', 'success');
  } catch { notify('复制失败，请检查浏览器权限', 'error'); }
}

function getExportWatermarkText() {
  if (!$('#tiledWatermarkEnabled').checked) return '';
  const text = normalizeWatermarkText($('#tiledWatermarkText').value);
  $('#tiledWatermarkText').value = text;
  return text;
}

function updateReplacementTarget() {
  const target = state.palette[replacementTargetIndex];
  $('#replaceTargetText').textContent = target ? getColorDisplayLabel(target) : '请在下方选择一种颜色';
  $('#confirmReplaceColor').disabled = !target || replacementTargetIndex === replacementSourceIndex;
}

function renderReplacementPalette() {
  const container = $('#replacementPalette');
  const query = $('#replacementSearch').value.trim().toLocaleUpperCase('zh-CN');
  const fragment = document.createDocumentFragment();
  const matchedColors = state.palette.filter((color) => (
    !query
    || color.code.toLocaleUpperCase('zh-CN').includes(query)
    || color.name.toLocaleUpperCase('zh-CN').includes(query)
    || color.searchTerms?.toLocaleUpperCase('zh-CN').includes(query)
  ));
  const colors = [
    ...matchedColors.filter((color) => color.manualOnly),
    ...sortPaletteByRecent(
      matchedColors.filter((color) => !color.manualOnly),
      recentReplacementCodes,
    ),
  ];

  colors.forEach((color) => {
    const button = makeButton('palette-swatch', {
      type: 'button',
      role: 'radio',
      'aria-checked': String(color.index === replacementTargetIndex),
      'aria-label': `${recentReplacementCodes.includes(color.code) ? '最近使用 ' : ''}${getColorDisplayLabel(color)}`,
    });
    button.dataset.index = color.index;
    button.classList.toggle('active', color.index === replacementTargetIndex);
    button.classList.toggle('current', color.index === replacementSourceIndex);
    button.classList.toggle('recent', recentReplacementCodes.includes(color.code));
    button.classList.toggle('manual-blank', Boolean(color.manualOnly));
    const patch = document.createElement('i'); patch.style.backgroundColor = color.hex;
    const code = document.createElement('strong'); code.textContent = getColorDisplayCode(color);
    const name = document.createElement('small'); name.textContent = color.name;
    button.append(patch, code, name);
    fragment.append(button);
  });

  container.replaceChildren(fragment);
  if (!colors.length) {
    const empty = document.createElement('p');
    empty.className = 'palette-empty';
    empty.textContent = '没有找到这个色号，换个关键词试试';
    container.append(empty);
  }
}

function openReplaceColorDialog() {
  const source = state.statistics.find((item) => item.code === state.highlightedCode);
  if (!source) return notify('请先在用豆清单中选择一种颜色', 'error');

  replacementSourceIndex = source.index;
  replacementTargetIndex = null;
  replacementCell = null;
  $('#replaceDialogTitle').textContent = '替换整种颜色';
  $('#replaceCurrentLabel').textContent = '当前选中的颜色';
  $('#confirmReplaceColor').textContent = '确认替换全部同色格子';
  $('#replaceCurrentSwatch').style.backgroundColor = source.hex;
  $('#replaceCurrentCode').textContent = getColorDisplayCode(source);
  $('#replaceCurrentMeta').textContent = `${source.name} · 当前共 ${number.format(source.count)}颗`;
  $('#replacementSearch').value = '';
  updateReplacementTarget();
  renderReplacementPalette();
  $('#replacementPalette').scrollTop = 0;
  $('#replaceColorDialog').showModal();
}

function openReplaceCellDialog(cell) {
  if (state.previewMode !== 'pattern' || !state.currentPattern) return;
  const source = state.palette[cell.colorIndex];
  if (!source) return;

  replacementSourceIndex = source.index;
  replacementTargetIndex = null;
  replacementCell = cell;
  $('#replaceDialogTitle').textContent = '替换这一颗豆';
  $('#replaceCurrentLabel').textContent = `第 ${cell.x + 1} 列 · 第 ${cell.y + 1} 行`;
  $('#confirmReplaceColor').textContent = '确认只替换这一格';
  $('#replaceCurrentSwatch').style.backgroundColor = source.hex;
  $('#replaceCurrentCode').textContent = getColorDisplayCode(source);
  $('#replaceCurrentMeta').textContent = source.manualOnly ? '纯白留白 · 不显示色号、不统计数量' : `${source.name} · 只修改当前小格子`;
  $('#replacementSearch').value = '';
  updateReplacementTarget();
  renderReplacementPalette();
  $('#replacementPalette').scrollTop = 0;
  $('#replaceColorDialog').showModal();
}

function applyColorReplacement() {
  const source = state.palette[replacementSourceIndex];
  const target = state.palette[replacementTargetIndex];
  if (!source || !target || source.index === target.index) return notify('请选择一种不同的替换颜色', 'error');

  const cellReplacement = Boolean(replacementCell);
  const replaced = cellReplacement
    ? Number(replacePatternCell(state.currentPattern, replacementCell.position, target.index))
    : replacePatternColor(state.currentPattern, source.index, target.index);
  if (!replaced) return notify('当前格子的颜色没有发生变化', 'error');

  state.currentPattern.backgroundMask = createWhiteBackgroundMask(
    state.currentPattern,
    state.palette,
    state.currentPattern.sourcePixels,
  );
  state.statistics = calculateStatistics(
    state.currentPattern.indices,
    state.palette,
    state.currentPattern.backgroundMask,
  );
  if (statisticsTotal(state.statistics) !== countPatternBeans(
    state.currentPattern.indices,
    state.palette,
    state.currentPattern.backgroundMask,
  )) {
    return notify('替换后的颜色统计校验失败，请重新生成图纸', 'error');
  }
  state.highlightedCode = cellReplacement || target.excludeFromStatistics ? null : target.code;
  if (!target.manualOnly) rememberReplacementColor(target.code);
  showAllColors = state.statistics.length <= 8 ? false : showAllColors;
  renderStatistics();
  renderer.rebuild();
  $('#replaceColorDialog').close();
  notify(
    cellReplacement
      ? `第 ${replacementCell.x + 1} 列、第 ${replacementCell.y + 1} 行已换成 ${getColorDisplayLabel(target)}`
      : `已将 ${getColorDisplayCode(source)} 替换为 ${getColorDisplayLabel(target)}，共 ${number.format(replaced)}格`,
    'success',
  );
}

function replaceCellWithBlank(cell) {
  const blank = state.palette.find((color) => color.manualOnly);
  if (!blank) return notify('纯白留白加载失败，请刷新页面', 'error');
  if (cell.colorIndex === blank.index) return notify('这个格子已经是纯白留白');
  if (!replacePatternCell(state.currentPattern, cell.position, blank.index)) {
    return notify('当前格子没有发生变化', 'error');
  }

  state.currentPattern.backgroundMask = createWhiteBackgroundMask(
    state.currentPattern,
    state.palette,
    state.currentPattern.sourcePixels,
  );
  state.statistics = calculateStatistics(
    state.currentPattern.indices,
    state.palette,
    state.currentPattern.backgroundMask,
  );
  if (statisticsTotal(state.statistics) !== countPatternBeans(
    state.currentPattern.indices,
    state.palette,
    state.currentPattern.backgroundMask,
  )) {
    return notify('快捷留白后的颜色统计校验失败，请重新生成图纸', 'error');
  }

  state.highlightedCode = null;
  renderStatistics();
  renderer.rebuild();
  notify(`第 ${cell.x + 1} 列、第 ${cell.y + 1} 行已快速留白`, 'success');
}

function bindUpload() {
  const zone = $('#uploadZone'), input = $('#fileInput');
  const open = () => input.click();
  zone.addEventListener('click', (event) => { if (event.target !== input) open(); });
  zone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  $('#replaceImage').addEventListener('click', (event) => { event.stopPropagation(); open(); });
  input.addEventListener('change', () => { loadFile(input.files[0]); input.value = ''; });
  ['dragenter', 'dragover'].forEach((type) => zone.addEventListener(type, (event) => { event.preventDefault(); zone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach((type) => zone.addEventListener(type, (event) => { event.preventDefault(); zone.classList.remove('drag-over'); }));
  zone.addEventListener('drop', (event) => loadFile(event.dataTransfer.files[0]));
}

function bindChoices() {
  $('#sizeCards').addEventListener('click', (event) => {
    const button = event.target.closest('.size-card'); if (!button) return;
    if (button.dataset.id === 'custom') { $('#customSizeDialog').showModal(); return; }
    state.currentSize = { width: Number(button.dataset.width), height: Number(button.dataset.height) };
    setChoiceActive($('#sizeCards'), button); markDirty();
  });
  $('#colorCards').addEventListener('click', (event) => {
    const button = event.target.closest('.color-card'); if (!button) return;
    state.maxColors = Number(button.dataset.colors); setChoiceActive($('#colorCards'), button); markDirty();
  });
  $('#colorStyleCards').addEventListener('click', (event) => {
    const button = event.target.closest('.style-card'); if (!button) return;
    state.colorStyle = button.dataset.colorStyle;
    setChoiceActive($('#colorStyleCards'), button);
    markDirty();
    drawSourcePreview();
  });
}

const cropper = new CropperController({
  dialog: $('#cropDialog'), image: $('#cropImage'), ratioButtons: $$('.crop-ratios button'),
  confirmButton: $('#confirmCrop'), cancelButton: $('#cancelCrop'),
  getPatternRatio: () => state.currentSize.width / state.currentSize.height,
  onConfirm: (crop) => { state.crop = crop; $('#cropBadge').hidden = false; markDirty(); drawSourcePreview(); },
});

function bindDialogs() {
  $('#cropButton').addEventListener('click', () => cropper.open(state.imageUrl, state.crop));
  const width = $('#customWidth'), height = $('#customHeight');
  const updateTotal = () => { $('#customTotal').textContent = `总计 ${number.format((Number(width.value) || 0) * (Number(height.value) || 0))}颗`; };
  width.addEventListener('input', updateTotal); height.addEventListener('input', updateTotal);
  $('#confirmCustomSize').addEventListener('click', () => {
    const w = Number(width.value), h = Number(height.value);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 10 || w > 200 || h < 10 || h > 300) return notify('宽度需为10～200格，高度需为10～300格', 'error');
    state.currentSize = { width: w, height: h };
    const custom = $('[data-id="custom"]');
    custom.querySelector('b').textContent = `${w} × ${h}格`;
    custom.querySelectorAll('span')[1].textContent = `总计 ${number.format(w * h)}颗`;
    setChoiceActive($('#sizeCards'), custom); markDirty(); $('#customSizeDialog').close();
  });
  $('[data-close-dialog]').addEventListener('click', () => $('#customSizeDialog').close());
}

function bindResults() {
  const watermarkEnabled = $('#tiledWatermarkEnabled');
  const watermarkText = $('#tiledWatermarkText');
  const syncWatermarkSetting = () => {
    watermarkText.disabled = !watermarkEnabled.checked;
    $('#exportWatermarkCard').classList.toggle('disabled', !watermarkEnabled.checked);
  };
  watermarkText.value = DEFAULT_TILED_WATERMARK;
  watermarkEnabled.addEventListener('change', syncWatermarkSetting);
  syncWatermarkSetting();

  $$('.mode-switch button').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $('#toggleColors').addEventListener('click', () => { showAllColors = !showAllColors; renderColorList(); });
  $('#copyColors').addEventListener('click', copyList);
  $('#replaceSelectedColor').addEventListener('click', openReplaceColorDialog);
  $('#closeReplaceColor').addEventListener('click', () => $('#replaceColorDialog').close());
  $('#replacementSearch').addEventListener('input', renderReplacementPalette);
  $('#replacementPalette').addEventListener('click', (event) => {
    const button = event.target.closest('.palette-swatch'); if (!button) return;
    replacementTargetIndex = Number(button.dataset.index);
    updateReplacementTarget();
    renderReplacementPalette();
  });
  $('#resultStage').addEventListener('contextmenu', (event) => {
    if (state.previewMode !== 'pattern' || !state.currentPattern) return;
    if (event.target.closest('button')) return;
    const cell = renderer.hitTestCell(event.clientX, event.clientY);
    if (!cell) return;
    event.preventDefault();
    replaceCellWithBlank(cell);
  });
  $('#confirmReplaceColor').addEventListener('click', applyColorReplacement);
  $('#colorList').addEventListener('click', (event) => {
    const row = event.target.closest('.color-row'); if (!row) return;
    state.highlightedCode = state.highlightedCode === row.dataset.code ? null : row.dataset.code;
    renderColorList(); renderer.rebuild();
  });
  $('#fullscreenButton').addEventListener('click', async () => {
    try {
      const stage = $('#resultStage');
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage.requestFullscreen) await stage.requestFullscreen();
      else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen();
    } catch { notify('当前浏览器不支持全屏查看', 'error'); }
  });
  $('#saveEffect').addEventListener('click', async () => {
    try { const result = await exportEffectPng(state.currentPattern, state.palette, { tiledWatermarkText: getExportWatermarkText() }); if (result.reduced) notify(`设备内存有限，已安全导出 ${result.width}×${result.height}px，图纸内容不受影响。`); else notify(`高清效果图已保存（${result.width}×${result.height}px）`, 'success'); }
    catch (error) { notify(error.message || '保存失败，请重试', 'error', 5000); }
  });
  $('#savePattern').addEventListener('click', async () => {
    try { const result = await exportPatternPng(state.currentPattern, state.palette, state.statistics, { tiledWatermarkText: getExportWatermarkText() }); if (result.reduced) notify(`设备内存有限，已安全导出 ${result.width}×${result.height}px，色号和网格不受影响。`); else notify(`高清制作图已保存（${result.width}×${result.height}px）`, 'success'); }
    catch (error) { notify(error.message || '保存失败，请重试', 'error', 5000); }
  });
  $('#saveMirroredPattern').addEventListener('click', async () => {
    try { const result = await exportPatternPng(state.currentPattern, state.palette, state.statistics, { mirrorX: true, tiledWatermarkText: getExportWatermarkText() }); if (result.reduced) notify(`设备内存有限，已安全导出镜像制作图 ${result.width}×${result.height}px，色号和网格不受影响。`); else notify(`高清镜像制作图已保存（${result.width}×${result.height}px）`, 'success'); }
    catch (error) { notify(error.message || '镜像制作图保存失败，请重试', 'error', 5000); }
  });
}

buildChoices(); bindUpload(); bindChoices(); bindDialogs(); bindResults();
$$('[data-transform]').forEach((button) => button.addEventListener('click', () => changeTransform(button.dataset.transform)));
$('#generateButton').addEventListener('click', generate);
window.addEventListener('resize', () => { if (state.image) drawSourcePreview(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.highlightedCode && !$('#replaceColorDialog').open) {
    state.highlightedCode = null; renderColorList(); renderer.rebuild();
  }
});
renderer.resize();

if (state.palette.filter((color) => !color.manualOnly).length !== 221) notify('MARD 221 色卡加载不完整，请刷新页面', 'error');
