'use client';

/**
 * CanvasStage — the central canvas workspace (most performance-critical UI).
 *
 * Layer sandwich (both canvases absolutely positioned, CSS-sized to the
 * container, backing store = container × capped devicePixelRatio):
 *   1. display canvas — checkerboard clipped to the document rectangle plus
 *      the cached document composite under the view transform.
 *   2. overlay canvas (pointer-events: none) — document border, grid, guides,
 *      marching ants, optional ToolController.drawOverlay, brush cursor ring.
 *
 * Rendering model: a single rAF loop with two dirty flags (display/overlay).
 * composeDocument() runs only when the store `revision` (or the document
 * dimensions) change — never per frame. The ants animation invalidates the
 * overlay at ~15 fps while a selection exists.
 *
 * Draw matrix: scale(flip) → rotate → translate(pan) → scale(zoom). Canvas
 * transforms apply outermost-first, so this yields exactly
 *   screen = F·R·T(pan)·S(zoom)·doc = docToScreen(doc)
 * and is inverted exactly by screenToDoc() — raster, overlays and pointer
 * mapping therefore agree in every view state. At the default view
 * (rotation 0, no flip) it reduces to translate(pan) → scale(zoom).
 *
 * Gestures (pointer capture on the container, `pf-canvas` = touch-action:none):
 *   - middle button / held space / hand tool → pan
 *   - ctrl/cmd + wheel → cursor-anchored zoom via store.zoomBy
 *   - plain wheel → pan
 *   - two active pointers → pinch zoom + two-finger pan (tool drag cancelled)
 *   - remaining pointer traffic → dispatched to the active ToolController
 *   - 'pf:fit' window event → fit document to the viewport
 */

import { useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../state/editorStore';
import type { ToolOptions } from '../state/types';
import type { DocumentState, Selection, ToolId, ViewState } from '../engine/types';
import { composeDocument } from '../engine/render';
import { makeCanvas, paintChecker, type AnyCanvas } from '../engine/raster';
import {
  docToScreen,
  screenToDoc,
  type CanvasPointerEvent,
  type PointerPhase,
  type ToolContext,
} from './pointerContract';
import { getToolController } from '../tools/registry';

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

const DPR_CAP = 2;
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 32;
/** marching ants redraw cadence (~15 fps) */
const ANTS_INTERVAL_MS = 1000 / 15;
/** dash [4,4] period — phase wraps modulo this for a seamless march */
const ANTS_PHASE_PERIOD = 8;
/** screen distance at which a guide counts as hovered */
const GUIDE_HIT_PX = 4;
/** minimum on-screen grid cell before grid lines are drawn */
const GRID_MIN_SCREEN_PX = 6;

interface PointerTrack {
  x: number;
  y: number;
}

interface PinchState {
  prevDist: number;
  prevMidX: number;
  prevMidY: number;
}

interface PanDragState {
  pointerId: number;
  lastX: number;
  lastY: number;
}

interface ViewportSize {
  w: number;
  h: number;
}

/* ------------------------------------------------------------------ */
/* pure helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Brush-size tools whose cursor ring the stage renders.
 * Returns the tool's active size in document px, or null for other tools.
 */
function brushSizeFor(tool: ToolId, opts: ToolOptions): number | null {
  switch (tool) {
    case 'brush':
      return opts.brush.size;
    case 'pencil':
      return opts.pencil.size;
    case 'eraser':
      return opts.eraser.size;
    case 'airbrush':
      return opts.airbrush.size;
    case 'smudge':
      return opts.smudge.size;
    case 'blur-brush':
      return opts.blurBrush.size;
    case 'sharpen-brush':
      return opts.sharpenBrush.size;
    case 'dodge':
      return opts.dodge.size;
    case 'burn':
      return opts.burn.size;
    case 'clone-stamp':
      return opts.clone.size;
    default:
      return null;
  }
}

/** Screen-space bounding box of the document rectangle under `view`. */
function docScreenBBox(
  view: ViewState,
  docW: number,
  docH: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const c00 = docToScreen(view, 0, 0);
  const c10 = docToScreen(view, docW, 0);
  const c01 = docToScreen(view, 0, docH);
  const c11 = docToScreen(view, docW, docH);
  return {
    minX: Math.min(c00.x, c10.x, c01.x, c11.x),
    minY: Math.min(c00.y, c10.y, c01.y, c11.y),
    maxX: Math.max(c00.x, c10.x, c01.x, c11.x),
    maxY: Math.max(c00.y, c10.y, c01.y, c11.y),
  };
}

/**
 * Applies the view transform to a 2D context. Canvas transforms compose
 * outermost-first, so scale(flip) → rotate → translate(pan) → scale(zoom)
 * equals docToScreen() (see file header).
 */
function applyViewTransform(ctx: CanvasRenderingContext2D, view: ViewState): void {
  if (view.flipX || view.flipY) ctx.scale(view.flipX ? -1 : 1, view.flipY ? -1 : 1);
  if (view.rotation !== 0) ctx.rotate(view.rotation);
  ctx.translate(view.panX, view.panY);
  ctx.scale(view.zoom, view.zoom);
}

/**
 * View-pan patch that moves the content by a screen-space delta (dx, dy):
 * M = F·R·T(pan)·S must shift by Δ ⇒ pan += R⁻¹·F·Δ.
 */
function panDeltaFor(view: ViewState, dx: number, dy: number): { panX: number; panY: number } {
  let x = view.flipX ? -dx : dx;
  let y = view.flipY ? -dy : dy;
  if (view.rotation !== 0) {
    const cos = Math.cos(-view.rotation);
    const sin = Math.sin(-view.rotation);
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    x = rx;
    y = ry;
  }
  return { panX: view.panX + x, panY: view.panY + y };
}

/**
 * View-pan patch keeping document point (docX, docY) — captured under the
 * OLD view — pinned at screen point (sx, sy) with the NEW zoom:
 * F·R·(zoom·d + pan') = s ⇒ pan' = R⁻¹(F(s)) − zoom·d.
 */
function anchoredPan(
  view: ViewState,
  zoom: number,
  docX: number,
  docY: number,
  sx: number,
  sy: number,
): { panX: number; panY: number } {
  let x = sx;
  let y = sy;
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
  return { panX: x - zoom * docX, panY: y - zoom * docY };
}

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Marching ants: black solid pass + white dashed pass over outline polylines. */
function drawAnts(ctx: CanvasRenderingContext2D, view: ViewState, selection: Selection, phase: number): void {
  ctx.beginPath();
  for (const poly of selection.outline) {
    if (poly.length < 4) continue;
    for (let i = 0; i + 1 < poly.length; i += 2) {
      const p = docToScreen(view, poly[i], poly[i + 1]);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#000000';
  ctx.stroke();
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = -phase;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

export default function CanvasStage() {
  /* low-frequency reactive slices (drive dirty-flag effects) */
  const tool = useEditorStore((s) => s.tool);
  const selection = useEditorStore((s) => s.selection);
  const settings = useEditorStore((s) => s.settings);
  const toolOptions = useEditorStore((s) => s.toolOptions);

  /* dom refs */
  const containerRef = useRef<HTMLDivElement | null>(null);
  const displayRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  /* render loop state */
  const sizeRef = useRef<ViewportSize>({ w: 0, h: 0 });
  const dprRef = useRef(1);
  const displayCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const overlayCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const dispDirtyRef = useRef(true);
  const ovlDirtyRef = useRef(true);
  const rafRef = useRef(0);
  const compositeRef = useRef<AnyCanvas | null>(null);
  const antsAccRef = useRef(0);
  const antsPhaseRef = useRef(0);
  const interactedRef = useRef(false);

  /* pointer / gesture state */
  const pointersRef = useRef(new Map<number, PointerTrack>());
  const pinchRef = useRef<PinchState | null>(null);
  const panRef = useRef<PanDragState | null>(null);
  const toolDragRef = useRef(false);
  /** pointer that survived a pinch — must not resume a tool stroke */
  const stalePointerRef = useRef<number | null>(null);
  const hoveringRef = useRef(false);
  const hoverPosRef = useRef({ x: 0, y: 0 });
  const spaceRef = useRef(false);
  const altRef = useRef(false);
  const baseCursorRef = useRef('default');
  const cursorOverrideRef = useRef<string | null>(null);
  const rectRef = useRef<DOMRect | null>(null);

  const markDisplay = useCallback((): void => {
    dispDirtyRef.current = true;
  }, []);

  const markOverlay = useCallback((): void => {
    ovlDirtyRef.current = true;
  }, []);

  const markAll = useCallback((): void => {
    dispDirtyRef.current = true;
    ovlDirtyRef.current = true;
  }, []);

  const applyCursor = useCallback((): void => {
    const el = containerRef.current;
    if (!el) return;
    let cursor: string;
    if (panRef.current) cursor = 'grabbing';
    else if (spaceRef.current) cursor = 'grab';
    else cursor = cursorOverrideRef.current ?? baseCursorRef.current;
    el.style.cursor = cursor;
  }, []);

  const setBaseCursor = useCallback((): void => {
    const controller = getToolController(useEditorStore.getState().tool);
    baseCursorRef.current = controller?.cursor ?? 'default';
    cursorOverrideRef.current = null;
    applyCursor();
  }, [applyCursor]);

  /* reactive slices → dirty flags + cursor */
  useEffect(() => {
    markOverlay();
    setBaseCursor();
  }, [tool, markOverlay, setBaseCursor]);

  useEffect(() => {
    markOverlay();
  }, [selection, markOverlay]);

  useEffect(() => {
    markAll();
  }, [settings, markAll]);

  useEffect(() => {
    markOverlay();
  }, [toolOptions, markOverlay]);

  /* ---------------------------------------------------------------- */
  /* main effect: composite cache, rAF loop, subscriptions, gestures   */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const refreshRect = (): void => {
      rectRef.current = container.getBoundingClientRect();
    };
    refreshRect();

    /* ---------- composite cache (rebuilt only on revision change) ---------- */

    const rebuildComposite = (doc: DocumentState): void => {
      let canvas = compositeRef.current;
      if (!canvas || canvas.width !== doc.width || canvas.height !== doc.height) {
        canvas = makeCanvas(doc.width, doc.height);
        // Touch the 2D context WITHOUT willReadFrequently so the buffer stays
        // GPU-backed; composeDocument()'s ctx2d() then re-uses this context
        // (repeat getContext() returns the same context, creation attrs ignored).
        canvas.getContext('2d');
        compositeRef.current = canvas;
      }
      composeDocument(doc, { target: canvas });
    };

    rebuildComposite(useEditorStore.getState().doc);

    /* ---------- canvas sizing (DPR-aware, capped) ---------- */

    const resizeCanvases = (w: number, h: number): void => {
      const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
      dprRef.current = dpr;
      sizeRef.current = { w, h };
      const bw = Math.max(1, Math.round(w * dpr));
      const bh = Math.max(1, Math.round(h * dpr));
      for (const c of [displayRef.current, overlayRef.current]) {
        if (!c) continue;
        if (c.width !== bw || c.height !== bh) {
          c.width = bw;
          c.height = bh;
        }
      }
      if (!displayCtxRef.current && displayRef.current) {
        displayCtxRef.current = displayRef.current.getContext('2d');
      }
      if (!overlayCtxRef.current && overlayRef.current) {
        overlayCtxRef.current = overlayRef.current.getContext('2d');
      }
    };

    /* ---------- draw passes ---------- */

    const drawDisplay = (): void => {
      const ctx = displayCtxRef.current;
      const composite = compositeRef.current;
      if (!ctx || !composite) return;
      const st = useEditorStore.getState();
      const { view, doc } = st;
      const { w, h } = sizeRef.current;

      ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // checkerboard only within the document rectangle (screen bbox of corners)
      const bb = docScreenBBox(view, doc.width, doc.height);
      const bx = Math.max(0, bb.minX);
      const by = Math.max(0, bb.minY);
      const bw = Math.min(w, bb.maxX) - bx;
      const bh = Math.min(h, bb.maxY) - by;
      if (bw > 0 && bh > 0) {
        paintChecker(ctx, bx, by, bw, bh, Math.max(1, st.settings.checkerSize));
      }

      // document composite under the view transform
      ctx.save();
      applyViewTransform(ctx, view);
      ctx.imageSmoothingEnabled = view.zoom < 3; // crisp pixels at high zoom
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(composite as CanvasImageSource, 0, 0);
      ctx.restore();
    };

    const drawOverlay = (): void => {
      const ctx = overlayCtxRef.current;
      if (!ctx) return;
      const st = useEditorStore.getState();
      const { view, doc, selection: sel, settings: cfg, tool: activeTool } = st;
      const { w, h } = sizeRef.current;

      ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const bb = docScreenBBox(view, doc.width, doc.height);

      // document border (1px, aligned to the pixel grid)
      ctx.strokeStyle = '#4b4d55';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        Math.round(bb.minX) + 0.5,
        Math.round(bb.minY) + 0.5,
        Math.max(1, Math.round(bb.maxX - bb.minX) - 1),
        Math.max(1, Math.round(bb.maxY - bb.minY) - 1),
      );

      // grid: doc-space lines, only when a cell is ≥ 6 screen px
      if (cfg.gridVisible && cfg.gridSize > 0 && view.zoom * cfg.gridSize >= GRID_MIN_SCREEN_PX) {
        const cols = Math.floor(doc.width / cfg.gridSize);
        const rows = Math.floor(doc.height / cfg.gridSize);
        ctx.beginPath();
        for (let i = 0; i <= cols; i++) {
          const p0 = docToScreen(view, i * cfg.gridSize, 0);
          const p1 = docToScreen(view, i * cfg.gridSize, doc.height);
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
        }
        for (let i = 0; i <= rows; i++) {
          const p0 = docToScreen(view, 0, i * cfg.gridSize);
          const p1 = docToScreen(view, doc.width, i * cfg.gridSize);
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
        }
        ctx.strokeStyle = 'rgba(128, 128, 128, 0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // guides (hovered guide brighter)
      const px = hoverPosRef.current.x;
      const py = hoverPosRef.current.y;
      for (const g of doc.guides) {
        ctx.beginPath();
        let hovered: boolean;
        if (g.axis === 'x') {
          const p0 = docToScreen(view, g.position, 0);
          const p1 = docToScreen(view, g.position, doc.height);
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          hovered = hoveringRef.current && Math.abs(px - p0.x) <= GUIDE_HIT_PX;
        } else {
          const p0 = docToScreen(view, 0, g.position);
          const p1 = docToScreen(view, doc.width, g.position);
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          hovered = hoveringRef.current && Math.abs(py - p0.y) <= GUIDE_HIT_PX;
        }
        ctx.strokeStyle = hovered ? '#a7efc9' : '#58c08a';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // marching ants
      if (sel) drawAnts(ctx, view, sel, antsPhaseRef.current);

      // tool-drawn overlay (crop rects, marquee previews, pen anchors…)
      const controller = getToolController(activeTool);
      if (controller?.drawOverlay) {
        controller.drawOverlay(ctx, view, { w, h });
      }

      // brush cursor ring (paint / retouch / clone / eraser tools)
      const brushSize = brushSizeFor(activeTool, st.toolOptions);
      if (brushSize !== null && hoveringRef.current && !pinchRef.current && !panRef.current) {
        const r = (brushSize / 2) * view.zoom;
        const cx = hoverPosRef.current.x;
        const cy = hoverPosRef.current.y;
        ctx.beginPath();
        if (r >= 2) {
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
        } else {
          // tiny brush: 4px crosshair so the pointer stays visible
          ctx.moveTo(cx - 2, cy);
          ctx.lineTo(cx + 2, cy);
          ctx.moveTo(cx, cy - 2);
          ctx.lineTo(cx, cy + 2);
        }
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'; // outer stroke for visibility
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };

    /* ---------- render loop ---------- */

    let lastTime = performance.now();
    const frame = (now: number): void => {
      rafRef.current = requestAnimationFrame(frame);
      const dt = now - lastTime;
      lastTime = now;

      // ants animation at ~15 fps while a selection exists
      if (useEditorStore.getState().selection) {
        antsAccRef.current += dt;
        if (antsAccRef.current >= ANTS_INTERVAL_MS) {
          antsAccRef.current %= ANTS_INTERVAL_MS;
          antsPhaseRef.current = (antsPhaseRef.current + 1) % ANTS_PHASE_PERIOD;
          ovlDirtyRef.current = true;
        }
      } else {
        antsAccRef.current = 0;
      }

      // re-sync backing store when DPR changes (monitor switch / browser zoom)
      const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
      const { w, h } = sizeRef.current;
      const disp = displayRef.current;
      if (disp && (dprRef.current !== dpr || disp.width !== Math.max(1, Math.round(w * dpr)) || disp.height !== Math.max(1, Math.round(h * dpr)))) {
        resizeCanvases(w, h);
      }

      if (dispDirtyRef.current) {
        dispDirtyRef.current = false;
        drawDisplay();
      }
      if (ovlDirtyRef.current) {
        ovlDirtyRef.current = false;
        drawOverlay();
      }
    };
    rafRef.current = requestAnimationFrame(frame);

    /* ---------- store subscriptions (imperative, high-frequency) ---------- */

    const unsubscribe = useEditorStore.subscribe((s, prev) => {
      if (s.revision !== prev.revision) {
        rebuildComposite(s.doc);
        markDisplay();
        if (s.doc.width !== prev.doc.width || s.doc.height !== prev.doc.height) {
          markAll();
          // fit-on-load for a resized document (until the user takes control)
          if (!interactedRef.current) {
            const { w, h } = sizeRef.current;
            if (w > 0 && h > 0) s.fitToScreen(w, h);
          }
        }
      }
      if (s.doc.id !== prev.doc.id) {
        // a different document was loaded → fresh fit-on-load
        interactedRef.current = false;
        const { w, h } = sizeRef.current;
        if (w > 0 && h > 0) s.fitToScreen(w, h);
      }
      if (s.view !== prev.view) {
        markAll();
      }
      if (s.doc.guides !== prev.doc.guides) {
        markOverlay();
      }
    });

    /* ---------- pointer → CanvasPointerEvent ---------- */

    const localPoint = (clientX: number, clientY: number): { x: number; y: number } => ({
      x: clientX - (rectRef.current?.left ?? 0),
      y: clientY - (rectRef.current?.top ?? 0),
    });

    const eventFromPointer = (e: PointerEvent, phase: PointerPhase): CanvasPointerEvent => {
      altRef.current = e.altKey;
      const p = localPoint(e.clientX, e.clientY);
      const view = useEditorStore.getState().view;
      const doc = screenToDoc(view, p.x, p.y);
      return {
        phase,
        docX: doc.x,
        docY: doc.y,
        screenX: p.x,
        screenY: p.y,
        pressure: e.pressure || 0.5,
        pointerType: e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse',
        button: e.button,
        buttons: e.buttons,
        shift: e.shiftKey,
        alt: e.altKey,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        activePointers: pointersRef.current.size,
      };
    };

    const toolContext = (): ToolContext => {
      const st = useEditorStore.getState();
      return {
        view: st.view,
        viewportSize: { w: sizeRef.current.w, h: sizeRef.current.h },
        invalidate: markAll,
        setCursor: (c: string) => {
          cursorOverrideRef.current = c;
          applyCursor();
        },
        isAltDown: () => altRef.current,
      };
    };

    /** first two tracked pointers (insertion order) for pinch math */
    const pinchTracks = (): { ax: number; ay: number; bx: number; by: number } | null => {
      const pts = Array.from(pointersRef.current.values());
      if (pts.length < 2) return null;
      return { ax: pts[0].x, ay: pts[0].y, bx: pts[1].x, by: pts[1].y };
    };

    const rebaselinePinch = (): void => {
      const t = pinchTracks();
      if (t) {
        pinchRef.current = {
          prevDist: Math.hypot(t.bx - t.ax, t.by - t.ay) || 1,
          prevMidX: (t.ax + t.bx) / 2,
          prevMidY: (t.ay + t.by) / 2,
        };
      }
    };

    /* ---------- pointer handlers ---------- */

    const onPointerDown = (e: PointerEvent): void => {
      e.preventDefault(); // no text selection / middle-click autoscroll
      refreshRect();
      altRef.current = e.altKey;
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        // pointer already gone — gesture falls back to plain element events
      }
      const p = localPoint(e.clientX, e.clientY);
      pointersRef.current.set(e.pointerId, { x: p.x, y: p.y });
      stalePointerRef.current = null;
      hoverPosRef.current = p;
      hoveringRef.current = true;
      interactedRef.current = true;

      const st = useEditorStore.getState();

      // second finger lands → abort tool/nav gesture, start pinch
      if (pointersRef.current.size === 2) {
        if (toolDragRef.current) {
          toolDragRef.current = false;
          const controller = getToolController(st.tool);
          controller?.onPointerCancel?.(eventFromPointer(e, 'cancel'), toolContext());
        }
        panRef.current = null;
        rebaselinePinch();
        markOverlay();
        return;
      }
      if (pointersRef.current.size > 2) return; // extra fingers ignored

      // navigation gestures take priority over tool dispatch
      if (e.button === 1 || spaceRef.current || st.tool === 'hand') {
        panRef.current = { pointerId: e.pointerId, lastX: p.x, lastY: p.y };
        cursorOverrideRef.current = null;
        applyCursor();
        markOverlay();
        return;
      }

      const controller = getToolController(st.tool);
      if (controller?.onPointerDown) {
        controller.onPointerDown(eventFromPointer(e, 'down'), toolContext());
        toolDragRef.current = true;
      }
      markOverlay();
    };

    const onPointerMove = (e: PointerEvent): void => {
      altRef.current = e.altKey;
      refreshRect(); // guards against container moves between enter/down events
      const p = localPoint(e.clientX, e.clientY);
      hoverPosRef.current = p;
      hoveringRef.current = true;
      markOverlay(); // cursor ring / guide hover follow the pointer

      const tracked = pointersRef.current.get(e.pointerId);
      if (tracked) {
        tracked.x = p.x;
        tracked.y = p.y;
      }

      // pinch zoom + two-finger pan (≥ 2 pointers are always a pinch)
      if (pointersRef.current.size >= 2) {
        if (!pinchRef.current) rebaselinePinch();
        const pinch = pinchRef.current;
        const t = pinchTracks();
        if (pinch && t) {
          const dist = Math.hypot(t.bx - t.ax, t.by - t.ay) || 1;
          const midX = (t.ax + t.bx) / 2;
          const midY = (t.ay + t.by) / 2;
          const st = useEditorStore.getState();
          const view = st.view;
          const zoom = clampZoom(view.zoom * (dist / pinch.prevDist));
          const d0 = screenToDoc(view, pinch.prevMidX, pinch.prevMidY);
          st.setView({ zoom, ...anchoredPan(view, zoom, d0.x, d0.y, midX, midY) });
          pinch.prevDist = dist;
          pinch.prevMidX = midX;
          pinch.prevMidY = midY;
        }
        return;
      }

      // the finger that survived a pinch never resumes the aborted stroke
      if (stalePointerRef.current === e.pointerId) return;

      // one-pointer pan (middle button / space / hand tool)
      const pan = panRef.current;
      if (pan && pan.pointerId === e.pointerId) {
        const st = useEditorStore.getState();
        st.setView(panDeltaFor(st.view, p.x - pan.lastX, p.y - pan.lastY));
        pan.lastX = p.x;
        pan.lastY = p.y;
        return;
      }

      // tool dispatch: 'move' while a gesture is active, otherwise hover
      const controller = getToolController(useEditorStore.getState().tool);
      if (controller?.onPointerMove) {
        const phase: PointerPhase = toolDragRef.current || e.buttons !== 0 ? 'move' : 'hover';
        controller.onPointerMove(eventFromPointer(e, phase), toolContext());
      }
    };

    const finishPointer = (e: PointerEvent, cancelled: boolean): void => {
      pointersRef.current.delete(e.pointerId);

      if (pointersRef.current.size >= 2) {
        rebaselinePinch(); // continue pinching with the remaining pair
        return;
      }
      if (pinchRef.current) {
        pinchRef.current = null; // pinch ended
        if (pointersRef.current.size === 1) {
          // the remaining finger must NOT resume the aborted tool stroke
          const remaining = pointersRef.current.keys().next();
          stalePointerRef.current = remaining.done ? null : remaining.value;
        } else {
          stalePointerRef.current = null;
        }
        markOverlay();
        return;
      }
      if (pointersRef.current.size === 0) {
        stalePointerRef.current = null;
      }
      if (panRef.current && panRef.current.pointerId === e.pointerId) {
        panRef.current = null;
        applyCursor();
        markOverlay();
        return;
      }
      if (toolDragRef.current) {
        toolDragRef.current = false;
        const controller = getToolController(useEditorStore.getState().tool);
        if (controller) {
          const ev = eventFromPointer(e, cancelled ? 'cancel' : 'up');
          if (cancelled) controller.onPointerCancel?.(ev, toolContext());
          else controller.onPointerUp?.(ev, toolContext());
        }
      }
      markOverlay();
    };

    const onPointerUp = (e: PointerEvent): void => finishPointer(e, false);
    const onPointerCancel = (e: PointerEvent): void => finishPointer(e, true);

    const onPointerEnter = (e: PointerEvent): void => {
      refreshRect();
      altRef.current = e.altKey;
      hoveringRef.current = true;
      hoverPosRef.current = localPoint(e.clientX, e.clientY);
      markOverlay();
    };

    const onPointerLeave = (e: PointerEvent): void => {
      hoveringRef.current = false;
      markOverlay();
      if (!toolDragRef.current) {
        const controller = getToolController(useEditorStore.getState().tool);
        controller?.onPointerMove?.(eventFromPointer(e, 'leave'), toolContext());
      }
    };

    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
    };

    /* ---------- wheel: ctrl/cmd = zoom at cursor, plain = pan ---------- */

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      refreshRect();
      const p = localPoint(e.clientX, e.clientY);
      interactedRef.current = true;
      const st = useEditorStore.getState();
      if (e.ctrlKey || e.metaKey) {
        st.zoomBy(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
      } else {
        st.setView(panDeltaFor(st.view, -e.deltaX, -e.deltaY));
      }
    };

    /* ---------- keyboard: space = temporary hand, alt tracking ---------- */

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') altRef.current = true;
      if (e.key === ' ' && hoveringRef.current && !e.repeat && !spaceRef.current) {
        spaceRef.current = true;
        e.preventDefault();
        applyCursor();
        markOverlay();
      }
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') altRef.current = false;
      if (e.key === ' ' && spaceRef.current) {
        spaceRef.current = false;
        applyCursor();
        markOverlay();
      }
    };

    /** safety valve: drop every transient gesture state when the window blurs */
    const onWindowBlur = (): void => {
      spaceRef.current = false;
      altRef.current = false;
      pointersRef.current.clear();
      pinchRef.current = null;
      panRef.current = null;
      toolDragRef.current = false;
      stalePointerRef.current = null;
      applyCursor();
      markOverlay();
    };

    /* ---------- external events ---------- */

    const onPfFit = (): void => {
      interactedRef.current = true;
      const { w, h } = sizeRef.current;
      if (w > 0 && h > 0) useEditorStore.getState().fitToScreen(w, h);
    };

    /* ---------- resize (DPR-aware, doc center anchored) ---------- */

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = entry.contentRect.width;
      const h = entry.contentRect.height;
      const prev = sizeRef.current;
      resizeCanvases(w, h);
      refreshRect();
      if (prev.w > 0 && (Math.abs(w - prev.w) > 0.5 || Math.abs(h - prev.h) > 0.5)) {
        // keep the document anchored: shift pan by half the size delta
        const st = useEditorStore.getState();
        st.setView(panDeltaFor(st.view, (w - prev.w) / 2, (h - prev.h) / 2));
      }
      markAll();
      if (!interactedRef.current && w > 0 && h > 0) {
        useEditorStore.getState().fitToScreen(w, h);
      }
    });
    resizeObserver.observe(container);

    /* ---------- wiring ---------- */

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerCancel);
    container.addEventListener('pointerenter', onPointerEnter);
    container.addEventListener('pointerleave', onPointerLeave);
    container.addEventListener('contextmenu', onContextMenu);
    container.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('pf:fit', onPfFit);
    window.addEventListener('scroll', refreshRect, true);

    return () => {
      cancelAnimationFrame(rafRef.current);
      unsubscribe();
      resizeObserver.disconnect();
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerCancel);
      container.removeEventListener('pointerenter', onPointerEnter);
      container.removeEventListener('pointerleave', onPointerLeave);
      container.removeEventListener('contextmenu', onContextMenu);
      container.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('pf:fit', onPfFit);
      window.removeEventListener('scroll', refreshRect, true);
    };
  }, [markAll, markDisplay, markOverlay, applyCursor]);

  return (
    <div ref={containerRef} className="pf-canvas pf-workspace relative h-full w-full select-none overflow-hidden">
      <canvas ref={displayRef} className="pf-canvas absolute inset-0 h-full w-full" />
      <canvas ref={overlayRef} className="pf-canvas pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  );
}
