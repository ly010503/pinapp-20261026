function pixelLuminance(pixels, position) {
  const offset = position * 4;
  return pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722;
}

const STRUCTURE_DIRECTIONS = [
  { bit: 1, opposite: 4, dx: 0, dy: -1 },
  { bit: 2, opposite: 8, dx: 1, dy: 0 },
  { bit: 4, opposite: 1, dx: 0, dy: 1 },
  { bit: 8, opposite: 2, dx: -1, dy: 0 },
];

function connectedStructureNeighbors(position, structureEdges, width, height) {
  const x = position % width;
  const y = Math.floor(position / width);
  const edges = structureEdges[position];
  const neighbors = [];
  for (const { bit, opposite, dx, dy } of STRUCTURE_DIRECTIONS) {
    if (!(edges & bit)) continue;
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
    const neighbor = ny * width + nx;
    if (structureEdges[neighbor] & opposite) neighbors.push(neighbor);
  }
  return neighbors;
}

// 有序模式只把在格内有明确走向、并能跨格连续的深色结构升级为H7。
// 不再使用包围盒密度判断，避免发色阴影、衣服缝隙等不规则暗块整片变黑。
function createStructuredOutlineMask({
  pixels,
  width,
  height,
  candidates,
  trueBlack,
  structureEdges,
  darkCoverage,
  subjectMask,
}) {
  const mask = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  for (let start = 0; start < mask.length; start += 1) {
    if (visited[start] || !candidates[start] || !structureEdges[start]) continue;
    const stack = [start];
    const component = [];
    visited[start] = 1;
    while (stack.length) {
      const position = stack.pop();
      component.push(position);
      for (const neighbor of connectedStructureNeighbors(position, structureEdges, width, height)) {
        if (!visited[neighbor] && candidates[neighbor]) {
          visited[neighbor] = 1;
          stack.push(neighbor);
        }
      }
    }
    const averageCoverage = component.reduce(
      (sum, position) => sum + (darkCoverage?.[position] || 0),
      0,
    ) / component.length;
    if (component.length >= 3 || (component.length === 2 && averageCoverage >= 44)) {
      component.forEach((position) => { mask[position] = 1; });
    }
  }

  // 用户的图纸把“真正的纯黑材质”（墨镜、黑发、黑衣）与线稿统一为 H7，
  // 近黑的 H16/H6 只保留给肉眼可见的深灰/暖黑。高覆盖率可以区分纯黑填充和暗色阴影。
  const blackVisited = new Uint8Array(width * height);
  for (let start = 0; start < mask.length; start += 1) {
    if (blackVisited[start] || !trueBlack[start] || (subjectMask && !subjectMask[start])) continue;
    const stack = [start];
    const component = [];
    blackVisited[start] = 1;
    while (stack.length) {
      const position = stack.pop();
      component.push(position);
      const x = position % width;
      const y = Math.floor(position / width);
      const neighbors = [];
      if (x > 0) neighbors.push(position - 1);
      if (x + 1 < width) neighbors.push(position + 1);
      if (y > 0) neighbors.push(position - width);
      if (y + 1 < height) neighbors.push(position + width);
      for (const neighbor of neighbors) {
        if (!blackVisited[neighbor] && trueBlack[neighbor]
          && (!subjectMask || subjectMask[neighbor])) {
          blackVisited[neighbor] = 1;
          stack.push(neighbor);
        }
      }
    }
    const averageCoverage = component.reduce(
      (sum, position) => sum + (darkCoverage?.[position] ?? 255),
      0,
    ) / component.length;
    if (component.length >= 2 && averageCoverage >= 176) {
      component.forEach((position) => { mask[position] = 1; });
    }
  }

  // 很小但真正纯黑、并被亮色包围的五官点仍然保留；普通孤立暗纹不升级为H7。
  for (let position = 0; position < mask.length; position += 1) {
    if (mask[position] || !trueBlack[position] || (subjectMask && !subjectMask[position])) continue;
    const x = position % width;
    const y = Math.floor(position / width);
    const luminance = pixelLuminance(pixels, position);
    let brighterNeighbors = 0;
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) continue;
        const nx = x + offsetX;
        const ny = y + offsetY;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (pixelLuminance(pixels, ny * width + nx) - luminance >= 55) brighterNeighbors += 1;
      }
    }
    const coverage = darkCoverage ? darkCoverage[position] : 255;
    if (brighterNeighbors >= 5 && coverage >= 160) mask[position] = 1;
  }
  return mask;
}

/**
 * 检测缩小图中的黑色轮廓。
 * 同时保留纯黑区域，以及被较亮颜色包围的低亮度线条，
 * 避免区域平均采样把黑线稀释成灰色或棕色。
 */
