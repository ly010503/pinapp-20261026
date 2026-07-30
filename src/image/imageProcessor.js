import { enhanceGridDetails } from './detailSampler.js';

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

export function getGridPixels(sourceCanvas, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const sourceRatio = sourceCanvas.width / sourceCanvas.height;
  const targetRatio = width / height;
  let sx = 0, sy = 0, sw = sourceCanvas.width, sh = sourceCanvas.height;
  if (sourceRatio > targetRatio) { sw = sourceCanvas.height * targetRatio; sx = (sourceCanvas.width - sw) / 2; }
  else { sh = sourceCanvas.width / targetRatio; sy = (sourceCanvas.height - sh) / 2; }
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return enhanceGridDetails(pixels, width, height);
}
