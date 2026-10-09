/**
 * Retouch tools — smudge, blur brush, sharpen brush, dodge, burn, clone stamp.
 *
 * All tools share the pixel-stroke history pattern (beginPixelStroke → live
 * region edits → finishPixelStroke → commitPixelEdit) and put processed
 * regions back through the stamp's soft alpha mask so edges stay feathered.
 *
 * - smudge: grab-drag approximation — the region under the previous stamp is
 *   re-drawn shifted toward the current position with alpha = strength.
 * - blur/sharpen: small box blur (boxBlurRGBA) / 5-point unsharp blend by
 *   strength, applied to the region under the stamp radius (+margin).
 * - dodge/burn: RGB scaled by 1 ± strength/300 per stamp.
 * - clone-stamp: alt+click picks a source point (cross marker overlay);
 *   aligned mode keeps the first stroke's offset across strokes, non-aligned
 *   recomputes it at every stroke start.
 *
 * v2: per-stamp rotation/jitter, sample-all-layers cloning.
 */

import { useEditorStore } from '../state/editorStore';
import type { CanvasPointerEvent, ToolContext, ToolController } from '../canvas/pointerContract';
import { boxBlurRGBA } from '../engine/filters/registry';
import { ctx2d } from '../engine/raster';
import type { RasterLayer, ToolId } from '../engine/types';
import type { RetouchOptions } from '../state/types';
import { interpolateStamps, makeStamp } from '../engine/brushes/stamp';
import {
  beginPixelStroke,
  bumpRevision,
  finishPixelStroke,
  putBackThroughStamp,
  rectOnCanvas,
  type PixelStroke,
} from './strokeCommon';
import { drawCross } from './shared';

interface RetouchGesture {
  stroke: PixelStroke;
  layer: RasterLayer;
  lastX: number;
  lastY: number;
  curX: number;
  curY: number;
}

type StampProcessor = (g: RetouchGesture, x: number, y: number, prevX: number, prevY: number, opts: RetouchOptions) => void;

function stampFootprint(x: number, y: number, layer: RasterLayer, size: number): { x: number; y: number } {
  return { x: Math.round(x - layer.x - size / 2), y: Math.round(y - layer.y - size / 2) };
}

function createRetouchController(
  tool: ToolId,
  labelKey: string,
  labelFallback: string,
  readOpts: () => RetouchOptions,
  processStamp: StampProcessor,
): ToolController {
  let g: RetouchGesture | null = null;

  const finish = (): void => {
    if (!g) return;
    finishPixelStroke(g.stroke, labelKey, labelFallback);
    bumpRevision();
    g = null;
  };

  return {
    tool,
    cursor: 'crosshair',
    onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
      const store = useEditorStore.getState();
      const layer = store.getActiveRasterLayer();
      if (!layer) return;
      g = { stroke: beginPixelStroke(layer), layer, lastX: e.docX, lastY: e.docY, curX: e.docX, curY: e.docY };
      processStamp(g, e.docX, e.docY, e.docX, e.docY, readOpts());
      bumpRevision();
      ctx.invalidate();
    },
    onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
      if (!g) return;
      const opts = readOpts();
      g.curX = e.docX;
      g.curY = e.docY;
      const spacing = Math.max(1, opts.size * 0.25);
      const pts = interpolateStamps(g.lastX, g.lastY, e.docX, e.docY, spacing);
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        processStamp(g, pts[i].x, pts[i].y, prev.x, prev.y, opts);
      }
      if (pts.length > 1) {
        g.lastX = pts[pts.length - 1].x;
        g.lastY = pts[pts.length - 1].y;
      }
      bumpRevision();
      ctx.invalidate();
    },
    onPointerUp(): void {
      finish();
    },
    onPointerCancel(): void {
      finish();
    },
    deactivate(): void {
      finish();
    },
  };
}

/* ----------------------------- smudge ----------------------------- */

function smudgeStamp(g: RetouchGesture, x: number, y: number, prevX: number, prevY: number, opts: RetouchOptions): void {
  if (prevX === x && prevY === y) return; // first dab has nothing to smear
  const layer = g.layer;
  const size = Math.max(2, opts.size);
  const r = size / 2;
  const strength = Math.min(100, Math.max(1, opts.strength)) / 100;
  // grab the region under the PREVIOUS stamp position…
  const px = prevX - layer.x;
  const py = prevY - layer.y;
  const grab = rectOnCanvas(layer.canvas, px - r, py - r, size, size);
  if (!grab) return;
  const data = ctx2d(layer.canvas).getImageData(grab.x, grab.y, grab.w, grab.h);
  const stamp = makeStamp(size, opts.hardness, '#000000');
  if (!stamp) return;
  // …and smear it toward the current position through the stamp mask
  putBackThroughStamp(
    layer,
    data,
    grab,
    stamp,
    stampFootprint(prevX, prevY, layer, size),
    strength,
    { dx: x - prevX, dy: y - prevY },
  );
}

