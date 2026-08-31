import { deltaE76, deltaE2000, rgbToLab } from '../color/colorSpace.js';

const CARDINAL_OFFSETS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
];

const SURROUNDING_OFFSETS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

// MARD 中 H5/H6/H16 都是“接近黑色的填充色”，但只有 H7 应该承担轮廓。
// 用 Lab 的低亮度/低彩度判断，而不是写死色号，这样换成同系列色卡时仍然有效。
const DARK_NEUTRAL_LIGHTNESS = 45;
const DARK_NEUTRAL_CHROMA = 12;
const MAX_DARK_FILL_REPRESENTATIVES = 2;

function withLab(palette) {
  return palette.map((color) => (
    color.lab ? color : { ...color, lab: rgbToLab(...color.rgb) }
  ));
}

function createSourceLabs(pixels, size) {
  const labs = new Array(size);
  for (let position = 0; position < size; position += 1) {
    const offset = position * 4;
    labs[position] = rgbToLab(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
  }
  return labs;
}

function visitNeighbors(position, width, height, offsets, visit) {
  const x = position % width;
  const y = Math.floor(position / width);
  for (const [offsetX, offsetY] of offsets) {
    const nx = x + offsetX;
    const ny = y + offsetY;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
    visit(ny * width + nx);
  }
}

function createPaletteDistanceGetter(palette) {
  const cache = new Map();
  return (first, second) => {
    if (first === second) return 0;
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    const key = low * palette.length + high;
    let distance = cache.get(key);
    if (distance === undefined) {
      distance = deltaE76(palette[first].lab, palette[second].lab);
      cache.set(key, distance);
    }
    return distance;
  };
}

function isDarkNeutralColor(color) {
  if (!color?.lab) return false;
  const chroma = Math.hypot(color.lab.a, color.lab.b);
  return color.lab.l <= DARK_NEUTRAL_LIGHTNESS && chroma <= DARK_NEUTRAL_CHROMA;
}

function isActivePosition(position, activeMask) {
  return !activeMask || activeMask[position];
}

function mergeMasks(first, second) {
  if (!first && !second) return null;
  const length = Math.max(first?.length || 0, second?.length || 0);
  const result = new Uint8Array(length);
  for (let position = 0; position < length; position += 1) {
    if (first?.[position] || second?.[position]) result[position] = 1;
  }
  return result;
}

/**
 * 有序模式专用：把漏检成深灰/近黑填充的细小线段补回 H7。
 * 只处理与已有 H7 相邻、且呈细线形状的组件；成片的深色衣服/头发不会整块变黑。
 */
function promoteDarkOutlineFragments(
  indices,
  width,
  height,
  palette,
  sourceLabs,
  reservedIndex,
  activeMask,
) {
  const result = new Uint8Array(indices);
  const promotedMask = new Uint8Array(result.length);
  if (reservedIndex < 0 || !palette[reservedIndex]) return { result, promotedMask };

  const isDarkCell = (position) => (
    isActivePosition(position, activeMask)
      && (result[position] === reservedIndex || isDarkNeutralColor(palette[result[position]]))
  );
  const visited = new Uint8Array(result.length);

  for (let start = 0; start < result.length; start += 1) {
    if (visited[start] || !isDarkCell(start) || result[start] === reservedIndex) continue;
    const stack = [start];
    const component = [];
    let touchesReserved = false;
    visited[start] = 1;
    while (stack.length) {
      const position = stack.pop();
      component.push(position);
      visitNeighbors(position, width, height, CARDINAL_OFFSETS, (neighbor) => {
        if (!isActivePosition(neighbor, activeMask)) return;
        if (result[neighbor] === reservedIndex) {
          touchesReserved = true;
          return;
        }
        if (!visited[neighbor] && isDarkCell(neighbor)) {
          visited[neighbor] = 1;
          stack.push(neighbor);
        }
      });
    }
    if (!touchesReserved) continue;

    let minX = width, minY = height, maxX = -1, maxY = -1;
    let boundaryTotal = 0;
    let brightBoundary = 0;
    for (const position of component) {
      const x = position % width;
      const y = Math.floor(position / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      visitNeighbors(position, width, height, SURROUNDING_OFFSETS, (neighbor) => {
        if (!isActivePosition(neighbor, activeMask)) return;
        if (result[neighbor] === reservedIndex || isDarkNeutralColor(palette[result[neighbor]])) return;
        boundaryTotal += 1;
        if (sourceLabs[neighbor].l - sourceLabs[position].l >= 20) brightBoundary += 1;
      });
    }

    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const shortSide = Math.min(componentWidth, componentHeight);
    const density = component.length / Math.max(1, componentWidth * componentHeight);
    const lineLike = component.length >= 2
      && (shortSide <= 2 || density <= 0.48);
    const brightRatio = boundaryTotal ? brightBoundary / boundaryTotal : 0;
    const smallJoinedLine = component.length <= 6 && brightBoundary >= 2 && brightRatio >= 0.45;
    const longJoinedLine = lineLike && brightRatio >= 0.58;
    if (!smallJoinedLine && !longJoinedLine) continue;

    for (const position of component) {
      result[position] = reservedIndex;
      promotedMask[position] = 1;
    }
  }
  return { result, promotedMask };
}

/**
 * 有序模式专用：近黑色填充最多保留两个有实际面积的代表色。
 * 小面积 H5/H6/H16 变体映射到最近的代表色，避免图纸出现一串几乎相同的深色号，
 * 同时保留大面积的两级明暗关系（例如 H5 + H16）。H7 永远不参与合并。
 */
function consolidateDarkNeutralVariants(
  indices,
  palette,
  sourceLabs,
  protectedMask,
  reservedIndex,
  activeMask,
) {
  const result = new Uint8Array(indices);
  const counts = new Map();
  const sourceSamplesByLabel = new Map();
  let activeTotal = 0;
  for (let position = 0; position < result.length; position += 1) {
    if (!isActivePosition(position, activeMask)) continue;
    activeTotal += 1;
    const index = result[position];
    if (index === reservedIndex || !isDarkNeutralColor(palette[index])) continue;
    counts.set(index, (counts.get(index) || 0) + 1);
    if (!sourceSamplesByLabel.has(index)) sourceSamplesByLabel.set(index, []);
    const samples = sourceSamplesByLabel.get(index);
    if (samples.length < 24) samples.push(sourceLabs[position]);
  }
  if (counts.size <= 1) return result;

  const ranked = [...counts.entries()].sort((first, second) => second[1] - first[1]);
  const paletteDistance = createPaletteDistanceGetter(palette);
  const representatives = [];
  const minimumArea = Math.max(4, Math.ceil(activeTotal * 0.006));
  for (const [index, count] of ranked) {
    if (!representatives.length) {
      representatives.push(index);
      continue;
    }
    if (representatives.length >= MAX_DARK_FILL_REPRESENTATIVES || count < minimumArea) break;
    // H6 与 H16 的色差很小，保留其中面积更大的一个；H5 与它们有足够明暗差时可并存。
    if (representatives.every((kept) => paletteDistance(index, kept) >= 10)) {
      representatives.push(index);
    }
  }
  if (representatives.length === ranked.length) return result;

  const replacement = new Map();
  for (const [index] of ranked) {
    if (representatives.includes(index)) continue;
    let best = representatives[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of representatives) {
      const paletteFit = paletteDistance(index, candidate);
      // 源图拟合只作为次要因素，避免把小变体映射成相邻但不相干的深灰。
      const sourceFit = (sourceSamplesByLabel.get(index) || [])
        .reduce((sum, lab) => sum + deltaE2000(lab, palette[candidate].lab), 0);
      const score = paletteFit + sourceFit * 0.04;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    replacement.set(index, best);
  }

  for (let position = 0; position < result.length; position += 1) {
    if (protectedMask?.[position] && result[position] === reservedIndex) continue;
    const target = replacement.get(result[position]);
    if (target !== undefined) result[position] = target;
  }
  return result;
}

export function createOrderedRegionMap({
  sourceLabs,
  width,
  height,
  protectedMask = null,
  activeMask = null,
  localThreshold = 18,
  regionThreshold = 29,
}) {
  const regionMap = new Int32Array(width * height).fill(-1);
  let regionId = 0;
  for (let start = 0; start < regionMap.length; start += 1) {
    if (regionMap[start] >= 0 || protectedMask?.[start] || (activeMask && !activeMask[start])) continue;
    const stack = [start];
    regionMap[start] = regionId;
    let meanL = sourceLabs[start].l;
    let meanA = sourceLabs[start].a;
    let meanB = sourceLabs[start].b;
    let count = 1;

    while (stack.length) {
      const position = stack.pop();
      visitNeighbors(position, width, height, CARDINAL_OFFSETS, (neighbor) => {
        if (regionMap[neighbor] >= 0 || protectedMask?.[neighbor] || (activeMask && !activeMask[neighbor])) return;
        const localDistance = deltaE76(sourceLabs[position], sourceLabs[neighbor]);
        const regionDistance = deltaE76(
          { l: meanL, a: meanA, b: meanB },
          sourceLabs[neighbor],
        );
        if (localDistance > localThreshold || regionDistance > regionThreshold) return;
        regionMap[neighbor] = regionId;
        stack.push(neighbor);
        count += 1;
        meanL += (sourceLabs[neighbor].l - meanL) / count;
        meanA += (sourceLabs[neighbor].a - meanA) / count;
        meanB += (sourceLabs[neighbor].b - meanB) / count;
      });
    }
    regionId += 1;
  }
  return regionMap;
}

function limitColorsPerRegion(indices, regionMap, palette, sourceLabs, protectedMask, reservedIndex) {
  const result = new Uint8Array(indices);
  const regions = new Map();
  for (let position = 0; position < regionMap.length; position += 1) {
    const region = regionMap[position];
    if (region < 0 || protectedMask?.[position]) continue;
    if (!regions.has(region)) regions.set(region, []);
    regions.get(region).push(position);
  }

  for (const positions of regions.values()) {
    const colorCounts = new Map();
    for (const position of positions) {
      const index = result[position];
      if (index === reservedIndex) continue;
      colorCounts.set(index, (colorCounts.get(index) || 0) + 1);
    }
    let meanL = 0, meanA = 0, meanB = 0;
    for (const position of positions) {
      meanL += sourceLabs[position].l;
      meanA += sourceLabs[position].a;
      meanB += sourceLabs[position].b;
    }
    meanL /= positions.length;
    meanA /= positions.length;
    meanB /= positions.length;
    const sourceSpread = positions.reduce((sum, position) => sum + deltaE76(
      sourceLabs[position],
      { l: meanL, a: meanA, b: meanB },
    ), 0) / positions.length;
    // 用户成品偏好按“材质”成块：平坦或柔和渐变用一个主色，
    // 有明确明暗层次时最多保留两到三色，不再按区域面积盲目增加颜色。
    const colorLimit = positions.length < 8 || sourceSpread < 5.5
      ? 1
      : sourceSpread < 11.5 ? 2 : 3;
    const ranked = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length <= colorLimit) continue;
    const allowed = ranked.slice(0, colorLimit).map(([index]) => index);
    for (const position of positions) {
      const current = result[position];
      if (current === reservedIndex || allowed.includes(current)) continue;
      let replacement = allowed[0];
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of allowed) {
        const distance = deltaE2000(sourceLabs[position], palette[candidate].lab);
        if (distance < bestDistance) {
          replacement = candidate;
          bestDistance = distance;
        }
      }
      result[position] = replacement;
    }
  }
  return result;
}

function optimizeLocalCoherence(indices, width, height, palette, sourceLabs, protectedMask, detailMask, reservedIndex, activeMask, regionMap) {
  const result = new Uint8Array(indices);
  const paletteDistance = createPaletteDistanceGetter(palette);
  const size = result.length;

  const calculateCost = (position, candidate) => {
    const detailWeight = detailMask?.[position] ? 1.3 : 1;
    let cost = deltaE2000(sourceLabs[position], palette[candidate].lab) * detailWeight;
    visitNeighbors(position, width, height, CARDINAL_OFFSETS, (neighbor) => {
      if (regionMap[neighbor] !== regionMap[position]) return;
      const neighborLabel = result[neighbor];
      if (candidate === neighborLabel) return;
      const sourceDistance = deltaE76(sourceLabs[position], sourceLabs[neighbor]);
      const edgeWeight = Math.exp(-((sourceDistance / 15) ** 2));
      const shadeJump = Math.max(0, paletteDistance(candidate, neighborLabel) - 18);
      cost += edgeWeight * (5.2 + Math.min(2.8, shadeJump * 0.09));
    });
    return cost;
  };

  // 交替扫描方向，避免颜色整理总是偏向左上角。
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const forward = iteration % 2 === 0;
    const start = forward ? 0 : size - 1;
    const end = forward ? size : -1;
    const step = forward ? 1 : -1;
    let changes = 0;

    for (let position = start; position !== end; position += step) {
      if (protectedMask?.[position] || (activeMask && !activeMask[position])) continue;
      const current = result[position];
      const candidates = new Set([current]);
      visitNeighbors(position, width, height, SURROUNDING_OFFSETS, (neighbor) => {
        if (activeMask && !activeMask[neighbor]) return;
        if (regionMap[neighbor] !== regionMap[position]) return;
        const candidate = result[neighbor];
        // H7 轮廓只能由轮廓检测产生，不能在颜色平滑时向色块内部扩散。
        if (candidate !== reservedIndex || current === reservedIndex) candidates.add(candidate);
      });

      let best = current;
      let bestCost = calculateCost(position, current);
      for (const candidate of candidates) {
        if (candidate === current) continue;
        const cost = calculateCost(position, candidate);
        if (cost < bestCost - 0.35) {
          best = candidate;
          bestCost = cost;
        }
      }
      if (best !== current) {
        result[position] = best;
        changes += 1;
      }
    }
    if (!changes) break;
  }
  return result;
}

