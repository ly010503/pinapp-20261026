import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePaletteIndices } from '../src/pattern/paletteLimit.js';

test('颜色数量会自动少于上限', () => {
  const counts = Uint32Array.from([700, 200, 80, 15, 1, 1, 1, 1]);
  const selected = choosePaletteIndices(counts, 8, 999);
  assert.deepEqual(selected, [0, 1, 2, 3]);
});

test('颜色自动识别不会超过用户设置的上限', () => {
  const counts = Uint32Array.from([30, 25, 20, 15, 10, 8, 7, 6]);
  const selected = choosePaletteIndices(counts, 5);
  assert.equal(selected.length, 5);
});
