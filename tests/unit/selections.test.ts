/**
 * Unit tests — selection engine (src/engine/selections).
 *
 * Covers marquee rect/ellipse coverage + bounds, combine modes
 * (add/subtract/intersect), invert, feather behavior, outline tracing
 * and flood-select on synthetic buffers. Pure mask math — no DOM.
 */

import { describe, expect, it } from 'vitest';
import {
  combineSelections,
  ellipseSelection,
  featherSelection,
  floodSelect,
  invertSelection,
  rectSelection,
  traceOutline,
} from '../../src/engine/selections';
import type { Selection } from '../../src/engine/types';

/** Coverage value at a pixel (assumes sel is non-null). */
function at(sel: Selection, x: number, y: number): number {
  return sel.mask[y * sel.width + x];
}

function maxOf(m: Uint8ClampedArray): number {
  let max = 0;
  for (let i = 0; i < m.length; i++) if (m[i] > max) max = m[i];
  return max;
}

describe('rectSelection', () => {
  it('covers the rectangle and reports exact bounds', () => {
    const sel = rectSelection(2, 3, 4, 5, 10, 10);
    expect(sel).not.toBeNull();
    expect(sel!.bounds).toEqual({ x: 2, y: 3, w: 4, h: 5 });

    expect(at(sel!, 2, 3)).toBe(255); // top-left inside
    expect(at(sel!, 5, 7)).toBe(255); // bottom-right inside
    expect(at(sel!, 6, 3)).toBe(0); // right edge outside
    expect(at(sel!, 2, 8)).toBe(0); // below bottom edge
    expect(at(sel!, 1, 3)).toBe(0); // left edge outside
    expect(at(sel!, 0, 0)).toBe(0);
    expect(sel!.outline.length).toBeGreaterThanOrEqual(1);
  });

  it('clamps and normalizes negative / flipped rects', () => {
    const sel = rectSelection(6, 6, -4, -3, 10, 10);
    expect(sel).not.toBeNull();
    expect(sel!.bounds).toEqual({ x: 2, y: 3, w: 4, h: 3 });
  });
});

describe('ellipseSelection', () => {
  it('fills a circle, keeps document corners empty', () => {
    const sel = ellipseSelection(10, 10, 20, 20, 40, 40); // circle r=10 at (20,20)
    expect(sel).not.toBeNull();

    // covered: center + cardinal interior points
    expect(at(sel!, 20, 20)).toBe(255);
    expect(at(sel!, 20, 15)).toBe(255);
    expect(at(sel!, 15, 20)).toBe(255);
    expect(at(sel!, 25, 20)).toBe(255);

    // empty: just outside on the axes
    expect(at(sel!, 9, 20)).toBe(0);
    expect(at(sel!, 30, 20)).toBe(0);
    expect(at(sel!, 20, 9)).toBe(0);

    // empty: all four document corners
    expect(at(sel!, 0, 0)).toBe(0);
    expect(at(sel!, 39, 0)).toBe(0);
    expect(at(sel!, 0, 39)).toBe(0);
    expect(at(sel!, 39, 39)).toBe(0);

    // coverage stays within the geometric bounds
    expect(sel!.bounds.x).toBeGreaterThanOrEqual(10);
    expect(sel!.bounds.x + sel!.bounds.w).toBeLessThanOrEqual(30);
    expect(sel!.bounds.y).toBeGreaterThanOrEqual(10);
    expect(sel!.bounds.y + sel!.bounds.h).toBeLessThanOrEqual(30);
  });
});

describe('combineSelections', () => {
  const docW = 8;
  const docH = 8;
  const a = rectSelection(0, 0, 4, 4, docW, docH)!;
  const b = rectSelection(2, 2, 4, 4, docW, docH)!;

  it('add unions coverage', () => {
    const added = combineSelections(a, b, 'add');
    expect(added).not.toBeNull();
    expect(at(added!, 1, 1)).toBe(255); // only in base
    expect(at(added!, 5, 5)).toBe(255); // only in next
    expect(at(added!, 3, 3)).toBe(255); // overlap
    expect(added!.bounds).toEqual({ x: 0, y: 0, w: 6, h: 6 });
  });

  it('subtract carves the next mask out of the base', () => {
    const sub = combineSelections(a, b, 'subtract');
    expect(sub).not.toBeNull();
    expect(at(sub!, 1, 1)).toBe(255); // base only
    expect(at(sub!, 3, 3)).toBe(0); // 255 - 255
    expect(at(sub!, 5, 5)).toBe(0); // was never in base
    expect(sub!.bounds).toEqual({ x: 0, y: 0, w: 4, h: 4 });
  });

  it('intersect keeps only the overlap', () => {
    const inter = combineSelections(a, b, 'intersect');
    expect(inter).not.toBeNull();
    expect(at(inter!, 3, 3)).toBe(255);
    expect(at(inter!, 1, 1)).toBe(0);
    expect(at(inter!, 5, 5)).toBe(0);
    expect(inter!.bounds).toEqual({ x: 2, y: 2, w: 2, h: 2 });
  });

  it('replace returns the next selection; null handling is mode-aware', () => {
    expect(combineSelections(a, b, 'replace')).toBe(b);
    expect(combineSelections(a, null, 'add')).toBe(a);
    expect(combineSelections(a, null, 'replace')).toBeNull();
    expect(combineSelections(null, b, 'add')).toBe(b);
  });
});

