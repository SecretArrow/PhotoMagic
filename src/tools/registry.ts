/**
 * Tool registry — lazy singleton ToolControllers per ToolId.
 *
 * CanvasStage imports ONLY `getToolController` from this module. Every
 * ToolId has a real controller (including hand/zoom navigation); the return
 * type stays optional for future tools that cannot operate standalone.
 */

import type { ToolId } from '../engine/types';
import type { ToolController } from '../canvas/pointerContract';
import { airbrushController, brushController, eraserController, pencilController } from './paint';
import {
  blurBrushController,
  burnController,
  cloneStampController,
  dodgeController,
  sharpenBrushController,
  smudgeController,
} from './retouch';
import {
  lassoController,
  magicWandController,
  marqueeEllipseController,
  marqueeRectController,
  polygonalLassoController,
} from './selections';
import { moveController } from './transform';
import { eyedropperController, fillController, gradientController } from './paint-fill';
import { textController } from './text';
import { shapeController } from './shapes';
import { penController } from './pen';
import { handController, zoomController } from './nav';
import { cropController } from './crop';

const factories: Record<ToolId, () => ToolController> = {
  move: () => moveController,
  'marquee-rect': () => marqueeRectController,
  'marquee-ellipse': () => marqueeEllipseController,
  lasso: () => lassoController,
  'polygonal-lasso': () => polygonalLassoController,
  'magic-wand': () => magicWandController,
  crop: () => cropController,
  eyedropper: () => eyedropperController,
  brush: () => brushController,
  pencil: () => pencilController,
  eraser: () => eraserController,
  airbrush: () => airbrushController,
  smudge: () => smudgeController,
  'blur-brush': () => blurBrushController,
  'sharpen-brush': () => sharpenBrushController,
  dodge: () => dodgeController,
  burn: () => burnController,
  'clone-stamp': () => cloneStampController,
  fill: () => fillController,
  gradient: () => gradientController,
  text: () => textController,
  shape: () => shapeController,
  pen: () => penController,
  hand: () => handController,
  zoom: () => zoomController,
};

const cache = new Map<ToolId, ToolController>();

/** Returns the (cached) controller for a tool; undefined only if unimplemented. */
export function getToolController(tool: ToolId): ToolController | undefined {
  const hit = cache.get(tool);
  if (hit) return hit;
  const factory = factories[tool];
  if (!factory) return undefined;
  const controller = factory();
  cache.set(tool, controller);
  return controller;
}
