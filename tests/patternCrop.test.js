import test from 'node:test';
import assert from 'node:assert/strict';
import { cropPattern, getPatternCropInsets } from '../src/pattern/patternCrop.js';

function makePattern(width, height) {
  const indices = new Uint8Array(width * height);
  const sourcePixels = new Uint8ClampedArray(width * height * 4);
  const backgroundMask = new Uint8Array(width * height);
  for (let position = 0; position < indices.length; position += 1) {
    indices[position] = position;
    backgroundMask[position] = position % 2;
    sourcePixels.fill(position, position * 4, position * 4 + 4);
  }
  return { width, height, indices, sourcePixels, backgroundMask };
}

test('居中裁切时奇数差值由左边和上边多裁一格', () => {
  assert.deepEqual(getPatternCropInsets(7, 6, 4, 3), {
    left: 2,
    right: 1,
    top: 2,
    bottom: 1,
  });
});

test('裁切只保留目标区域的图纸颜色和原始采样数据', () => {
  const original = makePattern(7, 6);
  const result = cropPattern(original, 4, 3);

  assert.equal(result.pattern.width, 4);
  assert.equal(result.pattern.height, 3);
  assert.deepEqual([...result.pattern.indices], [16, 17, 18, 19, 23, 24, 25, 26, 30, 31, 32, 33]);
  assert.deepEqual([...result.pattern.backgroundMask], [0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1]);
  assert.deepEqual([...result.pattern.sourcePixels.slice(0, 8)], [16, 16, 16, 16, 17, 17, 17, 17]);
  assert.equal(original.width, 7);
  assert.equal(original.indices.length, 42);
});

test('裁切不允许放大图纸或保持完全相同尺寸', () => {
  const pattern = makePattern(20, 20);
  assert.throws(() => cropPattern(pattern, 21, 20), /不能大于/);
  assert.throws(() => cropPattern(pattern, 20, 20), /至少小一行或一列/);
});
