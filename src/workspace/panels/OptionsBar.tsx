'use client';

/**
 * OptionsBar — context-sensitive tool options strip under the menu bar.
 * Renders controls for the active tool from store.toolOptions; for text the
 * active text layer is updated live (committed on slider release / discrete
 * changes) so edits apply immediately.
 */

import { memo, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useEditorStore } from '../../state/editorStore';
import type { TextContent, ToolId } from '../../engine/types';
import type { ShapeOptions } from '../../state/types';
import { useI18n } from '../../i18n';
import { toolLabelKey } from '../toolMeta';
import { ColorPickerButton, NumInput, SelectRow, SliderRow, SwitchRow } from './controls';
import { Button } from '@/components/ui/button';
import { cancelCrop, commitCrop, isCropRectActive, onCropRectChange } from '../../tools/crop';

const FONT_LIST: { value: string; label: string }[] = [
  { value: 'system-ui, sans-serif', label: 'System UI' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", serif', label: 'Times New Roman' },
  { value: '"Courier New", monospace', label: 'Courier New' },
  { value: 'Verdana, sans-serif', label: 'Verdana' },
  { value: '"Trebuchet MS", sans-serif', label: 'Trebuchet MS' },
  { value: 'Impact, sans-serif', label: 'Impact' },
  { value: '"Comic Sans MS", cursive', label: 'Comic Sans MS' },
];

const SHAPE_TYPES: { value: ShapeOptions['shape']; labelKey: 'shape.rect' | 'shape.ellipse' | 'shape.line' | 'shape.polygon' | 'shape.star' }[] = [
  { value: 'rect', labelKey: 'shape.rect' },
  { value: 'ellipse', labelKey: 'shape.ellipse' },
  { value: 'line', labelKey: 'shape.line' },
  { value: 'polygon', labelKey: 'shape.polygon' },
  { value: 'star', labelKey: 'shape.star' },
];

const MODE_ITEMS = [
  { value: 'replace', labelKey: 'options.modeReplace' },
  { value: 'add', labelKey: 'options.modeAdd' },
  { value: 'subtract', labelKey: 'options.modeSubtract' },
  { value: 'intersect', labelKey: 'options.modeIntersect' },
] as const;

function Bar({ children }: { children: React.ReactNode }) {
  return (
    // Sliders/selects inside a content-sized row collapse to 0px (flex-1 with
    // no basis) — give them explicit floors so the strip stays usable on
    // narrow (and desktop) viewports; the bar itself scrolls horizontally.
    <div className="pf-scroll flex h-10 shrink-0 items-center gap-3 overflow-x-auto border-b border-[#2c2d33] bg-[#1e1f24] px-3 [&_[data-slot=select-trigger]]:min-w-32 [&_[data-slot=slider]]:w-24 [&_[data-slot=slider]]:shrink-0">
      {children}
    </div>
  );
}

/* ------------------------------- paint tools ------------------------------- */

interface PaintProps {
  opts: { size: number; hardness: number; opacity: number; flow: number; spacing: number; smoothing: number; pressureSize: boolean; pressureOpacity: boolean };
  onChange: (patch: Partial<PaintProps['opts']>) => void;
}

const PaintControls = memo(function PaintControls({ opts, onChange }: PaintProps) {
  const { t } = useI18n();
  return (
    <>
      <SliderRow label={t('options.size')} value={opts.size} min={1} max={500} onValueChange={(v) => onChange({ size: v })} />
      <SliderRow label={t('options.hardness')} value={opts.hardness} min={0} max={100} onValueChange={(v) => onChange({ hardness: v })} />
      <SliderRow label={t('options.opacity')} value={opts.opacity} min={0} max={100} onValueChange={(v) => onChange({ opacity: v })} />
      <SliderRow label={t('options.flow')} value={opts.flow} min={0} max={100} onValueChange={(v) => onChange({ flow: v })} />
      <SliderRow label={t('options.spacing')} value={opts.spacing} min={1} max={100} onValueChange={(v) => onChange({ spacing: v })} />
      <SliderRow label={t('options.smoothing')} value={opts.smoothing} min={0} max={100} onValueChange={(v) => onChange({ smoothing: v })} />
      <SwitchRow label={t('options.pressureSize')} checked={opts.pressureSize} onCheckedChange={(v) => onChange({ pressureSize: v })} />
      <SwitchRow label={t('options.pressureOpacity')} checked={opts.pressureOpacity} onCheckedChange={(v) => onChange({ pressureOpacity: v })} />
    </>
  );
});

/* -------------------------------- retouch -------------------------------- */

interface RetouchProps {
  opts: { size: number; hardness: number; strength: number };
  onChange: (patch: Partial<RetouchProps['opts']>) => void;
}

const RetouchControls = memo(function RetouchControls({ opts, onChange }: RetouchProps) {
  const { t } = useI18n();
  return (
    <>
      <SliderRow label={t('options.size')} value={opts.size} min={1} max={500} onValueChange={(v) => onChange({ size: v })} />
      <SliderRow label={t('options.hardness')} value={opts.hardness} min={0} max={100} onValueChange={(v) => onChange({ hardness: v })} />
      <SliderRow label={t('options.strength')} value={opts.strength} min={0} max={100} onValueChange={(v) => onChange({ strength: v })} />
    </>
  );
});

/* ------------------------------ main component ------------------------------ */

export default function OptionsBar() {
  const { t } = useI18n();
  const tool = useEditorStore((s) => s.tool);
  const toolOptions = useEditorStore((s) => s.toolOptions);
  const updateToolOptions = useEditorStore((s) => s.updateToolOptions);
  const updateLayer = useEditorStore((s) => s.updateLayer);

  /* helper: update tool options + (optionally) commit to the active text layer */
  const updateText = (patch: Partial<TextContent>, commit = false) => {
    updateToolOptions('text', patch);
    if (!commit) return;
    const active = useEditorStore.getState().getActiveLayer();
    if (active && active.kind === 'text') {
      const merged: TextContent = { ...(active.text), ...(useEditorStore.getState().toolOptions.text), ...patch };
      updateLayer(active.id, { text: merged }, 'history.textEdit', 'Edit text');
    }
  };

  switch (tool as ToolId) {
    case 'brush':
    case 'eraser':
    case 'airbrush': {
      const paintTool = tool as 'brush' | 'eraser' | 'airbrush';
      return (
        <Bar>
          <PaintControls
            opts={toolOptions[paintTool]}
            onChange={(patch) => updateToolOptions(paintTool, patch)}
          />
        </Bar>
      );
    }

    case 'pencil':
      return (
        <Bar>
          <SliderRow label={t('options.size')} value={toolOptions.pencil.size} min={1} max={100} onValueChange={(v) => updateToolOptions('pencil', { size: v })} />
          <SliderRow label={t('options.opacity')} value={toolOptions.pencil.opacity} min={0} max={100} onValueChange={(v) => updateToolOptions('pencil', { opacity: v })} />
        </Bar>
      );

    case 'smudge':
    case 'blur-brush':
    case 'sharpen-brush':
    case 'dodge':
    case 'burn': {
      const key = tool === 'smudge' ? 'smudge' : tool === 'blur-brush' ? 'blurBrush' : tool === 'sharpen-brush' ? 'sharpenBrush' : tool === 'dodge' ? 'dodge' : 'burn';
      return (
        <Bar>
          <RetouchControls opts={toolOptions[key]} onChange={(patch) => updateToolOptions(key, patch)} />
        </Bar>
      );
    }

    case 'clone-stamp':
      return (
        <Bar>
          <SliderRow label={t('options.size')} value={toolOptions.clone.size} min={1} max={500} onValueChange={(v) => updateToolOptions('clone', { size: v })} />
          <SliderRow label={t('options.hardness')} value={toolOptions.clone.hardness} min={0} max={100} onValueChange={(v) => updateToolOptions('clone', { hardness: v })} />
          <SliderRow label={t('options.opacity')} value={toolOptions.clone.opacity} min={0} max={100} onValueChange={(v) => updateToolOptions('clone', { opacity: v })} />
          <SwitchRow label={t('options.aligned')} checked={toolOptions.clone.aligned} onCheckedChange={(v) => updateToolOptions('clone', { aligned: v })} />
        </Bar>
      );

    case 'marquee-rect':
    case 'marquee-ellipse':
    case 'lasso':
    case 'polygonal-lasso':
      return (
        <Bar>
          <SelectRow
            label={t('options.mode')}
            value={toolOptions.marquee.mode}
            onValueChange={(v) => updateToolOptions('marquee', { mode: v as typeof toolOptions.marquee.mode })}
            items={MODE_ITEMS.map((m) => ({ value: m.value, label: t(m.labelKey) }))}
          />
          <SliderRow label={t('options.feather')} value={toolOptions.marquee.feather} min={0} max={100} onValueChange={(v) => updateToolOptions('marquee', { feather: v })} />
        </Bar>
      );

    case 'magic-wand':
      return (
        <Bar>
          <SelectRow
            label={t('options.mode')}
            value={toolOptions.wand.mode}
            onValueChange={(v) => updateToolOptions('wand', { mode: v as typeof toolOptions.wand.mode })}
            items={MODE_ITEMS.map((m) => ({ value: m.value, label: t(m.labelKey) }))}
          />
          <SliderRow label={t('options.feather')} value={toolOptions.wand.feather} min={0} max={100} onValueChange={(v) => updateToolOptions('wand', { feather: v })} />
          <SliderRow label={t('options.tolerance')} value={toolOptions.wand.tolerance} min={0} max={255} onValueChange={(v) => updateToolOptions('wand', { tolerance: v })} />
          <SwitchRow label={t('options.contiguous')} checked={toolOptions.wand.contiguous} onCheckedChange={(v) => updateToolOptions('wand', { contiguous: v })} />
          <SwitchRow label={t('options.sampleMerged')} checked={toolOptions.wand.sampleMerged} onCheckedChange={(v) => updateToolOptions('wand', { sampleMerged: v })} />
        </Bar>
      );

    case 'fill':
      return (
        <Bar>
          <SliderRow label={t('options.tolerance')} value={toolOptions.fill.tolerance} min={0} max={255} onValueChange={(v) => updateToolOptions('fill', { tolerance: v })} />
          <SliderRow label={t('options.opacity')} value={toolOptions.fill.opacity} min={0} max={100} onValueChange={(v) => updateToolOptions('fill', { opacity: v })} />
          <SwitchRow label={t('options.contiguous')} checked={toolOptions.fill.contiguous} onCheckedChange={(v) => updateToolOptions('fill', { contiguous: v })} />
          <SwitchRow label={t('options.sampleMerged')} checked={toolOptions.fill.sampleMerged} onCheckedChange={(v) => updateToolOptions('fill', { sampleMerged: v })} />
        </Bar>
      );

    case 'gradient':
      return (
        <Bar>
          <SelectRow
            label={t('options.gradientType')}
            value={toolOptions.gradient.gradientType}
            onValueChange={(v) => updateToolOptions('gradient', { gradientType: v as 'linear' | 'radial' | 'conic' })}
            items={[
              { value: 'linear', label: t('options.gradientLinear') },
              { value: 'radial', label: t('options.gradientRadial') },
              { value: 'conic', label: t('options.gradientConic') },
            ]}
          />
          <SelectRow
            label={t('options.color')}
            value={toolOptions.gradient.preset}
            onValueChange={(v) => updateToolOptions('gradient', { preset: v })}
            items={[
              { value: 'fg-bg', label: t('options.presetFgBg') },
              { value: 'fg-transparent', label: t('options.presetFgTransparent') },
            ]}
          />
          <SwitchRow label={t('options.reverse')} checked={toolOptions.gradient.reverse} onCheckedChange={(v) => updateToolOptions('gradient', { reverse: v })} />
          <SwitchRow label={t('dialog.newDocument.transparent')} checked={toolOptions.gradient.transparency} onCheckedChange={(v) => updateToolOptions('gradient', { transparency: v })} />
        </Bar>
      );

    case 'text':
      return (
        <Bar>
          <SelectRow
            label={t('options.font')}
            value={FONT_LIST.some((f) => f.value === toolOptions.text.fontFamily) ? toolOptions.text.fontFamily : FONT_LIST[0].value}
            onValueChange={(v) => updateText({ fontFamily: v }, true)}
            items={FONT_LIST}
          />
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {t('options.fontSize')}
            <NumInput
              value={toolOptions.text.fontSize}
              min={4}
              max={999}
              onChange={(v) => updateText({ fontSize: v }, true)}
              className="h-6 w-14 px-1 text-center text-[11px]"
              ariaLabel={t('options.fontSize')}
            />
          </label>
          <div className="flex items-center gap-1">
            <ToggleChip active={toolOptions.text.fontWeight >= 600} label={t('options.bold')} bold onClick={() => updateText({ fontWeight: toolOptions.text.fontWeight >= 600 ? 400 : 700 }, true)}>
              B
            </ToggleChip>
            <ToggleChip active={toolOptions.text.italic} label={t('options.italic')} italic onClick={() => updateText({ italic: !toolOptions.text.italic }, true)}>
              I
            </ToggleChip>
            <ToggleChip active={toolOptions.text.underline} label={t('options.underline')} underline onClick={() => updateText({ underline: !toolOptions.text.underline }, true)}>
              U
            </ToggleChip>
          </div>
          <SelectRow
            label={t('options.align')}
            value={toolOptions.text.align}
            onValueChange={(v) => updateText({ align: v as TextContent['align'] }, true)}
            items={[
              { value: 'left', label: t('options.alignLeft') },
              { value: 'center', label: t('options.alignCenter') },
              { value: 'right', label: t('options.alignRight') },
            ]}
          />
          <ColorPickerButton
            label={t('options.color')}
            color={toolOptions.text.color}
            onChange={(hex) => updateText({ color: hex }, true)}
            onCommit={() =>
              useEditorStore.getState().pushRecentColor(useEditorStore.getState().toolOptions.text.color)
            }
          />
        </Bar>
      );

    case 'shape': {
      const o = toolOptions.shape;
      return (
        <Bar>
          <SelectRow
            label={t('tools.shape')}
            value={o.shape}
            onValueChange={(v) => updateToolOptions('shape', { shape: v as ShapeOptions['shape'] })}
            items={SHAPE_TYPES.map((s) => ({ value: s.value, label: t(s.labelKey) }))}
          />
          <SwitchRow label={t('options.shapeFill')} checked={o.fillEnabled} onCheckedChange={(v) => updateToolOptions('shape', { fillEnabled: v })} />
          <ColorPickerButton
            label={t('options.shapeFill')}
            color={o.fillColor}
            onChange={(hex) => updateToolOptions('shape', { fillColor: hex })}
            onCommit={() =>
              useEditorStore.getState().pushRecentColor(useEditorStore.getState().toolOptions.shape.fillColor)
            }
          />
          <SwitchRow label={t('options.shapeStroke')} checked={o.strokeEnabled} onCheckedChange={(v) => updateToolOptions('shape', { strokeEnabled: v })} />
          <ColorPickerButton
            label={t('options.shapeStroke')}
            color={o.strokeColor}
            onChange={(hex) => updateToolOptions('shape', { strokeColor: hex })}
            onCommit={() =>
              useEditorStore.getState().pushRecentColor(useEditorStore.getState().toolOptions.shape.strokeColor)
            }
          />
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {t('options.strokeWidth')}
            <NumInput
              value={o.strokeWidth}
              min={1}
              max={200}
              onChange={(v) => updateToolOptions('shape', { strokeWidth: v })}
              className="h-6 w-14 px-1 text-center text-[11px]"
              ariaLabel={t('options.strokeWidth')}
            />
          </label>
          {o.shape === 'rect' && (
            <SliderRow label={t('options.radius')} value={o.radius} min={0} max={200} onValueChange={(v) => updateToolOptions('shape', { radius: v })} />
          )}
          {o.shape === 'polygon' && (
            <SliderRow label={t('options.sides')} value={o.sides} min={3} max={20} onValueChange={(v) => updateToolOptions('shape', { sides: v })} />
          )}
          {o.shape === 'star' && (
            <>
              <SliderRow label={t('options.starPoints')} value={o.starPoints} min={3} max={24} onValueChange={(v) => updateToolOptions('shape', { starPoints: v })} />
              <SliderRow label={t('adjust.param.amount')} value={Math.round(o.starInnerRatio * 100)} min={10} max={90} onValueChange={(v) => updateToolOptions('shape', { starInnerRatio: v / 100 })} />
            </>
          )}
        </Bar>
      );
    }

    case 'move':
      return (
        <Bar>
          <SwitchRow label={t('options.autoSelect')} checked={toolOptions.move.autoSelect} onCheckedChange={(v) => updateToolOptions('move', { autoSelect: v })} />
        </Bar>
      );

    case 'eyedropper':
      return (
        <Bar>
          <SwitchRow label={t('options.sampleMerged')} checked={toolOptions.eyedropper.sampleMerged} onCheckedChange={(v) => updateToolOptions('eyedropper', { sampleMerged: v })} />
          <SliderRow label={t('options.size')} value={toolOptions.eyedropper.radius} min={0} max={20} onValueChange={(v) => updateToolOptions('eyedropper', { radius: v })} />
        </Bar>
      );

    case 'crop': {
      const ASPECT_PRESETS: { value: string; label: string; ratio: number | null }[] = [
        { value: 'free', label: t('options.aspectFree'), ratio: null },
        { value: '1:1', label: '1:1', ratio: 1 },
        { value: '4:3', label: '4:3', ratio: 4 / 3 },
        { value: '3:4', label: '3:4', ratio: 3 / 4 },
        { value: '16:9', label: '16:9', ratio: 16 / 9 },
        { value: '9:16', label: '9:16', ratio: 9 / 16 },
        { value: '3:2', label: '3:2', ratio: 3 / 2 },
        { value: '2:3', label: '2:3', ratio: 2 / 3 },
        { value: '5:4', label: '5:4', ratio: 5 / 4 },
        { value: '4:5', label: '4:5', ratio: 4 / 5 },
      ];
      const aspect = toolOptions.crop.aspect;
      const currentKey = aspect === null ? 'free' : (ASPECT_PRESETS.find((p) => p.ratio !== null && Math.abs(p.ratio - aspect) < 1e-6)?.value ?? 'free');
      return <CropOptions
        aspectKey={currentKey}
        presets={ASPECT_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
        onAspect={(v) => updateToolOptions('crop', { aspect: ASPECT_PRESETS.find((p) => p.value === v)?.ratio ?? null })}
        aspectLabel={t('options.aspect')}
        toolLabel={t(toolLabelKey(tool))}
        applyLabel={t('options.cropApply')}
        cancelLabel={t('options.cropCancel')}
      />;
    }

    case 'hand':
    case 'zoom':
    case 'pen':
      return (
        <Bar>
          <span className="text-[11px] text-muted-foreground">{t(toolLabelKey(tool))}</span>
        </Bar>
      );

    default:
      return <Bar>{null}</Bar>;
  }
}

/* ------------------------------- misc bits ------------------------------- */

interface ToggleChipProps {
  active: boolean;
  label: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToggleChip({ active, label, bold, italic, underline, onClick, children }: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-6 w-6 items-center justify-center rounded border text-xs ${
        active ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300' : 'border-border text-muted-foreground hover:bg-accent'
      }`}
      style={{ fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal', textDecoration: underline ? 'underline' : 'none' }}
    >
      {children}
    </button>
  );
}

/* ------------------------------ crop options ----------------------------- */

interface CropOptionsProps {
  aspectKey: string;
  presets: { value: string; label: string }[];
  onAspect: (value: string) => void;
  aspectLabel: string;
  toolLabel: string;
  applyLabel: string;
  cancelLabel: string;
}

/**
 * Crop tool options with explicit Apply/Cancel actions. Subscribes to the
 * crop tool's rect lifecycle so the buttons enable the moment a crop rect
 * exists and disable again after commit/cancel (Enter/double-click/Escape
 * keep working — the buttons make the flow discoverable).
 */
function CropOptions({ aspectKey, presets, onAspect, aspectLabel, toolLabel, applyLabel, cancelLabel }: CropOptionsProps) {
  const [hasRect, setHasRect] = useState(isCropRectActive());
  useEffect(() => onCropRectChange(() => setHasRect(isCropRectActive())), []);
  return (
    <Bar>
      <SelectRow label={aspectLabel} value={aspectKey} onValueChange={onAspect} items={presets} />
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          className="h-7 gap-1 rounded px-2.5 text-xs"
          disabled={!hasRect}
          title={applyLabel}
          onClick={() => commitCrop()}
        >
          <Check className="size-3.5" />
          {applyLabel}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 rounded px-2.5 text-xs"
          disabled={!hasRect}
          title={cancelLabel}
          onClick={() => cancelCrop()}
        >
          <X className="size-3.5" />
          {cancelLabel}
        </Button>
      </div>
      <span className="shrink-0 text-[11px] text-muted-foreground">{toolLabel}</span>
    </Bar>
  );
}
