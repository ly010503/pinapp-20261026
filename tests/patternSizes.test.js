import test from 'node:test';
import assert from 'node:assert/strict';
import { PATTERN_SIZES, BEAD_DIAMETER_MM, physicalSizeCm } from '../src/state/config.js';

test('预设尺寸的总豆数正确', () => {
  const totals = Object.fromEntries(PATTERN_SIZES.map((size) => [`${size.width}x${size.height}`, size.width * size.height]));
  assert.deepEqual(totals, {
    '30x30': 900,
    '40x60': 2400,
    '60x90': 5400,
    '80x120': 9600,
  });
});

test('成品尺寸按每颗豆子直径2.6毫米计算', () => {
  assert.equal(BEAD_DIAMETER_MM, 2.6);
  assert.equal(physicalSizeCm(60), 15.6);
  assert.equal(physicalSizeCm(90), 23.4);
});
