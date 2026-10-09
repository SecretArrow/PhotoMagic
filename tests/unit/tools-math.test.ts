/**
 * Unit tests for pure tool math — stamp spacing interpolation and stamp
 * cache keying (see src/engine/brushes/stamp.ts). Canvas-dependent behavior
 * (makeStamp) degrades to null in Node; only the DOM-free pieces are tested.
 */

import { describe, expect, it } from 'vitest';
import { interpolateStamps, makeStamp, stampKey, stampSupported } from '../../src/engine/brushes/stamp';

describe('interpolateStamps', () => {
  it('spaces horizontal stamps exactly and includes both endpoints', () => {
    const pts = interpolateStamps(0, 0, 60, 0, 15);
    expect(pts).toHaveLength(Math.floor(60 / 15) + 1); // 5
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 60, y: 0 });
    expect(pts.map((p) => p.x)).toEqual([0, 15, 30, 45, 60]);
    for (const p of pts) expect(p.y).toBe(0);
  });

  it('keeps diagonal stamps on the line and includes both endpoints', () => {
    const pts = interpolateStamps(0, 0, 30, 30, 15);
    expect(pts).toHaveLength(3); // floor(42.43 / 15) + 1
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 30, y: 30 });
    for (const p of pts) expect(p.x).toBeCloseTo(p.y, 6); // on the line y = x
  });

  it('respects count = floor(dist/spacing)+1 and endpoint inclusion for non-multiples', () => {
    const pts = interpolateStamps(0, 0, 90, 0, 25);
    expect(pts).toHaveLength(Math.floor(90 / 25) + 1); // 4
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 90, y: 0 });
    // evenly spaced between the endpoints
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].x - pts[i - 1].x).toBeCloseTo(30, 6);
    }
  });

  it('returns a single point for zero-length segments', () => {
    const pts = interpolateStamps(5, 7, 5, 7, 20);
    expect(pts).toEqual([{ x: 5, y: 7 }]);
  });

  it('clamps spacing to a minimum of 1px', () => {
    const pts = interpolateStamps(0, 0, 3, 0, 0);
    expect(pts).toHaveLength(4);
    expect(pts.map((p) => p.x)).toEqual([0, 1, 2, 3]);
  });
});

describe('stampKey', () => {
  it('is stable for identical arguments', () => {
    expect(stampKey(24, 80, '#ff0000')).toBe(stampKey(24, 80, '#ff0000'));
  });

  it('differs for different size / hardness / color', () => {
    const base = stampKey(24, 80, '#ff0000');
    expect(stampKey(32, 80, '#ff0000')).not.toBe(base);
    expect(stampKey(24, 50, '#ff0000')).not.toBe(base);
    expect(stampKey(24, 80, '#00ff00')).not.toBe(base);
  });

  it('normalizes color and clamps inputs', () => {
    expect(stampKey(24, 80, 'ff0000')).toBe(stampKey(24, 80, '#ff0000'));
    expect(stampKey(0, 500, '#ffffff')).toBe(stampKey(1, 100, '#ffffff'));
  });
});

describe('makeStamp (Node guard)', () => {
  it('reports DOM support correctly and never throws in Node', () => {
    if (!stampSupported()) {
      expect(makeStamp(20, 50, '#ff0000')).toBeNull();
    } else {
      expect(makeStamp(20, 50, '#ff0000')).not.toBeNull();
    }
  });
});
