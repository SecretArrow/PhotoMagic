/**
 * Unit tests — content-aware fill (engine/inpaint) and the filter runner's
 * inpaint path. Node environment (no DOM): the diffusion inpainter is pure and
 * runs directly on Uint8ClampedArray buffers; runInpaint is exercised through
 * its synchronous fallback with a minimal ImageData shim (mirrors
 * filters.test.ts). The real Worker protocol path is covered by the browser
 * E2E gate (workers cannot be spawned in this node environment).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  inpaintRegion,
  inpaintEstimateCost,
  DEFAULT_INPAINT_ITERATIONS,
} from '../../src/engine/inpaint';
import { runInpaint, disposeRunner } from '../../src/lib/filterRunner';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const W = 64;
const H = 64;

/** Horizontal gradient image: R=G=B=x*4, alpha 255. */
function gradientImage(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const v = Math.min(255, x * 4);
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return data;
}

/** Binary hole mask (255 = hole) covering [x0,x1) × [y0,y1). */
function holeMask(width: number, height: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) mask[y * width + x] = 255;
  }
  return mask;
}

function pixelAt(data: Uint8ClampedArray, width: number, x: number, y: number, c: number): number {
  return data[(y * width + x) * 4 + c];
}

/* ------------------------------------------------------------------ */
/* engine — gradient reconstruction                                     */
/* ------------------------------------------------------------------ */

describe('inpaintRegion — smooth gradient reconstruction', () => {
  it('fills an 8×8 hole in a horizontal gradient close to the linear interpolation', () => {
    const data = gradientImage(W, H);
    const mask = holeMask(W, H, 28, 28, 36, 36);
    inpaintRegion(data, W, H, mask);

    for (let y = 28; y < 36; y++) {
      const left = pixelAt(data, W, 27, y, 0); // 108
      const right = pixelAt(data, W, 36, y, 0); // 144
      for (let x = 28; x < 36; x++) {
        const t = (x - 27) / (36 - 27);
        const expected = left + (right - left) * t;
        const got = pixelAt(data, W, x, y, 0);
        expect(Math.abs(got - expected)).toBeLessThanOrEqual(20);
      }
    }
  });

  it('leaves every known pixel outside the mask bit-exact unchanged', () => {
    const before = gradientImage(W, H);
    const data = new Uint8ClampedArray(before);
    const mask = holeMask(W, H, 28, 28, 36, 36);
    inpaintRegion(data, W, H, mask);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x >= 28 && x < 36 && y >= 28 && y < 36) continue; // hole
        const o = (y * W + x) * 4;
        expect([data[o], data[o + 1], data[o + 2], data[o + 3]]).toEqual([
          before[o],
          before[o + 1],
          before[o + 2],
          before[o + 3],
        ]);
      }
    }
  });

  it('is deterministic (two runs produce identical buffers)', () => {
    const mask = holeMask(W, H, 28, 28, 36, 36);
    const a = gradientImage(W, H);
    const b = gradientImage(W, H);
    inpaintRegion(a, W, H, mask);
    inpaintRegion(b, W, H, mask);
    expect(a).toEqual(b);
  });
});

/* ------------------------------------------------------------------ */
/* engine — boundary behavior                                           */
/* ------------------------------------------------------------------ */