/* -------------------------- blur / sharpen -------------------------- */

function blurStamp(g: RetouchGesture, x: number, y: number, _prevX: number, _prevY: number, opts: RetouchOptions): void {
  const layer = g.layer;
  const size = Math.max(2, opts.size);
  const r = size / 2;
  const cx = x - layer.x;
  const cy = y - layer.y;
  const margin = 3; // padding so the box-blur kernel sees neighbors at stamp edges
  const region = rectOnCanvas(layer.canvas, cx - r - margin, cy - r - margin, size + margin * 2, size + margin * 2);
  if (!region) return;
  const data = ctx2d(layer.canvas).getImageData(region.x, region.y, region.w, region.h);
  const radius = Math.max(1, Math.round((opts.strength / 100) * 3));
  boxBlurRGBA(data.data, data.width, data.height, radius, 2);
  const stamp = makeStamp(size, opts.hardness, '#000000');
  if (!stamp) return;
  putBackThroughStamp(layer, data, region, stamp, stampFootprint(x, y, layer, size), 1);
}

function sharpenStamp(g: RetouchGesture, x: number, y: number, _prevX: number, _prevY: number, opts: RetouchOptions): void {
  const layer = g.layer;
  const size = Math.max(2, opts.size);
  const r = size / 2;
  const cx = x - layer.x;
  const cy = y - layer.y;
  const margin = 2;
  const region = rectOnCanvas(layer.canvas, cx - r - margin, cy - r - margin, size + margin * 2, size + margin * 2);
  if (!region) return;
  const data = ctx2d(layer.canvas).getImageData(region.x, region.y, region.w, region.h);
  const src = new Uint8ClampedArray(data.data); // untouched copy for neighbor reads
  const k = Math.min(100, Math.max(0, opts.strength)) / 100;
  const rowBytes = data.width * 4;
  for (let yy = 1; yy < data.height - 1; yy++) {
    for (let xx = 1; xx < data.width - 1; xx++) {
      const o = (yy * data.width + xx) * 4;
      for (let c = 0; c < 3; c++) {
        const center = src[o + c];
        const neighbors =
          src[o - 4 + c] + src[o + 4 + c] + src[o - rowBytes + c] + src[o + rowBytes + c];
        const sharp = center * 5 - neighbors; // 5-point unsharp
        data.data[o + c] = center + (sharp - center) * k;
      }
    }
  }
  const stamp = makeStamp(size, opts.hardness, '#000000');
  if (!stamp) return;
  putBackThroughStamp(layer, data, region, stamp, stampFootprint(x, y, layer, size), 1);
}

/* --------------------------- dodge / burn --------------------------- */

function dodgeBurnStamp(factor: number): StampProcessor {
  return (g, x, y, _prevX, _prevY, opts) => {
    const layer = g.layer;
    const size = Math.max(2, opts.size);
    const r = size / 2;
    const cx = x - layer.x;
    const cy = y - layer.y;
    const region = rectOnCanvas(layer.canvas, cx - r, cy - r, size, size);
    if (!region) return;
    const data = ctx2d(layer.canvas).getImageData(region.x, region.y, region.w, region.h);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i] * factor;
      d[i + 1] = d[i + 1] * factor;
      d[i + 2] = d[i + 2] * factor;
    }
    const stamp = makeStamp(size, opts.hardness, '#000000');
    if (!stamp) return;
    putBackThroughStamp(layer, data, region, stamp, stampFootprint(x, y, layer, size), 1);
  };
}

/* --------------------------- controllers ---------------------------- */

export const smudgeController: ToolController = createRetouchController(
  'smudge',
  'history.smudgeStroke',
  'Smudge',
  () => useEditorStore.getState().toolOptions.smudge,
  smudgeStamp,
);

export const blurBrushController: ToolController = createRetouchController(
  'blur-brush',
  'history.blurStroke',
  'Blur stroke',
  () => useEditorStore.getState().toolOptions.blurBrush,
  blurStamp,
);

export const sharpenBrushController: ToolController = createRetouchController(
  'sharpen-brush',
  'history.sharpenStroke',
  'Sharpen stroke',
  () => useEditorStore.getState().toolOptions.sharpenBrush,
  sharpenStamp,
);

