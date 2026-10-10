'use client';

/**
 * CanvasSizeDialog — changes the canvas bounds without resampling layers.
 */

import { useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { useI18n } from '../../i18n';
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
import { SelectRow } from '../panels/controls';
import type { WorkspaceDialogProps } from './NewDocumentDialog';

export default function CanvasSizeDialog({ open, onOpenChange }: WorkspaceDialogProps) {
  const { t } = useI18n();
  const doc = useEditorStore((s) => s.doc);
  const [width, setWidth] = useState(doc.width);
  const [height, setHeight] = useState(doc.height);
  const [anchor, setAnchor] = useState<'center' | 'topleft'>('center');

  // Re-sync the fields when the dialog opens against a (new) document —
  // render-phase state adjustment (react.dev "You Might Not Need an Effect"),
  // which replaces the old setState-in-effect sync without cascading renders.
  const [syncToken, setSyncToken] = useState(() => `${doc.id}|${open}`);
  if (syncToken !== `${doc.id}|${open}`) {
    setSyncToken(`${doc.id}|${open}`);
    if (open) {
      setWidth(doc.width);
      setHeight(doc.height);
    }
  }

  const apply = () => {
    const w = Math.max(1, Math.min(16384, Math.round(width)));
    const h = Math.max(1, Math.min(16384, Math.round(height)));
    if (w === doc.width && h === doc.height) {
      onOpenChange(false);
      return;
    }
    useEditorStore.getState().resizeCanvas(w, h, anchor);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('dialog.canvasSize.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('dialog.canvasSize.title')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-[11px] text-muted-foreground">
            {t('status.doc')}: {doc.width} × {doc.height}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">{t('dialog.newDocument.width')}</Label>
              <input
                type="number"
                min={1}
                max={16384}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="pf-num h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">{t('dialog.newDocument.height')}</Label>
              <input
                type="number"
                min={1}
                max={16384}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                className="pf-num h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </label>
          </div>
          <SelectRow
            label={t('dialog.canvasSize.anchor')}
            value={anchor}
            onValueChange={(v) => setAnchor(v as 'center' | 'topleft')}
            items={[
              { value: 'center', label: t('dialog.anchorCenter') },
              { value: 'topleft', label: t('dialog.anchorTopLeft') },
            ]}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('dialog.cancel')}
          </Button>
          <Button onClick={apply}>{t('dialog.apply')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
