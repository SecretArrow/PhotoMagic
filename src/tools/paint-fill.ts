/**
 * Fill / gradient / eyedropper tools.
 *
 * - fill: scanline flood via floodSelect over the active layer buffer
 *   (layer-local coords) or the merged composite (sampleMerged); the match
 *   mask is expanded to doc space, intersected with the current selection,
 *   and the fg color is blended src-over at the option opacity. One
 *   commitPixelEdit history entry ('history.fill').
 * - gradient: drag defines start/end; on release the gradient (linear /
 *   radial / conic; presets fg-bg and fg-transparent, reversible) is rendered
 *   in doc space into a layer-sized buffer and blended into the layer with
 *   selection + preserve-transparency support ('history.gradient').
 * - eyedropper: alpha-weighted average over the radius option, from the
 *   merged composite or the active layer; alt picks the bg color. No history.
 */

import { useEditorStore } from '../state/editorStore';
import type { CanvasPointerEvent, ToolContext, ToolController } from '../canvas/pointerContract';
import { floodSelect } from '../engine/selections';
import { composeDocument } from '../engine/render';
import { ctx2d, imageDataFromCanvas, makeCanvas } from '../engine/raster';
import { hexToRgb, hexWithAlpha, rgbToHex } from '../engine/color';
import type { GradientStop, RasterLayer, ToolId } from '../engine/types';
import { blitMaskToDoc, bumpRevision, selectionCoverage } from './strokeCommon';
import { applyDocTransform, drawHandle, px, type OverlayCtx } from './shared';

/* ------------------------------- fill -------------------------------- */

function buildMatchMask(layer: RasterLayer, docX: number, docY: number, docW: number, docH: number, tolerance: number, contiguous: boolean, sampleMerged: boolean): Uint8Array | null {
  if (sampleMerged) {
    const composite = composeDocument(useEditorStore.getState().doc);
    const data = imageDataFromCanvas(composite);
    const sel = floodSelect(data.data, data.width, data.height, Math.floor(docX), Math.floor(docY), tolerance, contiguous);
    if (!sel) return null;
    const out = new Uint8Array(docW * docH);
    let any = false;
    for (let i = 0; i < out.length; i++) {
      if (sel.mask[i] > 0) {
        out[i] = 1;
        any = true;
      }
    }
    return any ? out : null;
  }
  const data = imageDataFromCanvas(layer.canvas);
  const sel = floodSelect(
    data.data,
    data.width,
    data.height,
    Math.floor(docX - layer.x),
    Math.floor(docY - layer.y),
    tolerance,
    contiguous,
  );
  if (!sel) return null;
  return blitMaskToDoc(sel.mask, sel.width, sel.height, Math.round(layer.x), Math.round(layer.y), docW, docH);
}

function applyFillColor(layer: RasterLayer, match: Uint8Array, docW: number, docH: number, color: string, opacity: number): ImageData {
  const { r, g, b } = hexToRgb(color);
  const data = imageDataFromCanvas(layer.canvas);
  const d = data.data;
  const ox = Math.round(layer.x);
  const oy = Math.round(layer.y);
  for (let ly = 0; ly < data.height; ly++) {
    const dy = ly + oy;
    if (dy < 0 || dy >= docH) continue;
    for (let lx = 0; lx < data.width; lx++) {
      const dx = lx + ox;
      if (dx < 0 || dx >= docW) continue;
      if (!match[dy * docW + dx]) continue;
      const selCov = selectionCoverage(dx, dy);
      if (selCov <= 0) continue;
      const a = opacity * selCov;
      const o = (ly * data.width + lx) * 4;
      const srcA = d[o + 3] / 255;
      const outA = a + srcA * (1 - a);
      if (outA <= 0) continue;
      d[o] = (r * a + d[o] * srcA * (1 - a)) / outA;
      d[o + 1] = (g * a + d[o + 1] * srcA * (1 - a)) / outA;
      d[o + 2] = (b * a + d[o + 2] * srcA * (1 - a)) / outA;
      d[o + 3] = outA * 255;
    }
  }
  return data;
}

export const fillController: ToolController = {
  tool: 'fill' as ToolId,
  cursor: 'crosshair',
  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    const store = useEditorStore.getState();
    const layer = store.getActiveRasterLayer();
    if (!layer) return;
    const opts = store.toolOptions.fill;
    const seedX = Math.floor(e.docX - layer.x);
    const seedY = Math.floor(e.docY - layer.y);
    if (seedX < 0 || seedY < 0 || seedX >= layer.canvas.width || seedY >= layer.canvas.height) return;
    const match = buildMatchMask(layer, e.docX, e.docY, store.doc.width, store.doc.height, opts.tolerance, opts.contiguous, opts.sampleMerged);
    if (!match) return;
    const before = imageDataFromCanvas(layer.canvas);
    const after = applyFillColor(layer, match, store.doc.width, store.doc.height, store.fgColor, Math.min(1, Math.max(0, opts.opacity / 100)));
    store.commitPixelEdit(layer.id, before, after, 'history.fill', 'Fill');
    bumpRevision();
    ctx.invalidate();
  },
  deactivate(): void {
    /* stateless */
  },
};

