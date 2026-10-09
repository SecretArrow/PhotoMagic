/**
 * Undo/redo history with memory accounting.
 *
 * Entries are self-contained undo/redo closures created by the store's
 * action helpers. The stack is memory-aware: when the estimated byte cost
 * exceeds the budget, oldest entries beyond the current position are
 * trimmed first, then oldest entries overall.
 */

import type { HistoryEntry } from '../engine/types';

export const HISTORY_MEMORY_BUDGET = 384 * 1024 * 1024; // 384 MB
export const HISTORY_MAX_ENTRIES = 200;

export interface HistoryStack {
  entries: HistoryEntry[];
  /** index of the last applied entry; -1 = nothing applied */
  index: number;
}

export function createHistory(): HistoryStack {
  return { entries: [], index: -1 };
}

export function pushEntry(stack: HistoryStack, entry: HistoryEntry): HistoryStack {
  // drop redo tail
  const entries = stack.entries.slice(0, stack.index + 1);
  entries.push(entry);
  return trim({ entries, index: entries.length - 1 });
}

export function trim(stack: HistoryStack): HistoryStack {
  let { entries, index } = stack;
  if (entries.length > HISTORY_MAX_ENTRIES) {
    const drop = entries.length - HISTORY_MAX_ENTRIES;
    entries = entries.slice(drop);
    index = Math.max(-1, index - drop);
  }
  let total = entries.reduce((acc, e) => acc + e.bytes, 0);
  let i = 0;
  while (total > HISTORY_MEMORY_BUDGET && i < entries.length - 1) {
    // never trim the newest entry (i < length-1)
    if (i <= index) {
      total -= entries[i].bytes;
      entries = entries.slice(1);
      index--;
    } else {
      break;
    }
    i++;
  }
  return { entries, index };
}

export function undo(stack: HistoryStack): HistoryStack {
  if (stack.index < 0) return stack;
  const entry = stack.entries[stack.index];
  entry.undo();
  return { ...stack, index: stack.index - 1 };
}

export function redo(stack: HistoryStack): HistoryStack {
  if (stack.index >= stack.entries.length - 1) return stack;
  const entry = stack.entries[stack.index + 1];
  entry.redo();
  return { ...stack, index: stack.index + 1 };
}

export function jumpTo(stack: HistoryStack, target: number): HistoryStack {
  let s = stack;
  while (s.index > target) s = undo(s);
  while (s.index < target) s = redo(s);
  return s;
}

export function historyBytes(stack: HistoryStack): number {
  return stack.entries.reduce((acc, e) => acc + e.bytes, 0);
}
