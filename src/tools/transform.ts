/**
 * Move & free-transform tool for the active layer.
 *
 * - Drag inside the layer moves it. Raster layers are translated live by
 *   mutating layer.x/y (revision bump, NO history), then ONE
 *   'history.transform' entry is committed at pointerup (pre-gesture state is
 *   restored first so updateLayer records a real before/after). Text/shape/
 *   group layers are rebuilt per frame via shiftLayerContent + replaceLayer.
 * - autoSelect option: hit-test topmost visible unlocked layer (raster alpha
 *   probe, text/shape bbox) and select it on pointerdown.
 * - 8 handles around the selected layer's bbox: corner/edge drag scales
 *   (from the opposite anchor; shift = uniform). Rotation handle (knob above
 *   the top edge, raster only) rotates around the center with 15° snapping
 *   when shift is held. Scale/rotate preview in drawOverlay, committed once
 *   at pointerup:
 *     raster → transformCanvas + one structure entry (commitLayerSwap)
 *     text   → fontSize/x/y/boxWidth scaled via updateLayer
 *     shape  → geometry scaled about the anchor via updateLayer
 *
 * v2: rotate for text/shape layers, per-corner non-uniform text scaling.
 */

import { useEditorStore } from '../state/editorStore';
import { docToScreen, type CanvasPointerEvent, type ToolContext, type ToolController } from '../canvas/pointerContract';
import { ctx2d, makeCanvas, type AnyCanvas, type AnyContext2D } from '../engine/raster';
import {
  findLayer,
  getLayer,
  multiply,
  replaceLayer,
  rotation,
  scaling,
  shapeBBox,
  translation,
} from '../engine/document';
import { shiftLayerContent, transformCanvas } from '../engine/transforms';
import { textBBox } from '../engine/paint';
import type {
  GroupLayer,
  Layer,
  PathCommand,
  RasterLayer,
  ShapeGeometry,
  ShapeLayer,
  TextLayer,
  ToolId,
  ViewState,
} from '../engine/types';
import {
  applyDocTransform,
  drawHandle,
  drawRotationHandle,
  handleRects,
  strokeAnts,
  strokeSolid,
  type BBox,
  type OverlayCtx,
} from './shared';

type Pt = { x: number; y: number };

type TransformKind = 'move' | 'scale' | 'rotate';

interface TransformGesture {
  kind: TransformKind;
  layerId: string;
  startDoc: Pt;
  curDoc: Pt;
  beforeLayers: Layer[];
  original: Layer;
  /** layer position at gesture start (raster/text move) */
  originX: number;
  originY: number;
  /** scale gesture */
  handle: number;
  anchor: Pt;
  bbox0: BBox;
  /** rotate gesture */
  center: Pt;
  startAngle: number;
  shift: boolean;
}

let g: TransformGesture | null = null;
let measureCtx: AnyContext2D | null = null;

function measuringCtx(): AnyContext2D {
  if (!measureCtx) {
    const c = makeCanvas(8, 8);
    measureCtx = ctx2d(c);
  }
  return measureCtx;
}

function layerBBox(layer: Layer | null): BBox | null {
  if (!layer) return null;
  switch (layer.kind) {
    case 'raster':
      return { x: layer.x, y: layer.y, w: layer.canvas.width, h: layer.canvas.height };
    case 'text':
      return textBBox(layer.text, measuringCtx());
    case 'shape':
      return layer.bbox;
    default:
      return null;
  }
}

function layerOrigin(layer: Layer): Pt {
  if (layer.kind === 'raster') return { x: layer.x, y: layer.y };
  if (layer.kind === 'text') return { x: layer.text.x, y: layer.text.y };
  return { x: 0, y: 0 };
}

/** Topmost visible unlocked layer whose content contains the point. */
function hitTestLayer(docX: number, docY: number): Layer | null {
  const doc = useEditorStore.getState().doc;
  const walk = (layers: Layer[]): Layer | null => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible || l.locked) continue;
      if (l.kind === 'group') {
        const hit = walk(l.children);
        if (hit) return hit;
        continue;
      }
      if (l.kind === 'raster') {
        const pxX = Math.floor(docX - l.x);
        const pxY = Math.floor(docY - l.y);
        if (pxX < 0 || pxY < 0 || pxX >= l.canvas.width || pxY >= l.canvas.height) continue;
        if (ctx2d(l.canvas).getImageData(pxX, pxY, 1, 1).data[3] > 0) return l;
        continue;
      }
      if (l.kind === 'text') {
        const b = textBBox(l.text, measuringCtx());
        if (docX >= b.x && docX <= b.x + b.w && docY >= b.y && docY <= b.y + b.h) return l;
        continue;
      }
      if (l.kind === 'shape') {
        const b = l.bbox;
        if (docX >= b.x && docX <= b.x + b.w && docY >= b.y && docY <= b.y + b.h) return l;
        continue;
      }
      // fill / adjustment layers are not hit-testable
    }
    return null;
  };
  return walk(doc.layers);
}

