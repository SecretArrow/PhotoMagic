/**
 * Unit tests for the WebGPU display path's PURE parts only
 * (src/canvas/gpu.ts). Node cannot initialize WebGPU — all GPU-touching
 * code stays behind runtime guards and is intentionally not exercised here:
 *
 *  - viewToMat3 must be exactly CanvasStage's doc→screen transform
 *    (scale(flip) → rotate → translate(pan) → scale(zoom), i.e. the same
 *    result as pointerContract.docToScreen);
 *  - the inverse must invert it (screenToDoc consistency);
 *  - the CSS→NDC map and the checker parity contract the shader implements;
 *  - the settings.renderer wiring policy and the navigator feature detect.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkerCellIsDark,
  isWebGPUAvailable,
  mat3Apply,
  mat3Inverse,
  mat3Multiply,
  ndcFromCss,
  resolveDisplayBackend,
  viewToMat3,
} from '../../src/canvas/gpu';
import { docToScreen, screenToDoc } from '../../src/canvas/pointerContract';
import type { ViewState } from '../../src/engine/types';

const views: ViewState[] = [
  { zoom: 1, panX: 0, panY: 0, rotation: 0, flipX: false, flipY: false },
  { zoom: 2.5, panX: 40, panY: -17, rotation: 0, flipX: false, flipY: false },
  { zoom: 0.3, panX: -5, panY: 12, rotation: Math.PI / 6, flipX: false, flipY: false },
  { zoom: 1.75, panX: 9, panY: 0, rotation: 0, flipX: true, flipY: false },
  { zoom: 0.9, panX: 0, panY: 33, rotation: 0, flipX: false, flipY: true },
  { zoom: 3.2, panX: -120, panY: 88, rotation: -Math.PI / 4, flipX: true, flipY: true },
];

const points = [
  { x: 0, y: 0 },
  { x: 100, y: 50 },
  { x: 7.25, y: -3.5 },
];

describe('viewToMat3 (doc → screen)', () => {
  it('matches docToScreen for zoom/pan/flip/rotation combinations', () => {
    for (const view of views) {
      const m = viewToMat3(view);
      for (const p of points) {
        const viaMatrix = mat3Apply(m, p.x, p.y);
        const viaContract = docToScreen(view, p.x, p.y);
        expect(viaMatrix.x).toBeCloseTo(viaContract.x, 9);
        expect(viaMatrix.y).toBeCloseTo(viaContract.y, 9);
      }
    }
  });

  it('reduces to zoom + pan at the default view', () => {
    const m = viewToMat3({ zoom: 2, panX: 10, panY: 20, rotation: 0, flipX: false, flipY: false });
    expect(mat3Apply(m, 0, 0)).toEqual({ x: 10, y: 20 });
    expect(mat3Apply(m, 5, 3)).toEqual({ x: 20, y: 26 });
  });

  it('flips mirror the axes including the translation', () => {
    const m = viewToMat3({ zoom: 1, panX: 30, panY: 40, rotation: 0, flipX: true, flipY: true });
    // flip applies after translate: screen = -(doc + pan)
    expect(mat3Apply(m, 2, 3)).toEqual({ x: -32, y: -43 });
  });
});

describe('mat3Inverse (screen → doc consistency)', () => {
  it('inverts viewToMat3 exactly (roundtrip through screenToDoc)', () => {
    for (const view of views) {
      const m = viewToMat3(view);
      const inv = mat3Inverse(m);
      for (const p of points) {
        const screen = docToScreen(view, p.x, p.y);
        const back = mat3Apply(inv, screen.x, screen.y);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);

        // same answer as the pointer contract's screenToDoc
        const viaContract = screenToDoc(view, screen.x, screen.y);
        expect(viaContract.x).toBeCloseTo(p.x, 6);
        expect(viaContract.y).toBeCloseTo(p.y, 6);
      }
    }
  });

  it('composes with mat3Multiply as M·M⁻¹ = I', () => {
    const m = viewToMat3(views[5]);
    const identity = mat3Multiply(m, mat3Inverse(m));
    expect(identity[0]).toBeCloseTo(1, 9);
    expect(identity[4]).toBeCloseTo(1, 9);
    expect(identity[8]).toBeCloseTo(1, 9);
    expect(identity[1]).toBeCloseTo(0, 9);
    expect(identity[2]).toBeCloseTo(0, 9);
    expect(identity[3]).toBeCloseTo(0, 9);
  });
});

describe('ndcFromCss (CSS px → clip space)', () => {
  it('maps the viewport corners to (±1, ∓1) with the y axis flipped', () => {
    const n = ndcFromCss(1280, 800);
    expect(mat3Apply(n, 0, 0)).toEqual({ x: -1, y: 1 });
    const far = mat3Apply(n, 1280, 800);
    expect(far.x).toBeCloseTo(1, 9);
    expect(far.y).toBeCloseTo(-1, 9);
    const mid = mat3Apply(n, 640, 400);
    expect(mid.x).toBeCloseTo(0, 9);
    expect(mid.y).toBeCloseTo(0, 9);
  });

  it('keeps the full doc→NDC chain centered for the viewport-center doc point', () => {
    const view = views[1];
    // the doc point that sits exactly at the viewport center (screen 640,400)
    const center = screenToDoc(view, 640, 400);
    const chain = mat3Multiply(ndcFromCss(1280, 800), viewToMat3(view));
    const ndc = mat3Apply(chain, center.x, center.y);
    expect(ndc.x).toBeCloseTo(0, 6);
    expect(ndc.y).toBeCloseTo(0, 6);
  });
});

describe('checkerCellIsDark (shader parity contract)', () => {
  it('mirrors paintChecker: dark cells sit on even (i+j) parity of the cell grid', () => {
    expect(checkerCellIsDark(0, 0, 8)).toBe(true); // (0,0) dark — tile origin
    expect(checkerCellIsDark(8, 0, 8)).toBe(false);
    expect(checkerCellIsDark(0, 8, 8)).toBe(false);
    expect(checkerCellIsDark(8, 8, 8)).toBe(true);
    expect(checkerCellIsDark(7.9, 3, 8)).toBe(true); // fractional coords floor
    expect(checkerCellIsDark(-1, 0, 8)).toBe(false); // negative indices stay grid-anchored
  });

  it('clamps degenerate cells to 1 px', () => {
    expect(checkerCellIsDark(0, 0, 0)).toBe(true);
    expect(checkerCellIsDark(1, 0, 0)).toBe(false);
  });
});

describe('resolveDisplayBackend (settings wiring policy)', () => {
  it('uses WebGPU only for auto + available + never-failed', () => {
    expect(resolveDisplayBackend('auto', true, false)).toBe('webgpu');
  });

  it('forces Canvas2D in every fallback case', () => {
    expect(resolveDisplayBackend('canvas2d', true, false)).toBe('canvas2d');
    expect(resolveDisplayBackend('auto', false, false)).toBe('canvas2d');
    expect(resolveDisplayBackend('auto', true, true)).toBe('canvas2d');
    expect(resolveDisplayBackend('canvas2d', false, true)).toBe('canvas2d');
  });
});

describe('isWebGPUAvailable (feature detect)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true when navigator.gpu exists', () => {
    vi.stubGlobal('navigator', { gpu: {} });
    expect(isWebGPUAvailable()).toBe(true);
  });

  it('is false when navigator exists without gpu', () => {
    vi.stubGlobal('navigator', {});
    expect(isWebGPUAvailable()).toBe(false);
  });

  it('is false when navigator is undefined (SSR/tests)', () => {
    vi.stubGlobal('navigator', undefined);
    expect(isWebGPUAvailable()).toBe(false);
  });
});
