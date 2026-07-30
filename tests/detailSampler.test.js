import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDetailPreservingColor } from '../src/image/detailSampler.js';

function samples(colors) {
  return new Uint8Array(colors.flat());
}

test('深色底上的少量白色笔画不会被平均成灰黑色', () => {
  const color = selectDetailPreservingColor(samples([
    ...Array(12).fill([12, 12, 12]),
    ...Array(4).fill([245, 245, 245]),
  ]));
  assert.ok(color[0] > 190 && color[1] > 190 && color[2] > 190);
});

test('浅色底上的少量黑色轮廓不会被平均消失', () => {
  const color = selectDetailPreservingColor(samples([
    ...Array(12).fill([245, 245, 245]),
    ...Array(4).fill([10, 10, 10]),
  ]));
  assert.ok(color[0] < 65 && color[1] < 65 && color[2] < 65);
});

test('均匀色块保持原色', () => {
  const color = selectDetailPreservingColor(samples(Array(16).fill([210, 72, 98])));
  assert.deepEqual(color, [210, 72, 98]);
});

test('小面积高彩度蓝色细节得到保护', () => {
  const color = selectDetailPreservingColor(samples([
    ...Array(12).fill([130, 130, 130]),
    ...Array(4).fill([20, 90, 230]),
  ]));
  assert.ok(color[2] - color[0] > 90);
});
