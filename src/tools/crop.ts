/**
 * Crop tool — drag a rect, adjust it (8 handles + move inside), then
 * Enter / double-click commits via store.cropTo; Esc cancels. The overlay
 * dims everything outside the crop with rule-of-thirds guides. A pending
 * crop rect persists across gestures until committed or cancelled; tiny
 * (<8px) rects are discarded. Only runs while the crop tool is active
 * (controllers are per-tool, so this is inherent).
 */

import { useEditorStore } from '../state/editorStore';
import type { CanvasPointerEvent, ToolContext, ToolController } from '../canvas/pointerContract';
import {
  applyDocTransform,
  drawHandle,
  handleRects,
  nearScreen,
  polySubpath,
  dimOutside,
  px,
  strokeSolid,
  type BBox,
  type OverlayCtx,
} from './shared';

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type CropMode = 'none' | 'draw' | 'move' | 'resize';

let rect: CropRect | null = null;
let mode: CropMode = 'none';
let drawStart = { x: 0, y: 0 };
let moveStart = { x: 0, y: 0 };
let rectAtStart: CropRect | null = null;
let resizeHandle = -1;
let lastDownAt = 0;
let lastDownScreen = { x: 0, y: 0 };

const MIN_SIZE = 8;

/* ---- UI bridge: lets the OptionsBar render live Apply/Cancel state ------ */
type CropListener = () => void;
const cropListeners = new Set<CropListener>();
/** Subscribe to crop-rect lifecycle changes; returns an unsubscribe fn. */
export function onCropRectChange(fn: CropListener): () => void {
  cropListeners.add(fn);
  return () => {
    cropListeners.delete(fn);
  };
}
/** True while a crop rect exists on the canvas (Apply/Cancel meaningful). */
export function isCropRectActive(): boolean {
  return rect !== null;
}
function notifyCrop(): void {
  for (const fn of cropListeners) fn();
}

function normalized(x0: number, y0: number, x1: number, y1: number): CropRect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/**
 * Aspect-locked rect anchored at (ax, ay) reaching toward (px, py): the
 * dominant drag axis decides coverage so the rect always matches `aspect`.
 */
function aspectRectFromAnchor(ax: number, ay: number, px: number, py: number, aspect: number): CropRect {
  const dx = px - ax;
  const dy = py - ay;
  const wByDx = Math.abs(dx);
  const hByDy = Math.abs(dy);
  const w = Math.max(wByDx, hByDy * aspect);
  const h = w / aspect;
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  return normalized(ax, ay, ax + sx * w, ay + sy * h);
}

/** Aspect-locked resize anchored at the handle's opposite corner/edge. */
function resizeAspect(start: CropRect, handle: number, docX: number, docY: number, aspect: number): CropRect {
  switch (handle) {
    case 0:
      return aspectRectFromAnchor(start.x + start.w, start.y + start.h, docX, docY, aspect);
    case 2:
      return aspectRectFromAnchor(start.x, start.y + start.h, docX, docY, aspect);
    case 4:
      return aspectRectFromAnchor(start.x, start.y, docX, docY, aspect);
    case 6:
      return aspectRectFromAnchor(start.x + start.w, start.y, docX, docY, aspect);
    case 1: {
      // top edge: bottom edge + width fixed, height derived
      const w = start.w;
      const y1 = start.y + start.h;
      return { x: start.x, y: y1 - w / aspect, w, h: w / aspect };
    }
    case 5: {
      // bottom edge: top edge + width fixed
      const w = start.w;
      return { x: start.x, y: start.y, w, h: w / aspect };
    }
    case 3: {
      // left edge: right edge + height fixed, width derived
      const h = start.h;
      const x1 = start.x + start.w;
      return { x: x1 - h * aspect, y: start.y, w: h * aspect, h };
    }
    case 7: {
      // right edge: left edge + height fixed
      const h = start.h;
      return { x: start.x, y: start.y, w: h * aspect, h };
    }
    default:
      return { ...start };
  }
}

function applyResize(start: CropRect, handle: number, docX: number, docY: number): CropRect {
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.w;
  let y1 = start.y + start.h;
  switch (handle) {
    case 0: x0 = docX; y0 = docY; break;
    case 1: y0 = docY; break;
    case 2: x1 = docX; y0 = docY; break;
    case 3: x1 = docX; break;
    case 4: x1 = docX; y1 = docY; break;
    case 5: y1 = docY; break;
    case 6: x0 = docX; y1 = docY; break;
    case 7: x0 = docX; break;
  }
  return normalized(x0, y0, x1, y1);
}

export function commitCrop(): void {
  if (!rect) return;
  if (rect.w >= MIN_SIZE && rect.h >= MIN_SIZE) {
    useEditorStore.getState().cropTo({ x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) });
  }
  rect = null;
  notifyCrop();
}

export function cancelCrop(): void {
  const had = rect !== null;
  rect = null;
  mode = 'none';
  resizeHandle = -1;
  if (had) notifyCrop();
}

