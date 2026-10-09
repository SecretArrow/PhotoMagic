/**
 * Unit tests — color utilities (src/engine/color).
 *
 * Covers hex/rgb/hsl round trips on sample colors, known Rec.601 luma
 * values and histogram totals. Pure math — no DOM.
 */

import { describe, expect, it } from 'vitest';
import {
  computeHistogram,
  hexToHsl,
  hexToRgb,
  hslToHex,
  hslToRgb,
  luma601,
  rgbToHex,
  rgbToHsl,
} from '../../src/engine/color';

describe('hex ↔ rgb', () => {
  it('parses 6-digit, 3-digit and bare hex', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#336699')).toEqual({ r: 51, g: 102, b: 153 });
    expect(hexToRgb('abc')).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb('#ABC')).toEqual({ r: 170, g: 187, b: 204 });
  });

  it('parses invalid input to black', () => {
    expect(hexToRgb('#zzzzzz')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#12345')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('formats rgb back to lowercase hex with padding', () => {
    expect(rgbToHex({ r: 51, g: 102, b: 153 })).toBe('#336699');
    expect(rgbToHex({ r: 0, g: 8, b: 16 })).toBe('#000810');
    expect(rgbToHex({ r: 300, g: -5, b: 12.4 })).toBe('#ff000c'); // clamped
  });

  it('round trips sample colors', () => {
    for (const hex of ['#000000', '#ffffff', '#ff8800', '#10a37f', '#123456', '#808080']) {
      expect(rgbToHex(hexToRgb(hex))).toBe(hex);
    }
  });
});

describe('rgb ↔ hsl', () => {
  it('converts primaries, black and white', () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 });
    expect(rgbToHsl({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 100, l: 50 });
    expect(rgbToHsl({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 100, l: 50 });
    expect(rgbToHsl({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, l: 0 });
    expect(rgbToHsl({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, l: 100 });
    expect(rgbToHsl({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, l: 50 });
  });

  it('converts hsl back to rgb', () => {
    expect(hslToRgb({ h: 0, s: 100, l: 50 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hslToRgb({ h: 120, s: 100, l: 50 })).toEqual({ r: 0, g: 255, b: 0 });
    expect(hslToRgb({ h: 240, s: 100, l: 50 })).toEqual({ r: 0, g: 0, b: 255 });
    expect(hslToRgb({ h: 0, s: 0, l: 50 })).toEqual({ r: 128, g: 128, b: 128 });
  });

  it('round trips through hex on both paths', () => {
    const samples = ['#ff0000', '#00ff00', '#0000ff', '#ff8800', '#000000', '#ffffff', '#808080'];
    for (const hex of samples) {
      expect(hslToHex(hexToHsl(hex))).toBe(hex);
      expect(rgbToHex(hslToRgb(rgbToHsl(hexToRgb(hex))))).toBe(hex);
    }
  });
});

describe('luma601 (Rec.601)', () => {
  it('computes known luma values', () => {
    expect(luma601(0, 0, 0)).toBe(0);
    expect(luma601(255, 255, 255)).toBeCloseTo(255, 6);
    expect(luma601(255, 0, 0)).toBeCloseTo(76.245, 3); // 0.299 × 255
    expect(luma601(0, 255, 0)).toBeCloseTo(149.685, 3); // 0.587 × 255
    expect(luma601(0, 0, 255)).toBeCloseTo(29.07, 3); // 0.114 × 255
    expect(luma601(255, 255, 0)).toBeCloseTo(225.93, 3);
  });
});

describe('computeHistogram', () => {
  it('accumulates per-channel and luma totals, skipping transparent pixels', () => {
    // 4 RGBA pixels: red, green, white, fully-transparent blue
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      255, 255, 255, 255,
      0, 0, 255, 0,
    ]);
    const h = computeHistogram(data);

    expect(h.r[255]).toBe(2); // red + white
    expect(h.g[255]).toBe(2); // green + white
    expect(h.b[255]).toBe(1); // white only (transparent blue skipped)
    expect(h.luminance[255]).toBe(1); // white
    expect(h.max).toBe(2);

    // every opaque pixel contributes exactly once per channel
    const sum = (arr: number[]) => arr.reduce((acc, v) => acc + v, 0);
    expect(sum(h.r)).toBe(3);
    expect(sum(h.g)).toBe(3);
    expect(sum(h.b)).toBe(3);
  });

  it('bins values according to the requested precision', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255]);
    const coarse = computeHistogram(data, 64);
    expect(coarse.r).toHaveLength(64);
    expect(coarse.r[63]).toBe(2); // 255 maps to the top bin
    expect(coarse.max).toBe(2);
  });
});
