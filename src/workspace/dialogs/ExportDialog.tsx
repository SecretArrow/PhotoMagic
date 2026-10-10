'use client';

/**
 * ExportDialog — image export (png/jpeg/webp/avif with quality/scale/transparency)
 * and native project export (.pfs).
 */

import { useEffect, useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { APP_VERSION } from '../../engine/document';
import { exportComposite, downloadBlob, safeFilename, type ExportFormat } from '../../formats/api';
import { exportPsd } from '../../formats/psd';
import { saveProject } from '../../documents/project';
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
import { Label } from '@/components/ui/label';
import { SelectRow, SliderRow, SwitchRow } from '../panels/controls';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { WorkspaceDialogProps } from './NewDocumentDialog';

type UiExportFormat = ExportFormat | 'psd';

/* AVIF feature detection (cached per session): browsers without an AVIF
 * encoder either resolve null or silently fall back to PNG — both count as
 * "unsupported" so the dialog can hide the option honestly. */
let avifSupportPromise: Promise<boolean> | null = null;
function detectAvifSupport(): Promise<boolean> {
  if (!avifSupportPromise) {
    avifSupportPromise = new Promise<boolean>((resolve) => {
      try {
        if (typeof document === 'undefined') {
          resolve(false);
          return;
        }
        const probe = document.createElement('canvas');
        probe.width = 1;
        probe.height = 1;
        probe.toBlob((blob) => resolve(!!blob && blob.type === 'image/avif'), 'image/avif');
      } catch {
        resolve(false);
      }
    });
  }
  return avifSupportPromise;
}

const SCALE_PRESETS = [25, 50, 100, 200];

export default function ExportDialog({ open, onOpenChange }: WorkspaceDialogProps) {
  const { t } = useI18n();
  const doc = useEditorStore((s) => s.doc);

  const [format, setFormat] = useState<UiExportFormat>('png');
  const [quality, setQuality] = useState(95);
  const [scale, setScale] = useState(1);
  const [transparent, setTransparent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [avifSupported, setAvifSupported] = useState<boolean | null>(null);

  /* async AVIF support probe — runs once per session on first dialog open */
  useEffect(() => {
    if (!open || avifSupported !== null) return;
    let cancelled = false;
    void detectAvifSupport().then((ok) => {
      if (!cancelled) setAvifSupported(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [open, avifSupported]);

  /* if AVIF turned out to be unsupported while selected, fall back honestly */
  useEffect(() => {
    if (avifSupported === false && format === 'avif') setFormat('png');
  }, [avifSupported, format]);

  const outW = Math.max(1, Math.round(doc.width * scale));
  const outH = Math.max(1, Math.round(doc.height * scale));

  const runExport = async () => {
    setBusy(true);
    try {
      if (format === 'psd') {
        const blob = await exportPsd(doc);
        const filename = `${safeFilename(doc.name)}.psd`;
        downloadBlob(blob, filename);
        toast({ title: t('toast.exported', { name: filename }) });
      } else {
        const result = await exportComposite({ doc, format, quality: quality / 100, scale, transparent });
        downloadBlob(result.blob, result.filename);
        toast({ title: t('toast.exported', { name: result.filename }) });
      }
      onOpenChange(false);
    } catch {
      toast({ title: t('toast.nothingToExport') });
    } finally {
      setBusy(false);
    }
  };

  const saveProjectFile = async () => {
    setBusy(true);
    try {
      const blob = await saveProject(doc, APP_VERSION);
      downloadBlob(blob, `${safeFilename(doc.name)}.pfs`);
      toast({ title: t('toast.projectSaved') });
      onOpenChange(false);
    } catch {
      toast({ title: t('toast.nothingToExport') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dialog.export.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('dialog.export.title')}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="image">
          <TabsList className="w-full">
            <TabsTrigger value="image" className="flex-1 text-xs">
              {t('export.tab.image')}
            </TabsTrigger>
            <TabsTrigger value="project" className="flex-1 text-xs">
              {t('export.tab.project')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="image" className="mt-3 flex flex-col gap-3">
            <SelectRow
              label={t('dialog.export.format')}
              value={format}
              onValueChange={(v) => setFormat(v as UiExportFormat)}
              items={[
                { value: 'png', label: 'PNG' },
                { value: 'jpeg', label: 'JPEG' },
                { value: 'webp', label: 'WebP' },
                ...(avifSupported ? [{ value: 'avif', label: 'AVIF' }] : []),
                { value: 'psd', label: 'PSD' },
              ]}
            />
            {format === 'psd' ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground/80">{t('export.psdNote')}</p>
            ) : null}
            {format === 'avif' ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground/80">{t('export.avifNote')}</p>
            ) : null}
            {format !== 'png' && format !== 'psd' ? (
              <SliderRow label={t('dialog.export.quality')} value={quality} min={1} max={100} onValueChange={setQuality} />
            ) : null}
            {format !== 'psd' ? (
              <SliderRow label={t('dialog.export.scale')} value={Math.round(scale * 100)} min={10} max={400} onValueChange={(v) => setScale(v / 100)} />
            ) : null}
            {format !== 'psd' ? (
              <div className="flex items-center gap-1" role="group" aria-label={t('dialog.export.scale')}>
                {SCALE_PRESETS.map((pct) => {
                  const active = Math.round(scale * 100) === pct;
                  return (
                    <button
                      key={pct}
                      type="button"
                      aria-pressed={active}
                      aria-label={`${pct}%`}
                      onClick={() => setScale(pct / 100)}
                      className={`h-5 flex-1 cursor-pointer rounded border text-[10px] leading-none ${
                        active
                          ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                          : 'border-border text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      {pct}%
                    </button>
                  );
                })}
              </div>
            ) : null}
            {format === 'jpeg' ? (
              <SwitchRow label={t('dialog.export.transparent')} checked={false} onCheckedChange={() => undefined} className="opacity-50" />
            ) : format === 'psd' ? null : (
              <SwitchRow label={t('dialog.export.transparent')} checked={transparent} onCheckedChange={setTransparent} />
            )}
            {format === 'jpeg' ? <p className="text-[10px] text-muted-foreground/80">{t('export.transparentNote')}</p> : null}
            {format !== 'psd' ? <p className="text-[11px] text-muted-foreground">{t('export.estimatedSize', { w: outW, h: outH })}</p> : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('dialog.cancel')}
              </Button>
              <Button onClick={() => void runExport()} disabled={busy}>
                {t('dialog.export.exportBtn')}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="project" className="mt-3 flex flex-col gap-3">
            <Label className="text-[11px] leading-relaxed text-muted-foreground">{t('export.projectHint')}</Label>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('dialog.cancel')}
              </Button>
              <Button onClick={() => void saveProjectFile()} disabled={busy}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
