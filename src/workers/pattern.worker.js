import { deltaE76, rgbToLab } from '../color/colorSpace.js';
import { choosePaletteIndices, shouldProtectAccent } from '../pattern/paletteLimit.js';
import { createOutlineMask, findOutlinePaletteIndex } from '../pattern/outlineProtection.js';
import { createOrderedColorPattern } from '../pattern/orderedColorCleanup.js';
import { createSubjectOutlineMask } from '../pattern/subjectMask.js';

function postProgress(progress, text) { self.postMessage({ type: 'progress', progress, text }); }

function nearest(lab, palette, allowed = null) {
  let best = allowed ? allowed[0] : 0, distance = Infinity;
  const candidates = allowed || palette.map((_, index) => index);
  for (const index of candidates) {
    const current = deltaE76(lab, palette[index].lab);
    if (current < distance) { distance = current; best = index; }
  }
  return best;
}

function cleanIsolated(indices, width, height, palette, protectedMask = null) {
  const result = new Uint8Array(indices);
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const pos = y * width + x, current = indices[pos], counts = new Map();
    if (protectedMask?.[pos]) continue;
    for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) continue;
      const value = indices[(y + oy) * width + (x + ox)];
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (dominant && dominant[1] >= 5 && dominant[0] !== current && (counts.get(current) || 0) <= 1) {
      const currentColor = palette[current], dominantColor = palette[dominant[0]];
      const protectedAccent = shouldProtectAccent(currentColor, dominantColor);
      if (!protectedAccent && deltaE76(currentColor.lab, dominantColor.lab) < 32) result[pos] = dominant[0];
    }
  }
  return result;
}

function combineOuterAndInnerOutlines(innerMask, outerMask, width, height) {
  if (!outerMask) return innerMask;
  const result = new Uint8Array(outerMask);
  if (!innerMask) return result;
  for (let position = 0; position < innerMask.length; position += 1) {
    if (!innerMask[position] || outerMask[position]) continue;
    const x = position % width;
    const y = Math.floor(position / width);
    let touchesOuter = false;
    for (let oy = -1; oy <= 1 && !touchesOuter; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        if (ox === 0 && oy === 0) continue;
        const nx = x + ox, ny = y + oy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && outerMask[ny * width + nx]) {
          touchesOuter = true;
          break;
        }
      }
    }
    // 外轮廓附近只保留主体蒙版生成的一格边界，避免原图粗线再次向内叠加。
    if (!touchesOuter) result[position] = 1;
  }
  return result;
}

