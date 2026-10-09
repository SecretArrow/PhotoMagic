/**
 * Text tool — click places a new text layer (options bar drives editing).
 *
 * Clicking an existing text layer selects it (bbox hit-test via layoutText);
 * otherwise a new text layer is created at the click point via
 * store.addTextLayer and toolOptions.text.x/y is synced so subsequent edits
 * align with the placed layer. No history beyond addTextLayer's own entry.
 */

import { useEditorStore } from '../state/editorStore';
import type { CanvasPointerEvent, ToolContext, ToolController } from '../canvas/pointerContract';
import { textBBox } from '../engine/paint';
import { ctx2d, makeCanvas, type AnyContext2D } from '../engine/raster';
import type { Layer } from '../engine/types';

let measureCtx: AnyContext2D | null = null;

function measuringCtx(): AnyContext2D {
  if (!measureCtx) {
    const c = makeCanvas(8, 8);
    measureCtx = ctx2d(c);
  }
  return measureCtx;
}

/** Topmost visible text layer containing the point, or null. */
function findTextLayerAt(layers: Layer[], docX: number, docY: number): Layer | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!l.visible) continue;
    if (l.kind === 'group') {
      const hit = findTextLayerAt(l.children, docX, docY);
      if (hit) return hit;
      continue;
    }
    if (l.kind !== 'text') continue;
    const b = textBBox(l.text, measuringCtx());
    if (docX >= b.x && docX <= b.x + b.w && docY >= b.y && docY <= b.y + b.h) return l;
  }
  return null;
}

export const textController: ToolController = {
  tool: 'text',
  cursor: 'text',
  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    const store = useEditorStore.getState();
    const hit = findTextLayerAt(store.doc.layers, e.docX, e.docY);
    if (hit) {
      store.selectLayer(hit.id);
      ctx.invalidate();
      return;
    }
    // create a new text layer at the click point
    store.addTextLayer({ x: e.docX, y: e.docY });
    // keep the options-bar text position in sync for subsequent edits
    store.updateToolOptions('text', { x: e.docX, y: e.docY });
    ctx.invalidate();
  },
  deactivate(): void {
    /* stateless */
  },
};
