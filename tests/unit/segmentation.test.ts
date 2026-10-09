/**
 * Tests for on-device background segmentation (engine/segmentation).
 * Covers: uniform background removal, subject protection, gradient
 * backgrounds, pre-existing transparency, feathering and determinism.
 */

import { describe, expect, it } from 'vitest';
import { removeBackground } from '@/engine/segmentation';

/** Builds an RGBA buffer from [r,g,b,a] rows. */
function pixels(rows: number[][][]): { data: Uint8ClampedArray; width: number; height: number } {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) =>
    row.forEach((px, x) => {
      const o = (y * width + x) * 4;
      data[o] = px[0];
      data[o + 1] = px[1];
      data[o + 2] = px[2];
      data[o + 3] = px[3] ?? 255;
    }),
  );
  return { data, width, height };
}

const alphaAt = (d: Uint8ClampedArray, w: number, x: number, y: number): number => d[(y * w + x) * 4 + 3];

describe('removeBackground', () => {
  it('removes a uniform background and keeps the subject opaque', () => {
    // 4x3: white border/background, red subject block in the middle
    const white = [255, 255, 255];
    const red = [200, 30, 30];
    const rows = [
      [white, white, white, white],
      [white, red, red, white],
      [white, white, white, white],
    ];
    const { data, width } = pixels(rows);
    removeBackground(data, width, 3, { tolerance: 32, feather: 0 });

    expect(alphaAt(data, width, 0, 0)).toBe(0);
    expect(alphaAt(data, width, 3, 2)).toBe(0);
    expect(alphaAt(data, width, 1, 1)).toBe(255);
    expect(alphaAt(data, width, 2, 1)).toBe(255);
    // subject colour untouched
    const o = (1 * width + 1) * 4;
    expect(data[o]).toBe(200);
    expect(data[o + 1]).toBe(30);
  });

  it('protects a subject adjacent to the background when colours differ', () => {
    const white = [255, 255, 255];
    const dark = [20, 20, 20];
    const rows = [
      [white, white, white, white],
      [white, dark, dark, white],
      [white, dark, dark, white],
      [white, white, white, white],
    ];
    const { data, width } = pixels(rows);
    removeBackground(data, width, 4, { tolerance: 60, feather: 0 });
    // subject survives even though it touches the background on all sides
    expect(alphaAt(data, width, 1, 1)).toBe(255);
    expect(alphaAt(data, width, 2, 2)).toBe(255);
  });

  it('absorbs already-transparent pixels without changing their colour', () => {
    const white = [255, 255, 255];
    const rows = [
      [white, [0, 0, 0, 0]],
      [white, white],
    ];
    const { data, width } = pixels(rows);
    removeBackground(data, width, 2, { tolerance: 10, feather: 0 });
    expect(alphaAt(data, width, 1, 0)).toBe(0);
    expect(alphaAt(data, width, 0, 0)).toBe(0);
    expect(alphaAt(data, width, 0, 1)).toBe(0);
  });

  it('feather produces partial alpha at the background edge', () => {
    const white = [255, 255, 255];
    const red = [200, 30, 30];
    // 9x5: white background, 3x3 red subject block at x=3..5, y=1..3
    const rows: number[][][] = Array.from({ length: 5 }, (_, y) =>
      Array.from({ length: 9 }, (_, x) => (x >= 3 && x <= 5 && y >= 1 && y <= 3 ? red : white)),
    );
    const hard = pixels(rows.map((r) => r.map((p) => [...p])));
    removeBackground(hard.data, hard.width, 5, { tolerance: 32, feather: 0 });
    const soft = pixels(rows);
    removeBackground(soft.data, soft.width, 5, { tolerance: 32, feather: 1 });

    // background pixel adjacent to the subject: transparent when hard, partial when feathered
    expect(alphaAt(hard.data, hard.width, 2, 2)).toBe(0);
    const feathered = alphaAt(soft.data, soft.width, 2, 2);
    expect(feathered).toBeGreaterThan(0);
    expect(feathered).toBeLessThan(255);
    // subject centre sits 2px from the background — beyond the feather radius
    expect(alphaAt(soft.data, soft.width, 4, 2)).toBe(255);
  });

  it('is deterministic for identical inputs', () => {
    const make = (): Uint8ClampedArray => {
      const { data } = pixels([
        [[240, 240, 240], [240, 240, 240], [240, 240, 240]],
        [[240, 240, 240], [10, 10, 10], [240, 240, 240]],
        [[240, 240, 240], [240, 240, 240], [240, 240, 240]],
      ]);
      return data;
    };
    const a = make();
    const b = make();
    removeBackground(a, 3, 3, { tolerance: 40, feather: 1 });
    removeBackground(b, 3, 3, { tolerance: 40, feather: 1 });
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('leaves tiny images untouched without errors', () => {
    const { data, width } = pixels([[[255, 255, 255]]]);
    expect(() => removeBackground(data, width, 1, { tolerance: 32, feather: 0 })).not.toThrow();
  });
});
