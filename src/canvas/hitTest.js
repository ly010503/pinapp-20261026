export function hitTestPatternCell(documentX, documentY, pattern, layout, cell) {
  if (!pattern || !layout || !Number.isFinite(documentX) || !Number.isFinite(documentY) || cell <= 0) return null;
  const x = Math.floor((documentX - layout.gridX) / cell);
  const y = Math.floor((documentY - layout.gridY) / cell);
  if (x < 0 || x >= pattern.width || y < 0 || y >= pattern.height) return null;
  const position = y * pattern.width + x;
  return { x, y, position, colorIndex: pattern.indices[position] };
}
