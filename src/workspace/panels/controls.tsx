'use client';

/**
 * Shared compact form controls for panels and the options bar.
 * All labels are provided by callers via t().
 */

import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { HsvPicker } from './HsvPicker';

/* ------------------------------ SliderRow ------------------------------ */

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (v: number) => void;
  onValueCommit?: (v: number) => void;
  className?: string;
}

export function SliderRow({ label, value, min, max, step = 1, onValueChange, onValueCommit, className }: SliderRowProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="w-20 shrink-0 truncate text-[11px] text-muted-foreground" title={label}>
        {label}
      </span>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onValueChange(v[0] ?? min)}
        onValueCommit={onValueCommit ? (v) => onValueCommit(v[0] ?? min) : undefined}
        aria-label={label}
        className="flex-1"
      />
      <NumInput
        value={value}
        min={min}
        max={max}
        onChange={onValueChange}
        className="h-6 w-12 shrink-0 px-1 text-center text-[11px]"
        aria-label={label}
      />
    </div>
  );
}

/* ------------------------------ NumInput ------------------------------ */

interface NumInputProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  ariaLabel?: string;
}

/** Numeric input that tolerates partial typing and clamps on blur/enter. */
export function NumInput({ value, onChange, min, max, step, className, ariaLabel }: NumInputProps) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onChange(v);
    setText(String(v));
  };

  return (
    <input
      type="number"
      value={text}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (Number.isFinite(n) && e.target.value !== '') {
          let v = n;
          if (min !== undefined) v = Math.max(min, v);
          if (max !== undefined) v = Math.min(max, v);
          onChange(v);
        }
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit((e.target as HTMLInputElement).value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      aria-label={ariaLabel}
      className={cn(
        'pf-num rounded-md border border-input bg-transparent px-2 py-0.5 text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className,
      )}
    />
  );
}

/* ----------------------------- NumberField ----------------------------- */

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}

export function NumberField({ label, value, onChange, min, max, step, className }: NumberFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <NumInput value={value} onChange={onChange} min={min} max={max} step={step} ariaLabel={label} className="h-7 w-full px-2 text-xs" />
    </div>
  );
}

/* ------------------------------ SwitchRow ------------------------------ */

interface SwitchRowProps {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  className?: string;
}

export function SwitchRow({ label, checked, onCheckedChange, className }: SwitchRowProps) {
  return (
    <label className={cn('flex cursor-pointer items-center justify-between gap-2 text-[11px] text-muted-foreground', className)}>
      <span className="truncate" title={label}>
        {label}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </label>
  );
}

/* ------------------------------ SelectRow ------------------------------ */

interface SelectRowProps {
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  items: { value: string; label: string }[];
  className?: string;
  contentClassName?: string;
}

export function SelectRow({ label, value, onValueChange, items, className, contentClassName }: SelectRowProps) {
  return (
    <label className={cn('flex items-center gap-2 text-[11px] text-muted-foreground', className)}>
      <span className="w-20 shrink-0 truncate" title={label}>
        {label}
      </span>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger size="sm" aria-label={label} className="h-6 min-w-0 flex-1 gap-1 px-2 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className={contentClassName} position="popper">
          {items.map((it) => (
            <SelectItem key={it.value} value={it.value} className="text-xs">
              {it.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

/* --------------------------- ColorPickerButton --------------------------- */

interface ColorPickerButtonProps {
  color: string;
  onChange: (hex: string) => void;
  label: string;
  className?: string;
}

/** Small inline color swatch button with an HSV popover editor. */
export function ColorPickerButton({ color, onChange, label, className }: ColorPickerButtonProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            'size-6 shrink-0 cursor-pointer rounded border border-border shadow-inner outline-none focus-visible:ring-1 focus-visible:ring-ring',
            className,
          )}
          style={{ backgroundColor: color }}
        />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="start">
        <HsvPicker value={color} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
