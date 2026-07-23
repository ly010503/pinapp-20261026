const number = new Intl.NumberFormat('zh-CN');
export const GUIDE_STEP = 5;

export function getCoordinateValues(length, step = GUIDE_STEP) {
  const values = [1];
  for (let value = step; value <= length; value += step) {
    if (value !== 1) values.push(value);
  }
  return values;
}

export function colorLuminance(rgb) {
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r); ctx.closePath();
}

function drawBrand(ctx, x, y, scale = 1) {
  const colors = ['#9C8AE6', '#F3B7C8', '#F3D77A', '#9DD9C2', '#8CC9E8', '#BFA9F2'];
  colors.forEach((color, index) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + (index % 3) * 10 * scale, y + Math.floor(index / 3) * 10 * scale, 3.8 * scale, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function getSheetLayout(pattern, statistics, cell) {
  const padding = Math.max(28, Math.round(cell * 1.6));
  const coordinate = Math.max(24, Math.round(cell * 1.25));
  const header = Math.max(56, Math.round(cell * 2.6));
  const gridWidth = pattern.width * cell;
  const gridHeight = pattern.height * cell;
  const paperWidth = Math.max(gridWidth + (padding + coordinate) * 2, Math.round(cell * 22));
  const cardGap = Math.max(6, Math.round(cell * 0.3));
  const cardWidth = Math.max(70, Math.round(cell * 4));
  const cardHeight = Math.max(44, Math.round(cell * 2.2));
  const available = paperWidth - padding * 2;
  const columns = Math.max(3, Math.floor((available + cardGap) / (cardWidth + cardGap)));
  const rows = Math.ceil(statistics.length / columns);
  const legendHeight = rows * cardHeight + Math.max(0, rows - 1) * cardGap;
  const gridX = Math.round((paperWidth - gridWidth) / 2);
  const gridY = header + coordinate;
  const legendY = gridY + gridHeight + coordinate + Math.max(22, cell);
  const statsHeight = Math.max(56, Math.round(cell * 2.6));
  const paperHeight = legendY + legendHeight + statsHeight + padding;
  return { padding, coordinate, header, gridWidth, gridHeight, paperWidth, paperHeight, gridX, gridY, legendY, cardGap, cardWidth, cardHeight, columns, statsHeight };
}

export function drawEffect(ctx, pattern, palette, { cell = 10, highlightedCode = null, background = '#FFFDF8' } = {}) {
  const padding = Math.max(18, cell * 2);
  const width = pattern.width * cell + padding * 2;
  const height = pattern.height * cell + padding * 2;
  ctx.canvas.width = width; ctx.canvas.height = height;
  ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  for (let y = 0; y < pattern.height; y += 1) for (let x = 0; x < pattern.width; x += 1) {
    const color = palette[pattern.indices[y * pattern.width + x]];
    ctx.globalAlpha = highlightedCode && color.code !== highlightedCode ? 0.16 : 1;
    ctx.fillStyle = color.hex;
    ctx.fillRect(padding + x * cell, padding + y * cell, cell, cell);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(98, 90, 110, .14)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0; x <= pattern.width; x += 1) { const px = padding + x * cell + 0.5; ctx.moveTo(px, padding); ctx.lineTo(px, padding + pattern.height * cell); }
  for (let y = 0; y <= pattern.height; y += 1) { const py = padding + y * cell + 0.5; ctx.moveTo(padding, py); ctx.lineTo(padding + pattern.width * cell, py); }
  ctx.stroke();
  return { width, height };
}

export function drawPatternSheet(ctx, pattern, palette, statistics, { cell = 14, highlightedCode = null, title = '我的拼豆制作图' } = {}) {
  const layout = getSheetLayout(pattern, statistics, cell);
  const { paperWidth, paperHeight, gridX, gridY, gridWidth, gridHeight } = layout;
  ctx.canvas.width = paperWidth; ctx.canvas.height = paperHeight;
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, paperWidth, paperHeight);

  drawBrand(ctx, layout.padding, Math.max(20, layout.header * 0.35), Math.max(0.8, cell / 16));
  ctx.fillStyle = '#34313B'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.max(16, Math.round(cell * 0.9))}px "PingFang SC", sans-serif`;
  ctx.fillText('拼豆图纸生成器', layout.padding + Math.max(36, cell * 2.2), layout.header * 0.45);
  ctx.textAlign = 'right'; ctx.fillStyle = '#8A8495'; ctx.font = `500 ${Math.max(11, Math.round(cell * 0.55))}px sans-serif`;
  ctx.fillText(title, paperWidth - layout.padding, layout.header * 0.45);

  for (let y = 0; y < pattern.height; y += 1) for (let x = 0; x < pattern.width; x += 1) {
    const color = palette[pattern.indices[y * pattern.width + x]];
    ctx.globalAlpha = highlightedCode && color.code !== highlightedCode ? 0.14 : 1;
    ctx.fillStyle = color.hex;
    ctx.fillRect(gridX + x * cell, gridY + y * cell, cell, cell);
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = '#C9CDD5'; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0; x <= pattern.width; x += 1) { const px = Math.round(gridX + x * cell) + 0.5; ctx.moveTo(px, gridY); ctx.lineTo(px, gridY + gridHeight); }
  for (let y = 0; y <= pattern.height; y += 1) { const py = Math.round(gridY + y * cell) + 0.5; ctx.moveTo(gridX, py); ctx.lineTo(gridX + gridWidth, py); }
  ctx.stroke();

  ctx.strokeStyle = '#8982A8'; ctx.lineWidth = Math.max(2, Math.round(cell / 7)); ctx.beginPath();
  for (let x = GUIDE_STEP; x < pattern.width; x += GUIDE_STEP) { const px = Math.round(gridX + x * cell); ctx.moveTo(px, gridY); ctx.lineTo(px, gridY + gridHeight); }
  for (let y = GUIDE_STEP; y < pattern.height; y += GUIDE_STEP) { const py = Math.round(gridY + y * cell); ctx.moveTo(gridX, py); ctx.lineTo(gridX + gridWidth, py); }
  ctx.stroke();
  ctx.strokeStyle = '#706A88'; ctx.lineWidth = Math.max(2, Math.round(cell / 6));
  ctx.strokeRect(Math.round(gridX), Math.round(gridY), gridWidth, gridHeight);

  ctx.font = `700 ${Math.max(6, Math.floor(cell * 0.4))}px "Arial Narrow", Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (let y = 0; y < pattern.height; y += 1) for (let x = 0; x < pattern.width; x += 1) {
    const color = palette[pattern.indices[y * pattern.width + x]];
    const dark = colorLuminance(color.rgb) < 0.36;
    const tx = gridX + (x + 0.5) * cell, ty = gridY + (y + 0.52) * cell;
    ctx.lineWidth = Math.max(0.75, cell * 0.045);
    ctx.strokeStyle = dark ? 'rgba(0,0,0,.38)' : 'rgba(255,255,255,.76)';
    ctx.fillStyle = dark ? '#FFFFFF' : '#25232B';
    ctx.strokeText(color.code, tx, ty, cell - 2);
    ctx.fillText(color.code, tx, ty, cell - 2);
  }

  ctx.fillStyle = '#565A63'; ctx.font = `700 ${Math.max(9, Math.round(cell * 0.5))}px Arial, sans-serif`; ctx.textAlign = 'center';
  const xValues = getCoordinateValues(pattern.width);
  const yValues = getCoordinateValues(pattern.height);
  xValues.forEach((value) => { const px = gridX + (value - 0.5) * cell; ctx.fillText(value, px, gridY - layout.coordinate * 0.5); ctx.fillText(value, px, gridY + gridHeight + layout.coordinate * 0.5); });
  yValues.forEach((value) => { const py = gridY + (value - 0.5) * cell; ctx.textAlign = 'right'; ctx.fillText(value, gridX - 7, py); ctx.textAlign = 'left'; ctx.fillText(value, gridX + gridWidth + 7, py); });

  statistics.forEach((item, index) => {
    const column = index % layout.columns, row = Math.floor(index / layout.columns);
    const usedWidth = layout.columns * layout.cardWidth + (layout.columns - 1) * layout.cardGap;
    const startX = Math.round((paperWidth - usedWidth) / 2);
    const x = startX + column * (layout.cardWidth + layout.cardGap);
    const y = layout.legendY + row * (layout.cardHeight + layout.cardGap);
    ctx.fillStyle = item.hex; roundRect(ctx, x, y, layout.cardWidth, layout.cardHeight, Math.max(5, cell * 0.35)); ctx.fill();
    ctx.strokeStyle = 'rgba(60,58,65,.18)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = colorLuminance(item.rgb) < 0.36 ? '#FFFFFF' : '#2E2C35'; ctx.textAlign = 'center';
    ctx.font = `700 ${Math.max(10, Math.round(cell * 0.58))}px Arial, sans-serif`; ctx.fillText(item.code, x + layout.cardWidth / 2, y + layout.cardHeight * 0.36);
    ctx.font = `600 ${Math.max(9, Math.round(cell * 0.47))}px "PingFang SC", sans-serif`; ctx.fillText(`${number.format(item.count)}颗`, x + layout.cardWidth / 2, y + layout.cardHeight * 0.72);
  });

  const total = pattern.width * pattern.height;
  const statsY = paperHeight - layout.padding - layout.statsHeight * 0.46;
  ctx.textAlign = 'right'; ctx.fillStyle = '#7666B3'; ctx.font = `700 ${Math.max(12, Math.round(cell * 0.65))}px "PingFang SC", sans-serif`;
  ctx.fillText(`共${statistics.length}色　总计${number.format(total)}颗`, paperWidth - layout.padding, statsY - 9);
  ctx.fillStyle = '#625E69'; ctx.font = `500 ${Math.max(10, Math.round(cell * 0.52))}px "PingFang SC", sans-serif`;
  ctx.fillText(`图纸尺寸：${pattern.width} × ${pattern.height}格`, paperWidth - layout.padding, statsY + 14);
  return layout;
}