/** 0..7 handle index, 8 = rotate knob, -1 = none. */
function hitHandle(
  view: ViewState,
  bbox: BBox,
  screenX: number,
  screenY: number,
  allowRotate: boolean,
): number {
  const rects = handleRects(bbox);
  let best = -1;
  let bestD = 12;
  for (let i = 0; i < rects.length; i++) {
    const p = docToScreen(view, rects[i][0], rects[i][1]);
    const d = Math.hypot(p.x - screenX, p.y - screenY);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best >= 0) return best;
  if (allowRotate) {
    const t = docToScreen(view, bbox.x + bbox.w / 2, bbox.y);
    const d = Math.hypot(t.x - screenX, t.y - 14 - screenY);
    if (d < 12) return 8;
  }
  return -1;
}

function scaleFactors(gg: TransformGesture): { sx: number; sy: number } {
  const denomX = gg.startDoc.x - gg.anchor.x;
  const denomY = gg.startDoc.y - gg.anchor.y;
  let sx = Math.abs(denomX) > 2 ? (gg.curDoc.x - gg.anchor.x) / denomX : 1;
  let sy = Math.abs(denomY) > 2 ? (gg.curDoc.y - gg.anchor.y) / denomY : 1;
  if (gg.handle === 1 || gg.handle === 5) sx = 1; // top/bottom edges: vertical only
  if (gg.handle === 3 || gg.handle === 7) sy = 1; // left/right edges: horizontal only
  if (gg.shift) {
    const s = (Math.abs(sx) + Math.abs(sy)) / 2 || 1;
    sx = (sx < 0 ? -1 : 1) * s;
    sy = (sy < 0 ? -1 : 1) * s;
  }
  return { sx, sy };
}

function bboxCorners(bbox: BBox): number[][] {
  return [
    [bbox.x, bbox.y],
    [bbox.x + bbox.w, bbox.y],
    [bbox.x + bbox.w, bbox.y + bbox.h],
    [bbox.x, bbox.y + bbox.h],
  ];
}

function scaledCorners(gg: TransformGesture): number[][] {
  const { sx, sy } = scaleFactors(gg);
  return bboxCorners(gg.bbox0).map(([x, y]) => [gg.anchor.x + (x - gg.anchor.x) * sx, gg.anchor.y + (y - gg.anchor.y) * sy]);
}

function rotateAngle(gg: TransformGesture): number {
  const raw = Math.atan2(gg.curDoc.y - gg.center.y, gg.curDoc.x - gg.center.x) - gg.startAngle;
  // 15° snapping with shift
  return gg.shift ? Math.round(raw / (Math.PI / 12)) * (Math.PI / 12) : raw;
}

