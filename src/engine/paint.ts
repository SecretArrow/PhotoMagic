/**
 * Paint, shape-path and text-layout helpers shared by the renderer,
 * shape tools and export pipeline. Client-side only (Canvas APIs).
 */

import type { Paint, PathCommand, ShapeGeometry, StrokeStyle, TextContent } from './types';
import type { AnyContext2D } from './raster';

/* --------------------------- paint --------------------------- */

export function resolvePaint(
  ctx: AnyContext2D,
  paint: Paint,
  bbox: { x: number; y: number; w: number; h: number },
): string | CanvasGradient {
  if (paint.type === 'solid') return paint.color;
  const { x, y, w, h } = bbox;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.max(1, Math.hypot(w, h) / 2);
  let grad: CanvasGradient;
  if (paint.gradient === 'linear') {
    const half = Math.max(w, h) / 2;
    const dx = Math.cos(paint.angle) * half;
    const dy = Math.sin(paint.angle) * half;
    grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  } else if (paint.gradient === 'radial') {
    grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  } else {
    grad = ctx.createConicGradient(paint.angle, cx, cy);
  }
  const stops = [...paint.stops].sort((a, b) => a.offset - b.offset);
  for (const s of stops) {
    grad.addColorStop(Math.min(1, Math.max(0, s.offset)), withAlpha(s.color, s.alpha));
  }
  return grad;
}

