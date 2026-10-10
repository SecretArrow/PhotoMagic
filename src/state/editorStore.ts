/**
 * PixelForge Studio — editor store (Zustand).
 *
 * Owns: documents, layers, selection, view, tool state, colors, history,
 * UI state and settings. All mutations go through actions that create
 * history entries so undo/redo stays consistent.
 *
 * Pixel buffers (canvases) are treated as mutable outside history; pixel
 * edits commit diff-region entries via commitPixelEdit().
 */

import { create } from 'zustand';
import type {
  AdjustmentSpec,
  DocumentState,
  Guide,
  HistoryEntry,
  Layer,
  LayerMask,
  Paint,
  RasterLayer,
  Selection,
  TextContent,
  ToolId,
  ViewState,
} from '../engine/types';
import {
  createDocument,
  createGroupLayer,
  createRasterLayer,
  createTextLayer,
  createAdjustmentLayer,
  createFillLayer,
  duplicateLayer,
  findLayer,
  flattenLayers,
  genId,
  getLayer,
  insertLayer,
  moveLayer,
  removeLayer,
  replaceLayer,
} from '../engine/document';
import {
  borderSelection,
  combineSelections,
  contractSelection,
  ellipseSelection,
  featherSelection,
  growSelection,
  invertSelection,
  rectSelection,
  type SelectionMode,
} from '../engine/selections';
import { createHistory, historyBytes, jumpTo, pushEntry, redo as historyRedo, undo as historyUndo, type HistoryStack } from '../history';
import { imageDataFromCanvas, getRegion, putRegion, clipRectToCanvas, makeCanvas, ctx2d } from '../engine/raster';
import { bumpLayerPixelVersion, bumpLayerPixelVersions } from '../engine/render';
import { shiftLayerContent } from '../engine/transforms';
import type {
  DialogId,
  EditorSettings,
  EditorUiExtras,
  RightPanelId,
  ToolOptions,
  UiState,
} from './types';

/* ------------------------------------------------------------------ */
/* defaults                                                            */
/* ------------------------------------------------------------------ */

export const defaultToolOptions: ToolOptions = {
  brush: { size: 24, hardness: 80, opacity: 100, flow: 100, spacing: 12, smoothing: 40, pressureSize: true, pressureOpacity: false },
  pencil: { size: 2, opacity: 100 },
  eraser: { size: 30, hardness: 90, opacity: 100, flow: 100, spacing: 12, smoothing: 30, pressureSize: true, pressureOpacity: false },
  airbrush: { size: 40, hardness: 30, opacity: 60, flow: 20, spacing: 8, smoothing: 20, pressureSize: true, pressureOpacity: true },
  smudge: { size: 30, hardness: 50, strength: 60 },
  blurBrush: { size: 30, hardness: 60, strength: 50 },
  sharpenBrush: { size: 30, hardness: 60, strength: 40 },
  dodge: { size: 40, hardness: 50, strength: 30 },
  burn: { size: 40, hardness: 50, strength: 30 },
  clone: { size: 32, hardness: 70, opacity: 100, aligned: true },
  marquee: { mode: 'replace', feather: 0 },
  wand: { mode: 'replace', feather: 0, tolerance: 25, contiguous: true, sampleMerged: true },
  fill: { tolerance: 25, contiguous: true, opacity: 100, sampleMerged: false },
  gradient: { gradientType: 'linear', reverse: false, transparency: true, preset: 'fg-bg' },
  text: {
    text: 'Text',
    fontFamily: 'Arial, sans-serif',
    fontSize: 48,
    fontWeight: 400,
    italic: false,
    underline: false,
    align: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#111111',
    x: 40,
    y: 60,
    boxWidth: 0,
  },
  shape: {
    shape: 'rect',
    fillEnabled: true,
    fillColor: '#3c8f5a',
    strokeEnabled: false,
    strokeWidth: 3,
    strokeColor: '#111111',
    radius: 0,
    sides: 5,
    starPoints: 5,
    starInnerRatio: 0.5,
  },
  move: { autoSelect: false },
  eyedropper: { sampleMerged: true, radius: 1 },
  crop: { aspect: null },
};

const defaultSettings: EditorSettings = {
  language: 'en',
  autosaveEnabled: true,
  autosaveIntervalSec: 30,
  gridVisible: false,
  gridSize: 50,
  snapEnabled: true,
  snapToGuides: true,
  theme: 'dark',
  checkerSize: 8,
  showToasts: true,
};

const defaultView: ViewState = { zoom: 1, panX: 0, panY: 0, rotation: 0, flipX: false, flipY: false };

/* ------------------------------------------------------------------ */
/* store                                                               */
/* ------------------------------------------------------------------ */

export interface EditorStore {
  doc: DocumentState;
  docs: DocumentState[];
  activeDocId: string;
  /** bumped on every mutation — renderer & thumbnails cache key */
  revision: number;
  history: HistoryStack;
  selection: Selection | null;
  view: ViewState;
  tool: ToolId;
  toolOptions: ToolOptions;
  fgColor: string;
  bgColor: string;
  swatches: string[];
  ui: UiState;
  settings: EditorSettings;
  extras: EditorUiExtras;

  /* documents */
  newDocument(opts: { name?: string; width: number; height: number; background?: DocumentState['background']; customBackground?: string; dpi?: number }): void;
  openDocument(doc: DocumentState): void;
  closeDocument(id: string): void;
  setActiveDoc(id: string): void;
  updateDocMeta(patch: Partial<Pick<DocumentState, 'name' | 'description' | 'dpi' | 'background' | 'customBackground'>>): void;

  /* layers */
  addLayer(layer: Layer, label?: string): void;
  addRasterLayer(name?: string): RasterLayer;
  addTextLayer(content?: Partial<TextContent>): void;
  addAdjustmentLayer(spec: AdjustmentSpec): void;
  addFillLayer(paint: Paint): void;
  addGroupFromSelection(): void;
  deleteLayers(ids?: string[]): void;
  duplicateLayers(ids?: string[]): void;
  selectLayer(id: string, additive?: boolean): void;
  setSelectedLayerIds(ids: string[]): void;
  moveLayerTo(id: string, parentId: string | null, index: number): void;
  reorderSelected(delta: number): void;
  updateLayer(id: string, patch: Partial<Layer>, labelKey: string, labelFallback: string): void;
  /** Live (no-history) layer patch for slider drags — pair with beginLayerEdit/endLayerEdit. */
  updateLayerLive(id: string, patch: Partial<Layer>): void;
  /** Captures the pre-drag snapshot for a live edit session (idempotent per id). */
  beginLayerEdit(id: string): void;
  /** Pushes ONE history entry restoring the beginLayerEdit snapshot (no-op when unchanged/absent). */
  endLayerEdit(id: string, labelKey: string, labelFallback: string): void;
  mergeDown(id: string): void;
  mergeVisible(): void;
  flattenImage(): void;
  rasterizeLayer(id: string): void;
  rasterizeToCanvas(id: string, canvas: HTMLCanvasElement | OffscreenCanvas, rect?: { x: number; y: number; w: number; h: number } | null): void;
  addMask(layerId: string, fromSelection: boolean): void;
  updateMask(layerId: string, patch: Partial<Pick<LayerMask, 'enabled' | 'inverted'>>): void;
  applyMask(layerId: string): void;
  deleteMask(layerId: string): void;
  getActiveLayer(): Layer | null;
  getActiveRasterLayer(): RasterLayer | null;

