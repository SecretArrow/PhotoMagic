/**
 * Keyboard shortcut system.
 *
 * A single global keydown handler dispatches to command handlers registered
 * by the workspace. Shortcuts are data-driven so the shortcuts dialog and
 * future customization read from the same table.
 */

import type { ToolId } from '../engine/types';

export interface ShortcutDef {
  id: string;
  labelKey: string;
  /** normalized key expression, e.g. 'mod+z', 'shift+mod+z', 'b', '[' */
  keys: string;
  /** macOS variant when different (cmd vs ctrl) */
  keysMac?: string;
  scope: 'global' | 'tool' | 'view';
}

export const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: 'move',
  m: 'marquee-rect',
  'shift+m': 'marquee-ellipse',
  l: 'lasso',
  'shift+l': 'polygonal-lasso',
  w: 'magic-wand',
  c: 'crop',
  i: 'eyedropper',
  b: 'brush',
  n: 'pencil',
  e: 'eraser',
  a: 'airbrush',
  'shift+e': 'smudge',
  u: 'shape',
  g: 'fill',
  'shift+g': 'gradient',
  t: 'text',
  s: 'clone-stamp',
  o: 'dodge',
  'shift+o': 'burn',
  h: 'hand',
  z: 'zoom',
  p: 'pen',
};

export const SHORTCUT_TABLE: ShortcutDef[] = [
  { id: 'tool.move', labelKey: 'tools.move', keys: 'v', scope: 'tool' },
  { id: 'tool.marqueeRect', labelKey: 'tools.marqueeRect', keys: 'm', scope: 'tool' },
  { id: 'tool.marqueeEllipse', labelKey: 'tools.marqueeEllipse', keys: 'shift+m', scope: 'tool' },
  { id: 'tool.lasso', labelKey: 'tools.lasso', keys: 'l', scope: 'tool' },
  { id: 'tool.polygonalLasso', labelKey: 'tools.polygonalLasso', keys: 'shift+l', scope: 'tool' },
  { id: 'tool.wand', labelKey: 'tools.wand', keys: 'w', scope: 'tool' },
  { id: 'tool.crop', labelKey: 'tools.crop', keys: 'c', scope: 'tool' },
  { id: 'tool.eyedropper', labelKey: 'tools.eyedropper', keys: 'i', scope: 'tool' },
  { id: 'tool.brush', labelKey: 'tools.brush', keys: 'b', scope: 'tool' },
  { id: 'tool.pencil', labelKey: 'tools.pencil', keys: 'n', scope: 'tool' },
  { id: 'tool.eraser', labelKey: 'tools.eraser', keys: 'e', scope: 'tool' },
  { id: 'tool.airbrush', labelKey: 'tools.airbrush', keys: 'a', scope: 'tool' },
  { id: 'tool.smudge', labelKey: 'tools.smudge', keys: 'shift+e', scope: 'tool' },
  { id: 'tool.clone', labelKey: 'tools.clone', keys: 's', scope: 'tool' },
  { id: 'tool.fill', labelKey: 'tools.fill', keys: 'g', scope: 'tool' },
  { id: 'tool.gradient', labelKey: 'tools.gradient', keys: 'shift+g', scope: 'tool' },
  { id: 'tool.text', labelKey: 'tools.text', keys: 't', scope: 'tool' },
  { id: 'tool.shape', labelKey: 'tools.shape', keys: 'u', scope: 'tool' },
  { id: 'tool.pen', labelKey: 'tools.pen', keys: 'p', scope: 'tool' },
  { id: 'tool.hand', labelKey: 'tools.hand', keys: 'h', scope: 'tool' },
  { id: 'tool.zoom', labelKey: 'tools.zoom', keys: 'z', scope: 'tool' },
  { id: 'edit.undo', labelKey: 'edit.undo', keys: 'mod+z', scope: 'global' },
  { id: 'edit.redo', labelKey: 'edit.redo', keys: 'mod+shift+z', keysMac: 'cmd+shift+z', scope: 'global' },
  { id: 'edit.redoAlt', labelKey: 'edit.redo', keys: 'mod+y', scope: 'global' },
  { id: 'edit.copy', labelKey: 'edit.copy', keys: 'mod+c', scope: 'global' },
  { id: 'edit.paste', labelKey: 'edit.paste', keys: 'mod+v', scope: 'global' },
  { id: 'edit.cut', labelKey: 'edit.cut', keys: 'mod+x', scope: 'global' },
  { id: 'edit.fillFg', labelKey: 'edit.fillFg', keys: 'alt+backspace', scope: 'global' },
  { id: 'edit.fillBg', labelKey: 'color.bg', keys: 'mod+backspace', scope: 'global' },
  { id: 'select.all', labelKey: 'select.all', keys: 'mod+a', scope: 'global' },
  { id: 'select.deselect', labelKey: 'select.deselect', keys: 'mod+d', scope: 'global' },
  { id: 'select.inverse', labelKey: 'select.inverse', keys: 'mod+shift+i', scope: 'global' },
  { id: 'select.delete', labelKey: 'edit.clear', keys: 'delete', scope: 'global' },
  { id: 'file.new', labelKey: 'file.new', keys: 'mod+n', scope: 'global' },
  { id: 'file.open', labelKey: 'file.open', keys: 'mod+o', scope: 'global' },
  { id: 'file.saveProject', labelKey: 'file.saveProject', keys: 'mod+s', scope: 'global' },
  { id: 'file.export', labelKey: 'file.export', keys: 'mod+shift+s', scope: 'global' },
  { id: 'image.imageSize', labelKey: 'image.imageSize', keys: 'mod+alt+i', scope: 'global' },
  { id: 'image.canvasSize', labelKey: 'image.canvasSize', keys: 'mod+alt+c', scope: 'global' },
  { id: 'layer.newRaster', labelKey: 'layer.newRaster', keys: 'mod+shift+n', scope: 'global' },
  { id: 'layer.duplicate', labelKey: 'layer.duplicate', keys: 'mod+j', scope: 'global' },
  { id: 'view.zoomIn', labelKey: 'view.zoomIn', keys: 'mod+=', scope: 'view' },
  { id: 'view.zoomOut', labelKey: 'view.zoomOut', keys: 'mod+-', scope: 'view' },
  { id: 'view.fitScreen', labelKey: 'view.fitScreen', keys: 'mod+0', scope: 'view' },
  { id: 'view.actualPixels', labelKey: 'view.actualPixels', keys: 'mod+1', scope: 'view' },
  { id: 'view.toggleGrid', labelKey: 'view.toggleGrid', keys: "mod+'", scope: 'view' },
  { id: 'view.togglePanels', labelKey: 'view.togglePanels', keys: 'tab', scope: 'view' },
  { id: 'color.swap', labelKey: 'color.swap', keys: 'x', scope: 'global' },
  { id: 'color.reset', labelKey: 'color.reset', keys: 'd', scope: 'global' },
  { id: 'brush.smaller', labelKey: 'options.size', keys: '[', scope: 'tool' },
  { id: 'brush.bigger', labelKey: 'options.size', keys: ']', scope: 'tool' },
  { id: 'help.shortcuts', labelKey: 'help.shortcuts', keys: 'mod+/', scope: 'global' },
];

