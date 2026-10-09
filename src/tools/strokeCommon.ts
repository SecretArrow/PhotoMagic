/**
 * Shared pixel-stroke plumbing for painting / retouch tools.
 *
 * History pattern: `beginPixelStroke` snapshots the full layer buffer at
 * stroke start, the tool draws LIVE into the layer canvas during the
 * gesture, and `finishPixelStroke` hands before/after to
 * store.commitPixelEdit which diffs and records one history entry
 * (no-op when nothing changed).
 *
 * Also provides selection-masked stamping: when a selection exists, each
 * dab/region is alpha-multiplied by the selection coverage over its doc-space
 * footprint before being composited onto the layer.
 */

import { useEditorStore } from '../state/editorStore';
import { ctx2d, imageDataFromCanvas, makeCanvas, type AnyCanvas, type Rect } from '../engine/raster';
import type { RasterLayer } from '../engine/types';

export interface PixelStroke {
  layerId: string;
  canvas: AnyCanvas;
  before: ImageData;
}

/** Snapshots the layer buffer at gesture start. */
export function beginPixelStroke(layer: RasterLayer): PixelStroke {
  return { layerId: layer.id, canvas: layer.canvas, before: imageDataFromCanvas(layer.canvas) };
}

/** Commits one diff-region history entry for the stroke (no-op when clean). */
export function finishPixelStroke(stroke: PixelStroke | null, labelKey: string, labelFallback: string): void {
  if (!stroke) return;
  const after = imageDataFromCanvas(stroke.canvas);
  useEditorStore.getState().commitPixelEdit(stroke.layerId, stroke.before, after, labelKey, labelFallback);
}

/** Bumps the store revision so renderer/thumbnails invalidate after live pixel edits. */
export function bumpRevision(): void {
  useEditorStore.setState((s) => ({ revision: s.revision + 1 }));
}

/** Selection coverage (0..1) at a doc-space point (1 when no selection). */
export function selectionCoverage(docX: number, docY: number): number {
  const sel = useEditorStore.getState().selection;
  if (!sel) return 1;
  const x = Math.floor(docX);
  const y = Math.floor(docY);
  if (x < 0 || y < 0 || x >= sel.width || y >= sel.height) return 0;
  return sel.mask[y * sel.width + x] / 255;
}

/**
 * Draws a stamp dab centered at a doc-space point into the layer canvas,
 * multiplied by the current selection coverage when a selection exists.
 * mode 'erase' stamps with destination-out.
 */
export function drawStampWithSelection(
  layer: RasterLayer,
  stamp: AnyCanvas,
  docX: number,
  docY: number,
  alpha: number,
  mode: 'normal' | 'erase' = 'normal',
): void {
  if (alpha <= 0) return;
  const sel = useEditorStore.getState().selection;
  const cx = Math.round(docX - layer.x);
  const cy = Math.round(docY - layer.y);
  const left = cx - (stamp.width >> 1);
  const top = cy - (stamp.height >> 1);

  let src: AnyCanvas = stamp;
  if (sel) {
    const tmp = makeCanvas(stamp.width, stamp.height);
    const tctx = ctx2d(tmp);
    tctx.drawImage(stamp, 0, 0);
    const data = imageDataFromCanvas(tmp);
    const d = data.data;
    for (let j = 0; j < data.height; j++) {
      const dy = top + j + layer.y;
      for (let i = 0; i < data.width; i++) {
        const o = (j * data.width + i) * 4;
        if (d[o + 3] === 0) continue;
        const dx = left + i + layer.x;
        const xi = Math.floor(dx);
        const yi = Math.floor(dy);
        const cov =
          xi < 0 || yi < 0 || xi >= sel.width || yi >= sel.height ? 0 : sel.mask[yi * sel.width + xi] / 255;
        if (cov < 1) d[o + 3] = d[o + 3] * cov;
      }
    }
    tctx.putImageData(data, 0, 0);
    src = tmp;
  }

  const lctx = ctx2d(layer.canvas);
  lctx.save();
  lctx.globalAlpha = Math.min(1, Math.max(0, alpha));
  if (mode === 'erase') lctx.globalCompositeOperation = 'destination-out';
  lctx.drawImage(src as CanvasImageSource, left, top);
  lctx.restore();
}

/** Intersection of a rect with the canvas bounds; null when empty. */
export function rectOnCanvas(canvas: AnyCanvas, x: number, y: number, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(canvas.width, Math.ceil(x + w));
  const y1 = Math.min(canvas.height, Math.ceil(y + h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Alpha channel of a stamp as a compact array (w*h). */
export function stampAlphaArray(stamp: AnyCanvas): Uint8ClampedArray {
  const d = imageDataFromCanvas(stamp).data;
  const a = new Uint8ClampedArray(stamp.width * stamp.height);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return a;
}

/**
 * Composites an (already processed) region ImageData back onto the layer
 * through the stamp's soft alpha mask. `region` is the layer-local rect of
 * `processed`; `stampRect` is the layer-local top-left of the stamp footprint
 * (may hang off the canvas — coverage outside is treated as 0). The drawn
 * result can be shifted by `destOffset` (smudge / clone offsets).
 */
export function putBackThroughStamp(
  layer: RasterLayer,
  processed: ImageData,
  region: Rect,
  stamp: AnyCanvas,
  stampRect: { x: number; y: number },
  alphaScale: number,
  destOffset?: { dx: number; dy: number },
): void {
  if (alphaScale <= 0) return;
  const tmp = makeCanvas(processed.width, processed.height);
  const tctx = ctx2d(tmp);
  tctx.putImageData(processed, 0, 0);
  const data = imageDataFromCanvas(tmp);
  const sdata = stampAlphaArray(stamp);
  const sw = stamp.width;
  const sh = stamp.height;
  const d = data.data;
  for (let j = 0; j < data.height; j++) {
    const sy = j + region.y - stampRect.y;
    if (sy < 0 || sy >= sh) continue;
    for (let i = 0; i < data.width; i++) {
      const sx = i + region.x - stampRect.x;
      if (sx < 0 || sx >= sw) continue;
      const cov = sdata[sy * sw + sx] / 255;
      const o = (j * data.width + i) * 4;
      d[o + 3] = d[o + 3] * cov * alphaScale;
    }
  }
  tctx.putImageData(data, 0, 0);
  const lctx = ctx2d(layer.canvas);
  lctx.drawImage(tmp, region.x + (destOffset?.dx ?? 0), region.y + (destOffset?.dy ?? 0));
}

/**
 * Blits a layer-local coverage mask into a doc-space boolean mask at the
 * layer offset. Returns null when nothing lands inside the document.
 */
export function blitMaskToDoc(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  offX: number,
  offY: number,
  docW: number,
  docH: number,
): Uint8Array | null {
  const out = new Uint8Array(docW * docH);
  let any = false;
  for (let y = 0; y < h; y++) {
    const dy = y + offY;
    if (dy < 0 || dy >= docH) continue;
    for (let x = 0; x < w; x++) {
      const dx = x + offX;
      if (dx < 0 || dx >= docW) continue;
      if (mask[y * w + x] > 0) {
        out[dy * docW + dx] = 1;
        any = true;
      }
    }
  }
  return any ? out : null;
}