  /* pixel edits (tools) */
  commitPixelEdit(layerId: string, before: ImageData, after: ImageData, labelKey: string, labelFallback: string): void;

  /* selection */
  setSelection(sel: Selection | null, mode?: SelectionMode): void;
  selectAll(): void;
  deselect(): void;
  invertSelectionAction(): void;
  featherSelectionAction(radius: number): void;
  growSelectionAction(px: number): void;
  contractSelectionAction(px: number): void;
  borderSelectionAction(px: number): void;
  rectSelectionAction(x: number, y: number, w: number, h: number, mode?: SelectionMode): void;
  ellipseSelectionAction(x: number, y: number, w: number, h: number, mode?: SelectionMode): void;

  /* view */
  setView(patch: Partial<ViewState>): void;
  zoomBy(factor: number, centerX?: number, centerY?: number): void;
  setZoom(z: number): void;
  fitToScreen(vw: number, vh: number): void;

  /* colors */
  setFgColor(c: string): void;
  setBgColor(c: string): void;
  swapColors(): void;
  addSwatch(c: string): void;
  removeSwatch(c: string): void;

  /* history */
  undo(): void;
  redo(): void;
  jumpHistory(index: number): void;
  commitEntry(entry: Omit<HistoryEntry, 'id' | 'at'>): void;

  /* guides */
  addGuide(axis: Guide['axis'], position: number): void;
  removeGuide(id: string): void;
  clearGuides(): void;

  /* document ops */
  resizeImage(width: number, height: number, smooth: boolean): void;
  resizeCanvas(width: number, height: number, anchor: 'center' | 'topleft'): void;
  cropTo(rect: { x: number; y: number; w: number; h: number }): void;
  flipDocument(axis: 'x' | 'y'): void;
  rotateDocument90(clockwise: boolean): void;

  /* tools & ui */
  setTool(t: ToolId): void;
  updateToolOptions<K extends keyof ToolOptions>(tool: K, patch: Partial<ToolOptions[K]>): void;
  setDialog(d: DialogId): void;
  setRightPanel(p: RightPanelId): void;
  togglePanels(): void;
  setMobilePanel(p: UiState['mobilePanel']): void;
  setMobileToolbarSheet(open: boolean): void;
  setFilterDialog(state: Partial<EditorUiExtras['filterDialog']>): void;
  setJobProgress(p: EditorUiExtras['jobProgress']): void;
  setBeforeAfter(v: boolean): void;
  setSplitView(v: number): void;
  markSaved(fingerprint: string): void;
  updateSettings(patch: Partial<EditorSettings>): void;
  setStorageInfo(info: UiState['storageInfo']): void;
}

function bumpRevision(rev: number): number {
  return rev + 1;
}

let initialDoc = createDocument({ name: 'Untitled-1', width: 1280, height: 800, background: 'white' });
void initialDoc;

