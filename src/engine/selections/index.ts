/**
 * Selection engine — coverage masks + geometric outlines for marching ants.
 *
 * A selection is an 8-bit coverage mask over the whole document plus a list
 * of outline polylines used for the "marching ants" visualization.
 *
 * Foundation set: rect, ellipse, polygon (lasso), flood-fill (magic wand),
 * combine (replace/add/subtract/intersect), invert, feather, expand,
 * contract, all, none, bounds.
 * Advanced edge tracing & refinements extend this module.
 */

import type { Selection, SelectionOutline } from '../types';
import { luma601 } from '../color';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export function emptyMask(w: number, h: number): Uint8ClampedArray {
  return new Uint8ClampedArray(w * h);
}

export function fullMask(w: number, h: number): Uint8ClampedArray {
  const m = new Uint8ClampedArray(w * h);
  m.fill(255);
  return m;
}

export function computeBounds(mask: Uint8ClampedArray, w: number, h: number): Selection['bounds'] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function finalize(mask: Uint8ClampedArray, w: number, h: number, source: string, outline?: SelectionOutline): Selection | null {
  const bounds = computeBounds(mask, w, h);
  if (!bounds) return null;
  return {
    width: w,
    height: h,
    mask,
    bounds,
    outline: outline ?? traceOutline(mask, w, h),
    source,
  };
}

/* ------------------------------------------------------------------ */
/* geometric selections                                                */
/* ------------------------------------------------------------------ */

export function rectSelection(x: number, y: number, w: number, h: number, docW: number, docH: number): Selection | null {
  const mask = emptyMask(docW, docH);
  const x0 = Math.max(0, Math.floor(Math.min(x, x + w)));
  const y0 = Math.max(0, Math.floor(Math.min(y, y + h)));
  const x1 = Math.min(docW, Math.ceil(Math.max(x, x + w)));
  const y1 = Math.min(docH, Math.ceil(Math.max(y, y + h)));
  for (let yy = y0; yy < y1; yy++) mask.fill(255, yy * docW + x0, yy * docW + x1);
  return finalize(mask, docW, docH, 'marquee-rect', [[x0, y0, x1, y0, x1, y1, x0, y1, x0, y0]]);
}

export function ellipseSelection(x: number, y: number, w: number, h: number, docW: number, docH: number): Selection | null {
  const mask = emptyMask(docW, docH);
  const x0 = Math.max(0, Math.floor(Math.min(x, x + w)));
  const y0 = Math.max(0, Math.floor(Math.min(y, y + h)));
  const x1 = Math.min(docW, Math.ceil(Math.max(x, x + w)));
  const y1 = Math.min(docH, Math.ceil(Math.max(y, y + h)));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.max(0.5, (x1 - x0) / 2);
  const ry = Math.max(0.5, (y1 - y0) / 2);
  const outline: number[] = [];
  for (let a = 0; a <= 64; a++) {
    const t = (a / 64) * Math.PI * 2;
    outline.push(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry);
  }
  for (let yy = y0; yy < y1; yy++) {
    const dy = (yy + 0.5 - cy) / ry;
    const span = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
    const sx = Math.max(x0, Math.floor(cx - span));
    const ex = Math.min(x1, Math.ceil(cx + span));
    if (ex > sx) mask.fill(255, yy * docW + sx, yy * docW + ex);
  }
  return finalize(mask, docW, docH, 'marquee-ellipse', [outline]);
}

