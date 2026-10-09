/**
 * Shape tool — drag draws a live preview; release creates a real shape layer.
 *
 * Geometry is built from toolOptions.shape: rect (rounded via radius),
 * ellipse, line (45° snapping with shift), polygon and star (drag radius from
 * the start point = center). shift constrains rect/ellipse to squares/circles.
 * Fill/stroke come from the shape options; the layer is committed through
 * store.addLayer with the 'history.addLayer' label.
 *
 * v2: alt = draw from center, live resize of an existing shape layer.
 */

import { useEditorStore } from '../state/editorStore';
import type { CanvasPointerEvent, ToolContext, ToolController } from '../canvas/pointerContract';
import { buildShapePath } from '../engine/paint';
import { countLayers, createShapeLayer, shapeBBox } from '../engine/document';
import type { Paint, ShapeGeometry, StrokeStyle, ToolId } from '../engine/types';
import { applyDocTransform, px, type OverlayCtx } from './shared';

interface Pt {
  x: number;
  y: number;
}

let start: Pt | null = null;
let cur: Pt | null = null;
let shift = false;

function buildGeometry(startPt: Pt, curPt: Pt, shiftHeld: boolean): ShapeGeometry | null {
  const store = useEditorStore.getState();
  const opts = store.toolOptions.shape;
  const dx = curPt.x - startPt.x;
  const dy = curPt.y - startPt.y;
  if (opts.shape === 'line') {
    let ex = curPt.x;
    let ey = curPt.y;
    if (shiftHeld) {
      // snap to 45° increments
      const snapped = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      ex = startPt.x + Math.cos(snapped) * len;
      ey = startPt.y + Math.sin(snapped) * len;
    }
    if (Math.hypot(ex - startPt.x, ey - startPt.y) < 2) return null;
    return { type: 'line', x1: startPt.x, y1: startPt.y, x2: ex, y2: ey };
  }
  let w = dx;
  let h = dy;
  if (shiftHeld) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    w = (dx < 0 ? -1 : 1) * m;
    h = (dy < 0 ? -1 : 1) * m;
  }
  const radius = Math.hypot(w, h);
  if (Math.abs(w) < 2 || Math.abs(h) < 2) return null;
  switch (opts.shape) {
    case 'rect':
      return {
        type: 'rect',
        x: Math.min(startPt.x, startPt.x + w),
        y: Math.min(startPt.y, startPt.y + h),
        w: Math.abs(w),
        h: Math.abs(h),
        radius: opts.radius,
      };
    case 'ellipse':
      return {
        type: 'ellipse',
        x: Math.min(startPt.x, startPt.x + w),
        y: Math.min(startPt.y, startPt.y + h),
        w: Math.abs(w),
        h: Math.abs(h),
      };
    case 'polygon':
      return { type: 'polygon', cx: startPt.x, cy: startPt.y, radius: Math.max(2, radius), sides: Math.max(3, Math.round(opts.sides)), rotation: 0 };
    case 'star':
      return {
        type: 'star',
        cx: startPt.x,
        cy: startPt.y,
        outer: Math.max(2, radius),
        inner: Math.max(1, radius * opts.starInnerRatio),
        points: Math.max(3, Math.round(opts.starPoints)),
        rotation: 0,
      };
    default:
      return null; // 'path' belongs to the pen tool
  }
}

function reset(): void {
  start = null;
  cur = null;
}

function commitShape(): void {
  if (!start || !cur) {
    reset();
    return;
  }
  const geom = buildGeometry(start, cur, shift);
  reset();
  if (!geom) return;
  const store = useEditorStore.getState();
  const opts = store.toolOptions.shape;
  const fill: Paint | null = opts.fillEnabled ? { type: 'solid', color: opts.fillColor } : null;
  const stroke: StrokeStyle | null = opts.strokeEnabled
    ? { color: opts.strokeColor, width: Math.max(0.5, opts.strokeWidth), dash: null, cap: 'butt', join: 'miter' }
    : null;
  const layer = createShapeLayer(`Shape ${countLayers(store.doc.layers) + 1}`, geom, fill, stroke, shapeBBox(geom));
  store.addLayer(layer, 'history.addLayer');
}

export const shapeController: ToolController = {
  tool: 'shape',
  cursor: 'crosshair',
  onPointerDown(e: CanvasPointerEvent): void {
    start = { x: e.docX, y: e.docY };
    cur = { ...start };
    shift = e.shift;
  },
  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!start) return;
    cur = { x: e.docX, y: e.docY };
    shift = e.shift;
    ctx.invalidate();
  },
  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext): void {
    commitShape();
    ctx.invalidate();
  },
  onPointerCancel(_e: CanvasPointerEvent, ctx: ToolContext): void {
    reset();
    ctx.invalidate();
  },
  deactivate(): void {
    reset();
  },
  drawOverlay(ctx: OverlayCtx, view): void {
    if (!start || !cur) return;
    const geom = buildGeometry(start, cur, shift);
    if (!geom) return;
    ctx.save();
    applyDocTransform(ctx, view);
    const path = buildShapePath(geom);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fill(path);
    ctx.lineWidth = px(view, 1);
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([px(view, 5), px(view, 4)]);
    ctx.stroke(path);
    ctx.setLineDash([]);
    ctx.restore();
  },
};