describe('invertSelection', () => {
  it('flips coverage and recomputes bounds', () => {
    // base covers the top-left quadrant; the inverse is the L-shaped remainder
    const base = rectSelection(0, 0, 4, 4, 8, 8)!;
    const inv = invertSelection(base);
    expect(inv).not.toBeNull();
    expect(at(inv!, 1, 1)).toBe(0); // inside base → cleared
    expect(at(inv!, 3, 3)).toBe(0);
    expect(at(inv!, 5, 5)).toBe(255); // bottom-right quadrant
    expect(at(inv!, 6, 0)).toBe(255); // top rows right of base
    expect(at(inv!, 0, 6)).toBe(255); // left column below base
    expect(inv!.bounds).toEqual({ x: 0, y: 0, w: 8, h: 8 });
  });
});

describe('featherSelection', () => {
  it('keeps coverage a blurred subset: max never grows, interior holds', () => {
    const base = rectSelection(3, 3, 6, 6, 12, 12)!;
    const feathered = featherSelection(base, 1);

    expect(maxOf(feathered.mask)).toBeLessThanOrEqual(maxOf(base.mask));
    expect(at(feathered, 6, 6)).toBe(255); // deep interior stays fully covered
    expect(at(feathered, 3, 3)).toBeGreaterThan(0); // original edge survives

    // blur spreads support outward (original-empty neighbor gains partial coverage)
    expect(at(base, 2, 2)).toBe(0);
    expect(at(feathered, 2, 2)).toBeGreaterThan(0);
  });

  it('radius 0 returns the selection untouched', () => {
    const base = rectSelection(1, 1, 3, 3, 8, 8)!;
    expect(featherSelection(base, 0)).toBe(base);
  });
});

describe('traceOutline', () => {
  it('returns at least one closed polyline for a solid square', () => {
    const sel = rectSelection(2, 2, 4, 4, 10, 10)!;
    const lines = traceOutline(sel.mask, 10, 10);
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const first = lines[0];
    expect(first.length).toBeGreaterThanOrEqual(8); // at least 4 points
    expect(first.length % 2).toBe(0); // flat [x0,y0,x1,y1,...] pairs
    // the polyline closes back onto its start point
    expect(first[0]).toBe(first[first.length - 2]);
    expect(first[1]).toBe(first[first.length - 1]);
  });
});

describe('floodSelect', () => {
  /** 3×3 RGBA buffer: red background, blue center pixel. */
  function syntheticBuffer(): Uint8ClampedArray {
    const data = new Uint8ClampedArray(9 * 4);
    for (let i = 0; i < 9; i++) {
      data[i * 4] = 255;
      data[i * 4 + 1] = 0;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 255;
    }
    data[4 * 4] = 0; // center pixel → blue
    data[4 * 4 + 2] = 255;
    return data;
  }

  it('contiguous flood at tolerance 0 selects the matching region only', () => {
    const sel = floodSelect(syntheticBuffer(), 3, 3, 0, 0, 0, true);
    expect(sel).not.toBeNull();
    expect(at(sel!, 0, 0)).toBe(255);
    expect(at(sel!, 2, 2)).toBe(255);
    expect(at(sel!, 1, 1)).toBe(0); // blue center excluded
    expect(sel!.bounds).toEqual({ x: 0, y: 0, w: 3, h: 3 });
  });

  it('non-contiguous flood matches the seed color everywhere', () => {
    // seed on the blue center → only that pixel matches at tolerance 0
    const sel = floodSelect(syntheticBuffer(), 3, 3, 1, 1, 0, false);
    expect(sel).not.toBeNull();
    expect(at(sel!, 1, 1)).toBe(255);
    expect(at(sel!, 0, 0)).toBe(0);
    expect(sel!.bounds).toEqual({ x: 1, y: 1, w: 1, h: 1 });
  });

  it('returns null for out-of-bounds seeds', () => {
    expect(floodSelect(syntheticBuffer(), 3, 3, -1, 0, 0, true)).toBeNull();
    expect(floodSelect(syntheticBuffer(), 3, 3, 3, 0, 0, true)).toBeNull();
  });
});
