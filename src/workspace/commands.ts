/**
 * Shared editor commands — the single implementation of copy/paste/cut,
 * fills, document save/open and view helpers. Both the keyboard layer
 * (GlobalKeys) and the menus (MenuBar / MobileWorkspace) call these so the
 * behavior can never drift.
 *
 * v1 uses an internal (module-level) clipboard for pixel copy/paste.
 * v2 note: mirror to the async system clipboard via navigator.clipboard.write
 * with an image Blob for cross-app pasting.
 */

import type { DocumentState, Layer, RasterLayer, Selection } from '../engine/types';
import { APP_VERSION, createDocument, createGroupLayer, createRasterLayer } from '../engine/document';
import { imageDataFromCanvas, putImageData } from '../engine/raster';
import { useEditorStore } from '../state/editorStore';
import { saveProject } from '../documents/project';
import { downloadBlob, importImageLayer, safeFilename } from '../formats/api';
import { importPsd, isPsdFile, type ImportedLayer } from '../formats/psdImport';
import { toast } from '../hooks/use-toast';
import { dictionaries, translate, type Language, type TranslationKey } from '../i18n/dictionaries';
import { runInpaint } from '../lib/filterRunner';
import { DEFAULT_INPAINT_ITERATIONS, LARGE_HOLE_ITERATIONS, LARGE_HOLE_PIXELS } from '../engine/inpaint';
import { toolOptionsKey } from './toolMeta';

let internalClipboard: ImageData | null = null;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/* ------------------------------ clipboard ------------------------------ */

/** Snapshots the active raster layer's pixels into the internal clipboard. */
export function copyActiveLayerToClipboard(): boolean {
  const layer = useEditorStore.getState().getActiveLayer();
  if (!layer || layer.kind !== 'raster') return false;
  internalClipboard = imageDataFromCanvas((layer as RasterLayer).canvas);
  return true;
}

/** Pastes the clipboard as a new raster layer (positioned at the selection, if any). */
export function pasteClipboardAsLayer(): boolean {
  const data = internalClipboard;
  if (!data) return false;
  const store = useEditorStore.getState();
  const layer = createRasterLayer('Pasted', data.width, data.height);
  putImageData(layer.canvas, data);
  const sel: Selection | null = store.selection;
  if (sel) {
    layer.x = Math.max(0, Math.round(sel.bounds.x));
    layer.y = Math.max(0, Math.round(sel.bounds.y));
  }
  store.addLayer(layer, 'history.paste');
  return true;
}

/** Copy + clear (selection region when present, otherwise the whole layer). */
export function cutActiveLayerToClipboard(): boolean {
  const layer = useEditorStore.getState().getActiveLayer();
  if (!layer || layer.kind !== 'raster' || layer.locked) return false;
  if (!copyActiveLayerToClipboard()) return false;
  return clearSelectionRegion('edit.cut', 'Cut');
}

/* --------------------------- destructive edits --------------------------- */

/**
 * Clears pixels: within the selection coverage when a selection exists,
 * otherwise the entire layer. Commits a diff-region history entry.
 */
export function clearSelectionRegion(labelKey: TranslationKey, labelFallback: string): boolean {
  const store = useEditorStore.getState();
  const layer = store.getActiveLayer();
  if (!layer || layer.kind !== 'raster' || layer.locked) return false;
  const raster = layer as RasterLayer;
  const before = imageDataFromCanvas(raster.canvas);
  const after = imageDataFromCanvas(raster.canvas);
  const sel = store.selection;
  const { width, height } = before;
  if (sel) {
    const bx = Math.max(0, sel.bounds.x);
    const by = Math.max(0, sel.bounds.y);
    const bw = Math.min(width, sel.bounds.x + sel.bounds.w) - bx;
    const bh = Math.min(height, sel.bounds.y + sel.bounds.h) - by;
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) {
        const sx = x - sel.bounds.x;
        const sy = y - sel.bounds.y;
        if (sx < 0 || sy < 0 || sx >= sel.width || sy >= sel.height) continue;
        const cov = sel.mask[sy * sel.width + sx] / 255;
        if (cov <= 0) continue;
        const o = (y * width + x) * 4;
        after.data[o + 3] = Math.round(after.data[o + 3] * (1 - cov));
      }
    }
  } else {
    for (let i = 3; i < after.data.length; i += 4) after.data[i] = 0;
  }
  putImageData(raster.canvas, after); // write pixels BEFORE committing (commitPixelEdit only records the diff)
  store.commitPixelEdit(raster.id, before, after, labelKey, labelFallback);
  return true;
}