export const useEditorStore = create<EditorStore>((set, get) => ({
  doc: initialDoc,
  docs: [initialDoc],
  activeDocId: initialDoc.id,
  revision: 1,
  history: createHistory(),
  selection: null,
  view: { ...defaultView },
  tool: 'brush',
  toolOptions: defaultToolOptions,
  fgColor: '#111111',
  bgColor: '#ffffff',
  swatches: ['#111111', '#ffffff', '#e63946', '#f4a261', '#2a9d8f', '#3c8f5a', '#457b9d', '#7209b7'],
  ui: {
    dialog: null,
    rightPanel: 'layers',
    panelsVisible: true,
    mobilePanel: null,
    mobileToolbarSheet: false,
    statusBarVisible: true,
    presentationMode: false,
    fullscreen: false,
    beforeAfter: false,
    splitView: 0.5,
    storageInfo: null,
  },
  settings: defaultSettings,
  extras: { filterDialog: { open: false, op: null, params: {} }, jobProgress: null, savedFingerprint: null },

  /* ------------------------- documents ------------------------- */

  newDocument(opts) {
    const doc = createDocument(opts);
    bumpAllLayerPixels(doc.layers); // guard against layer-id reuse across documents
    set((s) => ({
      doc,
      docs: [...s.docs, doc],
      activeDocId: doc.id,
      selection: null,
      history: createHistory(),
      view: { ...defaultView },
      revision: bumpRevision(s.revision),
    }));
  },

  openDocument(doc) {
    bumpAllLayerPixels(doc.layers); // guard against layer-id reuse across documents
    set((s) => {
      const existing = s.docs.find((d) => d.id === doc.id);
      const docs = existing ? s.docs.map((d) => (d.id === doc.id ? doc : d)) : [...s.docs, doc];
      return {
        docs,
        doc,
        activeDocId: doc.id,
        selection: null,
        history: createHistory(),
        view: { ...defaultView },
        revision: bumpRevision(s.revision),
      };
    });
  },

  closeDocument(id) {
    set((s) => {
      if (s.docs.length <= 1) {
        const fresh = createDocument({ name: 'Untitled-1', width: 1280, height: 800, background: 'white' });
        return { docs: [fresh], doc: fresh, activeDocId: fresh.id, history: createHistory(), selection: null, view: { ...defaultView }, revision: bumpRevision(s.revision) };
      }
      const docs = s.docs.filter((d) => d.id !== id);
      const activeDocId = s.activeDocId === id ? docs[docs.length - 1].id : s.activeDocId;
      const doc = docs.find((d) => d.id === activeDocId) as DocumentState;
      return { docs, activeDocId, doc, history: createHistory(), selection: null, revision: bumpRevision(s.revision) };
    });
  },

  setActiveDoc(id) {
    const target = get().docs.find((d) => d.id === id);
    if (!target) return;
    bumpAllLayerPixels(target.layers); // guard against layer-id reuse across documents
    set((s) => ({ doc: target, activeDocId: id, selection: null, history: createHistory(), revision: bumpRevision(s.revision) }));
  },

  updateDocMeta(patch) {
    set((s) => {
      const doc = { ...s.doc, ...patch, updatedAt: Date.now() };
      return { doc, docs: s.docs.map((d) => (d.id === doc.id ? doc : d)), revision: bumpRevision(s.revision) };
    });
  },

  /* -------------------------- layers --------------------------- */

  addLayer(layer, label = 'history.addLayer') {
    const entry = makeStructuralEntry(get, `add:${layer.id}`, label, label);
    set((s) => {
      const doc = {
        ...s.doc,
        layers: insertLayer(s.doc.layers, layer, null, s.doc.layers.length),
        selectedLayerIds: [layer.id],
        updatedAt: Date.now(),
      };
      return { doc, docs: swapDoc(s.docs, doc), revision: bumpRevision(s.revision) };
    });
    entry.after(get);
    get().commitEntry(entry.commit);
  },

  addRasterLayer(name) {
    const layer = createRasterLayer(name ?? `Layer ${countLayers(get().doc.layers) + 1}`, get().doc.width, get().doc.height);
    get().addLayer(layer);
    return layer;
  },

  addTextLayer(content) {
    const opts = get().toolOptions.text;
    const merged: TextContent = { ...opts, ...(content ?? {}), x: content?.x ?? opts.x, y: content?.y ?? opts.y };
    const layer = { ...createTextLayer(`Text ${countLayers(get().doc.layers) + 1}`, merged), text: merged } as Layer;
    get().addLayer(layer, 'history.addTextLayer');
  },

  addAdjustmentLayer(spec) {
    const layer = { ...createAdjustmentLayer(adjustmentName(spec), spec), blendMode: 'normal' as const } as Layer;
    // insert above active layer (or top)
    const s0 = get();
    const active = s0.getActiveLayer();
    let idx = s0.doc.layers.length;
    let parent: string | null = null;
    if (active) {
      const found = findLayer(s0.doc.layers, active.id);
      if (found) {
        idx = found.index + 1;
        // find parent id by walking — root insert unless active is nested; v1: root only
        parent = null;
        idx = Math.min(idx, s0.doc.layers.length);
      }
    }
    const entry = makeStructuralEntry(get, `add:${layer.id}`, 'history.addAdjustmentLayer', 'Add adjustment layer');
    set((s) => ({
      doc: { ...s.doc, layers: insertLayer(s.doc.layers, layer, parent, idx), selectedLayerIds: [layer.id], updatedAt: Date.now() },
      revision: bumpRevision(s.revision),
    }));
    entry.after(get);
    get().commitEntry(entry.commit);
  },

  addFillLayer(paint) {
    const layer = { ...createFillLayer(`Color Fill ${countLayers(get().doc.layers) + 1}`, paint) } as Layer;
    get().addLayer(layer, 'history.addFillLayer');
  },

  addGroupFromSelection() {
    const s0 = get();
    if (s0.doc.selectedLayerIds.length === 0) return;
    const ids = new Set(s0.doc.selectedLayerIds);
    const before = s0.doc.layers;
    const children: Layer[] = [];
    const rest = before.filter((l) => {
      if (ids.has(l.id)) {
        children.push(l);
        return false;
      }
      return true;
    });
    if (children.length === 0) return;
    const group = createGroupLayer(`Group ${countLayers(before) + 1}`, children);
    const insertAt = Math.min(rest.length, Math.max(0, before.findIndex((l) => ids.has(l.id))));
    const after = insertLayer(rest, group, null, insertAt);
    const entry: Omit<HistoryEntry, 'id' | 'at'> = {
      kind: 'structure',
      labelKey: 'history.groupLayers',
      labelFallback: 'Group layers',
      bytes: 0,
      undo: () => set((s) => ({ doc: { ...s.doc, layers: before, selectedLayerIds: s.doc.selectedLayerIds.filter((id) => !ids.has(id) || id === group.id) }, revision: bumpRevision(s.revision) })),
      redo: () => set((s) => ({ doc: { ...s.doc, layers: after, selectedLayerIds: [group.id] }, revision: bumpRevision(s.revision) })),
    };
    set((s) => ({ doc: { ...s.doc, layers: after, selectedLayerIds: [group.id], updatedAt: Date.now() }, revision: bumpRevision(s.revision) }));
    get().commitEntry(entry);
  },

  deleteLayers(ids) {
    const s0 = get();
    const target = ids ?? s0.doc.selectedLayerIds;
    if (target.length === 0) return;
    const before = s0.doc.layers;
    const beforeSel = s0.doc.selectedLayerIds;
    let after = before;
    for (const id of target) {
      const [next] = removeLayer(after, id);
      after = next;
    }
    if (after === before) return;
    const newSel = after.length > 0 ? [after[after.length - 1].id] : [];
    const entry: Omit<HistoryEntry, 'id' | 'at'> = {
      kind: 'structure',
      labelKey: 'history.deleteLayers',
      labelFallback: 'Delete layers',
      bytes: 0,
      undo: () => set((s) => ({ doc: { ...s.doc, layers: before, selectedLayerIds: beforeSel }, revision: bumpRevision(s.revision) })),
      redo: () => set((s) => ({ doc: { ...s.doc, layers: after, selectedLayerIds: newSel }, revision: bumpRevision(s.revision) })),
    };
    set((s) => ({ doc: { ...s.doc, layers: after, selectedLayerIds: newSel, updatedAt: Date.now() }, revision: bumpRevision(s.revision) }));
    get().commitEntry(entry);
  },

  duplicateLayers(ids) {
    const s0 = get();
    const target = ids ?? s0.doc.selectedLayerIds;
    if (target.length === 0) return;
    const entry = makeStructuralEntry(get, 'dup', 'history.duplicateLayer', 'Duplicate layer');
    set((s) => {
      let layers = s.doc.layers;
      const newIds: string[] = [];
      for (const id of target) {
        const found = findLayer(layers, id);
        if (!found) continue;
        const copy = duplicateLayer(found.layer);
        newIds.push(copy.id);
        layers = insertLayer(layers, copy, null, found.index + 1);
      }
      return {
        doc: { ...s.doc, layers, selectedLayerIds: newIds.length ? newIds : s.doc.selectedLayerIds, updatedAt: Date.now() },
        revision: bumpRevision(s.revision),
      };
    });
    entry.after(get);
    get().commitEntry(entry.commit);
  },

  selectLayer(id, additive = false) {
    set((s) => ({
      doc: {
        ...s.doc,
        selectedLayerIds: additive
          ? s.doc.selectedLayerIds.includes(id)
            ? s.doc.selectedLayerIds
            : [...s.doc.selectedLayerIds, id]
          : [id],
      },
    }));
  },

  setSelectedLayerIds(ids) {
    set((s) => ({ doc: { ...s.doc, selectedLayerIds: ids } }));
  },

  moveLayerTo(id, parentId, index) {
    const s0 = get();
    const before = s0.doc.layers;
    const after = moveLayer(before, id, parentId, index);
    if (after === before) return;
    const entry: Omit<HistoryEntry, 'id' | 'at'> = {
      kind: 'structure',
      labelKey: 'history.reorderLayer',
      labelFallback: 'Reorder layer',
      bytes: 0,
      undo: () => set((s) => ({ doc: { ...s.doc, layers: before }, revision: bumpRevision(s.revision) })),
      redo: () => set((s) => ({ doc: { ...s.doc, layers: after }, revision: bumpRevision(s.revision) })),
    };
    set((s) => ({ doc: { ...s.doc, layers: after, updatedAt: Date.now() }, revision: bumpRevision(s.revision) }));
    get().commitEntry(entry);
  },

  reorderSelected(delta) {
    const s0 = get();
    const id = s0.doc.selectedLayerIds[0];
    if (!id) return;
    const found = findLayer(s0.doc.layers, id);
    if (!found) return;
    get().moveLayerTo(id, null, found.index + delta);
  },

  updateLayer(id, patch, labelKey, labelFallback) {
    const s0 = get();
    const current = getLayer(s0.doc.layers, id);
    if (!current) return;
    const beforeLayer = current;
    const afterLayer = { ...current, ...patch } as Layer;
    const before = s0.doc.layers;
    const after = replaceLayer(before, afterLayer);
    const entry: Omit<HistoryEntry, 'id' | 'at'> = {
      kind: 'layer-prop',
      labelKey,
      labelFallback,
      bytes: 0,
      undo: () => set((s) => ({ doc: { ...s.doc, layers: replaceLayer(s.doc.layers, beforeLayer) }, revision: bumpRevision(s.revision) })),
      redo: () => set((s) => ({ doc: { ...s.doc, layers: replaceLayer(s.doc.layers, afterLayer) }, revision: bumpRevision(s.revision) })),
    };
    set((s) => ({ doc: { ...s.doc, layers: after, updatedAt: Date.now() }, revision: bumpRevision(s.revision) }));
    if (patchAffectsThumbnail(patch)) bumpLayerPixelVersion(id);
    get().commitEntry(entry);
  },

  updateLayerLive(id, patch) {
    const current = getLayer(get().doc.layers, id);
    if (!current) return;
    const afterLayer = { ...current, ...patch } as Layer;
    set((s) => ({
      doc: { ...s.doc, layers: replaceLayer(s.doc.layers, afterLayer), updatedAt: Date.now() },
      revision: bumpRevision(s.revision),
    }));
    if (patchAffectsThumbnail(patch)) bumpLayerPixelVersion(id);
  },

  beginLayerEdit(id) {
    const layer = getLayer(get().doc.layers, id);
    if (!layer) return;
    // keep the FIRST snapshot of an interaction chain (idempotent per id)
    if (!pendingLiveEdits.has(id)) pendingLiveEdits.set(id, layer);
  },

  endLayerEdit(id, labelKey, labelFallback) {
    const beforeLayer = pendingLiveEdits.get(id);
    pendingLiveEdits.delete(id);
    if (!beforeLayer) return; // no begin captured → nothing to restore
    const afterLayer = getLayer(get().doc.layers, id);
    if (!afterLayer || afterLayer === beforeLayer) return; // deleted / untouched
    if (shallowLayerEqual(beforeLayer, afterLayer)) return; // drag ended where it started
    const entry: Omit<HistoryEntry, 'id' | 'at'> = {
      kind: 'layer-prop',
      labelKey,
      labelFallback,
      bytes: 0,
      undo: () => set2((s) => ({ doc: { ...s.doc, layers: replaceLayer(s.doc.layers, beforeLayer) }, revision: s.revision + 1 })),
      redo: () => set2((s) => ({ doc: { ...s.doc, layers: replaceLayer(s.doc.layers, afterLayer) }, revision: s.revision + 1 })),
    };
    get().commitEntry(entry);
  },

  mergeDown(id) {
    const s0 = get();
    const found = findLayer(s0.doc.layers, id);
    if (!found || found.index === 0) return;
    const below = found.siblings[found.index - 1];
    if (below.kind !== 'raster') return;
    // render both to a canvas via isolated render + composite, replace below, remove id
    import('../engine/render').then(({ renderLayerIsolated }) => {
      const doc0 = get().doc;
      const top = renderLayerIsolated(found.layer, doc0);
      const bottom = renderLayerIsolated(below as RasterLayer, doc0);
      const merged = makeCanvas(doc0.width, doc0.height);
      const mctx = ctx2d(merged);
      mctx.globalAlpha = below.opacity;
      mctx.drawImage(bottom as CanvasImageSource, 0, 0);
      mctx.globalAlpha = found.layer.opacity;
      mctx.drawImage(top as CanvasImageSource, 0, 0);
      mctx.globalAlpha = 1;
      const before = get().doc.layers;
      const beforeSel = get().doc.selectedLayerIds;
      const [withoutTop] = removeLayer(before, id);
      const mergedLayer: RasterLayer = {
        ...(below as RasterLayer),
        canvas: merged,
        opacity: 1,
        blendMode: 'normal',
      };
      const after = replaceLayer(withoutTop, mergedLayer);
      const entry: Omit<HistoryEntry, 'id' | 'at'> = {
        kind: 'structure',
        labelKey: 'history.mergeDown',
        labelFallback: 'Merge down',
        bytes: doc0.width * doc0.height * 4,
        undo: () => set((s) => ({ doc: { ...s.doc, layers: before, selectedLayerIds: beforeSel }, revision: bumpRevision(s.revision) })),
        redo: () => set((s) => ({ doc: { ...s.doc, layers: after, selectedLayerIds: [mergedLayer.id] }, revision: bumpRevision(s.revision) })),
      };
      set((s) => ({ doc: { ...s.doc, layers: after, selectedLayerIds: [mergedLayer.id], updatedAt: Date.now() }, revision: bumpRevision(s.revision) }));
      bumpLayerPixelVersion(mergedLayer.id); // merged content replaced in place (same layer id)
      get().commitEntry(entry);
    });
  },

  mergeVisible() {
    const s0 = get();
    const visible = s0.doc.layers.filter((l) => l.visible);
    if (visible.length < 2) return;
    import('../engine/render').then(({ composeDocument }) => {
      const doc0 = get().doc;
      const composite = composeDocument(doc0);
      const before = get().doc.layers;
      const mergedLayer = createRasterLayer('Merged', doc0.width, doc0.height, composite);
      const after = [mergedLayer];
      const entry: Omit<HistoryEntry, 'id' | 'at'> = {
        kind: 'structure',
        labelKey: 'history.mergeVisible',
        labelFallback: 'Merge visible',
        bytes: doc0.width * doc0.height * 4,
        undo: () => set((s) => ({ doc: { ...s.doc, layers: before }, revision: bumpRevision(s.revision) })),
        redo: () => set((s) => ({ doc: { ...s.doc, layers: after }, revision: bumpRevision(s.revision) })),
      };
      set((s) => ({ doc: { ...s.doc, layers: after, selectedLayerIds: [mergedLayer.id], updatedAt: Date.now() }, revision: bumpRevision(s.revision) }));
      get().commitEntry(entry);
    });
  },

  flattenImage() {
    const s0 = get();
    if (flattenLayers(s0.doc.layers).length < 2 && s0.doc.layers.length < 2) return;
    import('../engine/render').then(({ composeDocument }) => {
      const doc0 = get().doc;
      const composite = composeDocument(doc0);
      const before = get().doc.layers;
      const mergedLayer = createRasterLayer('Background', doc0.width, doc0.height, composite);
      mergedLayer.locked = false;
      const after = [mergedLayer];
      const entry: Omit<HistoryEntry, 'id' | 'at'> = {
        kind: 'structure',
        labelKey: 'history.flatten',
        labelFallback: 'Flatten image',
        bytes: doc0.width * doc0.height * 4,
        undo: () => set((s) => ({ doc: { ...s.doc, layers: before }, revision: bumpRevision(s.revision) })),
        redo: () => set((s) => ({ doc: { ...s.doc, layers: after }, revision: bumpRevision(s.revision) })),
      };
      set((s) => ({ doc: { ...s.doc, layers: after, selectedLayerIds: [mergedLayer.id], updatedAt: Date.now() }, revision: bumpRevision(s.revision) }));
      get().commitEntry(entry);
    });
  },

  rasterizeLayer(id) {
    const s0 = get();
    const layer = getLayer(s0.doc.layers, id);
    if (!layer || layer.kind === 'raster' || layer.kind === 'group') return;
    import('../engine/render').then(({ renderLayerIsolated }) => {
      const doc0 = get().doc;
      const isolated = renderLayerIsolated(layer, doc0);
      get().rasterizeToCanvas(id, isolated);
    });
  },

  rasterizeToCanvas(id, canvas, rect) {
    const s0 = get();
    const layer = getLayer(s0.doc.layers, id);
    if (!layer) return;
    const beforeLayer = layer;
    const afterLayer: RasterLayer = {
      id: layer.id,
      name: layer.name,
      kind: 'raster',
      visible: layer.visible,
      locked: false,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      x: 0,
      y: 0,
      clipToBelow: layer.clipToBelow,
      mask: null,
      filters: [],
      canvas,
    };
    void rect;
    const before = s0.doc.layers;
    const after = replaceLayer(before, afterLayer);
    const entry: Omit<HistoryEntry, 'id' | 'at'> = {
      kind: 'structure',
      labelKey: 'history.rasterize',
      labelFallback: 'Rasterize layer',
      bytes: canvas.width * canvas.height * 4,
      undo: () => set((s) => ({ doc: { ...s.doc, layers: replaceLayer(s.doc.layers, beforeLayer) }, revision: bumpRevision(s.revision) })),
      redo: () => set((s) => ({ doc: { ...s.doc, layers: replaceLayer(s.doc.layers, afterLayer) }, revision: bumpRevision(s.revision) })),
    };
    set((s) => ({ doc: { ...s.doc, layers: after, updatedAt: Date.now() }, revision: bumpRevision(s.revision) }));
    bumpLayerPixelVersion(id); // rasterized content replaced (same layer id)
    get().commitEntry(entry);
  },

  addMask(layerId, fromSelection) {
    const s0 = get();
    const layer = getLayer(s0.doc.layers, layerId);
    if (!layer || layer.mask) return;
    const size = layer.kind === 'raster' ? { w: (layer as RasterLayer).canvas.width, h: (layer as RasterLayer).canvas.height } : { w: s0.doc.width, h: s0.doc.height };
    const canvas = makeCanvas(size.w, size.h);
    const ctx = ctx2d(canvas);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.w, size.h);
    if (fromSelection && s0.selection) {
      // paint selection coverage in black (hide outside selection)
      ctx.fillStyle = '#000000';
      ctx.globalCompositeOperation = 'source-over';
      const img = ctx.getImageData(0, 0, size.w, size.h);
      const sel = s0.selection;
      for (let y = 0; y < Math.min(size.h, sel.height); y++) {
        for (let x = 0; x < Math.min(size.w, sel.width); x++) {
          const cov = sel.mask[y * sel.width + x] / 255;
          if (cov > 0) {
            const o = (y * size.w + x) * 4;
            img.data[o] = img.data[o] * (1 - cov);
            img.data[o + 1] = img.data[o + 1] * (1 - cov);
            img.data[o + 2] = img.data[o + 2] * (1 - cov);
          }
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    get().updateLayer(layerId, { mask: { id: genId('mask'), enabled: true, inverted: false, canvas } }, 'history.addMask', 'Add layer mask');
  },

  updateMask(layerId, patch) {
    const s0 = get();
    const layer = getLayer(s0.doc.layers, layerId);
    if (!layer || !layer.mask) return;
    get().updateLayer(layerId, { mask: { ...layer.mask, ...patch } }, 'history.updateMask', 'Update mask');
  },

  applyMask(layerId) {
    const s0 = get();
    const layer = getLayer(s0.doc.layers, layerId);
    if (!layer || !layer.mask || layer.kind !== 'raster') return;
    import('../engine/render').then(({ renderLayerIsolated }) => {
      const doc0 = get().doc;
      const rendered = renderLayerIsolated(layer, doc0);
      const data = imageDataFromCanvas(rendered);
      // bake: keep alpha where mask white
      const maskData = imageDataFromCanvas((layer as RasterLayer).mask!.canvas);
      const out = makeCanvas(doc0.width, doc0.height);
      const octx = ctx2d(out);
      octx.putImageData(data, 0, 0);
      octx.globalCompositeOperation = 'destination-in';
      octx.drawImage(imageDataToCanvas(maskData), 0, 0);
      get().rasterizeToCanvas(layerId, out);
    });
  },

  deleteMask(layerId) {
    const s0 = get();
    const layer = getLayer(s0.doc.layers, layerId);
    if (!layer || !layer.mask) return;
    get().updateLayer(layerId, { mask: null }, 'history.deleteMask', 'Delete mask');
  },

  getActiveLayer() {
    const s = get();
    return s.doc.selectedLayerIds.length > 0 ? getLayer(s.doc.layers, s.doc.selectedLayerIds[0]) : null;
  },

  getActiveRasterLayer() {
    const layer = get().getActiveLayer();
    return layer && layer.kind === 'raster' && !layer.locked ? (layer as RasterLayer) : null;
  },

  /* ------------------------ pixel edits ------------------------ */

  commitPixelEdit(layerId, before, after, labelKey, labelFallback) {
    const s0 = get();
    const layer = getLayer(s0.doc.layers, layerId);
    if (!layer || layer.kind !== 'raster') return;
    // compute diff bounds
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const w = before.width;
    const h = before.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (
          before.data[o] !== after.data[o] ||
          before.data[o + 1] !== after.data[o + 1] ||
          before.data[o + 2] !== after.data[o + 2] ||
          before.data[o + 3] !== after.data[o + 3]
        ) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) return; // no change — no history entry
    const rect = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    const beforeRegion = getRegion(imageDataToCanvas(before), rect.x, rect.y, rect.w, rect.h);
    const afterRegion = getRegion(imageDataToCanvas(after), rect.x, rect.y, rect.w, rect.h);
    const bytes = rect.w * rect.h * 4 * 2;
    const entry: Omit<HistoryEntry, 'id' | 'at'> = {
      kind: 'pixel',
      labelKey,
      labelFallback,
      bytes,
      undo: () => {
        applyRegionToLayer(get, layerId, beforeRegion, rect);
      },
      redo: () => {
        applyRegionToLayer(get, layerId, afterRegion, rect);
      },
    };
    get().commitEntry(entry);
    bumpLayerPixelVersion(layerId); // layer pixels changed in place → refresh its thumbnail
    // The caller (filter dialog, retouch commit, …) already wrote the new
    // pixels into the layer canvas — bump the revision so the viewport
    // composite rebuilds immediately. Without this the display keeps
    // showing the pre-edit composite until some other revision bump.
    useEditorStore.setState((st) => ({ revision: st.revision + 1 }));
  },

  /* ------------------------- selection ------------------------- */

  setSelection(sel, mode = 'replace') {
    const next = combineSelections(get().selection, sel, mode);
    set({ selection: next });
  },

  selectAll() {
    const d = get().doc;
    const sel = rectSelection(0, 0, d.width, d.height, d.width, d.height);
    set({ selection: sel });
  },

  deselect() {
    set({ selection: null });
  },

  invertSelectionAction() {
    const sel = get().selection;
    if (!sel) return;
    set({ selection: invertSelection(sel) });
  },

  featherSelectionAction(radius) {
    const sel = get().selection;
    if (!sel) return;
    set({ selection: featherSelection(sel, radius) });
  },

  growSelectionAction(px) {
    const sel = get().selection;
    if (!sel) return;
    set({ selection: growSelection(sel, px) });
  },

  contractSelectionAction(px) {
    const sel = get().selection;
    if (!sel) return;
    set({ selection: contractSelection(sel, px) });
  },

  borderSelectionAction(px) {
    const sel = get().selection;
    if (!sel) return;
    set({ selection: borderSelection(sel, px) });
  },

  rectSelectionAction(x, y, w, h, mode) {
    const d = get().doc;
    const sel = rectSelection(x, y, w, h, d.width, d.height);
    get().setSelection(sel, mode ?? get().toolOptions.marquee.mode);
  },

  ellipseSelectionAction(x, y, w, h, mode) {
    const d = get().doc;
    const sel = ellipseSelection(x, y, w, h, d.width, d.height);
    get().setSelection(sel, mode ?? get().toolOptions.marquee.mode);
  },

  /* --------------------------- view ---------------------------- */

  setView(patch) {
    set((s) => ({ view: { ...s.view, ...patch } }));
  },

  zoomBy(factor, centerX, centerY) {
    const s = get();
    const newZoom = Math.min(32, Math.max(0.01, s.view.zoom * factor));
    // keep point under cursor stable
    if (centerX != null && centerY != null) {
      const k = newZoom / s.view.zoom;
      const panX = centerX - (centerX - s.view.panX) * k;
      const panY = centerY - (centerY - s.view.panY) * k;
      set({ view: { ...s.view, zoom: newZoom, panX, panY } });
    } else {
      set({ view: { ...s.view, zoom: newZoom } });
    }
  },

  setZoom(z) {
    set((s) => ({ view: { ...s.view, zoom: Math.min(32, Math.max(0.01, z)) } }));
  },

  fitToScreen(vw, vh) {
    const d = get().doc;
    const zoom = Math.min((vw * 0.9) / d.width, (vh * 0.9) / d.height);
    set({ view: { ...get().view, zoom, panX: (vw - d.width * zoom) / 2, panY: (vh - d.height * zoom) / 2 } });
  },

  /* -------------------------- colors --------------------------- */

  setFgColor(c) {
    set({ fgColor: c });
  },
  setBgColor(c) {
    set({ bgColor: c });
  },
  swapColors() {
    set((s) => ({ fgColor: s.bgColor, bgColor: s.fgColor }));
  },
  addSwatch(c) {
    set((s) => (s.swatches.includes(c) ? s : { swatches: [...s.swatches, c].slice(-40) }));
  },
  removeSwatch(c) {
    set((s) => ({ swatches: s.swatches.filter((x) => x !== c) }));
  },

  /* ------------------------- history --------------------------- */

  undo() {
    pendingLiveEdits.clear(); // a live drag must not capture a rewound state
    const s = get();
    const next = historyUndo(s.history);
    set({ history: next, revision: bumpRevision(s.revision) });
    bumpAllLayerPixels(get().doc.layers); // undo may revert pixels/params on any layer
  },

  redo() {
    pendingLiveEdits.clear();
    const s = get();
    const next = historyRedo(s.history);
    set({ history: next, revision: bumpRevision(s.revision) });
    bumpAllLayerPixels(get().doc.layers);
  },

  jumpHistory(index) {
    pendingLiveEdits.clear();
    const s = get();
    const next = jumpTo(s.history, index);
    set({ history: next, revision: bumpRevision(s.revision) });
    bumpAllLayerPixels(get().doc.layers);
  },

  commitEntry(entry) {
    const s = get();
    const full: HistoryEntry = { ...entry, id: genId('h'), at: Date.now() };
    set({ history: pushEntry(s.history, full) });
  },

  /* -------------------------- guides --------------------------- */

  addGuide(axis, position) {
    set((s) => ({
      doc: { ...s.doc, guides: [...s.doc.guides, { id: genId('g'), axis, position }], updatedAt: Date.now() },
      revision: bumpRevision(s.revision),
    }));
  },

  removeGuide(id) {
    set((s) => ({
      doc: { ...s.doc, guides: s.doc.guides.filter((g) => g.id !== id), updatedAt: Date.now() },
      revision: bumpRevision(s.revision),
    }));
  },

  clearGuides() {
    set((s) => ({ doc: { ...s.doc, guides: [], updatedAt: Date.now() }, revision: bumpRevision(s.revision) }));
  },

  /* ------------------------ document ops ----------------------- */

  resizeImage(width, height, smooth) {
    const s0 = get();
    const before = s0.doc;
    void smooth;
    import('../engine/transforms').then(({ scaleLayers }) => {
      const layers = scaleLayers(before.layers, before.width, before.height, width, height);
      const after: DocumentState = { ...before, width, height, layers, updatedAt: Date.now() };
      const entry: Omit<HistoryEntry, 'id' | 'at'> = {
        kind: 'document',
        labelKey: 'history.imageSize',
        labelFallback: 'Image size',
        bytes: 0,
        undo: () => set((s) => ({ doc: before, docs: swapDoc(s.docs, before), revision: bumpRevision(s.revision) })),
        redo: () => set((s) => ({ doc: after, docs: swapDoc(s.docs, after), revision: bumpRevision(s.revision) })),
      };
      set((s) => ({ doc: after, docs: swapDoc(s.docs, after), selection: null, revision: bumpRevision(s.revision) }));
      bumpAllLayerPixels(after.layers); // layer canvases were replaced (ids persist)
      get().commitEntry(entry);
    });
  },

  resizeCanvas(width, height, anchor) {
    const s0 = get();
    const before = s0.doc;
    const dx = anchor === 'center' ? Math.round((width - before.width) / 2) : 0;
    const dy = anchor === 'center' ? Math.round((height - before.height) / 2) : 0;
    const shiftLayers = (arr: Layer[]): Layer[] => arr.map((l) => shiftLayerContent(l, dx, dy));
    const after: DocumentState = {
      ...before,
      width,
      height,
      layers: shiftLayers(before.layers),
      guides: before.guides.map((g) => ({ ...g, position: g.position + (g.axis === 'x' ? dx : dy) })),
      updatedAt: Date.now(),
    };
    const entry: Omit<HistoryEntry, 'id' | 'at'> = {
      kind: 'document',
      labelKey: 'history.canvasSize',
      labelFallback: 'Canvas size',
      bytes: 0,
      undo: () => set((s) => ({ doc: before, docs: swapDoc(s.docs, before), revision: bumpRevision(s.revision) })),
      redo: () => set((s) => ({ doc: after, docs: swapDoc(s.docs, after), revision: bumpRevision(s.revision) })),
    };
    set((s) => ({ doc: after, docs: swapDoc(s.docs, after), selection: null, revision: bumpRevision(s.revision) }));
    bumpAllLayerPixels(after.layers); // layer content shifted (ids persist)
    get().commitEntry(entry);
  },

  cropTo(rect) {
    const s0 = get();
    const before = s0.doc;
    const r = clipRectToCanvas(rect, before.width, before.height);
    if (!r) return;
    const after: DocumentState = {
      ...before,
      width: r.w,
      height: r.h,
      layers: before.layers.map((l) => shiftLayerContent(l, -r.x, -r.y)),
      updatedAt: Date.now(),
    };
    const entry: Omit<HistoryEntry, 'id' | 'at'> = {
      kind: 'document',
      labelKey: 'history.crop',
      labelFallback: 'Crop',
      bytes: 0,
      undo: () => set((s) => ({ doc: before, docs: swapDoc(s.docs, before), selection: null, revision: bumpRevision(s.revision) })),
      redo: () => set((s) => ({ doc: after, docs: swapDoc(s.docs, after), selection: null, revision: bumpRevision(s.revision) })),
    };
    set((s) => ({ doc: after, docs: swapDoc(s.docs, after), selection: null, revision: bumpRevision(s.revision) }));
    bumpAllLayerPixels(after.layers); // layer content cropped/shifted (ids persist)
    get().commitEntry(entry);
  },

  flipDocument(axis) {
    const s0 = get();
    const before = s0.doc;
    import('../engine/transforms').then(({ flipLayers }) => {
      const layers = flipLayers(before.layers, before.width, before.height, axis);
      const after: DocumentState = { ...before, layers, updatedAt: Date.now() };
      const entry: Omit<HistoryEntry, 'id' | 'at'> = {
        kind: 'document',
        labelKey: axis === 'x' ? 'history.flipHorizontal' : 'history.flipVertical',
        labelFallback: axis === 'x' ? 'Flip horizontal' : 'Flip vertical',
        bytes: 0,
        undo: () => set((s) => ({ doc: before, docs: swapDoc(s.docs, before), revision: bumpRevision(s.revision) })),
        redo: () => set((s) => ({ doc: after, docs: swapDoc(s.docs, after), revision: bumpRevision(s.revision) })),
      };
      set((s) => ({ doc: after, docs: swapDoc(s.docs, after), revision: bumpRevision(s.revision) }));
      bumpAllLayerPixels(after.layers); // layer canvases were replaced (ids persist)
      get().commitEntry(entry);
    });
  },

  rotateDocument90(clockwise) {
    const s0 = get();
    const before = s0.doc;
    import('../engine/transforms').then(({ rotateLayers90 }) => {
      const { layers, width, height } = rotateLayers90(before.layers, before.width, before.height, clockwise);
      const after: DocumentState = { ...before, layers, width, height, updatedAt: Date.now() };
      const entry: Omit<HistoryEntry, 'id' | 'at'> = {
        kind: 'document',
        labelKey: 'history.rotate90',
        labelFallback: 'Rotate 90°',
        bytes: 0,
        undo: () => set((s) => ({ doc: before, docs: swapDoc(s.docs, before), selection: null, revision: bumpRevision(s.revision) })),
        redo: () => set((s) => ({ doc: after, docs: swapDoc(s.docs, after), selection: null, revision: bumpRevision(s.revision) })),
      };
      set((s) => ({ doc: after, docs: swapDoc(s.docs, after), selection: null, revision: bumpRevision(s.revision) }));
      bumpAllLayerPixels(after.layers); // layer canvases were replaced (ids persist)
      get().commitEntry(entry);
    });
  },

  /* ------------------------- tools & ui ------------------------ */

  setTool(t) {
    set({ tool: t });
  },

  updateToolOptions(tool, patch) {
    set((s) => ({
      toolOptions: {
        ...s.toolOptions,
        [tool]: { ...(s.toolOptions[tool] as Record<string, unknown>), ...(patch as Record<string, unknown>) } as ToolOptions[typeof tool],
      },
    }));
  },

  setDialog(d) {
    set((s) => ({ ui: { ...s.ui, dialog: d } }));
  },

  setRightPanel(p) {
    set((s) => ({ ui: { ...s.ui, rightPanel: p } }));
  },

  togglePanels() {
    set((s) => ({ ui: { ...s.ui, panelsVisible: !s.ui.panelsVisible } }));
  },

  setMobilePanel(p) {
    set((s) => ({ ui: { ...s.ui, mobilePanel: p } }));
  },

  setMobileToolbarSheet(open) {
    set((s) => ({ ui: { ...s.ui, mobileToolbarSheet: open } }));
  },

  setFilterDialog(state) {
    set((s) => ({ extras: { ...s.extras, filterDialog: { ...s.extras.filterDialog, ...state } } }));
  },

  setJobProgress(p) {
    set((s) => ({ extras: { ...s.extras, jobProgress: p } }));
  },

  setBeforeAfter(v) {
    set((s) => ({ ui: { ...s.ui, beforeAfter: v } }));
  },

  setSplitView(v) {
    set((s) => ({ ui: { ...s.ui, splitView: v } }));
  },

  markSaved(fingerprint) {
    set((s) => ({ extras: { ...s.extras, savedFingerprint: fingerprint } }));
  },

  updateSettings(patch) {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
  },

  setStorageInfo(info) {
    set((s) => ({ ui: { ...s.ui, storageInfo: info } }));
  },
}));

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Pre-drag snapshots for live slider edits (beginLayerEdit/updateLayerLive/
 * endLayerEdit). Module-level on purpose: never rendered, never serialized.
 */
const pendingLiveEdits = new Map<string, Layer>();

/** Patch keys that never change what a layer thumbnail renders. */
const THUMB_INVARIANT_PATCH_KEYS = new Set([
  'visible', 'opacity', 'blendMode', 'locked', 'expanded', 'name',
  'clipToBelow', 'mask', 'filters', 'adjustment',
]);

function patchAffectsThumbnail(patch: Partial<Layer>): boolean {
  for (const key of Object.keys(patch)) {
    if (!THUMB_INVARIANT_PATCH_KEYS.has(key)) return true;
  }
  return false;
}

/** Shallow equality across the union of both layers' own keys. */
function shallowLayerEqual(a: Layer, b: Layer): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!Object.is(a[key as keyof Layer], b[key as keyof Layer])) return false;
  }
  return true;
}