export const cropController: ToolController = {
  tool: 'crop',
  cursor: 'crosshair',
  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    const now = performance.now();
    const dblClick =
      now - lastDownAt < 350 && Math.hypot(e.screenX - lastDownScreen.x, e.screenY - lastDownScreen.y) < 5;
    lastDownAt = now;
    lastDownScreen = { x: e.screenX, y: e.screenY };
    if (dblClick && rect) {
      commitCrop();
      ctx.invalidate();
      return;
    }
    if (rect) {
      // handles first (screen-space tolerance), then move inside, else new drag
      const bbox: BBox = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
      const rects = handleRects(bbox);
      for (let i = 0; i < rects.length; i++) {
        if (nearScreen(ctx.view, rects[i][0], rects[i][1], e.screenX, e.screenY, 10)) {
          mode = 'resize';
          resizeHandle = i;
          rectAtStart = { ...rect };
          return;
        }
      }
      if (e.docX >= rect.x && e.docX <= rect.x + rect.w && e.docY >= rect.y && e.docY <= rect.y + rect.h) {
        mode = 'move';
        moveStart = { x: e.docX, y: e.docY };
        rectAtStart = { ...rect };
        return;
      }
    }
    mode = 'draw';
    drawStart = { x: e.docX, y: e.docY };
    rect = { x: e.docX, y: e.docY, w: 0, h: 0 };
    notifyCrop();
    ctx.invalidate();
  },
  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (mode === 'none') {
      if (rect) {
        // adjust cursor hint over handles / interior
        const bbox: BBox = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
        const rects = handleRects(bbox);
        let over = false;
        for (const p of rects) if (nearScreen(ctx.view, p[0], p[1], e.screenX, e.screenY, 10)) over = true;
        const inside = e.docX >= rect.x && e.docX <= rect.x + rect.w && e.docY >= rect.y && e.docY <= rect.y + rect.h;
        ctx.setCursor(over ? 'nwse-resize' : inside ? 'move' : 'crosshair');
      }
      return;
    }
    if (!rect) return;
    if (mode === 'draw') {
      const aspect = useEditorStore.getState().toolOptions.crop.aspect;
      rect = aspect && aspect > 0
        ? aspectRectFromAnchor(drawStart.x, drawStart.y, e.docX, e.docY, aspect)
        : normalized(drawStart.x, drawStart.y, e.docX, e.docY);
    } else if (mode === 'move' && rectAtStart) {
      rect = { ...rectAtStart, x: rectAtStart.x + (e.docX - moveStart.x), y: rectAtStart.y + (e.docY - moveStart.y) };
    } else if (mode === 'resize' && rectAtStart) {
      const aspect = useEditorStore.getState().toolOptions.crop.aspect;
      rect = aspect && aspect > 0
        ? resizeAspect(rectAtStart, resizeHandle, e.docX, e.docY, aspect)
        : applyResize(rectAtStart, resizeHandle, e.docX, e.docY);
    }
    notifyCrop();
    ctx.invalidate();
  },
  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext): void {
    mode = 'none';
    resizeHandle = -1;
    if (rect && (rect.w < MIN_SIZE || rect.h < MIN_SIZE)) rect = null;
    notifyCrop();
    ctx.invalidate();
  },
  onPointerCancel(_e: CanvasPointerEvent, ctx: ToolContext): void {
    mode = 'none';
    resizeHandle = -1;
    ctx.invalidate();
  },
  deactivate(): void {
    cancelCrop();
  },
  onKeyDown(key: string, ctx: ToolContext): boolean {
    if (key === 'Enter') {
      commitCrop();
      ctx.invalidate();
      return true;
    }
    if (key === 'Escape') {
      cancelCrop();
      ctx.invalidate();
      return true;
    }
    return false;
  },
  drawOverlay(ctx: OverlayCtx, view, viewport): void {
    if (!rect) return;
    const pts = [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x + rect.w, rect.y + rect.h],
      [rect.x, rect.y + rect.h],
    ];
    dimOutside(ctx, view, viewport, (c) => polySubpath(c, pts, true));
    ctx.save();
    applyDocTransform(ctx, view);
    // rule-of-thirds guides
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = px(view, 1);
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = 1; i <= 2; i++) {
      const gx = rect.x + (rect.w * i) / 3;
      const gy = rect.y + (rect.h * i) / 3;
      ctx.moveTo(gx, rect.y);
      ctx.lineTo(gx, rect.y + rect.h);
      ctx.moveTo(rect.x, gy);
      ctx.lineTo(rect.x + rect.w, gy);
    }
    ctx.stroke();
    strokeSolid(ctx, view, pts, true, '#ffffff', 1.5);
    for (const p of handleRects({ x: rect.x, y: rect.y, w: rect.w, h: rect.h })) {
      drawHandle(ctx, view, p[0], p[1]);
    }
    ctx.restore();
  },
};
