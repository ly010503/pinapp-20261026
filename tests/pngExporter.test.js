import test from 'node:test';
import assert from 'node:assert/strict';
import { preferredCell, selectExportCell } from '../src/export/pngExporter.js';

test('高清导出的每格像素明显高于预览', () => {
  assert.equal(preferredCell({ width: 30 }, 'pattern'), 64);
  assert.equal(preferredCell({ width: 60 }, 'pattern'), 48);
  assert.equal(preferredCell({ width: 80 }, 'pattern'), 42);
  assert.equal(preferredCell({ width: 80 }, 'effect'), 30);
});

test('200×200制作图优先使用超清每格像素', () => {
  const pattern = { width: 200, height: 200 };
  assert.equal(preferredCell(pattern, 'pattern'), 48);
  assert.equal(selectExportCell(pattern, [], 'pattern', 8).cell, 48);
});

test('超大图会在设备预算内降档且不超过浏览器常见边长限制', () => {
  const pattern = { width: 200, height: 300 };
  const selection = selectExportCell(pattern, new Array(60).fill({}), 'pattern', 4);
  assert.ok(selection.cell >= 24);
  assert.ok(selection.cell < preferredCell(pattern, 'pattern'));
});