function bumpAllLayerPixels(layers: Layer[]): void {
  const ids: string[] = [];
  const walk = (arr: Layer[]): void => {
    for (const l of arr) {
      ids.push(l.id);
      if (l.kind === 'group') walk(l.children);
    }
  };
  walk(layers);
  bumpLayerPixelVersions(ids);
}

function swapDoc(docs: DocumentState[], doc: DocumentState): DocumentState[] {
  return docs.map((d) => (d.id === doc.id ? doc : d));
}

function countLayers(layers: Layer[]): number {
  let n = 0;
  for (const l of layers) {
    n++;
    if (l.kind === 'group') n += countLayers(l.children);
  }
  return n;
}

function adjustmentName(spec: AdjustmentSpec): string {
  const map: Record<AdjustmentSpec['type'], string> = {
    'brightness-contrast': 'Brightness/Contrast',
    exposure: 'Exposure',
    'hue-saturation': 'Hue/Saturation',
    vibrance: 'Vibrance',
    temperature: 'Color Balance',
    invert: 'Invert',
    grayscale: 'Black & White',
    sepia: 'Sepia',
    posterize: 'Posterize',
    threshold: 'Threshold',
    gamma: 'Gamma',
    levels: 'Levels',
  };
  return map[spec.type];
}

/**
 * Structural history helper: captures layer-array references before/after.
 * Call `after(get)` once the mutation has been applied.
 */