self.onmessage = ({ data }) => {
  if (data.type !== 'generate') return;
  try {
    const {
      id,
      width,
      height,
      maxColors,
      reduceIsolated,
      mergeColors,
      protectDarkOutline = true,
      orderedColorCleanup = false,
      subjectMask: subjectMaskBuffer = null,
      darkCoverage: darkCoverageBuffer = null,
      structureEdges: structureEdgesBuffer = null,
      detailMask: detailMaskBuffer = null,
      allowedPaletteIndices,
      pixels: buffer,
    } = data;
    const pixels = new Uint8ClampedArray(buffer);
    const subjectMask = subjectMaskBuffer ? new Uint8Array(subjectMaskBuffer) : null;
    const darkCoverage = darkCoverageBuffer ? new Uint8Array(darkCoverageBuffer) : null;
    const structureEdges = structureEdgesBuffer ? new Uint8Array(structureEdgesBuffer) : null;
    const detailMask = detailMaskBuffer ? new Uint8Array(detailMaskBuffer) : null;
    const palette = data.palette.map((color) => ({ ...color, lab: rgbToLab(...color.rgb) }));
    const outlineMask = protectDarkOutline
      ? createOutlineMask(pixels, width, height, { subjectMask, darkCoverage, structureEdges })
      : null;
    const subjectOutlineMask = orderedColorCleanup && subjectMask?.length === width * height
      ? createSubjectOutlineMask(subjectMask, width, height)
      : null;
    const protectedOutlineMask = subjectOutlineMask
      ? combineOuterAndInnerOutlines(outlineMask, subjectOutlineMask, width, height)
      : outlineMask;
    // H7 轮廓是硬约束；格内色差只说明“这里可能有细节”，不能当成绝对锁定。
    // 把二者合并会将抗锯齿、渐变和纹理全部冻结，形成大量无法清理的杂色格。
    const cleanupProtectedMask = protectedOutlineMask;
    const outlineIndex = protectDarkOutline ? findOutlinePaletteIndex(palette) : -1;
    const hasProtectedOutline = outlineIndex >= 0 && protectedOutlineMask?.some(Boolean);
    const raw = new Uint8Array(width * height);
    const counts = new Uint32Array(palette.length);
    let activePixelTotal = 0;
    const legendAllowed = Array.isArray(allowedPaletteIndices)
      ? [...new Set(allowedPaletteIndices)].filter((index) => Number.isInteger(index) && index >= 0 && index < palette.length)
      : null;
    const constrainedCandidates = legendAllowed?.length ? legendAllowed : null;
    const allCandidates = palette.map((_, index) => index);
    const baseCandidates = constrainedCandidates || allCandidates;
    const fillCandidates = orderedColorCleanup && outlineIndex >= 0
      ? baseCandidates.filter((index) => index !== outlineIndex)
      : baseCandidates;
    const effectiveFillCandidates = fillCandidates.length ? fillCandidates : baseCandidates;
    const matchCache = new Map();
    postProgress(34, '正在分析颜色');
    for (let i = 0; i < raw.length; i += 1) {
      const offset = i * 4;
      if (orderedColorCleanup && hasProtectedOutline && protectedOutlineMask[i]) {
        raw[i] = outlineIndex;
        if (!subjectMask || subjectMask[i]) {
          counts[outlineIndex] += 1;
          activePixelTotal += 1;
        }
        continue;
      }
      const key = `${pixels[offset] >> 3},${pixels[offset + 1] >> 3},${pixels[offset + 2] >> 3}`;
      let index = matchCache.get(key);
      if (index === undefined) {
        index = nearest(rgbToLab(pixels[offset], pixels[offset + 1], pixels[offset + 2]), palette, effectiveFillCandidates);
        matchCache.set(key, index);
      }
      raw[i] = index;
      if (!subjectMask || subjectMask[i]) {
        counts[index] += 1;
        activePixelTotal += 1;
      }
      if (i > 0 && i % 12000 === 0) postProgress(34 + Math.round((i / raw.length) * 30), '正在匹配色卡');
    }
    let allowed = constrainedCandidates
      ? constrainedCandidates.filter((index) => counts[index] > 0)
      : choosePaletteIndices(counts, maxColors, activePixelTotal || raw.length, palette);
    if (mergeColors) {
      const merged = [];
      for (const index of allowed) {
        if (orderedColorCleanup && index === outlineIndex) {
          merged.push(index);
          continue;
        }
        const mergeDistance = orderedColorCleanup ? 7 : 4.5;
        const similar = merged.some((kept) => deltaE76(palette[index].lab, palette[kept].lab) < mergeDistance);
        if (!similar) merged.push(index);
      }
      allowed = merged;
    }
    if (hasProtectedOutline && !allowed.includes(outlineIndex)) {
      if (allowed.length >= Math.max(1, maxColors)) allowed[allowed.length - 1] = outlineIndex;
      else allowed.push(outlineIndex);
    }
    postProgress(68, '正在压缩颜色');
    const remap = new Map();
    const allowedFill = orderedColorCleanup && outlineIndex >= 0
      ? allowed.filter((index) => index !== outlineIndex)
      : allowed;
    for (const index of [...counts.keys()]) {
      if (allowed.includes(index)) continue;
      const candidates = orderedColorCleanup && index !== outlineIndex && allowedFill.length ? allowedFill : allowed;
      remap.set(index, nearest(palette[index].lab, palette, candidates));
    }
    for (let i = 0; i < raw.length; i += 1) if (remap.has(raw[i])) raw[i] = remap.get(raw[i]);
    postProgress(82, '正在优化图纸');
    let indices = reduceIsolated ? cleanIsolated(raw, width, height, palette, cleanupProtectedMask) : raw;
    if (hasProtectedOutline) {
      for (let i = 0; i < indices.length; i += 1) {
        if (protectedOutlineMask[i]) indices[i] = outlineIndex;
      }
    }
    if (orderedColorCleanup) {
      postProgress(88, '正在整理有序色块');
      indices = createOrderedColorPattern({
        indices,
        width,
        height,
        palette,
        pixels,
        protectedMask: cleanupProtectedMask,
        detailMask,
        reservedIndex: outlineIndex,
        activeMask: subjectMask,
      });
    }
    postProgress(94, '正在生成统计');
    self.postMessage({ type: 'result', id, width, height, indices: indices.buffer }, [indices.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Worker 生成失败' });
  }
};