/** Fills the entire active raster layer with a solid color at 100% opacity. */
export function fillActiveLayerWithColor(hex: string, labelKey: TranslationKey, labelFallback: string): boolean {
  const store = useEditorStore.getState();
  const layer = store.getActiveLayer();
  if (!layer || layer.kind !== 'raster' || layer.locked) return false;
  const raster = layer as RasterLayer;
  const { width, height } = raster.canvas;
  const before = imageDataFromCanvas(raster.canvas);
  const after = new ImageData(width, height);
  const { r, g, b } = hexToRgb(hex);
  for (let i = 0; i < after.data.length; i += 4) {
    after.data[i] = r;
    after.data[i + 1] = g;
    after.data[i + 2] = b;
    after.data[i + 3] = 255;
  }
  putImageData(raster.canvas, after); // write pixels BEFORE committing (commitPixelEdit only records the diff)
  store.commitPixelEdit(raster.id, before, after, labelKey, labelFallback);
  return true;
}

/* --------------------------- content-aware fill --------------------------- */

const CAF_HINT_FLAG = 'pixelforge.caf.hint.v1';

/** True on the first-ever successful run (used to show the honest hint once). */
function markCafHintSeen(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    if (localStorage.getItem(CAF_HINT_FLAG)) return false;
    localStorage.setItem(CAF_HINT_FLAG, '1');
    return true;
  } catch {
    return false; // storage blocked (strict private mode) — never block the fill
  }
}

/**
 * Content-aware fill (Edit ▸ Content-aware fill…): diffusion-inpaints the
 * selection area on the active raster layer (see engine/inpaint — smooth-region
 * fill, NOT texture synthesis). The doc-space selection mask is rasterized into
 * layer pixel space (layers may sit at an offset), the layer runs through the
 * worker-backed inpaint runner and the result is committed as ONE pixel history
 * entry. Holes > 2M px run fewer iterations to stay responsive.
 */
