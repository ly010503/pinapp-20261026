import test from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_STEP, getCoordinateValues } from '../src/canvas/patternPainter.js';

test('制作图使用 5×5 分组辅助线', () => {
  assert.equal(GUIDE_STEP, 5);
  assert.deepEqual(getCoordinateValues(30), [1, 5, 10, 15, 20, 25, 30]);
  assert.deepEqual(getCoordinateValues(12), [1, 5, 10]);
});
