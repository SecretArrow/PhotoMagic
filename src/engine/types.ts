/**
 * PixelForge Studio — core engine types.
 *
 * This module is the single source of truth for the document model.
 * All engine modules, tools, panels and IO adapters code against these types.
 * Everything here is pure data / plain functions — no DOM access except where
 * explicitly noted (pixel buffers use OffscreenCanvas/HTMLCanvasElement and
 * ImageData, which only exist on the client; the editor is a client-only app).
 */

import type { BlendMode } from './blend';

/* ------------------------------------------------------------------ */
/* Paint & color                                                       */
/* ------------------------------------------------------------------ */

export type RGB = { r: number; g: number; b: number }; // 0..255
export type HSL = { h: number; s: number; l: number }; // h 0..360, s/l 0..100

export type GradientStop = { offset: number; color: string; alpha: number };

export type GradientType = 'linear' | 'radial' | 'conic';

export type Paint =
  | { type: 'solid'; color: string }
  | {
      type: 'gradient';
      gradient: GradientType;
      stops: GradientStop[];
      /** angle in radians for linear gradients */
      angle: number;
    };

/* ------------------------------------------------------------------ */
/* Adjustments                                                         */
/* ------------------------------------------------------------------ */

export type AdjustmentType =
  | 'brightness-contrast'
  | 'exposure'
  | 'hue-saturation'
  | 'vibrance'
  | 'temperature'
  | 'invert'
  | 'grayscale'
  | 'sepia'
  | 'posterize'
  | 'threshold'
  | 'gamma'
  | 'levels';

export type AdjustmentSpec =
  | { type: 'brightness-contrast'; brightness: number; contrast: number } // -100..100
  | { type: 'exposure'; exposure: number } // -2..2 stops
  | { type: 'hue-saturation'; hue: number; saturation: number; lightness: number } // -180 / -100..100 / -100..100
  | { type: 'vibrance'; amount: number } // -100..100
  | { type: 'temperature'; temperature: number; tint: number } // -100..100
  | { type: 'invert' }
  | { type: 'grayscale'; amount: number } // 0..100
  | { type: 'sepia'; amount: number } // 0..100
  | { type: 'posterize'; levels: number } // 2..32
  | { type: 'threshold'; level: number } // 0..255
  | { type: 'gamma'; gamma: number } // 0.1..3
  | { type: 'levels'; inBlack: number; inWhite: number; gamma: number; outBlack: number; outWhite: number }; // 0..255

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

export type LayerBlend = BlendMode;

export interface LayerBase {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
  blendMode: LayerBlend;
  /** pixel offset of the layer content within the document */
  x: number;
  y: number;
  /** clip this layer to the alpha of the composite directly below (clipping mask) */
  clipToBelow: boolean;
  /** non-destructive raster mask (alpha mask, same size as layer content) */
  mask?: LayerMask | null;
  /** non-destructive smart filters applied bottom→top */
  filters?: SmartFilter[];
}

export type LayerKind =
  | 'raster'
  | 'text'
  | 'shape'
  | 'adjustment'
  | 'group'
  | 'fill';

export interface LayerMask {
  id: string;
  enabled: boolean;
  inverted: boolean;
  /** grayscale canvas: alpha channel carries mask coverage */
  canvas: HTMLCanvasElement | OffscreenCanvas;
}

export interface SmartFilter {
  id: string;
  op: string; // filter registry key (see engine/filters)
  params: Record<string, number | string | boolean>;
  enabled: boolean;
}

export interface RasterLayer extends LayerBase {
  kind: 'raster';
  /** pixel buffer; canvas size may differ from document size (offset by x/y) */
  canvas: HTMLCanvasElement | OffscreenCanvas;
}

export interface TextContent {
  text: string;
  fontFamily: string;
  fontSize: number; // px
  fontWeight: number; // 100..900
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  lineHeight: number; // multiplier
  letterSpacing: number; // px
  color: string;
  /** point text position in document space */
  x: number;
  y: number;
  /** paragraph box width (0 = point text, no wrapping) */
  boxWidth: number;
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  text: TextContent;
}

export type ShapeGeometry =
  | { type: 'rect'; x: number; y: number; w: number; h: number; radius: number }
  | { type: 'ellipse'; x: number; y: number; w: number; h: number }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'polygon'; cx: number; cy: number; radius: number; sides: number; rotation: number }
  | { type: 'star'; cx: number; cy: number; outer: number; inner: number; points: number; rotation: number }
  | { type: 'path'; subpaths: PathSubPath[] };

export type PathSubPath = {
  commands: PathCommand[];
  closed: boolean;
};

export type PathCommand =
  | { c: 'M'; x: number; y: number }
  | { c: 'L'; x: number; y: number }
  | { c: 'C'; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }
  | { c: 'Q'; cx: number; cy: number; x: number; y: number }
  | { c: 'Z' };

export interface StrokeStyle {
  color: string;
  width: number;
  dash: number[] | null;
  cap: CanvasLineCap;
  join: CanvasLineJoin;
}

export interface ShapeLayer extends LayerBase {
  kind: 'shape';
  shape: ShapeGeometry;
  fill: Paint | null;
  stroke: StrokeStyle | null;
  /** shape bbox in document space (kept in sync when geometry changes) */
  bbox: { x: number; y: number; w: number; h: number };
}

export interface FillLayer extends LayerBase {
  kind: 'fill';
  paint: Paint;
}

export interface AdjustmentLayer extends LayerBase {
  kind: 'adjustment';
  adjustment: AdjustmentSpec;
}