function rotatedCorners(gg: TransformGesture): number[][] {
  const a = rotateAngle(gg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return bboxCorners(gg.bbox0).map(([x, y]) => {
    const dx = x - gg.center.x;
    const dy = y - gg.center.y;
    return [gg.center.x + dx * cos - dy * sin, gg.center.y + dx * sin + dy * cos];
  });
}

/** One structure history entry swapping a layer object (transform commit). */
function commitLayerSwap(before: Layer, after: Layer, bytes: number): void {
  useEditorStore.setState((s) => ({ doc: { ...s.doc, layers: replaceLayer(s.doc.layers, after) }, revision: s.revision + 1 }));
  useEditorStore.getState().commitEntry({
    kind: 'structure',
    labelKey: 'history.transform',
    labelFallback: 'Transform',
    bytes,
    undo: () =>
      useEditorStore.setState((s) => ({ doc: { ...s.doc, layers: replaceLayer(s.doc.layers, before) }, revision: s.revision + 1 })),
    redo: () =>
      useEditorStore.setState((s) => ({ doc: { ...s.doc, layers: replaceLayer(s.doc.layers, after) }, revision: s.revision + 1 })),
  });
}

function scaleGeometryAbout(
  geom: ShapeGeometry,
  anchor: Pt,
  sx: number,
  sy: number,
): ShapeGeometry {
  const ax = anchor.x;
  const ay = anchor.y;
  const avg = (Math.abs(sx) + Math.abs(sy)) / 2;
  switch (geom.type) {
    case 'rect':
      return {
        ...geom,
        x: ax + (geom.x - ax) * sx,
        y: ay + (geom.y - ay) * sy,
        w: geom.w * sx,
        h: geom.h * sy,
        radius: Math.max(0, geom.radius * avg),
      };
    case 'ellipse':
      return { ...geom, x: ax + (geom.x - ax) * sx, y: ay + (geom.y - ay) * sy, w: geom.w * sx, h: geom.h * sy };
    case 'line':
      return {
        ...geom,
        x1: ax + (geom.x1 - ax) * sx,
        y1: ay + (geom.y1 - ay) * sy,
        x2: ax + (geom.x2 - ax) * sx,
        y2: ay + (geom.y2 - ay) * sy,
      };
    case 'polygon':
      return {
        ...geom,
        cx: ax + (geom.cx - ax) * sx,
        cy: ay + (geom.cy - ay) * sy,
        radius: Math.max(1, geom.radius * avg),
      };
    case 'star':
      return {
        ...geom,
        cx: ax + (geom.cx - ax) * sx,
        cy: ay + (geom.cy - ay) * sy,
        outer: Math.max(1, geom.outer * avg),
        inner: Math.max(0.5, geom.inner * avg),
      };
    case 'path':
      return {
        type: 'path',
        subpaths: geom.subpaths.map((sp) => ({
          closed: sp.closed,
          commands: sp.commands.map((c): PathCommand => {
            if (c.c === 'Z') return c;
            if (c.c === 'C')
              return {
                ...c,
                c1x: ax + (c.c1x - ax) * sx,
                c1y: ay + (c.c1y - ay) * sy,
                c2x: ax + (c.c2x - ax) * sx,
                c2y: ay + (c.c2y - ay) * sy,
                x: ax + (c.x - ax) * sx,
                y: ay + (c.y - ay) * sy,
              };
            if (c.c === 'Q')
              return { ...c, cx: ax + (c.cx - ax) * sx, cy: ay + (c.cy - ay) * sy, x: ax + (c.x - ax) * sx, y: ay + (c.y - ay) * sy };
            return { ...c, x: ax + (c.x - ax) * sx, y: ay + (c.y - ay) * sy };
          }),
        })),
      };
  }
}

function commitScale(gg: TransformGesture): void {
  const store = useEditorStore.getState();
  const layer = getLayer(store.doc.layers, gg.layerId);
  if (!layer) return;
  const { sx, sy } = scaleFactors(gg);
  if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return;
  if (layer.kind === 'raster') {
    const r = layer as RasterLayer;
    const w1 = Math.max(1, Math.round(gg.bbox0.w * Math.abs(sx)));
    const h1 = Math.max(1, Math.round(gg.bbox0.h * Math.abs(sy)));
    const out: AnyCanvas = transformCanvas(r.canvas, scaling(sx, sy), w1, h1);
    const corners = scaledCorners(gg);
    const minX = Math.min(...corners.map((c) => c[0]));
    const minY = Math.min(...corners.map((c) => c[1]));
    const after: RasterLayer = { ...r, canvas: out, x: minX, y: minY };
    commitLayerSwap(r, after, w1 * h1 * 4);
    return;
  }
  if (layer.kind === 'text') {
    const t = layer as TextLayer;
    const s = (Math.abs(sx) + Math.abs(sy)) / 2;
    const text = {
      ...t.text,
      fontSize: Math.max(1, t.text.fontSize * s),
      x: gg.anchor.x + (t.text.x - gg.anchor.x) * s,
      y: gg.anchor.y + (t.text.y - gg.anchor.y) * s,
      boxWidth: t.text.boxWidth > 0 ? t.text.boxWidth * s : 0,
    };
    store.updateLayer(t.id, { text }, 'history.transform', 'Transform');
    return;
  }
  if (layer.kind === 'shape') {
    const s = layer as ShapeLayer;
    const geom = scaleGeometryAbout(s.shape, gg.anchor, sx, sy);
    const avg = (Math.abs(sx) + Math.abs(sy)) / 2;
    store.updateLayer(
      s.id,
      {
        shape: geom,
        bbox: shapeBBox(geom),
        stroke: s.stroke ? { ...s.stroke, width: Math.max(0.5, s.stroke.width * avg) } : null,
      },
      'history.transform',
      'Transform',
    );
  }
}

function commitRotate(gg: TransformGesture): void {
  const store = useEditorStore.getState();
  const layer = getLayer(store.doc.layers, gg.layerId);
  if (!layer || layer.kind !== 'raster') return;
  const r = layer as RasterLayer;
  const a = rotateAngle(gg);
  if (Math.abs(a) < 0.001) return;
  const w0 = gg.bbox0.w;
  const h0 = gg.bbox0.h;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const w1 = Math.abs(w0 * cos) + Math.abs(h0 * sin);
  const h1 = Math.abs(w0 * sin) + Math.abs(h0 * cos);
  // rotate about the canvas center, centered in the new bounding buffer
  const m = multiply(multiply(translation(w1 / 2, h1 / 2), rotation(a)), translation(-w0 / 2, -h0 / 2));
  const out = transformCanvas(r.canvas, m, Math.max(1, Math.round(w1)), Math.max(1, Math.round(h1)));
  const cx = gg.bbox0.x + w0 / 2;
  const cy = gg.bbox0.y + h0 / 2;
  const after: RasterLayer = { ...r, canvas: out, x: cx - w1 / 2, y: cy - h1 / 2 };
  commitLayerSwap(r, after, out.width * out.height * 4);
}

/** Undoes the live (history-free) move mutations. */
function restoreBeforeLayers(gg: TransformGesture): void {
  if (gg.kind === 'move' && gg.original.kind === 'raster') {
    // raster was mutated in place — restore numeric positions explicitly
    const found = findLayer(useEditorStore.getState().doc.layers, gg.layerId);
    if (found && found.layer.kind === 'raster') {
      found.layer.x = gg.originX;
      found.layer.y = gg.originY;
    }
  }
  useEditorStore.setState((s) => ({ doc: { ...s.doc, layers: gg.beforeLayers }, revision: s.revision + 1 }));
}

export const moveController: ToolController = {
  tool: 'move' as ToolId,
  cursor: 'move',
  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    const store = useEditorStore.getState();
    const active = store.getActiveLayer();
    const base = {
      startDoc: { x: e.docX, y: e.docY },
      curDoc: { x: e.docX, y: e.docY },
      beforeLayers: store.doc.layers,
      shift: e.shift,
      originX: 0,
      originY: 0,
      handle: -1,
      anchor: { x: 0, y: 0 },
      bbox0: { x: 0, y: 0, w: 0, h: 0 },
      center: { x: 0, y: 0 },
      startAngle: 0,
    };

    // 1. transform handles on the selected layer
    if (active && !active.locked && active.kind !== 'fill' && active.kind !== 'adjustment') {
      const bbox = layerBBox(active);
      if (bbox && bbox.w > 1 && bbox.h > 1) {
        const allowRotate = active.kind === 'raster';
        const h = hitHandle(ctx.view, bbox, e.screenX, e.screenY, allowRotate);
        if (h === 8 && active.kind === 'raster') {
          const center = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };
          g = { ...base, kind: 'rotate', layerId: active.id, original: active, handle: 8, bbox0: bbox, center, startAngle: Math.atan2(e.docY - center.y, e.docX - center.x) };
          ctx.invalidate();
          return;
        }
        if (h >= 0 && h < 8) {
          const rects = handleRects(bbox);
          const opposite = (h + 4) % 8;
          g = { ...base, kind: 'scale', layerId: active.id, original: active, handle: h, anchor: { x: rects[opposite][0], y: rects[opposite][1] }, bbox0: bbox };
          ctx.invalidate();
          return;
        }
      }
    }

    // 2. move gesture
    let target: Layer | null = null;
    if (store.toolOptions.move.autoSelect) {
      const hit = hitTestLayer(e.docX, e.docY);
      if (hit) {
        store.selectLayer(hit.id);
        target = hit;
      }
    } else {
      target = active;
    }
    if (!target || target.locked || target.kind === 'fill' || target.kind === 'adjustment') return;
    const origin = layerOrigin(target);
    g = { ...base, kind: 'move', layerId: target.id, original: target, originX: origin.x, originY: origin.y };
    ctx.invalidate();
  },
  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!g) return;
    g.curDoc = { x: e.docX, y: e.docY };
    g.shift = e.shift;
    if (g.kind === 'move') {
      const dx = e.docX - g.startDoc.x;
      const dy = e.docY - g.startDoc.y;
      if (g.original.kind === 'raster') {
        // live translate WITHOUT history: mutate fields + revision bump
        const found = findLayer(useEditorStore.getState().doc.layers, g.layerId);
        if (found && found.layer.kind === 'raster') {
          found.layer.x = g.originX + dx;
          found.layer.y = g.originY + dy;
          useEditorStore.setState((s) => ({ revision: s.revision + 1 }));
        }
      } else {
        // rebuild text/shape/group from the pristine original each frame
        const shifted = shiftLayerContent(g.original, dx, dy);
        useEditorStore.setState((s) => ({ doc: { ...s.doc, layers: replaceLayer(s.doc.layers, shifted) }, revision: s.revision + 1 }));
      }
    }
    ctx.invalidate();
  },
  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!g) return;
    const gg = g;
    g = null;
    const store = useEditorStore.getState();
    if (gg.kind === 'move') {
      const dx = gg.curDoc.x - gg.startDoc.x;
      const dy = gg.curDoc.y - gg.startDoc.y;
      const moved = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;
      restoreBeforeLayers(gg); // so updateLayer records a real before/after
      if (!moved) {
        ctx.invalidate();
        return;
      }
      if (gg.original.kind === 'raster') {
        store.updateLayer(gg.layerId, { x: gg.originX + dx, y: gg.originY + dy }, 'history.transform', 'Transform');
      } else {
        const final = shiftLayerContent(gg.original, dx, dy);
        if (final.kind === 'text') store.updateLayer(gg.layerId, { text: (final as TextLayer).text }, 'history.transform', 'Transform');
        else if (final.kind === 'shape') {
          const s = final as ShapeLayer;
          store.updateLayer(gg.layerId, { shape: s.shape, bbox: s.bbox }, 'history.transform', 'Transform');
        } else if (final.kind === 'group') {
          store.updateLayer(gg.layerId, { children: (final as GroupLayer).children }, 'history.transform', 'Transform');
        }
      }
    } else if (gg.kind === 'scale') {
      commitScale(gg);
    } else {
      commitRotate(gg);
    }
    ctx.invalidate();
  },
  onPointerCancel(): void {
    if (g) restoreBeforeLayers(g);
    g = null;
  },
  deactivate(): void {
    if (g) restoreBeforeLayers(g);
    g = null;
  },
  drawOverlay(ctx: OverlayCtx, view: ViewState): void {
    const store = useEditorStore.getState();
    if (g && (g.kind === 'scale' || g.kind === 'rotate')) {
      const pts = g.kind === 'scale' ? scaledCorners(g) : rotatedCorners(g);
      ctx.save();
      applyDocTransform(ctx, view);
      strokeAnts(ctx, view, pts, true);
      for (const p of pts) drawHandle(ctx, view, p[0], p[1]);
      if (g.kind === 'rotate') {
        const topMid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
        drawRotationHandle(ctx, view, topMid[0], topMid[1]);
      }
      ctx.restore();
      return;
    }
    if (g && g.kind === 'move') {
      // outline follows the layer being dragged
      const live = getLayer(store.doc.layers, g.layerId);
      const bbox = layerBBox(live);
      if (bbox) {
        ctx.save();
        applyDocTransform(ctx, view);
        strokeSolid(ctx, view, bboxCorners(bbox), true, 'rgba(255,255,255,0.9)', 1);
        ctx.restore();
      }
      return;
    }
    const active = store.getActiveLayer();
    if (!active || active.locked || active.kind === 'fill' || active.kind === 'adjustment') return;
    const bbox = layerBBox(active);
    if (!bbox || bbox.w <= 1 || bbox.h <= 1) return;
    ctx.save();
    applyDocTransform(ctx, view);
    strokeSolid(ctx, view, bboxCorners(bbox), true, 'rgba(255,255,255,0.7)', 1);
    for (const p of handleRects(bbox)) drawHandle(ctx, view, p[0], p[1]);
    if (active.kind === 'raster') drawRotationHandle(ctx, view, bbox.x + bbox.w / 2, bbox.y);
    ctx.restore();
  },
};
