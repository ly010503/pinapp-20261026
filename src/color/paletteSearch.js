import { deltaE76, deltaE2000 } from './colorSpace.js';

/**
 * 先用计算较快的 Delta E 76 找出少量候选，再用 CIEDE2000 做最终判断。
 * 比全量 CIEDE2000 更适合浏览器，同时改善蓝紫、肤色和低饱和度颜色的感知匹配。
 */
export function findNearestPaletteIndex(lab, palette, allowed = null, shortlistSize = 8) {
  const candidates = allowed || palette.map((_, index) => index);
  if (!candidates.length) return -1;

  const shortlist = [];
  for (const index of candidates) {
    const distance = deltaE76(lab, palette[index].lab);
    let position = shortlist.findIndex((item) => distance < item.distance);
    if (position < 0) position = shortlist.length;
    shortlist.splice(position, 0, { index, distance });
    if (shortlist.length > shortlistSize) shortlist.pop();
  }

  let nearest = shortlist[0].index;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of shortlist) {
    const distance = deltaE2000(lab, palette[candidate.index].lab);
    if (distance < nearestDistance) {
      nearest = candidate.index;
      nearestDistance = distance;
    }
  }
  return nearest;
}