describe('inpaintRegion — onion-peel init & boundaries', () => {
  it('fills a hole touching the image edge (corner) completely', () => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128;
      data[i + 1] = 128;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
    const mask = holeMask(W, H, 0, 0, 8, 8); // corner hole — no left/top boundary
    inpaintRegion(data, W, H, mask);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const v = pixelAt(data, W, x, y, 0);
        expect(Math.abs(v - 128)).toBeLessThanOrEqual(3); // reached via onion peel, no black degenerate
      }
    }
  });

  it('mask all-zero is a bit-exact no-op', () => {
    const before = gradientImage(W, H);
    const data = new Uint8ClampedArray(before);
    inpaintRegion(data, W, H, new Uint8Array(W * H));
    expect(data).toEqual(before);
  });

  it('mask covering the whole image falls back to the border ring as boundary', () => {
    const size = 16;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const o = (y * size + x) * 4;
        const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
        const v = border ? 255 : 0; // interior "unknown" garbage, border = seed
        data[o] = v;
        data[o + 1] = v;
        data[o + 2] = v;
        data[o + 3] = 255;
      }
    }
    inpaintRegion(data, size, size, new Uint8Array(size * size).fill(255));
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        expect(pixelAt(data, size, x, y, 0)).toBeGreaterThan(200); // filled FROM the edges
      }
    }
  });

  it('diffuses alpha like RGB — opaque imagery keeps its alpha, transparent boundaries propagate', () => {
    // Opaque/semi-transparent UNIFORM-alpha imagery: filled pixels keep the
    // boundary alpha (255-diffusion stays 255; uniform 120 stays 120).
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        const v = Math.min(255, x * 4);
        data[o] = v;
        data[o + 1] = v;
        data[o + 2] = v;
        data[o + 3] = 120; // uniform semi-transparent layer pixels
      }
    }
    const mask = holeMask(W, H, 28, 28, 36, 36);
    inpaintRegion(data, W, H, mask);
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(120);
    // RGBA inside the hole was still filled (non-degenerate)
    expect(pixelAt(data, W, 31, 31, 0)).toBeGreaterThan(0);
  });

  it('removes opaque objects on transparent layers (alpha diffuses to the boundary)', () => {
    // Transparent layer, one opaque dark blob in the middle — filling a hole
    // around it must drive the blob's alpha toward the transparent boundary.
    const data = new Uint8ClampedArray(W * H * 4); // all zeros = transparent
    for (let y = 30; y < 34; y++) {
      for (let x = 30; x < 34; x++) {
        const o = (y * W + x) * 4;
        data[o] = 16;
        data[o + 1] = 16;
        data[o + 2] = 16;
        data[o + 3] = 255; // opaque blob on transparent layer
      }
    }
    const mask = holeMask(W, H, 24, 24, 40, 40); // hole covers the blob + margin
    inpaintRegion(data, W, H, mask);
    // blob center: alpha diffused down to the boundary's 0 — object removed
    expect(data[(32 * W + 32) * 4 + 3]).toBeLessThan(64);
    // pixels OUTSIDE the hole keep their (transparent) state bit-exact
    expect(data[(5 * W + 5) * 4 + 3]).toBe(0);
  });

  it('throws when the mask is smaller than the image', () => {
    const data = gradientImage(4, 4);
    expect(() => inpaintRegion(data, 4, 4, new Uint8Array(3))).toThrow(/mask smaller/);
  });
});

/* ------------------------------------------------------------------ */
/* cost estimate                                                        */
/* ------------------------------------------------------------------ */

describe('inpaintEstimateCost', () => {
  it('scales with hole area × iterations × channels and clamps to the image', () => {
    expect(inpaintEstimateCost(100, 100, 100, 10)).toBe(100 * 10 * 3);
    expect(inpaintEstimateCost(10, 10, 5_000, 10)).toBe(100 * 10 * 3); // clamped to image area
    expect(inpaintEstimateCost(64, 64, 64, DEFAULT_INPAINT_ITERATIONS)).toBe(64 * DEFAULT_INPAINT_ITERATIONS * 3);
  });
});

/* ------------------------------------------------------------------ */
/* filterRunner — synchronous fallback (no Worker in node)              */
/* ------------------------------------------------------------------ */

describe('runInpaint (sync fallback)', () => {
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

  it('fills the masked hole without Worker support and never mutates the caller’s buffers', async () => {
    const w = 24;
    const h = 12;
    const before = gradientImage(w, h);
    const source = new Uint8ClampedArray(before);
    const mask = holeMask(w, h, 8, 4, 12, 8);
    const maskBefore = new Uint8Array(mask);

    const out = await runInpaint(new ImageDataCtor(source, w, h), mask, 60);
    expect(out.width).toBe(w);
    expect(out.height).toBe(h);

    // hole was filled toward the gradient values (was arbitrary before)
    const v = out.data[(5 * w + 9) * 4];
    expect(v).toBeGreaterThan(20);
    expect(Math.abs(v - 9 * 4)).toBeLessThanOrEqual(20); // ≈ x*4 at x=9

    // caller's ImageData + mask were cloned, not detached/mutated
    expect(source).toEqual(before);
    expect(mask).toEqual(maskBefore);
  });

  it('rejects masks smaller than the image', async () => {
    const source = new ImageDataCtor(new Uint8ClampedArray(8 * 4), 2, 2);
    await expect(runInpaint(source, new Uint8Array(1))).rejects.toThrow(/smaller than image/);
  });
});
