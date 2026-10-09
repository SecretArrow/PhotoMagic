/**
 * Filter registry — deterministic, synchronous pixel operations.
 *
 * Every filter is a pure function over an RGBA Uint8ClampedArray so the same
 * code runs on the main thread (renderer smart-filters) and inside the Web
 * Worker (interactive filter dialogs / previews).
 *
 * NOTE: this file is the registry skeleton + core blur/sharpen/stylize set.
 * Additional filter definitions extend FILTERS below (see engine/filters).
 */

import type { FilterDef } from '../types';
import { clamp255, luma601 } from '../color';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function num(params: Record<string, number | string | boolean>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function bool(params: Record<string, number | string | boolean>, key: string, fallback: boolean): boolean {
  const v = params[key];
  return typeof v === 'boolean' ? v : fallback;
}

/** In-place separable box blur (3 passes ≈ gaussian). Deterministic. */
export function boxBlurRGBA(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  passes = 3,
): void {
  if (radius < 1) return;
  const r = Math.round(radius);
  const tmp = new Uint8ClampedArray(data.length);
  for (let p = 0; p < passes; p++) {
    boxBlurH(data, tmp, width, height, r);
    boxBlurV(tmp, data, width, height, r);
  }
}

function boxBlurH(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number): void {
  const window = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sa = 0;
    for (let i = -r; i <= r; i++) {
      const x = Math.min(w - 1, Math.max(0, i));
      const o = row + x * 4;
      sr += src[o];
      sg += src[o + 1];
      sb += src[o + 2];
      sa += src[o + 3];
    }
    for (let x = 0; x < w; x++) {
      const o = row + x * 4;
      dst[o] = sr / window;
      dst[o + 1] = sg / window;
      dst[o + 2] = sb / window;
      dst[o + 3] = sa / window;
      const addX = Math.min(w - 1, x + r + 1);
      const subX = Math.max(0, x - r);
      const ao = row + addX * 4;
      const so = row + subX * 4;
      sr += src[ao] - src[so];
      sg += src[ao + 1] - src[so + 1];
      sb += src[ao + 2] - src[so + 2];
      sa += src[ao + 3] - src[so + 3];
    }
  }
}

function boxBlurV(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number): void {
  const window = r * 2 + 1;
  for (let x = 0; x < w; x++) {
    const col = x * 4;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sa = 0;
    for (let i = -r; i <= r; i++) {
      const y = Math.min(h - 1, Math.max(0, i));
      const o = y * w * 4 + col;
      sr += src[o];
      sg += src[o + 1];
      sb += src[o + 2];
      sa += src[o + 3];
    }
    for (let y = 0; y < h; y++) {
      const o = y * w * 4 + col;
      dst[o] = sr / window;
      dst[o + 1] = sg / window;
      dst[o + 2] = sb / window;
      dst[o + 3] = sa / window;
      const addY = Math.min(h - 1, y + r + 1);
      const subY = Math.max(0, y - r);
      const ao = addY * w * 4 + col;
      const so = subY * w * 4 + col;
      sr += src[ao] - src[so];
      sg += src[ao + 1] - src[so + 1];
      sb += src[ao + 2] - src[so + 2];
      sa += src[ao + 3] - src[so + 3];
    }
  }
}

/** Generic 3x3 convolution kernel. */
export function convolve3x3(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  kernel: number[],
  divisor = 1,
  offset = 0,
  mix = 1,
): void {
  const src = new Uint8ClampedArray(data);
  const k = kernel;
  const div = divisor || k.reduce((a, b) => a + b, 0) || 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const acc = [0, 0, 0];
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const sy = Math.min(height - 1, Math.max(0, y + ky));
          const sx = Math.min(width - 1, Math.max(0, x + kx));
          const so = (sy * width + sx) * 4;
          const w = k[(ky + 1) * 3 + (kx + 1)];
          acc[0] += src[so] * w;
          acc[1] += src[so + 1] * w;
          acc[2] += src[so + 2] * w;
        }
      }
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = acc[c] / div + offset;
        data[o + c] = clamp255(src[o + c] * (1 - mix) + v * mix);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* filter definitions                                                  */
