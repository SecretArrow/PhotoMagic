/**
 * Adjustment presets shared by the layers panel (add-adjustment menu) and
 * the adjustments panel (per-type editors). Defaults match the engine's
 * AdjustmentSpec contract (see src/engine/types.ts).
 */

import type { AdjustmentSpec, AdjustmentType } from '../engine/types';

export interface AdjustmentPreset {
  type: AdjustmentType;
  labelKey:
    | 'adjust.brightnessContrast'
    | 'adjust.exposure'
    | 'adjust.hueSaturation'
    | 'adjust.vibrance'
    | 'adjust.temperature'
    | 'adjust.invert'
    | 'adjust.grayscale'
    | 'adjust.sepia'
    | 'adjust.posterize'
    | 'adjust.threshold'
    | 'adjust.gamma'
    | 'adjust.levels';
  spec: AdjustmentSpec;
}

export const ADJUSTMENT_PRESETS: AdjustmentPreset[] = [
  { type: 'brightness-contrast', labelKey: 'adjust.brightnessContrast', spec: { type: 'brightness-contrast', brightness: 0, contrast: 0 } },
  { type: 'exposure', labelKey: 'adjust.exposure', spec: { type: 'exposure', exposure: 0 } },
  { type: 'hue-saturation', labelKey: 'adjust.hueSaturation', spec: { type: 'hue-saturation', hue: 0, saturation: 0, lightness: 0 } },
  { type: 'vibrance', labelKey: 'adjust.vibrance', spec: { type: 'vibrance', amount: 0 } },
  { type: 'temperature', labelKey: 'adjust.temperature', spec: { type: 'temperature', temperature: 0, tint: 0 } },
  { type: 'invert', labelKey: 'adjust.invert', spec: { type: 'invert' } },
  { type: 'grayscale', labelKey: 'adjust.grayscale', spec: { type: 'grayscale', amount: 100 } },
  { type: 'sepia', labelKey: 'adjust.sepia', spec: { type: 'sepia', amount: 100 } },
  { type: 'posterize', labelKey: 'adjust.posterize', spec: { type: 'posterize', levels: 6 } },
  { type: 'threshold', labelKey: 'adjust.threshold', spec: { type: 'threshold', level: 128 } },
  { type: 'gamma', labelKey: 'adjust.gamma', spec: { type: 'gamma', gamma: 1 } },
  { type: 'levels', labelKey: 'adjust.levels', spec: { type: 'levels', inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 } },
];

export function adjustmentLabelKey(type: AdjustmentType): AdjustmentPreset['labelKey'] {
  return ADJUSTMENT_PRESETS.find((p) => p.type === type)?.labelKey ?? 'adjust.brightnessContrast';
}
