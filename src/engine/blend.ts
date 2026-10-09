/**
 * Blend modes supported by the compositing renderer.
 *
 * The full Photoshop-style set maps directly onto Canvas2D
 * `globalCompositeOperation` values, which are well-defined by the HTML
 * spec (Porter-Duff + separable & non-separable blend modes).
 */

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

/** Canvas2D accepts these values verbatim for globalCompositeOperation. */
export function blendToComposite(mode: BlendMode): GlobalCompositeOperation {
  if (mode === 'normal') return 'source-over';
  return mode as GlobalCompositeOperation;
}

/** i18n label keys for blend modes (panels use t(`blend.${mode}`)). */
export function blendLabelKey(mode: BlendMode): string {
  return `blend.${mode}`;
}

/**
 * True when the mode is one of the non-separable HSL modes.
 * Useful for tests and for documenting renderer behavior.
 */
export function isNonSeparable(mode: BlendMode): boolean {
  return mode === 'hue' || mode === 'saturation' || mode === 'color' || mode === 'luminosity';
}
