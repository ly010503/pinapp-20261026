function applySharpen(imageData, amount) {
  if (amount <= 0) return imageData;
  const { data, width, height } = imageData;
  const source = new Uint8ClampedArray(data);
  const strength = Math.min(amount / 100, 0.8);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = source[offset + channel] * (1 + 4 * strength)
          - strength * (source[offset - 4 + channel] + source[offset + 4 + channel] + source[offset - width * 4 + channel] + source[offset + width * 4 + channel]);
        data[offset + channel] = Math.max(0, Math.min(255, value));
      }
    }
  }
  return imageData;
}

export function createAdjustedCanvas(image, transform, adjustments, maxDimension = 1800, crop = null) {
  const rotated = Math.abs(transform.rotation % 180) === 90;
  const naturalW = image.naturalWidth || image.width;
  const naturalH = image.naturalHeight || image.height;
  const sourceX = crop ? Math.max(0, Math.min(naturalW - 1, crop.x)) : 0;
  const sourceY = crop ? Math.max(0, Math.min(naturalH - 1, crop.y)) : 0;
  const sourceW = crop ? Math.max(1, Math.min(naturalW - sourceX, crop.width)) : naturalW;
  const sourceH = crop ? Math.max(1, Math.min(naturalH - sourceY, crop.height)) : naturalH;
  const scale = Math.min(1, maxDimension / Math.max(sourceW, sourceH));
  const drawW = Math.max(1, Math.round(sourceW * scale));
  const drawH = Math.max(1, Math.round(sourceH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = rotated ? drawH : drawW;
  canvas.height = rotated ? drawW : drawH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(transform.flipH ? -1 : 1, transform.flipV ? -1 : 1);
  const brightness = 100 + adjustments.brightness;
  const contrast = 100 + adjustments.contrast;
  const saturation = 100 + adjustments.saturation;
  const blur = Math.max(0, adjustments.smoothing / 125);
  ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) blur(${blur}px)`;
  ctx.drawImage(image, sourceX, sourceY, sourceW, sourceH, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
  if (adjustments.sharpen > 0) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.putImageData(applySharpen(imageData, adjustments.sharpen), 0, 0);
  }
  return canvas;
}

function getFittedSourceRect(sourceCanvas, width, height) {
  const sourceRatio = sourceCanvas.width / sourceCanvas.height;
  const targetRatio = width / height;
  let sx = 0, sy = 0, sw = sourceCanvas.width, sh = sourceCanvas.height;
  if (sourceRatio > targetRatio) { sw = sourceCanvas.height * targetRatio; sx = (sourceCanvas.width - sw) / 2; }
  else { sh = sourceCanvas.width / targetRatio; sy = (sourceCanvas.height - sh) / 2; }
  return { sx, sy, sw, sh };
}

function channelMedian(values) {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 255;
}

function sampleLuminance(sample) {
  return sample[0] * 0.2126 + sample[1] * 0.7152 + sample[2] * 0.0722;
}

function sampleDistanceSquared(first, second) {
  const red = first[0] - second[0];
  const green = first[1] - second[1];
  const blue = first[2] - second[2];
  return red * red + green * green + blue * blue;
}

// 从格内真实采样点中选出主色代表，避免分别取RGB中位数后拼出原图不存在的颜色。
function selectRepresentativeSample(samples, clusterRadius = 38) {
  if (!samples.length) return [255, 255, 255];
  const maximumDistance = clusterRadius * clusterRadius;
  let best = samples[0];
  let bestNeighbors = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of samples) {
    let neighbors = 0;
    let distance = 0;
    for (const sample of samples) {
      const current = sampleDistanceSquared(candidate, sample);
      if (current <= maximumDistance) {
        neighbors += 1;
        distance += current;
      }
    }
    if (neighbors > bestNeighbors || (neighbors === bestNeighbors && distance < bestDistance)) {
      best = candidate;
      bestNeighbors = neighbors;
      bestDistance = distance;
    }
  }
  return best;
}

function estimateBorderBackground(pixels, width, height) {
  const channels = [[], [], []];
  const collect = (position) => {
    const offset = position * 4;
    if (pixels[offset + 3] < 24) return;
    channels[0].push(pixels[offset]);
    channels[1].push(pixels[offset + 1]);
    channels[2].push(pixels[offset + 2]);
  };
  for (let x = 0; x < width; x += 1) {
    collect(x);
    if (height > 1) collect((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    collect(y * width);
    if (width > 1) collect(y * width + width - 1);
  }
  return channels.map(channelMedian);
}

/**
 * 查找纯色背景上的主体边界。仅供“有序”模式自动取景使用；
 * 找不到可靠主体时返回 null，让调用方保留原有整图取景。
 */
export function findForegroundBounds(pixels, width, height, threshold = 24) {
  if (!pixels?.length || width <= 0 || height <= 0) return null;
  const background = estimateBorderBackground(pixels, width, height);
  // 有序模式的素材约定为浅色纯背景。照片或复杂背景不自动改构图。
  if (Math.min(...background) < 220) return null;
  let minX = width, minY = height, maxX = -1, maxY = -1, foregroundCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const position = y * width + x;
      const offset = position * 4;
      if (pixels[offset + 3] < 24) continue;
      const distance = Math.hypot(
        pixels[offset] - background[0],
        pixels[offset + 1] - background[1],
        pixels[offset + 2] - background[2],
      );
      if (distance <= threshold) continue;
      foregroundCount += 1;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const coverage = foregroundCount / (width * height);
  if (maxX < minX || maxY < minY || coverage < 0.002 || coverage > 0.92) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function expandForegroundBounds(bounds, sourceWidth, sourceHeight, paddingRatio = 0.055) {
  if (!bounds) return { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  const paddingX = Math.max(2, Math.round(bounds.width * paddingRatio));
  const paddingY = Math.max(2, Math.round(bounds.height * paddingRatio));
  const x = Math.max(0, bounds.x - paddingX);
  const y = Math.max(0, bounds.y - paddingY);
  const right = Math.min(sourceWidth, bounds.x + bounds.width + paddingX);
  const bottom = Math.min(sourceHeight, bounds.y + bounds.height + paddingY);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function getContainedDrawRect(sourceRect, targetWidth, targetHeight, margin = 0) {
  const availableWidth = Math.max(1, targetWidth - margin * 2);
  const availableHeight = Math.max(1, targetHeight - margin * 2);
  const scale = Math.min(availableWidth / sourceRect.width, availableHeight / sourceRect.height);
  const width = Math.max(1, sourceRect.width * scale);
  const height = Math.max(1, sourceRect.height * scale);
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

export function summarizeGridSamples(imageData, gridWidth, gridHeight) {
  const { data, width: sampleWidth, height: sampleHeight } = imageData;
  if (!data?.length || sampleWidth % gridWidth || sampleHeight % gridHeight) {
    throw new Error('有序模式采样尺寸不匹配');
  }
  const scaleX = sampleWidth / gridWidth;
  const scaleY = sampleHeight / gridHeight;
  const pixels = new Uint8ClampedArray(gridWidth * gridHeight * 4);
  const darkCoverage = new Uint8Array(gridWidth * gridHeight);
  const structureEdges = new Uint8Array(gridWidth * gridHeight);
  const detailMask = new Uint8Array(gridWidth * gridHeight);

  for (let gridY = 0; gridY < gridHeight; gridY += 1) {
    for (let gridX = 0; gridX < gridWidth; gridX += 1) {
      const samples = [];
      for (let y = gridY * scaleY; y < (gridY + 1) * scaleY; y += 1) {
        for (let x = gridX * scaleX; x < (gridX + 1) * scaleX; x += 1) {
          const offset = (y * sampleWidth + x) * 4;
          samples.push([data[offset], data[offset + 1], data[offset + 2]]);
        }
      }
      const position = gridY * gridWidth + gridX;
      const offset = position * 4;
      const representative = selectRepresentativeSample(samples);
      pixels[offset] = representative[0];
      pixels[offset + 1] = representative[1];
      pixels[offset + 2] = representative[2];
      pixels[offset + 3] = 255;
      const luminance = samples.map(sampleLuminance);
      const representativeLuminance = sampleLuminance(representative);
      const darkThreshold = Math.max(18, Math.min(132, representativeLuminance - 36));
      const darkSamples = luminance.map((value) => value <= darkThreshold);
      const minimumLuminance = Math.min(...luminance);
      const maximumLuminance = Math.max(...luminance);
      const flatDarkFill = representativeLuminance <= 62 && maximumLuminance - minimumLuminance <= 30;
      const darkCount = flatDarkFill
        ? luminance.filter((value) => value <= 72).length
        : darkSamples.filter(Boolean).length;
      darkCoverage[position] = Math.round((darkCount / Math.max(1, samples.length)) * 255);

      const maximumColorDistance = Math.sqrt(Math.max(
        0,
        ...samples.map((sample) => sampleDistanceSquared(sample, representative)),
      ));
      if (darkCount && !flatDarkFill) {
        let edges = 0;
        for (let localY = 0; localY < scaleY; localY += 1) {
          for (let localX = 0; localX < scaleX; localX += 1) {
            if (!darkSamples[localY * scaleX + localX]) continue;
            if (localY === 0) edges |= 1;
            if (localX === scaleX - 1) edges |= 2;
            if (localY === scaleY - 1) edges |= 4;
            if (localX === 0) edges |= 8;
          }
        }
        structureEdges[position] = edges;
      }
      if ((darkCount > 0 && darkCount < samples.length && structureEdges[position])
        || maximumColorDistance >= 48
        || maximumLuminance - minimumLuminance >= 52) {
        detailMask[position] = 1;
      }
    }
  }
  return { pixels, darkCoverage, structureEdges, detailMask };
}

export function getGridPixels(sourceCanvas, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
  const { sx, sy, sw, sh } = getFittedSourceRect(sourceCanvas, width, height);
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

export function getGridSubjectSamples(sourceCanvas, width, height, scale = 4) {
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const { sx, sy, sw, sh } = getFittedSourceRect(sourceCanvas, width, height);
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * “有序”模式专用采样：先去除素材自带的大白边，再以每格 4×4 子采样
 * 分离实际主填充色、暗线覆盖率、结构走向和细节区域。其他颜色模式继续使用 getGridPixels。
 */
export function getOrderedGridData(sourceCanvas, width, height, scale = 4) {
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const sourceImageData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const bounds = findForegroundBounds(sourceImageData.data, sourceCanvas.width, sourceCanvas.height);
  const sourceRect = expandForegroundBounds(bounds, sourceCanvas.width, sourceCanvas.height);
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const destination = getContainedDrawRect(sourceRect, canvas.width, canvas.height, scale * 2);
  ctx.drawImage(
    sourceCanvas,
    sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height,
    destination.x, destination.y, destination.width, destination.height,
  );
  const samples = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { ...summarizeGridSamples(samples, width, height), samples };
}
