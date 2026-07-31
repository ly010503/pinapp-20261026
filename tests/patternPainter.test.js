import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GUIDE_STEP,
  getCellCodeFontSize,
  getCoordinateValues,
} from '../src/canvas/patternPainter.js';

test('制作图使用 5×5 分组辅助线', () => {
  assert.equal(GUIDE_STEP, 5);
  assert.deepEqual(getCoordinateValues(30), [1, 5, 10, 15, 20, 25, 30]);
  assert.deepEqual(getCoordinateValues(12), [1, 5, 10]);
});

test('常用尺寸保持原字号，超过150格才使用大字号', () => {
  assert.equal(getCellCodeFontSize(36), 14);
  assert.equal(getCellCodeFontSize(48), 19);
  assert.equal(getCellCodeFontSize(48, true), 24);
  assert.ok(getCellCodeFontSize(48, true) > getCellCodeFontSize(48));
});
