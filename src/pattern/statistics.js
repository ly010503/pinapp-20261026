export function calculateStatistics(indices, palette) {
  const counts = new Map();
  for (const index of indices) counts.set(index, (counts.get(index) || 0) + 1);
  const total = indices.length;
  return [...counts.entries()].map(([index, count]) => ({
    ...palette[index], index, count, percentage: total ? (count / total) * 100 : 0,
  })).sort((a, b) => b.count - a.count);
}

export function statisticsTotal(statistics) {
  return statistics.reduce((sum, item) => sum + item.count, 0);
}
