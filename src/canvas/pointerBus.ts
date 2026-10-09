/**
 * Pointer position pub/sub — a tiny external store the status bar (or any
 * lightweight consumer) can subscribe to without re-rendering the canvas.
 *
 * CanvasStage does NOT know about this module (it is read-only for other
 * agents); in v1 the status bar intentionally skips live pointer position,
 * but the bus is wired so a future integration only needs one publish call
 * from the stage pointer handlers.
 */

'use client';

import { useSyncExternalStore } from 'react';

export interface PointerPosition {
  x: number;
  y: number;
}

let current: PointerPosition = { x: 0, y: 0 };
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PointerPosition {
  return current;
}

/** Publishes a new document-space pointer position (no-op when unchanged). */
export function publishPointer(docX: number, docY: number): void {
  if (current.x === docX && current.y === docY) return;
  current = { x: docX, y: docY };
  for (const listener of listeners) listener();
}

/** React hook returning the last published pointer position. */
export function usePointerPosition(): PointerPosition {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