export async function contentAwareFillCommand(): Promise<boolean> {
  const store = useEditorStore.getState();
  const layer = store.getActiveLayer();
  const sel = store.selection;
  if (!layer || layer.kind !== 'raster' || layer.locked || !sel) return false;
  const raster = layer as RasterLayer;
  const { width, height } = raster.canvas;

  // Rasterize the doc-space selection into a layer-space hole mask (binary at
  // 128 — the same coverage threshold the marching-ants tracer uses).
  // ⚠️ Selection.mask is FULL-DOCUMENT-SIZED (sel.width × sel.height, see
  // Selection in engine/types.ts) — index it in DOCUMENT coordinates, not in
  // bounds-local ones. bounds only limits the scan window for speed.
  const mask = new Uint8Array(width * height);
  let holePx = 0;
  const lx0 = Math.max(0, Math.floor(sel.bounds.x - layer.x));
  const ly0 = Math.max(0, Math.floor(sel.bounds.y - layer.y));
  const lx1 = Math.min(width, Math.ceil(sel.bounds.x + sel.bounds.w - layer.x));
  const ly1 = Math.min(height, Math.ceil(sel.bounds.y + sel.bounds.h - layer.y));
  for (let y = ly0; y < ly1; y++) {
    for (let x = lx0; x < lx1; x++) {
      const dx = x + layer.x;
      const dy = y + layer.y;
      if (dx < 0 || dy < 0 || dx >= sel.width || dy >= sel.height) continue;
      if (sel.mask[dy * sel.width + dx] >= 128) {
        mask[y * width + x] = 255;
        holePx++;
      }
    }
  }
  if (holePx === 0) return false; // selection doesn't cover this layer

  const before = imageDataFromCanvas(raster.canvas);
  const iterations = holePx > LARGE_HOLE_PIXELS ? LARGE_HOLE_ITERATIONS : DEFAULT_INPAINT_ITERATIONS;
  store.setJobProgress({ label: toastText('common.processing', 'Processing…'), value: 0.5 });
  try {
    // runInpaint clones internally — `before` stays intact for the history entry.
    const after = await runInpaint(before, mask, iterations);
    putImageData(raster.canvas, after); // write pixels BEFORE committing (commitPixelEdit only records the diff)
    store.commitPixelEdit(raster.id, before, after, 'history.contentAwareFill', 'Content-aware fill');
    const firstRun = markCafHintSeen();
    toast({
      title: toastText('caf.done', 'Content-aware fill applied'),
      ...(firstRun ? { description: toastText('caf.hint', 'Best for smooth areas (sky, skin, walls). Structured textures may blur.') } : {}),
    });
    return true;
  } catch {
    toast({ title: toastText('toast.filterFailed', 'The filter could not be applied') });
    return false;
  } finally {
    useEditorStore.getState().setJobProgress(null);
  }
}

/* ------------------------------- painting ------------------------------- */

/** [ / ] — resize the current tool when it has a numeric `size` option. */
export function adjustActivePaintSize(delta: number): void {
  const store = useEditorStore.getState();
  const key = toolOptionsKey(store.tool);
  if (!key) return;
  const opts = store.toolOptions[key] as { size?: number } | undefined;
  if (!opts || typeof opts.size !== 'number') return;
  const next = Math.min(500, Math.max(1, Math.round(opts.size + delta)));
  if (next === opts.size) return;
  store.updateToolOptions(key, { size: next });
}

/* ------------------------------ file flows ------------------------------ */

let fileInput: HTMLInputElement | null = null;

/** Opens the file picker; results flow through handleOpenFiles. */
export function openFilePicker(): void {
  if (typeof document === 'undefined') return;
  if (!fileInput) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept =
      'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml,application/json,.pfs,.psd';
    fileInput.multiple = false;
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      const files = fileInput?.files;
      if (files && files.length > 0) void handleOpenFiles(files);
      if (fileInput) fileInput.value = '';
    });
    document.body.appendChild(fileInput);
  }
  fileInput.click();
}

/** Imports an image as a new layer, a .pfs project as a new document, or a PSD as a layered document. */
export async function handleOpenFiles(files: FileList | File[]): Promise<void> {
  const file = files[0];
  if (!file) return;
  const store = useEditorStore.getState();
  if (await isPsdFile(file)) {
    await openPsdDocument(file, store);
    return;
  }
  const result = await importImageLayer(file, store.doc.width, store.doc.height);
  if (result.project) {
    store.openDocument(result.project);
    toast({ title: toastText('toast.projectLoaded', 'Project loaded') });
    return;
  }
  if (result.layer) {
    store.addLayer(result.layer, 'history.import');
    toast({ title: toastText('toast.imported', 'Imported {name}', { name: file.name }) });
    return;
  }
  toast({
    title: toastText(
      'toast.unsupportedFormat',
      '{name} is not supported in this build. Supported: PNG, JPEG, WebP, GIF, BMP, SVG, PSD.',
      { name: file.name },
    ),
  });
}

