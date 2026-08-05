function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label}必须是正整数`);
  return value;
}

function copyGrid(source, sourceWidth, targetWidth, targetHeight, left, top, channels = 1) {
  const output = new source.constructor(targetWidth * targetHeight * channels);
  for (let row = 0; row < targetHeight; row += 1) {
    const sourceStart = ((top + row) * sourceWidth + left) * channels;
    const sourceEnd = sourceStart + targetWidth * channels;
    output.set(source.subarray(sourceStart, sourceEnd), row * targetWidth * channels);
  }
  return output;
}

function isByteArray(value) {
  return value instanceof Uint8Array || value instanceof Uint8ClampedArray;
}

export function getPatternCropInsets(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  requirePositiveInteger(sourceWidth, '原图纸宽度');
  requirePositiveInteger(sourceHeight, '原图纸高度');
  requirePositiveInteger(targetWidth, '目标宽度');
  requirePositiveInteger(targetHeight, '目标高度');
  if (targetWidth > sourceWidth || targetHeight > sourceHeight) {
    throw new Error('目标尺寸不能大于当前图纸');
  }

  const removedColumns = sourceWidth - targetWidth;
  const removedRows = sourceHeight - targetHeight;
  return {
    left: Math.ceil(removedColumns / 2),
    right: Math.floor(removedColumns / 2),
    top: Math.ceil(removedRows / 2),
    bottom: Math.floor(removedRows / 2),
  };
}

export function cropPattern(pattern, targetWidth, targetHeight) {
  const sourceWidth = requirePositiveInteger(pattern?.width, '原图纸宽度');
  const sourceHeight = requirePositiveInteger(pattern?.height, '原图纸高度');
  if (!(pattern.indices instanceof Uint8Array) || pattern.indices.length !== sourceWidth * sourceHeight) {
    throw new Error('图纸颜色数据长度不正确');
  }

  const insets = getPatternCropInsets(sourceWidth, sourceHeight, targetWidth, targetHeight);
  if (targetWidth === sourceWidth && targetHeight === sourceHeight) {
    throw new Error('目标尺寸需要比当前图纸至少小一行或一列');
  }

  const cropped = {
    ...pattern,
    width: targetWidth,
    height: targetHeight,
    indices: copyGrid(pattern.indices, sourceWidth, targetWidth, targetHeight, insets.left, insets.top),
  };

  if (pattern.sourcePixels != null) {
    if (!isByteArray(pattern.sourcePixels)
      || pattern.sourcePixels.length !== sourceWidth * sourceHeight * 4) {
      throw new Error('图纸原始采样数据长度不正确');
    }
    cropped.sourcePixels = copyGrid(
      pattern.sourcePixels,
      sourceWidth,
      targetWidth,
      targetHeight,
      insets.left,
      insets.top,
      4,
    );
  }

  if (pattern.backgroundMask != null) {
    if (!(pattern.backgroundMask instanceof Uint8Array)
      || pattern.backgroundMask.length !== sourceWidth * sourceHeight) {
      throw new Error('图纸背景数据长度不正确');
    }
    cropped.backgroundMask = copyGrid(
      pattern.backgroundMask,
      sourceWidth,
      targetWidth,
      targetHeight,
      insets.left,
      insets.top,
    );
  }

  return { pattern: cropped, insets };
}
