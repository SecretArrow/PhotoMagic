/**
 * Native project format (.pfs) — versioned, schema-validated serializer.
 *
 * Format: JSON with embedded PNG data URLs for raster/mask buffers.
 * Version 1 keeps everything self-contained so files are portable and can
 * be inspected. Validation rejects malformed or unsafe payloads.
 *
 * Limitations (documented in docs/COMPATIBILITY.md):
 *  - binary size is larger than zip-based formats (acceptable for v1)
 *  - editing history is not embedded (only the current document state)
 */

import type {
  AdjustmentLayer,
  AdjustmentSpec,
  DocumentState,
  FillLayer,
  GroupLayer,
  Layer,
  Paint,
  RasterLayer,
  ShapeGeometry,
  ShapeLayer,
  SmartFilter,
  StrokeStyle,
  TextContent,
  TextLayer,
} from '../engine/types';
import { imageDataFromCanvas, makeCanvas, ctx2d, type AnyCanvas } from '../engine/raster';
import { createDocument } from '../engine/document';
import type { ProjectFile } from '../engine/types';

export const PROJECT_FORMAT = 'pixelforge-studio';
export const PROJECT_VERSION = 1;
const MAX_PROJECT_BYTES = 512 * 1024 * 1024; // 512 MB safety limit

/* --------------------------- encode --------------------------- */

async function canvasToDataUrl(canvas: AnyCanvas): Promise<string> {
  const c = makeCanvas(canvas.width, canvas.height);
  ctx2d(c).drawImage(canvas as CanvasImageSource, 0, 0);
  if (typeof (c as HTMLCanvasElement).toDataURL === 'function') {
    return (c as HTMLCanvasElement).toDataURL('image/png');
  }
  const blob = await (c as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  return await blobToDataUrl(blob);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

async function encodePaint(p: Paint): Promise<Paint> {
  if (p.type === 'solid') return { ...p };
  return { ...p, stops: p.stops.map((s) => ({ ...s })) };
}

async function encodeLayer(layer: Layer): Promise<unknown> {
  const base = {
    id: layer.id,
    name: layer.name,
    kind: layer.kind,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    x: layer.x,
    y: layer.y,
    clipToBelow: layer.clipToBelow,
    filters: layer.filters ?? [],
    mask: layer.mask
      ? { id: layer.mask.id, enabled: layer.mask.enabled, inverted: layer.mask.inverted, png: await canvasToDataUrl(layer.mask.canvas) }
      : null,
  };
  switch (layer.kind) {
    case 'raster': {
      const r = layer as RasterLayer;
      return { ...base, kind: 'raster', png: await canvasToDataUrl(r.canvas), width: r.canvas.width, height: r.canvas.height };
    }
    case 'text': {
      const t = layer as TextLayer;
      return { ...base, kind: 'text', text: { ...t.text } };
    }
    case 'shape': {
      const s = layer as ShapeLayer;
      return { ...base, kind: 'shape', shape: s.shape, fill: s.fill ? await encodePaint(s.fill) : null, stroke: s.stroke, bbox: s.bbox };
    }
    case 'fill': {
      const f = layer as FillLayer;
      return { ...base, kind: 'fill', paint: await encodePaint(f.paint) };
    }
    case 'adjustment': {
      const a = layer as AdjustmentLayer;
      return { ...base, kind: 'adjustment', adjustment: a.adjustment };
    }
    case 'group': {
      const g = layer as GroupLayer;
      return { ...base, kind: 'group', expanded: g.expanded, children: await Promise.all(g.children.map(encodeLayer)) };
    }
  }
}

export async function saveProject(doc: DocumentState, appVersion: string): Promise<Blob> {
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    document: {
      name: doc.name,
      width: doc.width,
      height: doc.height,
      dpi: doc.dpi,
      background: doc.background,
      customBackground: doc.customBackground,
      description: doc.description,
      guides: doc.guides.map((g) => ({ ...g })),
    },
    layers: await Promise.all([...doc.layers].reverse().map(encodeLayer)), // top→bottom like the panel
    appVersion,
  };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

/* --------------------------- decode --------------------------- */

/** Async, safe decode of an embedded PNG data URL. */
export function decodeCanvasDataUrl(dataUrl: string): Promise<AnyCanvas> {
  return new Promise((resolve, reject) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
      reject(new Error('Invalid embedded image data'));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = makeCanvas(Math.max(1, img.naturalWidth), Math.max(1, img.naturalHeight));
      ctx2d(canvas).drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('Embedded image failed to decode'));
    img.src = dataUrl;
  });
}

