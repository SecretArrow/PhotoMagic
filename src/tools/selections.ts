/**
 * Selection tools — marquee-rect, marquee-ellipse, lasso, polygonal-lasso,
 * magic-wand.
 *
 * NOTE on history: selection commits do NOT create history entries in v1
 * (the store's selection actions are history-free; acceptable for v1).
 *
 * - marquee: drag with live preview (dashed outline + dim outside); shift
 *   constrains square/circle, alt drags from center; committed through
 *   store.rectSelectionAction / ellipseSelectionAction with the toolOptions
 *   mode; feather > 0 runs store.featherSelectionAction afterwards.
 * - lasso: freehand points → polygonSelection on release.
 * - polygonal-lasso: click adds vertices, rubber band follows the cursor,
 *   Enter / double-click / first-anchor click closes, Esc cancels.
 * - magic-wand: floodSelect over the merged composite (sampleMerged) or the
 *   active raster layer in layer-local coords (mask re-expanded to doc space).
 */

import { useEditorStore } from '../state/editorStore';
import type { CanvasPointerEvent, ToolContext, ToolController } from '../canvas/pointerContract';
import type { RasterLayer, Selection, ToolId } from '../engine/types';
import type { SelectionMode } from '../engine/selections';
import { computeBounds, floodSelect, polygonSelection } from '../engine/selections';
import { composeDocument } from '../engine/render';
import { imageDataFromCanvas } from '../engine/raster';
import {
  applyDocTransform,
  dimOutside,
  drawHandle,
  ellipsePoints,
  polySubpath,
  strokeAnts,
  strokeDashed,
  type OverlayCtx,
} from './shared';

interface Pt {
  x: number;
  y: number;
}

function commitFeather(): void {
  const store = useEditorStore.getState();
  const feather = store.toolOptions.marquee.feather;
  if (feather > 0) store.featherSelectionAction(feather);
}

/** Re-expands a layer-local selection into doc space at the layer offset. */
function layerSelectionToDoc(sel: Selection, layer: RasterLayer, docW: number, docH: number): Selection | null {
  const mask = new Uint8ClampedArray(docW * docH);
  const ox = Math.round(layer.x);
  const oy = Math.round(layer.y);
  let any = false;
  for (let y = 0; y < sel.height; y++) {
    const dy = y + oy;
    if (dy < 0 || dy >= docH) continue;
    for (let x = 0; x < sel.width; x++) {
      const dx = x + ox;
      if (dx < 0 || dx >= docW) continue;
      const v = sel.mask[y * sel.width + x];
      if (v > 0) {
        mask[dy * docW + dx] = v;
        any = true;
      }
    }
  }
  if (!any) return null;
  const bounds = computeBounds(mask, docW, docH);
  if (!bounds) return null;
  const outline = sel.outline.map((line) => {
    const out: number[] = [];
    for (let i = 0; i < line.length; i += 2) out.push(line[i] + layer.x, line[i + 1] + layer.y);
    return out;
  });
  return { width: docW, height: docH, mask, bounds, outline, source: sel.source };
}

/* ------------------------------ marquee ------------------------------ */

function resolveRect(start: Pt, cur: Pt, shift: boolean, fromCenter: boolean): { x: number; y: number; w: number; h: number } {
  let dx = cur.x - start.x;
  let dy = cur.y - start.y;
  if (shift) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * m;
    dy = Math.sign(dy || 1) * m;
  }
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + dx;
  let y1 = start.y + dy;
  if (fromCenter) {
    x0 = start.x - dx;
    y0 = start.y - dy;
    x1 = start.x + dx;
    y1 = start.y + dy;
  }
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

