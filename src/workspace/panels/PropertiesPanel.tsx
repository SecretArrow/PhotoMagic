'use client';

/**
 * PropertiesPanel — details for the active layer (per kind), plus document
 * metadata and guide management. All edits flow through store actions so
 * history stays consistent.
 */

import { useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import type {
  AdjustmentLayer,
  FillLayer,
  GroupLayer,
  Layer,
  RasterLayer,
  ShapeLayer,
  TextContent,
  TextLayer,
} from '../../engine/types';
import { useI18n } from '../../i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ColorPickerButton, NumInput, SelectRow, SliderRow, SwitchRow } from './controls';
import { AdjustmentParamsEditor } from './AdjustmentsPanel';
import { adjustmentLabelKey } from '../adjustmentPresets';
import { Trash2 } from 'lucide-react';

const FONT_LIST = [
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[#2c2d33] p-3 last:border-b-0">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

export default function PropertiesPanel() {
  const { t } = useI18n();
  const doc = useEditorStore((s) => s.doc);
  const activeId = doc.selectedLayerIds[0] ?? null;
  const activeLayer: Layer | null = activeId ? doc.layers.find((l) => l.id === activeId) ?? null : null;

  return (
    <div className="pf-scroll h-full min-h-0 overflow-y-auto">
      {activeLayer ? (
        <Section title={t('panel.properties')}>
          <LayerProperties key={activeLayer.id} layer={activeLayer} />
        </Section>
      ) : null}
      <Section title={t('status.doc')}>
        <DocumentProperties key={doc.id} />
      </Section>
      <Section title={t('properties.guides')}>
        <GuidesSection />
      </Section>
    </div>
  );
}

/* ---------------------------- active layer ---------------------------- */

function LayerProperties({ layer }: { layer: Layer }) {
  const { t } = useI18n();
  const updateLayer = useEditorStore((s) => s.updateLayer);

  const patchLayer = (patch: Partial<Layer>, labelKey: 'common.rename' | 'history.textEdit' | 'panel.adjustments' | 'options.shapeFill' | 'options.shapeStroke' | 'layers.panelMenu' = 'layers.panelMenu', fallback = 'Layer properties') => {
    updateLayer(layer.id, patch, labelKey, fallback);
  };

  const [name, setName] = useState(layer.name);
  const commitName = () => {
    const next = name.trim();
    if (next && next !== layer.name) patchLayer({ name }, 'common.rename', 'Rename layer');
    else setName(layer.name);
  };

  return (
    <>
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="w-14 shrink-0">{t('dialog.newDocument.name')}</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="h-7 text-xs"
          aria-label={t('dialog.newDocument.name')}
        />
      </label>

      <InfoRow label={t('options.mode')} value={layer.kind} />
      <InfoRow label={t('layers.opacity')} value={`${Math.round(layer.opacity * 100)}%`} />
      <InfoRow label="x / y" value={`${Math.round(layer.x)} / ${Math.round(layer.y)}`} />
      {layer.kind === 'raster' ? (
        <InfoRow label="w / h" value={`${(layer as RasterLayer).canvas.width} / ${(layer as RasterLayer).canvas.height}`} />
      ) : null}
      {layer.kind === 'shape' ? (
        <InfoRow label="w / h" value={`${Math.round((layer as ShapeLayer).bbox.w)} / ${Math.round((layer as ShapeLayer).bbox.h)}`} />
      ) : null}

      {layer.kind === 'text' ? <TextProperties layer={layer as TextLayer} /> : null}
      {layer.kind === 'shape' ? <ShapeProperties layer={layer as ShapeLayer} /> : null}
      {layer.kind === 'adjustment' ? <AdjustmentProperties layer={layer as AdjustmentLayer} /> : null}
      {layer.kind === 'fill' ? <FillProperties layer={layer as FillLayer} /> : null}
      {layer.kind === 'group' ? <GroupProperties layer={layer as GroupLayer} /> : null}

      <SwitchRow
        label={t('layer.clipToBelow')}
        checked={layer.clipToBelow}
        onCheckedChange={(v) => patchLayer({ clipToBelow: v })}
      />
    </>
  );
}

function TextProperties({ layer }: { layer: TextLayer }) {
  const { t } = useI18n();
  const updateLayer = useEditorStore((s) => s.updateLayer);
  const [draft, setDraft] = useState(layer.text.text);

  const patchText = (patch: Partial<TextContent>) => {
    updateLayer(layer.id, { text: { ...layer.text, ...patch } }, 'history.textEdit', 'Edit text');
  };

  return (
    <>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== layer.text.text && patchText({ text: draft })}
        rows={3}
        className="min-h-16 text-xs"
        aria-label={t('tools.text')}
      />
      <SelectRow
        label={t('options.font')}
        value={FONT_LIST.some((f) => f.value === layer.text.fontFamily) ? layer.text.fontFamily : FONT_LIST[0].value}
        onValueChange={(v) => patchText({ fontFamily: v })}
        items={FONT_LIST}
      />
      <SliderRow label={t('options.fontSize')} value={layer.text.fontSize} min={4} max={400} onValueChange={(v) => patchText({ fontSize: v })} />
      <div className="flex items-center gap-2">
        <ColorPickerButton label={t('options.color')} color={layer.text.color} onChange={(hex) => patchText({ color: hex })} />
        <span className="text-[11px] text-muted-foreground">{t('options.color')}</span>
      </div>
    </>
  );
}

function ShapeProperties({ layer }: { layer: ShapeLayer }) {
  const { t } = useI18n();
  const updateLayer = useEditorStore((s) => s.updateLayer);
  const patch = (p: Partial<ShapeLayer>) => updateLayer(layer.id, p as Partial<Layer>, 'options.shapeFill', 'Shape properties');
  return (
    <>
      <div className="flex items-center gap-2">
        {layer.fill && layer.fill.type === 'solid' ? (
          <ColorPickerButton
            label={t('options.shapeFill')}
            color={layer.fill.color}
            onChange={(hex) => patch({ fill: { ...layer.fill, color: hex } as ShapeLayer['fill'] })}
          />
        ) : null}
        <span className="text-[11px] text-muted-foreground">{t('options.shapeFill')}</span>
      </div>
      {layer.stroke ? (
        <>
          <div className="flex items-center gap-2">
            <ColorPickerButton
              label={t('options.shapeStroke')}
              color={layer.stroke.color}
              onChange={(hex) => patch({ stroke: { ...layer.stroke, color: hex } as ShapeLayer['stroke'] })}
            />
            <span className="text-[11px] text-muted-foreground">{t('options.shapeStroke')}</span>
          </div>
          <SliderRow
            label={t('options.strokeWidth')}
            value={layer.stroke.width}
            min={0.5}
            max={100}
            step={0.5}
            onValueChange={(v) => patch({ stroke: { ...layer.stroke, width: v } as ShapeLayer['stroke'] })}
          />
        </>
      ) : null}
    </>
  );
}

function AdjustmentProperties({ layer }: { layer: AdjustmentLayer }) {
  const { t } = useI18n();
  const updateLayer = useEditorStore((s) => s.updateLayer);
  return (
    <>
      <InfoRow label={t('image.adjustments')} value={t(adjustmentLabelKey(layer.adjustment.type))} />
      <AdjustmentParamsEditor
        spec={layer.adjustment}
        onChange={(spec) => updateLayer(layer.id, { adjustment: spec } as Partial<Layer>, 'panel.adjustments', 'Adjustment')}
      />
    </>
  );
}

function FillProperties({ layer }: { layer: FillLayer }) {
  const { t } = useI18n();
  const updateLayer = useEditorStore((s) => s.updateLayer);
  return (
    <div className="flex items-center gap-2">
      {layer.paint.type === 'solid' ? (
        <>
          <ColorPickerButton
            label={t('options.color')}
            color={layer.paint.color}
            onChange={(hex) => updateLayer(layer.id, { paint: { ...layer.paint, color: hex } } as Partial<Layer>, 'options.color', 'Fill color')}
          />
          <span className="text-[11px] text-muted-foreground">{t('options.color')}</span>
        </>
      ) : (
        <InfoRow label={t('tools.gradient')} value={layer.paint.gradient} />
      )}
    </div>
  );
}

function GroupProperties({ layer }: { layer: GroupLayer }) {
  const { t } = useI18n();
  return (
    <>
      <InfoRow label={t('properties.children')} value={String(layer.children.length)} />
      <SwitchRow
        label={t('properties.expanded')}
        checked={layer.expanded}
        onCheckedChange={(v) => useEditorStore.getState().updateLayer(layer.id, { expanded: v } as Partial<Layer>, 'layers.panelMenu', 'Layer options')}
      />
    </>
  );
}

/* ------------------------------ document ------------------------------ */

function DocumentProperties() {
  const { t } = useI18n();
  const doc = useEditorStore((s) => s.doc);
  const [name, setName] = useState(doc.name);
  const [description, setDescription] = useState(doc.description);

  const commitName = () => {
    const next = name.trim();
    if (next && next !== doc.name) useEditorStore.getState().updateDocMeta({ name: next });
    else setName(doc.name);
  };

  return (
    <>
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="w-14 shrink-0">{t('dialog.newDocument.name')}</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="h-7 text-xs"
          aria-label={t('dialog.newDocument.name')}
        />
      </label>
      <div className="flex flex-col gap-1">
        <Label className="text-[11px] text-muted-foreground">{t('dialog.export.project')}</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== doc.description && useEditorStore.getState().updateDocMeta({ description })}
          rows={2}
          className="min-h-12 text-xs"
          aria-label={t('dialog.export.project')}
        />
      </div>
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="w-14 shrink-0">{t('dialog.newDocument.dpi')}</span>
        <NumInput
          value={doc.dpi}
          min={1}
          max={2400}
          onChange={(v) => useEditorStore.getState().updateDocMeta({ dpi: v })}
          className="h-7 w-20 px-2 text-xs"
          ariaLabel={t('dialog.newDocument.dpi')}
        />
      </label>
      <InfoRow label="w / h" value={`${doc.width} / ${doc.height}`} />
    </>
  );
}

function GuidesSection() {
  const { t } = useI18n();
  const doc = useEditorStore((s) => s.doc);
  return (
    <>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="h-7 flex-1 text-[11px]"
          onClick={() => useEditorStore.getState().addGuide('x', Math.round(doc.width / 2))}
        >
          {t('properties.guideV')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 flex-1 text-[11px]"
          onClick={() => useEditorStore.getState().addGuide('y', Math.round(doc.height / 2))}
        >
          {t('properties.guideH')}
        </Button>
      </div>
      {doc.guides.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/70">{t('view.clearGuides')}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {doc.guides.map((g) => (
            <div key={g.id} className="flex items-center gap-2 text-[11px]">
              <span className="w-4 text-muted-foreground">{g.axis === 'x' ? 'V' : 'H'}</span>
              <span className="flex-1 font-mono text-foreground">{Math.round(g.position)}</span>
              <Button
                variant="ghost"
                size="icon" className="size-7"
                aria-label={t('common.delete')}
                title={t('common.delete')}
                onClick={() => useEditorStore.getState().removeGuide(g.id)}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => useEditorStore.getState().clearGuides()}>
            {t('view.clearGuides')}
          </Button>
        </div>
      )}
    </>
  );
}
