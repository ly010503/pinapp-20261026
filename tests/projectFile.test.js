import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  createProjectDocument,
  parseProjectDocument,
  serializeProjectDocument,
} from '../src/project/projectFile.js';

const paletteCodes = ['A1', 'B2', '__BLANK__'];

function createExampleDocument() {
  return createProjectDocument({
    image: {
      name: 'example.png',
      type: 'image/png',
      size: 3,
      width: 2,
      height: 1,
      lastModified: 123,
      dataUrl: 'data:image/png;base64,AQID',
    },
    settings: {
      crop: { x: 0, y: 0, width: 2, height: 1 },
      transform: { rotation: 90, flipH: true, flipV: false },
      adjustments: { brightness: 0, contrast: 0, saturation: 0, sharpen: 10, smoothing: 10 },
      colorStyle: 'vivid',
      maxColors: 24,
      currentSize: { width: 10, height: 10 },
      dirty: false,
      options: { reduceIsolated: true, mergeColors: true },
    },
    pattern: {
      width: 2,
      height: 1,
      indices: new Uint8Array([0, 2]),
      sourcePixels: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]),
    },
    preferences: {
      previewMode: 'pattern',
      recentColors: ['B2'],
      watermark: { enabled: true, text: '@测试水印' },
    },
    paletteCodes,
  });
}

test('工程文件能完整恢复图纸和编辑设置，但不包含撤销历史', () => {
  const text = serializeProjectDocument(createExampleDocument());
  const restored = parseProjectDocument(text, { paletteCodes });

  assert.deepEqual([...restored.pattern.indices], [0, 2]);
  assert.deepEqual([...restored.pattern.sourcePixels], [1, 2, 3, 255, 4, 5, 6, 255]);
  assert.equal(restored.settings.transform.rotation, 90);
  assert.equal(restored.preferences.watermark.text, '@测试水印');
  assert.equal('patternUndoHistory' in restored, false);
});

test('色卡顺序变化后按色号重新映射图纸', () => {
  const text = serializeProjectDocument(createExampleDocument());
  const restored = parseProjectDocument(text, { paletteCodes: ['__BLANK__', 'B2', 'A1'] });
  assert.deepEqual([...restored.pattern.indices], [2, 0]);
});

test('拒绝未知版本和长度损坏的图纸', () => {
  const unknown = createExampleDocument();
  unknown.version = PROJECT_VERSION + 1;
  assert.throws(
    () => parseProjectDocument(JSON.stringify(unknown), { paletteCodes }),
    /版本暂不支持/,
  );

  const broken = createExampleDocument();
  broken.pattern.indices = 'AA==';
  assert.throws(
    () => parseProjectDocument(JSON.stringify(broken), { paletteCodes }),
    /长度不匹配/,
  );
});

test('工程格式标识保持稳定', () => {
  assert.equal(createExampleDocument().format, PROJECT_FORMAT);
});
