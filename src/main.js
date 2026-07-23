import 'cropperjs/dist/cropper.css';
import './styles/app.css';
import paletteJson from './data/palettes/universal-48.json';
import { PATTERN_SIZES, COLOR_OPTIONS, MAX_FILE_BYTES, SUPPORTED_TYPES } from './state/config.js';
import { store } from './state/store.js';
import { preparePalette } from './color/colorMatcher.js';
import { createAdjustedCanvas, getGridPixels } from './image/imageProcessor.js';
import { CropperController } from './image/cropperController.js';
import { generatePattern } from './pattern/patternGenerator.js';
import { calculateStatistics, statisticsTotal } from './pattern/statistics.js';
import { ResultCanvasRenderer } from './canvas/resultCanvasRenderer.js';
import { exportEffectPng, exportPatternPng } from './export/pngExporter.js';
import { notify } from './ui/notifications.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const number = new Intl.NumberFormat('zh-CN');
const state = store.get();
state.palette = preparePalette(paletteJson);

let generationVersion = 0;
let showAllColors = false;
const renderer = new ResultCanvasRenderer($('#resultCanvas'), $('#resultStage'), () => state);

function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function makeButton(className, attributes = {}) {
  const button = document.createElement('button');
  button.className = className;
  Object.entries(attributes).forEach(([key, value]) => button.setAttribute(key, value));
  return button;
}

function buildChoices() {
  PATTERN_SIZES.forEach((size) => {
    const button = makeButton('size-card', { role: 'radio', 'aria-checked': String(size.id === 'medium') });
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
    button.classList.toggle('active', size.id === 'medium');
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
  const source = createAdjustedCanvas(state.image, state.transform, state.adjustments, 1000, state.crop);
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
}

function renderStatistics() {
  const total = state.currentPattern.width * state.currentPattern.height;
  const actual = state.statistics.length;
  $('#summaryTotal').textContent = `${number.format(total)}颗`;
  $('#summaryColors').textContent = `${actual}种颜色`;
  $('#summaryPhysical').textContent = `约${state.currentPattern.width * 0.5}cm × ${state.currentPattern.height * 0.5}cm`;
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
    const adjusted = createAdjustedCanvas(state.image, state.transform, state.adjustments, 1800, state.crop);
    const { width, height } = state.currentSize;
    const pixels = getGridPixels(adjusted, width, height);
    const pattern = await generatePattern({
      pixels, width, height,
      palette: state.palette.map(({ code, name, hex, rgb }) => ({ code, name, hex, rgb })),
      maxColors: state.maxColors,
      reduceIsolated: true,
      mergeColors: true,
      onProgress: updateProgress,
    });
    if (version !== generationVersion) return;
    const statistics = calculateStatistics(pattern.indices, state.palette);
    if (statisticsTotal(statistics) !== width * height) throw new Error('颜色统计校验失败，请重新生成');
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
  $$('.mode-switch button').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $('#toggleColors').addEventListener('click', () => { showAllColors = !showAllColors; renderColorList(); });
  $('#copyColors').addEventListener('click', copyList);
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
    try { const result = await exportEffectPng(state.currentPattern, state.palette); if (result.reduced) notify('当前图纸较大，已自动降低导出分辨率，图纸内容和编号不会受影响。'); else notify('效果图已保存', 'success'); }
    catch (error) { notify(error.message || '保存失败，请重试', 'error', 5000); }
  });
  $('#savePattern').addEventListener('click', async () => {
    try { const result = await exportPatternPng(state.currentPattern, state.palette, state.statistics); if (result.reduced) notify('当前图纸较大，已自动降低导出分辨率，图纸内容和编号不会受影响。'); else notify('制作图已保存', 'success'); }
    catch (error) { notify(error.message || '保存失败，请重试', 'error', 5000); }
  });
}

buildChoices(); bindUpload(); bindChoices(); bindDialogs(); bindResults();
$$('[data-transform]').forEach((button) => button.addEventListener('click', () => changeTransform(button.dataset.transform)));
$('#generateButton').addEventListener('click', generate);
window.addEventListener('resize', () => { if (state.image) drawSourcePreview(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && state.highlightedCode) { state.highlightedCode = null; renderColorList(); renderer.rebuild(); } });
renderer.resize();

if (state.palette.length < 48) notify('通用色卡加载不完整，请刷新页面', 'error');
