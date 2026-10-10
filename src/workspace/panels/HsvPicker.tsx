'use client';

/**
 * HsvPicker — compact HSV color editor (SV square + hue slider + hex field).
 * Used by the Color panel and the inline color buttons in the options bar.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { useI18n } from '../../i18n';

export interface Hsv {
  h: number; // 0..360
  s: number; // 0..100
  v: number; // 0..100
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rf) h = 60 * (((gf - bf) / d) % 6);
    else if (max === gf) h = 60 * ((bf - rf) / d + 2);
    else h = 60 * ((rf - gf) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
}

export function hsvToRgb({ h, s, v }: Hsv): { r: number; g: number; b: number } {
  const sv = s / 100;
  const vv = v / 100;
  const c = vv * sv;
  const hh = (h % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let rgb: [number, number, number];
  if (hh >= 0 && hh < 1) rgb = [c, x, 0];
  else if (hh < 2) rgb = [x, c, 0];
  else if (hh < 3) rgb = [0, c, x];
  else if (hh < 4) rgb = [0, x, c];
  else if (hh < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = vv - c;
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function hsvToHex(hsv: Hsv): string {
  const { r, g, b } = hsvToRgb(hsv);
  return rgbToHex(r, g, b);
}

export function hexToHsv(hex: string): Hsv | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

interface HsvPickerProps {
  value: string;
  onChange: (hex: string) => void;
  /** Fired once per interaction END (drag release / slider commit / hex enter) — not per move. */
  onCommit?: (hex: string) => void;
}

export function HsvPicker({ value, onChange, onCommit }: HsvPickerProps) {
  const { t } = useI18n();
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 0, s: 0, v: 0 });
  const [hexText, setHexText] = useState(value);
  const draggingRef = useRef(false);
  const squareRef = useRef<HTMLDivElement | null>(null);
  /** hex at drag start — the SV square commits only when the color changed */
  const commitStartRef = useRef<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  // sync when the color changes externally (eyedropper, swatches, swap)
  useEffect(() => {
    if (hsvToHex(hsv) !== value.toLowerCase()) {
      const parsed = hexToHsv(value);
      if (parsed) setHsv(parsed);
    }
    setHexText(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commitHsv = (next: Hsv) => {
    setHsv(next);
    onChange(hsvToHex(next));
  };

  const pointToSv = (clientX: number, clientY: number) => {
    const el = squareRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const sx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const sy = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    commitHsv({ ...hsv, s: sx * 100, v: (1 - sy) * 100 });
  };

  const hex = hsvToHex(hsv);

  const copyHex = (): void => {
    try {
      void navigator.clipboard?.writeText(hex.toUpperCase()).catch(() => {});
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable (insecure context / denied permission) — silent
    }
  };

  /** Commits the hex text field (blur / Enter): invalid text reverts silently. */
  const commitHexText = (): void => {
    const parsed = hexToHsv(hexText);
    if (parsed) {
      const next = hsvToHex(parsed);
      if (next !== hex) onCommit?.(next);
      commitHsv(parsed);
    } else {
      setHexText(hex);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2.5">
      <div
        ref={squareRef}
        aria-label={t('color.svArea')}
        className="relative h-36 w-full cursor-crosshair touch-none select-none rounded-md border border-border"
        style={{
          background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
        }}
        onPointerDown={(e) => {
          draggingRef.current = true;
          commitStartRef.current = hsvToHex(hsv);
          e.currentTarget.setPointerCapture(e.pointerId);
          pointToSv(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) pointToSv(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          const started = commitStartRef.current;
          commitStartRef.current = null;
          if (started !== null && started !== hsvToHex(hsv)) onCommit?.(hsvToHex(hsv));
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        <div
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
          style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, backgroundColor: hex }}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="w-3 shrink-0 text-[11px] text-muted-foreground">{t('color.hue')}</span>
        <div className="relative flex h-11 flex-1 items-center">
          <div
            className="h-3.5 w-full rounded-full"
            style={{
              background:
                'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
            }}
          />
          <Slider
            value={[Math.round(hsv.h)]}
            min={0}
            max={360}
            step={1}
            onValueChange={(v) => commitHsv({ ...hsv, h: v[0] ?? 0 })}
            onValueCommit={() => onCommit?.(hsvToHex(hsv))}
            className="absolute inset-0 [&_[data-slot=slider-track]]:bg-transparent"
            aria-label={t('color.hue')}
          />
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <Input
          value={hexText}
          onChange={(e) => setHexText(e.target.value)}
          onBlur={commitHexText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitHexText();
          }}
          className="pf-num h-7 min-w-0 flex-1 font-mono text-xs uppercase"
          aria-label={t('color.hex')}
          spellCheck={false}
        />
        <button
          type="button"
          aria-label={copied ? t('color.copied') : t('color.copyHex')}
          title={copied ? t('color.copied') : t('color.copyHex')}
          onClick={copyHex}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}
