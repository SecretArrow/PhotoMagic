'use client';

/**
 * GlobalKeys — one capturing window keydown listener that resolves
 * SHORTCUT_TABLE expressions and dispatches editor commands.
 *
 * Guards:
 *  - ignores events originating from inputs/textareas/contentEditable
 *  - Tab is handled explicitly (parseEvent keeps multi-char key names intact,
 *    so the table expression 'tab' is matched manually here)
 *  - browser-only combos (F12 etc.) are never in the table, so they pass
 */

import { useEffect, useRef } from 'react';
import { useEditorStore } from '../state/editorStore';
import { SHORTCUT_TABLE, TOOL_SHORTCUTS, matchesShortcut, parseEvent } from '../shortcuts';
import { handleOpenFiles } from './commands';
import { toast } from '../hooks/use-toast';
import {
  adjustActivePaintSize,
  clearSelectionRegion,
  copyActiveLayerToClipboard,
  cutActiveLayerToClipboard,
  dispatchFit,
  fillActiveLayerWithColor,
  openFilePicker,
  pasteClipboardAsLayer,
  saveProjectToDisk,
  toastText,
} from './commands';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
  const platform = typeof navigator.platform === 'string' ? navigator.platform : '';
  return /Mac|iPhone|iPad|iPod/.test(ua) || /Mac|iPhone|iPad|iPod/.test(platform);
}

function runCommand(id: string, keysExpr: string): boolean {
  const store = useEditorStore.getState();
  if (id.startsWith('tool.')) {
    // resolve through the exact table expression that matched (v / shift+m / …)
    const tool = TOOL_SHORTCUTS[keysExpr];
    if (tool) {
      store.setTool(tool);
      return true;
    }
    return false;
  }
  switch (id) {
    case 'edit.undo':
      store.undo();
      return true;
    case 'edit.redo':
    case 'edit.redoAlt':
      store.redo();
      return true;
    case 'edit.copy':
      if (copyActiveLayerToClipboard()) {
        toast({ title: toastText('toast.copied', 'Copied') });
        return true;
      }
      return false;
    case 'edit.paste':
      if (pasteClipboardAsLayer()) {
        toast({ title: toastText('toast.pasted', 'Pasted') });
        return true;
      }
      return false;
    case 'edit.cut':
      if (cutActiveLayerToClipboard()) {
        toast({ title: toastText('toast.copied', 'Copied') });
        return true;
      }
      return false;
    case 'edit.fillFg':
      if (fillActiveLayerWithColor(store.fgColor, 'edit.fillFg', 'Fill with foreground')) {
        toast({ title: toastText('toast.fillDone', 'Filled') });
        return true;
      }
      return false;
    case 'edit.fillBg':
      if (fillActiveLayerWithColor(store.bgColor, 'color.bg', 'Background')) {
        toast({ title: toastText('toast.fillDone', 'Filled') });
        return true;
      }
      return false;
    case 'select.all':
      store.selectAll();
      return true;
    case 'select.deselect':
      store.deselect();
      return true;
    case 'select.inverse':
      store.invertSelectionAction();
      return true;
    case 'select.delete':
      return clearSelectionRegion('edit.clear', 'Clear');
    case 'file.new':
      store.setDialog('new-document');
      return true;
    case 'file.open':
      openFilePicker();
      return true;
    case 'file.saveProject':
      void saveProjectToDisk();
      return true;
    case 'file.export':
      store.setDialog('export');
      return true;
    case 'image.imageSize':
      store.setDialog('image-size');
      return true;
    case 'image.canvasSize':
      store.setDialog('canvas-size');
      return true;
    case 'layer.newRaster':
      store.addRasterLayer();
      return true;
    case 'layer.duplicate':
      store.duplicateLayers();
      return true;
    case 'view.zoomIn':
      store.zoomBy(1.25);
      return true;
    case 'view.zoomOut':
      store.zoomBy(1 / 1.25);
      return true;
    case 'view.fitScreen':
      dispatchFit();
      return true;
    case 'view.actualPixels':
      store.setZoom(1);
      return true;
    case 'view.toggleGrid':
      store.updateSettings({ gridVisible: !store.settings.gridVisible });
      return true;
    case 'view.togglePanels':
      store.togglePanels();
      return true;
    case 'color.swap':
      store.swapColors();
      return true;
    case 'color.reset':
      store.setFgColor('#111111');
      store.setBgColor('#ffffff');
      return true;
    case 'brush.smaller':
      adjustActivePaintSize(-2);
      return true;
    case 'brush.bigger':
      adjustActivePaintSize(2);
      return true;
    case 'help.shortcuts':
      store.setDialog('shortcuts');
      return true;
    default:
      return false;
  }
}

export default function GlobalKeys() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const mac = isMacPlatform();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (isEditableTarget(e.target)) return;

      if (e.key === 'Tab') {
        // togglePanels owns Tab (view.togglePanels); never breaks a11y focus
        // inside editable targets (already guarded above).
        e.preventDefault();
        useEditorStore.getState().togglePanels();
        return;
      }

      const parsed = parseEvent(e);
      for (const def of SHORTCUT_TABLE) {
        if (def.keys === 'tab') continue; // handled above
        const exprs = def.keysMac && mac ? [def.keysMac, def.keys] : [def.keys];
        if (!exprs.some((expr) => matchesShortcut(parsed, expr, mac))) continue;
        const handled = runCommand(def.id, def.keys);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
    };

    const onOpenFile = () => fileInputRef.current?.click();

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pf:open-file', onOpenFile);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pf:open-file', onOpenFile);
    };
  }, []);

  return (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml,application/json,.pfs"
      className="hidden"
      aria-hidden
      tabIndex={-1}
      onChange={(e) => {
        const files = e.target.files;
        if (files && files.length > 0) void handleOpenFiles(files);
        e.target.value = '';
      }}
    />
  );
}