export interface ParsedKey {
  key: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

export function parseEvent(e: KeyboardEvent): ParsedKey {
  return {
    key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
    ctrl: e.ctrlKey,
    meta: e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
  };
}

/** Matches a KeyboardEvent against an expression like 'mod+shift+z'. */
export function matchesShortcut(parsed: ParsedKey, expr: string, isMac: boolean): boolean {
  const parts = expr.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  for (const mod of mods) {
    switch (mod) {
      case 'mod':
        if (isMac ? !parsed.meta : !parsed.ctrl) return false;
        break;
      case 'ctrl':
        if (!parsed.ctrl) return false;
        break;
      case 'cmd':
        if (!parsed.meta) return false;
        break;
      case 'shift':
        if (!parsed.shift) return false;
        break;
      case 'alt':
        if (!parsed.alt) return false;
        break;
      default:
        return false;
    }
  }
  if (key === 'plus') return parsed.key === '=' || parsed.key === '+';
  return parsed.key === key;
}

/** Builds the display label for a shortcut per platform. */
export function formatShortcut(expr: string, isMac: boolean): string {
  let out = expr
    .split('+')
    .map((part) => {
      switch (part) {
        case 'mod':
          return isMac ? '⌘' : 'Ctrl';
        case 'shift':
          return isMac ? '⇧' : 'Shift';
        case 'alt':
          return isMac ? '⌥' : 'Alt';
        case 'backspace':
          return isMac ? '⌫' : 'Backspace';
        case 'delete':
          return isMac ? '⌦' : 'Del';
        case 'tab':
          return 'Tab';
        default:
          return part.toUpperCase();
      }
    })
    .join(isMac ? '' : '+');
  if (expr === 'mod+=') out = isMac ? '⌘+' : 'Ctrl++';
  if (expr === 'mod+-') out = isMac ? '⌘-' : 'Ctrl+-';
  return out;
}
