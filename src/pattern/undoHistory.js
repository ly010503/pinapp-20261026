export function createPatternSnapshot(pattern) {
  if (!pattern?.indices?.slice) return null;
  return pattern.indices.slice();
}

export function pushPatternSnapshot(history, snapshot, limit = 20) {
  if (!Array.isArray(history) || !(snapshot instanceof Uint8Array)) return false;
  history.push(snapshot);
  while (history.length > Math.max(1, limit)) history.shift();
  return true;
}

export function restorePatternSnapshot(history, pattern) {
  if (!Array.isArray(history) || !pattern?.indices?.set) return false;
  while (history.length) {
    const snapshot = history.pop();
    if (snapshot instanceof Uint8Array && snapshot.length === pattern.indices.length) {
      pattern.indices.set(snapshot);
      return true;
    }
  }
  return false;
}
