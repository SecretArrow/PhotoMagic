'use client';

/**
 * LayersPanel — layer list (top-first), reorder via dnd-kit (root level),
 * blend/opacity for the active layer, add menu, context menu per row with
 * mask operations, inline rename and visibility/lock toggles.
 *
 * v2 note: child-level reordering inside groups; drag between groups.
 */

import { memo, useMemo, useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import type { GroupLayer, Layer } from '../../engine/types';
import { BLEND_MODES, blendLabelKey } from '../../engine/blend';
import { layerThumbnail, maskThumbnail } from '../../engine/render';
import { useI18n } from '../../i18n';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  LockOpen,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SliderRow } from './controls';
import { ADJUSTMENT_PRESETS } from '../adjustmentPresets';

interface DisplayItem {
  layer: Layer;
  depth: number;
  sortable: boolean;
}

export default function LayersPanel() {
  const { t } = useI18n();
  const doc = useEditorStore((s) => s.doc);
  const revision = useEditorStore((s) => s.revision);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const activeId = doc.selectedLayerIds[0] ?? null;
  const activeLayer = useMemo(
    () => doc.layers.find((l) => l.id === activeId) ?? null,
    [doc.layers, activeId],
  );

  /* display list: top-first, groups expanded inline (root-level sortable only) */
  const displayItems = useMemo<DisplayItem[]>(() => {
    const out: DisplayItem[] = [];
    const q = query.trim().toLowerCase();
    const pushLayer = (layer: Layer, depth: number, sortable: boolean) => {
      if (q && !layer.name.toLowerCase().includes(q)) return;
      out.push({ layer, depth, sortable });
      if (layer.kind === 'group' && (layer as GroupLayer).expanded) {
        for (const child of (layer as GroupLayer).children) pushLayer(child, depth + 1, false);
      }
    };
    for (let i = doc.layers.length - 1; i >= 0; i--) pushLayer(doc.layers[i], 0, true);
    return out;
  }, [doc.layers, query]);

  const sortableIds = useMemo(() => displayItems.filter((d) => d.sortable).map((d) => d.layer.id), [displayItems]);

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = sortableIds;
    const to = ids.indexOf(String(e.over.id));
    if (to < 0) return;
    const store = useEditorStore.getState();
    store.moveLayerTo(String(e.active.id), null, doc.layers.length - 1 - to);
  };

  const commitRename = () => {
    if (!editingId) return;
    const name = editName.trim();
    if (name.length > 0) {
      useEditorStore.getState().updateLayer(editingId, { name }, 'common.rename', 'Rename layer');
    }
    setEditingId(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header actions */}
      <div className="flex items-center gap-1 border-b border-[#2c2d33] p-1.5">
        <AddLayerMenu />
        <Button
          variant="ghost"
          size="icon" className="size-7"
          title={t('layer.duplicate')}
          aria-label={t('layer.duplicate')}
          disabled={doc.selectedLayerIds.length === 0}
          onClick={() => useEditorStore.getState().duplicateLayers()}
        >
          <Copy className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon" className="size-7"
          title={t('layer.delete')}
          aria-label={t('layer.delete')}
          disabled={doc.selectedLayerIds.length === 0}
          onClick={() => useEditorStore.getState().deleteLayers()}
        >
          <Trash2 className="size-3.5" />
        </Button>
        <div className="relative ml-auto w-28">
          <Search className="pointer-events-none absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('layers.search')}
            aria-label={t('layers.search')}
            className="h-6 border-none bg-[#26272c] pl-6 text-[11px]"
          />
        </div>
      </div>

      {/* blend + opacity for the active layer */}
      <div className="flex flex-col gap-1.5 border-b border-[#2c2d33] p-2">
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="w-12 shrink-0">{t('options.mode')}</span>
          <select
            value={activeLayer?.blendMode ?? 'normal'}
            aria-label={t('options.mode')}
            disabled={!activeLayer}
            onChange={(e) => {
              if (!activeLayer) return;
              useEditorStore
                .getState()
                .updateLayer(activeLayer.id, { blendMode: e.target.value as Layer['blendMode'] }, 'options.mode', 'Blend mode');
            }}
            className="h-6 min-w-0 flex-1 rounded-md border border-input bg-transparent px-1 text-[11px] text-foreground outline-none"
          >
            {BLEND_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(blendLabelKey(mode) as never)}
              </option>
            ))}
          </select>
        </label>
        <SliderRow
          label={t('layers.opacity')}
          value={Math.round((activeLayer?.opacity ?? 1) * 100)}
          min={0}
          max={100}
          onValueChange={(v) => {
            // live update while dragging — history is pushed once on commit
            const store = useEditorStore.getState();
            const layer = store.getActiveLayer();
            if (!layer) return;
            store.beginLayerEdit(layer.id);
            store.updateLayerLive(layer.id, { opacity: v / 100 });
          }}
          onValueCommit={() => {
            const store = useEditorStore.getState();
            const layer = store.getActiveLayer();
            if (layer) store.endLayerEdit(layer.id, 'layers.opacity', 'Layer opacity');
          }}
        />
      </div>

      {/* layer list */}
      <div className="pf-scroll min-h-0 flex-1 overflow-y-auto p-1">
        {displayItems.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t('layers.empty')}</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {displayItems.map((item) => (
                <LayerRow
                  key={item.layer.id}
                  layer={item.layer}
                  doc={doc}
                  revision={revision}
                  depth={item.depth}
                  sortable={item.sortable}
                  selected={doc.selectedLayerIds.includes(item.layer.id)}
                  editing={editingId === item.layer.id}
                  editName={editingId === item.layer.id ? editName : ''}
                  onEditNameChange={setEditName}
                  onStartRename={(id, name) => {
                    setEditingId(id);
                    setEditName(name);
                  }}
                  onCommitRename={commitRename}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- add menu ------------------------------- */

function AddLayerMenu() {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" title={t('layers.panelAdd')} aria-label={t('layers.panelAdd')}>
          <Plus className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem onClick={() => useEditorStore.getState().addRasterLayer()}>{t('layer.newRaster')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => useEditorStore.getState().addTextLayer()}>{t('layer.newText')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => useEditorStore.getState().addFillLayer({ type: 'solid', color: useEditorStore.getState().fgColor })}>
          {t('layer.newFill')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => useEditorStore.getState().addGroupFromSelection()}>{t('layer.newGroup')}</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t('layer.newAdjustment')}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
            {ADJUSTMENT_PRESETS.map((preset) => (
              <DropdownMenuItem key={preset.type} onClick={() => useEditorStore.getState().addAdjustmentLayer(preset.spec)}>
                {t(preset.labelKey)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* -------------------------------- row -------------------------------- */

interface LayerRowProps {
  layer: Layer;
  doc: ReturnType<typeof useEditorStore.getState>['doc'];
  revision: number;
  depth: number;
  sortable: boolean;
  selected: boolean;
  editing: boolean;
  editName: string;
  onEditNameChange: (v: string) => void;
  onStartRename: (id: string, current: string) => void;
  onCommitRename: () => void;
}

const LayerRow = memo(function LayerRow({
  layer,
  doc,
  revision,
  depth,
  sortable,
  selected,
  editing,
  editName,
  onEditNameChange,
  onStartRename,
  onCommitRename,
}: LayerRowProps) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: layer.id,
    disabled: !sortable,
  });

  const group = layer.kind === 'group' ? (layer as GroupLayer) : null;

  const toggleExpanded = () => {
    if (!group) return;
    useEditorStore.getState().updateLayer(layer.id, { expanded: !group.expanded }, 'layers.panelMenu', 'Layer options');
  };

  const row = (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={{
            transform: CSS.Transform.toString(transform),
            transition,
            paddingLeft: 4 + depth * 14,
          }}
          data-selected={selected || undefined}
          className={`group/row flex h-11 cursor-default items-center gap-1.5 rounded-md pr-1 text-xs ${
            selected ? 'bg-emerald-500/15 text-foreground' : 'text-muted-foreground hover:bg-accent/60'
          } ${isDragging ? 'z-10 opacity-80 shadow-md' : ''}`}
          onClick={(e) => {
            const additive = e.ctrlKey || e.metaKey || e.shiftKey;
            useEditorStore.getState().selectLayer(layer.id, additive);
          }}
        >
          {sortable ? (
            <button
              type="button"
              aria-label={t('layers.panelMenu')}
              className="flex h-6 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/50 hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-3" />
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          {group ? (
            <button
              type="button"
              aria-label={group.expanded ? t('properties.expanded') : t('layers.panelMenu')}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded();
              }}
            >
              {group.expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          ) : null}

          <LayerThumb layer={layer} doc={doc} revision={revision} />

          {editing ? (
            <input
              autoFocus
              value={editName}
              onChange={(e) => onEditNameChange(e.target.value)}
              onBlur={onCommitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCommitRename();
                if (e.key === 'Escape') onStartRename('', '');
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-6 min-w-0 flex-1 rounded border border-ring bg-[#26272c] px-1 text-xs outline-none"
              aria-label={t('common.rename')}
            />
          ) : (
            <span
              className="min-w-0 flex-1 truncate"
              title={layer.name}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onStartRename(layer.id, layer.name);
              }}
            >
              {layer.name}
            </span>
          )}

          {layer.mask ? <span className="size-2 shrink-0 rounded-full bg-emerald-400/70" title={t('layer.addMask')} /> : null}
          {layer.locked ? <Lock className="size-3 shrink-0 text-amber-400/80" /> : null}

          <button
            type="button"
            aria-label={t('layers.hidden')}
            title={t('layers.hidden')}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-accent ${layer.visible ? '' : 'text-muted-foreground/40'}`}
            onClick={(e) => {
              e.stopPropagation();
              useEditorStore.getState().updateLayer(layer.id, { visible: !layer.visible }, 'layers.panelMenu', 'Layer options');
            }}
          >
            {layer.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          </button>
          <button
            type="button"
            aria-label={t('layers.locked')}
            title={t('layers.locked')}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-accent ${layer.locked ? 'text-amber-400' : 'text-muted-foreground/50'}`}
            onClick={(e) => {
              e.stopPropagation();
              useEditorStore.getState().updateLayer(layer.id, { locked: !layer.locked }, 'layers.locked', 'Lock layer');
            }}
          >
            {layer.locked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={() => onStartRename(layer.id, layer.name)}>{t('common.rename')}</ContextMenuItem>
        <ContextMenuItem onClick={() => useEditorStore.getState().duplicateLayers([layer.id])}>{t('layer.duplicate')}</ContextMenuItem>
        <ContextMenuItem onClick={() => useEditorStore.getState().deleteLayers([layer.id])}>{t('layer.delete')}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={layer.kind === 'raster' || layer.kind === 'group'} onClick={() => useEditorStore.getState().rasterizeLayer(layer.id)}>
          {t('layer.rasterize')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {layer.mask ? (
          <ContextMenuCheckboxItem
            checked={layer.mask.enabled}
            onCheckedChange={(v) => useEditorStore.getState().updateMask(layer.id, { enabled: v === true })}
          >
            {t('layer.addMask')}
          </ContextMenuCheckboxItem>
        ) : null}
        <ContextMenuItem disabled={!!layer.mask} onClick={() => useEditorStore.getState().addMask(layer.id, false)}>
          {t('layer.addMask')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!!layer.mask} onClick={() => useEditorStore.getState().addMask(layer.id, true)}>
          {t('layer.addMaskFromSelection')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!layer.mask} onClick={() => useEditorStore.getState().applyMask(layer.id)}>
          {t('layer.applyMask')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!layer.mask} onClick={() => useEditorStore.getState().deleteMask(layer.id)}>
          {t('layer.deleteMask')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuCheckboxItem checked={layer.clipToBelow} onCheckedChange={(v) => useEditorStore.getState().updateLayer(layer.id, { clipToBelow: v === true }, 'layer.clipToBelow', 'Clip to layer below')}>
          {t('layer.clipToBelow')}
        </ContextMenuCheckboxItem>
      </ContextMenuContent>
    </ContextMenu>
  );

  return row;
});

/* ------------------------------ thumbnails ------------------------------ */

const LayerThumb = memo(function LayerThumb({
  layer,
  doc,
  revision,
}: {
  layer: Layer;
  doc: ReturnType<typeof useEditorStore.getState>['doc'];
  revision: number;
}) {
  const url = layerThumbnail(layer, doc, revision, 40);
  const maskUrl = maskThumbnail(layer, revision, 40);
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded border border-[#3a3b42] bg-[#26272c]">
      {url ? (
        <img src={url} alt="" className="max-h-full max-w-full" draggable={false} />
      ) : null}
      {maskUrl ? (
        <img src={maskUrl} alt="" className="absolute bottom-0 right-0 size-3.5 rounded-sm border border-[#3a3b42]" draggable={false} />
      ) : null}
    </span>
  );
});
