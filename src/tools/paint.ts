/**
 * Painting tools — brush, pencil, eraser, airbrush.
 *
 * History pattern: at stroke start the full layer buffer is snapshotted
 * (beginPixelStroke), stamps are applied LIVE into the layer canvas during
 * the gesture, and at pointerup commitPixelEdit diffs before/after and
 * records one history entry ('history.<tool>Stroke'; no entry when the
 * stroke changed nothing).
 *
 * Alpha model (approved v1 approximation): every stamp applies
 * alpha = opacity × flow (× pressure factor when pressureOpacity is on).
 * Overlapping stamps accumulate like real flow without a separate stroke
 * buffer. Spacing is derived from size × spacing% via interpolateStamps;
 * smoothing is an EMA stabilizer over the pointer position.
 *
 * Selection: each dab is alpha-masked by the current selection coverage
 * (see drawStampWithSelection). Locked / non-raster layers are guarded via
 * getActiveRasterLayer().
 */

import { useEditorStore } from '../state/editorStore';
import type { CanvasPointerEvent, ToolContext, ToolController } from '../canvas/pointerContract';
import type { RasterLayer, ToolId } from '../engine/types';
import type { BrushOptions } from '../state/types';
import { interpolateStamps, makeStamp } from '../engine/brushes/stamp';
import {
  beginPixelStroke,
  bumpRevision,
  drawStampWithSelection,
  finishPixelStroke,
  type PixelStroke,
} from './strokeCommon';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

interface StrokeGesture {
  stroke: PixelStroke;
  layer: RasterLayer;
  emaX: number;
  emaY: number;
  lastStampX: number;
  lastStampY: number;
  curX: number;
  curY: number;
  pressure: number;
  timer: number | null;
}

interface StampParams {
  size: number;
  hardness: number;
  alpha: number;
  color: string;
}

interface PaintConfig<O> {
  labelKey: string;
  labelFallback: string;
  readOpts(): O;
  stamp(opts: O, pressure: number): StampParams;
  /** stamp spacing in doc px for the given dab size */
  spacingPx(opts: O, size: number): number;
  /** smoothing EMA strength 0..100 */
  smoothingPct(opts: O): number;
  mode: 'normal' | 'erase';
  /** airbrush: keep spraying at the held position on a 30ms timer */
  continuous?: boolean;
}

function createPaintController<O>(tool: ToolId, cfg: PaintConfig<O>): ToolController {
  let g: StrokeGesture | null = null;

  const stampAt = (layer: RasterLayer, x: number, y: number, pressure: number): void => {
    const opts = cfg.readOpts();
    const p = cfg.stamp(opts, pressure);
    const stamp = makeStamp(p.size, p.hardness, p.color);
    if (!stamp) return;
    drawStampWithSelection(layer, stamp, x, y, p.alpha, cfg.mode);
  };

  const stopTimer = (): void => {
    if (g && g.timer != null) {
      window.clearInterval(g.timer);
      g.timer = null;
    }
  };

  const finish = (): void => {
    if (!g) return;
    stopTimer();
    finishPixelStroke(g.stroke, cfg.labelKey, cfg.labelFallback);
    bumpRevision();
    g = null;
  };

  return {
    tool,
    cursor: 'crosshair',
    onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
      const store = useEditorStore.getState();
      const layer = store.getActiveRasterLayer();
      if (!layer) return; // no editable raster layer (locked or non-raster) — options bar toasts
      g = {
        stroke: beginPixelStroke(layer),
        layer,
        emaX: e.docX,
        emaY: e.docY,
        lastStampX: e.docX,
        lastStampY: e.docY,
        curX: e.docX,
        curY: e.docY,
        pressure: e.pressure,
        timer: null,
      };
      stampAt(layer, e.docX, e.docY, e.pressure);
      if (cfg.continuous) {
        g.timer = window.setInterval(() => {
          if (!g) return;
          stampAt(g.layer, g.curX, g.curY, g.pressure);
          bumpRevision();
        }, 30);
      }
      bumpRevision();
      ctx.invalidate();
    },
    onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
      if (!g) return;
      g.pressure = e.pressure;
      g.curX = e.docX;
      g.curY = e.docY;
      if (!cfg.continuous) {
        const opts = cfg.readOpts();
        const smoothing = Math.min(0.95, Math.max(0, cfg.smoothingPct(opts)) / 100);
        const f = 1 - smoothing;
        g.emaX += (e.docX - g.emaX) * f;
        g.emaY += (e.docY - g.emaY) * f;
        const size = cfg.stamp(opts, e.pressure).size;
        const spacing = cfg.spacingPx(opts, size);
        const pts = interpolateStamps(g.lastStampX, g.lastStampY, g.emaX, g.emaY, spacing);
        // index 0 is the previously stamped position — skip to avoid double alpha
        for (let i = 1; i < pts.length; i++) stampAt(g.layer, pts[i].x, pts[i].y, e.pressure);
        if (pts.length > 1) {
          g.lastStampX = pts[pts.length - 1].x;
          g.lastStampY = pts[pts.length - 1].y;
        }
      }
      bumpRevision();
      ctx.invalidate();
    },
    onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void {
      if (!g) return;
      g.curX = e.docX;
      g.curY = e.docY;
      g.pressure = e.pressure;
      // endpoint dab when the interpolated stamps stopped short of the cursor
      if (!cfg.continuous && Math.hypot(e.docX - g.lastStampX, e.docY - g.lastStampY) >= 0.5) {
        stampAt(g.layer, e.docX, e.docY, e.pressure);
      }
      finish();
      ctx.invalidate();
    },
    onPointerCancel(): void {
      finish();
    },
    deactivate(): void {
      finish();
    },
  };
}

