/**
 * Transform operations over the layer tree.
 *
 * These functions rebuild layer metadata (and pixel buffers where needed)
 * for document-level operations: image resize, canvas resize/crop shifts,
 * flips and 90° rotations. Pure with respect to history — the store wraps
 * results in undo/redo entries.
 */

import type { Layer, RasterLayer, ShapeLayer, TextLayer } from '../types';
import { cloneCanvas, ctx2d, makeCanvas, imageDataFromCanvas, type AnyCanvas } from '../raster';
import { cloneGeometry, shapeBBox } from '../document';

/** Shifts a layer's content reference frame by (dx, dy) in document space. */
export function shiftLayerContent(layer: Layer, dx: number, dy: number): Layer {
  switch (layer.kind) {
    case 'raster':
      return { ...(layer as RasterLayer), x: layer.x + dx, y: layer.y + dy };
    case 'text': {
      const t = layer as TextLayer;
      return { ...t, text: { ...t.text, x: t.text.x + dx, y: t.text.y + dy } };
    }
    case 'shape': {
      const s = layer as ShapeLayer;
      const g = shiftGeometry(s.shape, dx, dy);
      return { ...s, shape: g, bbox: shapeBBox(g) };
    }
    case 'fill':
      return { ...layer };
    case 'adjustment':
      return { ...layer };
    case 'group':
      return { ...layer, children: layer.children.map((c) => shiftLayerContent(c, dx, dy)) };
  }
}

export function shiftGeometry(g: ShapeLayer['shape'], dx: number, dy: number): ShapeLayer['shape'] {
  switch (g.type) {
    case 'rect':
      return { ...g, x: g.x + dx, y: g.y + dy };
    case 'ellipse':
      return { ...g, x: g.x + dx, y: g.y + dy };
    case 'line':
      return { ...g, x1: g.x1 + dx, y1: g.y1 + dy, x2: g.x2 + dx, y2: g.y2 + dy };
    case 'polygon':
      return { ...g, cx: g.cx + dx, cy: g.cy + dy };
    case 'star':
      return { ...g, cx: g.cx + dx, cy: g.cy + dy };
    case 'path':
      return {
        type: 'path',
        subpaths: g.subpaths.map((sp) => ({
          closed: sp.closed,
          commands: sp.commands.map((c) => {
            if (c.c === 'Z') return c;
            if (c.c === 'C') return { ...c, c1x: c.c1x + dx, c1y: c.c1y + dy, c2x: c.c2x + dx, c2y: c.c2y + dy, x: c.x + dx, y: c.y + dy };
            if (c.c === 'Q') return { ...c, cx: c.cx + dx, cy: c.cy + dy, x: c.x + dx, y: c.y + dy };
            return { ...c, x: c.x + dx, y: c.y + dy };
          }),
        })),
      };
  }
}

/**
 * Resamples all layers from (oldW × oldH) into (newW × newH).
 * Uses smooth browser resampling for scale-downs and upscales.
 */
export function scaleLayers(layers: Layer[], oldW: number, oldH: number, newW: number, newH: number): Layer[] {
  const sx = newW / oldW;
  const sy = newH / oldH;
  const scaleOne = (layer: Layer): Layer => {
    switch (layer.kind) {
      case 'raster': {
        const r = layer as RasterLayer;
        const canvas = resizeCanvasBuffer(r.canvas, Math.max(1, Math.round(r.canvas.width * sx)), Math.max(1, Math.round(r.canvas.height * sy)));
        return { ...r, canvas, x: Math.round(r.x * sx), y: Math.round(r.y * sy) };
      }
      case 'text': {
        const t = layer as TextLayer;
        return {
          ...t,
          text: {
            ...t.text,
            fontSize: Math.max(1, t.text.fontSize * ((sx + sy) / 2)),
            x: t.text.x * sx,
            y: t.text.y * sy,
            letterSpacing: t.text.letterSpacing * sx,
            boxWidth: t.text.boxWidth > 0 ? t.text.boxWidth * sx : 0,
          },
        };
      }
      case 'shape': {
        const s = layer as ShapeLayer;
        const g = scaleGeometry(s.shape, sx, sy);
        return { ...s, shape: g, bbox: shapeBBox(g), stroke: s.stroke ? { ...s.stroke, width: Math.max(0.5, s.stroke.width * ((sx + sy) / 2)) } : null };
      }
      case 'group':
        return { ...layer, children: layer.children.map(scaleOne) };
      case 'fill':
      case 'adjustment':
        return { ...layer };
    }
  };
  return layers.map((l) => (l.kind === 'group' ? { ...l, children: l.children.map(scaleOne) } : scaleOne(l)));
}