export function polygonSelection(points: number[][], docW: number, docH: number): Selection | null {
  if (points.length < 3) return null;
  const mask = emptyMask(docW, docH);
  // even-odd scanline fill
  for (let y = 0; y < docH; y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (a[1] === b[1]) continue;
      const yy = y + 0.5;
      if (yy >= Math.min(a[1], b[1]) && yy < Math.max(a[1], b[1])) {
        xs.push(a[0] + ((yy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const sx = Math.max(0, Math.floor(xs[i]));
      const ex = Math.min(docW, Math.ceil(xs[i + 1]));
      if (ex > sx) mask.fill(255, y * docW + sx, y * docW + ex);
    }
  }
  const outline = points.map((p) => [p[0], p[1]]).flat() as number[];
  outline.push(points[0][0], points[0][1]);
  return finalize(mask, docW, docH, 'lasso', [outline]);
}

/* ------------------------------------------------------------------ */
/* magic wand                                                          */
/* ------------------------------------------------------------------ */

export function floodSelect(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  tolerance: number,
  contiguous: boolean,
): Selection | null {
  const sx = Math.floor(startX);
  const sy = Math.floor(startY);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;
  const mask = emptyMask(width, height);
  const so = (sy * width + sx) * 4;
  const sr = data[so];
  const sg = data[so + 1];
  const sb = data[so + 2];
  const sa = data[so + 3];
  const tol = (tolerance / 100) * 255 * 2;
  const matches = (o: number): boolean =>
    Math.abs(data[o] - sr) + Math.abs(data[o + 1] - sg) + Math.abs(data[o + 2] - sb) + Math.abs(data[o + 3] - sa) <= tol;

  if (contiguous) {
    const stack: number[] = [sy * width + sx];
    const seen = new Uint8Array(width * height);
    seen[sy * width + sx] = 1;
    while (stack.length > 0) {
      const idx = stack.pop() as number;
      if (!matches(idx * 4)) continue;
      mask[idx] = 255;
      const x = idx % width;
      const y = (idx / width) | 0;
      if (x > 0 && !seen[idx - 1]) {
        seen[idx - 1] = 1;
        stack.push(idx - 1);
      }
      if (x < width - 1 && !seen[idx + 1]) {
        seen[idx + 1] = 1;
        stack.push(idx + 1);
      }
      if (y > 0 && !seen[idx - width]) {
        seen[idx - width] = 1;
        stack.push(idx - width);
      }
      if (y < height - 1 && !seen[idx + width]) {
        seen[idx + width] = 1;
        stack.push(idx + width);
      }
    }
  } else {
    for (let i = 0; i < width * height; i++) {
      if (matches(i * 4)) mask[i] = 255;
    }
  }
  return finalize(mask, width, height, 'magic-wand');
}

/* ------------------------------------------------------------------ */
/* combining & refinement                                              */
/* ------------------------------------------------------------------ */

export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';

export function combineSelections(base: Selection | null, next: Selection | null, mode: SelectionMode): Selection | null {
  if (!next) return mode === 'replace' ? null : base;
  if (!base || mode === 'replace') return next;
  const { mask: a } = base;
  const { mask: b } = next;
  const out = new Uint8ClampedArray(a.length);
  for (let i = 0; i < out.length; i++) {
    switch (mode) {
      case 'add':
        out[i] = Math.max(a[i], b[i]);
        break;
      case 'subtract':
        out[i] = Math.max(0, a[i] - b[i]);
        break;
      case 'intersect':
        out[i] = Math.min(a[i], b[i]);
        break;
      default:
        out[i] = b[i];
    }
  }
  const w = base.width;
  const h = base.height;
  return finalize(out, w, h, `${base.source}+${next.source}`);
}

export function invertSelection(sel: Selection): Selection | null {
  const out = new Uint8ClampedArray(sel.mask.length);
  for (let i = 0; i < out.length; i++) out[i] = 255 - sel.mask[i];
  return finalize(out, sel.width, sel.height, `${sel.source}-inv`);
}

export function featherSelection(sel: Selection, radius: number): Selection {
  if (radius <= 0) return sel;
  const mask = blurMask(sel.mask, sel.width, sel.height, radius);
  return finalize(mask, sel.width, sel.height, `${sel.source}-feather`) ?? sel;
}

/** Uniform box blur over an 8-bit coverage mask (separable, deterministic). */
export function blurMask(mask: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(mask.length);
  const out = new Uint8ClampedArray(mask.length);
  const win = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    const row = y * w;
    for (let i = -r; i <= r; i++) sum += mask[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win;
      const add = mask[row + Math.min(w - 1, x + r + 1)];
      const sub = mask[row + Math.max(0, x - r)];
      sum += add - sub;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
      const sub = tmp[Math.max(0, y - r) * w + x];
      sum += add - sub;
    }
  }
  return out;
}

export function growSelection(sel: Selection, radius: number): Selection {
  return morphSelection(sel, radius, true);
}

export function contractSelection(sel: Selection, radius: number): Selection {
  return morphSelection(sel, radius, false);
}

/** Dilate (grow) / erode (contract) with a square kernel of given radius. */
function morphSelection(sel: Selection, radius: number, grow: boolean): Selection {
  const r = Math.max(1, Math.round(radius));
  const { width: w, height: h, mask } = sel;
  const src = new Uint8ClampedArray(mask);
  const out = new Uint8ClampedArray(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = grow ? 0 : 255;
      for (let dy = -r; dy <= r; dy++) {
        const sy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -r; dx <= r; dx++) {
          const sx = Math.min(w - 1, Math.max(0, x + dx));
          const s = src[sy * w + sx];
          v = grow ? Math.max(v, s) : Math.min(v, s);
        }
      }
      out[y * w + x] = v;
    }
  }
  const label = grow ? 'grow' : 'contract';
  return finalize(out, w, h, `${sel.source}-${label}`) ?? sel;
}