/* ----------------------------- gradient ------------------------------ */

interface GradientGesture {
  start: { x: number; y: number };
  cur: { x: number; y: number };
}

let gradientG: GradientGesture | null = null;

function gradientStops(preset: string, reverse: boolean): GradientStop[] {
  const fg = useEditorStore.getState().fgColor;
  const bg = useEditorStore.getState().bgColor;
  let stops: GradientStop[];
  if (preset === 'fg-transparent') {
    stops = [
      { offset: 0, color: fg, alpha: 1 },
      { offset: 1, color: fg, alpha: 0 },
    ];
  } else {
    // 'fg-bg' and unknown presets (v2: preset library)
    stops = [
      { offset: 0, color: fg, alpha: 1 },
      { offset: 1, color: bg, alpha: 1 },
    ];
  }
  if (reverse) stops = stops.map((s) => ({ ...s, offset: 1 - s.offset })).reverse();
  return stops;
}

function commitGradient(): void {
  if (!gradientG) return;
  const gg = gradientG;
  gradientG = null;
  const store = useEditorStore.getState();
  const layer = store.getActiveRasterLayer();
  if (!layer) return;
  const opts = store.toolOptions.gradient;
  const dx = gg.cur.x - gg.start.x;
  const dy = gg.cur.y - gg.start.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return; // click without drag does nothing
  const before = imageDataFromCanvas(layer.canvas);

  // render the gradient in DOC space into a layer-sized buffer
  const tmp = makeCanvas(layer.canvas.width, layer.canvas.height);
  const tctx = ctx2d(tmp);
  tctx.translate(-layer.x, -layer.y);
  let grad: CanvasGradient;
  if (opts.gradientType === 'radial') {
    grad = tctx.createRadialGradient(gg.start.x, gg.start.y, 0, gg.start.x, gg.start.y, Math.max(1, dist));
  } else if (opts.gradientType === 'conic') {
    grad = tctx.createConicGradient(Math.atan2(dy, dx), gg.start.x, gg.start.y);
  } else {
    grad = tctx.createLinearGradient(gg.start.x, gg.start.y, gg.cur.x, gg.cur.y);
  }
  const stops = [...gradientStops(opts.preset, opts.reverse)].sort((a, b) => a.offset - b.offset);
  for (const s of stops) {
    grad.addColorStop(Math.min(1, Math.max(0, s.offset)), hexWithAlpha(s.color, s.alpha));
  }
  tctx.fillStyle = grad;
  tctx.fillRect(layer.x, layer.y, layer.canvas.width, layer.canvas.height);

  // blend gradient over the layer: selection clip + optional transparency preservation
  const gdata = imageDataFromCanvas(tmp);
  const ldata = imageDataFromCanvas(layer.canvas);
  const sel = store.selection;
  const gd = gdata.data;
  const ld = ldata.data;
  const ox = Math.round(layer.x);
  const oy = Math.round(layer.y);
  for (let ly = 0; ly < ldata.height; ly++) {
    const dyAbs = ly + oy;
    for (let lx = 0; lx < ldata.width; lx++) {
      const o = (ly * ldata.width + lx) * 4;
      const srcA = ld[o + 3] / 255;
      let a = 1;
      if (sel) {
        const dxDoc = lx + ox;
        const dyDoc = ly + oy;
        if (dxDoc < 0 || dyDoc < 0 || dxDoc >= sel.width || dyDoc >= sel.height) continue;
        a = sel.mask[dyDoc * sel.width + dxDoc] / 255;
      }
      if (a <= 0) continue;
      if (!opts.transparency) a *= srcA; // protect transparent pixels
      if (a <= 0) continue;
      const outA = a + srcA * (1 - a);
      if (outA <= 0) continue;
      ld[o] = (gd[o] * a + ld[o] * srcA * (1 - a)) / outA;
      ld[o + 1] = (gd[o + 1] * a + ld[o + 1] * srcA * (1 - a)) / outA;
      ld[o + 2] = (gd[o + 2] * a + ld[o + 2] * srcA * (1 - a)) / outA;
      ld[o + 3] = outA * 255;
    }
  }
  ctx2d(layer.canvas).putImageData(ldata, 0, 0);
  store.commitPixelEdit(layer.id, before, ldata, 'history.gradient', 'Gradient');
  bumpRevision();
}

