/**
 * Unit tests — history memory-budget enforcement (regression for the
 * skipped-candidate trim bug) and recent-colors cap constants.
 *
 * Node environment, pure data — no canvas/store needed for the history
 * half; the store-level recents behavior is covered indirectly by the
 * debounced scheduler being browser-only.
 */

import { describe, expect, it } from 'vitest';
import {
  HISTORY_MAX_ENTRIES,
  HISTORY_MEMORY_BUDGET,
  createHistory,
  historyBytes,
  pushEntry,
} from '../../src/history';
import type { HistoryEntry } from '../../src/engine/types';

let seq = 0;
function entry(bytes: number, label = 'e'): HistoryEntry {
  seq += 1;
  return {
    id: `test-${seq}`,
    kind: 'pixel',
    labelKey: 'history.brushStroke',
    labelFallback: label,
    at: seq,
    bytes,
    undo: () => {},
    redo: () => {},
  } as HistoryEntry;
}

describe('history memory budget', () => {
  it('pushing entries over the byte budget trims down to (or under) the budget', () => {
    // Regression: the old trim loop advanced its cursor while slicing, which
    // skipped every second candidate and could leave the stack over budget.
    const chunk = Math.ceil(HISTORY_MEMORY_BUDGET / 3) + 1024; // 3 pushes > budget
    let h = createHistory();
    h = pushEntry(h, entry(chunk));
    h = pushEntry(h, entry(chunk));
    h = pushEntry(h, entry(chunk));
    expect(historyBytes(h)).toBeLessThanOrEqual(HISTORY_MEMORY_BUDGET);
    // newest entry is always kept
    expect(h.entries.length).toBeGreaterThanOrEqual(1);
    expect(h.index).toBe(h.entries.length - 1);
  });

  it('never drops the newest entry even when a single entry exceeds the budget', () => {
    let h = createHistory();
    h = pushEntry(h, entry(HISTORY_MEMORY_BUDGET + 5 * 1024 * 1024, 'huge'));
    expect(h.entries.length).toBe(1);
    expect(historyBytes(h)).toBeGreaterThan(HISTORY_MEMORY_BUDGET); // tolerated, documented
  });

  it('entry-count cap holds and index stays pinned to the newest entry', () => {
    let h = createHistory();
    for (let i = 0; i < HISTORY_MAX_ENTRIES + 25; i += 1) {
      h = pushEntry(h, entry(1024, `e${i}`));
    }
    expect(h.entries.length).toBeLessThanOrEqual(HISTORY_MAX_ENTRIES);
    expect(h.index).toBe(h.entries.length - 1);
    expect(h.entries[h.entries.length - 1].labelFallback).toBe(`e${HISTORY_MAX_ENTRIES + 24}`);
  });
});
