/**
 * Unit tests — filter registry, adjustments, histogram and the filter runner's
 * synchronous fallback. Node environment (no DOM): pixel operations are
 * exercised directly on Uint8ClampedArray buffers via FilterDef.apply, and the
 * filter runner is tested with a minimal ImageData shim.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FILTERS, getFilter, boxBlurRGBA } from '../../src/engine/filters/registry';
import { applyAdjustments, hueSaturation } from '../../src/engine/adjustments';
import { computeHistogram } from '../../src/engine/color';
import { runFilter, runAdjust, runHistogram, disposeRunner } from '../../src/lib/filterRunner';
import { en } from '../../src/i18n/dictionaries';
import type { FilterDef } from '../../src/engine/types';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

type RGBA = [number, number, number, number];

function bufferOf(width: number, height: number, fill?: (x: number, y: number) => RGBA): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  if (!fill) return data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  }
  return data;
}

function mustFilter(op: string): FilterDef {
  const def = getFilter(op);
  if (!def) throw new Error(`filter missing from registry: ${op}`);
  return def;
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

/** Mean absolute delta between column x and x+1 (red channel). */
function columnDelta(data: Uint8ClampedArray, width: number, height: number, x: number): number {
  let total = 0;
  for (let y = 0; y < height; y++) {
    const a = data[(y * width + x) * 4];
    const b = data[(y * width + x + 1) * 4];
    total += Math.abs(b - a);
  }
  return total / height;
}

/* ------------------------------------------------------------------ */
/* filters                                                             */
/* ------------------------------------------------------------------ */

