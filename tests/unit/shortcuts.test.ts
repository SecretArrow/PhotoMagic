/**
 * Unit tests — shortcut matcher modifier exactness.
 *
 * Regression: matchesShortcut used to ignore EXTRA event modifiers, so
 * Ctrl+Z matched the plain 'z' tool shortcut (zoom) and the loop returned
 * before ever reaching 'edit.undo' — keyboard undo was dead. Modifiers must
 * now match exactly.
 */

import { describe, expect, it } from 'vitest';
import { matchesShortcut, parseEvent } from '../../src/shortcuts';

function key(key: string, mods: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) {
  return parseEvent({ key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift, altKey: !!mods.alt } as KeyboardEvent);
}

describe('matchesShortcut modifier exactness', () => {
  it('plain z does NOT match when Ctrl is held (regression: Ctrl+Z must reach undo)', () => {
    expect(matchesShortcut(key('z', { ctrl: true }), 'z', false)).toBe(false);
  });
  it('plain z matches the plain z shortcut', () => {
    expect(matchesShortcut(key('z'), 'z', false)).toBe(true);
  });
  it('ctrl+z matches ctrl+z and mod+z (Windows)', () => {
    expect(matchesShortcut(key('z', { ctrl: true }), 'ctrl+z', false)).toBe(true);
    expect(matchesShortcut(key('z', { ctrl: true }), 'mod+z', false)).toBe(true);
  });
  it('cmd+z matches mod+z on macOS, not on Windows', () => {
    expect(matchesShortcut(key('z', { meta: true }), 'mod+z', true)).toBe(true);
    expect(matchesShortcut(key('z', { meta: true }), 'mod+z', false)).toBe(false);
  });
  it('shift+z does not match plain z; shift is required exactly', () => {
    expect(matchesShortcut(key('z', { shift: true }), 'z', false)).toBe(false);
    expect(matchesShortcut(key('Z', { shift: true }), 'shift+z', false)).toBe(true);
  });
  it('ctrl+shift+z does not match ctrl+z (missing shift in expr)', () => {
    expect(matchesShortcut(key('z', { ctrl: true, shift: true }), 'ctrl+z', false)).toBe(false);
    expect(matchesShortcut(key('z', { ctrl: true, shift: true }), 'ctrl+shift+z', false)).toBe(true);
  });
  it('alt is required exactly too', () => {
    expect(matchesShortcut(key('b', { alt: true }), 'b', false)).toBe(false);
    expect(matchesShortcut(key('b', { alt: true }), 'alt+b', false)).toBe(true);
  });
  it('case-insensitive expr and single-char key normalization', () => {
    expect(matchesShortcut(key('b'), 'B', false)).toBe(true);
    expect(parseEvent({ key: 'B' } as KeyboardEvent).key).toBe('b');
  });
});