function mergeSmallLowContrastRegions(indices, width, height, palette, sourceLabs, protectedMask, detailMask, reservedIndex, activeMask, regionMap) {
  const result = new Uint8Array(indices);
  const visited = new Uint8Array(result.length);
  const paletteDistance = createPaletteDistanceGetter(palette);

  for (let start = 0; start < result.length; start += 1) {
    if (visited[start]) continue;
    if (activeMask && !activeMask[start]) {
      visited[start] = 1;
      continue;
    }
    const label = result[start];
    const component = [];
    const stack = [start];
    const boundaryCounts = new Map();
    let touchesProtected = false;
    visited[start] = 1;

    while (stack.length) {
      const position = stack.pop();
      component.push(position);
      if (protectedMask?.[position]) touchesProtected = true;
      visitNeighbors(position, width, height, CARDINAL_OFFSETS, (neighbor) => {
        if (activeMask && !activeMask[neighbor]) return;
        if (regionMap[neighbor] !== regionMap[position]) return;
        const neighborLabel = result[neighbor];
        if (neighborLabel === label) {
          if (!visited[neighbor]) {
            visited[neighbor] = 1;
            stack.push(neighbor);
          }
          return;
        }
        boundaryCounts.set(neighborLabel, (boundaryCounts.get(neighborLabel) || 0) + 1);
      });
    }

    if (touchesProtected || label === reservedIndex || component.length > 3 || !boundaryCounts.size) continue;
    const boundaryTotal = [...boundaryCounts.values()].reduce((sum, count) => sum + count, 0);
    let replacement = -1;
    let replacementScore = Number.POSITIVE_INFINITY;

    for (const [candidate, count] of boundaryCounts) {
      if (candidate === reservedIndex || count / boundaryTotal < 0.5) continue;
      const colorDistance = paletteDistance(label, candidate);
      if (colorDistance > 18) continue;

      let originalFit = 0;
      let replacementFit = 0;
      for (const position of component) {
        originalFit += deltaE2000(sourceLabs[position], palette[label].lab);
        replacementFit += deltaE2000(sourceLabs[position], palette[candidate].lab);
      }
      const fitLoss = (replacementFit - originalFit) / component.length;
      const containsDetail = component.some((position) => detailMask?.[position]);
      if (fitLoss > (containsDetail ? 3.5 : 6)) continue;
      const score = replacementFit / component.length
        + (boundaryTotal - count) * 1.4
        + colorDistance * 0.12;
      if (score < replacementScore) {
        replacement = candidate;
        replacementScore = score;
      }
    }

    if (replacement >= 0) {
      component.forEach((position) => { result[position] = replacement; });
    }
  }
  return result;
}

