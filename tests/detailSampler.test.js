import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceGridDetails } from '../src/image/detailSampler.js';

function makeGrid(width, height, color) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.set([...color, 255], offset);
  }
  return pixels;
}

function setPixel(pixels, width, x, y, color) {
  pixels.set([...color, 255], (y * width + x) * 4);
}

function getPixel(pixels, width, x, y) {
  return [...pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
}

test('均匀色块保持原色', () => {
  const pixels = makeGrid(3, 3, [210, 72, 98]);
  assert.deepEqual(enhanceGridDetails(pixels, 3, 3), pixels);
});

test('只增强当前亮格，不向周围扩散', () => {
  const pixels = makeGrid(3, 3, [40, 40, 40]);
  setPixel(pixels, 3, 1, 1, [135, 135, 135]);
  setPixel(pixels, 3, 1, 2, [220, 220, 220]);
  const result = enhanceGridDetails(pixels, 3, 3);
  assert.ok(getPixel(result, 3, 1, 1)[0] > 135);
  assert.deepEqual(getPixel(result, 3, 0, 1), [40, 40, 40, 255]);
});

test('只增强当前暗格，不加粗到周围格子', () => {
  const pixels = makeGrid(3, 3, [220, 220, 220]);
  setPixel(pixels, 3, 1, 1, [110, 110, 110]);
  setPixel(pixels, 3, 1, 2, [40, 40, 40]);
  const result = enhanceGridDetails(pixels, 3, 3);
  assert.ok(getPixel(result, 3, 1, 1)[0] < 110);
  assert.deepEqual(getPixel(result, 3, 1, 0), [220, 220, 220, 255]);
});

test('增强结果不会超过邻域已有的颜色范围', () => {
  const pixels = makeGrid(3, 3, [80, 120, 160]);
  setPixel(pixels, 3, 1, 1, [170, 60, 220]);
  const result = getPixel(enhanceGridDetails(pixels, 3, 3), 3, 1, 1);
  assert.ok(result[0] >= 80 && result[0] <= 170);
  assert.ok(result[1] >= 60 && result[1] <= 120);
  assert.ok(result[2] >= 160 && result[2] <= 220);
});
