import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutlineMask, findOutlinePaletteIndex } from '../src/pattern/outlineProtection.js';

function makePixels(width, height, rgb) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let position = 0; position < width * height; position += 1) {
    pixels.set([...rgb, 255], position * 4);
  }
  return pixels;
}

test('高对比黑色轮廓在缩小后仍被识别', () => {
  const width = 5, height = 5;
  const pixels = makePixels(width, height, [238, 225, 202]);
  for (let y = 0; y < height; y += 1) {
    pixels.set([112, 96, 82, 255], (y * width + 2) * 4);
  }

  const mask = createOutlineMask(pixels, width, height);
  assert.equal(mask[2 * width + 2], 1, '被肤色稀释的深色轮廓应受保护');
  assert.equal(mask[2 * width], 0, '普通浅色区域不应被改成黑色');
});

test('深蓝色块不会被误判成黑色轮廓', () => {
  const width = 3, height = 3;
  const pixels = makePixels(width, height, [245, 245, 245]);
  pixels.set([20, 70, 160, 255], (width + 1) * 4);

  const mask = createOutlineMask(pixels, width, height);
  assert.equal(mask[width + 1], 0);
});

test('优先使用MARD H7作为轮廓黑色', () => {
  const palette = [
    { code: 'H6', rgb: [47, 43, 47] },
    { code: 'H7', rgb: [0, 0, 0] },
  ];
  assert.equal(findOutlinePaletteIndex(palette), 1);
});
