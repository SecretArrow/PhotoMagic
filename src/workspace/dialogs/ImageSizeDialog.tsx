'use client';

/**
 * ImageSizeDialog — resample the whole document (all layers).
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
import { SwitchRow } from '../panels/controls';
import type { WorkspaceDialogProps } from './NewDocumentDialog';

export default function ImageSizeDialog({ open, onOpenChange }: WorkspaceDialogProps) {
  const { t } = useI18n();
  const doc = useEditorStore((s) => s.doc);
  const [width, setWidth] = useState(doc.width);
  const [height, setHeight] = useState(doc.height);
  const [constrain, setConstrain] = useState(true);
  const [smooth, setSmooth] = useState(true);
  const [touched, setTouched] = useState(false);

  // Re-sync when opened against a different document or re-opened —
  // render-phase state adjustment (react.dev "You Might Not Need an Effect"),
  // replacing the old setState-in-effect sync without cascading renders.
  const [syncToken, setSyncToken] = useState(() => `${doc.id}|${open}`);
  if (syncToken !== `${doc.id}|${open}`) {
    setSyncToken(`${doc.id}|${open}`);
    if (open) {
      setWidth(doc.width);
      setHeight(doc.height);
      setTouched(false);
    }
  }

  const setW = (v: number) => {
    setTouched(true);
    if (constrain && !touched) {
      const ratio = doc.height / doc.width;
      setWidth(v);
      setHeight(Math.max(1, Math.round(v * ratio)));
    } else if (constrain) {
      const ratio = height / Math.max(1, width);
      setWidth(v);
      setHeight(Math.max(1, Math.round(v * ratio)));
    } else {
      setWidth(v);
    }
  };

  const setH = (v: number) => {
    setTouched(true);
    if (constrain) {
      const ratio = width / Math.max(1, height);
      setHeight(v);
      setWidth(Math.max(1, Math.round(v * ratio)));
    } else {
      setHeight(v);
    }
  };

  const apply = () => {
    const w = Math.max(1, Math.min(16384, Math.round(width)));
    const h = Math.max(1, Math.min(16384, Math.round(height)));
    if (w === doc.width && h === doc.height) {
      onOpenChange(false);
      return;
    }
    useEditorStore.getState().resizeImage(w, h, smooth);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('dialog.imageSize.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('dialog.imageSize.title')}</DialogDescription>
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
                onChange={(e) => setW(Number(e.target.value))}
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
                onChange={(e) => setH(Number(e.target.value))}
                className="pf-num h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </label>
          </div>
          <SwitchRow label={t('dialog.imageSize.constrain')} checked={constrain} onCheckedChange={setConstrain} />
          <SwitchRow label={t('dialog.imageSize.smooth')} checked={smooth} onCheckedChange={setSmooth} />
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