function decodePaint(p: unknown): Paint | null {
  if (!p || typeof p !== 'object') return null;
  const obj = p as Paint;
  if (obj.type === 'solid' && typeof obj.color === 'string') return { type: 'solid', color: obj.color };
  if (obj.type === 'gradient' && Array.isArray(obj.stops) && obj.stops.length > 0) {
    return {
      type: 'gradient',
      gradient: obj.gradient,
      stops: obj.stops
        .filter((s) => s && typeof s.color === 'string' && Number.isFinite(s.offset))
        .map((s) => ({ offset: Math.min(1, Math.max(0, +s.offset)), color: String(s.color), alpha: Math.min(1, Math.max(0, Number(s.alpha ?? 1))) })),
      angle: Number(obj.angle) || 0,
    };
  }
  return null;
}

function decodeShape(g: unknown): ShapeGeometry | null {
  if (!g || typeof g !== 'object') return null;
  const obj = g as ShapeGeometry;
  switch (obj.type) {
    case 'rect':
      return Number.isFinite(obj.w) ? { ...obj } : null;
    case 'ellipse':
      return Number.isFinite(obj.w) ? { ...obj } : null;
    case 'line':
      return Number.isFinite(obj.x1) ? { ...obj } : null;
    case 'polygon':
      return Number.isFinite(obj.cx) ? { ...obj } : null;
    case 'star':
      return Number.isFinite(obj.cx) ? { ...obj } : null;
    case 'path':
      return Array.isArray(obj.subpaths) ? { type: 'path', subpaths: obj.subpaths } : null;
    default:
      return null;
  }
}

async function decodeLayer(raw: unknown): Promise<Layer | null> {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind as Layer['kind'];
  if (typeof o.id !== 'string' || typeof o.name !== 'string') return null;
  const base = {
    id: String(o.id),
    name: String(o.name).slice(0, 120),
    visible: o.visible !== false,
    locked: o.locked === true,
    opacity: Math.min(1, Math.max(0, Number(o.opacity ?? 1))),
    blendMode: (o.blendMode ?? 'normal') as Layer['blendMode'],
    x: Number(o.x ?? 0) || 0,
    y: Number(o.y ?? 0) || 0,
    clipToBelow: o.clipToBelow === true,
    filters: Array.isArray(o.filters) ? (o.filters as SmartFilter[]) : [],
    mask: null as Layer['mask'],
  };
  if (o.mask && typeof o.mask === 'object' && typeof (o.mask as Record<string, unknown>).png === 'string') {
    const m = o.mask as Record<string, unknown>;
    try {
      base.mask = {
        id: String(m.id ?? 'mask'),
        enabled: m.enabled !== false,
        inverted: m.inverted === true,
        canvas: await decodeCanvasDataUrl(String(m.png)),
      };
    } catch {
      base.mask = null;
    }
  }
  switch (kind) {
    case 'raster': {
      try {
        const canvas = await decodeCanvasDataUrl(String(o.png));
        return { ...base, kind: 'raster', canvas } as RasterLayer;
      } catch {
        // embed failed — create an empty placeholder so the document still opens
        return { ...base, kind: 'raster', canvas: makeCanvas(Math.max(1, Number(o.width) || 1), Math.max(1, Number(o.height) || 1)) } as RasterLayer;
      }
    }
    case 'text': {
      const t = o.text as TextContent | undefined;
      if (!t || typeof t.text !== 'string') return null;
      return { ...base, kind: 'text', text: { ...t } } as TextLayer;
    }
    case 'shape': {
      const shape = decodeShape(o.shape);
      if (!shape) return null;
      return {
        ...base,
        kind: 'shape',
        shape,
        fill: decodePaint(o.fill),
        stroke: (o.stroke as StrokeStyle | null) ?? null,
        bbox: (o.bbox as ShapeLayer['bbox']) ?? { x: 0, y: 0, w: 1, h: 1 },
      } as ShapeLayer;
    }
    case 'fill': {
      const paint = decodePaint(o.paint);
      if (!paint) return null;
      return { ...base, kind: 'fill', paint } as FillLayer;
    }
    case 'adjustment': {
      const adj = o.adjustment as AdjustmentSpec | undefined;
      if (!adj || typeof adj.type !== 'string') return null;
      return { ...base, kind: 'adjustment', adjustment: adj } as AdjustmentLayer;
    }
    case 'group': {
      const childrenRaw = Array.isArray(o.children) ? o.children : [];
      const children: Layer[] = [];
      for (const c of childrenRaw) {
        const decoded = await decodeLayer(c);
        if (decoded) children.push(decoded);
      }
      return { ...base, kind: 'group', expanded: o.expanded !== false, children } as GroupLayer;
    }
    default:
      return null;
  }
}

