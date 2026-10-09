/**
 * Navigation tools — hand (pan) and zoom.
 *
 * - hand: drag pans the view (grab/grabbing cursors); double-click dispatches
 *   the 'pf:fit' window event (workspace listens and fits the document).
 * - zoom: click zooms ×1.25 at the pointer (alt = ÷1.25); dragging left/right
 *   zooms continuously around the drag start point. No history.
 */

import { useEditorStore } from '../state/editorStore';
import type { CanvasPointerEvent, ToolContext, ToolController } from '../canvas/pointerContract';

/* -------------------------------- hand -------------------------------- */

let panning = false;
let panStartScreen = { x: 0, y: 0 };
let panStartPan = { x: 0, y: 0 };
let lastDownAt = 0;
let lastDownScreen = { x: 0, y: 0 };

export const handController: ToolController = {
  tool: 'hand',
  cursor: 'grab',
  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    const now = performance.now();
    if (now - lastDownAt < 350 && Math.hypot(e.screenX - lastDownScreen.x, e.screenY - lastDownScreen.y) < 5) {
      // double-click → fit to screen
      window.dispatchEvent(new Event('pf:fit'));
    }
    lastDownAt = now;
    lastDownScreen = { x: e.screenX, y: e.screenY };
    const view = useEditorStore.getState().view;
    panning = true;
    panStartScreen = { x: e.screenX, y: e.screenY };
    panStartPan = { x: view.panX, y: view.panY };
    ctx.setCursor('grabbing');
  },
  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!panning) return;
    useEditorStore.getState().setView({
      panX: panStartPan.x + (e.screenX - panStartScreen.x),
      panY: panStartPan.y + (e.screenY - panStartScreen.y),
    });
    ctx.invalidate();
  },
  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext): void {
    panning = false;
    ctx.setCursor('grab');
  },
  onPointerCancel(_e: CanvasPointerEvent, ctx: ToolContext): void {
    panning = false;
    ctx.setCursor('grab');
  },
  deactivate(): void {
    panning = false;
  },
};

/* -------------------------------- zoom -------------------------------- */

interface ZoomDrag {
  startX: number;
  startY: number;
  lastX: number;
  moved: boolean;
}

let zoomDrag: ZoomDrag | null = null;

export const zoomController: ToolController = {
  tool: 'zoom',
  cursor: 'zoom-in',
  onPointerDown(e: CanvasPointerEvent): void {
    zoomDrag = { startX: e.screenX, startY: e.screenY, lastX: e.screenX, moved: false };
  },
  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!zoomDrag) return;
    if (Math.abs(e.screenX - zoomDrag.startX) > 3 || Math.abs(e.screenY - zoomDrag.startY) > 3) zoomDrag.moved = true;
    const dx = e.screenX - zoomDrag.lastX;
    zoomDrag.lastX = e.screenX;
    if (dx !== 0 && zoomDrag.moved) {
      useEditorStore.getState().zoomBy(Math.pow(1.01, dx), zoomDrag.startX, zoomDrag.startY);
      ctx.invalidate();
    }
  },
  onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (zoomDrag && !zoomDrag.moved) {
      const factor = e.alt ? 1 / 1.25 : 1.25;
      useEditorStore.getState().zoomBy(factor, e.screenX, e.screenY);
      ctx.invalidate();
    }
    zoomDrag = null;
  },
  onPointerCancel(): void {
    zoomDrag = null;
  },
  deactivate(): void {
    zoomDrag = null;
  },
};