// dodge/burn factors depend on the live strength option; wrap with a dynamic processor
const dodgeDynamic: StampProcessor = (g, x, y, prevX, prevY, opts) =>
  dodgeBurnStamp(1 + Math.min(100, Math.max(0, opts.strength)) / 300)(g, x, y, prevX, prevY, opts);
const burnDynamic: StampProcessor = (g, x, y, prevX, prevY, opts) =>
  dodgeBurnStamp(Math.max(0.05, 1 - Math.min(100, Math.max(0, opts.strength)) / 300))(g, x, y, prevX, prevY, opts);

export const dodgeController: ToolController = createRetouchController(
  'dodge',
  'history.dodgeStroke',
  'Dodge',
  () => useEditorStore.getState().toolOptions.dodge,
  dodgeDynamic,
);

export const burnController: ToolController = createRetouchController(
  'burn',
  'history.burnStroke',
  'Burn',
  () => useEditorStore.getState().toolOptions.burn,
  burnDynamic,
);

/* ---------------------------- clone stamp ---------------------------- */

interface CloneGesture extends RetouchGesture {
  offset: { dx: number; dy: number };
}

let srcPoint: { x: number; y: number } | null = null;
let persistentOffset: { dx: number; dy: number } | null = null; // reused by aligned mode across strokes
let cloneG: CloneGesture | null = null;

function cloneStampAt(g: CloneGesture, x: number, y: number): void {
  const opts = useEditorStore.getState().toolOptions.clone;
  const layer = g.layer;
  const size = Math.max(2, opts.size);
  const r = size / 2;
  const sampleX = x - g.offset.dx;
  const sampleY = y - g.offset.dy;
  const srcRect = rectOnCanvas(layer.canvas, sampleX - layer.x - r, sampleY - layer.y - r, size, size);
  if (!srcRect) return;
  const data = ctx2d(layer.canvas).getImageData(srcRect.x, srcRect.y, srcRect.w, srcRect.h);
  const stamp = makeStamp(size, opts.hardness, '#000000');
  if (!stamp) return;
  putBackThroughStamp(
    layer,
    data,
    srcRect,
    stamp,
    stampFootprint(x, y, layer, size),
    Math.max(0.01, Math.min(1, opts.opacity / 100)),
    { dx: g.offset.dx, dy: g.offset.dy },
  );
}

function finishClone(): void {
  if (!cloneG) return;
  finishPixelStroke(cloneG.stroke, 'history.cloneStroke', 'Clone stamp');
  bumpRevision();
  cloneG = null;
}

export const cloneStampController: ToolController = {
  tool: 'clone-stamp',
  cursor: 'crosshair',
  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    const store = useEditorStore.getState();
    if (e.alt) {
      // alt+click sets the clone source (no stroke)
      srcPoint = { x: e.docX, y: e.docY };
      persistentOffset = null;
      ctx.invalidate();
      return;
    }
    if (!srcPoint) return; // no source picked yet
    const layer = store.getActiveRasterLayer();
    if (!layer) return;
    const aligned = store.toolOptions.clone.aligned;
    const offset: { dx: number; dy: number } =
      aligned && persistentOffset ? persistentOffset : { dx: e.docX - srcPoint.x, dy: e.docY - srcPoint.y };
    if (aligned) persistentOffset = offset;
    cloneG = {
      stroke: beginPixelStroke(layer),
      layer,
      lastX: e.docX,
      lastY: e.docY,
      curX: e.docX,
      curY: e.docY,
      offset,
    };
    cloneStampAt(cloneG, e.docX, e.docY);
    bumpRevision();
    ctx.invalidate();
  },
  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!cloneG) return;
    const opts = useEditorStore.getState().toolOptions.clone;
    const spacing = Math.max(1, opts.size * 0.25);
    const pts = interpolateStamps(cloneG.lastX, cloneG.lastY, e.docX, e.docY, spacing);
    for (let i = 1; i < pts.length; i++) cloneStampAt(cloneG, pts[i].x, pts[i].y);
    if (pts.length > 1) {
      cloneG.lastX = pts[pts.length - 1].x;
      cloneG.lastY = pts[pts.length - 1].y;
    }
    bumpRevision();
    ctx.invalidate();
  },
  onPointerUp(): void {
    finishClone();
  },
  onPointerCancel(): void {
    finishClone();
  },
  deactivate(): void {
    finishClone();
  },
  drawOverlay(ctx, view) {
    if (!srcPoint) return;
    drawCross(ctx, view, srcPoint.x, srcPoint.y, 14);
  },
};