/**
 * Converts one imported PSD layer into an engine layer. Group entries
 * ('lsct' section dividers) become engine group layers via the engine's
 * group factory, with children converted recursively (PSD child order is
 * top-first, so it is reversed on the way in — callers walk the root list
 * bottom-up for the same reason). Raster leaves keep their decoded canvases
 * and offsets.
 */
function psdLayerToEngine(imported: ImportedLayer): Layer {
  if (imported.isGroup) {
    const group = createGroupLayer(
      imported.name,
      (imported.children ?? []).map(psdLayerToEngine).reverse(),
    );
    group.visible = imported.visible;
    group.opacity = imported.opacity;
    group.blendMode = imported.blend;
    group.expanded = imported.expanded ?? true;
    return group;
  }
  const layer = createRasterLayer(imported.name, imported.width, imported.height, imported.canvas);
  layer.x = imported.x;
  layer.y = imported.y;
  layer.visible = imported.visible;
  layer.opacity = imported.opacity;
  layer.blendMode = imported.blend;
  return layer;
}

/**
 * Opens a PSD as a new document: the layer tree is rebuilt bottom→top from
 * the PSD records (which are stored top-first), preserving names, offsets,
 * blend modes, opacity, visibility and group nesting ('lsct' section
 * dividers → engine group layers with expanded state). Failure shows the
 * parser's user-facing message.
 */
async function openPsdDocument(
  file: File,
  store: ReturnType<typeof useEditorStore.getState>,
): Promise<void> {
  try {
    const imported = await importPsd(file);
    const doc: DocumentState = createDocument({
      name: imported.name,
      width: imported.width,
      height: imported.height,
      background: 'transparent',
      withBackgroundLayer: false,
    });
    doc.layers = [];
    // PSD stores layer records top-first; doc.layers is bottom→top.
    for (let i = imported.layers.length - 1; i >= 0; i -= 1) {
      doc.layers.push(psdLayerToEngine(imported.layers[i]));
    }
    doc.selectedLayerIds = doc.layers.length > 0 ? [doc.layers[doc.layers.length - 1].id] : [];
    doc.createdAt = Date.now();
    doc.updatedAt = Date.now();
    store.openDocument(doc);
    toast({ title: toastText('toast.imported', 'Imported {name}', { name: file.name }) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    toast({
      title: toastText('import.psdFailed' as TranslationKey, 'Could not import PSD: {reason}', { reason }),
    });
  }
}

/** Serializes the document and downloads it as a .pfs project file. */
export async function saveProjectToDisk(): Promise<void> {
  const store = useEditorStore.getState();
  try {
    const blob = await saveProject(store.doc, APP_VERSION);
    downloadBlob(blob, `${safeFilename(store.doc.name)}.pfs`);
    toast({ title: toastText('toast.projectSaved', 'Project saved') });
  } catch {
    toast({ title: toastText('toast.nothingToExport', 'Nothing to export yet') });
  }
}

/* --------------------------------- view --------------------------------- */

/** Dispatches the 'pf:fit' event consumed by CanvasStage. */
export function dispatchFit(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('pf:fit'));
}

/** Resets the workspace layout (panels + view) to defaults. */
export function resetWorkspace(): void {
  const store = useEditorStore.getState();
  store.setView({ zoom: 1, panX: 0, panY: 0, rotation: 0, flipX: false, flipY: false });
  store.setRightPanel('layers');
  if (!store.ui.panelsVisible) store.togglePanels();
  if (store.ui.mobilePanel !== null) store.setMobilePanel(null);
}

/* ------------------------------- utilities ------------------------------- */

/**
 * Translates a label at call time. Kept here (not via useI18n) because most
 * commands run outside React (keydown handlers, async flows).
 */
export function toastText(key: TranslationKey, fallback: string, vars?: Record<string, string | number>): string {
  const lang: Language = useEditorStore.getState().settings.language;
  if (Object.prototype.hasOwnProperty.call(dictionaries.en, key)) {
    return translate(lang, key, vars);
  }
  return fallback.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ''));
}
