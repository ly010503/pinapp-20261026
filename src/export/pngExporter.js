import { drawEffect, drawPatternSheet } from '../canvas/patternPainter.js';

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function preferredCell(pattern, type) {
  if (type === 'effect') return pattern.width <= 30 ? 48 : pattern.width <= 40 ? 42 : pattern.width <= 60 ? 34 : 30;
  return pattern.width <= 30 ? 64 : pattern.width <= 40 ? 54 : pattern.width <= 60 ? 44 : 36;
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

async function renderWithFallback(draw, selection) {
  let cell = selection.cell;
  let lastError;
  while (cell >= 12) {
    const canvas = document.createElement('canvas');
    try {
      const ctx = canvas.getContext('2d');
      draw(ctx, cell);
      const blob = await toBlob(canvas);
      return { blob, width: canvas.width, height: canvas.height, cell, reduced: selection.reduced || cell < selection.cell };
    } catch (error) {
      lastError = error;
      canvas.width = 1; canvas.height = 1;
      cell -= 4;
    }
  }
  throw lastError || new Error('PNG 生成失败，请尝试较小的图纸尺寸');
}

export async function exportEffectPng(pattern, palette) {
  const selection = safeCell(pattern, [], 'effect');
  const result = await renderWithFallback(
    (ctx, cell) => drawEffect(ctx, pattern, palette, { cell, background: '#FFFDF8' }),
    selection,
  );
  download(result.blob, `拼豆高清效果图-${pattern.width}x${pattern.height}.png`);
  return result;
}

export async function exportPatternPng(pattern, palette, statistics) {
  const selection = safeCell(pattern, statistics, 'pattern');
  const result = await renderWithFallback(
    (ctx, cell) => drawPatternSheet(ctx, pattern, palette, statistics, { cell }),
    selection,
  );
  download(result.blob, `拼豆高清制作图-${pattern.width}x${pattern.height}.png`);
  return result;
}
