/**
 * Raster buffer helpers for the Canvas2D engine.
 *
 * All functions are client-side only (they create canvases / ImageData).
 * Keeps a single place that knows how buffers are created, cloned and
 * composited, so switching rendering internals later stays localized.
 */

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type AnyContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
  }
  const c = document.createElement('canvas');
  c.width = Math.max(1, width);
  c.height = Math.max(1, height);
  return c;
}

export function ctx2d(canvas: AnyCanvas): AnyContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return ctx as AnyContext2D;
}

export function cloneCanvas(src: AnyCanvas): AnyCanvas {
  const out = makeCanvas(src.width, src.height);
  ctx2d(out).drawImage(src as CanvasImageSource, 0, 0);
  return out;
}

export function makeImageData(width: number, height: number): ImageData {
  const c = makeCanvas(width, height);
  return ctx2d(c).createImageData(Math.max(1, width), Math.max(1, height));
}

export function imageDataFromCanvas(canvas: AnyCanvas): ImageData {
  return ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

export function putImageData(canvas: AnyCanvas, data: ImageData): void {
  ctx2d(canvas).putImageData(data, 0, 0);
}

/** Creates a canvas from raw RGBA pixels. */
export function canvasFromImageData(data: ImageData): AnyCanvas {
  const c = makeCanvas(data.width, data.height);
  putImageData(c, data);
  return c;
}

/** Extracts a region as ImageData. Coordinates are clamped to the canvas. */
export function getRegion(canvas: AnyCanvas, x: number, y: number, w: number, h: number): ImageData {
  const cx = Math.max(0, Math.floor(x));
  const cy = Math.max(0, Math.floor(y));
  const cw = Math.min(canvas.width - cx, Math.max(1, Math.floor(w)));
  const ch = Math.min(canvas.height - cy, Math.max(1, Math.floor(h)));
  return ctx2d(canvas).getImageData(cx, cy, cw, ch);
}

export function putRegion(canvas: AnyCanvas, data: ImageData, x: number, y: number): void {
  ctx2d(canvas).putImageData(data, Math.floor(x), Math.floor(y));
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Union of two rects (returns src if dst is null). */
export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** Intersects rect with canvas bounds; returns null when empty. */
export function clipRectToCanvas(r: Rect, width: number, height: number): Rect | null {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const x2 = Math.min(width, Math.ceil(r.x + r.w));
  const y2 = Math.min(height, Math.ceil(r.y + r.h));
  if (x2 <= x || y2 <= y) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

/** Approximate memory usage of a canvas in bytes (RGBA). */
export function canvasBytes(canvas: AnyCanvas): number {
  return canvas.width * canvas.height * 4;
}

/**
 * Renders a checkerboard transparency pattern onto a canvas context.
 * Used behind documents so transparency is visible.
 */
export function paintChecker(
  ctx: AnyContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cell = 8,
  light = '#e3e3e6',
  dark = '#c8c8cd',
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = light;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = dark;
  const startX = Math.floor(x / cell) * cell;
  const startY = Math.floor(y / cell) * cell;
  for (let yy = startY; yy < y + h; yy += cell) {
    for (let xx = startX; xx < x + w; xx += cell) {
      if ((Math.round((xx - startX) / cell) + Math.round((yy - startY) / cell)) % 2 === 0) {
        ctx.fillRect(xx, yy, cell, cell);
      }
    }
  }
  ctx.restore();
}
