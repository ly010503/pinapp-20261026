/**
 * 根据图片实际颜色分布自动选择需要保留的色卡颜色。
 * maxColors 只是硬上限；低频颜色和累计占比之外的尾部颜色不会被强行保留。
 */
export function choosePaletteIndices(counts, maxColors, total = 0) {
  const pixelTotal = total || counts.reduce((sum, count) => sum + count, 0);
  const limit = Math.max(1, Math.min(counts.length, Math.floor(maxColors) || 1));
  const sorted = [...counts.keys()]
    .filter((index) => counts[index] > 0)
    .sort((a, b) => counts[b] - counts[a]);

  if (!sorted.length) return [0];

  const selected = [];
  const minimumCount = Math.max(2, Math.ceil(pixelTotal * 0.001));
  let covered = 0;

  for (const index of sorted) {
    if (selected.length >= limit) break;
    if (selected.length >= 4 && counts[index] < minimumCount) break;
    selected.push(index);
    covered += counts[index];
    if (selected.length >= 4 && covered / pixelTotal >= 0.995) break;
  }

  return selected;
}