export function borderSelection(sel: Selection, thickness: number): Selection {
  const inner = contractSelection(sel, Math.max(1, Math.round(thickness / 2)));
  const out = new Uint8ClampedArray(sel.mask.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, sel.mask[i] - inner.mask[i]);
  return finalize(out, sel.width, sel.height, `${sel.source}-border`) ?? sel;
}

/* ------------------------------------------------------------------ */
/* outline tracing (marching ants)                                     */
/* ------------------------------------------------------------------ */

/**
 * Traces coverage boundaries into polylines using contour following on a
 * binary (>=128) view of the mask. Sufficient for ants visualization.
 */
export function traceOutline(mask: Uint8ClampedArray, w: number, h: number): SelectionOutline {
  const solid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] >= 128;
  const visited = new Uint8Array(w * h);
  const lines: SelectionOutline = [];
  // find boundary starts scanning top→bottom
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (visited[idx] || !solid(x, y)) continue;
      // start only on a top edge of a region
      if (solid(x, y - 1)) continue;
      const line: number[] = [];
      let cx = x;
      let cy = y;
      let dir = 1; // 1=right, 2=down, 3=left, 4=up (moore tracing)
      let steps = 0;
      const maxSteps = w * h;
      do {
        visited[cy * w + cx] = 1;
        line.push(cx, cy);
        const neighbors: [number, number][] = [
          [cx + 1, cy],
          [cx + 1, cy + 1],
          [cx, cy + 1],
          [cx - 1, cy + 1],
          [cx - 1, cy],
          [cx - 1, cy - 1],
          [cx, cy - 1],
          [cx + 1, cy - 1],
        ];
        let found = false;
        // start searching from previous direction for stable tracing
        for (let i = 0; i < 8; i++) {
          const nIdx = ((dir - 1) + i) % 8;
          const [nx, ny] = neighbors[nIdx];
          if (solid(nx, ny)) {
            cx = nx;
            cy = ny;
            dir = nIdx + 1;
            found = true;
            break;
          }
        }
        if (!found) break;
        steps++;
      } while ((cx !== x || cy !== y) && steps < maxSteps);
      if (line.length >= 8) {
        line.push(x, y); // close loop
        lines.push(line);
      }
    }
  }
  return lines;
}

/** Extracts the color under a point (for eyedropper & wand seed). */
export function sampleColor(data: Uint8ClampedArray, width: number, x: number, y: number): { r: number; g: number; b: number; a: number } | null {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= width || yi * width + xi >= data.length / 4) return null;
  const o = (yi * width + xi) * 4;
  return { r: data[o], g: data[o + 1], b: data[o + 2], a: data[o + 3] };
}

export { luma601 };
