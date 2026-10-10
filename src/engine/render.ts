/**
 * Compositing renderer (Canvas2D backend).
 *
 * Walks the layer tree bottom→top and produces the final composite:
 *  - blend modes via globalCompositeOperation (spec-defined HSL modes included)
 *  - per-layer opacity, visibility, locks
 *  - alpha masks (non-destructive, invertible)
 *  - clipping to the layer below (clipping masks)
 *  - adjustment layers evaluated against the composite below them
 *  - smart filters applied synchronously via the filter registry
 *  - groups composited into an isolated buffer first (correct group blending)
 *
 * The renderer NEVER mutates layer pixel buffers.
 */

import type { AdjustmentLayer, DocumentState, FillLayer, GroupLayer, Layer, RasterLayer, ShapeLayer, TextLayer } from './types';
import { blendToComposite } from './blend';
import { applyAdjustments } from './adjustments';
import { ctx2d, imageDataFromCanvas, makeCanvas, paintChecker, type AnyCanvas, type AnyContext2D } from './raster';
import { applyStroke, buildShapePath, drawTextLayout, fontString, layoutText, resolvePaint } from './paint';
import { getFilter } from './filters/registry';
import type { FilterResponse } from './types';

export interface ComposeOptions {
  /** draw checkerboard behind transparent areas (viewport preview) */
  checker?: boolean;
  /** target canvas to draw into (must match doc size) */
  target?: AnyCanvas;
  /** if provided, layers are clipped to this selection mask (doc space) */
  selectionMask?: Uint8ClampedArray | null;
}

/**
 * Composites the whole document at 1:1 resolution.
 * Returns a canvas of exactly doc.width × doc.height.
 */
export function composeDocument(doc: DocumentState, opts: ComposeOptions = {}): AnyCanvas {
  const target = opts.target ?? makeCanvas(doc.width, doc.height);
  if (target.width !== doc.width || target.height !== doc.height) {
    target.width = doc.width;
    target.height = doc.height;
  }
  const ctx = ctx2d(target);
  const base = composeLayers(ctx, doc.layers, doc, opts.selectionMask ?? null);
  // blit the composed buffer into the target (checker optionally underneath)
  if (opts.checker) {
    ctx.clearRect(0, 0, doc.width, doc.height);
    paintChecker(ctx, 0, 0, doc.width, doc.height);
  } else {
    ctx.clearRect(0, 0, doc.width, doc.height);
  }
  ctx.drawImage(base as CanvasImageSource, 0, 0);
  return target;
}

/** Composes a list of layers into a fresh buffer, returns that buffer. */
function composeLayers(
  parentCtx: AnyContext2D,
  layers: Layer[],
  doc: DocumentState,
  selectionMask: Uint8ClampedArray | null,
): AnyCanvas {
  const buffer = makeCanvas(doc.width, doc.height);
  const ctx = ctx2d(buffer);
  let clipBase: AnyCanvas | null = null; // alpha of the last non-clipped composite run

  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;

    const layerOut = renderLayerBuffer(layer, doc);
    if (!layerOut) continue;

    // smart filters are applied inside renderLayerBuffer; masks applied there too.
    if (layer.kind === 'adjustment') {
      // Evaluate against composite of everything below (the current buffer).
      const adj = layer as AdjustmentLayer;
      const belowData = imageDataFromCanvas(buffer);
      applyAdjustments(belowData.data, [adj.adjustment]);
      const adjusted = makeCanvas(doc.width, doc.height);
      ctx2d(adjusted).putImageData(belowData, 0, 0);
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(adjusted as CanvasImageSource, 0, 0);
      ctx.globalAlpha = 1;
      clipBase = snapshotAlpha(buffer);
      continue;
    }

    if (layer.clipToBelow) {
      if (clipBase) {
        // mask layerOut by the alpha of the base composite
        const masked = makeCanvas(doc.width, doc.height);
        const mctx = ctx2d(masked);
        mctx.drawImage(layerOut as CanvasImageSource, 0, 0);
        mctx.globalCompositeOperation = 'destination-in';
        mctx.drawImage(clipBase as CanvasImageSource, 0, 0);
        drawToBuffer(ctx, masked, layer, selectionMask);
      } else {
        drawToBuffer(ctx, layerOut, layer, selectionMask);
      }
    } else {
      drawToBuffer(ctx, layerOut, layer, selectionMask);
      clipBase = snapshotAlpha(buffer);
    }
  }
  void parentCtx;
  return buffer;
}

