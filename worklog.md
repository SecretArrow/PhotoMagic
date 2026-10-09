# PixelForge Studio — Worklog (multi-agent shared log)

Project: Professional browser-based photo editor (PhotoMagic repo = PixelForge Studio)
Repo: https://github.com/SecretArrow/PhotoMagic.git (branch main)
Stack: Next.js 16 (App Router) + TypeScript + Tailwind 4 + shadcn/ui + Zustand + Canvas2D engine + Web Workers
Rule: NEVER commit the GitHub token. It lives only in .git/config remote URL.

---
Task ID: 1
Agent: main (Super Z)
Task: Repo wiring + baseline

Work Log:
- Read master spec from /home/z/my-project/upload/Pasted Content_1791562759463.txt (1270 lines, PixelForge Studio requirements)
- Initialized fullstack env (Next.js 16 scaffold in /home/z/my-project)
- Cloned + inspected PhotoMagic repo: empty (README only) → fresh build
- Wired remote with token in URL (not committed), fetched, reset --mixed to origin/main, set upstream
- Wrote clean .gitignore (excludes env, logs, sandbox dirs), added MIT LICENSE

Stage Summary:
- Baseline ready for scaffold commit + push
- Architecture decided: see /home/z/my-project/docs/ARCHITECTURE.md after Task 2

---
Task ID: 3-c
Agent: persistence-pwa
Task: Persistence (IndexedDB autosave/recovery), PWA (manifest + service worker + icons), CI workflow, docs (README/ARCHITECTURE/COMPATIBILITY/LICENSES), engine unit tests

Work Log:
- Read shared context: editorStore (doc shape, autosave settings), documents/project.ts, engine/types.ts, engine/selections, history, engine/color, package.json
- Storage layer (new src/storage/):
  - idb.ts: promise IndexedDB wrapper, db `pixelforge` v1, stores `autosave`/`recovery`; idbGet/idbSet/idbDelete/idbClearStore; all calls guarded with `typeof indexedDB === 'undefined'` → null (SSR/test safe)
  - autosave.ts: AutosaveManager — start(getJson, intervalMs, getMeta?) interval saves {json, savedAt, hash, meta{name,width,height}} to autosave/'current'; FNV-1a hash skips unchanged docs; eager saves on visibilitychange→hidden + pagehide; stop/clear/restore/estimateUsage (navigator.storage.estimate); overlapping saves coalesced, never throws into UI
  - recovery.ts: saveRecoverySnapshot/loadRecoverySnapshot/clearRecoverySnapshot (IDB recovery/'crash') + markCrashSafe/wasCrashDetected/armCrashGuard via sessionStorage flag with SSR guards (documented boot protocol in header)
  - documents/project.ts: APPENDED single export saveProjectToString(doc, appVersion) reusing saveProject() + blob.text(); no existing code touched
- PWA:
  - public/manifest.json: name/short_name/description, start_url "/", display standalone, #17181c bg/theme, icons 192 (any maskable), 512 (any), maskable-512 (maskable)
  - public/sw.js (plain JS, CACHE_VERSION 'pixelforge-v1'): install precaches ['/','/manifest.json','/icons/icon-192.png','/icons/icon-512.png'] with allSettled (tolerates failures); activate cleans old caches + clients.claim(); fetch ignores non-GET and any '/api' URL; navigations network-first → cached '/' fallback (503 offline page as last resort); same-origin assets stale-while-revalidate; cross-origin bypassed entirely (never caches opaque responses)
  - src/components/editor/PwaRegister.tsx: 'use client', registers /sw.js on mount, production-only + skips localhost, silent on controllerchange/ready (renders null), dispatches `pf:offline-ready` after registration success
  - Mounted <PwaRegister /> in src/app/layout.tsx (1 import + 1 element — layout not in do-not-modify list; metadata already referenced /manifest.json + icons)
