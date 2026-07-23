import test from 'node:test';
import assert from 'node:assert/strict';
import { preferredCell } from '../src/export/pngExporter.js';

test('高清导出的每格像素明显高于预览', () => {
  assert.equal(preferredCell({ width: 30 }, 'pattern'), 64);
  assert.equal(preferredCell({ width: 60 }, 'pattern'), 44);
  assert.equal(preferredCell({ width: 80 }, 'pattern'), 36);
  assert.equal(preferredCell({ width: 80 }, 'effect'), 30);
});
