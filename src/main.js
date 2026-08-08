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
import { analyzePatternGrid, samplePatternGrid } from './image/patternGridDetector.js';
import { detectPatternLegend } from './image/patternLegendDetector.js';
import { downloadLinkedImage, resolveSharedLink } from './link/linkImporter.js';
import {
  getColorStyleAdjustments,
  shouldOmitWhiteBackground,
  shouldProtectDarkOutline,
} from './image/colorStyle.js';
import { CropperController } from './image/cropperController.js';
import { generatePattern } from './pattern/patternGenerator.js';
import { calculateStatistics, countPatternBeans, statisticsTotal } from './pattern/statistics.js';
import { createWhiteBackgroundMask } from './pattern/backgroundMask.js';
import {
  replacePatternCell,
  replacePatternCells,
  replacePatternColor,
} from './pattern/colorReplacement.js';
import {
  getPatternTapIntent,
  getRectangularSelectionPositions,
} from './pattern/cellSelection.js';
import { cropPattern, getPatternCropInsets } from './pattern/patternCrop.js';
import {
  createPatternSnapshot,
  createPatternStateSnapshot,
  pushPatternSnapshot,
  restorePatternSnapshot,
} from './pattern/undoHistory.js';
import { ResultCanvasRenderer } from './canvas/resultCanvasRenderer.js';
import {
  DEFAULT_TILED_WATERMARK,
  normalizeWatermarkText,
} from './canvas/tiledWatermark.js';
import {
  exportAllHighlightedColorsZip,
  exportEffectPng,
  exportHighlightedColorPng,
  exportPatternPng,
} from './export/pngExporter.js';
import {
  createProjectDocument,
  getProjectDownloadFileName,
  normalizeProjectName,
  parseProjectDocument,
  serializeProjectDocument,
} from './project/projectFile.js';
import { notify } from './ui/notifications.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const number = new Intl.NumberFormat('zh-CN');
const RECENT_COLORS_KEY = 'perler-recent-replacement-colors';
const PATTERN_UNDO_LIMIT = 20;
const MAX_PROJECT_FILE_BYTES = 64 * 1024 * 1024;
const MAX_PROJECT_TEXT_LENGTH = 70 * 1024 * 1024;
const state = store.get();
state.palette = preparePalette([...paletteJson, MANUAL_BLANK_COLOR]);

let generationVersion = 0;
let showAllColors = false;
let exportingAllColors = false;
let replacementSourceIndex = null;
let replacementTargetIndex = null;
let replacementCell = null;
let replacementCells = null;
let pendingGridRecovery = null;
let currentLinkedPost = null;
let recentReplacementCodes = loadRecentReplacementCodes();
const renderer = new ResultCanvasRenderer(
  $('#resultCanvas'),
  $('#resultStage'),
  () => state,
  (cell, modifiers) => handlePatternCellTap(cell, modifiers),
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('原始图片读取失败，请重新上传后再保存工程'));
    reader.readAsDataURL(file);
  });
}

async function createProjectBlob(text) {
  if (typeof CompressionStream === 'function') {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = await new Response(stream).blob();
    return new Blob([compressed], { type: 'application/x-perler-project' });
  }
  return new Blob([text], { type: 'application/json' });
}

async function readProjectText(file) {
  if (file.size > MAX_PROJECT_FILE_BYTES) throw new Error('工程文件超过 64MB，无法打开');
  const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const compressed = header[0] === 0x1f && header[1] === 0x8b;
  if (compressed && typeof DecompressionStream !== 'function') {
    throw new Error('当前浏览器版本过旧，无法打开压缩工程文件');
  }
  const text = compressed
    ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : await file.text();
  if (text.length > MAX_PROJECT_TEXT_LENGTH) throw new Error('工程文件内容过大，无法打开');
  return text;
}

async function projectImageToFile(image) {
  const response = await fetch(image.dataUrl);
  const blob = await response.blob();
  if (blob.size !== image.size || blob.type !== image.type) throw new Error('工程中的原始图片校验失败');
  return new File([blob], image.name, { type: image.type, lastModified: image.lastModified });
}

function downloadProjectBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setProjectButtonsDisabled(disabled) {
  $('#saveProjectButton').disabled = disabled;
  $('#saveProjectResultButton').disabled = disabled;
  $('#confirmSaveProject').disabled = disabled;
}

