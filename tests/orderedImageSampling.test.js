import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandForegroundBounds,
  findForegroundBounds,
  getContainedDrawRect,
  summarizeGridSamples,
} from '../src/image/imageProcessor.js';

function createPixels(width, height, rgb = [255, 255, 255]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let position = 0; position < width * height; position += 1) {
    pixels.set([...rgb, 255], position * 4);
  }
  return pixels;
}

test('有序模式可以裁掉素材自带的大块纯白边', () => {
  const width = 20, height = 30;
  const pixels = createPixels(width, height);
  for (let y = 8; y <= 24; y += 1) {
    for (let x = 5; x <= 14; x += 1) pixels.set([40, 40, 40, 255], (y * width + x) * 4);
  }
  assert.deepEqual(findForegroundBounds(pixels, width, height), {
    x: 5,
    y: 8,
    width: 10,
    height: 17,
  });
  const expanded = expandForegroundBounds({ x: 5, y: 8, width: 10, height: 17 }, width, height);
  assert.ok(expanded.x < 5 && expanded.y < 8, '主体周围仍需保留安全边距');
});

test('主体放入网格时保持比例并保留两格边距', () => {
  const rect = getContainedDrawRect({ x: 0, y: 0, width: 50, height: 100 }, 280, 416, 8);
  assert.equal(rect.height, 400);
  assert.equal(rect.width, 200);
  assert.equal(rect.y, 8);
});

test('多采样使用真实主填充色并单独记录暗线覆盖率', () => {
  const data = createPixels(4, 4, [220, 160, 120]);
  for (let position = 0; position < 4; position += 1) data.set([0, 0, 0, 255], position * 4);
  const result = summarizeGridSamples({ data, width: 4, height: 4 }, 1, 1);
  assert.deepEqual([...result.pixels.slice(0, 3)], [220, 160, 120]);
  assert.equal(result.darkCoverage[0], 64, '四分之一暗线覆盖率应与填充色分开保存');
});

test('有序取样不会把三个通道中位数组合成原图不存在的颜色', () => {
  const data = createPixels(4, 4);
  const colors = [
    ...Array(6).fill([230, 35, 35]),
    ...Array(5).fill([35, 230, 35]),
    ...Array(5).fill([35, 35, 230]),
  ];
  colors.forEach((rgb, position) => data.set([...rgb, 255], position * 4));
  const result = summarizeGridSamples({ data, width: 4, height: 4 }, 1, 1);
  assert.deepEqual([...result.pixels.slice(0, 3)], [230, 35, 35], '应选择格内最有代表性的真实样本色');
});

test('格内连续暗线会记录跨格方向，孤立暗点只标记为细节', () => {
  const lineData = createPixels(4, 4, [230, 200, 160]);
  for (let y = 0; y < 4; y += 1) lineData.set([0, 0, 0, 255], (y * 4 + 1) * 4);
  const line = summarizeGridSamples({ data: lineData, width: 4, height: 4 }, 1, 1);
  assert.equal(line.structureEdges[0], 5, '竖线应同时连接格子的上边和下边');
  assert.equal(line.detailMask[0], 1);

  const dotData = createPixels(4, 4, [230, 200, 160]);
  dotData.set([0, 0, 0, 255], (1 * 4 + 1) * 4);
  const dot = summarizeGridSamples({ data: dotData, width: 4, height: 4 }, 1, 1);
  assert.equal(dot.structureEdges[0], 0, '格子内部的孤立暗点不能伪装成跨格线条');
  assert.equal(dot.detailMask[0], 1);
});

test('整格纯黑填充会记录满覆盖率，避免后续误配成H16', () => {
  const data = createPixels(4, 4, [20, 20, 20]);
  const result = summarizeGridSamples({ data, width: 4, height: 4 }, 1, 1);
  assert.equal(result.darkCoverage[0], 255);
  assert.equal(result.structureEdges[0], 0, '纯黑填充不是需要推断走向的细线');
});
