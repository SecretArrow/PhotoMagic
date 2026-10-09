'use client';

/**
 * ExportDialog — image export (png/jpeg/webp with quality/scale/transparency)
 * and native project export (.pfs).
 */

import { useState } from 'react';
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

export default function ExportDialog({ open, onOpenChange }: WorkspaceDialogProps) {
  const { t } = useI18n();
  const doc = useEditorStore((s) => s.doc);

  const [format, setFormat] = useState<UiExportFormat>('png');
  const [quality, setQuality] = useState(95);
  const [scale, setScale] = useState(1);
  const [transparent, setTransparent] = useState(true);
  const [busy, setBusy] = useState(false);

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
                { value: 'psd', label: 'PSD' },
              ]}
            />
            {format === 'psd' ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground/80">{t('export.psdNote')}</p>
            ) : null}
            {format !== 'png' && format !== 'psd' ? (
              <SliderRow label={t('dialog.export.quality')} value={quality} min={1} max={100} onValueChange={setQuality} />
            ) : null}
            {format !== 'psd' ? (
              <SliderRow label={t('dialog.export.scale')} value={Math.round(scale * 100)} min={10} max={400} onValueChange={(v) => setScale(v / 100)} />
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
