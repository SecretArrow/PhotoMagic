/**
 * Unit tests — undo/redo history stack (src/history).
 *
 * Covers push/undo/redo ordering, redo-tail invalidation, jumpTo,
 * the memory-budget and entry-count trims, and byte accounting.
 */

import { describe, expect, it } from 'vitest';
import {
  HISTORY_MAX_ENTRIES,
  HISTORY_MEMORY_BUDGET,
  createHistory,
  historyBytes,
  jumpTo,
  pushEntry,
  redo,
  trim,
  undo,
} from '../../src/history';
import type { HistoryEntry } from '../../src/engine/types';

const MB = 1024 * 1024;

function makeEntry(
  id: string,
  bytes = 0,
  calls: string[] = [],
): HistoryEntry {
  return {
    id,
    kind: 'structure',
    labelKey: 'test.entry',
    labelFallback: id,
    at: 0,
    bytes,
    undo: () => {
      calls.push(`undo:${id}`);
    },
    redo: () => {
      calls.push(`redo:${id}`);
    },
  };
}

describe('history stack', () => {
  it('push/undo/redo apply entries in order', () => {
    const calls: string[] = [];
    let s = createHistory();
    s = pushEntry(s, makeEntry('a', 0, calls));
    s = pushEntry(s, makeEntry('b', 0, calls));
    s = pushEntry(s, makeEntry('c', 0, calls));

    expect(s.entries.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(s.index).toBe(2);

    s = undo(s);
    expect(calls).toEqual(['undo:c']);
    expect(s.index).toBe(1);

    s = undo(s);
    expect(calls).toEqual(['undo:c', 'undo:b']);

    s = redo(s);
    expect(calls).toEqual(['undo:c', 'undo:b', 'redo:b']);
    expect(s.index).toBe(1);
  });

  it('undo below the bottom and redo above the top are no-ops', () => {
    const calls: string[] = [];
    let s = createHistory();
    s = pushEntry(s, makeEntry('a', 0, calls));
    s = pushEntry(s, makeEntry('b', 0, calls));

    s = undo(undo(s));
    expect(s.index).toBe(-1);
    const atBottom = s;
    s = undo(s);
    expect(s).toBe(atBottom); // same reference — untouched

    s = redo(redo(redo(s)));
    expect(s.index).toBe(1);
    expect(calls.filter((c) => c.startsWith('redo'))).toEqual(['redo:a', 'redo:b']);
  });

  it('pushing after an undo drops the redo tail', () => {
    let s = createHistory();
    s = pushEntry(s, makeEntry('a'));
    s = pushEntry(s, makeEntry('b'));
    s = pushEntry(s, makeEntry('c'));
    s = undo(s); // index 1
    s = pushEntry(s, makeEntry('d'));

    expect(s.entries.map((e) => e.id)).toEqual(['a', 'b', 'd']);
    expect(s.index).toBe(2);
  });

  it('jumpTo walks to a middle state via undo/redo', () => {
    const calls: string[] = [];
    let s = createHistory();
    for (const id of ['a', 'b', 'c', 'd']) s = pushEntry(s, makeEntry(id, 0, calls));

    s = jumpTo(s, 1);
    expect(s.index).toBe(1);
    expect(calls).toEqual(['undo:d', 'undo:c']);

    s = jumpTo(s, 3);
    expect(s.index).toBe(3);
    expect(calls.slice(2)).toEqual(['redo:c', 'redo:d']);
  });

  it('trim keeps the stack within the memory budget, oldest first', () => {
    let s = createHistory();
    // 5 × 100 MB = 500 MB > 384 MB budget
    ['m0', 'm1', 'm2', 'm3', 'm4'].forEach((id) => {
      s = pushEntry(s, makeEntry(id, 100 * MB));
    });

    expect(historyBytes(s)).toBeLessThanOrEqual(HISTORY_MEMORY_BUDGET);
    expect(s.entries.map((e) => e.id)).toEqual(['m2', 'm3', 'm4']);
    expect(s.index).toBe(2);
  });

  it('trim never drops the newest entry', () => {
    let s = createHistory();
    s = pushEntry(s, makeEntry('huge', HISTORY_MEMORY_BUDGET + 1024));
    // a lone entry over budget cannot be trimmed (loop guard i < length-1)
    expect(s.entries.map((e) => e.id)).toEqual(['huge']);

    s = pushEntry(s, makeEntry('tiny', 8));
    // 'huge' is now the oldest beyond budget → dropped; newest stays
    expect(s.entries.map((e) => e.id)).toEqual(['tiny']);
    expect(s.index).toBe(0);
  });

  it('explicit trim reduces the stack to the budget', () => {
    let s = createHistory();
    s = pushEntry(s, makeEntry('a', 300 * MB));
    s = pushEntry(s, makeEntry('b', 300 * MB));
    s = pushEntry(s, makeEntry('c', 300 * MB)); // 900 MB pushed overall
    // pushEntry trims eagerly, so only the newest 300 MB entry survives
    expect(s.entries.map((e) => e.id)).toEqual(['c']);
    expect(s.index).toBe(0);
    expect(historyBytes(s)).toBeLessThanOrEqual(HISTORY_MEMORY_BUDGET);

    // trimming an already-trimmed stack is a no-op
    const again = trim(s);
    expect(again.entries.map((e) => e.id)).toEqual(['c']);
    expect(again.index).toBe(0);
  });

  it('trims down to HISTORY_MAX_ENTRIES', () => {
    let s = createHistory();
    const total = HISTORY_MAX_ENTRIES + 10;
    for (let i = 0; i < total; i++) s = pushEntry(s, makeEntry(`e${i}`));

    expect(s.entries).toHaveLength(HISTORY_MAX_ENTRIES);
    expect(s.entries[0].id).toBe(`e${total - HISTORY_MAX_ENTRIES}`);
    expect(s.index).toBe(HISTORY_MAX_ENTRIES - 1);
  });

  it('historyBytes sums entry byte estimates', () => {
    let s = createHistory();
    s = pushEntry(s, makeEntry('a', 1024));
    s = pushEntry(s, makeEntry('b', 512));
    s = pushEntry(s, makeEntry('c', 256));
    expect(historyBytes(s)).toBe(1024 + 512 + 256);

    s = undo(s);
    expect(historyBytes(s)).toBe(1024 + 512 + 256); // bytes counted for the whole stack
  });
});
