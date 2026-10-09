# PixelForge Studio — Architecture

Audience: contributors. This document describes the module layout, the data flow between the store, the engine and the renderer, the history design, the worker protocol, and the native `.pfs` project format.

---

## 1. Module map

| Module            | Responsibility                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `src/engine/`     | Pure document model + pixel engine. No React, no store imports. Types, document ops, selections, color, adjustments, filters, blend modes, transforms, compositing renderer, on-device segmentation (`segmentation.ts`). |
| `src/state/`      | Zustand editor store. Owns documents, layers, selection, view, tool state, colors, history, UI state and settings. All mutations flow through actions that create history entries. |
| `src/canvas/`     | Pointer/event contract between the workspace viewport and tool implementations (hit testing, coordinate spaces, gesture normalization). |
| `src/tools/`      | Tool implementations (brush, marquee, wand, text, shapes, …). They read tool options from the store and mutate documents through store actions. |
| `src/workspace/`  | Editor shell: panels (layers, history, adjustments, color, navigator, properties), options bar, canvas viewport, dialogs. |
| `src/formats/`    | Import/export adapters for raster formats (PNG, JPEG, WebP, GIF first frame, BMP, SVG rasterized) plus a layered PSD v1 writer (`psd.ts`), with honest partial-support messaging. |
| `src/documents/`  | Native `.pfs` project serializer — encode, validate, decode (see §6).                                  |
| `src/storage/`    | Persistence: IndexedDB wrapper, `AutosaveManager`, crash-recovery snapshots + session crash flag.       |
| `src/workers/`    | Web Worker entry that executes the filter/adjustment/histogram protocol (see §5).                       |
| `src/i18n/`       | EN/ID dictionaries, provider and `t()`; language persists in editor settings.                           |
| `src/shortcuts/`  | Data-driven keyboard shortcut registry shared by the handler and the shortcuts dialog.                  |

Dependency direction is strict: `workspace → tools/canvas → state → engine`, and `documents/formats/storage` sit beside `state` but may only import from `engine` (plus browser APIs). The engine never imports upward.

## 2. Data flow (store → engine → renderer)

```
User gesture (pointer/keyboard)
        │
        ▼
src/tools/* ── reads options ──▶ src/state/editorStore (Zustand)
        │                             │  action wraps the change in a
        │                             │  HistoryEntry (undo/redo closures)
        ▼                             ▼
src/engine/*  ◀── pure calls ──  store state (DocumentState, layers, selection)
        │                             │
        ▼                             ▼
src/engine/render.ts (composeDocument) ──▶ viewport canvas (Canvas2D)
```

1. **Tools capture intent** — pointer events are normalized by `src/canvas` into doc-space strokes/drag rects for the active tool.
2. **Store actions own mutations** — every action produces a new document/layer structure and pushes a history entry describing how to undo/redo it. UI state (dialogs, panels) lives in the same store but never in history.
3. **Engine functions are pure** — they transform document data or pixel buffers and never touch the store. Pixel buffers (canvases) are treated as mutable *outside* history: raster edits commit *diff-region* entries via `commitPixelEdit()` (see §4).
4. **Renderer recomposites** — `composeDocument()` walks the layer tree bottom→top into a Canvas2D buffer; the viewport draws that buffer with zoom/pan/rotation applied. Rendering never mutates layer buffers.

## 3. Rendering approach

- **Canvas2D compositing** is the only backend in this build. Each layer renders into its own buffer (`renderLayerBuffer`), then composites with:
  - blend modes mapped directly onto `globalCompositeOperation` (`blendToComposite`; `normal` → `source-over`), including the spec-defined non-separable HSL modes (`hue`, `saturation`, `color`, `luminosity`);
  - per-layer `globalAlpha` opacity, visibility and clipping to the layer below;
  - non-destructive alpha masks (invertible) applied to the layer buffer;
  - adjustment layers evaluated against the composite of everything below;
  - groups rendered into an isolated buffer first so group blending matches expectations.
- A checkerboard is painted behind the composite for transparent areas (preview only, never exported).
- The renderer is a pure function of document state: same doc in, same pixels out. No re-entrant mutation.