export const gradientController: ToolController = {
  tool: 'gradient' as ToolId,
  cursor: 'crosshair',
  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    const store = useEditorStore.getState();
    if (!store.getActiveRasterLayer()) return;
    gradientG = { start: { x: e.docX, y: e.docY }, cur: { x: e.docX, y: e.docY } };
    ctx.invalidate();
  },
  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!gradientG) return;
    gradientG.cur = { x: e.docX, y: e.docY };
    ctx.invalidate();
  },
  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext): void {
    commitGradient();
    ctx.invalidate();
  },
  onPointerCancel(_e: CanvasPointerEvent, ctx: ToolContext): void {
    gradientG = null;
    ctx.invalidate();
  },
  deactivate(): void {
    gradientG = null;
  },
  drawOverlay(ctx: OverlayCtx, view): void {
    if (!gradientG) return;
    ctx.save();
    applyDocTransform(ctx, view);
    ctx.beginPath();
    ctx.moveTo(gradientG.start.x, gradientG.start.y);
    ctx.lineTo(gradientG.cur.x, gradientG.cur.y);
    ctx.lineWidth = px(view, 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.setLineDash([px(view, 5), px(view, 4)]);
    ctx.stroke();
    ctx.setLineDash([]);
    drawHandle(ctx, view, gradientG.start.x, gradientG.start.y, 7);
    drawHandle(ctx, view, gradientG.cur.x, gradientG.cur.y, 7);
    ctx.restore();
  },
};

/* ----------------------------- eyedropper ---------------------------- */

interface SampleSource {
  data: ImageData;
  offX: number;
  offY: number;
}

let sampleSource: SampleSource | null = null;
let sampling = false;
let hover: { x: number; y: number } | null = null;

function pickAt(docX: number, docY: number, alt: boolean): void {
  if (!sampleSource) return;
  const store = useEditorStore.getState();
  const r = Math.max(0, Math.round(store.toolOptions.eyedropper.radius));
  const cx = Math.round(docX - sampleSource.offX);
  const cy = Math.round(docY - sampleSource.offY);
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let w = 0;
  for (let j = -r; j <= r; j++) {
    const y = cy + j;
    if (y < 0 || y >= sampleSource.data.height) continue;
    for (let i = -r; i <= r; i++) {
      const x = cx + i;
      if (x < 0 || x >= sampleSource.data.width) continue;
      const o = (y * sampleSource.data.width + x) * 4;
      const a = sampleSource.data.data[o + 3];
      if (a === 0) continue;
      sr += sampleSource.data.data[o] * a;
      sg += sampleSource.data.data[o + 1] * a;
      sb += sampleSource.data.data[o + 2] * a;
      w += a;
    }
  }
  if (w <= 0) return; // fully transparent — keep current colors
  const hex = rgbToHex({ r: sr / w, g: sg / w, b: sb / w });
  if (alt) store.setBgColor(hex);
  else store.setFgColor(hex);
}

export const eyedropperController: ToolController = {
  tool: 'eyedropper' as ToolId,
  cursor: 'crosshair',
  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    const store = useEditorStore.getState();
    const opts = store.toolOptions.eyedropper;
    if (opts.sampleMerged) {
      sampleSource = { data: imageDataFromCanvas(composeDocument(store.doc)), offX: 0, offY: 0 };
    } else {
      const l = store.getActiveLayer();
      if (!l || l.kind !== 'raster') return;
      sampleSource = { data: imageDataFromCanvas(l.canvas), offX: Math.round(l.x), offY: Math.round(l.y) };
    }
    sampling = true;
    hover = { x: e.docX, y: e.docY };
    pickAt(e.docX, e.docY, e.alt);
    ctx.invalidate();
  },
  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    hover = { x: e.docX, y: e.docY };
    if (sampling) {
      pickAt(e.docX, e.docY, e.alt);
      ctx.invalidate();
    }
  },
  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext): void {
    sampling = false;
    sampleSource = null;
    ctx.invalidate();
  },
  onPointerCancel(): void {
    sampling = false;
    sampleSource = null;
  },
  deactivate(): void {
    sampling = false;
    sampleSource = null;
    hover = null;
  },
  drawOverlay(ctx: OverlayCtx, view): void {
    if (!hover) return;
    const r = Math.max(1, useEditorStore.getState().toolOptions.eyedropper.radius + 2);
    ctx.save();
    applyDocTransform(ctx, view);
    ctx.beginPath();
    ctx.arc(hover.x, hover.y, px(view, r), 0, Math.PI * 2);
    ctx.lineWidth = px(view, 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.setLineDash([px(view, 3), px(view, 3)]);
    ctx.stroke();
    ctx.restore();
  },
};