function openSaveProjectDialog() {
  if (!state.image || !state.sourceImage) return notify('请先上传图片或打开一个工程', 'error');
  if (state.generating) return notify('图纸正在生成，请完成后再保存工程');
  const input = $('#projectNameInput');
  input.value = normalizeProjectName(state.projectName, state.sourceImage.name);
  $('#saveProjectDialog').showModal();
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

async function saveProject(requestedName) {
  if (!state.image || !state.sourceImage) {
    notify('请先上传图片或打开一个工程', 'error');
    return false;
  }
  if (state.generating) {
    notify('图纸正在生成，请完成后再保存工程');
    return false;
  }
  setProjectButtonsDisabled(true);
  try {
    const projectName = normalizeProjectName(requestedName, state.sourceImage.name);
    let imageDataUrl = state.sourceImage.dataUrl;
    if (!imageDataUrl) {
      if (!state.file) throw new Error('原始图片数据缺失，请重新上传后再保存工程');
      imageDataUrl = await fileToDataUrl(state.file);
      state.sourceImage = { ...state.sourceImage, dataUrl: imageDataUrl };
    }
    const document = createProjectDocument({
      name: projectName,
      image: {
        name: state.sourceImage.name,
        type: state.sourceImage.type,
        size: state.sourceImage.size,
        width: state.sourceImage.width,
        height: state.sourceImage.height,
        lastModified: state.sourceImage.lastModified,
        dataUrl: imageDataUrl,
      },
      settings: {
        crop: state.crop,
        transform: state.transform,
        adjustments: state.adjustments,
        colorStyle: state.colorStyle,
        maxColors: state.maxColors,
        currentSize: state.currentSize,
        dirty: state.dirty,
        options: state.options,
      },
      pattern: state.currentPattern,
      preferences: {
        previewMode: state.previewMode,
        recentColors: recentReplacementCodes,
        watermark: {
          enabled: $('#tiledWatermarkEnabled').checked,
          text: normalizeWatermarkText($('#tiledWatermarkText').value),
        },
      },
      paletteCodes: state.palette.map((color) => color.code),
    });
    const blob = await createProjectBlob(serializeProjectDocument(document));
    downloadProjectBlob(blob, getProjectDownloadFileName(projectName));
    state.projectName = projectName;
    notify(`工程“${projectName}”已保存，可以发到其他电脑继续制作`, 'success', 5000);
    return true;
  } catch (error) {
    notify(error.message || '工程保存失败，请重试', 'error', 5000);
    return false;
  } finally {
    setProjectButtonsDisabled(false);
  }
}

function syncRestoredChoices() {
  const sizeButton = $$('.size-card').find((button) => (
    button.dataset.id !== 'custom'
    && Number(button.dataset.width) === state.currentSize.width
    && Number(button.dataset.height) === state.currentSize.height
  ));
  const selectedSize = sizeButton || $('[data-id="custom"]');
  if (!sizeButton) {
    $('#customWidth').value = state.currentSize.width;
    $('#customHeight').value = state.currentSize.height;
    selectedSize.querySelector('b').textContent = `${state.currentSize.width} × ${state.currentSize.height}格`;
    selectedSize.querySelectorAll('span')[1].textContent = `总计 ${number.format(state.currentSize.width * state.currentSize.height)}颗`;
  }
  setChoiceActive($('#sizeCards'), selectedSize);
  const colorButton = $(`[data-colors="${state.maxColors}"]`);
  if (colorButton) setChoiceActive($('#colorCards'), colorButton);
  const styleButton = $(`[data-color-style="${state.colorStyle}"]`);
  if (styleButton) setChoiceActive($('#colorStyleCards'), styleButton);
}

function syncWatermarkSetting() {
  const watermarkEnabled = $('#tiledWatermarkEnabled');
  const watermarkText = $('#tiledWatermarkText');
  watermarkText.disabled = !watermarkEnabled.checked;
  $('#exportWatermarkCard').classList.toggle('disabled', !watermarkEnabled.checked);
}

function getPatternBackgroundMask(pattern, sourcePixels, colorStyle = state.colorStyle) {
  return shouldOmitWhiteBackground(colorStyle)
    ? createWhiteBackgroundMask(pattern, state.palette, sourcePixels)
    : null;
}

async function openProject(file) {
  if (!file) return;
  if (state.generating) return notify('图纸正在生成，请稍后再打开工程');
  let decoded;
  try {
    const text = await readProjectText(file);
    const project = parseProjectDocument(text, {
      paletteCodes: state.palette.map((color) => color.code),
    });
    if (state.image && !window.confirm('打开工程会替换当前正在制作的内容，确定继续吗？')) return;
    const imageFile = await projectImageToFile(project.image);
    decoded = await decodeImage(imageFile);
    if (decoded.image.naturalWidth !== project.image.width || decoded.image.naturalHeight !== project.image.height) {
      throw new Error('工程中的原始图片尺寸校验失败');
    }
    let statistics = [];
    if (project.pattern) {
      project.pattern.backgroundMask = getPatternBackgroundMask(
        project.pattern,
        project.pattern.sourcePixels,
        project.settings.colorStyle,
      );
      statistics = calculateStatistics(project.pattern.indices, state.palette, project.pattern.backgroundMask);
      if (statisticsTotal(statistics) !== countPatternBeans(
        project.pattern.indices,
        state.palette,
        project.pattern.backgroundMask,
      )) throw new Error('工程中的颜色统计校验失败');
    }

    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    generationVersion += 1;
    Object.assign(state, {
      image: decoded.image,
      imageUrl: decoded.url,
      file: imageFile,
      sourceImage: { ...project.image },
      projectName: project.name,
      imageInfo: { width: project.image.width, height: project.image.height, size: project.image.size },
      crop: project.settings.crop,
      transform: project.settings.transform,
      adjustments: project.settings.adjustments,
      colorStyle: project.settings.colorStyle,
      maxColors: project.settings.maxColors,
      currentSize: project.settings.currentSize,
      currentPattern: project.pattern,
      previewMode: project.preferences.previewMode,
      viewport: { zoom: 1, x: 0, y: 0 },
      statistics,
      highlightedCode: null,
      selectionAnchorPosition: null,
      dirty: project.settings.dirty,
      options: project.settings.options,
    });
    state.selectedCellPositions.clear();
    state.patternUndoHistory.length = 0;
    recentReplacementCodes = project.preferences.recentColors;
    try { localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recentReplacementCodes)); } catch {}

    $('#uploadPrompt').hidden = true;
    $('#uploadedSummary').hidden = false;
    $('#uploadThumbnail').src = decoded.url;
    $('#uploadedName').textContent = project.image.name;
    $('#uploadedMeta').textContent = `${project.image.width} × ${project.image.height} · ${formatBytes(project.image.size)}`;
    $('#settingsArea').hidden = false;
    $('#welcomeCard').hidden = true;
    $('#sourceCard').hidden = false;
    $('#cropBadge').hidden = !state.crop;
    $('#dirtyNotice').hidden = !state.dirty;
    $('#dirtyNotice').textContent = '设置已修改，请重新生成图纸';
    $('#generateButton').lastChild.textContent = state.currentPattern ? ' 重新生成拼豆图纸' : ' 生成我的拼豆图纸';
    $('#resultSection').hidden = !state.currentPattern;
    $('#tiledWatermarkEnabled').checked = project.preferences.watermark.enabled;
    $('#tiledWatermarkText').value = project.preferences.watermark.text || DEFAULT_TILED_WATERMARK;
    syncWatermarkSetting();
    syncRestoredChoices();
    setProjectButtonsDisabled(false);
    showAllColors = false;
    updateCellSelectionUi();
    $$('.mode-switch button').forEach((button) => {
      const active = button.dataset.mode === state.previewMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    requestAnimationFrame(drawSourcePreview);
    if (state.currentPattern) {
      renderStatistics();
      renderer.rebuild();
      renderer.fit();
      requestAnimationFrame(() => $('#resultSection').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    notify('工程已打开，可以从保存的位置继续制作', 'success', 5000);
  } catch (error) {
    if (decoded?.url) URL.revokeObjectURL(decoded.url);
    notify(error.message || '工程文件打开失败，请确认文件完整', 'error', 6000);
  }
}

async function loadFile(file) {
  if (!file) return false;
  if (!SUPPORTED_TYPES.includes(file.type)) { notify('请选择 JPG、PNG 或 WebP 图片', 'error'); return false; }
  if (file.size > MAX_FILE_BYTES) { notify('图片超过 40MB，请压缩后再试', 'error'); return false; }
  let decoded;
  try {
    decoded = await decodeImage(file);
    const { image, url } = decoded;
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸无效');
    if (image.naturalWidth * image.naturalHeight > 80_000_000) throw new Error('图片像素过大，请先缩小图片');
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    Object.assign(state, {
      image, imageUrl: url, file,
      sourceImage: {
        name: file.name,
        type: file.type,
        size: file.size,
        width: image.naturalWidth,
        height: image.naturalHeight,
        lastModified: file.lastModified,
        dataUrl: null,
      },
      projectName: normalizeProjectName('', file.name),
      imageInfo: { width: image.naturalWidth, height: image.naturalHeight, size: file.size },
      crop: null, transform: { rotation: 0, flipH: false, flipV: false },
      currentPattern: null, statistics: [], highlightedCode: null, dirty: false,
    });
    state.patternUndoHistory.length = 0;
    pendingGridRecovery = null;
    $('#patternRecoveryStatus').textContent = '自动数格子，并读取每一格的底色';
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
    setProjectButtonsDisabled(false);
    requestAnimationFrame(drawSourcePreview);
    notify('图片已读取，只会在本地处理', 'success');
    return true;
  } catch (error) {
    if (decoded?.url) URL.revokeObjectURL(decoded.url);
    notify(error.message || '图片读取失败，请重试', 'error', 5000);
    return false;
  }
}

function updateProgress(progress) {
  const label = progress < 34 ? '正在分析图片……'
    : progress < 68 ? '正在挑选合适的颜色……'
      : progress < 94 ? '正在整理拼豆格子……' : '图纸马上完成啦！';
  $('#progressLabel').textContent = label;
  $('#progressFill').style.width = `${Math.max(8, progress)}%`;
}

function createPatternDetectionCanvas() {
  return createAdjustedCanvas(
    state.image,
    state.transform,
    { brightness: 0, contrast: 0, saturation: 0, sharpen: 0, smoothing: 0 },
    1800,
    state.crop,
  );
}

function drawPatternDetectionPreview(source, detection) {
  const canvas = $('#patternGridPreview');
  const context = canvas.getContext('2d');
  canvas.width = 720;
  canvas.height = 360;
  context.fillStyle = '#EEE9F2';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const left = Math.max(0, detection.bounds.left);
  const top = Math.max(0, detection.bounds.top);
  const right = Math.min(source.width, detection.bounds.right);
  const bottom = Math.min(source.height, detection.bounds.bottom);
  const sourceWidth = Math.max(1, right - left);
  const sourceHeight = Math.max(1, bottom - top);
  const scale = Math.min((canvas.width - 20) / sourceWidth, (canvas.height - 20) / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const x = (canvas.width - width) / 2;
  const y = (canvas.height - height) / 2;
  context.imageSmoothingEnabled = false;
  context.drawImage(source, left, top, sourceWidth, sourceHeight, x, y, width, height);
  context.strokeStyle = '#7864C3';
  context.lineWidth = 3;
  context.strokeRect(x, y, width, height);
}

async function detectExistingPatternGrid() {
  if (!state.image) return notify('请先上传一张图纸截图', 'error');
  if (state.generating) return;
  const button = $('#detectPatternGrid');
  button.disabled = true;
  button.textContent = '正在识别…';
  $('#patternRecoveryStatus').textContent = '正在寻找规则网格和坐标栏';
  try {
    await new Promise(requestAnimationFrame);
    const canvas = createPatternDetectionCanvas();
    const imageData = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
    const detection = analyzePatternGrid(imageData);
    const recoveryPalette = state.palette.filter((color) => !color.manualOnly);
    const legend = detectPatternLegend(imageData, detection, recoveryPalette);
    pendingGridRecovery = { canvas, imageData, detection, legend };
    $('#detectedGridWidth').value = detection.width;
    $('#detectedGridHeight').value = detection.height;
    const confidence = Math.round(detection.confidence * 100);
    const removedRows = detection.removedCoordinateRows.top + detection.removedCoordinateRows.bottom;
    const removedColumns = detection.removedCoordinateColumns.left + detection.removedCoordinateColumns.right;
    const removed = removedRows + removedColumns;
    const legendSummary = legend
      ? `检测到图例 ${legend.swatchCount} 个色块，将只在图例对应的 ${legend.paletteCodes.length} 个色号中匹配。`
      : '未检测到可靠图例，将继续使用原有的全色卡识别。';
    $('#patternGridSummary').textContent = `检测到 ${detection.width} × ${detection.height} 格，网格可信度 ${confidence}%${removed ? `，已排除 ${removedRows} 行、${removedColumns} 列坐标栏` : ''}。${legendSummary}请核对后再恢复。`;
    $('#patternRecoveryStatus').textContent = `已检测到 ${detection.width} × ${detection.height} 格，等待确认`;
    drawPatternDetectionPreview(canvas, detection);
    $('#patternGridDialog').showModal();
  } catch (error) {
    pendingGridRecovery = null;
    $('#patternRecoveryStatus').textContent = '没有找到稳定网格，可先裁剪到图纸区域再试';
    notify(error.message || '没有识别到规则网格，请先裁剪掉多余界面后重试', 'error', 6000);
  } finally {
    button.disabled = false;
    button.textContent = '识别现成图纸';
  }
}

function setLinkImportHint(message, type = '') {
  const hint = $('#linkImportHint');
  hint.textContent = message;
  hint.classList.toggle('error', type === 'error');
  hint.classList.toggle('success', type === 'success');
}

function renderLinkedImages(result) {
  const grid = $('#linkImageGrid');
  grid.replaceChildren();
  result.images.forEach((image, index) => {
    const button = makeButton('link-image-card', { type: 'button', role: 'listitem', 'aria-label': `导入第 ${index + 1} 张图片` });
    button.dataset.linkImageIndex = index;
    const preview = document.createElement('img');
    preview.src = image.url;
    preview.alt = `作品图片 ${index + 1}`;
    preview.loading = index < 4 ? 'eager' : 'lazy';
    const label = document.createElement('span');
    label.textContent = `导入并识别第 ${index + 1} 张`;
    button.append(preview, label);
    grid.append(button);
  });
  $('#linkImageTitle').textContent = result.title || '选择要恢复的图纸图片';
  const platformName = result.platform === 'xiaohongshu' ? '小红书' : '抖音';
  $('#linkImageMeta').textContent = `${platformName}图文作品 · 共找到 ${result.images.length} 张图片${result.author ? ` · ${result.author}` : ''}`;
}

async function resolveLinkImport(event) {
  event.preventDefault();
  if (state.generating) return;
  const text = $('#linkImportInput').value;
  const button = $('#resolveLinkButton');
  button.disabled = true;
  button.textContent = '正在读取…';
  setLinkImportHint('正在打开分享链接并查找公开图片…');
  try {
    currentLinkedPost = await resolveSharedLink(text);
    renderLinkedImages(currentLinkedPost);
    setLinkImportHint(`已找到 ${currentLinkedPost.images.length} 张图片，请选择要恢复的图纸`, 'success');
    $('#linkImageDialog').showModal();
  } catch (error) {
    currentLinkedPost = null;
    setLinkImportHint(error.message || '链接读取失败，请直接上传截图', 'error');
    notify(error.message || '链接读取失败，请直接上传截图', 'error', 6000);
  } finally {
    button.disabled = false;
    button.textContent = '读取链接图片';
  }
}

async function importLinkedImage(index) {
  const image = currentLinkedPost?.images?.[index];
  if (!image) return notify('图片列表已经失效，请重新读取链接', 'error');
  const buttons = $$('.link-image-card');
  buttons.forEach((button) => { button.disabled = true; });
  const selected = buttons[index];
  const label = selected?.querySelector('span');
  if (label) label.textContent = '正在导入…';
  try {
    const file = await downloadLinkedImage(image, currentLinkedPost.title, index);
    const loaded = await loadFile(file);
    if (!loaded) return;
    $('#linkImageDialog').close();
    setLinkImportHint(`已导入第 ${index + 1} 张图片，正在识别网格`, 'success');
    await detectExistingPatternGrid();
  } catch (error) {
    notify(error.message || '图片导入失败，请选择其他图片', 'error', 6000);
  } finally {
    buttons.forEach((button, buttonIndex) => {
      button.disabled = false;
      const itemLabel = button.querySelector('span');
      if (itemLabel) itemLabel.textContent = `导入并识别第 ${buttonIndex + 1} 张`;
    });
  }
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
  const highlighted = state.statistics.find((item) => item.code === state.highlightedCode);
  $('#exportHighlightedColor').disabled = !highlighted || exportingAllColors;
  $('#exportHighlightedColor').textContent = highlighted
    ? `导出 ${highlighted.code} 分色定位图（${number.format(highlighted.count)}颗）`
    : '先选择颜色，再导出定位图';
  $('#exportAllHighlightedColors').disabled = !state.statistics.length || exportingAllColors;
  $('#exportAllHighlightedColors').textContent = exportingAllColors
    ? '正在生成全部分色定位图…'
    : `一键导出全部分色定位图（${state.statistics.length}色）`;
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

function updateCellSelectionUi() {
  const count = state.selectedCellPositions.size;
  $('#selectedCellCount').textContent = number.format(count);
  $('#multiSelectBar').hidden = !count || state.previewMode !== 'pattern';
}

function clearSelectedCells({ redraw = true } = {}) {
  if (!state.selectedCellPositions.size && state.selectionAnchorPosition === null) return;
  state.selectedCellPositions.clear();
  state.selectionAnchorPosition = null;
  updateCellSelectionUi();
  if (redraw) renderer.rebuild();
}

function toggleSelectedCell(cell) {
  if (state.selectedCellPositions.has(cell.position)) {
    state.selectedCellPositions.delete(cell.position);
  } else {
    state.selectedCellPositions.add(cell.position);
  }
  state.selectionAnchorPosition = state.selectedCellPositions.size ? cell.position : null;
  state.highlightedCode = null;
  renderColorList();
  updateCellSelectionUi();
  renderer.rebuild();
}

function selectCellRange(cell) {
  const anchor = state.selectionAnchorPosition;
  if (!Number.isInteger(anchor)) {
    state.selectedCellPositions.clear();
    state.selectedCellPositions.add(cell.position);
    state.selectionAnchorPosition = cell.position;
    notify('已设置范围起点，请按住 Shift 点击终点');
  } else {
    const positions = getRectangularSelectionPositions(
      state.currentPattern.width,
      state.currentPattern.height,
      anchor,
      cell.position,
    );
    state.selectedCellPositions.clear();
    positions.forEach((position) => state.selectedCellPositions.add(position));
  }
  state.highlightedCode = null;
  renderColorList();
  updateCellSelectionUi();
  renderer.rebuild();
}

function handlePatternCellTap(cell, { shiftKey = false, ctrlKey = false, metaKey = false } = {}) {
  const intent = getPatternTapIntent(
    state.selectedCellPositions.size,
    state.selectedCellPositions.has(cell.position),
    { shiftKey, ctrlKey, metaKey },
  );
  if (intent === 'range-select') {
    selectCellRange(cell);
    return;
  }
  if (intent === 'toggle-select') {
    toggleSelectedCell(cell);
    return;
  }
  if (intent === 'replace-selection') {
    openReplaceSelectedCellsDialog();
    return;
  }
  clearSelectedCells();
  openReplaceCellDialog(cell);
}

async function generatePreparedPattern({ pixels, width, height, recovery = false, allowedPaletteIndices = null }) {
  if (state.generating) return;
  state.generating = true;
  const version = ++generationVersion;
  const button = $('#generateButton'); button.disabled = true;
  $('#detectPatternGrid').disabled = true;
  $('#progressSection').hidden = false;
  $('#progressFill').style.width = '8%'; updateProgress(8);
  try {
    await new Promise(requestAnimationFrame);
    const pattern = await generatePattern({
      pixels, width, height,
      palette: state.palette
        .filter((color) => !color.manualOnly)
        .map(({ code, name, hex, rgb }) => ({ code, name, hex, rgb })),
      maxColors: recovery ? Math.max(48, state.maxColors) : state.maxColors,
      reduceIsolated: recovery ? false : state.options.reduceIsolated,
      mergeColors: !allowedPaletteIndices?.length,
      protectDarkOutline: recovery ? false : shouldProtectDarkOutline(state.colorStyle),
      allowedPaletteIndices,
      onProgress: updateProgress,
    });
    if (version !== generationVersion) return;
    pattern.sourcePixels = pixels;
    pattern.backgroundMask = getPatternBackgroundMask(pattern, pixels);
    const statistics = calculateStatistics(pattern.indices, state.palette, pattern.backgroundMask);
    if (statisticsTotal(statistics) !== countPatternBeans(pattern.indices, state.palette, pattern.backgroundMask)) {
      throw new Error('颜色统计校验失败，请重新生成');
    }
    state.selectedCellPositions.clear();
    state.selectionAnchorPosition = null;
    state.patternUndoHistory.length = 0;
    Object.assign(state, { currentPattern: pattern, statistics, highlightedCode: null, dirty: false, previewMode: 'effect' });
    updateCellSelectionUi();
    showAllColors = false;
    $('#dirtyNotice').hidden = true;
    $('#resultSection').hidden = false;
    $$('.mode-switch button').forEach((item) => {
      const active = item.dataset.mode === 'effect'; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active));
    });
    updateProgress(100);
    renderer.rebuild(); renderer.fit(); renderStatistics();
    requestAnimationFrame(() => $('#resultSection').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    notify(recovery ? `已恢复 ${width} × ${height} 格图纸，可以逐格改色` : '图纸生成完成啦', 'success', recovery ? 5000 : 3000);
  } catch (error) {
    notify(error.message || (recovery ? '图纸恢复失败，请核对格数后重试' : '生成失败，请重新生成'), 'error', 5000);
    $('#dirtyNotice').hidden = false;
    $('#dirtyNotice').textContent = recovery ? '恢复失败，可以重新识别或按普通图片生成' : '生成失败，请点击下方按钮重新生成';
  } finally {
    state.generating = false; button.disabled = false;
    $('#detectPatternGrid').disabled = false;
    button.lastChild.textContent = state.currentPattern ? ' 重新生成拼豆图纸' : ' 生成我的拼豆图纸';
    setTimeout(() => { if (!state.generating) $('#progressSection').hidden = true; }, 700);
  }
}

async function generate() {
  if (!state.image) return notify('请先上传一张图片', 'error');
  try {
    const adjusted = createAdjustedCanvas(state.image, state.transform, getColorStyleAdjustments(state.adjustments, state.colorStyle), 1800, state.crop);
    const { width, height } = state.currentSize;
    const pixels = getGridPixels(adjusted, width, height);
    await generatePreparedPattern({ pixels, width, height });
  } catch (error) {
    notify(error.message || '图片采样失败，请重新上传后再试', 'error', 5000);
  }
}

async function confirmPatternGridRecovery() {
  if (!pendingGridRecovery) return notify('识别结果已经失效，请重新识别', 'error');
  const width = Number($('#detectedGridWidth').value);
  const height = Number($('#detectedGridHeight').value);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 10 || width > 200 || height < 10 || height > 300) {
    return notify('横向需为10～200格，纵向需为10～300格', 'error');
  }
  const { imageData, detection, legend } = pendingGridRecovery;
  let pixels;
  try {
    pixels = samplePatternGrid(imageData, detection, width, height, { avoidCenterText: Boolean(legend) });
  } catch (error) {
    return notify(error.message || '逐格取色失败，请重新识别', 'error');
  }
  state.currentSize = { width, height };
  state.colorStyle = 'direct';
  if (state.maxColors < 48) state.maxColors = 48;
  syncRestoredChoices();
  $('#patternGridDialog').close();
  $('#patternRecoveryStatus').textContent = `已按 ${width} × ${height} 格恢复，可在制作图中改单格颜色`;
  await generatePreparedPattern({
    pixels,
    width,
    height,
    recovery: true,
    allowedPaletteIndices: legend?.paletteIndices || null,
  });
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
  pendingGridRecovery = null;
  $('#patternRecoveryStatus').textContent = '图片方向已变化，请重新识别网格';
  markDirty(); drawSourcePreview();
}

function setMode(mode) {
  if (mode !== 'pattern') clearSelectedCells({ redraw: false });
  state.previewMode = mode;
  state.viewport = { zoom: 1, x: 0, y: 0 };
  $$('.mode-switch button').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
  });
  renderer.rebuild(); renderer.fit();
  updateCellSelectionUi();
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
  const batchReplacement = Boolean(replacementCells?.length);
  $('#confirmReplaceColor').disabled = !target
    || (!batchReplacement && replacementTargetIndex === replacementSourceIndex);
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
  replacementCells = null;
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
  replacementCells = null;
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

function openReplaceSelectedCellsDialog() {
  if (state.previewMode !== 'pattern' || !state.currentPattern) return;
  const positions = [...state.selectedCellPositions].sort((a, b) => a - b);
  if (!positions.length) return notify('请先按住 Ctrl 逐格选择，或用 Shift 框选格子', 'error');

  replacementSourceIndex = null;
  replacementTargetIndex = null;
  replacementCell = null;
  replacementCells = positions;
  $('#replaceDialogTitle').textContent = '批量替换选中格子';
  $('#replaceCurrentLabel').textContent = '当前多选';
  $('#confirmReplaceColor').textContent = `确认替换这 ${number.format(positions.length)} 格`;
  $('#replaceCurrentSwatch').style.backgroundColor = '#8F7BD8';
  $('#replaceCurrentCode').textContent = `${number.format(positions.length)}格`;
  $('#replaceCurrentMeta').textContent = '所选格子可以来自不同颜色，将统一换成目标颜色';
  $('#replacementSearch').value = '';
  updateReplacementTarget();
  renderReplacementPalette();
  $('#replacementPalette').scrollTop = 0;
  $('#replaceColorDialog').showModal();
}

function recalculatePatternStatistics() {
  state.currentPattern.backgroundMask = getPatternBackgroundMask(
    state.currentPattern,
    state.currentPattern.sourcePixels,
  );
  state.statistics = calculateStatistics(
    state.currentPattern.indices,
    state.palette,
    state.currentPattern.backgroundMask,
  );
  return statisticsTotal(state.statistics) === countPatternBeans(
    state.currentPattern.indices,
    state.palette,
    state.currentPattern.backgroundMask,
  );
}

function updatePatternCropSummary() {
  const pattern = state.currentPattern;
  const summary = $('#patternCropSummary');
  const confirm = $('#confirmPatternCrop');
  if (!pattern) {
    summary.textContent = '当前还没有可以裁切的图纸。';
    summary.classList.add('error');
    confirm.disabled = true;
    return;
  }

  const width = Number($('#patternCropWidth').value);
  const height = Number($('#patternCropHeight').value);
  const valid = Number.isInteger(width)
    && Number.isInteger(height)
    && width >= 10
    && height >= 10
    && width <= pattern.width
    && height <= pattern.height;
  if (!valid) {
    summary.textContent = `目标宽度需为10～${pattern.width}格，目标高度需为10～${pattern.height}格。`;
    summary.classList.add('error');
    confirm.disabled = true;
    return;
  }
  if (width === pattern.width && height === pattern.height) {
    summary.textContent = '请把宽度或高度至少减小1格。';
    summary.classList.add('error');
    confirm.disabled = true;
    return;
  }

  const insets = getPatternCropInsets(pattern.width, pattern.height, width, height);
  summary.textContent = `将裁成 ${width} × ${height}格：左${insets.left}、右${insets.right}、上${insets.top}、下${insets.bottom}格。`;
  summary.classList.remove('error');
  confirm.disabled = false;
}

function openPatternCropDialog() {
  const pattern = state.currentPattern;
  if (!pattern) return notify('请先生成或恢复一张图纸', 'error');
  $('#patternCropCurrent').textContent = `${pattern.width} × ${pattern.height}格`;
  const width = $('#patternCropWidth');
  const height = $('#patternCropHeight');
  width.max = String(pattern.width);
  height.max = String(pattern.height);
  width.value = String(pattern.width);
  height.value = String(pattern.height);
  updatePatternCropSummary();
  $('#patternCropDialog').showModal();
}

function applyPatternCrop() {
  const currentPattern = state.currentPattern;
  if (!currentPattern) return notify('当前图纸已经失效，请重新生成', 'error');
  const width = Number($('#patternCropWidth').value);
  const height = Number($('#patternCropHeight').value);
  const snapshot = createPatternStateSnapshot(currentPattern);
  let result;
  try {
    result = cropPattern(currentPattern, width, height);
  } catch (error) {
    updatePatternCropSummary();
    return notify(error.message || '图纸裁切失败', 'error');
  }

  state.currentPattern = result.pattern;
  state.currentSize = { width, height };
  if (!recalculatePatternStatistics()) {
    state.currentPattern = currentPattern;
    state.currentSize = { width: currentPattern.width, height: currentPattern.height };
    recalculatePatternStatistics();
    return notify('裁切后的颜色统计校验失败，图纸没有被修改', 'error');
  }

  pushPatternSnapshot(state.patternUndoHistory, snapshot, PATTERN_UNDO_LIMIT);
  state.highlightedCode = null;
  state.viewport = { zoom: 1, x: 0, y: 0 };
  clearSelectedCells({ redraw: false });
  showAllColors = state.statistics.length > 8 && showAllColors;
  syncRestoredChoices();
  renderStatistics();
  renderer.rebuild();
  renderer.fit();
  $('#patternCropDialog').close();
  const { left, right, top, bottom } = result.insets;
  notify(`图纸已裁成 ${width} × ${height}格（左${left}、右${right}、上${top}、下${bottom}）`, 'success', 5000);
}

function undoLastPatternEdit() {
  const previousWidth = state.currentPattern?.width;
  const previousHeight = state.currentPattern?.height;
  if (!state.currentPattern || !restorePatternSnapshot(state.patternUndoHistory, state.currentPattern)) {
    notify('还没有可撤销的图纸修改');
    return;
  }
  if (!recalculatePatternStatistics()) {
    notify('撤销后的颜色统计校验失败，请重新生成图纸', 'error');
    return;
  }
  state.highlightedCode = null;
  clearSelectedCells({ redraw: false });
  const sizeChanged = previousWidth !== state.currentPattern.width || previousHeight !== state.currentPattern.height;
  if (sizeChanged) {
    state.currentSize = { width: state.currentPattern.width, height: state.currentPattern.height };
    syncRestoredChoices();
  }
  showAllColors = state.statistics.length > 8 && showAllColors;
  renderStatistics();
  renderer.rebuild();
  if (sizeChanged) renderer.fit();
  notify('已撤销上一次图纸修改', 'success');
}

function applyColorReplacement() {
  const target = state.palette[replacementTargetIndex];
  const batchReplacement = Boolean(replacementCells?.length);
  const source = Number.isInteger(replacementSourceIndex) ? state.palette[replacementSourceIndex] : null;
  if (!target || (!batchReplacement && (!source || source.index === target.index))) {
    return notify('请选择一种不同的替换颜色', 'error');
  }

  const cellReplacement = Boolean(replacementCell);
  const selectedCount = replacementCells?.length || 0;
  const snapshot = createPatternSnapshot(state.currentPattern);
  const replaced = batchReplacement
    ? replacePatternCells(state.currentPattern, replacementCells, target.index)
    : cellReplacement
      ? Number(replacePatternCell(state.currentPattern, replacementCell.position, target.index))
      : replacePatternColor(state.currentPattern, source.index, target.index);
  if (!replaced) return notify(batchReplacement ? '所选格子已经是这个颜色' : '当前格子的颜色没有发生变化', 'error');

  if (!recalculatePatternStatistics()) {
    if (snapshot) state.currentPattern.indices.set(snapshot);
    recalculatePatternStatistics();
    return notify('替换后的颜色统计校验失败，请重新生成图纸', 'error');
  }
  pushPatternSnapshot(state.patternUndoHistory, snapshot, PATTERN_UNDO_LIMIT);
  state.highlightedCode = batchReplacement || cellReplacement || target.excludeFromStatistics ? null : target.code;
  if (!target.manualOnly) rememberReplacementColor(target.code);
  if (batchReplacement) {
    state.selectedCellPositions.clear();
    state.selectionAnchorPosition = null;
    replacementCells = null;
    updateCellSelectionUi();
  }
  showAllColors = state.statistics.length <= 8 ? false : showAllColors;
  renderStatistics();
  renderer.rebuild();
  $('#replaceColorDialog').close();
  notify(
    batchReplacement
      ? `已将选中的 ${number.format(selectedCount)} 格统一换成 ${getColorDisplayLabel(target)}`
      : cellReplacement
      ? `第 ${replacementCell.x + 1} 列、第 ${replacementCell.y + 1} 行已换成 ${getColorDisplayLabel(target)}`
      : `已将 ${getColorDisplayCode(source)} 替换为 ${getColorDisplayLabel(target)}，共 ${number.format(replaced)}格`,
    'success',
  );
}

function replaceCellWithBlank(cell) {
  const blank = state.palette.find((color) => color.manualOnly);
  if (!blank) return notify('纯白留白加载失败，请刷新页面', 'error');
  if (cell.colorIndex === blank.index) return notify('这个格子已经是纯白留白');
  const snapshot = createPatternSnapshot(state.currentPattern);
  if (!replacePatternCell(state.currentPattern, cell.position, blank.index)) {
    return notify('当前格子没有发生变化', 'error');
  }

  if (!recalculatePatternStatistics()) {
    if (snapshot) state.currentPattern.indices.set(snapshot);
    recalculatePatternStatistics();
    return notify('快捷留白后的颜色统计校验失败，请重新生成图纸', 'error');
  }
  pushPatternSnapshot(state.patternUndoHistory, snapshot, PATTERN_UNDO_LIMIT);

  state.highlightedCode = null;
  renderStatistics();
  renderer.rebuild();
  notify(`第 ${cell.x + 1} 列、第 ${cell.y + 1} 行已快速留白`, 'success');
}

function bindUpload() {
  const zone = $('#uploadZone'), input = $('#fileInput'), patternInput = $('#patternFileInput');
  const open = () => input.click();
  zone.addEventListener('click', (event) => { if (event.target !== input) open(); });
  zone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  $('#replaceImage').addEventListener('click', (event) => { event.stopPropagation(); open(); });
  input.addEventListener('change', () => { loadFile(input.files[0]); input.value = ''; });
  ['dragenter', 'dragover'].forEach((type) => zone.addEventListener(type, (event) => { event.preventDefault(); zone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach((type) => zone.addEventListener(type, (event) => { event.preventDefault(); zone.classList.remove('drag-over'); }));
  zone.addEventListener('drop', (event) => loadFile(event.dataTransfer.files[0]));
  $('#uploadPatternImage').addEventListener('click', () => patternInput.click());
  patternInput.addEventListener('change', async () => {
    const file = patternInput.files[0];
    patternInput.value = '';
    if (await loadFile(file)) await detectExistingPatternGrid();
  });
}

function bindLinkImport() {
  $('#linkImportForm').addEventListener('submit', resolveLinkImport);
  $('#cancelLinkImages').addEventListener('click', () => $('#linkImageDialog').close());
  $('#linkImageGrid').addEventListener('click', (event) => {
    const button = event.target.closest('.link-image-card');
    if (!button) return;
    importLinkedImage(Number(button.dataset.linkImageIndex));
  });
}

function bindProjectFiles() {
  const input = $('#projectFileInput');
  $('#openProjectButton').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    await openProject(file);
  });
  $('#saveProjectButton').addEventListener('click', openSaveProjectDialog);
  $('#saveProjectResultButton').addEventListener('click', openSaveProjectDialog);
  $('#cancelSaveProject').addEventListener('click', () => $('#saveProjectDialog').close());
  $('#saveProjectForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const saved = await saveProject($('#projectNameInput').value);
    if (saved) $('#saveProjectDialog').close();
  });
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
  onConfirm: (crop) => {
    state.crop = crop;
    pendingGridRecovery = null;
    $('#patternRecoveryStatus').textContent = '裁剪已更新，可以开始识别网格';
    $('#cropBadge').hidden = false;
    markDirty();
    drawSourcePreview();
  },
});

function bindDialogs() {
  $('#cropButton').addEventListener('click', () => cropper.open(state.imageUrl, state.crop));
  $('#openPatternCrop').addEventListener('click', openPatternCropDialog);
  $('#cancelPatternCrop').addEventListener('click', () => $('#patternCropDialog').close());
  $('#patternCropWidth').addEventListener('input', updatePatternCropSummary);
  $('#patternCropHeight').addEventListener('input', updatePatternCropSummary);
  $('#confirmPatternCrop').addEventListener('click', applyPatternCrop);
  $('#detectPatternGrid').addEventListener('click', detectExistingPatternGrid);
  $('#cancelPatternGrid').addEventListener('click', () => $('#patternGridDialog').close());
  $('#confirmPatternGrid').addEventListener('click', confirmPatternGridRecovery);
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
  watermarkText.value = DEFAULT_TILED_WATERMARK;
  watermarkEnabled.addEventListener('change', syncWatermarkSetting);
  syncWatermarkSetting();

  $$('.mode-switch button').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $('#toggleColors').addEventListener('click', () => { showAllColors = !showAllColors; renderColorList(); });
  $('#copyColors').addEventListener('click', copyList);
  $('#replaceSelectedColor').addEventListener('click', openReplaceColorDialog);
  $('#exportHighlightedColor').addEventListener('click', async () => {
    const button = $('#exportHighlightedColor');
    const highlighted = state.statistics.find((item) => item.code === state.highlightedCode);
    if (!highlighted) return notify('请先从用豆清单中选择一种颜色', 'error');
    button.disabled = true;
    try {
      const result = await exportHighlightedColorPng(
        state.currentPattern,
        state.palette,
        state.statistics,
        highlighted.code,
        { tiledWatermarkText: getExportWatermarkText() },
      );
      notify(
        result.reduced
          ? `${highlighted.code} 定位图已按设备能力安全导出，共 ${number.format(highlighted.count)}颗`
          : `${highlighted.code} 分色定位图已保存，共 ${number.format(highlighted.count)}颗`,
        'success',
        5000,
      );
    } catch (error) {
      notify(error.message || '分色定位图导出失败，请重试', 'error', 5000);
    } finally {
      renderColorList();
    }
  });
  $('#exportAllHighlightedColors').addEventListener('click', async () => {
    if (!state.statistics.length) return notify('当前图纸没有可导出的颜色', 'error');
    const button = $('#exportAllHighlightedColors');
    exportingAllColors = true;
    renderColorList();
    try {
      const result = await exportAllHighlightedColorsZip(
        state.currentPattern,
        state.palette,
        state.statistics,
        {
          tiledWatermarkText: getExportWatermarkText(),
          onProgress: ({ completed, total, target }) => {
            button.textContent = `正在生成 ${completed}/${total}：${target.code}`;
          },
        },
      );
      notify(`已导出全部 ${result.count} 种颜色的分色定位图（ZIP）`, 'success', 6000);
    } catch (error) {
      notify(error.message || '全部分色定位图导出失败，请重试', 'error', 6000);
    } finally {
      exportingAllColors = false;
      renderColorList();
    }
  });
  $('#replaceSelectedCells').addEventListener('click', openReplaceSelectedCellsDialog);
  $('#clearSelectedCells').addEventListener('click', () => clearSelectedCells());
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

buildChoices(); bindUpload(); bindLinkImport(); bindProjectFiles(); bindChoices(); bindDialogs(); bindResults();
$$('[data-transform]').forEach((button) => button.addEventListener('click', () => changeTransform(button.dataset.transform)));
$('#generateButton').addEventListener('click', generate);
window.addEventListener('resize', () => { if (state.image) drawSourcePreview(); });
document.addEventListener('keydown', (event) => {
  const target = event.target;
  const editingText = target instanceof HTMLElement
    && (target.matches('input, textarea, [contenteditable="true"]') || target.isContentEditable);
  const undoShortcut = (event.ctrlKey || event.metaKey)
    && !event.shiftKey
    && !event.altKey
    && event.key.toLowerCase() === 'z';
  if (undoShortcut && !editingText && !$('#replaceColorDialog').open) {
    event.preventDefault();
    undoLastPatternEdit();
    return;
  }
  if (event.key === 'Escape' && !$('#replaceColorDialog').open) {
    if (state.selectedCellPositions.size) {
      clearSelectedCells();
    } else if (state.highlightedCode) {
      state.highlightedCode = null; renderColorList(); renderer.rebuild();
    }
  }
});
renderer.resize();

if (state.palette.filter((color) => !color.manualOnly).length !== 221) notify('MARD 221 色卡加载不完整，请刷新页面', 'error');
