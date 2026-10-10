'use client';

/**
 * FilterDialog — the filter gallery. Category-grouped filter list from
 * listFilters(), param controls generated from FilterDef.params, live
 * preview on a downscaled copy (max 512px) of the active raster layer, and
 * a full-resolution Apply through the worker-backed filterRunner.
 *
 * v2 note: non-destructive smart filters (layer.filters) reuse the same
 * FilterDef params — the layer model already carries the field.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import type { FilterDef, RasterLayer } from '../../engine/types';
import { getFilter, listFilters } from '../../engine/filters/registry';
import { ctx2d, imageDataFromCanvas, makeCanvas } from '../../engine/raster';
import { runFilter } from '../../lib/filterRunner';
import { useI18n } from '../../i18n';
import { toast } from '../../hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SelectRow, SliderRow, SwitchRow } from '../panels/controls';
import { Loader2 } from 'lucide-react';
import type { WorkspaceDialogProps } from './NewDocumentDialog';

const PREVIEW_MAX = 512;

const CATEGORIES: { id: FilterDef['category']; labelKey: 'filter.category.blur' | 'filter.category.sharpen' | 'filter.category.noise' | 'filter.category.stylize' | 'filter.category.distort' | 'filter.category.light' | 'filter.category.artistic' | 'filter.category.ai' }[] = [
  { id: 'ai', labelKey: 'filter.category.ai' },
  { id: 'blur', labelKey: 'filter.category.blur' },
  { id: 'sharpen', labelKey: 'filter.category.sharpen' },
  { id: 'noise', labelKey: 'filter.category.noise' },
  { id: 'stylize', labelKey: 'filter.category.stylize' },
  { id: 'distort', labelKey: 'filter.category.distort' },
  { id: 'light', labelKey: 'filter.category.light' },
  { id: 'artistic', labelKey: 'filter.category.artistic' },
];

function defaultsFor(def: FilterDef): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const p of def.params) out[p.key] = p.defaultValue;
  return out;
}

export default function FilterDialog({ open, onOpenChange }: WorkspaceDialogProps) {
  const { t } = useI18n();
  const filterOp = useEditorStore((s) => s.extras.filterDialog.op);
  const filters = useMemo(() => listFilters(), []);
  const def = filterOp ? getFilter(filterOp) : undefined;

  const [params, setParams] = useState<Record<string, number | string | boolean>>(() => (def ? defaultsFor(def) : {}));
  const [busy, setBusy] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewOriginalRef = useRef<ImageData | null>(null);
  const previewKeyRef = useRef<string>('');
  const previewJobRef = useRef(0);

  const layer = useEditorStore((s) => s.getActiveLayer());
  const rasterLayer = layer && layer.kind === 'raster' && !layer.locked ? (layer as RasterLayer) : null;

  /* new filter selection → default params */
  useEffect(() => {
    if (open && def) setParams(defaultsFor(def));
     
  }, [open, filterOp]);

  const buildPreviewSource = useCallback(() => {
    if (!rasterLayer) return;
    const src = rasterLayer.canvas;
    const scale = Math.min(1, PREVIEW_MAX / Math.max(src.width, src.height));
    const sw = Math.max(1, Math.round(src.width * scale));
    const sh = Math.max(1, Math.round(src.height * scale));
    const small = makeCanvas(sw, sh);
    const sctx = ctx2d(small);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(src as CanvasImageSource, 0, 0, sw, sh);
    previewOriginalRef.current = sctx.getImageData(0, 0, sw, sh);
    previewKeyRef.current = `${rasterLayer.id}:${sw}x${sh}`;
    const canvas = previewCanvasRef.current;
    if (canvas) {
      canvas.width = sw;
      canvas.height = sh;
    }
  }, [rasterLayer]);

  /* live preview (debounced) on the downscaled copy */
  useEffect(() => {
    if (!open || !def || !rasterLayer) return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    if (previewOriginalRef.current === null || previewKeyRef.current.startsWith(`${rasterLayer.id}:`) === false) {
      buildPreviewSource();
    }
    const original = previewOriginalRef.current;
    if (!original) return;

    const jobId = ++previewJobRef.current;
    const timer = setTimeout(() => {
      void runFilter(original, def.op, params)
        .then((out) => {
          if (previewJobRef.current !== jobId) return;
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.putImageData(out, 0, 0);
        })
        .catch(() => {
          /* preview failures stay silent; Apply reports errors */
        });
    }, 120);
    return () => clearTimeout(timer);
  }, [open, def, params, rasterLayer, buildPreviewSource]);

  const apply = async () => {
    if (!def || !rasterLayer) return;
    const store = useEditorStore.getState();
    const before = imageDataFromCanvas(rasterLayer.canvas);
    setBusy(true);
    store.setJobProgress({ label: t('filter.applying'), value: 0.5 });
    try {
      const after = await runFilter(before, def.op, params);
      ctx2d(rasterLayer.canvas).putImageData(after, 0, 0);
      store.commitPixelEdit(rasterLayer.id, before, after, 'history.filter', `Filter: ${def.op}`);
      store.setFilterDialog({ open: false });
      onOpenChange(false);
    } catch {
      toast({ title: t('toast.filterFailed') });
    } finally {
      setBusy(false);
      useEditorStore.getState().setJobProgress(null);
    }
  };

  const close = (next: boolean) => {
    if (!next) {
      previewOriginalRef.current = null;
      previewKeyRef.current = '';
      const store = useEditorStore.getState();
      store.setFilterDialog({ open: false });
    }
    onOpenChange(next);
  };

  const grouped = useMemo(() => {
    return CATEGORIES.map((cat) => ({ ...cat, filters: filters.filter((f) => f.category === cat.id) })).filter((g) => g.filters.length > 0);
  }, [filters]);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('dialog.filter.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('dialog.filter.title')}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 gap-3">
          {/* filter list grouped by category */}
          <div className="pf-scroll max-h-[50vh] w-44 shrink-0 overflow-y-auto rounded-md border border-[#2c2d33] bg-[#232429] p-1">
            {grouped.map((group) => (
              <div key={group.id} className="mb-1">
                <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">{t(group.labelKey)}</p>
                {group.filters.map((f) => (
                  <button
                    key={f.op}
                    type="button"
                    onClick={() => useEditorStore.getState().setFilterDialog({ op: f.op, params: defaultsFor(f) })}
                    data-selected={f.op === filterOp || undefined}
                    className={`flex w-full items-center rounded px-2 py-1.5 text-left text-xs ${
                      f.op === filterOp ? 'bg-emerald-500/15 text-foreground' : 'text-muted-foreground hover:bg-accent/60'
                    }`}
                  >
                    {t(f.labelKey as 'filter.gaussianBlur')}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* preview + params */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="relative flex items-center justify-center overflow-hidden rounded-md border border-[#2c2d33] bg-[#232429] p-2" data-busy={busy || undefined} aria-busy={busy}>
              <canvas ref={previewCanvasRef} className="max-h-56 max-w-full object-contain" aria-label={t('dialog.filter.preview')} />
              {!rasterLayer ? (
                <p className="p-4 text-center text-xs text-muted-foreground">{t('filter.gallery.noLayer')}</p>
              ) : null}
              {busy ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Loader2 className="size-6 animate-spin text-emerald-300" />
                </div>
              ) : null}
            </div>

            {def ? (
              <div className="pf-scroll flex max-h-40 flex-col gap-2 overflow-y-auto pr-1">
                {def.params.map((p) => {
                  const label = t(p.labelKey as 'filter.param.radius');
                  const value = params[p.key] ?? p.defaultValue;
                  if (p.type === 'number') {
                    return (
                      <SliderRow
                        key={p.key}
                        label={label}
                        value={typeof value === 'number' ? value : Number(p.defaultValue)}
                        min={p.min ?? 0}
                        max={p.max ?? 100}
                        step={p.step ?? 1}
                        onValueChange={(v) => setParams((prev) => ({ ...prev, [p.key]: v }))}
                      />
                    );
                  }
                  if (p.type === 'boolean') {
                    return (
                      <SwitchRow
                        key={p.key}
                        label={label}
                        checked={value === true}
                        onCheckedChange={(v) => setParams((prev) => ({ ...prev, [p.key]: v }))}
                      />
                    );
                  }
                  return (
                    <SelectRow
                      key={p.key}
                      label={label}
                      value={String(value)}
                      onValueChange={(v) => setParams((prev) => ({ ...prev, [p.key]: v }))}
                      items={(p.options ?? []).map((o) => ({ value: o.value, label: t(o.labelKey as 'filter.param.directionHorizontal') }))}
                    />
                  );
                })}
              </div>
            ) : null}

            <p className="text-[10px] leading-snug text-muted-foreground/80">{t('filter.gallery.previewNote')}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => def && setParams(defaultsFor(def))} disabled={!def}>
            {t('common.reset')}
          </Button>
          <Button variant="outline" onClick={() => close(false)}>
            {t('dialog.cancel')}
          </Button>
          <Button onClick={() => void apply()} disabled={!def || !rasterLayer || busy}>
            {t('dialog.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