function scaleGeometry(g: ShapeLayer['shape'], sx: number, sy: number): ShapeLayer['shape'] {
  switch (g.type) {
    case 'rect':
      return { ...g, x: g.x * sx, y: g.y * sy, w: g.w * sx, h: g.h * sy, radius: g.radius * ((sx + sy) / 2) };
    case 'ellipse':
      return { ...g, x: g.x * sx, y: g.y * sy, w: g.w * sx, h: g.h * sy };
    case 'line':
      return { ...g, x1: g.x1 * sx, y1: g.y1 * sy, x2: g.x2 * sx, y2: g.y2 * sy };
    case 'polygon':
      return { ...g, cx: g.cx * sx, cy: g.cy * sy, radius: g.radius * ((sx + sy) / 2) };
    case 'star':
      return { ...g, cx: g.cx * sx, cy: g.cy * sy, outer: g.outer * ((sx + sy) / 2), inner: g.inner * ((sx + sy) / 2) };
    case 'path':
      return {
        type: 'path',
        subpaths: g.subpaths.map((sp) => ({
          closed: sp.closed,
          commands: sp.commands.map((c) => {
            if (c.c === 'Z') return c;
            if (c.c === 'C') return { ...c, c1x: c.c1x * sx, c1y: c.c1y * sy, c2x: c.c2x * sx, c2y: c.c2y * sy, x: c.x * sx, y: c.y * sy };
            if (c.c === 'Q') return { ...c, cx: c.cx * sx, cy: c.cy * sy, x: c.x * sx, y: c.y * sy };
            return { ...c, x: c.x * sx, y: c.y * sy };
          }),
        })),
      };
  }
}