function createMarqueeController(tool: 'marquee-rect' | 'marquee-ellipse'): ToolController {
  let start: Pt | null = null;
  let cur: Pt | null = null;
  let shift = false;
  let alt = false;

  const reset = (): void => {
    start = null;
    cur = null;
  };

  const previewPts = (): number[][] | null => {
    if (!start || !cur) return null;
    const r = resolveRect(start, cur, shift, alt);
    if (tool === 'marquee-rect') {
      return [
        [r.x, r.y],
        [r.x + r.w, r.y],
        [r.x + r.w, r.y + r.h],
        [r.x, r.y + r.h],
      ];
    }
    return ellipsePoints(r.x, r.y, r.w, r.h);
  };

  return {
    tool,
    cursor: 'crosshair',
    onPointerDown(e: CanvasPointerEvent): void {
      start = { x: e.docX, y: e.docY };
      cur = { ...start };
      shift = e.shift;
      alt = e.alt;
    },
    onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
      if (!start) return;
      cur = { x: e.docX, y: e.docY };
      shift = e.shift;
      alt = e.alt;
      ctx.invalidate();
    },
    onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void {
      if (!start) {
        reset();
        return;
      }
      cur = { x: e.docX, y: e.docY };
      const store = useEditorStore.getState();
      const opts = store.toolOptions.marquee;
      const r = resolveRect(start, cur, shift, alt);
      reset();
      if (r.w < 2 || r.h < 2) {
        // click without drag = deselect (replace mode only)
        if (opts.mode === 'replace') store.deselect();
        ctx.invalidate();
        return;
      }
      if (tool === 'marquee-rect') store.rectSelectionAction(r.x, r.y, r.w, r.h, opts.mode);
      else store.ellipseSelectionAction(r.x, r.y, r.w, r.h, opts.mode);
      commitFeather();
      ctx.invalidate();
    },
    onPointerCancel(): void {
      reset();
    },
    deactivate(): void {
      reset();
    },
    drawOverlay(ctx: OverlayCtx, view, viewport): void {
      const pts = previewPts();
      if (!pts) return;
      dimOutside(ctx, view, viewport, (c) => polySubpath(c, pts, true));
      ctx.save();
      applyDocTransform(ctx, view);
      strokeAnts(ctx, view, pts, true);
      ctx.restore();
    },
  };
}

export const marqueeRectController: ToolController = createMarqueeController('marquee-rect');
export const marqueeEllipseController: ToolController = createMarqueeController('marquee-ellipse');

/* ------------------------------- lasso ------------------------------- */

let lassoPts: Pt[] = [];
let lassoDragging = false;

function commitLasso(): void {
  const store = useEditorStore.getState();
  if (lassoPts.length >= 3) {
    const sel = polygonSelection(
      lassoPts.map((p) => [p.x, p.y]),
      store.doc.width,
      store.doc.height,
    );
    store.setSelection(sel, store.toolOptions.marquee.mode as SelectionMode);
    commitFeather();
  } else if (store.toolOptions.marquee.mode === 'replace') {
    store.deselect();
  }
  lassoPts = [];
}

export const lassoController: ToolController = {
  tool: 'lasso',
  cursor: 'crosshair',
  onPointerDown(e: CanvasPointerEvent): void {
    lassoPts = [{ x: e.docX, y: e.docY }];
    lassoDragging = true;
  },
  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!lassoDragging) return;
    const last = lassoPts[lassoPts.length - 1];
    if (!last || Math.hypot(e.docX - last.x, e.docY - last.y) > 1) {
      lassoPts.push({ x: e.docX, y: e.docY });
      ctx.invalidate();
    }
  },
  onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!lassoDragging) return;
    lassoDragging = false;
    const last = lassoPts[lassoPts.length - 1];
    if (!last || Math.hypot(e.docX - last.x, e.docY - last.y) > 1) lassoPts.push({ x: e.docX, y: e.docY });
    commitLasso();
    ctx.invalidate();
  },
  onPointerCancel(_e: CanvasPointerEvent, ctx: ToolContext): void {
    lassoPts = [];
    lassoDragging = false;
    ctx.invalidate();
  },
  deactivate(): void {
    lassoPts = [];
    lassoDragging = false;
  },
  onKeyDown(key: string): boolean {
    if (key === 'Escape') {
      lassoPts = [];
      lassoDragging = false;
      return true;
    }
    return false;
  },
  drawOverlay(ctx: OverlayCtx, view): void {
    if (lassoPts.length === 0) return;
    const pts = lassoPts.map((p) => [p.x, p.y]);
    ctx.save();
    applyDocTransform(ctx, view);
    strokeAnts(ctx, view, pts, false);
    drawHandle(ctx, view, pts[0][0], pts[0][1], 6);
    ctx.restore();
  },
};

/* -------------------------- polygonal lasso -------------------------- */

let polyPts: Pt[] = [];
let polyHover: Pt | null = null;
let lastDownAt = 0;
let lastDownPos: Pt = { x: 0, y: 0 };

