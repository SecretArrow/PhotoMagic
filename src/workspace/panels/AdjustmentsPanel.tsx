'use client';

/**
 * AdjustmentsPanel — the 12 engine adjustments as collapsible sections.
 * Each section edits a draft spec, can be added as an adjustment layer, or
 * applied synchronously to the active raster layer (worker-ran pixel pass +
 * diff-region history entry via commitPixelEdit).
 */

import { useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import type { AdjustmentSpec, RasterLayer } from '../../engine/types';
import { ctx2d, imageDataFromCanvas } from '../../engine/raster';
import { runAdjust } from '../../lib/filterRunner';
import { useI18n } from '../../i18n';
import { toast } from '../../hooks/use-toast';
import { ADJUSTMENT_PRESETS, adjustmentLabelKey } from '../adjustmentPresets';
import { Button } from '@/components/ui/button';
import { SliderRow } from './controls';
import { ChevronDown, ChevronRight, SlidersHorizontal } from 'lucide-react';

/* ------------------------- per-type param editor ------------------------- */

interface EditorProps {
  spec: AdjustmentSpec;
  onChange: (spec: AdjustmentSpec) => void;
  /** Fired once per interaction commit (slider release / number blur) so callers
   *  can push a single history entry for a whole drag (optional). */
  onCommit?: () => void;
}

interface ParamSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (v: number) => void;
  onCommit?: () => void;
}

/** SliderRow bound to the shared per-interaction commit callback. */
function ParamSlider({ label, value, min, max, step, onValueChange, onCommit }: ParamSliderProps) {
  return (
    <SliderRow
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={onValueChange}
      onValueCommit={onCommit ? () => onCommit() : undefined}
    />
  );
}

export function AdjustmentParamsEditor({ spec, onChange, onCommit }: EditorProps) {
  const { t } = useI18n();
  switch (spec.type) {
    case 'brightness-contrast':
      return (
        <>
          <ParamSlider label={t('adjust.param.brightness')} value={spec.brightness} min={-100} max={100} onValueChange={(v) => onChange({ ...spec, brightness: v })} onCommit={onCommit} />
          <ParamSlider label={t('adjust.param.contrast')} value={spec.contrast} min={-100} max={100} onValueChange={(v) => onChange({ ...spec, contrast: v })} onCommit={onCommit} />
        </>
      );
    case 'exposure':
      return <ParamSlider label={t('adjust.param.exposure')} value={spec.exposure} min={-2} max={2} step={0.05} onValueChange={(v) => onChange({ ...spec, exposure: v })} onCommit={onCommit} />;
    case 'hue-saturation':
      return (
        <>
          <ParamSlider label={t('adjust.param.hue')} value={spec.hue} min={-180} max={180} onValueChange={(v) => onChange({ ...spec, hue: v })} onCommit={onCommit} />
          <ParamSlider label={t('adjust.param.saturation')} value={spec.saturation} min={-100} max={100} onValueChange={(v) => onChange({ ...spec, saturation: v })} onCommit={onCommit} />
          <ParamSlider label={t('adjust.param.lightness')} value={spec.lightness} min={-100} max={100} onValueChange={(v) => onChange({ ...spec, lightness: v })} onCommit={onCommit} />
        </>
      );
    case 'vibrance':
      return <ParamSlider label={t('adjust.param.amount')} value={spec.amount} min={-100} max={100} onValueChange={(v) => onChange({ ...spec, amount: v })} onCommit={onCommit} />;
    case 'temperature':
      return (
        <>
          <ParamSlider label={t('adjust.param.temperature')} value={spec.temperature} min={-100} max={100} onValueChange={(v) => onChange({ ...spec, temperature: v })} onCommit={onCommit} />
          <ParamSlider label={t('adjust.param.tint')} value={spec.tint} min={-100} max={100} onValueChange={(v) => onChange({ ...spec, tint: v })} onCommit={onCommit} />
        </>
      );
    case 'invert':
      return <p className="text-[11px] text-muted-foreground">{t(adjustmentLabelKey('invert'))}</p>;
    case 'grayscale':
      return <ParamSlider label={t('adjust.param.amount')} value={spec.amount} min={0} max={100} onValueChange={(v) => onChange({ ...spec, amount: v })} onCommit={onCommit} />;
    case 'sepia':
      return <ParamSlider label={t('adjust.param.amount')} value={spec.amount} min={0} max={100} onValueChange={(v) => onChange({ ...spec, amount: v })} onCommit={onCommit} />;
    case 'posterize':
      return <ParamSlider label={t('adjust.param.levels')} value={spec.levels} min={2} max={32} onValueChange={(v) => onChange({ ...spec, levels: v })} onCommit={onCommit} />;
    case 'threshold':
      return <ParamSlider label={t('adjust.param.level')} value={spec.level} min={0} max={255} onValueChange={(v) => onChange({ ...spec, level: v })} onCommit={onCommit} />;
    case 'gamma':
      return <ParamSlider label={t('adjust.param.gamma')} value={spec.gamma} min={0.1} max={3} step={0.05} onValueChange={(v) => onChange({ ...spec, gamma: v })} onCommit={onCommit} />;
    case 'levels':
      return (
        <>
          <ParamSlider label={t('adjust.param.inBlack')} value={spec.inBlack} min={0} max={254} onValueChange={(v) => onChange({ ...spec, inBlack: Math.min(v, spec.inWhite - 1) })} onCommit={onCommit} />
          <ParamSlider label={t('adjust.param.inWhite')} value={spec.inWhite} min={1} max={255} onValueChange={(v) => onChange({ ...spec, inWhite: Math.max(v, spec.inBlack + 1) })} onCommit={onCommit} />
          <ParamSlider label={t('adjust.param.gamma')} value={spec.gamma} min={0.1} max={3} step={0.05} onValueChange={(v) => onChange({ ...spec, gamma: v })} onCommit={onCommit} />
          <ParamSlider label={t('adjust.param.outBlack')} value={spec.outBlack} min={0} max={255} onValueChange={(v) => onChange({ ...spec, outBlack: Math.min(v, spec.outWhite) })} onCommit={onCommit} />
          <ParamSlider label={t('adjust.param.outWhite')} value={spec.outWhite} min={0} max={255} onValueChange={(v) => onChange({ ...spec, outWhite: Math.max(v, spec.outBlack) })} onCommit={onCommit} />
        </>
      );
    default:
      return null;
  }
}

