/**
 * Shared overlay drawing helpers for ToolControllers.
 *
 * drawOverlay receives a context in the stage's base transform; helpers here
 * apply a doc→screen transform (flip/rotation/pan/zoom) so callers work in
 * document coordinates, and scale constant screen lengths by 1/zoom so
 * handles and dashes keep their size at any zoom level.
 */

import { screenToDoc } from '../canvas/pointerContract';
import type { ViewState } from '../engine/types';

export type OverlayCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DIM_COLOR = 'rgba(0, 0, 0, 0.55)';
export const ANTS_DARK = 'rgba(0, 0, 0, 0.85)';
export const ANTS_LIGHT = '#ffffff';
export const ACCENT = '#4da3ff';

/** Applies the doc→screen transform (multiplied onto the current transform). */
export function applyDocTransform(ctx: OverlayCtx, view: ViewState): void {
  ctx.scale(view.flipX ? -1 : 1, view.flipY ? -1 : 1);
  if (view.rotation !== 0) ctx.rotate(view.rotation);
  ctx.translate(view.panX, view.panY);
  ctx.scale(view.zoom, view.zoom);
}

/** Screen-constant length expressed in doc units. */
export function px(view: ViewState, screenPx: number): number {
  return screenPx / Math.max(0.0001, view.zoom);
}

/** True when a doc point projects within `tol` screen px of a screen point. */
export function nearScreen(
  view: ViewState,
  docX: number,
  docY: number,
  screenX: number,
  screenY: number,
  tol = 10,
): boolean {
  const sx = docX * view.zoom + view.panX;
  const sy = docY * view.zoom + view.panY;
  // view rotation/flip ignored for handle hit-tests (v1 default view)
  return Math.hypot(sx - screenX, sy - screenY) <= tol;
}

/** Document-space quad covering the visible viewport. */
export function viewportQuad(view: ViewState, viewport: { w: number; h: number }): number[][] {
  const corners = [
    screenToDoc(view, 0, 0),
    screenToDoc(view, viewport.w, 0),
    screenToDoc(view, viewport.w, viewport.h),
    screenToDoc(view, 0, viewport.h),
  ];
  return corners.map((p) => [p.x, p.y]);
}

/** Adds a polyline subpath to the current path (no beginPath). */
export function polySubpath(ctx: OverlayCtx, pts: number[][], closed: boolean): void {
  if (pts.length === 0) return;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (closed) ctx.closePath();
}

/** Sampled points along an ellipse (doc space). */
export function ellipsePoints(x: number, y: number, w: number, h: number, segments = 72): number[][] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = Math.max(0.5, Math.abs(w) / 2);
  const ry = Math.max(0.5, Math.abs(h) / 2);
  const pts: number[][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

/** Marching-ants style double stroke: dark underlay + light dash. */
export function strokeAnts(ctx: OverlayCtx, view: ViewState, pts: number[][], closed: boolean): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  polySubpath(ctx, pts, closed);
  ctx.lineWidth = px(view, 2);
  ctx.strokeStyle = ANTS_DARK;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.lineWidth = px(view, 1);
  ctx.strokeStyle = ANTS_LIGHT;
  ctx.setLineDash([px(view, 4), px(view, 4)]);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Single dashed polyline (rubber bands, guides). */
export function strokeDashed(
  ctx: OverlayCtx,
  view: ViewState,
  pts: number[][],
  closed: boolean,
  color = ACCENT,
  dashPx = 5,
): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  polySubpath(ctx, pts, closed);
  ctx.lineWidth = px(view, 1);
  ctx.strokeStyle = color;
  ctx.setLineDash([px(view, dashPx), px(view, dashPx)]);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Solid thin polyline (crop borders etc.). */
export function strokeSolid(
  ctx: OverlayCtx,
  view: ViewState,
  pts: number[][],
  closed: boolean,
  color = ANTS_LIGHT,
  widthPx = 1,
): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  polySubpath(ctx, pts, closed);
  ctx.lineWidth = px(view, widthPx);
  ctx.strokeStyle = color;
  ctx.setLineDash([]);
  ctx.stroke();
}

/**
 * Dims the whole viewport EXCEPT the given doc-space shape (evenodd hole).
 * `hole` adds subpath(s) to the current path in doc coordinates (no beginPath).
 */
export function dimOutside(
  ctx: OverlayCtx,
  view: ViewState,
  viewport: { w: number; h: number },
  hole: (c: OverlayCtx) => void,
): void {
  ctx.save();
  applyDocTransform(ctx, view);
  ctx.beginPath();
  polySubpath(ctx, viewportQuad(view, viewport), true);
  hole(ctx);
  ctx.fillStyle = DIM_COLOR;
  ctx.fill('evenodd');
  ctx.restore();
}

/** 8 transform-handle positions around a bbox: TL,T,TR,R,BR,B,BL,L. */
export function handleRects(bbox: BBox): number[][] {
  const { x, y, w, h } = bbox;
  return [
    [x, y],
    [x + w / 2, y],
    [x + w, y],
    [x + w, y + h / 2],
    [x + w, y + h],
    [x + w / 2, y + h],
    [x, y + h],
    [x, y + h / 2],
  ];
}

/** White square handle with dark border (doc position, screen-constant size). */
export function drawHandle(ctx: OverlayCtx, view: ViewState, x: number, y: number, sizePx = 8): void {
  const s = px(view, sizePx);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.lineWidth = px(view, 1);
  ctx.fillRect(x - s / 2, y - s / 2, s, s);
  ctx.strokeRect(x - s / 2, y - s / 2, s, s);
}

/** Rotation handle: stem from (x, y) upward + circle knob 14 screen px above. */
export function drawRotationHandle(ctx: OverlayCtx, view: ViewState, x: number, y: number, offsetPx = 14): void {
  const off = px(view, offsetPx);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - off);
  ctx.lineWidth = px(view, 1);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y - off, px(view, 4.5), 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.stroke();
}

/** Cross marker (clone-stamp source). */
export function drawCross(ctx: OverlayCtx, view: ViewState, x: number, y: number, sizePx = 12): void {
  const r = px(view, sizePx / 2);
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.lineWidth = px(view, 1.5);
  ctx.strokeStyle = ANTS_LIGHT;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.lineWidth = px(view, 0.5);
  ctx.strokeStyle = ANTS_DARK;
  ctx.stroke();
}
