const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

function luminance(r, g, b) {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function chroma(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function averageSamples(samples, positions = null) {
  const count = positions?.length || samples.length / 3;
  let r = 0, g = 0, b = 0;
  for (let order = 0; order < count; order += 1) {
    const position = positions ? positions[order] : order;
    const offset = position * 3;
    r += samples[offset];
    g += samples[offset + 1];
    b += samples[offset + 2];
  }
  return [r / count, g / count, b / count];
}

function blend(base, detail, weight) {
  return base.map((value, index) => clampByte(value * (1 - weight) + detail[index] * weight));
}

/**
 * 普通缩图会把细白字、黑色描边和小面积鲜艳细节平均掉。
 * 此处在每个目标格的高分辨率采样块中保留少数但对比强烈的有效笔画。
 */
export function selectDetailPreservingColor(samples) {
  const count = Math.floor(samples.length / 3);
  if (!count) return [255, 255, 255];
  const average = averageSamples(samples);
  const averageLuminance = luminance(...average);
  const orderByLuminance = [...Array(count).keys()]
    .sort((a, b) => luminance(
      samples[a * 3],
      samples[a * 3 + 1],
      samples[a * 3 + 2],
    ) - luminance(
      samples[b * 3],
      samples[b * 3 + 1],
      samples[b * 3 + 2],
    ));
  const groupSize = Math.max(2, Math.ceil(count * 0.25));
  const dark = averageSamples(samples, orderByLuminance.slice(0, groupSize));
  const bright = averageSamples(samples, orderByLuminance.slice(-groupSize));
  const darkLuminance = luminance(...dark);
  const brightLuminance = luminance(...bright);

  if (brightLuminance - darkLuminance >= 72) {
    if (averageLuminance <= 112 && brightLuminance - averageLuminance >= 42) {
      return blend(average, bright, 0.82);
    }
    if (averageLuminance >= 148 && averageLuminance - darkLuminance >= 42) {
      return blend(average, dark, 0.82);
    }
  }

  const orderByChroma = [...Array(count).keys()].sort((a, b) => chroma(
    samples[b * 3],
    samples[b * 3 + 1],
    samples[b * 3 + 2],
  ) - chroma(
    samples[a * 3],
    samples[a * 3 + 1],
    samples[a * 3 + 2],
  ));
  const colorful = averageSamples(samples, orderByChroma.slice(0, groupSize));
  const averageChroma = chroma(...average);
  const colorfulChroma = chroma(...colorful);
  if (colorfulChroma >= 58 && colorfulChroma - averageChroma >= 28) {
    return blend(average, colorful, 0.72);
  }

  return average.map(clampByte);
}