function commitPolygonal(): void {
  const store = useEditorStore.getState();
  if (polyPts.length >= 3) {
    const sel = polygonSelection(
      polyPts.map((p) => [p.x, p.y]),
      store.doc.width,
      store.doc.height,
    );
    store.setSelection(sel, store.toolOptions.marquee.mode as SelectionMode);
    commitFeather();
  }
  polyPts = [];
  polyHover = null;
}

export const polygonalLassoController: ToolController = {
  tool: 'polygonal-lasso',
  cursor: 'crosshair',
  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    const now = performance.now();
    const closeRange = 8 / Math.max(0.0001, ctx.view.zoom);
    const hitFirst = polyPts.length >= 3 && Math.hypot(e.docX - polyPts[0].x, e.docY - polyPts[0].y) <= closeRange;
    const dblClick =
      now - lastDownAt < 350 &&
      polyPts.length >= 3 &&
      Math.hypot(e.docX - lastDownPos.x, e.docY - lastDownPos.y) < 4 / Math.max(0.0001, ctx.view.zoom);
    lastDownAt = now;
    lastDownPos = { x: e.docX, y: e.docY };
    if (hitFirst || dblClick) {
      commitPolygonal();
      ctx.invalidate();
      return;
    }
    polyPts.push({ x: e.docX, y: e.docY });
    ctx.invalidate();
  },
  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    polyHover = { x: e.docX, y: e.docY };
    ctx.invalidate();
  },
  onPointerUp(): void {
    /* vertices commit via Enter / double-click / first-anchor click */
  },
  onPointerCancel(_e: CanvasPointerEvent, ctx: ToolContext): void {
    polyPts = [];
    polyHover = null;
    ctx.invalidate();
  },
  deactivate(): void {
    polyPts = [];
    polyHover = null;
  },
  onKeyDown(key: string, ctx: ToolContext): boolean {
    if (key === 'Enter') {
      commitPolygonal();
      ctx.invalidate();
      return true;
    }
    if (key === 'Escape') {
      polyPts = [];
      polyHover = null;
      ctx.invalidate();
      return true;
    }
    return false;
  },
  drawOverlay(ctx: OverlayCtx, view): void {
    if (polyPts.length === 0 && !polyHover) return;
    ctx.save();
    applyDocTransform(ctx, view);
    const pts = polyPts.map((p) => [p.x, p.y]);
    if (pts.length >= 2) strokeAnts(ctx, view, pts, false);
    if (polyHover && pts.length >= 1) {
      // rubber band to cursor (+ dashed closing hint when closable)
      strokeDashed(ctx, view, [pts[pts.length - 1], [polyHover.x, polyHover.y]], false);
      if (pts.length >= 3) {
        strokeDashed(ctx, view, [[polyHover.x, polyHover.y], pts[0]], false, 'rgba(255,255,255,0.5)');
      }
    }
    for (let i = 0; i < pts.length; i++) {
      drawHandle(ctx, view, pts[i][0], pts[i][1], i === 0 ? 8 : 6);
    }
    ctx.restore();
  },
};

/* ----------------------------- magic wand ---------------------------- */

export const magicWandController: ToolController = {
  tool: 'magic-wand',
  cursor: 'crosshair',
  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    const store = useEditorStore.getState();
    const opts = store.toolOptions.wand;
    const doc = store.doc;
    let sel: Selection | null = null;
    if (opts.sampleMerged) {
      const composite = composeDocument(doc);
      const data = imageDataFromCanvas(composite);
      sel = floodSelect(data.data, data.width, data.height, Math.floor(e.docX), Math.floor(e.docY), opts.tolerance, opts.contiguous);
    } else {
      const layer = store.getActiveRasterLayer();
      if (!layer) return;
      const data = imageDataFromCanvas(layer.canvas);
      const local = floodSelect(
        data.data,
        data.width,
        data.height,
        Math.floor(e.docX - layer.x),
        Math.floor(e.docY - layer.y),
        opts.tolerance,
        opts.contiguous,
      );
      if (local) sel = layerSelectionToDoc(local, layer, doc.width, doc.height);
    }
    if (sel) {
      store.setSelection(sel, opts.mode);
      if (opts.feather > 0) store.featherSelectionAction(opts.feather);
    } else if (opts.mode === 'replace') {
      store.deselect();
    }
    ctx.invalidate();
  },
  deactivate(): void {
    /* wand is stateless */
  },
};
