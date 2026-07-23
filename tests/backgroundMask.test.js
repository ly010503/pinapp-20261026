import test from 'node:test';
import assert from 'node:assert/strict';
import { createWhiteBackgroundMask } from '../src/pattern/backgroundMask.js';

const palette = [
  { code: 'H2', rgb: [254, 255, 255] },
  { code: 'H7', rgb: [0, 0, 0] },
];

test('只隐藏四周背景白色，保留轮廓内主体白色', () => {
  const width = 7, height = 7;
  const indices = new Uint8Array(width * height);
  for (let y = 1; y <= 5; y += 1) {
    for (let x = 1; x <= 5; x += 1) {
      if (x === 1 || x === 5 || y === 1 || y === 5) indices[y * width + x] = 1;
    }
  }
  const mask = createWhiteBackgroundMask({ width, height, indices }, palette);
  assert.equal(mask[0], 1, '图纸角落背景应隐藏编号');
  assert.equal(mask[3 * width + 3], 0, '主体内部白色应保留编号');
  assert.equal(mask[width + 1], 0, '主体轮廓也不能视为白色背景');
});

test('图纸四周不是白色时不创建背景遮罩', () => {
  const indices = new Uint8Array(25).fill(1);
  const mask = createWhiteBackgroundMask({ width: 5, height: 5, indices }, palette);
  assert.equal(mask.some(Boolean), false);
});
