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

test('主体白色与背景通过开口相连时仍保留主体色号', () => {
  const width = 9, height = 9;
  const indices = new Uint8Array(width * height);

  // 黑色轮廓顶部留出一个开口，使内部白色与四周背景直接连通。
  for (let y = 2; y <= 7; y += 1) {
    indices[y * width + 2] = 1;
    indices[y * width + 6] = 1;
  }
  for (let x = 2; x <= 6; x += 1) indices[7 * width + x] = 1;
  indices[2 * width + 2] = 1;
  indices[2 * width + 6] = 1;

  const mask = createWhiteBackgroundMask({ width, height, indices }, palette);
  assert.equal(mask[0], 1, '四周白色背景应隐藏编号');
  assert.equal(mask[4 * width + 4], 0, '主体内部白色即使连到背景也应保留编号');
  assert.equal(mask[1 * width + 4], 1, '主体上方的白色背景仍应隐藏编号');
});
