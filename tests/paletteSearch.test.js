import test from 'node:test';
import assert from 'node:assert/strict';
import { rgbToLab } from '../src/color/colorSpace.js';
import { findNearestPaletteIndex } from '../src/color/paletteSearch.js';

const palette = [
  { code: 'H7', lab: rgbToLab(0, 0, 0) },
  { code: 'H2', lab: rgbToLab(255, 255, 255) },
  { code: 'C20', lab: rgbToLab(26, 132, 209) },
];

test('CIEDE2000精确阶段可以匹配色卡自身颜色', () => {
  assert.equal(findNearestPaletteIndex(rgbToLab(26, 132, 209), palette), 2);
});

test('颜色上限重映射时只在允许的候选中选择', () => {
  assert.equal(findNearestPaletteIndex(rgbToLab(250, 250, 250), palette, [0, 2]), 2);
});