export interface GroupLayer extends LayerBase {
  kind: 'group';
  children: Layer[];
  expanded: boolean;
}

export type Layer = RasterLayer | TextLayer | ShapeLayer | FillLayer | AdjustmentLayer | GroupLayer;

/* ------------------------------------------------------------------ */
/* Document                                                            */
/* ------------------------------------------------------------------ */

export type BackgroundType = 'transparent' | 'white' | 'black' | 'custom';

export interface Guide {
  id: string;
  axis: 'x' | 'y';
  position: number;
}

export interface DocumentState {
  id: string;
  name: string;
  width: number;
  height: number;
  dpi: number;
  colorMode: 'rgb-8bit';
  background: BackgroundType;
  customBackground?: string;
  /** layers bottom→top (index 0 = bottom). Panels display reversed. */
  layers: Layer[];
  selectedLayerIds: string[];
  guides: Guide[];
  /** document-level notes (metadata panel) */
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentMetaSnapshot {
  id: string;
  name: string;
  width: number;
  height: number;
  layerCount: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/* Selections                                                          */
/* ------------------------------------------------------------------ */

export type SelectionOutline = number[][]; // list of polylines: [x0,y0,x1,y1,...]

export interface Selection {
  width: number;
  height: number;
  /** coverage mask, length = width*height, 0..255 */
  mask: Uint8ClampedArray;
  bounds: { x: number; y: number; w: number; h: number };
  /** geometric outline(s) in document space for marching ants */
  outline: SelectionOutline;
  source: string; // tool that produced it
}

/* ------------------------------------------------------------------ */
/* View / workspace                                                    */
/* ------------------------------------------------------------------ */

export type ToolId =
  | 'move'
  | 'marquee-rect'
  | 'marquee-ellipse'
  | 'lasso'
  | 'polygonal-lasso'
  | 'magic-wand'
  | 'crop'
  | 'eyedropper'
  | 'brush'
  | 'pencil'
  | 'eraser'
  | 'airbrush'
  | 'smudge'
  | 'blur-brush'
  | 'sharpen-brush'
  | 'dodge'
  | 'burn'
  | 'clone-stamp'
  | 'fill'
  | 'gradient'
  | 'text'
  | 'shape'
  | 'pen'
  | 'hand'
  | 'zoom';

export interface ViewState {
  zoom: number; // 1 = 100%
  panX: number; // viewport offset in screen px
  panY: number;
  rotation: number; // canvas rotation radians (view only)
  flipX: boolean;
  flipY: boolean;
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export type HistoryEntryKind =
  | 'pixel'
  | 'structure'
  | 'layer-prop'
  | 'selection'
  | 'document'
  | 'composite';

export interface HistoryEntry {
  id: string;
  kind: HistoryEntryKind;
  /** i18n key describing the action, e.g. 'history.brushStroke' */
  labelKey: string;
  labelFallback: string;
  at: number;
  /** memory estimate in bytes for memory-aware trimming */
  bytes: number;
  undo(): void;
  redo(): void;
}

/* ------------------------------------------------------------------ */
/* Filters (registry contract — implemented in engine/filters)          */
/* ------------------------------------------------------------------ */

export type FilterParamType = 'number' | 'boolean' | 'select';

export interface FilterParamDef {
  key: string;
  type: FilterParamType;
  labelKey: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValue: number | string | boolean;
  options?: { value: string; labelKey: string }[];
}

export interface FilterDef {
  op: string;
  labelKey: string;
  category: 'blur' | 'sharpen' | 'noise' | 'stylize' | 'distort' | 'light' | 'artistic';
  params: FilterParamDef[];
  /** worker-side pixel operation */
  apply(data: Uint8ClampedArray, width: number, height: number, params: Record<string, number | string | boolean>): void;
}

/* ------------------------------------------------------------------ */
/* Worker protocol                                                     */
/* ------------------------------------------------------------------ */

export type FilterRequest =
  | {
      type: 'filter';
      jobId: number;
      op: string;
      params: Record<string, number | string | boolean>;
      width: number;
      height: number;
      buffer: ArrayBuffer; // RGBA
    }
  | {
      type: 'adjust';
      jobId: number;
      adjustments: AdjustmentSpec[];
      width: number;
      height: number;
      buffer: ArrayBuffer; // RGBA
    }
  | { type: 'histogram'; jobId: number; buffer: ArrayBuffer; precision: number }
  | { type: 'ping'; jobId: number };

export type FilterResponse =
  | { type: 'filter'; jobId: number; buffer: ArrayBuffer }
  | { type: 'adjust'; jobId: number; buffer: ArrayBuffer }
  | { type: 'histogram'; jobId: number; luminance: number[]; r: number[]; g: number[]; b: number[]; max: number }
  | { type: 'pong'; jobId: number }
  | { type: 'error'; jobId: number; message: string };

/* ------------------------------------------------------------------ */
/* Project file (.pfs)                                                 */
/* ------------------------------------------------------------------ */

export interface ProjectFile {
  format: 'pixelforge-studio';
  version: 1;
  savedAt: string;
  document: {
    name: string;
    width: number;
    height: number;
    dpi: number;
    background: BackgroundType;
    customBackground?: string;
    description: string;
    guides: Guide[];
  };
  /** layers top→bottom as displayed in the panel; rasters embedded as PNG data URLs */
  layers: unknown[]; // typed in documents/project.ts serializer
  appVersion: string;
}
