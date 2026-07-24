export function replacePatternColor(pattern, fromIndex, toIndex) {
  if (!pattern?.indices
    || !Number.isInteger(fromIndex)
    || !Number.isInteger(toIndex)
    || fromIndex < 0
    || toIndex < 0
    || fromIndex > 255
    || toIndex > 255
    || fromIndex === toIndex) {
    return 0;
  }

  let replaced = 0;
  for (let index = 0; index < pattern.indices.length; index += 1) {
    if (pattern.indices[index] === fromIndex) {
      pattern.indices[index] = toIndex;
      replaced += 1;
    }
  }
  return replaced;
}
