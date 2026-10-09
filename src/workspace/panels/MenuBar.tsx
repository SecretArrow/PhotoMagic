'use client';

/**
 * MenuBar — classic menu strip (File/Edit/Image/Layer/Select/Filter/View/Help)
 * wired to store actions and shared commands. The Filter menu is generated
 * from the filter registry grouped by category.
 */

import { useMemo } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { SHORTCUT_TABLE, formatShortcut } from '../../shortcuts';
import { listFilters, getFilter } from '../../engine/filters/registry';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/dictionaries';
import { toast } from '../../hooks/use-toast';
import {
  clearSelectionRegion,
  copyActiveLayerToClipboard,
  cutActiveLayerToClipboard,
  dispatchFit,
  fillActiveLayerWithColor,
  openFilePicker,
  pasteClipboardAsLayer,
  resetWorkspace,
  saveProjectToDisk,
  toastText,
} from '../commands';
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from '@/components/ui/menubar';
import type { NumericPromptState } from '../dialogs/NumericPromptDialog';

function shortcutFor(id: string, mac: boolean): string | null {
  const def = SHORTCUT_TABLE.find((d) => d.id === id);
  if (!def) return null;
  return formatShortcut(def.keysMac && mac ? def.keysMac : def.keys, mac);
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
  const platform = typeof navigator.platform === 'string' ? navigator.platform : '';
  return /Mac|iPhone|iPad|iPod/.test(ua) || /Mac|iPhone|iPad|iPod/.test(platform);
}

interface MenuBarProps {
  openNumericPrompt: (state: NumericPromptState) => void;
}

