'use client';

/**
 * ColorPanel — foreground/background chips, HSV picker, hex/RGB/HSL fields
 * and the swatch grid. Target (fg/bg) is selected by clicking a chip.
 */

import { useMemo, useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { hexToRgb, hexToHsl, hslToHex, rgbToHex } from '../../engine/color';
import type { RGB, HSL } from '../../engine/types';
import { useI18n } from '../../i18n';
import { ArrowLeftRight, Plus, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NumInput } from './controls';
import { HsvPicker } from './HsvPicker';

type ColorTarget = 'fg' | 'bg';

export default function ColorPanel() {
  const { t } = useI18n();
  const fgColor = useEditorStore((s) => s.fgColor);
  const bgColor = useEditorStore((s) => s.bgColor);
  const swatches = useEditorStore((s) => s.swatches);
  const recentColors = useEditorStore((s) => s.recentColors);
  const [target, setTarget] = useState<ColorTarget>('fg');

  const color = target === 'fg' ? fgColor : bgColor;
  const setColor = (hex: string) => {
    const store = useEditorStore.getState();
    if (target === 'fg') store.setFgColor(hex);
    else store.setBgColor(hex);
  };

  const rgb: RGB = useMemo(() => hexToRgb(color), [color]);
  const hsl: HSL = useMemo(() => hexToHsl(color), [color]);

  const setChannel = (part: Partial<RGB>) => {
    setColor(rgbToHex({ ...rgb, ...part }));
  };

  const setHsl = (part: Partial<HSL>) => {
    const next: HSL = { ...hsl, ...part };
    if (next.s < 0) next.s = 0;
    if (next.s > 100) next.s = 100;
    if (next.l < 0) next.l = 0;
    if (next.l > 100) next.l = 100;
    const normH = ((next.h % 360) + 360) % 360;
    setColor(hslToHex({ h: normH, s: next.s, l: next.l }));
  };

  return (
    <div className="pf-scroll flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      {/* target chips + swap/reset */}
      <div className="flex items-center gap-2">
        <div className="relative h-14 w-16 shrink-0">
          <button
            type="button"
            aria-label={t('color.fg')}
            title={t('color.fg')}
            data-active={target === 'fg' || undefined}
            onClick={() => setTarget('fg')}
            className={`absolute left-0 top-0 z-[1] size-9 cursor-pointer rounded border shadow ${target === 'fg' ? 'border-emerald-400' : 'border-border'}`}
            style={{ backgroundColor: fgColor }}
          />
          <button
            type="button"
            aria-label={t('color.bg')}
            title={t('color.bg')}
            data-active={target === 'bg' || undefined}
            onClick={() => setTarget('bg')}
            className={`absolute bottom-0 right-0 size-9 cursor-pointer rounded border shadow ${target === 'bg' ? 'z-10 border-emerald-400' : 'border-border'}`}
            style={{ backgroundColor: bgColor }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Button variant="ghost" size="icon" className="size-7" aria-label={t('color.swap')} title={t('color.swap')} onClick={() => useEditorStore.getState().swapColors()}>
            <ArrowLeftRight className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon" className="size-7"
            aria-label={t('color.reset')}
            title={t('color.reset')}
            onClick={() => {
              const store = useEditorStore.getState();
              store.setFgColor('#111111');
              store.setBgColor('#ffffff');
            }}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
        <p className="ml-auto text-right text-[10px] leading-tight text-muted-foreground">
          {target === 'fg' ? t('color.fg') : t('color.bg')}
          <br />
          <span className="font-mono text-[10px] text-foreground">{color.toUpperCase()}</span>
        </p>
      </div>

      <HsvPicker
        value={color}
        onChange={setColor}
        onCommit={(hex) => useEditorStore.getState().pushRecentColor(hex)}
      />

      {/* RGB fields */}
      <div className="flex items-center gap-2">
        <span className="w-8 shrink-0 text-[11px] text-muted-foreground">{t('color.rgb')}</span>
        <NumInput value={rgb.r} min={0} max={255} onChange={(v) => setChannel({ r: v })} ariaLabel={t('color.r')} className="h-6 w-11 px-1 text-center text-[11px]" />
        <NumInput value={rgb.g} min={0} max={255} onChange={(v) => setChannel({ g: v })} ariaLabel={t('color.g')} className="h-6 w-11 px-1 text-center text-[11px]" />
        <NumInput value={rgb.b} min={0} max={255} onChange={(v) => setChannel({ b: v })} ariaLabel={t('color.b')} className="h-6 w-11 px-1 text-center text-[11px]" />
      </div>

      {/* HSL fields */}
      <div className="flex items-center gap-2">
        <span className="w-8 shrink-0 text-[11px] text-muted-foreground">{t('color.hsl')}</span>
        <NumInput value={Math.round(hsl.h)} min={0} max={360} onChange={(v) => setHsl({ h: v })} ariaLabel={t('color.h')} className="h-6 w-11 px-1 text-center text-[11px]" />
        <NumInput value={Math.round(hsl.s)} min={0} max={100} onChange={(v) => setHsl({ s: v })} ariaLabel={t('color.s')} className="h-6 w-11 px-1 text-center text-[11px]" />
        <NumInput value={Math.round(hsl.l)} min={0} max={100} onChange={(v) => setHsl({ l: v })} ariaLabel={t('color.l')} className="h-6 w-11 px-1 text-center text-[11px]" />
      </div>

      {/* recent colors (auto-tracked on picker commit, most-recent first) */}
      {recentColors.length > 0 && (
        <div>
          <span className="mb-1.5 block text-[11px] text-muted-foreground">{t('color.recent')}</span>
          <div className="grid grid-cols-8 gap-1">
            {recentColors.map((rc) => (
              <button
                key={rc}
                type="button"
                title={rc.toUpperCase()}
                aria-label={rc.toUpperCase()}
                className="aspect-square cursor-pointer rounded border border-border outline-none focus-visible:ring-1 focus-visible:ring-ring"
                style={{ backgroundColor: rc }}
                onClick={() => setColor(rc)}
              />
            ))}
          </div>
        </div>
      )}

      {/* swatches */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{t('color.swatches')}</span>
          <Button
            variant="ghost"
            size="icon" className="size-7"
            aria-label={t('color.addSwatch')}
            title={t('color.addSwatch')}
            onClick={() => useEditorStore.getState().addSwatch(color)}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        <div className="grid grid-cols-8 gap-1">
          {swatches.map((sw) => (
            <button
              key={sw}
              type="button"
              title={sw.toUpperCase()}
              aria-label={sw.toUpperCase()}
              className="group/sw relative aspect-square cursor-pointer rounded border border-border outline-none focus-visible:ring-1 focus-visible:ring-ring"
              style={{ backgroundColor: sw }}
              onClick={(e) => {
                if (e.shiftKey) {
                  useEditorStore.getState().removeSwatch(sw);
                } else {
                  setColor(sw);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                useEditorStore.getState().removeSwatch(sw);
              }}
            >
              <X className="absolute inset-0 m-auto hidden size-3 text-white mix-blend-difference group-hover/sw:block" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