const brushStamp = (opts: BrushOptions, pressure: number, color: string): StampParams => {
  const sizeScale = opts.pressureSize ? 0.5 + pressure : 1;
  const alphaScale = opts.pressureOpacity ? 0.5 + pressure : 1;
  return {
    size: Math.max(1, opts.size * sizeScale),
    hardness: opts.hardness,
    alpha: clamp01((opts.opacity / 100) * (opts.flow / 100) * alphaScale),
    color,
  };
};

export const brushController: ToolController = createPaintController<BrushOptions>('brush', {
  labelKey: 'history.brushStroke',
  labelFallback: 'Brush stroke',
  mode: 'normal',
  readOpts: () => useEditorStore.getState().toolOptions.brush,
  stamp: (opts, pressure) => brushStamp(opts, pressure, useEditorStore.getState().fgColor),
  spacingPx: (opts, size) => Math.max(1, (size * opts.spacing) / 100),
  smoothingPct: (opts) => opts.smoothing,
});

export const eraserController: ToolController = createPaintController<BrushOptions>('eraser', {
  labelKey: 'history.eraserStroke',
  labelFallback: 'Eraser stroke',
  mode: 'erase',
  readOpts: () => useEditorStore.getState().toolOptions.eraser,
  stamp: (opts, pressure) => brushStamp(opts, pressure, '#000000'),
  spacingPx: (opts, size) => Math.max(1, (size * opts.spacing) / 100),
  smoothingPct: (opts) => opts.smoothing,
});

export const pencilController: ToolController = createPaintController<{ size: number; opacity: number }>('pencil', {
  labelKey: 'history.pencilStroke',
  labelFallback: 'Pencil stroke',
  mode: 'normal',
  readOpts: () => useEditorStore.getState().toolOptions.pencil,
  stamp: (opts) => ({
    size: Math.max(1, opts.size),
    hardness: 100, // aliased hard dab
    alpha: clamp01(opts.opacity / 100),
    color: useEditorStore.getState().fgColor,
  }),
  spacingPx: (_opts, size) => Math.max(1, size * 0.5),
  smoothingPct: () => 0,
});

export const airbrushController: ToolController = createPaintController<BrushOptions>('airbrush', {
  labelKey: 'history.airbrushStroke',
  labelFallback: 'Airbrush stroke',
  mode: 'normal',
  continuous: true,
  readOpts: () => useEditorStore.getState().toolOptions.airbrush,
  stamp: (opts, pressure) => brushStamp(opts, pressure, useEditorStore.getState().fgColor),
  spacingPx: (opts, size) => Math.max(1, (size * opts.spacing) / 100),
  smoothingPct: (opts) => opts.smoothing,
});