/** Draws a rendered layer buffer into the compositing context with blend/opacity. */
function drawToBuffer(
  ctx: AnyContext2D,
  layerOut: AnyCanvas,
  layer: Layer,
  selectionMask: Uint8ClampedArray | null,
): void {
  let src: AnyCanvas = layerOut;
  if (selectionMask && layer.kind !== 'group') {
    // restrict painting preview to selection: mask by selection alpha
    const sel = makeCanvas(layerOut.width, layerOut.height);
    const sctx = ctx2d(sel);
    sctx.drawImage(layerOut as CanvasImageSource, 0, 0);
    const data = imageDataFromCanvas(sel);
    const { width, height } = sel;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const m = selectionMask[y * width + x] ?? 0;
        if (m < 255) data.data[y * width * 4 + x * 4 + 3] = (data.data[y * width * 4 + x * 4 + 3] * m) / 255;
      }
    }
    sctx.putImageData(data, 0, 0);
    src = sel;
  }
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = blendToComposite(layer.blendMode);
  ctx.drawImage(src as CanvasImageSource, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function snapshotAlpha(buffer: AnyCanvas): AnyCanvas | null {
  // cheap approximation: reuse the buffer itself for destination-in masking
  return buffer;
}

/**
 * Renders a single layer to a doc-sized buffer (without blend/opacity).
 * Applies smart filters and masks. Returns null when nothing to draw.
 */
function renderLayerBuffer(layer: Layer, doc: DocumentState): AnyCanvas | null {
  switch (layer.kind) {
    case 'raster':
      return rasterBuffer(layer, doc);
    case 'group':
      return groupBuffer(layer as GroupLayer, doc);
    case 'text':
      return textBuffer(layer as TextLayer, doc);
    case 'shape':
      return shapeBuffer(layer as ShapeLayer, doc);
    case 'fill':
      return fillBuffer(layer as FillLayer, doc);
    case 'adjustment':
      return null; // handled during composition
  }
}

function rasterBuffer(layer: RasterLayer, doc: DocumentState): AnyCanvas {
  const enabledFilters = layer.filters ? layer.filters.filter((f) => f.enabled) : [];
  // Fast path: pixels already cover the document 1:1 and need no filter/mask
  // work — return the layer canvas itself instead of allocating a doc-sized
  // buffer per composite. The renderer never mutates layer buffers, so this
  // is safe; drawToBuffer only reads from it.
  if (enabledFilters.length === 0 && !(layer.mask && layer.mask.enabled) && layer.x === 0 && layer.y === 0 && layer.canvas.width === doc.width && layer.canvas.height === doc.height) {
    return layer.canvas;
  }
  const out = makeCanvas(doc.width, doc.height);
  const ctx = ctx2d(out);
  let content: AnyCanvas = layer.canvas;
  if (enabledFilters.length > 0) {
    content = applySmartFilters(content, enabledFilters);
  }
  ctx.drawImage(content as CanvasImageSource, layer.x, layer.y);
  if (layer.mask && layer.mask.enabled) {
    applyMask(ctx, out, layer.mask, layer.x, layer.y);
  }
  return out;
}

function groupBuffer(group: GroupLayer, doc: DocumentState): AnyCanvas {
  const inner = composeLayers(ctx2d(makeCanvas(1, 1)), group.children, doc, null);
  const out = makeCanvas(doc.width, doc.height);
  const ctx = ctx2d(out);
  let content: AnyCanvas = inner;
  if (group.filters && group.filters.some((f) => f.enabled)) {
    content = applySmartFilters(content, group.filters.filter((f) => f.enabled));
  }
  ctx.drawImage(content as CanvasImageSource, group.x, group.y);
  if (group.mask && group.mask.enabled) applyMask(ctx, out, group.mask, group.x, group.y);
  return out;
}

function textBuffer(layer: TextLayer, doc: DocumentState): AnyCanvas {
  const out = makeCanvas(doc.width, doc.height);
  const ctx = ctx2d(out);
  const layout = layoutText(layer.text, ctx);
  drawTextLayout(ctx, layer.text, layout);
  if (layer.mask && layer.mask.enabled) applyMask(ctx, out, layer.mask, 0, 0);
  return out;
}

function shapeBuffer(layer: ShapeLayer, doc: DocumentState): AnyCanvas {
  const out = makeCanvas(doc.width, doc.height);
  const ctx = ctx2d(out);
  const path = buildShapePath(layer.shape);
  if (layer.fill) {
    ctx.fillStyle = resolvePaint(ctx, layer.fill, layer.bbox);
    ctx.fill(path);
  }
  if (layer.stroke && layer.stroke.width > 0) applyStroke(ctx, path, layer.stroke);
  if (layer.mask && layer.mask.enabled) applyMask(ctx, out, layer.mask, 0, 0);
  return out;
}

function fillBuffer(layer: FillLayer, doc: DocumentState): AnyCanvas {
  const out = makeCanvas(doc.width, doc.height);
  const ctx = ctx2d(out);
  ctx.fillStyle = resolvePaint(ctx, layer.paint, { x: 0, y: 0, w: doc.width, h: doc.height });
  ctx.fillRect(0, 0, doc.width, doc.height);
  if (layer.mask && layer.mask.enabled) applyMask(ctx, out, layer.mask, 0, 0);
  return out;
}

/** Applies an alpha mask (grayscale canvas) to a rendered buffer in place. */
function applyMask(
  ctx: AnyContext2D,
  buffer: AnyCanvas,
  mask: NonNullable<Layer['mask']>,
  offsetX: number,
  offsetY: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = mask.inverted ? 'destination-out' : 'destination-in';
  // masks are stored in layer-content space; buffer is doc space
  ctx.drawImage(mask.canvas as CanvasImageSource, offsetX, offsetY);
  ctx.restore();
}

type Masked = NonNullable<Layer['mask']>;

/** Runs smart filters synchronously (main thread). Worker path is used for previews. */
function applySmartFilters(content: AnyCanvas, filters: NonNullable<Layer['filters']>): AnyCanvas {
  let canvas = content;
  for (const f of filters) {
    const def = getFilter(f.op);
    if (!def) continue;
    const data = imageDataFromCanvas(canvas);
    try {
      def.apply(data.data, data.width, data.height, f.params);
      const next = makeCanvas(data.width, data.height);
      ctx2d(next).putImageData(data, 0, 0);
      canvas = next;
    } catch {
      // deterministic fallback: skip failing filter rather than corrupting output
      continue;
    }
  }
  return canvas;
}

/** Renders a single layer isolated (for layer export & thumbnails). */
export function renderLayerIsolated(layer: Layer, doc: DocumentState): AnyCanvas {
  if (layer.kind === 'group') return groupBuffer(layer as GroupLayer, doc);
  const out = makeCanvas(doc.width, doc.height);
  const ctx = ctx2d(out);
  switch (layer.kind) {
    case 'raster':
      ctx.drawImage((layer as RasterLayer).canvas as CanvasImageSource, layer.x, layer.y);
      break;
    case 'text':
      drawTextLayout(ctx, (layer as TextLayer).text, layoutText((layer as TextLayer).text, ctx));
      break;
    case 'shape': {
      const s = layer as ShapeLayer;
      const path = buildShapePath(s.shape);
      if (s.fill) {
        ctx.fillStyle = resolvePaint(ctx, s.fill, s.bbox);
        ctx.fill(path);
      }
      if (s.stroke && s.stroke.width > 0) applyStroke(ctx, path, s.stroke);
      break;
    }
    case 'fill': {
      const f = layer as FillLayer;
      ctx.fillStyle = resolvePaint(ctx, f.paint, { x: 0, y: 0, w: doc.width, h: doc.height });
      ctx.fillRect(0, 0, doc.width, doc.height);
      break;
    }
    case 'adjustment': {
      // isolated render of an adjustment layer is transparent by definition
      return out;
    }
  }
  return out;
}


/** Converts any canvas to a PNG data URL (OffscreenCanvas lacks toDataURL). */
function canvasToDataUrl(canvas: AnyCanvas): string {
  if (typeof (canvas as HTMLCanvasElement).toDataURL === 'function') {
    return (canvas as HTMLCanvasElement).toDataURL('image/png');
  }
  const host = document.createElement('canvas');
  host.width = canvas.width;
  host.height = canvas.height;
  host.getContext('2d')?.drawImage(canvas as CanvasImageSource, 0, 0);
  return host.toDataURL('image/png');
}

/**
 * Per-layer content version. The store bumps it whenever a layer's rendered
 * content may have changed (pixels, geometry, text/shape/fill params) — see
 * bumpLayerPixelVersion() calls in editorStore. Thumbnails are cached per
 * (layer id + version + visibility + doc size) instead of the global doc
 * revision, so one layer's edit no longer regenerates every thumbnail.
 */
const pixelVersions = new Map<string, number>();

export function bumpLayerPixelVersion(layerId: string): void {
  pixelVersions.set(layerId, (pixelVersions.get(layerId) ?? 0) + 1);
}

export function bumpLayerPixelVersions(layerIds: Iterable<string>): void {
  for (const id of layerIds) bumpLayerPixelVersion(id);
}

/** Small thumbnail for the layers panel. Cached per layer identity, not per global revision.
 *  `revision` is kept in the signature for API compatibility; cache validity is per layer. */
const thumbCache = new Map<string, { sig: string; url: string }>();

function layerThumbSignature(layer: Layer, doc: DocumentState): string {
  return `${layer.id}|${pixelVersions.get(layer.id) ?? 0}|${layer.visible ? 1 : 0}|${doc.width}x${doc.height}`;
}

export function layerThumbnail(layer: Layer, doc: DocumentState, revision: number, size = 44): string {
  void revision;
  const sig = layerThumbSignature(layer, doc);
  const cached = thumbCache.get(layer.id);
  if (cached && cached.sig === sig) return cached.url;
  const isolated = renderLayerIsolated(layer, doc);
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  const scale = Math.min(size / Math.max(1, doc.width), size / Math.max(1, doc.height));
  const w = doc.width * scale;
  const h = doc.height * scale;
  ctx.drawImage(isolated as CanvasImageSource, (size - w) / 2, (size - h) / 2, w, h);
  let url = '';
  try {
    url = canvasToDataUrl(c);
  } catch {
    url = '';
  }
  thumbCache.set(layer.id, { sig, url });
  if (thumbCache.size > 400) {
    // simple eviction to bound memory
    const first = thumbCache.keys().next().value;
    if (first) thumbCache.delete(first);
  }
  return url;
}

/** Mask thumbnail (grayscale) for the layers panel. Cached per mask-canvas identity. */
const maskThumbCache = new Map<string, { ref: AnyCanvas; url: string }>();

export function maskThumbnail(layer: Layer, revision: number, size = 44): string | null {
  void revision;
  if (!layer.mask) return null;
  const cached = maskThumbCache.get(layer.id);
  if (cached && cached.ref === layer.mask.canvas) return cached.url;
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  const m = layer.mask.canvas;
  const scale = Math.min(size / Math.max(1, m.width), size / Math.max(1, m.height));
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(m as CanvasImageSource, (size - m.width * scale) / 2, (size - m.height * scale) / 2, m.width * scale, m.height * scale);
  let url = '';
  try {
    url = canvasToDataUrl(c);
  } catch {
    url = '';
  }
  maskThumbCache.set(layer.id, { ref: layer.mask.canvas, url });
  return url;
}

/* ------------------------------------------------------------------ */
/* shared composite (viewport + navigator preview)                     */
/* ------------------------------------------------------------------ */

/**
 * Drops every per-layer cache entry (thumbnails, mask thumbnails, pixel
 * versions). The caches are keyed by layer id only, so a different
 * document's entries — including strong references to its mask canvases —
 * would otherwise linger for the whole session. Called by the canvas stage
 * whenever the active document id changes; the new document's thumbnails
 * simply regenerate on the next layers-panel render.
 */
export function clearThumbnailCaches(): void {
  pixelVersions.clear();
  thumbCache.clear();
  maskThumbCache.clear();
}

let sharedComposite: { doc: DocumentState; canvas: AnyCanvas } | null = null;

/** Publishes the viewport's cached composite so cheap consumers (navigator
 *  preview) can reuse it instead of recomposing the whole document. */
export function publishSharedComposite(doc: DocumentState, canvas: AnyCanvas): void {
  sharedComposite = { doc, canvas };
}

/** Returns the shared composite for `doc` when fresh, otherwise composes it. */
export function getSharedComposite(doc: DocumentState): AnyCanvas {
  if (sharedComposite && sharedComposite.doc === doc) return sharedComposite.canvas;
  const canvas = composeDocument(doc);
  sharedComposite = { doc, canvas };
  return canvas;
}

// keep worker message type referenced so ts sees it used in this module family
export type { FilterResponse };