/**
 * “有序”颜色效果：在真实原图边缘处保留换色，在平坦区域内让相近颜色形成连续色块。
 * protectedMask 通常是 H7 轮廓，reservedIndex 防止轮廓色被平滑算法向内部扩散。
 */
export function createOrderedColorPattern({
  indices,
  width,
  height,
  palette,
  pixels,
  protectedMask = null,
  detailMask = null,
  reservedIndex = -1,
  activeMask = null,
}) {
  if (!indices?.length || !pixels?.length || width * height !== indices.length) {
    return new Uint8Array(indices || []);
  }
  const preparedPalette = withLab(palette);
  const sourceLabs = createSourceLabs(pixels, indices.length);
  const promoted = promoteDarkOutlineFragments(
    indices,
    width,
    height,
    preparedPalette,
    sourceLabs,
    reservedIndex,
    activeMask,
  );
  const effectiveProtectedMask = mergeMasks(protectedMask, promoted.promotedMask);
  const darkNormalized = consolidateDarkNeutralVariants(
    promoted.result,
    preparedPalette,
    sourceLabs,
    effectiveProtectedMask,
    reservedIndex,
    activeMask,
  );
  const regionMap = createOrderedRegionMap({
    sourceLabs,
    width,
    height,
    protectedMask: effectiveProtectedMask,
    activeMask,
  });
  const regionLimited = limitColorsPerRegion(
    darkNormalized,
    regionMap,
    preparedPalette,
    sourceLabs,
    effectiveProtectedMask,
    reservedIndex,
  );
  const coherent = optimizeLocalCoherence(
    regionLimited,
    width,
    height,
    preparedPalette,
    sourceLabs,
    effectiveProtectedMask,
    detailMask,
    reservedIndex,
    activeMask,
    regionMap,
  );
  return mergeSmallLowContrastRegions(
    coherent,
    width,
    height,
    preparedPalette,
    sourceLabs,
    effectiveProtectedMask,
    detailMask,
    reservedIndex,
    activeMask,
    regionMap,
  );
}
