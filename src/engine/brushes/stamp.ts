/**
 * Brush stamp factory — radial-gradient dabs + stroke spacing interpolation.
 *
 * A "stamp" is a small canvas holding a soft circular dab used by the paint
 * and retouch tools. Stamps are cached (LRU, 16 entries) keyed by
 * size|hardness|color so fast strokes reuse buffers.
 *
 * `interpolateStamps` and `stampKey` are pure math (unit-testable without
 * DOM). `makeStamp` requires a canvas implementation and returns null in
 * non-DOM runtimes (Node tests / SSR) — guard with `stampSupported()`.
 */

import { makeCanvas, ctx2d, type AnyCanvas } from '../raster';
import { hexToRgb, rgbToHex } from '../color';

const CACHE_LIMIT = 16;
const cache = new Map<string, AnyCanvas>();

/** Cache key for a stamp (pure; exported for tests). */
export function stampKey(size: number, hardness: number, color: string): string {
  const s = Math.max(1, Math.round(size));
  const h = Math.min(100, Math.max(0, Math.round(hardness)));
  return `${s}|${h}|${rgbToHex(hexToRgb(color))}`;
}

/** True when a canvas implementation exists (browser / worker). */
export function stampSupported(): boolean {
  return (
    typeof OffscreenCanvas !== 'undefined' ||
    (typeof document !== 'undefined' && typeof document.createElement === 'function')
  );
}

/**
 * Builds a radial-gradient dab: opaque core up to `hardness`% of the radius,
 * falling to transparent at the edge. Returns the SAME canvas instance for
 * repeated calls with equal args (cache hit). Returns null when no canvas
 * implementation is available (Node).
 */
export function makeStamp(size: number, hardness: number, color: string): AnyCanvas | null {
  if (!stampSupported()) return null;
  const s = Math.max(1, Math.round(size));
  const h = Math.min(100, Math.max(0, Math.round(hardness)));
  const key = stampKey(s, h, color);
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = makeCanvas(s, s);
  const ctx = ctx2d(canvas);
  const r = s / 2;
  const base = rgbToHex(hexToRgb(color));
  const core = h / 100;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, base);
  if (core >= 0.995) {
    // hard dab: opaque to (almost) the edge, then a sharp step to transparent
    grad.addColorStop(0.995, base);
  } else {
    grad.addColorStop(core, base);
  }
  grad.addColorStop(1, `${base}00`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  cache.set(key, canvas);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return canvas;
}

export interface StampPoint {
  x: number;
  y: number;
}

/**
 * Evenly spaced stamp positions along a segment, always including both
 * endpoints: count = floor(dist / spacing) + 1 points, first = (x0,y0),
 * last = (x1,y1). spacingPx is clamped to >= 1. A zero-length segment
 * yields a single point.
 */
export function interpolateStamps(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  spacingPx: number,
): StampPoint[] {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  if (dist < 1e-6) return [{ x: x0, y: y0 }];
  const spacing = Math.max(1, spacingPx);
  const count = Math.floor(dist / spacing) + 1;
  const step = count > 1 ? dist / (count - 1) : 0;
  const out: StampPoint[] = [];
  for (let i = 0; i < count; i++) {
    const t = step === 0 ? 0 : (i * step) / dist;
    out.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
  }
  return out;
}