**WebGPU is listed as future work**, not present in this build. The engine keeps buffer creation/compositing localized (`engine/raster.ts`, `engine/render.ts`) so a GPU backend can be introduced without touching tools or the store. See the roadmap in `README.md`.

## 4. History design

Two kinds of history entries coexist (`src/history/index.ts`, `HistoryEntry.kind`):

- **Diff-region pixel entries** (`kind: 'pixel'`) — brush strokes, eraser, filters and other raster edits record only the changed rectangle: the previous pixels of that region (or enough to invert the op) plus the new region. `bytes` estimates region size ×4 (RGBA) so the stack is memory-accounted.
- **Structural ref swaps** — layer add/remove/reorder/property changes are undoable closures that swap immutable references (`replaceLayer`, `removeLayer`, `insertLayer` return new trees). Cheap to invert: keep the old tree reference.

Stack behavior:

- `HISTORY_MAX_ENTRIES = 200`, `HISTORY_MEMORY_BUDGET = 384 MB`.
- Pushing drops the redo tail (branches are not kept).
- Trimming drops oldest entries beyond the current position first, then oldest overall — the newest entry is never trimmed.
- `undo`/`redo` call the entry's closures; `jumpTo(i)` walks with undo/redo so the history panel can jump to any state.
- `historyBytes(stack)` reports the current memory estimate for the history panel/UI.

Entries are self-contained (id, kind, i18n `labelKey` + `labelFallback`, timestamp, byte estimate, `undo()`/`redo()`), so the history panel renders without knowing what produced them.

## 5. Worker protocol

Filter dialogs, direct adjustments and histograms run in a Web Worker so the UI thread never blocks. The protocol lives in `engine/types.ts`:

```ts
// request (main → worker)
{ type: 'filter',    jobId, op, params, width, height, buffer /* ArrayBuffer RGBA */ }
{ type: 'adjust',    jobId, adjustments, width, height, buffer }
{ type: 'histogram', jobId, buffer, precision }
{ type: 'ping',      jobId }

// response (worker → main)
{ type: 'filter' | 'adjust', jobId, buffer }
{ type: 'histogram', jobId, luminance, r, g, b, max }
{ type: 'pong', jobId }
{ type: 'error',  jobId, message }
```

Design rules:

- **jobId correlation** — requests and responses pair by `jobId`; the main thread can cancel/ignore stale previews.
- **Transferables** — the RGBA `ArrayBuffer` is transferred (zero-copy) to the worker and back; the main thread treats the buffer as owned by the protocol in flight.
- **Same code both sides** — filter implementations are pure functions over `Uint8ClampedArray` (`engine/filters/registry.ts`), so the renderer's smart filters (synchronous, main thread) and the worker's interactive previews are byte-identical.
- Errors are reported per-job (`type: 'error'`) and never crash the worker.

## 6. `.pfs` project format summary

Native format handled by `src/documents/project.ts`:

- **JSON, versioned** — `format: 'pixelforge-studio'`, `version: 1`, `savedAt` (ISO), `appVersion`.
- **Document header** — name, width, height, dpi, background (incl. custom color), description, guides.
- **Layers stored top→bottom** (panel order); each layer keeps id/name/kind/visibility/lock/opacity/blend/offset/clip flag, plus kind-specific payload:
  - `raster` → embedded **PNG data URL** (+ dimensions)
  - `text` / `shape` / `fill` / `adjustment` / `group` → structured JSON payloads
  - masks are embedded as grayscale PNG data URLs
- **Validation on load** — rejects invalid JSON, wrong `format`, versions newer than the app supports, and dimensions outside `1..16384`; embedded PNG decode failures degrade to placeholder buffers instead of failing the file.
- **Limit** — 512 MB safety cap on serialized size; raster data as base64 PNG makes files larger than a zip container (acceptable for v1) and keeps them fully self-contained and inspectable.
- Editing history is **not** embedded — a `.pfs` stores the current document state only.

Serialization convenience: `saveProject()` returns a `Blob`, and `saveProjectToString()` returns the JSON string (used by autosave and crash recovery).
