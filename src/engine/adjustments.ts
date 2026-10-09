/**
 * Adjustment pixel operations.
 *
 * Pure math over RGBA buffers — shared by the Web Worker (apply to layer
 * pixels) and the renderer (adjustment layers evaluated on the composite).
 * Every function is deterministic for identical inputs.
 */

import type { AdjustmentSpec } from './types';
import { clamp255, luma601 } from './color';

export function applyAdjustments(data: Uint8ClampedArray, specs: AdjustmentSpec[]): void {
  for (const spec of specs) applyOne(data, spec);
}

function applyOne(data: Uint8ClampedArray, spec: AdjustmentSpec): void {
  switch (spec.type) {
    case 'brightness-contrast': {
      // brightness: -100..100 (additive), contrast: -100..100 (pivot 128)
      const b = (spec.brightness / 100) * 127.5;
      const c = spec.contrast / 100;
      const f = c <= 0 ? 1 + c : 1 / (1 - c * 0.99);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = clamp255((data[i] + b - 128) * f + 128);
        data[i + 1] = clamp255((data[i + 1] + b - 128) * f + 128);
        data[i + 2] = clamp255((data[i + 2] + b - 128) * f + 128);
      }
      break;
    }
    case 'exposure': {
      const m = Math.pow(2, spec.exposure);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = clamp255(data[i] * m);
        data[i + 1] = clamp255(data[i + 1] * m);
        data[i + 2] = clamp255(data[i + 2] * m);
      }
      break;
    }
    case 'hue-saturation': {
      hueSaturation(data, spec.hue, spec.saturation / 100, spec.lightness / 100);
      break;
    }
    case 'vibrance': {
      // saturate low-saturation pixels more than high-saturation ones
      const amt = spec.amount / 100;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const sat = (mx - mn) / 255; // 0..1
        const k = amt * (1 - sat);
        const avg = (r + g + b) / 3;
        data[i] = clamp255(avg + (r - avg) * (1 + k));
        data[i + 1] = clamp255(avg + (g - avg) * (1 + k));
        data[i + 2] = clamp255(avg + (b - avg) * (1 + k));
      }
      break;
    }
    case 'temperature': {
      const t = (spec.temperature / 100) * 40;
      const ti = (spec.tint / 100) * 30;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = clamp255(data[i] + t);
        data[i + 1] = clamp255(data[i + 1] + ti * 0.6);
        data[i + 2] = clamp255(data[i + 2] - t);
      }
      break;
    }
    case 'invert': {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i];
        data[i + 1] = 255 - data[i + 1];
        data[i + 2] = 255 - data[i + 2];
      }
      break;
    }
    case 'grayscale': {
      const amt = spec.amount / 100;
      for (let i = 0; i < data.length; i += 4) {
        const y = luma601(data[i], data[i + 1], data[i + 2]);
        data[i] = clamp255(data[i] + (y - data[i]) * amt);
        data[i + 1] = clamp255(data[i + 1] + (y - data[i + 1]) * amt);
        data[i + 2] = clamp255(data[i + 2] + (y - data[i + 2]) * amt);
      }
      break;
    }
    case 'sepia': {
      const amt = spec.amount / 100;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const sr = clamp255(0.393 * r + 0.769 * g + 0.189 * b);
        const sg = clamp255(0.349 * r + 0.686 * g + 0.168 * b);
        const sb = clamp255(0.272 * r + 0.534 * g + 0.131 * b);
        data[i] = clamp255(r + (sr - r) * amt);
        data[i + 1] = clamp255(g + (sg - g) * amt);
        data[i + 2] = clamp255(b + (sb - b) * amt);
      }
      break;
    }
    case 'posterize': {
      const levels = Math.max(2, Math.round(spec.levels));
      const step = 255 / (levels - 1);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = clamp255(Math.round(data[i] / step) * step);
        data[i + 1] = clamp255(Math.round(data[i + 1] / step) * step);
        data[i + 2] = clamp255(Math.round(data[i + 2] / step) * step);
      }
      break;
    }
    case 'threshold': {
      const lv = spec.level;
      for (let i = 0; i < data.length; i += 4) {
        const y = luma601(data[i], data[i + 1], data[i + 2]);
        const v = y >= lv ? 255 : 0;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
      }
      break;
    }
    case 'gamma': {
      const inv = 1 / Math.max(0.01, spec.gamma);
      // build LUT for speed
      const lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) lut[v] = clamp255(255 * Math.pow(v / 255, inv));
      for (let i = 0; i < data.length; i += 4) {
        data[i] = lut[data[i]];
        data[i + 1] = lut[data[i + 1]];
        data[i + 2] = lut[data[i + 2]];
      }
      break;
    }
    case 'levels': {
      const { inBlack, inWhite, gamma, outBlack, outWhite } = spec;
      const range = Math.max(1, inWhite - inBlack);
      const lut = new Uint8ClampedArray(256);
      const g = 1 / Math.max(0.01, gamma);
      for (let v = 0; v < 256; v++) {
        const n = clamp255((v - inBlack) / range);
        const gm = Math.pow(n, g);
        lut[v] = clamp255(outBlack + gm * (outWhite - outBlack));
      }
      for (let i = 0; i < data.length; i += 4) {
        data[i] = lut[data[i]];
        data[i + 1] = lut[data[i + 1]];
        data[i + 2] = lut[data[i + 2]];
      }
      break;
    }
  }
}

/** HSL-space hue rotation / saturation / lightness on RGB buffer. */
export function hueSaturation(data: Uint8ClampedArray, hueDeg: number, satMul: number, lightAdd: number): void {
  if (hueDeg === 0 && satMul === 1 && lightAdd === 0) return;
  const cosH = Math.cos((hueDeg * Math.PI) / 180);
  const sinH = Math.sin((hueDeg * Math.PI) / 180);
  // hue rotation matrix (YIQ-based approximation, deterministic)
  const m = [
    0.299 + 0.701 * cosH + 0.168 * sinH,
    0.587 - 0.587 * cosH + 0.330 * sinH,
    0.114 - 0.114 * cosH - 0.497 * sinH,
    0.299 - 0.299 * cosH - 0.328 * sinH,
    0.587 + 0.413 * cosH + 0.035 * sinH,
    0.114 - 0.114 * cosH + 0.292 * sinH,
    0.299 - 0.3 * cosH + 1.25 * sinH,
    0.587 - 0.588 * cosH - 1.05 * sinH,
    0.114 + 0.886 * cosH - 0.203 * sinH,
  ];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    let nr = r * m[0] + g * m[1] + b * m[2];
    let ng = r * m[3] + g * m[4] + b * m[5];
    let nb = r * m[6] + g * m[7] + b * m[8];
    if (satMul !== 1) {
      const avg = 0.299 * nr + 0.587 * ng + 0.114 * nb;
      nr = avg + (nr - avg) * satMul;
      ng = avg + (ng - avg) * satMul;
      nb = avg + (nb - avg) * satMul;
    }
    if (lightAdd !== 0) {
      const add = lightAdd * 255;
      nr += add;
      ng += add;
      nb += add;
    }
    data[i] = clamp255(nr);
    data[i + 1] = clamp255(ng);
    data[i + 2] = clamp255(nb);
  }
}
