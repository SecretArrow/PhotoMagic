/**
 * Tool metadata for the UI — display order, icons, mobile subset and the
 * mapping from ToolId to its per-tool options key in the store.
 *
 * UI-only file; the tools registry (src/tools/registry.ts) is untouched.
 */

'use client';

import type { ToolId } from '../engine/types';
import type { TranslationKey } from '../i18n/dictionaries';
import type { ToolOptions } from '../state/types';
import {
  Blend,
  Brush,
  CircleDashed,
  Crop,
  Droplets,
  Eraser,
  Flame,
  Focus,
  Hand,
  Lasso,
  Move,
  PaintBucket,
  PenTool,
  Pencil,
  Pipette,
  Shapes,
  Spline,
  SprayCan,
  SquareDashed,
  Stamp,
  Sun,
  SwatchBook,
  Type,
  Wand2,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';

export const TOOL_ORDER: ToolId[] = [
  'move',
  'marquee-rect',
  'marquee-ellipse',
  'lasso',
  'polygonal-lasso',
  'magic-wand',
  'crop',
  'eyedropper',
  'brush',
  'pencil',
  'eraser',
  'airbrush',
  'smudge',
  'blur-brush',
  'sharpen-brush',
  'dodge',
  'burn',
  'clone-stamp',
  'fill',
  'gradient',
  'text',
  'shape',
  'pen',
  'hand',
  'zoom',
];

const TOOL_ICONS: Record<ToolId, LucideIcon> = {
  move: Move,
  'marquee-rect': SquareDashed,
  'marquee-ellipse': CircleDashed,
  lasso: Lasso,
  'polygonal-lasso': Spline,
  'magic-wand': Wand2,
  crop: Crop,
  eyedropper: Pipette,
  brush: Brush,
  pencil: Pencil,
  eraser: Eraser,
  airbrush: SprayCan,
  smudge: Blend,
  'blur-brush': Droplets,
  'sharpen-brush': Focus,
  dodge: Sun,
  burn: Flame,
  'clone-stamp': Stamp,
  fill: PaintBucket,
  gradient: SwatchBook,
  text: Type,
  shape: Shapes,
  pen: PenTool,
  hand: Hand,
  zoom: ZoomIn,
};

export function toolIcon(tool: ToolId): LucideIcon {
  return TOOL_ICONS[tool];
}

/** Tools shown in the compact mobile dock, in order. */
export const MOBILE_TOOL_ORDER: ToolId[] = [
  'move',
  'marquee-rect',
  'brush',
  'eraser',
  'fill',
  'text',
  'shape',
  'eyedropper',
  'crop',
  'magic-wand',
  'clone-stamp',
];

/** ToolId → options key in ToolOptions (null = tool has no editable options). */
export function toolOptionsKey(tool: ToolId): keyof ToolOptions | null {
  switch (tool) {
    case 'move':
      return 'move';
    case 'marquee-rect':
    case 'marquee-ellipse':
    case 'lasso':
    case 'polygonal-lasso':
      return 'marquee';
    case 'magic-wand':
      return 'wand';
    case 'eyedropper':
      return 'eyedropper';
    case 'brush':
      return 'brush';
    case 'pencil':
      return 'pencil';
    case 'eraser':
      return 'eraser';
    case 'airbrush':
      return 'airbrush';
    case 'smudge':
      return 'smudge';
    case 'blur-brush':
      return 'blurBrush';
    case 'sharpen-brush':
      return 'sharpenBrush';
    case 'dodge':
      return 'dodge';
    case 'burn':
      return 'burn';
    case 'clone-stamp':
      return 'clone';
    case 'fill':
      return 'fill';
    case 'gradient':
      return 'gradient';
    case 'text':
      return 'text';
    case 'shape':
      return 'shape';
    default:
      return null;
  }
}

/**
 * Maps a ToolId to its i18n dictionary key suffix.
 * Dictionary keys use camelCase ('tools.marqueeRect') while ToolIds are
 * kebab-case ('marquee-rect'), so an explicit map keeps them in sync.
 */
const TOOL_KEY_MAP: Record<ToolId, TranslationKey> = {
  move: 'tools.move',
  'marquee-rect': 'tools.marqueeRect',
  'marquee-ellipse': 'tools.marqueeEllipse',
  lasso: 'tools.lasso',
  'polygonal-lasso': 'tools.polygonalLasso',
  'magic-wand': 'tools.wand',
  crop: 'tools.crop',
  eyedropper: 'tools.eyedropper',
  brush: 'tools.brush',
  pencil: 'tools.pencil',
  eraser: 'tools.eraser',
  airbrush: 'tools.airbrush',
  smudge: 'tools.smudge',
  'blur-brush': 'tools.blurBrush',
  'sharpen-brush': 'tools.sharpenBrush',
  dodge: 'tools.dodge',
  burn: 'tools.burn',
  'clone-stamp': 'tools.clone',
  fill: 'tools.fill',
  gradient: 'tools.gradient',
  text: 'tools.text',
  shape: 'tools.shape',
  pen: 'tools.pen',
  hand: 'tools.hand',
  zoom: 'tools.zoom',
};

export function toolLabelKey(id: ToolId): TranslationKey {
  return TOOL_KEY_MAP[id] ?? 'tools.move';
}
