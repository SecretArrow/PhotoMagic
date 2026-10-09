/**
 * Pen tool — click to add anchors, click-drag to give the anchor symmetric
 * bezier handles (cubic segments), click the first anchor / Enter / or
 * double-click to close the path into a shape layer (kind 'path').
 * Esc cancels, Backspace removes the last anchor.
 *
 * Direct anchor editing of EXISTING paths is out of scope for v1 (v2: anchor
 * editing tool reusing this overlay renderer).
 */

import { useEditorStore } from '../state/editorStore';
import type { CanvasPointerEvent, ToolContext, ToolController } from '../canvas/pointerContract';
import { countLayers, createShapeLayer, shapeBBox } from '../engine/document';
import type { Paint, PathCommand, ShapeGeometry, StrokeStyle } from '../engine/types';
import { applyDocTransform, drawHandle, px, strokeAnts, strokeDashed, type OverlayCtx } from './shared';

interface PenAnchor {
  x: number;
  y: number;
  /** handle drag vector (symmetric) — present once the anchor was drag-created */
  hx?: number;
  hy?: number;
}

let anchors: PenAnchor[] = [];
let draggingIndex = -1;
let hover: { x: number; y: number } | null = null;
let lastDownAt = 0;
let lastDownPos = { x: 0, y: 0 };

function segmentCommands(a: PenAnchor, b: PenAnchor): PathCommand[] {
  const aHasHandle = a.hx !== undefined || a.hy !== undefined;
  const bHasHandle = b.hx !== undefined || b.hy !== undefined;
  if (!aHasHandle && !bHasHandle) return [{ c: 'L', x: b.x, y: b.y }];
  return [
    {
      c: 'C',
      c1x: a.x + (a.hx ?? 0),
      c1y: a.y + (a.hy ?? 0),
      c2x: b.x - (b.hx ?? 0),
      c2y: b.y - (b.hy ?? 0),
      x: b.x,
      y: b.y,
    },
  ];
}

function buildCommands(list: PenAnchor[]): PathCommand[] {
  const cmds: PathCommand[] = [{ c: 'M', x: list[0].x, y: list[0].y }];
  for (let i = 1; i < list.length; i++) cmds.push(...segmentCommands(list[i - 1], list[i]));
  cmds.push(...segmentCommands(list[list.length - 1], list[0])); // closing segment
  return cmds;
}

function commitPath(): void {
  if (anchors.length < 3) return;
  const store = useEditorStore.getState();
  const opts = store.toolOptions.shape;
  const geometry: ShapeGeometry = {
    type: 'path',
    subpaths: [{ commands: buildCommands(anchors), closed: true }],
  };
  const fill: Paint | null = opts.fillEnabled ? { type: 'solid', color: opts.fillColor } : null;
  const stroke: StrokeStyle | null = opts.strokeEnabled
    ? { color: opts.strokeColor, width: Math.max(0.5, opts.strokeWidth), dash: null, cap: 'butt', join: 'miter' }
    : null;
  const layer = createShapeLayer(`Path ${countLayers(store.doc.layers) + 1}`, geometry, fill, stroke, shapeBBox(geometry));
  store.addLayer(layer, 'history.addLayer');
  anchors = [];
  draggingIndex = -1;
}

function reset(): void {
  anchors = [];
  draggingIndex = -1;
}

export const penController: ToolController = {
  tool: 'pen',
  cursor: 'crosshair',
  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    const now = performance.now();
    const closeRange = 8 / Math.max(0.0001, ctx.view.zoom);
    const dblClick = now - lastDownAt < 350 && Math.hypot(e.docX - lastDownPos.x, e.docY - lastDownPos.y) < 4 / Math.max(0.0001, ctx.view.zoom);
    lastDownAt = now;
    lastDownPos = { x: e.docX, y: e.docY };
    // close on the first anchor (within 8 screen px) or a double-click
    if (anchors.length >= 3) {
      const first = anchors[0];
      if (Math.hypot(e.docX - first.x, e.docY - first.y) <= closeRange || dblClick) {
        commitPath();
        ctx.invalidate();
        return;
      }
    }
    // new anchor; drag gives it symmetric handles
    anchors.push({ x: e.docX, y: e.docY });
    draggingIndex = anchors.length - 1;
    ctx.invalidate();
  },
  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    hover = { x: e.docX, y: e.docY };
    if (draggingIndex >= 0 && draggingIndex < anchors.length) {
      const a = anchors[draggingIndex];
      a.hx = e.docX - a.x;
      a.hy = e.docY - a.y;
    }
    ctx.invalidate();
  },
  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext): void {
    draggingIndex = -1;
    ctx.invalidate();
  },
  onPointerCancel(_e: CanvasPointerEvent, ctx: ToolContext): void {
    draggingIndex = -1;
    ctx.invalidate();
  },
  deactivate(): void {
    reset();
  },
  onKeyDown(key: string, ctx: ToolContext): boolean {
    if (key === 'Enter') {
      commitPath();
      ctx.invalidate();
      return true;
    }
    if (key === 'Escape') {
      reset();
      ctx.invalidate();
      return true;
    }
    if (key === 'Backspace') {
      anchors.pop();
      draggingIndex = -1;
      ctx.invalidate();
      return true;
    }
    return false;
  },
  drawOverlay(ctx: OverlayCtx, view): void {
    if (anchors.length === 0 && !hover) return;
    ctx.save();
    applyDocTransform(ctx, view);
    const pts = anchors.map((a) => [a.x, a.y]);
    if (pts.length >= 2) strokeAnts(ctx, view, pts, false);
    // rubber bands
    if (hover && pts.length >= 1) {
      const last = anchors[anchors.length - 1];
      const fromX = last.x + (last.hx ?? 0);
      const fromY = last.y + (last.hy ?? 0);
      strokeDashed(ctx, view, [[fromX, fromY], [hover.x, hover.y]], false);
      if (pts.length >= 3) strokeDashed(ctx, view, [[hover.x, hover.y], pts[0]], false, 'rgba(255,255,255,0.5)');
    }
    // handles (symmetric) for drag-created anchors
    for (const a of anchors) {
      if (a.hx === undefined && a.hy === undefined) continue;
      ctx.beginPath();
      ctx.moveTo(a.x - a.hx!, a.y - a.hy!);
      ctx.lineTo(a.x + a.hx!, a.y + a.hy!);
      ctx.lineWidth = px(view, 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.setLineDash([]);
      ctx.stroke();
    }
    // anchors; first anchor highlighted when closable
    for (let i = 0; i < anchors.length; i++) {
      if (i === 0 && anchors.length >= 3) {
        ctx.beginPath();
        ctx.arc(anchors[0].x, anchors[0].y, px(view, 5), 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = px(view, 1.5);
        ctx.stroke();
      }
      drawHandle(ctx, view, anchors[i].x, anchors[i].y, 6);
    }
    ctx.restore();
  },
};
