/**
 * Pointer & tool-controller contracts.
 *
 * CanvasStage (src/canvas) translates raw pointer/touch events into
 * document-space events and forwards them to the active ToolController
 * (src/tools). This file is the boundary contract both sides code against.
 */

import type { ToolId, ViewState } from '../engine/types';

export type PointerPhase = 'down' | 'move' | 'up' | 'cancel' | 'hover' | 'leave';

export interface CanvasPointerEvent {
  phase: PointerPhase;
  /** document-space coordinates (may be fractional) */
  docX: number;
  docY: number;
  /** raw screen coordinates relative to the canvas element */
  screenX: number;
  screenY: number;
  pressure: number; // 0..1 (0.5 default for mouse)
  pointerType: 'mouse' | 'touch' | 'pen';
  button: number;
  buttons: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  /** multi-touch state when applicable */
  activePointers: number;
}

export interface ToolContext {
  /** current view transform (for screen<->doc conversions) */
  view: ViewState;
  viewportSize: { w: number; h: number };
  /** request a viewport re-render (rAF-throttled by the stage) */
  invalidate(): void;
  /** set a transient cursor override while the tool is active */
  setCursor(cursor: string): void;
  /** current pointer event modifiers snapshot */
  isAltDown(): boolean;
}

export interface ToolController {
  tool: ToolId;
  /** short cursor hint, e.g. 'crosshair' | 'grab' */
  cursor: string;
  onPointerDown?(e: CanvasPointerEvent, ctx: ToolContext): void;
  onPointerMove?(e: CanvasPointerEvent, ctx: ToolContext): void;
  onPointerUp?(e: CanvasPointerEvent, ctx: ToolContext): void;
  onPointerCancel?(e: CanvasPointerEvent, ctx: ToolContext): void;
  /** wheel with ctrl = zoom, plain = scroll (stage handles zoom by default) */
  onWheel?(deltaY: number, e: CanvasPointerEvent, ctx: ToolContext): void;
  /** key pressed while tool active (e.g. Enter to commit polygon lasso) */
  onKeyDown?(key: string, ctx: ToolContext): boolean;
  /** called when tool is deactivated (commit pending state) */
  deactivate?(): void;
}

export interface ViewportOverlay {
  id: string;
  /** draw overlay in screen space; stage provides transformed context */
  draw(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, view: ViewState, viewport: { w: number; h: number }): void;
}

/* ---------- coordinate transforms (pure, unit-testable) ---------- */

export function docToScreen(view: ViewState, docX: number, docY: number): { x: number; y: number } {
  let x = docX * view.zoom + view.panX;
  let y = docY * view.zoom + view.panY;
  if (view.rotation !== 0) {
    const cos = Math.cos(view.rotation);
    const sin = Math.sin(view.rotation);
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    x = rx;
    y = ry;
  }
  if (view.flipX) x = -x;
  if (view.flipY) y = -y;
  return { x, y };
}

export function screenToDoc(view: ViewState, screenX: number, screenY: number): { x: number; y: number } {
  let x = screenX;
  let y = screenY;
  if (view.flipX) x = -x;
  if (view.flipY) y = -y;
  if (view.rotation !== 0) {
    const cos = Math.cos(-view.rotation);
    const sin = Math.sin(-view.rotation);
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    x = rx;
    y = ry;
  }
  return { x: (x - view.panX) / view.zoom, y: (y - view.panY) / view.zoom };
}