- Icons: scripts/gen-icons.mjs (standalone, uses existing sharp dep) — writes public/icons/icon.svg (512 rounded-square, vertical gradient #1d5c3f→#58c08a, white 4-point forge/spark glyph + small ember, no text) and exports icon-192.png, icon-512.png, icon-maskable-512.png (glyph at 0.8 scale = 10% safe zone, full-bleed bg). RAN once; verified 192×192 / 512×512 / 512×512 PNGs via sharp metadata. favicon.ico intentionally not generated.
- CI: .github/workflows/ci.yml — push/pull_request on main; checkout@v4, oven-sh/setup-bun@v2, bun install --frozen-lockfile, bunx tsc --noEmit, bunx eslint ., bunx vitest run; no secrets
- Docs: README.md (full rewrite: what/privacy-first, features, stack, getting started Bun/Node 20+, testing, structure tree, roadmap with WebGPU/PSD-TIFF/content-aware-fill clearly NOT implemented, privacy, MIT); docs/ARCHITECTURE.md (module map, store→engine→renderer data flow, Canvas2D rendering + WebGPU-future, history design: diff-region pixel entries + structural ref swaps w/ 384MB/200-entry budgets, worker protocol, .pfs summary); docs/COMPATIBILITY.md (honest import/export matrix incl. unsupported TIFF/PSD/PSB/PDF/HEIC/AVIF/RAW with rationale, .pfs spec, Canvas2D blend coverage, 8-bit sRGB pipeline no CMYK/16-bit); docs/LICENSES.md (MIT + dependency license table + audit note + no proprietary codecs/assets)
- Tests (vitest node env, no DOM): tests/unit/history.test.ts (9: ordering, redo-tail drop, jumpTo, budget/entry-count trims, bytes), selections.test.ts (14: rect/ellipse coverage+bounds+corners, add/subtract/intersect/replace, invert L-shape, feather max-subset, traceOutline closed polyline, floodSelect 3×3 synthetic), color.test.ts (10: hex/rgb/hsl round trips, invalid inputs, luma601 known values, histogram totals + precision), project.test.ts (13: rejects invalid JSON/wrong format/future version/dims 0|20000, minimal valid doc → placeholder layer + name/dims, background normalization, guide filtering; minimal document stub for makeCanvas)
- Fixed 3 test expectation bugs found by first run (jumpTo walk count, eager-trim index, invert bounds are L-shaped); eslint clean on all new/edited files; node --check passed for sw.js + gen-icons.mjs; manifest JSON validated

Stage Summary:
- Files created: src/storage/{idb,autosave,recovery}.ts, src/components/editor/PwaRegister.tsx, public/manifest.json, public/sw.js, scripts/gen-icons.mjs, .github/workflows/ci.yml, README.md, docs/{ARCHITECTURE,COMPATIBILITY,LICENSES}.md, tests/unit/{history,selections,color,project}.test.ts
- Files modified: src/documents/project.ts (appended saveProjectToString only), src/app/layout.tsx (mounted PwaRegister)
- Icons: public/icons/{icon.svg,icon-192.png,icon-512.png,icon-maskable-512.png} generated + verified (5545/17972/13712 bytes)
- Tests: bunx vitest run tests/unit/ → 5 files, 62/62 passing (my 46 new + 16 pre-existing filters tests from another agent)
- Not done (out of scope / needs other tasks): wiring AutosaveManager into editorStore actions is forbidden here (src/state/* locked); recovery UI + storage dialog consume src/storage APIs next

---
Task ID: 3-b
Agent: filters-worker
Task: Filters expansion (+10 deterministic filters) & Web Worker pipeline (registry, filters.worker.ts, filterRunner.ts, unit tests, i18n appends)

Work Log:
- Read worklog + engine contracts (types.ts, registry.ts, adjustments.ts, color.ts); skimmed editorStore history/commitEntry usage (unmodified)
- Extended src/engine/filters/registry.ts FILTERS array (append-only) with 10 new deterministic filters: radial-blur (zoom-style center sampling), lens-blur (4-pass box approximation of disc bokeh, labeled honestly), surface-blur (edge-preserving, averages neighbors below color-distance threshold), high-pass (original − blurred + 128), halftone (rotated dot-screen: cell luminance → ink dot radius on white), wave (sin row/column displacement with horizontal/vertical select), twirl (center rotation with quadratic distance falloff, radius % of min dimension), spherize (d^(1+amount) bulge/pinch mapping), ripple (radial sin displacement from center), bloom (bright-pass → blur → screen blend); reused helpers boxBlurRGBA/num + luma601/clamp255; no Math.random anywhere
- Appended 17 new i18n keys to BOTH en and id in src/i18n/dictionaries.ts (10 filter labels + param keys amplitude/wavelength/threshold/intensity/direction/directionHorizontal/directionVertical; existing filter.param.* reused where possible); en/id parity verified (360/360 keys)
- Created src/workers/filters.worker.ts: module worker handling FilterRequest — 'filter' (registry lookup + def.apply on buffer view, transfer ArrayBuffer back), 'adjust' (applyAdjustments), 'histogram' (computeHistogram with precision, posts r/g/b/luminance/max), 'ping'→pong, 'error' responses on exceptions; /// <reference lib="webworker" /> + declare const self: DedicatedWorkerGlobalScope + export {}; DOM-free
- Created src/lib/filterRunner.ts: main-thread singleton API — ensureWorker() (new Worker(new URL('../workers/filters.worker.ts', import.meta.url), {type:'module'}) in try/catch), runFilter/runAdjust/runHistogram promises with job-id counter + pending map + response dispatch, rejects on 'error' responses, clone-before-send (source ImageData never detached), full synchronous fallback via registry/applyAdjustments/computeHistogram when Worker is unavailable or crashes (onerror → permanent sync mode), disposeRunner() terminates + rejects in-flight
- Wrote tests/unit/filters.test.ts (16 tests): gaussian-blur determinism, solid-color box-blur invariance (≤1 drift), sharpen edge-delta growth on soft 100/200 boundary, invert adjustment flip, posterize-matrix levels=2 → 2 distinct values/channel, seeded noise determinism, registry integrity (unique ops, labelKeys, param defaults, getFilter('unknown') undefined, ≥24 filters), i18n labelKey coverage, adjustments (brightness additive semantics, grayscale r==g==b, hueSaturation(0,1,0) identity, levels endpoint mapping), histogram sums/max, and filterRunner sync-fallback tests (runFilter/runAdjust/runHistogram with ImageData shim, unknown-op rejection)
- Verified: bunx vitest run tests/unit/filters.test.ts → 16/16 pass; strict tsc (--strict, bundler resolution) on the three new/changed source files + transitive imports → 0 errors; smoke script over all 24 filters at default params → deterministic, NaN-free, effect-producing

Stage Summary:
- Files created: src/workers/filters.worker.ts, src/lib/filterRunner.ts, tests/unit/filters.test.ts
- Files modified (append-only): src/engine/filters/registry.ts (+10 FilterDef entries), src/i18n/dictionaries.ts (+17 keys in en, +17 in id)
- Filter ops added: radial-blur, lens-blur, surface-blur, high-pass, halftone, wave, twirl, spherize, ripple, bloom (registry total 24)
- Deviation note: engine's brightness-contrast is additive (±127.5 at ±100 with pivot cancellation), so +100 on black yields 128 (mid-gray-plus), not "near-white" as sketched in the task; test asserts the actual engine contract (128) — flagging in case adjustments.ts should scale brightness by 2.55 instead
- Next: orchestrator integrates filter dialogs (consume filterRunner APIs), worker is lazily created on first use

---
Task ID: 4-a
Agent: canvas-viewport
Task: Canvas viewport stage component — src/canvas/CanvasStage.tsx

Work Log:
- Read pointerContract.ts, editorStore.ts, state/types.ts, engine/render.ts, engine/raster.ts, engine/selections/index.ts, engine/document.ts, globals.css, worklog.md
- Created src/canvas/CanvasStage.tsx (only file touched; 'use client', React 19, zustand v5, no new deps)
- Layer sandwich: display canvas (checkerboard via paintChecker clipped to doc rect + cached composite under view transform, imageSmoothingEnabled = zoom < 3, quality 'high') + overlay canvas (pointer-events:none): doc border #4b4d55, grid (visible when zoom*gridSize >= 6px), guides #58c08a (hovered brighter), marching ants (black solid + white dashed, dashOffset animated ~15fps, only while a selection exists), ToolController.drawOverlay hook, brush cursor ring (size/2 * zoom, black outer + white stroke, crosshair fallback for tiny sizes)
- Composite cache: composeDocument() only on revision change (useEditorStore.subscribe) / doc dims change; cached AnyCanvas pre-primed with a non-willReadFrequently 2D context so the buffer stays GPU-backed (composeDocument's ctx2d() reuses it); never recomputed per frame
- Rendering: single rAF loop, two dirty flags (display/overlay), overlay-only invalidation for ants/hover/tool overlay; DPR capped at 2, backing store synced in ResizeObserver + per-frame DPR check
- Gestures: pointer capture on container (pf-canvas = touch-action:none); middle button / space held / hand tool = pan; ctrl/cmd+wheel = store.zoomBy(exp(-deltaY*0.0015), cx, cy); plain wheel = pan; two pointers = pinch zoom + two-finger pan anchored at midpoint (tool drag cancelled via onPointerCancel; surviving finger marked stale and cannot resume the stroke); one finger = tool dispatch with phases down/move/up/cancel/hover/leave; space = temporary 'grab' cursor while hovering; window blur = gesture state reset
- ToolContext built per event: { view, viewportSize, invalidate, setCursor, isAltDown }; CanvasPointerEvent built per contract (docX/docY via screenToDoc, pressure fallback 0.5, activePointers from tracked Map)
- Fit-on-load: on first resize + doc dims change / doc.id change while user hasn't interacted (store.fitToScreen); window 'pf:fit' listener (only pf:fit, per spec)
- Resize: canvases DPR-resized, pan shifted by half the size delta so doc center stays anchored
- Draw matrix note: scale(flip)→rotate→translate(pan)→scale(zoom) which is algebraically exactly docToScreen() / inverted by screenToDoc() (reduces to the prescribed translate(pan), scale(zoom*flip) at rotation 0); pan/pinch helpers panDeltaFor/anchoredPan invert the same matrix, so raster, overlays and pointer mapping agree in all view states

Stage Summary:
- CanvasStage.tsx ready; imports { getToolController } from '../tools/registry' (module owned by tools agent — must export getToolController(tool: ToolId): ToolController | undefined; optional handlers onPointerDown/Move/Up/Cancel, drawOverlay, cursor per pointerContract)
- Component is not yet mounted (EditorRoot still the phase-1 smoke shell) — UI-phase integration wires it into the workspace layout
- Wheel-ctrl zoom uses store.zoomBy (cursor-anchored); note store's fit/zoomBy pan math is flip-unaware (pre-existing, out of scope for 4-a)

---
Task ID: 4-b
Agent: tools-engine
Task: Tool controllers & brush engine (completed by orchestrator after agent timeout — all files were already written)

Work Log:
- Agent wrote all deliverables before timing out: src/engine/brushes/stamp.ts, src/tools/{registry,shared,strokeCommon,paint,retouch,selections,transform,paint-fill,text,shapes,pen,crop,nav}.ts, tests/unit/tools-math.test.ts
- Orchestrator verified: tsc clean, 71/71 tests pass

Stage Summary:
- All 25 ToolIds wired via getToolController; pixel tools use diff-region commitPixelEdit history

---
Task ID: 5
Agent: main (Super Z)
Task: Integration, bug fixes, browser verification

Work Log:
- Fixed composeDocument bug: composed buffer was never blitted into target on the non-checker path (root cause of transparent canvas)
- Fixed layer/mask thumbnails: OffscreenCanvas lacks toDataURL — added canvasToDataUrl host-canvas conversion
- Fixed tool label i18n mapping (ToolId kebab-case vs dictionary camelCase) via toolLabelKey map in toolMeta.ts; applied in ToolRail, OptionsBar, MobileWorkspace
- Fixed ESLint errors: useMemo inline fn, setState-in-effect patterns (useIsDesktop, NavigatorPanel, NumericPromptDialog)
- Fixed project.test.ts typing (document deletion cast)
- Browser verification (agent-browser): desktop render, brush stroke (7109 px, history entry), undo/redo, rect selection with marching ants, text layer creation, filter gallery end-to-end (gaussian blur through worker: pixels changed + history entry), export dialog, filter dialog honest no-raster-layer notice, mobile viewport layout (390x844), crash-recovery dialog after reload, thumbnails, status bar, autosave "Saved" indicator

Stage Summary:
- 71/71 unit tests pass, tsc clean, eslint 0 errors
- Verified screenshots in /home/z/my-project/download/verify-*.png