function withAlpha(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

/* --------------------------- shapes --------------------------- */

export function buildShapePath(g: ShapeGeometry): Path2D {
  const p = new Path2D();
  switch (g.type) {
    case 'rect': {
      if (g.radius > 0) {
        const r = Math.min(g.radius, Math.abs(g.w) / 2, Math.abs(g.h) / 2);
        const x = Math.min(g.x, g.x + g.w);
        const y = Math.min(g.y, g.y + g.h);
        p.roundRect ? p.roundRect(x, y, Math.abs(g.w), Math.abs(g.h), r) : manualRoundRect(p, x, y, Math.abs(g.w), Math.abs(g.h), r);
      } else {
        p.rect(Math.min(g.x, g.x + g.w), Math.min(g.y, g.y + g.h), Math.abs(g.w), Math.abs(g.h));
      }
      break;
    }
    case 'ellipse': {
      p.ellipse(g.x + g.w / 2, g.y + g.h / 2, Math.abs(g.w) / 2, Math.abs(g.h) / 2, 0, 0, Math.PI * 2);
      break;
    }
    case 'line': {
      p.moveTo(g.x1, g.y1);
      p.lineTo(g.x2, g.y2);
      break;
    }
    case 'polygon': {
      for (let i = 0; i < Math.max(3, g.sides); i++) {
        const a = g.rotation + (i / Math.max(3, g.sides)) * Math.PI * 2 - Math.PI / 2;
        const px = g.cx + Math.cos(a) * g.radius;
        const py = g.cy + Math.sin(a) * g.radius;
        i === 0 ? p.moveTo(px, py) : p.lineTo(px, py);
      }
      p.closePath();
      break;
    }
    case 'star': {
      const n = Math.max(3, g.points);
      for (let i = 0; i < n * 2; i++) {
        const rad = i % 2 === 0 ? g.outer : g.inner;
        const a = g.rotation + (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
        const px = g.cx + Math.cos(a) * rad;
        const py = g.cy + Math.sin(a) * rad;
        i === 0 ? p.moveTo(px, py) : p.lineTo(px, py);
      }
      p.closePath();
      break;
    }
    case 'path': {
      for (const sp of g.subpaths) {
        let cx = 0;
        let cy = 0;
        for (const c of sp.commands) {
          switch (c.c) {
            case 'M':
              p.moveTo(c.x, c.y);
              cx = c.x;
              cy = c.y;
              break;
            case 'L':
              p.lineTo(c.x, c.y);
              cx = c.x;
              cy = c.y;
              break;
            case 'C':
              p.bezierCurveTo(c.c1x, c.c1y, c.c2x, c.c2y, c.x, c.y);
              cx = c.x;
              cy = c.y;
              break;
            case 'Q':
              p.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
              cx = c.x;
              cy = c.y;
              break;
            case 'Z':
              p.closePath();
              break;
          }
        }
      }
      break;
    }
  }
  return p;
}

function manualRoundRect(p: Path2D, x: number, y: number, w: number, h: number, r: number): void {
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.arcTo(x + w, y, x + w, y + r, r);
  p.lineTo(x + w, y + h - r);
  p.arcTo(x + w, y + h, x + w - r, y + h, r);
  p.lineTo(x + r, y + h);
  p.arcTo(x, y + h, x, y + h - r, r);
  p.lineTo(x, y + r);
  p.arcTo(x, y, x + r, y, r);
  p.closePath();
}

export function applyStroke(ctx: AnyContext2D, path: Path2D, stroke: StrokeStyle): void {
  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = Math.max(0.5, stroke.width);
  ctx.lineCap = stroke.cap;
  ctx.lineJoin = stroke.join;
  if (stroke.dash && stroke.dash.length > 0) ctx.setLineDash(stroke.dash);
  else ctx.setLineDash([]);
  ctx.stroke(path);
  ctx.restore();
}

/* --------------------------- text --------------------------- */

export function fontString(t: TextContent): string {
  const italic = t.italic ? 'italic ' : '';
  return `${italic}${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
}

export interface TextLayoutLine {
  text: string;
  x: number;
  y: number; // baseline
  width: number;
}

export interface TextLayout {
  lines: TextLayoutLine[];
  width: number;
  height: number;
  ascent: number;
}

/**
 * Lays out text content in document space.
 * Point text (boxWidth = 0): no wrapping, x/y is the first baseline anchor adjusted for ascent.
 * Paragraph text (boxWidth > 0): wraps words to the box and respects alignment.
 */
export function layoutText(t: TextContent, ctx: AnyContext2D): TextLayout {
  const c = ctx;
  c.font = fontString(t);
  if ('letterSpacing' in c) {
    (c as CanvasRenderingContext2D).letterSpacing = `${t.letterSpacing}px`;
  }
  const size = t.fontSize;
  const lineH = size * t.lineHeight;
  const paragraphs = t.text.split('\n');
  const rawLines: string[] = [];
  for (const para of paragraphs) {
    if (t.boxWidth > 0) {
      const words = para.split(' ');
      let line = '';
      for (const w of words) {
        const candidate = line ? `${line} ${w}` : w;
        if (c.measureText(candidate).width > t.boxWidth && line) {
          rawLines.push(line);
          line = w;
        } else {
          line = candidate;
        }
      }
      rawLines.push(line);
    } else {
      rawLines.push(para);
    }
  }
  const metrics = c.measureText('Mg');
  const ascent = metrics.actualBoundingBoxAscent || size * 0.8;
  const lines: TextLayoutLine[] = [];
  let width = 0;
  rawLines.forEach((text, i) => {
    const w = c.measureText(text).width;
    width = Math.max(width, w);
    lines.push({
      text,
      x: alignX(t, w),
      y: t.y + ascent + i * lineH,
      width: w,
    });
  });
  return { lines, width: Math.max(width, 1), height: Math.max(rawLines.length * lineH, size), ascent };
}

function alignX(t: TextContent, lineWidth: number): number {
  if (t.boxWidth > 0) {
    if (t.align === 'center') return t.x + (t.boxWidth - lineWidth) / 2;
    if (t.align === 'right') return t.x + t.boxWidth - lineWidth;
    return t.x;
  }
  if (t.align === 'center') return t.x - lineWidth / 2;
  if (t.align === 'right') return t.x - lineWidth;
  return t.x;
}

/** Draws laid-out text (fill + optional underline) into a context. */
export function drawTextLayout(ctx: AnyContext2D, t: TextContent, layout: TextLayout, color?: string): void {
  ctx.save();
  ctx.font = fontString(t);
  if ('letterSpacing' in ctx) {
    (ctx as CanvasRenderingContext2D).letterSpacing = `${t.letterSpacing}px`;
  }
  ctx.fillStyle = color ?? t.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const line of layout.lines) {
    ctx.fillText(line.text, line.x, line.y);
    if (t.underline && line.text.length > 0) {
      const metrics = ctx.measureText(line.text);
      const underlineY = line.y + t.fontSize * 0.12;
      ctx.fillRect(line.x, underlineY, metrics.width, Math.max(1, t.fontSize * 0.06));
    }
  }
  ctx.restore();
}

/** Bounding box of laid out text in document space (for hit testing/transform). */
export function textBBox(t: TextContent, ctx: AnyContext2D): { x: number; y: number; w: number; h: number } {
  const layout = layoutText(t, ctx);
  const minX = Math.min(...layout.lines.map((l) => l.x));
  const maxX = Math.max(...layout.lines.map((l) => l.x + l.width));
  return {
    x: minX,
    y: t.y,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, layout.height),
  };
}

/** Commands helper for the pen tool — builds Path2D from commands. */
export function commandsToPath2D(commands: PathCommand[], closed: boolean): Path2D {
  const p = new Path2D();
  for (const c of commands) {
    switch (c.c) {
      case 'M':
        p.moveTo(c.x, c.y);
        break;
      case 'L':
        p.lineTo(c.x, c.y);
        break;
      case 'C':
        p.bezierCurveTo(c.c1x, c.c1y, c.c2x, c.c2y, c.x, c.y);
        break;
      case 'Q':
        p.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
        break;
      case 'Z':
        p.closePath();
        break;
    }
  }
  if (closed) p.closePath();
  return p;
}
