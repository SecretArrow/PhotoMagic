'use client';

/**
 * NewDocumentDialog — presets, orientation swap, background choice.
 */

import { useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import type { BackgroundType } from '../../engine/types';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SelectRow } from '../panels/controls';

export interface WorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PRESETS: { w: number; h: number; dpi: number }[] = [
  { w: 1920, h: 1080, dpi: 72 },
  { w: 1080, h: 1080, dpi: 72 },
  { w: 1080, h: 1920, dpi: 72 },
  { w: 800, h: 600, dpi: 72 },
  { w: 1280, h: 800, dpi: 72 },
  { w: 2480, h: 3508, dpi: 300 },
  { w: 500, h: 500, dpi: 72 },
  { w: 2048, h: 2048, dpi: 72 },
];

type Orientation = 'portrait' | 'landscape';

export default function NewDocumentDialog({ open, onOpenChange }: WorkspaceDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('Untitled-1');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [dpi, setDpi] = useState(72);
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [background, setBackground] = useState<BackgroundType>('white');
  const [customColor, setCustomColor] = useState('#58c08a');

  const applyPreset = (index: number) => {
    const preset = PRESETS[index];
    const landscape = preset.w >= preset.h;
    setWidth(preset.w);
    setHeight(preset.h);
    setDpi(preset.dpi);
    setOrientation(landscape ? 'landscape' : 'portrait');
  };

  const applyOrientation = (next: Orientation) => {
    const landscape = width >= height;
    if ((next === 'landscape') === landscape) {
      setOrientation(next);
      return;
    }
    setWidth(height);
    setHeight(width);
    setOrientation(next);
  };

  const create = () => {
    useEditorStore.getState().newDocument({
      name: name.trim() || 'Untitled',
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      background,
      customBackground: background === 'custom' ? customColor : undefined,
      dpi,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dialog.newDocument.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('dialog.newDocument.title')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">{t('dialog.newDocument.name')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" />
          </label>

          <SelectRow
            label={t('dialog.newDocument.preset')}
            value=""
            onValueChange={(v) => applyPreset(Number(v))}
            items={PRESETS.map((p, i) => ({ value: String(i), label: `${p.w} × ${p.h}` }))}
          />

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">{t('dialog.newDocument.width')}</Label>
              <Input
                type="number"
                min={1}
                max={16384}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="pf-num h-8 text-xs"
              />
            </label>
            <label className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">{t('dialog.newDocument.height')}</Label>
              <Input
                type="number"
                min={1}
                max={16384}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                className="pf-num h-8 text-xs"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <SelectRow
              label={t('dialog.newDocument.orientation')}
              value={orientation}
              onValueChange={(v) => applyOrientation(v as Orientation)}
              items={[
                { value: 'landscape', label: t('dialog.newDocument.landscape') },
                { value: 'portrait', label: t('dialog.newDocument.portrait') },
              ]}
            />
            <label className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">{t('dialog.newDocument.dpi')}</Label>
              <Input type="number" min={1} max={2400} value={dpi} onChange={(e) => setDpi(Number(e.target.value))} className="pf-num h-8 text-xs" />
            </label>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">{t('dialog.newDocument.background')}</Label>
            <RadioGroup
              value={background}
              onValueChange={(v) => setBackground(v as BackgroundType)}
              className="flex flex-wrap items-center gap-3"
            >
              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                <RadioGroupItem value="transparent" />
                {t('dialog.newDocument.transparent')}
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                <RadioGroupItem value="white" />
                {t('dialog.newDocument.white')}
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                <RadioGroupItem value="black" />
                {t('dialog.newDocument.black')}
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                <RadioGroupItem value="custom" />
                {t('dialog.newDocument.custom')}
              </label>
              {background === 'custom' ? (
                <input
                  type="color"
                  value={customColor}
                  onChange={(e) => setCustomColor(e.target.value)}
                  aria-label={t('dialog.newDocument.custom')}
                  className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent"
                />
              ) : null}
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('dialog.cancel')}
          </Button>
          <Button onClick={create}>{t('dialog.newDocument.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
