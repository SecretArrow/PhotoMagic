/**
 * Editor store types — per-tool options and UI state contracts.
 * Tool implementations and the options bar both consume these.
 */

import type { Paint, ShapeGeometry, StrokeStyle, TextContent, ToolId, ViewState } from '../engine/types';
import type { SelectionMode } from '../engine/selections';

export interface BrushOptions {
  size: number;
  hardness: number; // 0..100
  opacity: number; // 0..100
  flow: number; // 0..100
  spacing: number; // % of size
  smoothing: number; // 0..100 stabilizer
  pressureSize: boolean;
  pressureOpacity: boolean;
}

export interface SelectionOptions {
  mode: SelectionMode;
  feather: number;
}

export interface WandOptions extends SelectionOptions {
  tolerance: number;
  contiguous: boolean;
  sampleMerged: boolean;
}

export interface FillOptions {
  tolerance: number;
  contiguous: boolean;
  opacity: number;
  sampleMerged: boolean;
}

export interface GradientOptions {
  gradientType: 'linear' | 'radial' | 'conic';
  reverse: boolean;
  transparency: boolean;
  /** id into gradient presets; 'fg-bg' & 'fg-transparent' are virtual */
  preset: string;
}

export interface ShapeOptions {
  shape: ShapeGeometry['type'];
  fillEnabled: boolean;
  fillColor: string;
  strokeEnabled: boolean;
  strokeWidth: number;
  strokeColor: string;
  radius: number; // rounded rect
  sides: number; // polygon
  starPoints: number;
  starInnerRatio: number;
}

export interface CloneOptions {
  size: number;
  hardness: number;
  opacity: number;
  aligned: boolean;
}

export interface RetouchOptions {
  size: number;
  hardness: number;
  strength: number; // 0..100
}

export interface MoveOptions {
  autoSelect: boolean;
}

export interface EyedropperOptions {
  sampleMerged: boolean;
  radius: number;
}

export interface CropOptions {
  /** locked aspect ratio (w/h); null = free crop */
  aspect: number | null;
}

export interface ToolOptions {
  brush: BrushOptions;
  pencil: { size: number; opacity: number };
  eraser: BrushOptions;
  airbrush: BrushOptions;
  smudge: RetouchOptions;
  blurBrush: RetouchOptions;
  sharpenBrush: RetouchOptions;
  dodge: RetouchOptions;
  burn: RetouchOptions;
  clone: CloneOptions;
  marquee: SelectionOptions;
  wand: WandOptions;
  fill: FillOptions;
  gradient: GradientOptions;
  text: TextContent;
  shape: ShapeOptions;
  move: MoveOptions;
  eyedropper: EyedropperOptions;
  crop: CropOptions;
}

export interface EditorSettings {
  language: 'en' | 'id';
  autosaveEnabled: boolean;
  autosaveIntervalSec: number;
  gridVisible: boolean;
  gridSize: number;
  snapEnabled: boolean;
  snapToGuides: boolean;
  theme: 'dark';
  checkerSize: number;
  showToasts: boolean;
}

export type DialogId =
  | null
  | 'new-document'
  | 'export'
  | 'image-size'
  | 'canvas-size'
  | 'filter-gallery'
  | 'shortcuts'
  | 'about'
  | 'settings'
  | 'storage'
  | 'resize-confirm';

export type RightPanelId =
  | 'layers'
  | 'history'
  | 'adjustments'
  | 'color'
  | 'navigator'
  | 'histogram'
  | 'properties';

export interface UiState {
  dialog: DialogId;
  rightPanel: RightPanelId;
  panelsVisible: boolean;
  mobilePanel: null | 'layers' | 'history' | 'adjustments' | 'color' | 'histogram' | 'properties';
  mobileToolbarSheet: boolean;
  statusBarVisible: boolean;
  presentationMode: boolean;
  fullscreen: boolean;
  beforeAfter: boolean;
  splitView: number; // 0..1 position
  storageInfo: { usage: number; quota: number } | null;
}

export interface FilterDialogState {
  open: boolean;
  op: string | null;
  params: Record<string, number | string | boolean>;
}

export interface EditorUiExtras {
  /** filter dialog runtime state (gallery preview lifecycle) */
  filterDialog: FilterDialogState;
  /** progress of long jobs 0..1, null = idle */
  jobProgress: { label: string; value: number } | null;
  /** last saved state fingerprint for dirty tracking */
  savedFingerprint: string | null;
}

export type { Paint, StrokeStyle, TextContent, ToolId, ViewState };