/** Validates + parses a project JSON string into a DocumentState. */
export async function loadProject(json: string): Promise<DocumentState> {
  if (json.length > MAX_PROJECT_BYTES) {
    throw new Error('Project file exceeds the 512 MB safety limit');
  }
  let parsed: ProjectFile;
  try {
    parsed = JSON.parse(json) as ProjectFile;
  } catch {
    throw new Error('File is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Malformed project');
  if (parsed.format !== PROJECT_FORMAT) throw new Error('Not a PixelForge Studio project');
  if (typeof parsed.version !== 'number' || parsed.version > PROJECT_VERSION) {
    throw new Error(`Project version ${parsed.version} is newer than this app supports (v${PROJECT_VERSION})`);
  }
  const d = parsed.document;
  if (!d || typeof d.width !== 'number' || typeof d.height !== 'number' || d.width < 1 || d.height < 1 || d.width > 16384 || d.height > 16384) {
    throw new Error('Invalid document dimensions');
  }
  const doc = createDocument({
    name: String(d.name ?? 'Untitled').slice(0, 120),
    width: Math.round(d.width),
    height: Math.round(d.height),
    background: d.background === 'transparent' || d.background === 'white' || d.background === 'black' ? d.background : 'white',
    customBackground: typeof d.customBackground === 'string' ? d.customBackground : undefined,
    dpi: Number(d.dpi) || 72,
    withBackgroundLayer: false,
  });
  doc.description = typeof d.description === 'string' ? d.description : '';
  doc.guides = Array.isArray(d.guides)
    ? d.guides
        .filter((g) => g && (g.axis === 'x' || g.axis === 'y') && Number.isFinite(g.position))
        .map((g) => ({ id: String(g.id), axis: g.axis, position: Number(g.position) }))
    : [];
  const layersRaw = Array.isArray(parsed.layers) ? parsed.layers : [];
  const layers: Layer[] = [];
  for (const raw of layersRaw) {
    const decoded = await decodeLayer(raw);
    if (decoded) layers.unshift(decoded); // stored top→bottom → unshift to bottom→top
  }
  if (layers.length === 0) {
    layers.push(createDocument({ width: 1, height: 1, withBackgroundLayer: false }).layers[0]);
  }
  doc.layers = layers;
  doc.selectedLayerIds = [layers[layers.length - 1].id];
  doc.createdAt = Date.now();
  doc.updatedAt = Date.now();
  return doc;
}

export async function loadProjectFromFile(file: File): Promise<DocumentState> {
  if (file.size > MAX_PROJECT_BYTES) throw new Error('Project file exceeds the 512 MB safety limit');
  const text = await file.text();
  return loadProject(text);
}

/**
 * Serializes a document to a .pfs JSON string (autosave / recovery / share).
 * Convenience wrapper around saveProject() for callers that need text
 * instead of a Blob — same format, same validation-free encode path.
 */
export async function saveProjectToString(doc: DocumentState, appVersion: string): Promise<string> {
  const blob = await saveProject(doc, appVersion);
  return await blob.text();
}
