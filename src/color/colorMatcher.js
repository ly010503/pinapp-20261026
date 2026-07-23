import { deltaE2000, rgbToLab } from './colorSpace.js';

export function preparePalette(palette) {
  return palette.map((color, index) => ({ ...color, index, lab: rgbToLab(...color.rgb) }));
}

export function findNearestPaletteColor(rgb, palette, distance = deltaE2000) {
  const lab = rgbToLab(...rgb);
  let nearest = palette[0], nearestDistance = Number.POSITIVE_INFINITY;
  for (const color of palette) {
    const current = distance(lab, color.lab || rgbToLab(...color.rgb));
    if (current < nearestDistance) { nearest = color; nearestDistance = current; }
  }
  return nearest;
}
