import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePalette } from '../src/color/colorMatcher.js';
import { detectPatternLegend } from '../src/image/patternLegendDetector.js';

const palette = preparePalette([
  { code: 'H7', hex: '#000000' },
  { code: 'C13', hex: '#CDE8FF' },
  { code: 'C29', hex: '#34488E' },
  { code: 'D6', hex: '#AC7BDE' },
  { code: 'F23', hex: '#F67E66' },
  { code: 'M10', hex: '#C5B2BC' },
]);

function createImage(withLegend) {
  const width = 280;
  const height = 210;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let index = 3; index < data.length; index += 4) data[index] = 255;
  const fill = (left, top, right, bottom, rgb) => {
    for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = rgb[0]; data[offset + 1] = rgb[1]; data[offset + 2] = rgb[2];
    }
  };
  if (withLegend) {
    palette.forEach((color, index) => fill(24 + index * 32, 169, 48 + index * 32, 193, color.rgb));
  }
  return { width, height, data };
}

const detection = {
  cellWidth: 10,
  cellHeight: 10,
  bounds: { left: 20, right: 260, top: 20, bottom: 150 },
  rawBounds: { left: 20, right: 260, top: 20, bottom: 150 },
};

test('检测到规则色块图例时返回受限色号集合', () => {
  const legend = detectPatternLegend(createImage(true), detection, palette);
  assert.ok(legend);
  assert.equal(legend.side, 'bottom');
  assert.equal(legend.swatchCount, 6);
  assert.deepEqual(legend.paletteCodes, ['H7', 'C13', 'C29', 'D6', 'F23', 'M10']);
  assert.ok(legend.confidence >= 0.72);
});

test('没有图例时返回 null 并保持原颜色识别路径', () => {
  assert.equal(detectPatternLegend(createImage(false), detection, palette), null);
});
