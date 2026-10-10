/**
 * IO API — the single surface the UI uses for import/export.
 * Implementations live in formats/* and documents/*; this module binds them
 * to friendly async functions with error messages.
 *
 * Phase-1 real formats: PNG, JPEG, WebP, GIF (first frame), BMP, SVG (sanitized).
 * Partially supported formats surface an informative message — never silent
 * flattening or corruption.
 */

import type { DocumentState, Layer, RasterLayer } from '../engine/types';
import { createRasterLayer, genId } from '../engine/document';
import { makeCanvas, ctx2d, type AnyCanvas } from '../engine/raster';
import { composeDocument, renderLayerIsolated } from '../engine/render';

export interface ImportResult {
  ok: boolean;
  /** layer to insert (single image import) */
  layer?: RasterLayer;
  /** native project loaded instead of an image */
  project?: DocumentState;
  /** human-readable notice, e.g. partially supported format */
  notice?: string;
  error?: string;
}

export const SUPPORTED_IMPORT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/svg+xml',
  'application/json', // .pfs projects
]);

export const PARTIAL_SUPPORT: Record<string, string> = {
  'image/gif': 'GIF: only the first frame is imported in this build.',
  'image/svg+xml': 'SVG: rasterized on import; vector nodes are not editable after import.',
};

export const UNSUPPORTED_HINT =
  'Supported formats: PNG, JPEG, WebP, GIF (first frame), BMP, SVG, .pfs projects. TIFF/PSD/PDF/HEIC/RAW are not supported in this build.';

/** Decodes a File/Blob into a bitmap-safe canvas (sanitizes SVG by re-drawing). */
export async function blobToCanvas(blob: Blob): Promise<AnyCanvas> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode failed'));
      img.src = url;
    });
    const canvas = makeCanvas(Math.max(1, img.naturalWidth), Math.max(1, img.naturalHeight));
    const ctx = ctx2d(canvas);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function isProjectFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.pfs') || file.type === 'application/json';
}

/** Converts an HTMLImageElement-free File into a raster layer. */
export async function importImageLayer(file: File, docW: number, docH: number): Promise<ImportResult> {
  const notice = PARTIAL_SUPPORT[file.type];
  if (isProjectFile(file)) {
    const { loadProjectFromFile } = await import('../documents/project');
    try {
      const project = await loadProjectFromFile(file);
      return { ok: true, project, notice: 'Project loaded' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Invalid project file' };
    }
  }
  if (!SUPPORTED_IMPORT_TYPES.has(file.type)) {
    return { ok: false, error: UNSUPPORTED_HINT };
  }
  try {
    const canvas = await blobToCanvas(file);
    const layer = createRasterLayer(cleanName(file.name), docW, docH, canvas);
    // center the imported image in the document
    layer.x = Math.round((docW - canvas.width) / 2);
    layer.y = Math.round((docH - canvas.height) / 2);
    return { ok: true, layer, notice };
  } catch {
    return { ok: false, error: 'Could not decode this file.' };
  }
}

function cleanName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
  return base.slice(0, 60) || 'Imported image';
}

/* ------------------------------ export ------------------------------ */

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'avif';

export interface ExportOptions {
  format: ExportFormat;
  quality: number; // 0..1
  scale: number; // 0.1..4
  transparent: boolean; // PNG/WebP/AVIF only
  doc: DocumentState;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
}

export async function exportComposite(opts: ExportOptions): Promise<ExportResult> {
  const { doc } = opts;
  const composite = composeDocument(doc);
  const scale = Math.max(0.05, Math.min(4, opts.scale));
  const w = Math.max(1, Math.round(doc.width * scale));
  const h = Math.max(1, Math.round(doc.height * scale));
  const out = makeCanvas(w, h);
  const ctx = ctx2d(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (opts.format === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(composite as CanvasImageSource, 0, 0, w, h);
  const mime =
    opts.format === 'png'
      ? 'image/png'
      : opts.format === 'webp'
        ? 'image/webp'
        : opts.format === 'avif'
          ? 'image/avif'
          : 'image/jpeg';
  const blob = await canvasToBlob(out, mime, opts.quality);
  if (opts.format === 'avif' && blob.type !== 'image/avif') {
    // Browsers without AVIF silently fall back to PNG — surface that instead
    // of shipping a mislabeled file (the UI feature-detects before offering AVIF).
    throw new Error('AVIF encoding is not supported by this browser');
  }
  return { blob, filename: `${safeFilename(doc.name)}.${opts.format === 'jpeg' ? 'jpg' : opts.format}`, width: w, height: h };
}

export async function exportLayer(layer: Layer, doc: DocumentState, format: ExportFormat = 'png', quality = 0.95): Promise<ExportResult> {
  const isolated = renderLayerIsolated(layer, doc);
  const mime =
    format === 'png'
      ? 'image/png'
      : format === 'webp'
        ? 'image/webp'
        : format === 'avif'
          ? 'image/avif'
          : 'image/jpeg';
  const blob = await canvasToBlob(isolated, mime, quality);
  return {
    blob,
    filename: `${safeFilename(doc.name)}-${safeFilename(layer.name)}.${format === 'jpeg' ? 'jpg' : format}`,
    width: doc.width,
    height: doc.height,
  };
}

export function canvasToBlob(canvas: AnyCanvas, mime: string, quality = 0.95): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof (canvas as HTMLCanvasElement).toBlob === 'function') {
      (canvas as HTMLCanvasElement).toBlob(
        (b) => (b ? resolve(b) : reject(new Error('blob conversion failed'))),
        mime,
        quality,
      );
    } else {
      // OffscreenCanvas path
      (canvas as OffscreenCanvas)
        .convertToBlob({ type: mime, quality })
        .then(resolve)
        .catch(reject);
    }
  });
}

export function safeFilename(name: string): string {
  return (name || 'untitled').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
}

/** Triggers a browser download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export { genId };