export function createOutlineMask(
  pixels,
  width,
  height,
  { subjectMask = null, darkCoverage = null, structureEdges = null } = {},
) {
  const mask = new Uint8Array(width * height);
  if (!pixels?.length || !width || !height) return mask;
  const candidates = new Uint8Array(width * height);
  const trueBlack = new Uint8Array(width * height);
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
      if (subjectMask && !subjectMask[position]) continue;

      const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
      const maximum = Math.max(r, g, b);
      const minimum = Math.min(r, g, b);
      const chroma = maximum - minimum;
      const luminance = pixelLuminance(pixels, position);
      const nearBlackCore = maximum <= 58 && chroma <= 35;
      const sampledDarkLine = darkCoverage?.[position] >= 52;
      const sampledStructure = structureEdges?.[position] && darkCoverage?.[position] >= 24;
      if (nearBlackCore) {
        candidates[position] = 1;
        if (maximum <= 28 && chroma <= 12) trueBlack[position] = 1;
        continue;
      }

      if (sampledStructure || (sampledDarkLine && luminance <= 185)) candidates[position] = 1;

      if (luminance > 125 || chroma > 58) continue;
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
        && brightest - luminance >= 58
        && neighborAverage - luminance >= 26) {
        candidates[position] = 1;
      }
    }
  }

  if (structureEdges?.length === width * height) {
    return createStructuredOutlineMask({
      pixels,
      width,
      height,
      candidates,
      trueBlack,
      structureEdges,
      darkCoverage,
      subjectMask,
    });
  }

  // 轮廓通常是细长或环形的连续区域。过滤孤立暗点和实心阴影块，
  // 避免将人物纹理、发丝过渡或深色衣服强制替换成纯黑 H7。
  const visited = new Uint8Array(width * height);
  for (let start = 0; start < candidates.length; start += 1) {
    if (!candidates[start] || visited[start]) continue;
    const stack = [start];
    const component = [];
    let minX = width, minY = height, maxX = 0, maxY = 0;
    visited[start] = 1;

    while (stack.length) {
      const position = stack.pop();
      component.push(position);
      const x = position % width, y = Math.floor(position / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const [offsetX, offsetY] of neighborOffsets) {
        const nx = x + offsetX, ny = y + offsetY;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (candidates[next] && !visited[next]) {
          visited[next] = 1;
          stack.push(next);
        }
      }
    }

    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const shortSide = Math.min(componentWidth, componentHeight);
    const density = component.length / (componentWidth * componentHeight);
    const lineLike = component.length >= 3 && (shortSide <= 2 || density <= 0.58);
    if (lineLike) {
      component.forEach((position) => { mask[position] = 1; });
      continue;
    }

    // 实心暗色块只能贡献边缘或细线脊，不能因为其中有一个纯黑格就整块升级为 H7。
    for (const position of component) {
      const x = position % width, y = Math.floor(position / width);
      const luminance = pixelLuminance(pixels, position);
      let candidateNeighbors = 0;
      let cardinalCandidateNeighbors = 0;
      let brighterNeighbors = 0;
      for (const [offsetX, offsetY] of neighborOffsets) {
        const nx = x + offsetX, ny = y + offsetY;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (candidates[neighbor]) {
          candidateNeighbors += 1;
          if (offsetX === 0 || offsetY === 0) cardinalCandidateNeighbors += 1;
        }
        if (pixelLuminance(pixels, neighbor) - luminance >= 34) brighterNeighbors += 1;
      }
      const left = x > 0 ? position - 1 : -1;
      const right = x + 1 < width ? position + 1 : -1;
      const top = y > 0 ? position - width : -1;
      const bottom = y + 1 < height ? position + width : -1;
      const horizontalStroke = component.length >= 2
        && left >= 0 && right >= 0 && !candidates[left] && !candidates[right]
        && ((top >= 0 && candidates[top]) || (bottom >= 0 && candidates[bottom]));
      const verticalStroke = component.length >= 2
        && top >= 0 && bottom >= 0 && !candidates[top] && !candidates[bottom]
        && ((left >= 0 && candidates[left]) || (right >= 0 && candidates[right]));
      const locallyThin = component.length >= 3
        && cardinalCandidateNeighbors >= 1
        && candidateNeighbors <= 4
        && brighterNeighbors >= 2;
      const isolatedBlackDetail = component.length <= 2 && trueBlack[position] && brighterNeighbors >= 3;
      if (horizontalStroke || verticalStroke || locallyThin || isolatedBlackDetail) mask[position] = 1;
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
