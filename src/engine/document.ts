/**
 * Document model operations — creation, layer factories, tree manipulation.
 *
 * Functions here are PURE with respect to pixel buffers unless documented:
 * they mutate/replace metadata structures and never touch pixel content
 * except where an explicit copy is documented (e.g. duplicateLayer).
 * The store is responsible for wrapping calls in history commands.
 */

import type {
  AdjustmentSpec,
  AdjustmentLayer,
  DocumentState,
  FillLayer,
  GroupLayer,
  Layer,
  LayerBase,
  Paint,
  RasterLayer,
  ShapeGeometry,
  ShapeLayer,
  TextContent,
  TextLayer,
  BackgroundType,
} from './types';
import { cloneCanvas, makeCanvas, ctx2d, type AnyCanvas } from './raster';

export const APP_VERSION = '1.0.0';

/* ------------------------------ ids ------------------------------ */

let idCounter = 0;
export function genId(prefix = 'l'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* --------------------------- factories --------------------------- */

export function createDocument(opts: {
  name?: string;
  width: number;
  height: number;
  background?: BackgroundType;
  customBackground?: string;
  dpi?: number;
  withBackgroundLayer?: boolean;
}): DocumentState {
  const now = Date.now();
  const doc: DocumentState = {
    id: genId('doc'),
    name: opts.name ?? 'Untitled',
    width: opts.width,
    height: opts.height,
    dpi: opts.dpi ?? 72,
    colorMode: 'rgb-8bit',
    background: opts.background ?? 'white',
    customBackground: opts.customBackground,
    layers: [],
    selectedLayerIds: [],
    guides: [],
    description: '',
    createdAt: now,
    updatedAt: now,
  };
  if (opts.withBackgroundLayer !== false && opts.background !== 'transparent') {
    doc.layers.push(makeBackgroundLayer(doc.width, doc.height, opts.background ?? 'white', opts.customBackground));
  }
  doc.layers.push(createRasterLayer('Layer 1', doc.width, doc.height));
  doc.selectedLayerIds = [doc.layers[doc.layers.length - 1].id];
  return doc;
}

export function makeBackgroundLayer(
  width: number,
  height: number,
  bg: BackgroundType,
  custom?: string,
): RasterLayer {
  const canvas = makeCanvas(width, height);
  const ctx = ctx2d(canvas);
  ctx.fillStyle =
    bg === 'white' ? '#ffffff' : bg === 'black' ? '#000000' : custom ?? '#ffffff';
  ctx.fillRect(0, 0, width, height);
  return {
    ...layerBase('Background', 'raster'),
    kind: 'raster',
    canvas,
    locked: true,
    x: 0,
    y: 0,
  };
}

export function layerBase(name: string, kind: Layer['kind']): Omit<LayerBase, 'kind'> & { kind: Layer['kind'] } {
  return {
    id: genId(),
    name,
    kind,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    clipToBelow: false,
    mask: null,
    filters: [],
  };
}

export function createRasterLayer(name: string, width: number, height: number, canvas?: AnyCanvas): RasterLayer {
  return {
    ...layerBase(name, 'raster'),
    kind: 'raster',
    canvas: canvas ?? makeCanvas(width, height),
  } as RasterLayer;
}

export function defaultTextContent(overrides?: Partial<TextContent>): TextContent {
  return {
    text: 'Text',
    fontFamily: 'Arial, sans-serif',
    fontSize: 48,
    fontWeight: 400,
    italic: false,
    underline: false,
    align: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#000000',
    x: 40,
    y: 60,
    boxWidth: 0,
    ...overrides,
  };
}

export function createTextLayer(name: string, content: Partial<TextContent> = {}): TextLayer {
  return { ...layerBase(name, 'text'), kind: 'text', text: defaultTextContent(content) } as TextLayer;
}

export function createShapeLayer(
  name: string,
  shape: ShapeGeometry,
  fill: Paint | null,
  stroke: ShapeLayer['stroke'],
  bbox: { x: number; y: number; w: number; h: number },
): ShapeLayer {
  return { ...layerBase(name, 'shape'), kind: 'shape', shape, fill, stroke, bbox } as ShapeLayer;
}

export function createAdjustmentLayer(name: string, adjustment: AdjustmentSpec): AdjustmentLayer {
  return { ...layerBase(name, 'adjustment'), kind: 'adjustment', adjustment, blendMode: 'normal' } as AdjustmentLayer;
}

export function createFillLayer(name: string, paint: Paint): FillLayer {
  return { ...layerBase(name, 'fill'), kind: 'fill', paint } as FillLayer;
}

export function createGroupLayer(name: string, children: Layer[] = []): GroupLayer {
  return { ...layerBase(name, 'group'), kind: 'group', children, expanded: true } as GroupLayer;
}

/* ------------------------- tree utilities ------------------------- */

/** Depth-first search for a layer by id. Returns [layer, parentChildren] or null. */
export function findLayer(
  layers: Layer[],
  id: string,
): { layer: Layer; siblings: Layer[]; index: number } | null {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (l.id === id) return { layer: l, siblings: layers, index: i };
    if (l.kind === 'group') {
      const found = findLayer(l.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function getLayer(layers: Layer[], id: string): Layer | null {
  return findLayer(layers, id)?.layer ?? null;
}

/** Replaces a layer (matched by id) anywhere in the tree; returns new tree. */
export function replaceLayer(layers: Layer[], next: Layer): Layer[] {
  return layers.map((l) => {
    if (l.id === next.id) return next;
    if (l.kind === 'group') {
      const children = replaceLayer(l.children, next);
      return children === l.children ? l : { ...l, children };
    }
    return l;
  });
}

/** Removes a layer by id; returns [newTree, removedLayer]. */
export function removeLayer(layers: Layer[], id: string): [Layer[], Layer | null] {
  let removed: Layer | null = null;
  const walk = (arr: Layer[]): Layer[] => {
    const out: Layer[] = [];
    for (const l of arr) {
      if (l.id === id) {
        removed = l;
        continue;
      }
      out.push(l.kind === 'group' ? { ...l, children: walk(l.children) } : l);
    }
    return out;
  };
  return [walk(layers), removed];
}

/** Inserts layer into the direct children of parent (or root) at given index. */
export function insertLayer(
  layers: Layer[],
  layer: Layer,
  parentId: string | null,
  index: number,
): Layer[] {
  if (parentId == null) {
    const out = [...layers];
    out.splice(clampIndex(index, out.length), 0, layer);
    return out;
  }
  return layers.map((l) => {
    if (l.id === parentId && l.kind === 'group') {
      const children = [...l.children];
      children.splice(clampIndex(index, children.length), 0, layer);
      return { ...l, children };
    }
    return l.kind === 'group' ? { ...l, children: insertLayer(l.children, layer, parentId, index) } : l;
  });
}

function clampIndex(i: number, len: number): number {
  return Math.max(0, Math.min(i, len));
}

/** Moves a layer within the whole tree (removes, then inserts at target). */
export function moveLayer(
  layers: Layer[],
  id: string,
  newParentId: string | null,
  newIndex: number,
): Layer[] {
  const [without, layer] = removeLayer(layers, id);
  if (!layer) return layers;
  return insertLayer(without, layer, newParentId, newIndex);
}

/** Deep-clone metadata; pixel buffers are duplicated so edits diverge. */
export function duplicateLayer(layer: Layer, nameSuffix = ' copy'): Layer {
  const base = {
    ...layer,
    id: genId(),
    name: `${layer.name}${nameSuffix}`,
  };
  switch (layer.kind) {
    case 'raster':
      return { ...(base as RasterLayer), canvas: cloneCanvas(layer.canvas), mask: layer.mask ? { ...layer.mask, id: genId(), canvas: cloneCanvas(layer.mask.canvas) } : null };
    case 'text':
      return { ...(base as TextLayer), text: { ...layer.text } };
    case 'shape':
      return { ...(base as ShapeLayer), shape: cloneGeometry(layer.shape), bbox: { ...layer.bbox } };
    case 'fill':
      return { ...(base as FillLayer), paint: clonePaint(layer.paint) };
    case 'adjustment':
      return { ...(base as AdjustmentLayer), adjustment: { ...layer.adjustment } };
    case 'group':
      return { ...(base as GroupLayer), children: layer.children.map((c) => duplicateLayer(c, '')), expanded: layer.expanded };
  }
}

export function cloneGeometry(g: ShapeGeometry): ShapeGeometry {
  switch (g.type) {
    case 'rect':
    case 'ellipse':
      return { ...g };
    case 'line':
      return { ...g };
    case 'polygon':
    case 'star':
      return { ...g };
    case 'path':
      return {
        type: 'path',
        subpaths: g.subpaths.map((sp) => ({ closed: sp.closed, commands: sp.commands.map((c) => ({ ...c })) })),
      };
  }
}

export function clonePaint(p: Paint): Paint {
  if (p.type === 'solid') return { ...p };
  return { ...p, stops: p.stops.map((s) => ({ ...s })) };
}

/* --------------------------- flattening --------------------------- */

export function flattenLayers(layers: Layer[]): Layer[] {
  const out: Layer[] = [];
  const walk = (arr: Layer[]) => {
    for (const l of arr) {
      if (l.kind === 'group') walk(l.children);
      else out.push(l);
    }
  };
  walk(layers);
  return out;
}

export function countLayers(layers: Layer[]): number {
  let n = 0;
  const walk = (arr: Layer[]) => {
    for (const l of arr) {
      n++;
      if (l.kind === 'group') walk(l.children);
    }
  };
  walk(layers);
  return n;
}

export function isLayerEditable(layer: Layer | null): boolean {
  if (!layer) return false;
  if (!layer.visible || layer.locked) return false;
  return layer.kind === 'raster' || layer.kind === 'text' || layer.kind === 'shape' || layer.kind === 'fill';
}

/** Collects ids of all raster layers in the tree (top-first). */
export function rasterLayerIds(layers: Layer[]): string[] {
  const out: string[] = [];
  const walk = (arr: Layer[]) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      const l = arr[i];
      if (l.kind === 'raster') out.push(l.id);
      else if (l.kind === 'group') walk(l.children);
    }
  };
  walk(layers);
  return out;
}

/* --------------------------- transforms --------------------------- */

export interface AffineTransform {
  /** 2x3 matrix [a c e; b d f] */
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: AffineTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function multiply(m1: AffineTransform, m2: AffineTransform): AffineTransform {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function translation(tx: number, ty: number): AffineTransform {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

export function scaling(sx: number, sy: number): AffineTransform {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

export function rotation(rad: number): AffineTransform {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function applyPoint(m: AffineTransform, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/* --------------------------- shape utils --------------------------- */

export function shapeBBox(g: ShapeGeometry): { x: number; y: number; w: number; h: number } {
  switch (g.type) {
    case 'rect':
      return { x: g.x, y: g.y, w: g.w, h: g.h };
    case 'ellipse':
      return { x: g.x, y: g.y, w: g.w, h: g.h };
    case 'line':
      return {
        x: Math.min(g.x1, g.x2),
        y: Math.min(g.y1, g.y2),
        w: Math.abs(g.x2 - g.x1),
        h: Math.abs(g.y2 - g.y1),
      };
    case 'polygon':
      return { x: g.cx - g.radius, y: g.cy - g.radius, w: g.radius * 2, h: g.radius * 2 };
    case 'star':
      return { x: g.cx - g.outer, y: g.cy - g.outer, w: g.outer * 2, h: g.outer * 2 };
    case 'path': {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const sp of g.subpaths) {
        for (const c of sp.commands) {
          if (c.c === 'Z') continue;
          minX = Math.min(minX, c.x);
          minY = Math.min(minY, c.y);
          maxX = Math.max(maxX, c.x);
          maxY = Math.max(maxY, c.y);
        }
      }
      if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }
}

