import { drawEffect, drawPatternSheet } from '../canvas/patternPainter.js';

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function preferredCell(pattern, type) {
  if (type === 'effect') return pattern.width <= 30 ? 32 : pattern.width <= 40 ? 26 : pattern.width <= 60 ? 20 : 16;
  return pattern.width <= 30 ? 40 : pattern.width <= 40 ? 32 : pattern.width <= 60 ? 26 : 22;
}

function safeCell(pattern, statistics, type) {
  const preferred = preferredCell(pattern, type);
  const memory = navigator.deviceMemory || 4;
  const maxPixels = memory <= 2 ? 14_000_000 : memory <= 4 ? 24_000_000 : 40_000_000;
  let cell = preferred;
  while (cell >= 12) {
    if (type === 'effect') {
      const padding = Math.max(18, cell * 2);
      const width = pattern.width * cell + padding * 2;
      const height = pattern.height * cell + padding * 2;
      if (width * height <= maxPixels) return { cell, reduced: cell < preferred };
    } else {
      const width = pattern.width * cell + cell * 6;
      const columns = Math.max(3, Math.floor(width / Math.max(70, cell * 4)));
      const legendRows = Math.ceil(statistics.length / columns);
      const height = pattern.height * cell + legendRows * Math.max(44, cell * 2.2) + cell * 12;
      if (width * height <= maxPixels) return { cell, reduced: cell < preferred };
    }
    cell -= 2;
  }
  return { cell: 12, reduced: true };
}

async function toBlob(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG 生成失败，请尝试较小的图纸尺寸');
  return blob;
}

export async function exportEffectPng(pattern, palette) {
  const selection = safeCell(pattern, [], 'effect');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  drawEffect(ctx, pattern, palette, { cell: selection.cell, background: '#FFFDF8' });
  const blob = await toBlob(canvas);
  download(blob, `拼豆效果图-${pattern.width}x${pattern.height}.png`);
  return { blob, width: canvas.width, height: canvas.height, ...selection };
}

export async function exportPatternPng(pattern, palette, statistics) {
  const selection = safeCell(pattern, statistics, 'pattern');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  drawPatternSheet(ctx, pattern, palette, statistics, { cell: selection.cell });
  const blob = await toBlob(canvas);
  download(blob, `拼豆制作图-${pattern.width}x${pattern.height}.png`);
  return { blob, width: canvas.width, height: canvas.height, ...selection };
}
