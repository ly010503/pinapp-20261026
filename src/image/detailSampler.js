const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

/**
 * 在已经缩小到图纸尺寸的像素上做轻量锐化。
 *
 * 只调整当前格，不把少数黑白像素传播到相邻格；输出颜色还会被限制在
 * 当前格与四邻格的颜色范围内，避免凭空产生过黑、过白或过艳的碎块。
 */
export function enhanceGridDetails(pixels, width, height, strength = 0.28) {
  const source = new Uint8ClampedArray(pixels);
  const output = new Uint8ClampedArray(source);
  if (width < 3 || height < 3 || strength <= 0) return output;

  const rowStride = width * 4;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const offset = (y * width + x) * 4;
      const neighbors = [
        offset - 4,
        offset + 4,
        offset - rowStride,
        offset + rowStride,
      ];
      const averages = [0, 0, 0];
      const details = [0, 0, 0];
      let strongestDetail = 0;

      for (let channel = 0; channel < 3; channel += 1) {
        averages[channel] = neighbors.reduce(
          (sum, neighborOffset) => sum + source[neighborOffset + channel],
          0,
        ) / neighbors.length;
        details[channel] = source[offset + channel] - averages[channel];
        strongestDetail = Math.max(strongestDetail, Math.abs(details[channel]));
      }

      // 小幅色差通常来自缩放插值或原图纹理，保持原样能减少杂色。
      if (strongestDetail < 16) continue;

      for (let channel = 0; channel < 3; channel += 1) {
        const neighborhood = [
          source[offset + channel],
          ...neighbors.map((neighborOffset) => source[neighborOffset + channel]),
        ];
        const minimum = Math.min(...neighborhood);
        const maximum = Math.max(...neighborhood);
        const sharpened = source[offset + channel] + details[channel] * strength;
        output[offset + channel] = clampByte(Math.max(minimum, Math.min(maximum, sharpened)));
      }
    }
  }

  return output;
}
