import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrderedColorPattern } from '../src/pattern/orderedColorCleanup.js';

const palette = [
  { code: 'C7', rgb: [151, 82, 48] },
  { code: 'F10', rgb: [160, 91, 55] },
  { code: 'H2', rgb: [255, 255, 255] },
  { code: 'H7', rgb: [0, 0, 0] },
];

function pixelsFromColors(colors) {
  const pixels = new Uint8ClampedArray(colors.length * 4);
  colors.forEach((rgb, position) => {
    const offset = position * 4;
    pixels[offset] = rgb[0];
    pixels[offset + 1] = rgb[1];
    pixels[offset + 2] = rgb[2];
    pixels[offset + 3] = 255;
  });
  return pixels;
}

function countTransitions(indices, width, height) {
  let transitions = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const position = y * width + x;
      if (x + 1 < width && indices[position] !== indices[position + 1]) transitions += 1;
      if (y + 1 < height && indices[position] !== indices[position + width]) transitions += 1;
    }
  }
  return transitions;
}

test('有序模式会合并平坦区域中的相近孤立色', () => {
  const width = 5;
  const height = 5;
  const indices = new Uint8Array(width * height).fill(0);
  indices[12] = 1;
  const pixels = pixelsFromColors(Array(width * height).fill(palette[0].rgb));
  const result = createOrderedColorPattern({ indices, width, height, palette, pixels, reservedIndex: 3 });
  assert.equal(result[12], 0);
});

test('有序模式保留原图支持的高对比小细节', () => {
  const width = 5;
  const height = 5;
  const indices = new Uint8Array(width * height).fill(0);
  indices[12] = 2;
  const colors = Array(width * height).fill(palette[0].rgb);
  colors[12] = palette[2].rgb;
  const result = createOrderedColorPattern({
    indices,
    width,
    height,
    palette,
    pixels: pixelsFromColors(colors),
    reservedIndex: 3,
  });
  assert.equal(result[12], 2);
});

test('细节软证据不会干扰原图支持的高对比细节', () => {
  const width = 5;
  const height = 5;
  const indices = new Uint8Array(width * height).fill(0);
  indices[12] = 2;
  const detailMask = new Uint8Array(width * height);
  detailMask[12] = 1;
  const colors = Array(width * height).fill(palette[0].rgb);
  colors[12] = palette[2].rgb;
  const pixels = pixelsFromColors(colors);
  const result = createOrderedColorPattern({
    indices,
    width,
    height,
    palette,
    pixels,
    detailMask,
    reservedIndex: 3,
  });
  assert.equal(result[12], 2, '原图明确支持的高对比细节不能被平坦区规则吞掉');
});

test('细节标记是软证据，不会锁死抗锯齿产生的错误近色', () => {
  const width = 5;
  const height = 5;
  const indices = new Uint8Array(width * height).fill(0);
  indices[12] = 1;
  const detailMask = new Uint8Array(width * height);
  detailMask[12] = 1;
  const result = createOrderedColorPattern({
    indices,
    width,
    height,
    palette,
    pixels: pixelsFromColors(Array(width * height).fill(palette[0].rgb)),
    detailMask,
    reservedIndex: 3,
  });
  assert.equal(result[12], 0, '原图不支持的边缘杂色仍应并回主色');
});

test('有序模式锁定H7轮廓且不会让H7向普通色块扩散', () => {
  const width = 5;
  const height = 5;
  const indices = new Uint8Array(width * height).fill(0);
  indices[12] = 3;
  const protectedMask = new Uint8Array(width * height);
  protectedMask[12] = 1;
  const result = createOrderedColorPattern({
    indices,
    width,
    height,
    palette,
    pixels: pixelsFromColors(Array(width * height).fill(palette[3].rgb)),
    protectedMask,
    reservedIndex: 3,
  });
  assert.equal(result[12], 3);
  assert.equal([...result].filter((index) => index === 3).length, 1);
});

test('有序模式减少平坦区域内无规律的相邻换色', () => {
  const width = 6;
  const height = 4;
  const indices = Uint8Array.from(
    { length: width * height },
    (_, position) => ((position + Math.floor(position / width)) % 2),
  );
  const sourceColor = [154, 85, 51];
  const pixels = pixelsFromColors(Array(width * height).fill(sourceColor));
  const result = createOrderedColorPattern({ indices, width, height, palette, pixels, reservedIndex: 3 });
  assert.ok(countTransitions(result, width, height) < countTransitions(indices, width, height));
});

test('有序模式不会让颜色跨越原图中的高对比区域边界', () => {
  const width = 8;
  const height = 4;
  const indices = new Uint8Array(width * height);
  const colors = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const position = y * width + x;
      if (x < 4) {
        indices[position] = (x + y) % 2;
        colors.push([154, 85, 51]);
      } else {
        indices[position] = 2;
        colors.push([250, 250, 250]);
      }
    }
  }
  const result = createOrderedColorPattern({
    indices,
    width,
    height,
    palette,
    pixels: pixelsFromColors(colors),
    reservedIndex: 3,
  });
  for (let y = 0; y < height; y += 1) {
    assert.notEqual(result[y * width + 3], 2, '左侧棕色区域不能被白色侵入');
    assert.equal(result[y * width + 4], 2, '右侧白色区域必须保留');
  }
});