export default function MenuBar({ openNumericPrompt }: MenuBarProps) {
  const { t } = useI18n();
  const mac = useMemo(() => isMacPlatform(), []);
  const filters = useMemo(() => listFilters(), []);
  const rulersVisible = useEditorStore((s) => s.settings.rulersVisible);
  const gridVisible = useEditorStore((s) => s.settings.gridVisible);
  const beforeAfter = useEditorStore((s) => s.ui.beforeAfter);
  const hasSelection = useEditorStore((s) => s.selection !== null);

  const store = useEditorStore;
  const getState = () => store.getState();

  const openFilterDialog = (op: string) => {
    const def = getFilter(op);
    if (!def) return;
    const params: Record<string, number | string | boolean> = {};
    for (const p of def.params) params[p.key] = p.defaultValue;
    getState().setFilterDialog({ open: true, op, params });
    getState().setDialog('filter-gallery');
  };

  const copyCommand = () => {
    if (copyActiveLayerToClipboard()) toast({ title: toastText('toast.copied', 'Copied') });
  };

  const pasteCommand = () => {
    if (pasteClipboardAsLayer()) toast({ title: toastText('toast.pasted', 'Pasted') });
  };

  const withShortcut = (id: string) => {
    const s = shortcutFor(id, mac);
    return s ? <MenubarShortcut>{s}</MenubarShortcut> : null;
  };

  return (
    <Menubar className="h-8 shrink-0 items-center gap-0 rounded-none border-b border-[#2c2d33] bg-[#1b1c20] px-1">
      {/* ------------------------------- File ------------------------------- */}
      <MenubarMenu>
        <MenubarTrigger className="px-2 text-xs">{t('menu.file')}</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => getState().setDialog('new-document')}>
            {t('file.new')}
            {withShortcut('file.new')}
          </MenubarItem>
          <MenubarItem onClick={openFilePicker}>
            {t('file.open')}
            {withShortcut('file.open')}
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => void saveProjectToDisk()}>
            {t('file.saveProject')}
            {withShortcut('file.saveProject')}
          </MenubarItem>
          <MenubarItem onClick={() => getState().setDialog('export')}>
            {t('file.export')}
            {withShortcut('file.export')}
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => getState().closeDocument(getState().activeDocId)}>{t('file.close')}</MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      {/* ------------------------------- Edit ------------------------------- */}
      <MenubarMenu>
        <MenubarTrigger className="px-2 text-xs">{t('menu.edit')}</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => getState().undo()}>
            {t('edit.undo')}
            {withShortcut('edit.undo')}
          </MenubarItem>
          <MenubarItem onClick={() => getState().redo()}>
            {t('edit.redo')}
            {withShortcut('edit.redo')}
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => void cutActiveLayerToClipboard()}>
            {t('edit.cut')}
            {withShortcut('edit.cut')}
          </MenubarItem>
          <MenubarItem onClick={copyCommand}>
            {t('edit.copy')}
            {withShortcut('edit.copy')}
          </MenubarItem>
          <MenubarItem onClick={pasteCommand}>
            {t('edit.paste')}
            {withShortcut('edit.paste')}
          </MenubarItem>
          <MenubarItem onClick={() => clearSelectionRegion('edit.clear', 'Clear')}>
            {t('edit.clear')}
            {withShortcut('select.delete')}
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem
            onClick={() => {
              if (fillActiveLayerWithColor(getState().fgColor, 'edit.fillFg', 'Fill with foreground')) {
                toast({ title: toastText('toast.fillDone', 'Filled') });
              }
            }}
          >
            {t('edit.fillFg')}
            {withShortcut('edit.fillFg')}
          </MenubarItem>
          <MenubarItem
            onClick={() => {
              if (fillActiveLayerWithColor(getState().bgColor, 'color.bg', 'Background')) {
                toast({ title: toastText('toast.fillDone', 'Filled') });
              }
            }}
          >
            {t('color.bg')}
            {withShortcut('edit.fillBg')}
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => getState().setDialog('settings')}>{t('edit.preferences')}</MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      {/* ------------------------------- Image ------------------------------ */}
      <MenubarMenu>
        <MenubarTrigger className="px-2 text-xs">{t('menu.image')}</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => getState().setDialog('image-size')}>
            {t('image.imageSize')}
            {withShortcut('image.imageSize')}
          </MenubarItem>
          <MenubarItem onClick={() => getState().setDialog('canvas-size')}>
            {t('image.canvasSize')}
            {withShortcut('image.canvasSize')}
          </MenubarItem>
          <MenubarItem
            disabled={!hasSelection}
            onClick={() => {
              const sel = getState().selection;
              if (sel) getState().cropTo({ x: sel.bounds.x, y: sel.bounds.y, w: sel.bounds.w, h: sel.bounds.h });
            }}
          >
            {t('image.cropToSelection')}
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => getState().flipDocument('x')}>{t('image.flipH')}</MenubarItem>
          <MenubarItem onClick={() => getState().flipDocument('y')}>{t('image.flipV')}</MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => getState().rotateDocument90(true)}>{t('image.rotate90cw')}</MenubarItem>
          <MenubarItem onClick={() => getState().rotateDocument90(false)}>{t('image.rotate90ccw')}</MenubarItem>
          <MenubarSeparator />
          <MenubarItem
            onClick={() => {
              if (!getState().ui.panelsVisible) getState().togglePanels();
              getState().setRightPanel('adjustments');
            }}
          >
            {t('image.adjustments')}
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      {/* ------------------------------- Layer ------------------------------ */}
      <MenubarMenu>
        <MenubarTrigger className="px-2 text-xs">{t('menu.layer')}</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => getState().addRasterLayer()}>
            {t('layer.newRaster')}
            {withShortcut('layer.newRaster')}
          </MenubarItem>
          <MenubarItem onClick={() => getState().addTextLayer()}>{t('layer.newText')}</MenubarItem>
          <MenubarItem onClick={() => getState().addFillLayer({ type: 'solid', color: getState().fgColor })}>{t('layer.newFill')}</MenubarItem>
          <MenubarItem onClick={() => getState().addGroupFromSelection()}>{t('layer.newGroup')}</MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => getState().duplicateLayers()}>
            {t('layer.duplicate')}
            {withShortcut('layer.duplicate')}
          </MenubarItem>
          <MenubarItem onClick={() => getState().deleteLayers()}>{t('layer.delete')}</MenubarItem>
          <MenubarSeparator />
          <MenubarItem
            onClick={() => {
              const id = getState().doc.selectedLayerIds[0];
              if (id) getState().mergeDown(id);
            }}
          >
            {t('layer.mergeDown')}
          </MenubarItem>
          <MenubarItem onClick={() => getState().mergeVisible()}>{t('layer.mergeVisible')}</MenubarItem>
          <MenubarItem onClick={() => getState().flattenImage()}>{t('layer.flatten')}</MenubarItem>
          <MenubarItem
            onClick={() => {
              const id = getState().doc.selectedLayerIds[0];
              if (id) getState().rasterizeLayer(id);
            }}
          >
            {t('layer.rasterize')}
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      {/* ------------------------------- Select ----------------------------- */}
      <MenubarMenu>
        <MenubarTrigger className="px-2 text-xs">{t('menu.select')}</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => getState().selectAll()}>
            {t('select.all')}
            {withShortcut('select.all')}
          </MenubarItem>
          <MenubarItem onClick={() => getState().deselect()}>
            {t('select.deselect')}
            {withShortcut('select.deselect')}
          </MenubarItem>
          <MenubarItem onClick={() => getState().invertSelectionAction()}>
            {t('select.inverse')}
            {withShortcut('select.inverse')}
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem
            onClick={() =>
              openNumericPrompt({ titleKey: 'select.feather', min: 0, max: 250, initial: 2, onApply: (v) => getState().featherSelectionAction(v) })
            }
          >
            {t('select.feather')}
          </MenubarItem>
          <MenubarItem
            onClick={() => openNumericPrompt({ titleKey: 'select.grow', min: 1, max: 250, initial: 2, onApply: (v) => getState().growSelectionAction(v) })}
          >
            {t('select.grow')}
          </MenubarItem>
          <MenubarItem
            onClick={() =>
              openNumericPrompt({ titleKey: 'select.contract', min: 1, max: 250, initial: 2, onApply: (v) => getState().contractSelectionAction(v) })
            }
          >
            {t('select.contract')}
          </MenubarItem>
          <MenubarItem
            onClick={() => openNumericPrompt({ titleKey: 'select.border', min: 1, max: 250, initial: 4, onApply: (v) => getState().borderSelectionAction(v) })}
          >
            {t('select.border')}
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      {/* ------------------------------- Filter ----------------------------- */}
      <MenubarMenu>
        <MenubarTrigger className="px-2 text-xs">{t('menu.filter')}</MenubarTrigger>
        <MenubarContent className="max-h-[60vh] overflow-y-auto">
          {(['blur', 'sharpen', 'noise', 'stylize', 'distort', 'light', 'artistic'] as const).map((cat) => {
            const group = filters.filter((f) => f.category === cat);
            if (group.length === 0) return null;
            const labelKey = `filter.category.${cat}` as TranslationKey;
            return (
              <MenubarSub key={cat}>
                <MenubarSubTrigger>{t(labelKey)}</MenubarSubTrigger>
                <MenubarSubContent className="max-h-[50vh] overflow-y-auto">
                  {group.map((f) => (
                    <MenubarItem key={f.op} onClick={() => openFilterDialog(f.op)}>
                      {t(f.labelKey as TranslationKey)}
                    </MenubarItem>
                  ))}
                </MenubarSubContent>
              </MenubarSub>
            );
          })}
        </MenubarContent>
      </MenubarMenu>

      {/* -------------------------------- View ------------------------------ */}
      <MenubarMenu>
        <MenubarTrigger className="px-2 text-xs">{t('menu.view')}</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => getState().zoomBy(1.25)}>
            {t('view.zoomIn')}
            {withShortcut('view.zoomIn')}
          </MenubarItem>
          <MenubarItem onClick={() => getState().zoomBy(1 / 1.25)}>
            {t('view.zoomOut')}
            {withShortcut('view.zoomOut')}
          </MenubarItem>
          <MenubarItem onClick={dispatchFit}>
            {t('view.fitScreen')}
            {withShortcut('view.fitScreen')}
          </MenubarItem>
          <MenubarItem onClick={() => getState().setZoom(1)}>
            {t('view.actualPixels')}
            {withShortcut('view.actualPixels')}
          </MenubarItem>
          <MenubarSeparator />
          <MenubarCheckboxItem
            checked={rulersVisible}
            onSelect={(e) => {
              e.preventDefault();
              getState().updateSettings({ rulersVisible: !getState().settings.rulersVisible });
            }}
          >
            {t('view.toggleRulers')}
            {withShortcut('view.toggleRulers')}
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={gridVisible}
            onSelect={(e) => {
              e.preventDefault();
              getState().updateSettings({ gridVisible: !getState().settings.gridVisible });
            }}
          >
            {t('view.toggleGrid')}
            {withShortcut('view.toggleGrid')}
          </MenubarCheckboxItem>
          <MenubarItem onClick={() => getState().clearGuides()}>{t('view.clearGuides')}</MenubarItem>
          <MenubarSeparator />
          <MenubarCheckboxItem
            checked={beforeAfter}
            onSelect={(e) => {
              e.preventDefault();
              getState().setBeforeAfter(!getState().ui.beforeAfter);
            }}
          >
            {t('view.beforeAfter')}
          </MenubarCheckboxItem>
          <MenubarItem onClick={() => getState().togglePanels()}>
            {t('view.togglePanels')}
            {withShortcut('view.togglePanels')}
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={resetWorkspace}>{t('view.resetWorkspace')}</MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      {/* -------------------------------- Help ------------------------------ */}
      <MenubarMenu>
        <MenubarTrigger className="px-2 text-xs">{t('menu.help')}</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => getState().setDialog('shortcuts')}>
            {t('help.shortcuts')}
            {withShortcut('help.shortcuts')}
          </MenubarItem>
          <MenubarItem onClick={() => getState().setDialog('storage')}>{t('dialog.settings.storage')}</MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => getState().setDialog('about')}>{t('help.about')}</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}