function makeStructuralEntry(
  get: () => EditorStore,
  _key: string,
  labelKey: string,
  labelFallback: string,
): { after: (get2: () => EditorStore) => void; commit: Omit<HistoryEntry, 'id' | 'at'> } {
  const before = get().doc.layers;
  const beforeSel = get().doc.selectedLayerIds;
  let afterLayers: Layer[] | null = null;
  let afterSel: string[] = [];
  return {
    after(get2) {
      afterLayers = get2().doc.layers;
      afterSel = get2().doc.selectedLayerIds;
    },
    commit: {
      kind: 'structure',
      labelKey,
      labelFallback,
      bytes: 0,
      undo: () =>
        set2((s) => ({
          doc: { ...s.doc, layers: before, selectedLayerIds: beforeSel },
          revision: s.revision + 1,
        })),
      redo: () =>
        set2((s) => ({
          doc: { ...s.doc, layers: afterLayers ?? s.doc.layers, selectedLayerIds: afterSel.length ? afterSel : s.doc.selectedLayerIds },
          revision: s.revision + 1,
        })),
    },
  };
}

/* direct setter access for history closures (outside React render) */
function set2(fn: (s: EditorStore) => Partial<EditorStore>): void {
  useEditorStore.setState(fn as never);
}

function layerBaseFor(layer: Layer): Partial<RasterLayer> {
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    clipToBelow: layer.clipToBelow,
    mask: layer.mask ?? null,
    filters: layer.filters ?? [],
  };
}

function imageDataToCanvas(data: ImageData): HTMLCanvasElement | OffscreenCanvas {
  const c = makeCanvas(data.width, data.height);
  ctx2d(c).putImageData(data, 0, 0);
  return c;
}

function applyRegionToLayer(get: () => EditorStore, layerId: string, region: ImageData, rect: { x: number; y: number; w: number; h: number }): void {
  const s = get();
  const layer = getLayer(s.doc.layers, layerId);
  if (!layer || layer.kind !== 'raster') return;
  putRegion((layer as RasterLayer).canvas, region, rect.x, rect.y);
  useEditorStore.setState((st) => ({ revision: st.revision + 1 }));
}

export function currentDocFingerprint(): string {
  const s = useEditorStore.getState();
  return `${s.doc.id}:${s.revision}`;
}
