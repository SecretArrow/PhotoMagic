/**
 * Unit tests — live slider-edit history semantics (append-only store API:
 * beginLayerEdit / updateLayerLive / endLayerEdit).
 *
 * Contract under test:
 *  - updateLayerLive mutates the layer + bumps the revision but NEVER pushes
 *    history, so slider drags do not spam the undo stack per tick.
 *  - endLayerEdit pushes exactly ONE entry whose undo restores the state
 *    captured at beginLayerEdit (the pre-drag snapshot) and whose redo
 *    restores the post-drag layer.
 *  - endLayerEdit without a begin, or a drag that ends where it started,
 *    pushes nothing.
 *  - undo/redo/jumpHistory drop any pending live-edit snapshot so a live drag
 *    can never capture a rewound state.
 *
 * The store module builds its initial document at import time, which creates
 * canvases; in plain node a minimal canvas stub is installed before the store
 * is imported (same approach as project.test.ts / psd.test.ts).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('document', {
  createElement: () => {
    const ctx = {
      fillStyle: '',
      fillRect: () => {},
      drawImage: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      putImageData: () => {},
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    };
    return { width: 0, height: 0, getContext: () => ctx };
  },
});

const { useEditorStore } = await import('../../src/state/editorStore');

/** Fresh document per test (resets history); returns the active layer id. */
function freshLayerId(): string {
  useEditorStore.getState().newDocument({ name: 'T', width: 32, height: 32, background: 'white' });
  const layer = useEditorStore.getState().getActiveLayer();
  if (!layer) throw new Error('expected an active layer');
  return layer.id;
}

describe('live layer edits (slider history coalescing)', () => {
  beforeEach(() => {
    freshLayerId();
  });

  it('a whole drag produces exactly ONE history entry with the final value', () => {
    const id = freshLayerId();
    const s = useEditorStore.getState();
    s.beginLayerEdit(id);
    for (const v of [0.9, 0.8, 0.65, 0.5]) s.updateLayerLive(id, { opacity: v });
    s.endLayerEdit(id, 'layers.opacity', 'Layer opacity');

    const st = useEditorStore.getState();
    expect(st.history.entries).toHaveLength(1);
    expect(st.history.index).toBe(0);
    expect(st.getActiveLayer()?.opacity).toBe(0.5);
  });

  it('undo restores the pre-drag value, redo restores the dragged value', () => {
    const id = freshLayerId();
    const s = useEditorStore.getState();
    expect(s.getActiveLayer()?.opacity).toBe(1);

    s.beginLayerEdit(id);
    s.updateLayerLive(id, { opacity: 0.3 });
    s.updateLayerLive(id, { opacity: 0.7 });
    s.endLayerEdit(id, 'layers.opacity', 'Layer opacity');
    expect(useEditorStore.getState().getActiveLayer()?.opacity).toBe(0.7);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().getActiveLayer()?.opacity).toBe(1);

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().getActiveLayer()?.opacity).toBe(0.7);
  });

  it('updateLayerLive alone never pushes history but bumps the revision', () => {
    const id = freshLayerId();
    const s = useEditorStore.getState();
    const rev0 = s.revision;

    s.updateLayerLive(id, { opacity: 0.25 });
    s.updateLayerLive(id, { opacity: 0.4 });

    const st = useEditorStore.getState();
    expect(st.history.entries).toHaveLength(0);
    expect(st.revision).toBe(rev0 + 2);
    expect(st.getActiveLayer()?.opacity).toBe(0.4);
  });

  it('endLayerEdit without beginLayerEdit pushes nothing', () => {
    const id = freshLayerId();
    useEditorStore.getState().updateLayerLive(id, { opacity: 0.5 });
    useEditorStore.getState().endLayerEdit(id, 'layers.opacity', 'Layer opacity');
    expect(useEditorStore.getState().history.entries).toHaveLength(0);
  });

  it('a drag that ends where it started pushes nothing', () => {
    const id = freshLayerId();
    const s = useEditorStore.getState();
    s.beginLayerEdit(id);
    s.updateLayerLive(id, { opacity: 0.5 });
    s.updateLayerLive(id, { opacity: 1 });
    s.endLayerEdit(id, 'layers.opacity', 'Layer opacity');
    expect(useEditorStore.getState().history.entries).toHaveLength(0);
    expect(useEditorStore.getState().getActiveLayer()?.opacity).toBe(1);
  });

  it('undo() drops a pending live-edit snapshot (no stale capture)', () => {
    const id = freshLayerId();
    const s = useEditorStore.getState();
    s.beginLayerEdit(id);
    s.updateLayerLive(id, { opacity: 0.2 });

    // history is empty here, so undo is a no-op rewind — but it must still
    // invalidate the pending snapshot captured before the rewind
    useEditorStore.getState().undo();
    useEditorStore.getState().endLayerEdit(id, 'layers.opacity', 'Layer opacity');
    expect(useEditorStore.getState().history.entries).toHaveLength(0);
  });

  it('works for text-layer params: undo restores the pre-drag content', () => {
    const id = freshLayerId();
    const s = useEditorStore.getState();
    const before = s.getActiveLayer()!;

    s.beginLayerEdit(id);
    s.updateLayerLive(id, { name: 'Renamed live' });
    s.updateLayerLive(id, { name: 'Renamed twice' });
    s.endLayerEdit(id, 'common.rename', 'Rename layer');
    expect(useEditorStore.getState().getActiveLayer()?.name).toBe('Renamed twice');

    useEditorStore.getState().undo();
    const restored = useEditorStore.getState().getActiveLayer();
    expect(restored?.name).toBe(before.name);

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().getActiveLayer()?.name).toBe('Renamed twice');
  });

  it('beginLayerEdit is idempotent: the FIRST snapshot wins across ticks', () => {
    const id = freshLayerId();
    const s = useEditorStore.getState();
    s.beginLayerEdit(id);
    s.updateLayerLive(id, { opacity: 0.8 });
    s.beginLayerEdit(id); // second begin mid-drag must not replace the snapshot
    s.updateLayerLive(id, { opacity: 0.6 });
    s.endLayerEdit(id, 'layers.opacity', 'Layer opacity');

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().getActiveLayer()?.opacity).toBe(1);
  });
});