/* ------------------------------------------------------------------ */

export const FILTERS: FilterDef[] = [
  {
    op: 'gaussian-blur',
    labelKey: 'filter.gaussianBlur',
    category: 'blur',
    params: [{ key: 'radius', type: 'number', labelKey: 'filter.param.radius', min: 0, max: 100, step: 1, defaultValue: 5 }],
    apply(data, width, height, params) {
      boxBlurRGBA(data, width, height, num(params, 'radius', 5), 3);
    },
  },
  {
    op: 'box-blur',
    labelKey: 'filter.boxBlur',
    category: 'blur',
    params: [{ key: 'radius', type: 'number', labelKey: 'filter.param.radius', min: 0, max: 100, step: 1, defaultValue: 4 }],
    apply(data, width, height, params) {
      boxBlurRGBA(data, width, height, num(params, 'radius', 4), 1);
    },
  },
  {
    op: 'motion-blur',
    labelKey: 'filter.motionBlur',
    category: 'blur',
    params: [
      { key: 'distance', type: 'number', labelKey: 'filter.param.distance', min: 1, max: 100, step: 1, defaultValue: 12 },
      { key: 'angle', type: 'number', labelKey: 'filter.param.angle', min: -180, max: 180, step: 1, defaultValue: 0 },
    ],
    apply(data, width, height, params) {
      const dist = Math.round(num(params, 'distance', 12));
      const angle = (num(params, 'angle', 0) * Math.PI) / 180;
      const dx = Math.cos(angle);
      const dy = -Math.sin(angle);
      const src = new Uint8ClampedArray(data);
      const samples = Math.max(2, dist);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          for (let s = 0; s < samples; s++) {
            const t = (s / (samples - 1) - 0.5) * dist;
            const sx = Math.min(width - 1, Math.max(0, Math.round(x + dx * t)));
            const sy = Math.min(height - 1, Math.max(0, Math.round(y + dy * t)));
            const so = (sy * width + sx) * 4;
            r += src[so];
            g += src[so + 1];
            b += src[so + 2];
            a += src[so + 3];
          }
          const o = (y * width + x) * 4;
          data[o] = r / samples;
          data[o + 1] = g / samples;
          data[o + 2] = b / samples;
          data[o + 3] = a / samples;
        }
      }
    },
  },
  {
    op: 'sharpen',
    labelKey: 'filter.sharpen',
    category: 'sharpen',
    params: [{ key: 'amount', type: 'number', labelKey: 'filter.param.amount', min: 0, max: 100, step: 1, defaultValue: 50 }],
    apply(data, width, height, params) {
      const amt = num(params, 'amount', 50) / 100;
      const center = 1 + 4 * amt;
      convolve3x3(data, width, height, [0, -amt, 0, -amt, center, -amt, 0, -amt, 0], 1, 0, 1);
    },
  },
  {
    op: 'unsharp-mask',
    labelKey: 'filter.unsharpMask',
    category: 'sharpen',
    params: [
      { key: 'radius', type: 'number', labelKey: 'filter.param.radius', min: 1, max: 20, step: 1, defaultValue: 2 },
      { key: 'amount', type: 'number', labelKey: 'filter.param.amount', min: 0, max: 200, step: 1, defaultValue: 80 },
    ],
    apply(data, width, height, params) {
      const radius = num(params, 'radius', 2);
      const amount = num(params, 'amount', 80) / 100;
      const blurred = new Uint8ClampedArray(data);
      boxBlurRGBA(blurred, width, height, radius, 2);
      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const orig = data[i + c];
          data[i + c] = clamp255(orig + (orig - blurred[i + c]) * amount);
        }
      }
    },
  },
  {
    op: 'pixelate',
    labelKey: 'filter.pixelate',
    category: 'stylize',
    params: [{ key: 'size', type: 'number', labelKey: 'filter.param.size', min: 2, max: 100, step: 1, defaultValue: 10 }],
    apply(data, width, height, params) {
      const size = Math.max(2, Math.round(num(params, 'size', 10)));
      for (let by = 0; by < height; by += size) {
        for (let bx = 0; bx < width; bx += size) {
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          let count = 0;
          for (let y = by; y < Math.min(by + size, height); y++) {
            for (let x = bx; x < Math.min(bx + size, width); x++) {
              const o = (y * width + x) * 4;
              r += data[o];
              g += data[o + 1];
              b += data[o + 2];
              a += data[o + 3];
              count++;
            }
          }
          r /= count;
          g /= count;
          b /= count;
          a /= count;
          for (let y = by; y < Math.min(by + size, height); y++) {
            for (let x = bx; x < Math.min(bx + size, width); x++) {
              const o = (y * width + x) * 4;
              data[o] = r;
              data[o + 1] = g;
              data[o + 2] = b;
              data[o + 3] = a;
            }
          }
        }
      }
    },
  },
  {
    op: 'noise',
    labelKey: 'filter.addNoise',
    category: 'noise',
    params: [
      { key: 'amount', type: 'number', labelKey: 'filter.param.amount', min: 0, max: 100, step: 1, defaultValue: 20 },
      { key: 'monochrome', type: 'boolean', labelKey: 'filter.param.monochrome', defaultValue: true },
    ],
    apply(data, _width, _height, params) {
      const amount = num(params, 'amount', 20) * 2.55;
      const mono = bool(params, 'monochrome', true);
      // deterministic LCG noise (identical inputs → identical output)
      let seed = 123456789;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      for (let i = 0; i < data.length; i += 4) {
        if (mono) {
          const n = (rand() - 0.5) * amount;
          data[i] = clamp255(data[i] + n);
          data[i + 1] = clamp255(data[i + 1] + n);
          data[i + 2] = clamp255(data[i + 2] + n);
        } else {
          data[i] = clamp255(data[i] + (rand() - 0.5) * amount);
          data[i + 1] = clamp255(data[i + 1] + (rand() - 0.5) * amount);
          data[i + 2] = clamp255(data[i + 2] + (rand() - 0.5) * amount);
        }
      }
    },
  },
  {
    op: 'find-edges',
    labelKey: 'filter.findEdges',
    category: 'stylize',
    params: [],
    apply(data, width, height) {
      convolve3x3(data, width, height, [0, 1, 0, 1, -4, 1, 0, 1, 0], 1, 255, 1);
    },
  },
  {
    op: 'emboss',
    labelKey: 'filter.emboss',
    category: 'stylize',
    params: [{ key: 'strength', type: 'number', labelKey: 'filter.param.strength', min: 0.5, max: 4, step: 0.5, defaultValue: 1 }],
    apply(data, width, height, params) {
      const s = num(params, 'strength', 1);
      convolve3x3(data, width, height, [-2 * s, -s, 0, -s, 1, s, 0, s, 2 * s], 1, 0, 1);
    },
  },
  {
    op: 'vignette',
    labelKey: 'filter.vignette',
    category: 'light',
    params: [
      { key: 'amount', type: 'number', labelKey: 'filter.param.amount', min: 0, max: 100, step: 1, defaultValue: 40 },
      { key: 'softness', type: 'number', labelKey: 'filter.param.softness', min: 1, max: 100, step: 1, defaultValue: 50 },
    ],
    apply(data, width, height, params) {
      const amount = num(params, 'amount', 40) / 100;
      const softness = num(params, 'softness', 50) / 100;
      const cx = width / 2;
      const cy = height / 2;
      const maxR = Math.hypot(cx, cy);
      const inner = maxR * (1 - softness) * 0.9;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const d = Math.hypot(x - cx, y - cy);
          let f = 1;
          if (d > inner) f = Math.max(0, 1 - ((d - inner) / Math.max(1, maxR - inner)) * amount);
          const o = (y * width + x) * 4;
          data[o] = clamp255(data[o] * f);
          data[o + 1] = clamp255(data[o + 1] * f);
          data[o + 2] = clamp255(data[o + 2] * f);
        }
      }
    },
  },
  {
    op: 'median',
    labelKey: 'filter.median',
    category: 'noise',
    params: [{ key: 'radius', type: 'number', labelKey: 'filter.param.radius', min: 1, max: 5, step: 1, defaultValue: 1 }],
    apply(data, width, height, params) {
      const r = Math.round(num(params, 'radius', 1));
      const src = new Uint8ClampedArray(data);
      const win: number[] = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          for (let c = 0; c < 3; c++) {
            win.length = 0;
            for (let dy = -r; dy <= r; dy++) {
              for (let dx = -r; dx <= r; dx++) {
                const sy = Math.min(height - 1, Math.max(0, y + dy));
                const sx = Math.min(width - 1, Math.max(0, x + dx));
                win.push(src[(sy * width + sx) * 4 + c]);
              }
            }
            win.sort((a, b) => a - b);
            data[(y * width + x) * 4 + c] = win[win.length >> 1];
          }
        }
      }
    },
  },
  {
    op: 'chromatic-aberration',
    labelKey: 'filter.chromaticAberration',
    category: 'distort',
    params: [{ key: 'offset', type: 'number', labelKey: 'filter.param.offset', min: 0, max: 30, step: 1, defaultValue: 4 }],
    apply(data, width, height, params) {
      const off = num(params, 'offset', 4);
      const src = new Uint8ClampedArray(data);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const o = (y * width + x) * 4;
          const rx = Math.min(width - 1, x + off);
          const bx = Math.max(0, x - off);
          data[o] = src[(y * width + rx) * 4];
          data[o + 2] = src[(y * width + bx) * 4 + 2];
        }
      }
    },
  },
  {
    op: 'posterize-matrix',
    labelKey: 'filter.posterize',
    category: 'artistic',
    params: [{ key: 'levels', type: 'number', labelKey: 'filter.param.levels', min: 2, max: 32, step: 1, defaultValue: 6 }],
    apply(data, _w, _h, params) {
      const levels = Math.max(2, Math.round(num(params, 'levels', 6)));
      const step = 255 / (levels - 1);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = clamp255(Math.round(data[i] / step) * step);
        data[i + 1] = clamp255(Math.round(data[i + 1] / step) * step);
        data[i + 2] = clamp255(Math.round(data[i + 2] / step) * step);
      }
    },
  },
  {
    op: 'oil-paint',
    labelKey: 'filter.oilPaint',
    category: 'artistic',
    params: [
      { key: 'radius', type: 'number', labelKey: 'filter.param.radius', min: 1, max: 5, step: 1, defaultValue: 2 },
      { key: 'levels', type: 'number', labelKey: 'filter.param.levels', min: 4, max: 32, step: 1, defaultValue: 12 },
    ],
    apply(data, width, height, params) {
      // simplified Kuwahara-style intensity binning
      const r = Math.round(num(params, 'radius', 2));
      const levels = Math.round(num(params, 'levels', 12));
      const src = new Uint8ClampedArray(data);
      const bins = new Array(levels).fill(0);
      const sumsR = new Array(levels).fill(0);
      const sumsG = new Array(levels).fill(0);
      const sumsB = new Array(levels).fill(0);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          bins.fill(0);
          sumsR.fill(0);
          sumsG.fill(0);
          sumsB.fill(0);
          for (let dy = -r; dy <= r; dy++) {
            const sy = Math.min(height - 1, Math.max(0, y + dy));
            for (let dx = -r; dx <= r; dx++) {
              const sx = Math.min(width - 1, Math.max(0, x + dx));
              const so = (sy * width + sx) * 4;
              const y601 = Math.round((luma601(src[so], src[so + 1], src[so + 2]) / 255) * (levels - 1));
              bins[y601]++;
              sumsR[y601] += src[so];
              sumsG[y601] += src[so + 1];
              sumsB[y601] += src[so + 2];
            }
          }
          let best = 0;
          for (let i = 1; i < levels; i++) if (bins[i] > bins[best]) best = i;
          const o = (y * width + x) * 4;
          data[o] = sumsR[best] / bins[best];
          data[o + 1] = sumsG[best] / bins[best];
          data[o + 2] = sumsB[best] / bins[best];
        }
      }
    },
  },

  /* ---------------------------------------------------------------- */
  /* extended set — bokeh / edge-aware / distort / light (task 3-b)     */
  /* ---------------------------------------------------------------- */
  {
    op: 'radial-blur',
    labelKey: 'filter.radialBlur',
    category: 'blur',
    params: [{ key: 'amount', type: 'number', labelKey: 'filter.param.amount', min: 1, max: 50, step: 1, defaultValue: 10 }],
    apply(data, width, height, params) {
      // Zoom-style radial blur: each pixel averages samples pulled toward the
      // image center along its ray. Deterministic (fixed sample ladder).
      const amount = num(params, 'amount', 10);
      const src = new Uint8ClampedArray(data);
      const cx = width / 2;
      const cy = height / 2;
      const steps = Math.max(2, Math.round(amount));
      const maxScale = amount / 100; // strongest sample sits this fraction closer to center
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x - cx;
          const dy = y - cy;
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          for (let s = 0; s < steps; s++) {
            const t = s / (steps - 1);
            const scale = 1 - maxScale * t;
            const sx = Math.min(width - 1, Math.max(0, Math.round(cx + dx * scale)));
            const sy = Math.min(height - 1, Math.max(0, Math.round(cy + dy * scale)));
            const so = (sy * width + sx) * 4;
            r += src[so];
            g += src[so + 1];
            b += src[so + 2];
            a += src[so + 3];
          }
          const o = (y * width + x) * 4;
          data[o] = r / steps;
          data[o + 1] = g / steps;
          data[o + 2] = b / steps;
          data[o + 3] = a / steps;
        }
      }
    },
  },
  {
    op: 'lens-blur',
    labelKey: 'filter.lensBlur',
    category: 'blur',
    params: [{ key: 'radius', type: 'number', labelKey: 'filter.param.radius', min: 1, max: 30, step: 1, defaultValue: 8 }],
    apply(data, width, height, params) {
      // Approximation of a disc bokeh kernel: 4 stacked box passes produce a
      // soft, wider-than-gaussian falloff. Honest label: not a true disc.
      boxBlurRGBA(data, width, height, num(params, 'radius', 8), 4);
    },
  },
  {
    op: 'surface-blur',
    labelKey: 'filter.surfaceBlur',
    category: 'blur',
    params: [
      { key: 'radius', type: 'number', labelKey: 'filter.param.radius', min: 1, max: 20, step: 1, defaultValue: 5 },
      { key: 'threshold', type: 'number', labelKey: 'filter.param.threshold', min: 1, max: 100, step: 1, defaultValue: 20 },
    ],
    apply(data, width, height, params) {
      // Edge-preserving smoothing: only neighbors whose average per-channel
      // color distance from the center is below the threshold are averaged.
      const r = Math.max(1, Math.round(num(params, 'radius', 5)));
      const threshold = (num(params, 'threshold', 20) / 100) * 255; // 1..100 → 0..255 range
      const src = new Uint8ClampedArray(data);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const o = (y * width + x) * 4;
          const cr = src[o];
          const cg = src[o + 1];
          const cb = src[o + 2];
          let sr = 0;
          let sg = 0;
          let sb = 0;
          let wsum = 0;
          for (let dy = -r; dy <= r; dy++) {
            const sy = Math.min(height - 1, Math.max(0, y + dy));
            for (let dx = -r; dx <= r; dx++) {
              const sx = Math.min(width - 1, Math.max(0, x + dx));
              const so = (sy * width + sx) * 4;
              const dist = (Math.abs(src[so] - cr) + Math.abs(src[so + 1] - cg) + Math.abs(src[so + 2] - cb)) / 3;
              if (dist < threshold) {
                sr += src[so];
                sg += src[so + 1];
                sb += src[so + 2];
                wsum++;
              }
            }
          }
          if (wsum > 0) {
            data[o] = sr / wsum;
            data[o + 1] = sg / wsum;
            data[o + 2] = sb / wsum;
          }
        }
      }
    },
  },
  {
    op: 'high-pass',
    labelKey: 'filter.highPass',
    category: 'sharpen',
    params: [{ key: 'radius', type: 'number', labelKey: 'filter.param.radius', min: 1, max: 50, step: 1, defaultValue: 5 }],
    apply(data, width, height, params) {
      // original − blurred + 128 → gray midtone output with edges highlighted
      const blurred = new Uint8ClampedArray(data);
      boxBlurRGBA(blurred, width, height, num(params, 'radius', 5), 2);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = clamp255(data[i] - blurred[i] + 128);
        data[i + 1] = clamp255(data[i + 1] - blurred[i + 1] + 128);
        data[i + 2] = clamp255(data[i + 2] - blurred[i + 2] + 128);
      }
    },
  },
  {
    op: 'halftone',
    labelKey: 'filter.halftone',
    category: 'artistic',
    params: [
      { key: 'size', type: 'number', labelKey: 'filter.param.size', min: 2, max: 24, step: 1, defaultValue: 6 },
      { key: 'angle', type: 'number', labelKey: 'filter.param.angle', min: -90, max: 90, step: 1, defaultValue: 45 },
    ],
    apply(data, width, height, params) {
      // Dot-screen approximation: re-renders the image as black ink dots
      // (radius ∝ cell darkness) on white, on a grid rotated by `angle`.
      const size = Math.max(2, Math.round(num(params, 'size', 6)));
      const angle = (num(params, 'angle', 45) * Math.PI) / 180;
      const src = new Uint8ClampedArray(data);
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const cx = width / 2;
      const cy = height / 2;
      const half = size / 2;
      data.fill(255); // fresh white paper (RGB + alpha)
      const grid = Math.ceil(Math.hypot(width, height) / size / 2) + 1;
      for (let j = -grid; j <= grid; j++) {
        for (let i = -grid; i <= grid; i++) {
          const px = cx + i * size * cosA - j * size * sinA;
          const py = cy + i * size * sinA + j * size * cosA;
          if (px < -size || py < -size || px > width + size || py > height + size) continue;
          // average source luminance inside this grid cell
          let sum = 0;
          let count = 0;
          for (let oy = -half; oy < half; oy++) {
            const sy = Math.min(height - 1, Math.max(0, Math.round(py + oy)));
            for (let ox = -half; ox < half; ox++) {
              const sx = Math.min(width - 1, Math.max(0, Math.round(px + ox)));
              const so = (sy * width + sx) * 4;
              sum += luma601(src[so], src[so + 1], src[so + 2]);
              count++;
            }
          }
          const darkness = 1 - sum / (count * 255); // 0..1
          const radius = darkness * half * 1.18; // slight overlap → denser screens
          if (radius < 0.5) continue;
          const x0 = Math.max(0, Math.floor(px - radius));
          const x1 = Math.min(width - 1, Math.ceil(px + radius));
          const y0 = Math.max(0, Math.floor(py - radius));
          const y1 = Math.min(height - 1, Math.ceil(py + radius));
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const ddx = x - px;
              const ddy = y - py;
              if (ddx * ddx + ddy * ddy <= radius * radius) {
                const o = (y * width + x) * 4;
                data[o] = 0;
                data[o + 1] = 0;
                data[o + 2] = 0;
              }
            }
          }
        }
      }
    },
  },
  {
    op: 'wave',
    labelKey: 'filter.wave',
    category: 'distort',
    params: [
      { key: 'amplitude', type: 'number', labelKey: 'filter.param.amplitude', min: 1, max: 50, step: 1, defaultValue: 8 },
      { key: 'wavelength', type: 'number', labelKey: 'filter.param.wavelength', min: 4, max: 200, step: 1, defaultValue: 40 },
      {
        key: 'direction',
        type: 'select',
        labelKey: 'filter.param.direction',
        defaultValue: 'horizontal',
        options: [
          { value: 'horizontal', labelKey: 'filter.param.directionHorizontal' },
          { value: 'vertical', labelKey: 'filter.param.directionVertical' },
        ],
      },
    ],
    apply(data, width, height, params) {
      // Sin-based displacement: 'horizontal' shifts rows along x by sin(y),
      // 'vertical' shifts columns along y by sin(x).
      const amp = num(params, 'amplitude', 8);
      const wl = Math.max(2, num(params, 'wavelength', 40));
      const vertical = params.direction === 'vertical';
      const src = new Uint8ClampedArray(data);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let sx = x;
          let sy = y;
          if (vertical) {
            sy = Math.round(y + amp * Math.sin((x / wl) * Math.PI * 2));
          } else {
            sx = Math.round(x + amp * Math.sin((y / wl) * Math.PI * 2));
          }
          sx = Math.min(width - 1, Math.max(0, sx));
          sy = Math.min(height - 1, Math.max(0, sy));
          const o = (y * width + x) * 4;
          const so = (sy * width + sx) * 4;
          data[o] = src[so];
          data[o + 1] = src[so + 1];
          data[o + 2] = src[so + 2];
          data[o + 3] = src[so + 3];
        }
      }
    },
  },
  {
    op: 'twirl',
    labelKey: 'filter.twirl',
    category: 'distort',
    params: [
      { key: 'angle', type: 'number', labelKey: 'filter.param.angle', min: -360, max: 360, step: 1, defaultValue: 90 },
      { key: 'radius', type: 'number', labelKey: 'filter.param.radius', min: 10, max: 100, step: 1, defaultValue: 50 },
    ],
    apply(data, width, height, params) {
      // Rotates pixels around the center; rotation strength falls off
      // quadratically with distance and stops at `radius` (% of min dimension).
      const maxAngle = (num(params, 'angle', 90) * Math.PI) / 180;
      const radius = (num(params, 'radius', 50) / 100) * Math.min(width, height);
      const r = Math.max(1, radius);
      const src = new Uint8ClampedArray(data);
      const cx = width / 2;
      const cy = height / 2;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const d = Math.hypot(dx, dy);
          let sx = x;
          let sy = y;
          if (d > 0 && d < r) {
            const t = 1 - d / r;
            const a = maxAngle * t * t;
            const cosA = Math.cos(a);
            const sinA = Math.sin(a);
            sx = Math.min(width - 1, Math.max(0, Math.round(cx + dx * cosA - dy * sinA)));
            sy = Math.min(height - 1, Math.max(0, Math.round(cy + dx * sinA + dy * cosA)));
          }
          const o = (y * width + x) * 4;
          const so = (sy * width + sx) * 4;
          data[o] = src[so];
          data[o + 1] = src[so + 1];
          data[o + 2] = src[so + 2];
          data[o + 3] = src[so + 3];
        }
      }
    },
  },
  {
    op: 'spherize',
    labelKey: 'filter.spherize',
    category: 'distort',
    params: [{ key: 'amount', type: 'number', labelKey: 'filter.param.amount', min: -100, max: 100, step: 1, defaultValue: 50 }],
    apply(data, width, height, params) {
      // Spherical bulge (+) / pinch (−): sample radius follows d^(1+amount),
      // so +amount pulls samples toward the center (magnify) and −amount
      // pushes them outward (pinch). amount 0 = identity.
      const amount = num(params, 'amount', 50) / 100;
      const src = new Uint8ClampedArray(data);
      const cx = width / 2;
      const cy = height / 2;
      const maxD = Math.hypot(cx, cy);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const d = Math.hypot(dx, dy) / maxD; // normalized 0..1 (1 at corners)
          let sx = x;
          let sy = y;
          if (d > 0 && d < 1) {
            const nd = Math.pow(d, 1 + amount) * maxD;
            const scale = nd / (d * maxD);
            sx = Math.min(width - 1, Math.max(0, Math.round(cx + dx * scale)));
            sy = Math.min(height - 1, Math.max(0, Math.round(cy + dy * scale)));
          }
          const o = (y * width + x) * 4;
          const so = (sy * width + sx) * 4;
          data[o] = src[so];
          data[o + 1] = src[so + 1];
          data[o + 2] = src[so + 2];
          data[o + 3] = src[so + 3];
        }
      }
    },
  },
  {
    op: 'ripple',
    labelKey: 'filter.ripple',
    category: 'distort',
    params: [
      { key: 'amplitude', type: 'number', labelKey: 'filter.param.amplitude', min: 1, max: 30, step: 1, defaultValue: 6 },
      { key: 'wavelength', type: 'number', labelKey: 'filter.param.wavelength', min: 4, max: 120, step: 1, defaultValue: 30 },
    ],
    apply(data, width, height, params) {
      // Radial sine displacement emanating from the image center.
      const amp = num(params, 'amplitude', 6);
      const wl = Math.max(2, num(params, 'wavelength', 30));
      const src = new Uint8ClampedArray(data);
      const cx = width / 2;
      const cy = height / 2;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const d = Math.hypot(dx, dy);
          // sin(0) = 0 at the center, so scale is safe to guard at d = 0
          const scale = d > 0 ? (d + amp * Math.sin((d / wl) * Math.PI * 2)) / d : 1;
          const sx = Math.min(width - 1, Math.max(0, Math.round(cx + dx * scale)));
          const sy = Math.min(height - 1, Math.max(0, Math.round(cy + dy * scale)));
          const o = (y * width + x) * 4;
          const so = (sy * width + sx) * 4;
          data[o] = src[so];
          data[o + 1] = src[so + 1];
          data[o + 2] = src[so + 2];
          data[o + 3] = src[so + 3];
        }
      }
    },
  },
  {
    op: 'bloom',
    labelKey: 'filter.bloom',
    category: 'light',
    params: [
      { key: 'radius', type: 'number', labelKey: 'filter.param.radius', min: 1, max: 50, step: 1, defaultValue: 12 },
      { key: 'intensity', type: 'number', labelKey: 'filter.param.intensity', min: 0, max: 100, step: 1, defaultValue: 40 },
    ],
    apply(data, width, height, params) {
      // Bright-pass copy → blur → screen-blend back for a soft glow.
      const radius = num(params, 'radius', 12);
      const intensity = num(params, 'intensity', 40) / 100;
      const bright = new Uint8ClampedArray(data);
      for (let i = 0; i < bright.length; i += 4) {
        const y = luma601(bright[i], bright[i + 1], bright[i + 2]);
        const k = y > 128 ? (y - 128) / 127 : 0; // soft threshold above mid gray
        bright[i] = clamp255(bright[i] * k);
        bright[i + 1] = clamp255(bright[i + 1] * k);
        bright[i + 2] = clamp255(bright[i + 2] * k);
      }
      boxBlurRGBA(bright, width, height, radius, 2);
      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const base = data[i + c];
          const glow = bright[i + c] * intensity;
          data[i + c] = clamp255(255 - ((255 - base) * (255 - glow)) / 255);
        }
      }
    },
  },
];

const registry = new Map<string, FilterDef>(FILTERS.map((f) => [f.op, f]));

export function getFilter(op: string): FilterDef | undefined {
  return registry.get(op);
}

export function registerFilter(def: FilterDef): void {
  if (!registry.has(def.op)) {
    registry.set(def.op, def);
    FILTERS.push(def);
  }
}

export function listFilters(): FilterDef[] {
  return FILTERS;
}
