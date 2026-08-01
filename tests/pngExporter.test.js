import test from 'node:test';
import assert from 'node:assert/strict';
import {
  highlightedExportFileName,
  preferredCell,
  selectExportCell,
} from '../src/export/pngExporter.js';

test('高清导出的每格像素明显高于预览', () => {
  assert.equal(preferredCell({ width: 30 }, 'pattern'), 64);
  assert.equal(preferredCell({ width: 60 }, 'pattern'), 44);
  assert.equal(preferredCell({ width: 80 }, 'pattern'), 36);
  assert.equal(preferredCell({ width: 80 }, 'effect'), 30);
});

test('150格及以下保持原来的制作图导出规格', () => {
  assert.equal(preferredCell({ width: 70, height: 104 }, 'pattern'), 36);
  assert.equal(preferredCell({ width: 104, height: 104 }, 'pattern'), 36);
  assert.equal(preferredCell({ width: 70, height: 150 }, 'pattern'), 36);
});

test('200×200制作图优先使用超清每格像素', () => {
  const pattern = { width: 200, height: 200 };
  assert.equal(preferredCell(pattern, 'pattern'), 48);
  assert.equal(selectExportCell(pattern, [], 'pattern', 8).cell, 48);
});

test('只有任一边超过150格才启用超清规格', () => {
  assert.equal(preferredCell({ width: 70, height: 150 }, 'pattern'), 36);
  assert.equal(preferredCell({ width: 70, height: 151 }, 'pattern'), 48);
});

test('超大图会在设备预算内降档且不超过浏览器常见边长限制', () => {
  const pattern = { width: 200, height: 300 };
  const selection = selectExportCell(pattern, new Array(60).fill({}), 'pattern', 4);
  assert.ok(selection.cell >= 24);
  assert.ok(selection.cell < preferredCell(pattern, 'pattern'));
});

test('分色定位图文件名包含色号和图纸尺寸', () => {
  assert.equal(
    highlightedExportFileName('C20', { width: 70, height: 104 }),
    '拼豆分色定位图-C20-70x104.png',
  );
});
