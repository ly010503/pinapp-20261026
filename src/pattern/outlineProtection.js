function pixelLuminance(pixels, position) {
  const offset = position * 4;
  return pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722;
}

/**
 * 检测缩小图中的黑色轮廓。
 * 同时保留纯黑区域，以及被较亮颜色包围的低亮度线条，
 * 避免区域平均采样把黑线稀释成灰色或棕色。
 */
export function createOutlineMask(pixels, width, height) {
  const mask = new Uint8Array(width * height);
  if (!pixels?.length || !width || !height) return mask;
  const neighborOffsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const position = y * width + x;
      const offset = position * 4;
      if (pixels[offset + 3] < 24) continue;

      const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
      const maximum = Math.max(r, g, b);
      const minimum = Math.min(r, g, b);
      const chroma = maximum - minimum;
      const luminance = pixelLuminance(pixels, position);
      const nearBlackCore = maximum <= 65 && chroma <= 50;
      if (nearBlackCore) {
        mask[position] = 1;
        continue;
      }

      if (luminance > 150 || chroma > 100) continue;
      let brightNeighbors = 0;
      let neighborTotal = 0;
      let neighborCount = 0;
      let brightest = luminance;
      for (const [offsetX, offsetY] of neighborOffsets) {
        const nx = x + offsetX, ny = y + offsetY;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const neighborLuminance = pixelLuminance(pixels, ny * width + nx);
        neighborTotal += neighborLuminance;
        neighborCount += 1;
        brightest = Math.max(brightest, neighborLuminance);
        if (neighborLuminance - luminance >= 35) brightNeighbors += 1;
      }
      const neighborAverage = neighborCount ? neighborTotal / neighborCount : luminance;
      if (brightNeighbors >= 2
        && brightest - luminance >= 50
        && neighborAverage - luminance >= 20) {
        mask[position] = 1;
      }
    }
  }
  return mask;
}

export function findOutlinePaletteIndex(palette) {
  const preferred = palette.findIndex((color) => color.code === 'H7');
  if (preferred >= 0) return preferred;
  let darkestIndex = -1;
  let darkestValue = Number.POSITIVE_INFINITY;
  palette.forEach((color, index) => {
    if (!color.rgb) return;
    const value = color.rgb[0] + color.rgb[1] + color.rgb[2];
    if (value < darkestValue) {
      darkestValue = value;
      darkestIndex = index;
    }
  });
  return darkestIndex;
}