export function resizeCanvasBuffer(src: AnyCanvas, w: number, h: number): AnyCanvas {
  const out = makeCanvas(w, h);
  const ctx = ctx2d(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
  return out;
}

/** Flips all layers horizontally (axis=x) or vertically (axis=y). */
export function flipLayers(layers: Layer[], docW: number, docH: number, axis: 'x' | 'y'): Layer[] {
  const flipOne = (layer: Layer): Layer => {
    switch (layer.kind) {
      case 'raster': {
        const r = layer as RasterLayer;
        const flipped = flipCanvas(r.canvas, axis);
        const nx = axis === 'x' ? docW - r.x - r.canvas.width : r.x;
        const ny = axis === 'y' ? docH - r.y - r.canvas.height : r.y;
        return { ...r, canvas: flipped, x: nx, y: ny };
      }
      case 'text': {
        // text flip = mirror around document center (approximation: reposition)
        const t = layer as TextLayer;
        return {
          ...t,
          text: {
            ...t.text,
            x: axis === 'x' ? docW - t.text.x : t.text.x,
            y: axis === 'y' ? docH - t.text.y : t.text.y,
            align: axis === 'x' && t.text.align === 'left' ? 'right' : axis === 'x' && t.text.align === 'right' ? 'left' : t.text.align,
          },
        };
      }
      case 'shape': {
        const s = layer as ShapeLayer;
        const g = flipGeometry(s.shape, docW, docH, axis);
        return { ...s, shape: g, bbox: shapeBBox(g) };
      }
      default:
        return { ...layer };
    }
  };
  return layers.map((l) => (l.kind === 'group' ? { ...l, children: l.children.map(flipOne) } : flipOne(l)));
}

function flipCanvas(src: AnyCanvas, axis: 'x' | 'y'): AnyCanvas {
  const out = makeCanvas(src.width, src.height);
  const ctx = ctx2d(out);
  ctx.save();
  if (axis === 'x') {
    ctx.translate(src.width, 0);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(0, src.height);
    ctx.scale(1, -1);
  }
  ctx.drawImage(src as CanvasImageSource, 0, 0);
  ctx.restore();
  return out;
}

function flipGeometry(g: ShapeLayer['shape'], docW: number, docH: number, axis: 'x' | 'y'): ShapeLayer['shape'] {
  const fx = (x: number) => docW - x;
  const fy = (y: number) => docH - y;
  switch (g.type) {
    case 'rect':
      return { ...g, x: axis === 'x' ? fx(g.x + g.w) : g.x, y: axis === 'y' ? fy(g.y + g.h) : g.y };
    case 'ellipse':
      return { ...g, x: axis === 'x' ? fx(g.x + g.w) : g.x, y: axis === 'y' ? fy(g.y + g.h) : g.y };
    case 'line':
      return { ...g, x1: axis === 'x' ? fx(g.x1) : g.x1, x2: axis === 'x' ? fx(g.x2) : g.x2, y1: axis === 'y' ? fy(g.y1) : g.y1, y2: axis === 'y' ? fy(g.y2) : g.y2 };
    case 'polygon':
      return { ...g, cx: axis === 'x' ? fx(g.cx) : g.cx, cy: axis === 'y' ? fy(g.cy) : g.cy, rotation: axis === 'x' ? -g.rotation : g.rotation };
    case 'star':
      return { ...g, cx: axis === 'x' ? fx(g.cx) : g.cx, cy: axis === 'y' ? fy(g.cy) : g.cy, rotation: axis === 'x' ? -g.rotation : g.rotation };
    case 'path':
      return {
        type: 'path',
        subpaths: g.subpaths.map((sp) => ({
          closed: sp.closed,
          commands: sp.commands.map((c) => {
            if (c.c === 'Z') return c;
            const x = axis === 'x' ? fx(c.x) : c.x;
            const y = axis === 'y' ? fy(c.y) : c.y;
            if (c.c === 'C') return { ...c, x, y, c1x: axis === 'x' ? fx(c.c1x) : c.c1x, c1y: axis === 'y' ? fy(c.c1y) : c.c1y, c2x: axis === 'x' ? fx(c.c2x) : c.c2x, c2y: axis === 'y' ? fy(c.c2y) : c.c2y };
            if (c.c === 'Q') return { ...c, x, y, cx: axis === 'x' ? fx(c.cx) : c.cx, cy: axis === 'y' ? fy(c.cy) : c.cy };
            return { ...c, x, y };
          }),
        })),
      };
  }
}

/** Rotates the whole document by 90°. Returns new layers + swapped dimensions. */
export function rotateLayers90(
  layers: Layer[],
  docW: number,
  docH: number,
  clockwise: boolean,
): { layers: Layer[]; width: number; height: number } {
  const newW = docH;
  const newH = docW;
  const rotateOne = (layer: Layer): Layer => {
    switch (layer.kind) {
      case 'raster': {
        const r = layer as RasterLayer;
        const rotated = rotateCanvas90(r.canvas, clockwise);
        let nx: number;
        let ny: number;
        if (clockwise) {
          nx = newW - r.y - r.canvas.height;
          ny = r.x;
        } else {
          nx = r.y;
          ny = newH - r.x - r.canvas.width;
        }
        return { ...r, canvas: rotated, x: nx, y: ny };
      }
      case 'text': {
        const t = layer as TextLayer;
        if (clockwise) {
          return { ...t, text: { ...t.text, x: newW - t.text.y, y: t.text.x } };
        }
        return { ...t, text: { ...t.text, x: t.text.y, y: newH - t.text.x } };
      }
      case 'shape': {
        const s = layer as ShapeLayer;
        const g = rotateGeometry90(s.shape, docW, docH, clockwise);
        return { ...s, shape: g, bbox: shapeBBox(g) };
      }
      default:
        return { ...layer };
    }
  };
  return { layers: layers.map((l) => (l.kind === 'group' ? { ...l, children: l.children.map(rotateOne) } : rotateOne(l))), width: newW, height: newH };
}

function rotateCanvas90(src: AnyCanvas, clockwise: boolean): AnyCanvas {
  const out = makeCanvas(src.height, src.width);
  const ctx = ctx2d(out);
  ctx.save();
  if (clockwise) {
    ctx.translate(src.height, 0);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(0, src.width);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(src as CanvasImageSource, 0, 0);
  ctx.restore();
  return out;
}

function rotateGeometry90(g: ShapeLayer['shape'], docW: number, docH: number, cw: boolean): ShapeLayer['shape'] {
  // transform point (x,y) → cw: (docH - y, x)  |  ccw: (y, docW - x)
  const px = (x: number, y: number) => (cw ? docH - y : y);
  const py = (x: number, y: number) => (cw ? x : docW - x);
  switch (g.type) {
    case 'rect': {
      const x1 = px(g.x, g.y);
      const y1 = py(g.x, g.y);
      return { ...g, x: x1, y: y1, w: g.h, h: g.w, radius: g.radius };
    }
    case 'ellipse': {
      const x1 = px(g.x, g.y);
      const y1 = py(g.x, g.y);
      return { ...g, x: x1, y: y1, w: g.h, h: g.w };
    }
    case 'line':
      return { ...g, x1: px(g.x1, g.y1), y1: py(g.x1, g.y1), x2: px(g.x2, g.y2), y2: py(g.x2, g.y2) };
    case 'polygon':
      return { ...g, cx: px(g.cx, g.cy), cy: py(g.cx, g.cy), rotation: g.rotation + (cw ? Math.PI / 2 : -Math.PI / 2) };
    case 'star':
      return { ...g, cx: px(g.cx, g.cy), cy: py(g.cx, g.cy), rotation: g.rotation + (cw ? Math.PI / 2 : -Math.PI / 2) };
    case 'path':
      return {
        type: 'path',
        subpaths: g.subpaths.map((sp) => ({
          closed: sp.closed,
          commands: sp.commands.map((c) => {
            if (c.c === 'Z') return c;
            const x = px(c.x, c.y);
            const y = py(c.x, c.y);
            if (c.c === 'C') return { ...c, x, y, c1x: px(c.c1x, c.c1y), c1y: py(c.c1x, c.c1y), c2x: px(c.c2x, c.c2y), c2y: py(c.c2x, c.c2y) };
            if (c.c === 'Q') return { ...c, x, y, cx: px(c.cx, c.cy), cy: py(c.cx, c.cy) };
            return { ...c, x, y };
          }),
        })),
      };
  }
}

/** Rasterizes a transformed snapshot of a layer canvas (for move/transform commit). */
export function transformCanvas(src: AnyCanvas, matrix: { a: number; b: number; c: number; d: number; e: number; f: number }, outW: number, outH: number): AnyCanvas {
  const out = makeCanvas(outW, outH);
  const ctx = ctx2d(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
  ctx.drawImage(src as CanvasImageSource, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return out;
}

/** Exported for tests: clone with independent buffer. */
export { cloneCanvas, imageDataFromCanvas, cloneGeometry };