test('有序模式会合并接近H7的碎片深色号，同时保留大面积深浅层次', () => {
  const darkPalette = [
    { code: 'H19', rgb: [246, 239, 226] },
    { code: 'H5', rgb: [72, 70, 78] },
    { code: 'H6', rgb: [47, 43, 47] },
    { code: 'H16', rgb: [29, 20, 20] },
    { code: 'H7', rgb: [0, 0, 0] },
  ];
  const width = 20;
  const height = 20;
  const indices = new Uint8Array(width * height).fill(0);
  const colors = Array.from({ length: width * height }, () => darkPalette[0].rgb);
  for (let y = 3; y < 17; y += 1) {
    for (let x = 4; x < 16; x += 1) {
      indices[y * width + x] = 1;
      colors[y * width + x] = darkPalette[1].rgb;
    }
  }
  // 两个小面积近黑变体应回到主深色，而不是各自形成新的色号。
  for (const [x, y, colorIndex] of [[8, 7, 2], [9, 7, 2], [13, 9, 3], [13, 10, 3]]) {
    indices[y * width + x] = colorIndex;
    colors[y * width + x] = darkPalette[colorIndex].rgb;
  }
  const protectedMask = new Uint8Array(width * height);
  for (let y = 2; y < 18; y += 1) {
    for (let x = 3; x < 17; x += 1) {
      if (y !== 2 && y !== 17 && x !== 3 && x !== 16) continue;
      const position = y * width + x;
      indices[position] = 4;
      colors[position] = darkPalette[4].rgb;
      protectedMask[position] = 1;
    }
  }
  const pixels = pixelsFromColors(colors);
  const result = createOrderedColorPattern({
    indices,
    width,
    height,
    palette: darkPalette,
    pixels,
    protectedMask,
    reservedIndex: 4,
  });
  const darkCodes = new Set(
    [...result]
      .map((index) => darkPalette[index])
      .filter((color) => color.code !== 'H7' && color.code !== 'H19')
      .map((color) => color.code),
  );
  assert.ok(darkCodes.size <= 2, '近黑填充最多保留两个有面积的代表色');
  assert.ok([...result].filter((index) => index === 4).length > 0, 'H7轮廓应保持存在');
});

test('有序模式会把贴着H7的细小深色线段提升为H7', () => {
  const darkPalette = [
    { code: 'H19', rgb: [246, 239, 226] },
    { code: 'H6', rgb: [47, 43, 47] },
    { code: 'H7', rgb: [0, 0, 0] },
  ];
  const width = 7;
  const height = 5;
  const indices = new Uint8Array(width * height).fill(0);
  const colors = Array.from({ length: width * height }, () => darkPalette[0].rgb);
  const protectedMask = new Uint8Array(width * height);
  for (let x = 1; x <= 4; x += 1) {
    const outlinePosition = width + x;
    indices[outlinePosition] = 2;
    colors[outlinePosition] = darkPalette[2].rgb;
    protectedMask[outlinePosition] = 1;
  }
  const missedLine = 2 * width + 2;
  indices[missedLine] = 1;
  colors[missedLine] = darkPalette[1].rgb;
  const result = createOrderedColorPattern({
    indices,
    width,
    height,
    palette: darkPalette,
    pixels: pixelsFromColors(colors),
    protectedMask,
    reservedIndex: 2,
  });
  assert.equal(result[missedLine], 2, '贴着H7的深色线段应统一成轮廓色');
});

test('同一材质的柔和渐变会压缩为少量连续色块', () => {
  const gradientPalette = [
    { code: 'G7', rgb: [150, 80, 45] },
    { code: 'G13', rgb: [156, 85, 49] },
    { code: 'F10', rgb: [163, 91, 54] },
    { code: 'M13', rgb: [171, 99, 61] },
    { code: 'H7', rgb: [0, 0, 0] },
  ];
  const width = 12;
  const height = 8;
  const indices = Uint8Array.from({ length: width * height }, (_, position) => (
    Math.min(3, Math.floor((position % width) / 3))
  ));
  const colors = Array.from({ length: width * height }, (_, position) => {
    const x = position % width;
    return [150 + x * 2, 80 + x, 45 + Math.floor(x * 0.7)];
  });
  const result = createOrderedColorPattern({
    indices,
    width,
    height,
    palette: gradientPalette,
    pixels: pixelsFromColors(colors),
    reservedIndex: 4,
  });
  assert.ok(new Set(result).size <= 2, '柔和渐变不应拆成密集的四级近色');
});