/* -------------------------------- panel -------------------------------- */

function initialDrafts(): Record<string, AdjustmentSpec> {
  const out: Record<string, AdjustmentSpec> = {};
  for (const preset of ADJUSTMENT_PRESETS) out[preset.type] = preset.spec;
  return out;
}

export default function AdjustmentsPanel() {
  const { t } = useI18n();
  const [drafts, setDrafts] = useState<Record<string, AdjustmentSpec>>(initialDrafts);
  const [openType, setOpenType] = useState<string | null>('brightness-contrast');

  const setDraft = (type: string, spec: AdjustmentSpec) => {
    setDrafts((d) => ({ ...d, [type]: spec }));
  };

  /** Applies the draft synchronously to the active raster layer. */
  const applyToActiveLayer = async (spec: AdjustmentSpec) => {
    const store = useEditorStore.getState();
    const layer = store.getActiveLayer();
    if (!layer || layer.kind !== 'raster' || layer.locked) {
      toast({ title: t('toast.noRasterLayer') });
      return;
    }
    const raster = layer as RasterLayer;
    const before = imageDataFromCanvas(raster.canvas);
    store.setJobProgress({ label: t('common.processing'), value: 0.4 });
    try {
      const after = await runAdjust(before, [spec]);
      ctx2d(raster.canvas).putImageData(after, 0, 0);
      store.commitPixelEdit(raster.id, before, after, 'adjust.applyToLayer', 'Apply adjustment');
    } catch {
      toast({ title: t('toast.filterFailed') });
    } finally {
      useEditorStore.getState().setJobProgress(null);
    }
  };

  const activeLayer = useEditorStore((s) => s.getActiveLayer());
  const canApply = !!activeLayer && activeLayer.kind === 'raster' && !activeLayer.locked;

  return (
    <div className="pf-scroll h-full min-h-0 overflow-y-auto">
      {ADJUSTMENT_PRESETS.map((preset) => {
        const open = openType === preset.type;
        const spec = drafts[preset.type];
        return (
          <section key={preset.type} className="border-b border-[#2c2d33] last:border-b-0">
            <button
              type="button"
              onClick={() => setOpenType(open ? null : preset.type)}
              aria-expanded={open}
              className="flex w-full items-center gap-2 px-2 py-2 text-left text-xs text-foreground hover:bg-accent/50"
            >
              {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              <span className="flex-1 truncate">{t(preset.labelKey)}</span>
              <SlidersHorizontal className="size-3 text-muted-foreground" />
            </button>
            {open && spec ? (
              <div className="flex flex-col gap-2 px-2 pb-3">
                <AdjustmentParamsEditor spec={spec} onChange={(next) => setDraft(preset.type, next)} />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 flex-1 text-[11px]"
                    onClick={() => useEditorStore.getState().addAdjustmentLayer(spec)}
                  >
                    {t('adjust.addAsLayer')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 flex-1 text-[11px]"
                    disabled={!canApply}
                    title={canApply ? undefined : t('adjust.applyNeedsRaster')}
                    onClick={() => void applyToActiveLayer(spec)}
                  >
                    {t('adjust.applyToLayer')}
                  </Button>
                </div>
                {!canApply ? <p className="text-[10px] text-muted-foreground/70">{t('adjust.applyNeedsRaster')}</p> : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
