import { DEFAULT_SIZE } from './config.js';

const state = {
  image: null,
  imageUrl: null,
  file: null,
  imageInfo: null,
  crop: null,
  transform: { rotation: 0, flipH: false, flipV: false },
  adjustments: { brightness: 0, contrast: 0, saturation: 0, sharpen: 10, smoothing: 10 },
  palette: [],
  maxColors: 24,
  currentSize: { ...DEFAULT_SIZE },
  currentPattern: null,
  previewMode: 'effect',
  viewport: { zoom: 1, x: 0, y: 0 },
  statistics: [],
  highlightedCode: null,
  generating: false,
  dirty: false,
  options: { reduceIsolated: true, mergeColors: true },
};

const listeners = new Set();
export const store = {
  get: () => state,
  update(patch, reason = 'update') {
    Object.assign(state, patch);
    listeners.forEach((listener) => listener(state, reason));
  },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
};
