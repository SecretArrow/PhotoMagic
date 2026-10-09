/**
 * Color utilities — conversions and histogram math.
 * Pure functions, unit-testable without DOM.
 */

import type { HSL, RGB } from './types';

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/* ------------------------------ hex ------------------------------ */

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (n: number) => clamp255(Math.round(n)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgb(hex: string): RGB {
  let s = hex.trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length !== 6 || /[^0-9a-fA-F]/.test(s)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

export function isValidHex(hex: string): boolean {
  return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim());
}

/* ------------------------------ hsl ------------------------------ */

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = ln - c / 2;
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function hexToHsl(hex: string): HSL {
  return rgbToHsl(hexToRgb(hex));
}

export function hslToHex(hsl: HSL): string {
  return rgbToHex(hslToRgb(hsl));
}

/* --------------------------- css colors --------------------------- */

/** Accepts #hex, rgb(), rgba(), hsl(), hsla(), and named colors via canvas fallback. */
export function parseCssColor(input: string): { color: string; alpha: number } {
  const s = input.trim();
  const rgba = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)$/i);
  if (rgba) {
    const a = rgba[4];
    let alpha = 1;
    if (a != null) alpha = a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
    return { color: rgbToHex({ r: +rgba[1], g: +rgba[2], b: +rgba[3] }), alpha: clamp(alpha, 0, 1) };
  }
  if (isValidHex(s)) return { color: rgbToHex(hexToRgb(s)), alpha: 1 };
  const hsla = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?(?:[\s,/]+([\d.%]+))?\s*\)$/i);
  if (hsla) {
    const a = hsla[4];
    let alpha = 1;
    if (a != null) alpha = a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
    return { color: hslToHex({ h: +hsla[1], s: +hsla[2], l: +hsla[3] }), alpha: clamp(alpha, 0, 1) };
  }
  return { color: '#000000', alpha: 1 };
}

/** Adds alpha to a hex color and returns an 8-digit hex (#RRGGBBAA). */
export function hexWithAlpha(hex: string, alpha: number): string {
  const a = Math.round(clamp(alpha, 0, 1) * 255)
    .toString(16)
    .padStart(2, '0');
  return rgbToHex(hexToRgb(hex)) + a;
}

/* --------------------------- luminance --------------------------- */

export function relativeLuminance({ r, g, b }: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Perceptual (Rec.601) luma used for grayscale/quick ops. */
export function luma601(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/* --------------------------- histogram --------------------------- */

export interface HistogramResult {
  r: number[];
  g: number[];
  b: number[];
  luminance: number[];
  max: number;
}

/** Computes per-channel + luma histograms from RGBA data (alpha ignored for RGB). */
export function computeHistogram(data: Uint8ClampedArray, precision = 256): HistogramResult {
  const size = precision;
  const r = new Array(size).fill(0);
  const g = new Array(size).fill(0);
  const b = new Array(size).fill(0);
  const luminance = new Array(size).fill(0);
  const scale = (size - 1) / 255;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue; // fully transparent pixels don't contribute
    const rv = data[i];
    const gv = data[i + 1];
    const bv = data[i + 2];
    r[Math.round(rv * scale)]++;
    g[Math.round(gv * scale)]++;
    b[Math.round(bv * scale)]++;
    luminance[Math.round(luma601(rv, gv, bv) * scale)]++;
  }
  let max = 0;
  for (let i = 0; i < size; i++) max = Math.max(max, r[i], g[i], b[i]);
  return { r, g, b, luminance, max };
}