describe('filter registry', () => {
  it('gaussian-blur is deterministic (same input → identical output)', () => {
    const def = mustFilter('gaussian-blur');
    const gradient = bufferOf(24, 24, (x, y) => [(x * 11) % 256, (y * 9) % 256, (x * 5 + y * 7) % 256, 255]);
    const a = new Uint8ClampedArray(gradient);
    const b = new Uint8ClampedArray(gradient);
    def.apply(a, 24, 24, { radius: 5 });
    def.apply(b, 24, 24, { radius: 5 });
    expect(a).not.toEqual(gradient); // blur actually changed the pixels
    expect(a).toEqual(b);
  });

  it('box blur preserves a solid color (drift ≤ 1)', () => {
    const solid = bufferOf(12, 12, () => [100, 150, 200, 255]);
    boxBlurRGBA(solid, 12, 12, 3, 3);
    for (let i = 0; i < solid.length; i += 4) {
      expect(Math.abs(solid[i] - 100)).toBeLessThanOrEqual(1);
      expect(Math.abs(solid[i + 1] - 150)).toBeLessThanOrEqual(1);
      expect(Math.abs(solid[i + 2] - 200)).toBeLessThanOrEqual(1);
      expect(solid[i + 3]).toBe(255);
    }
  });

  it('sharpen increases edge contrast on a soft black/white boundary', () => {
    const img = bufferOf(8, 8, (x) => (x < 4 ? [100, 100, 100, 255] : [200, 200, 200, 255]));
    const before = columnDelta(img, 8, 8, 3);
    mustFilter('sharpen').apply(img, 8, 8, { amount: 50 });
    const after = columnDelta(img, 8, 8, 3);
    expect(after).toBeGreaterThan(before);
  });

  it('invert adjustment flips every channel', () => {
    const img = bufferOf(4, 4, (x, y) => [(x * 37) % 256, (y * 53) % 256, 128, 255]);
    const flipped = new Uint8ClampedArray(img);
    applyAdjustments(flipped, [{ type: 'invert' }]);
    for (let i = 0; i < img.length; i += 4) {
      expect(flipped[i]).toBe(255 - img[i]);
      expect(flipped[i + 1]).toBe(255 - img[i + 1]);
      expect(flipped[i + 2]).toBe(255 - img[i + 2]);
      expect(flipped[i + 3]).toBe(255);
    }
  });

  it('posterize-matrix with levels=2 yields only 2 distinct values per channel', () => {
    const img = bufferOf(8, 8, (x, y) => [(x * 37) % 256, (y * 53) % 256, (x * y * 7) % 256, 255]);
    mustFilter('posterize-matrix').apply(img, 8, 8, { levels: 2 });
    for (const c of [0, 1, 2]) {
      const values = new Set<number>();
      for (let i = 0; i < img.length; i += 4) values.add(img[i + c]);
      expect(values.size).toBeLessThanOrEqual(2);
      expect(values.has(0)).toBe(true);
      expect(values.has(255)).toBe(true);
    }
  });

  it('noise filter is deterministic (seeded LCG, not Math.random)', () => {
    const def = mustFilter('noise');
    const img = bufferOf(16, 16, (x, y) => [(x * 13) % 256, (y * 17) % 256, 90, 255]);
    const a = new Uint8ClampedArray(img);
    const b = new Uint8ClampedArray(img);
    def.apply(a, 16, 16, { amount: 25, monochrome: false });
    def.apply(b, 16, 16, { amount: 25, monochrome: false });
    expect(a).not.toEqual(img); // noise actually perturbed the pixels
    expect(a).toEqual(b);
  });

  it('registry integrity: unique ops, labelKeys present, params have defaults', () => {
    const ops = FILTERS.map((f) => f.op);
    expect(new Set(ops).size).toBe(ops.length);
    expect(FILTERS.length).toBeGreaterThanOrEqual(24); // 14 core + 10 extended (task 3-b)
    for (const def of FILTERS) {
      expect(def.labelKey.length).toBeGreaterThan(0);
      expect(def.labelKey.startsWith('filter.')).toBe(true);
      expect(typeof def.apply).toBe('function');
      for (const param of def.params) {
        expect(param.labelKey.length).toBeGreaterThan(0);
        expect(param.defaultValue).toBeDefined();
        for (const option of param.options ?? []) {
          expect(option.labelKey.length).toBeGreaterThan(0);
        }
      }
    }
    expect(getFilter('definitely-not-a-filter')).toBeUndefined();
  });

  it('every filter and param labelKey exists in the en dictionary', () => {
    const has = (key: string) => Object.prototype.hasOwnProperty.call(en, key);
    for (const def of FILTERS) {
      expect(has(def.labelKey)).toBe(true);
      for (const param of def.params) {
        expect(has(param.labelKey)).toBe(true);
        for (const option of param.options ?? []) expect(has(option.labelKey)).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* adjustments                                                         */
/* ------------------------------------------------------------------ */

describe('adjustments', () => {
  it('brightness +100 lifts black to the additive ceiling (engine: ±127.5 at ±100)', () => {
    // Engine semantics: (v + 127.5 - 128) * 1 + 128 → black lands at 128
    // (mid-gray-plus), the maximum lift the additive model can express.
    const data = bufferOf(4, 4, () => [0, 0, 0, 255]);
    applyAdjustments(data, [{ type: 'brightness-contrast', brightness: 100, contrast: 0 }]);
    expect(data[0]).toBe(128);
    expect(data[1]).toBe(128);
    expect(data[2]).toBe(128);
  });

  it('grayscale (amount 100) makes r == g == b for saturated input', () => {
    const data = bufferOf(4, 4, () => [220, 40, 30, 255]);
    applyAdjustments(data, [{ type: 'grayscale', amount: 100 }]);
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBe(data[i + 1]);
      expect(data[i + 1]).toBe(data[i + 2]);
    }
  });

  it('hue-saturation with hue 0 / satMul 1 / lightness 0 changes nothing', () => {
    const data = bufferOf(4, 4, () => [180, 60, 90, 255]);
    const before = new Uint8ClampedArray(data);
    hueSaturation(data, 0, 1, 0);
    expect(data).toEqual(before);
  });

  it('levels maps inBlack..inWhite onto outBlack..outWhite', () => {
    const data = bufferOf(2, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    applyAdjustments(data, [{ type: 'levels', inBlack: 0, inWhite: 255, gamma: 1, outBlack: 40, outWhite: 220 }]);
    expect(data[0]).toBe(40);
    expect(data[1]).toBe(40);
    expect(data[2]).toBe(40);
    expect(data[4]).toBe(220);
    expect(data[5]).toBe(220);
    expect(data[6]).toBe(220);
  });
});

/* ------------------------------------------------------------------ */
/* histogram                                                           */
/* ------------------------------------------------------------------ */

describe('histogram', () => {
  it('counts sum to the number of non-transparent pixels and max is correct', () => {
    // 3×2 image, one fully transparent pixel → 5 contributing pixels
    const data = bufferOf(3, 2, (x, y) => (y === 1 && x === 2 ? [0, 0, 0, 0] : [100, 150, 200, 255]));
    const hist = computeHistogram(data, 256);
    expect(hist.r).toHaveLength(256);
    expect(sum(hist.r)).toBe(5);
    expect(sum(hist.g)).toBe(5);
    expect(sum(hist.b)).toBe(5);
    expect(sum(hist.luminance)).toBe(5);
    // all visible pixels share one color → a single bin holds every count
    expect(hist.max).toBe(5);
  });
});

/* ------------------------------------------------------------------ */
/* filter runner (synchronous fallback — no Worker in Node)            */
/* ------------------------------------------------------------------ */

describe('filterRunner (sync fallback)', () => {
  class ImageDataShim {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }

  let ImageDataCtor: new (data: Uint8ClampedArray, width: number, height: number) => ImageData;

  beforeAll(() => {
    const globalRef = globalThis as unknown as { ImageData?: unknown };
    if (!globalRef.ImageData) globalRef.ImageData = ImageDataShim;
    ImageDataCtor = globalRef.ImageData as new (
      data: Uint8ClampedArray,
      width: number,
      height: number,
    ) => ImageData;
  });

  afterAll(() => {
    disposeRunner();
  });

  it('runFilter applies the filter synchronously and rejects unknown ops', async () => {
    const source = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const out = await runFilter(new ImageDataCtor(source, 2, 1), 'gaussian-blur', { radius: 1 });
    expect(out.width).toBe(2);
    expect(out.height).toBe(1);
    expect(out.data).toHaveLength(8);
    expect(source).toEqual(new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255])); // input untouched
    await expect(runFilter(new ImageDataCtor(source, 2, 1), 'no-such-op', {})).rejects.toThrow(/Unknown filter/);
  });

  it('runAdjust applies adjustments synchronously', async () => {
    const out = await runAdjust(new ImageDataCtor(new Uint8ClampedArray([10, 200, 30, 255]), 1, 1), [
      { type: 'invert' },
    ]);
    expect([...out.data.slice(0, 3)]).toEqual([245, 55, 225]);
  });

  it('runHistogram returns channel arrays and correct max', async () => {
    const data = new Uint8ClampedArray(4 * 1 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 10;
      data[i + 1] = 20;
      data[i + 2] = 30;
      data[i + 3] = 255;
    }
    const hist = await runHistogram(new ImageDataCtor(data, 4, 1));
    expect(sum(hist.r)).toBe(4);
    expect(sum(hist.luminance)).toBe(4);
    expect(hist.max).toBe(4);
    expect(hist.r).toHaveLength(256);
  });
});
