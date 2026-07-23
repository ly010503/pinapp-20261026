import { drawEffect, drawPatternSheet } from './patternPainter.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class ResultCanvasRenderer {
  constructor(canvas, stage, getState) {
    this.canvas = canvas; this.stage = stage; this.getState = getState;
    this.ctx = canvas.getContext('2d'); this.documentCanvas = document.createElement('canvas');
    this.pointers = new Map(); this.dragOrigin = null; this.pinchOrigin = null;
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(stage);
    this.bind();
  }

  rebuild() {
    const state = this.getState(), pattern = state.currentPattern;
    if (!pattern) return;
    const ctx = this.documentCanvas.getContext('2d');
    if (state.previewMode === 'effect') {
      const cell = Math.max(6, Math.min(13, Math.floor(700 / pattern.width)));
      drawEffect(ctx, pattern, state.palette, { cell, highlightedCode: state.highlightedCode });
    } else {
      const cell = pattern.width <= 30 ? 22 : pattern.width <= 40 ? 20 : pattern.width <= 60 ? 18 : 16;
      drawPatternSheet(ctx, pattern, state.palette, state.statistics, { cell, highlightedCode: state.highlightedCode });
    }
    this.draw();
  }

  resize() {
    const rect = this.stage.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr)); this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`; this.canvas.style.height = `${rect.height}px`; this.draw();
  }

  fit() { const viewport = this.getState().viewport; viewport.zoom = 1; viewport.x = 0; viewport.y = 0; this.draw(); }

  getFitScale() {
    if (!this.documentCanvas.width) return 1;
    return Math.min((this.stage.clientWidth - 24) / this.documentCanvas.width, (this.stage.clientHeight - 24) / this.documentCanvas.height);
  }

  zoomAt(factor, clientX, clientY) {
    const viewport = this.getState().viewport, old = viewport.zoom;
    viewport.zoom = clamp(old * factor, 0.5, 8);
    const ratio = viewport.zoom / old, rect = this.stage.getBoundingClientRect();
    const x = clientX - rect.left - rect.width / 2, y = clientY - rect.top - rect.height / 2;
    viewport.x = x - (x - viewport.x) * ratio; viewport.y = y - (y - viewport.y) * ratio; this.draw();
  }

  draw() {
    const dpr = Math.min(devicePixelRatio || 1, 2), width = this.canvas.width / dpr, height = this.canvas.height / dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.ctx.fillStyle = '#EDE8F5'; this.ctx.fillRect(0, 0, width, height);
    if (!this.documentCanvas.width) return;
    const viewport = this.getState().viewport, scale = this.getFitScale() * viewport.zoom;
    const drawW = this.documentCanvas.width * scale, drawH = this.documentCanvas.height * scale;
    const x = (width - drawW) / 2 + viewport.x, y = (height - drawH) / 2 + viewport.y;
    this.ctx.save(); this.ctx.shadowColor = 'rgba(72, 59, 93, .16)'; this.ctx.shadowBlur = 18; this.ctx.shadowOffsetY = 7;
    this.ctx.drawImage(this.documentCanvas, x, y, drawW, drawH); this.ctx.restore();
  }

  bind() {
    this.stage.addEventListener('wheel', (event) => { event.preventDefault(); this.zoomAt(event.deltaY < 0 ? 1.12 : 0.89, event.clientX, event.clientY); }, { passive: false });
    this.stage.addEventListener('pointerdown', (event) => {
      this.stage.setPointerCapture(event.pointerId); this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const viewport = this.getState().viewport;
      if (this.pointers.size === 1) this.dragOrigin = { x: event.clientX, y: event.clientY, vx: viewport.x, vy: viewport.y };
      if (this.pointers.size === 2) this.startPinch();
    });
    this.stage.addEventListener('pointermove', (event) => {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const viewport = this.getState().viewport;
      if (this.pointers.size === 1 && this.dragOrigin) { viewport.x = this.dragOrigin.vx + event.clientX - this.dragOrigin.x; viewport.y = this.dragOrigin.vy + event.clientY - this.dragOrigin.y; this.draw(); }
      if (this.pointers.size === 2 && this.pinchOrigin) {
        const [a, b] = [...this.pointers.values()], distance = Math.hypot(a.x - b.x, a.y - b.y);
        viewport.zoom = clamp(this.pinchOrigin.zoom * distance / this.pinchOrigin.distance, 0.5, 8); this.draw();
      }
    });
    const end = (event) => { this.pointers.delete(event.pointerId); if (this.pointers.size < 2) this.pinchOrigin = null; if (this.pointers.size === 1) { const point = [...this.pointers.values()][0], v = this.getState().viewport; this.dragOrigin = { x: point.x, y: point.y, vx: v.x, vy: v.y }; } };
    this.stage.addEventListener('pointerup', end); this.stage.addEventListener('pointercancel', end);
    this.stage.addEventListener('dblclick', (event) => { const viewport = this.getState().viewport; if (viewport.zoom > 1.05) this.fit(); else this.zoomAt(2, event.clientX, event.clientY); });
  }

  startPinch() { const [a, b] = [...this.pointers.values()]; this.pinchOrigin = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: this.getState().viewport.zoom }; }
}
