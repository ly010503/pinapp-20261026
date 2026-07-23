export const COLOR_STYLES = {
  natural: { brightness: 0, contrast: 0, saturation: 0 },
  vivid: { brightness: 2, contrast: 8, saturation: 38 },
};

export function getColorStyleAdjustments(baseAdjustments, style = 'vivid') {
  return {
    ...baseAdjustments,
    ...(COLOR_STYLES[style] || COLOR_STYLES.vivid),
  };
}
