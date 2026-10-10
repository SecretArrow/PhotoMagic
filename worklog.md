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

---
Task ID: 6
Agent: main (Super Z)
Task: Final verification & release

Work Log:
- Verified git history contains no GitHub token (git grep across all revs: clean)
- 167 tracked files, 7 commits pushed to SecretArrow/PhotoMagic main
- Confirmed app serves HTTP 200 with all fixes hot-applied

Stage Summary:
- PixelForge Studio v1.0.0 shipped: layered Canvas2D editor, 25 tools, 24 filters,
  adjustments, masks, selections, text/shapes/pen, history, autosave/recovery,
  PWA offline, EN/ID i18n, 71 unit tests, CI workflow, docs

---
Task ID: 7
Agent: main (Super Z)
Task: Re-init session — repo sync, token safety, project health check

Work Log:
- Re-confirmed /home/z/my-project as the single working repo for SecretArrow/PhotoMagic (origin main, trees identical at fb7f247)
- Removed accidental redundant nested clone /home/z/my-project/PhotoMagic
- Secured credentials: token stored only in ~/.git-credentials (outside repo, chmod 600); remote URL clean; .gitignore already blocks .env/*.pem/*.key
- Verified git history has no token; verified Caddyfile/tsconfig sandbox commit (6a1bb1d) contains no secrets
- Checked GitHub API: public repo, 0 open issues
- Health check: bunx tsc --noEmit clean (exit 0), vitest 71/71 pass, dev server live HTTP 200 on :3000, Caddy proxy on :81
- Full project exploration via Explore subagent: 77 src files (~11.6k lines), 13 tools, filters worker, EN/ID i18n, PWA, CI verify job

Stage Summary:
- Workspace in perfect sync readiness; pending sandbox commit 6a1bb1d pushed to origin/main
- App v1.0.0 healthy: typecheck 0 errors, 71/71 tests, server 200

---
Task ID: B1
Agent: general-purpose (PSD writer)
Task: Self-contained Photoshop PSD (v1, RGB, 8-bit) writer with layers + Vitest suite

Work Log:
- Read worklog, engine contracts (types.ts, render.ts, raster.ts, document.ts, blend.ts, paint.ts), documents/project.ts (serializer style), formats/api.ts (export conventions), vitest.config.ts, eslint.config.mjs, existing tests
- Confirmed doc.layers is bottom→top (types.ts) → PSD records written top-first via reversed iteration; opacity field is 0..1 → scaled ×255 rounded
- Created src/formats/psd.ts: PSD v1 writer (big-endian DataView, ByteWriter class), no deps, browser-safe
  - exportPsd(doc): 26-byte header (8BPS, v1, 4ch, dims, 8bpc, RGB); empty color-mode + resources; layer & mask section (u32 sectionLen = layerInfo+pad+8) with per-layer records (rect, 4 channel infos ids 0/1/2/-1 with exact dataLengths, 8BIM + PSD blend key, opacity, clipping 0, flags bit1=hidden, pascal name 4-byte-aligned min 4) then grouped RLE channel data (compression 1, u16 row table, PackBits rows) then even-length pad (Adobe rounding, inclusive), global mask len 0; composite section = composeDocument → planar R,G,B,A RLE (one u16 row table for all 4×h rows)
  - Layer mapping: raster layers → own canvas + x/y offset; text/shape/fill/adjustment/group → renderLayerIsolated at 0,0 doc-size; hidden layers included with flag 2; zero-size layers skipped; blend union → PSD keys (norm/mul /scrn/over/dark/lite/div /idiv/hLit/sLit/diff/smud/hue /sat /colr/lum ), unknown → norm; names latin-1 (non-latin1 → '?', ≤255 bytes); degenerate docs (w/h < 1) → 1×1 transparent composite
  - Exported packBits encoder (literal (n-1) 1..128, repeat (1-n) 2..128, min repeat 2)
- Created tests/unit/psd.test.ts (13 tests, node env): FakeCanvas/FakeContext2D shim stubbed via vi.stubGlobal('document') (putImageData/fillRect/clearRect/source-over drawImage/getImageData only; engine blends approximated as over — blend correctness asserted via PSD keys); readPSDStructure parser walks header→colorMode→resources→layer&mask (records + channel data + pad + global mask, throws on any length/signature inconsistency)→composite; reference decodePackBits decoder; tests: header offsets, 3-layer roundtrip (top-first names, rects, hidden flags, blend keys, opacity 128 @0.5, exact channel dataLength KAT 22 for solid 6×5, exact layerInfo 400/section 408), fill-layer rasterization + composite pixels, adjustment layer as doc-size record, packBits KATs (repeat, literal, mixed, >128 split, empty, lossless pseudo-random + run-heavy + pathological roundtrips), composite RLE decode on 4×3 offset solid layer, zero-layer doc, odd-sized layer-info even-padding KAT
- Fixed during dev: sectionLength formula (info len field + info + global mask = +8), layer-info even padding counted inside the length (Adobe inclusive rounding), Uint8Array<ArrayBuffer> typing for Blob part, 'clear' not in GlobalCompositeOperation union

Stage Summary:
- Files created: src/formats/psd.ts, tests/unit/psd.test.ts (no existing files modified)
- Public API: exportPsd(doc: DocumentState): Promise<Blob>, PSD_EXTENSION = 'psd', packBits(src: Uint8Array): Uint8Array
- Gates: bunx vitest run tests/unit/psd.test.ts → 13/13; full suite → 84/84 (71 pre-existing intact); bunx tsc --noEmit → exit 0; bunx eslint on both files → 0 errors
- Deviations: (1) Adobe layer-info even rounding implemented inclusive-of-pad and covered by a dedicated KAT; (2) masks/smart filters on raster layers are not baked into exported pixels (spec: raw canvas + offset); (3) shape/text layer pixel tests skipped (node lacks Path2D/canvas text) — structure path covered via fill/adjustment layers

---
Task ID: 8
Agent: main (Super Z) + general-purpose (PSD writer, B1)
Task: Feature drop v1.1 — AI background removal, PSD export, crop presets, mobile UX + perf, template cleanup

Work Log:
- Cleanup: removed prisma/@prisma/client/next-intl deps, prisma/, db/, src/lib/db.ts, src/app/api stub, db:* scripts, 3 template shell scripts in tests/
- B1 (subagent): src/formats/psd.ts — PSD v1 writer (RGB 8-bit, RLE, layers w/ blend/opacity/flags/names, composite) + tests/unit/psd.test.ts (13 tests)
- Feature: src/engine/segmentation.ts — on-device border-seeded region growing + feather; registered as filter 'remove-background' in new 'ai' category (types, registry, FilterDialog, MenuBar); i18n EN/ID
- Feature: crop aspect presets — CropOptions in state, aspect-locked draw/resize in crop.ts (corner anchors + edge handles), 10 presets in OptionsBar; i18n EN/ID
- Feature: PSD wired into ExportDialog (format select, honest note, quality/scale/transparency hidden); COMPATIBILITY.md updated
- Perf: rasterBuffer fast path in render.ts (doc-aligned unfiltered layers skip buffer allocation)
- Mobile: 44px touch targets (zoom cluster size-11 + new 1:1 button, dock h-11), overscroll-behavior none
- FIX (pre-existing bug): commitPixelEdit never bumped revision — display kept stale composite after filter apply; added revision bump (verified via browser pixel probe: undo/redo revealed correct pixels)
- Browser verification (agent-browser): white doc + blob → Filter→AI→Remove Background → checkerboard + intact blob (pixel probe 227,227,230); crop 1:1 drag → square rect → commit → Document 218×218; Export→PSD → toast "Exported Untitled-1.psd"; mobile 390×844 → 4-button 44px zoom cluster, 1:1 button zooms to true 100%

Stage Summary:
- 90/90 tests pass (71 old + 13 PSD + 6 segmentation), tsc clean, eslint 0 errors, dev.log clean
- Repo leaner: 3 dead deps + 6 template files removed
- v1.1 features shipped: on-device AI background removal, layered PSD export, 10 crop aspect presets, mobile touch targets + 1:1 zoom, renderer fast path, display-refresh bug fix

---
Task ID: 9-a
Agent: cleanup
Task: Remove dead code, unused components, and unused dependencies (repo lean-up)

Work Log:
- Re-verified audit with grep before every deletion: 26 shadcn ui components have zero importers outside src/components/ui (rg "ui/(accordion|alert-dialog|alert|...)" excluding components/ui → no hits); pointerBus/logo.svg/tailwind.config zero references
- Deleted 26 unused shadcn components from src/components/ui/: accordion, alert-dialog, alert, aspect-ratio, avatar, badge, breadcrumb, calendar, card, carousel, chart, checkbox, collapsible, command, drawer, form, hover-card, input-otp, navigation-menu, pagination, sidebar, skeleton, sonner, table, toggle, toggle-group (kept the 22 in use: button, input, label, textarea, slider, select, switch, popover, tooltip, dialog, sheet, tabs, menubar, dropdown-menu, context-menu, progress, separator, scroll-area, radio-group, resizable, toast, toaster)
- Deleted dead files: src/canvas/pointerBus.ts (zero imports; only a doc-comment mention in StatusBar.tsx — updated that comment to drop the stale file reference), public/logo.svg (zero refs), tailwind.config.ts (Tailwind v4 CSS-first via @tailwindcss/postcss; no @config in globals.css)
- Removed 33 deps from package.json after per-package grep confirmed zero imports in src/, scripts/, tests/: @mdxeditor/editor, @reactuses/core, @tanstack/react-query, @tanstack/react-table, date-fns, framer-motion, next-auth, react-markdown, react-syntax-highlighter, uuid, z-ai-web-dev-sdk, zod, cmdk, vaul, react-day-picker, react-hook-form, @hookform/resolvers, input-otp, recharts, sonner, next-themes, embla-carousel-react, tailwindcss-animate + radix wrappers of deleted components (@radix-ui/react-accordion, react-alert-dialog, react-aspect-ratio, react-avatar, react-checkbox, react-collapsible, react-hover-card, react-navigation-menu, react-toggle, react-toggle-group)
- Kept-with-reason (grep-verified in use): sharp (scripts/gen-icons.mjs), @dnd-kit/* (LayersPanel), react-resizable-panels (ui/resizable), zustand, clsx + tailwind-merge (lib/utils), class-variance-authority (button/toast), lucide-react, tw-animate-css (globals.css @import), next/react/react-dom, tailwindcss + @tailwindcss/postcss, all remaining @radix-ui packages map 1:1 to kept ui wrappers, all dev deps
- Template leftovers: package.json name "nextjs_tailwind_shadcn_ts" → "pixelforge-studio"; next.config.ts removed typescript.ignoreBuildErrors (tsc clean) — reactStrictMode untouched; postcss.config.mjs / eslint.config.mjs / components.json checked — no references to deleted files
- bun install → exit 0, 33 packages removed, bun.lock regenerated (-738 lines)

Stage Summary:
- Gates: bunx tsc --noEmit exit 0; bunx vitest run → 90/90 (8 files); bunx eslint . → 0 errors (16 pre-existing warnings, untouched files); rg confirms zero remaining imports of any deleted module/dep/file; git diff --stat: 33 files changed, +5/−4289 (plus bun.lock −738)
- Repo leaner: 29 dead files deleted, 33 deps removed, template name + ignoreBuildErrors fixed
- No code behavior changed; all 22 in-use ui components and all app modules intact

---
Task ID: 9-b
Agent: perf
Task: Canvas/render pipeline perf optimizations — slider history coalescing, per-layer thumbnail cache, idle-stop rAF loop, cached checker pattern (+ navigator shared-composite stretch)

Work Log:
- Read worklog, editorStore, history/index, render.ts, raster.ts, CanvasStage.tsx, controls.tsx, all 5 panels, engine/types + document; confirmed history entries store before/after whole-layer object references (cheap snapshots restored via replaceLayer), and that raster canvases mutate IN PLACE (brush/fill/retouch/filters all commit via commitPixelEdit without changing canvas identity) — so canvas-ref keying was NOT viable and a store-driven per-layer version counter was required.
- (1) History spam fix — new append-only store API in src/state/editorStore.ts:
  - `beginLayerEdit(id)` (:565) captures the pre-drag layer object into module-level `pendingLiveEdits` Map (first snapshot wins; idempotent per id), `updateLayerLive(id, patch)` (:554) mutates layer + bumps revision + bumps thumbnail version with NO history, `endLayerEdit(id, labelKey, labelFallback)` (:572) pushes exactly ONE 'layer-prop' entry: undo restores the begin-snapshot, redo restores the post-drag layer (same entry shape as updateLayer, so jumpTo walks stay consistent). No-ops safely: end without begin, deleted layer, or drag that ends where it started (shallow union-key equality).
  - undo()/redo()/jumpHistory() clear pending snapshots first (a live drag can never capture a rewound state).
  - Wired sliders: LayersPanel opacity (:183), PropertiesPanel fontSize + shape strokeWidth + adjustment-layer params (AdjustmentParamsEditor got optional onCommit threaded to every param slider via new ParamSlider wrapper) — onValueChange → begin+live, onValueCommit (Radix release + NumInput blur/Enter) → single end.
  - Also fixed color-picker spam: ColorPickerButton got optional onCommit fired on popover close; text color / shape fill+stroke / fill-layer pickers now begin+live per HSV move and push ONE entry on close.
  - controls.tsx: additive `onCommit` props on NumInput (fired on blur/Enter, always, so no-change commits still close the session) and ColorPickerButton; SliderRow threads onValueCommit into NumInput.
- (2) Per-layer thumbnail cache — src/engine/render.ts: module-level `pixelVersions` Map + exported `bumpLayerPixelVersion(s)`; layerThumbnail cache signature is now `layerId|pixelVersion|visible|docWxdocH` (Map still keyed by layer.id; `revision` param kept in signature but advisory — LayersPanel keeps threading it to force row re-render). Mask thumbnails re-keyed on mask-canvas reference identity (own map; masks are only replaced, never painted in place). Store bumps versions at: updateLayer/updateLayerLive (skipped when every patch key is thumbnail-invariant: visible/opacity/blendMode/locked/expanded/name/clipToBelow/mask/filters/adjustment — so opacity drags regenerate zero thumbs), commitPixelEdit, mergeDown, rasterizeToCanvas, undo/redo/jumpHistory + resize/resizeCanvas/crop/flip/rotate + doc create/open/switch (bump-all walk incl. group children). Verified thumbnails still update after brush stroke, gaussian blur (worker path), filter undo/redo (data URL changes on undo, restored on redo).
- (3) Idle-stop rAF loop — src/canvas/CanvasStage.tsx: frame() no longer pre-schedules; after drawing it stops when both dirty flags are clear AND no selection exists (ants keep the loop alive; accumulator resets when selection cleared). Component-level markDisplay/markOverlay/markAll call `ensureLoopRef.current()` (set to effect-local startLoop) so every store-subscription/effect/pointer/resize/tool-invalidate event restarts the loop; startLoop resets lastTime to avoid a giant first dt. DPR-resync inside frame now marks both flags (backing store was reallocated). Verified by rAF-counter probe: 0 frames over 2s idle (was ~120), 1 frame per pointermove, continuous while marching ants, 0 again after deselect.
- (4) Checker pattern cache — src/engine/raster.ts: 2cell×2cell tile (light bg + dark cells at (0,0)/(cell,cell)) → ctx.createPattern cached per (cell|light|dark) in module Map (bounded 32); paintChecker clips, translates to the legacy anchor (floor(x/cell)*cell, floor(y/cell)*cell) and fills once — mathematically identical alignment to the old fillRect loop (same anchor formula + same col+row-even parity). Legacy fillRect loop kept as paintCheckerRects fallback when createPattern returns null/throws. Verified in browser: sampled display-canvas rows show exact 8px #e3e3e6/#c8c8cd runs on 8px grid boundaries, and the phase-vs-doc-edge shift after a 37px pan matches the legacy algorithm.
- STRETCH (done): shared composite — render.ts `publishSharedComposite`/`getSharedComposite`; CanvasStage publishes its GPU-primed composite after each rebuild; NavigatorPanel now draws the shared composite + a preview-space paintChecker(8) instead of composeDocument(checker:true) per revision, eliminating a full doc recompose 300ms after every edit while the navigator is visible (falls back to composing itself when no fresh stage composite exists).
- tests/unit/store-live-edit.test.ts (new, 8 tests, node env with document/canvas stub + post-stub dynamic store import): one-entry-per-drag, undo/redo restore, live-alone no history + revision bump, end-without-begin no-op, start==end no-op, undo clears pending snapshot, text-param live edit undo/redo, begin idempotency (first snapshot wins).

Stage Summary:
- Files modified: src/state/editorStore.ts (3 new actions + version bumps + pending-edit clearing; existing signatures untouched), src/engine/render.ts (per-layer thumb cache + bump exports + shared composite), src/engine/raster.ts (cached checker pattern + legacy fallback), src/canvas/CanvasStage.tsx (idle-stop loop + composite publish), src/workspace/panels/{controls,LayersPanel,PropertiesPanel,AdjustmentsPanel,NavigatorPanel}.tsx (slider/picker wiring; HistoryPanel needed no change), tests/unit/store-live-edit.test.ts (new)
- History-commit design: begin-snapshot/end-commit with whole-layer object refs (identical entry shape to updateLayer) — one undo step per drag, undo restores pre-drag value (verified in browser: opacity drag → 1 entry, undo → 100%, redo → 23%; fontSize drag → 1 'Edit text' entry, undo → 48)
- Gates: bunx tsc --noEmit → 0; bunx vitest run → 98/98 (90 pre-existing + 8 new); eslint on all 11 changed files → 0 errors 0 warnings; dev server HTTP 200 + agent-browser smoke (brush stroke, opacity/fontSize drags, gaussian blur, thumbnails, navigator, checker alignment, rAF idle probes) — no console/page errors; server killed after testing
- Behavior notes: (a) typing in a SliderRow number field now coalesces to one entry on blur/Enter (was one per keystroke); (b) navigator checker cell size is 8 preview px (was doc-resolution checker scaled down) — same visual role; (c) undo/redo/jumpHistory now bump all layer thumbnail versions (cost: O(layers) map increments, no renders); (d) OptionsBar sliders use updateToolOptions (no history) — untouched, out of ownership.

---
Task ID: 10
Agent: mobile-ux
Task: Mobile UX — ⋯ overflow menu, image import, tool options strip, 44px touch targets, double-tap-to-zoom

Work Log:
- Read worklog (8, 9-a, 9-b), MobileWorkspace, MenuBar, OptionsBar, DialogHost, editorStore UI slice, dictionaries, CanvasStage, controls/tabs/dropdown-menu wrappers, commands.ts.
- (1) Mobile top bar "⋯" menu — MobileWorkspace.tsx: size-11 MoreHorizontal trigger + DropdownMenu (w-56, align end) mirroring MenuBar triggers via the SAME store mechanisms (no parallel state): Open image… (own hidden input), New…/Image size…/Canvas size…/Filter gallery… via setDialog('new-document'|'image-size'|'canvas-size'|'filter-gallery'), separator, Preferences/Storage/About via setDialog('settings'|'storage'|'about'). FilterDialog opens gallery-mode with no preselected filter (handles extras.filterDialog.op === null); all other dialogs already mounted in DialogHost.
- (2) Mobile image import — MobileWorkspace.tsx hidden <input type=file accept="image/*"> (:173-181) → onChange feeds shared handleOpenFiles (commands.ts) → importImageLayer/addLayer/openDocument + toasts; same pipeline as MenuBar/desktop, value reset for re-picks. Top bar also grew min-h-11 (was fixed h-11) so safe-area padding can't clip the 44px buttons.
- (3) Tool options on mobile — <OptionsBar /> mounted between canvas area and bottom dock (MobileWorkspace.tsx:184); OptionsBar already contains ONLY tool-specific controls (verified: no tools/undo/redo/zoom duplication — complementary). Found + fixed pre-existing bug in OptionsBar Bar (:45-54): sliders (flex-1, no basis) collapsed to 0px width inside the content-sized overflow-x row (also broken on desktop) — added [&_[data-slot=slider]]:w-24/shrink-0 + [&_[data-slot=select-trigger]]:min-w-32 floors; bar itself scrolls (scrollWidth 1816 @390px). Crop apply/cancel note: no apply/cancel buttons ever existed — commit is canvas double-tap/double-click (crop.ts dblClick) or Enter, cancel = switch tool; aspect presets are now reachable on mobile via the strip.
- (4) Touch targets — top bar Undo/Redo/Panels/Export size-9→size-11 (icons size-4→size-5), new ⋯ size-11; panel sheet TabsList h-9→h-13 + TabsTrigger h-7→min-h-11 (flex-1 kept from wrapper) — measured 5×44px tall, 76px wide, no overflow at 390px. Dock/zoom cluster already 44px from Task 8. Remaining sub-44px shared desktop controls (OptionsBar NumInput h-6, SliderRow thumb, ToggleChip h-6) left untouched — shared with desktop panels, would regress desktop density; noted for a future pass.
- (5) STRETCH double-tap-to-zoom — CanvasStage.tsx effect-local tap tracker (:663-692 + hooks at :712-717, :748, :767-771, :817, blur reset :925-926): two single-finger touch taps <300ms apart, <20px movement → toggles fitToScreen ↔ 100% (zoomBy(1/zoom) anchored at tap point). Stroke-safe by construction: zoom only fires when the tap dispatched NO tool stroke (hand-tool taps), never after pinch (multi flag) or drag (moved flag); cleared on window blur. Verified: hand double-tap 0.274→1.0→0.274 with zero history entries; brush double-tap → zoom unchanged, strokes/history unchanged (2 tap-strokes = pre-existing behavior).
- i18n: added 'mobile.openImage' en 'Open image…' / id 'Buka gambar…' (only missing key; all other labels reuse existing keys in both languages).

Stage Summary:
- Files modified: src/workspace/MobileWorkspace.tsx (⋯ menu + hidden import input + OptionsBar mount + 44px targets), src/workspace/panels/OptionsBar.tsx (Bar slider/select width floors — fixes 0px sliders desktop too), src/canvas/CanvasStage.tsx (additive double-tap-to-zoom, stroke/pinch-safe), src/i18n/dictionaries.ts (+1 key en+id)
- Gates: bunx tsc --noEmit → 0; bunx vitest run → 98/98; eslint on all 4 changed files → 0 errors; dev server HTTP 200 + agent-browser at 390×844: ⋯ menu lists all 8 items, New document + Filter gallery dialogs open/close from it, hidden input[type=file][accept=image/*] in DOM, brush options strip (6 sliders 96px, drag 24→313 works), tabs 44px, no page horizontal overflow at 390px; desktop 1280×800: MenuBar shell intact, no mobile-only elements (⋯ buttons 0, accept=image/* input absent — only pre-existing GlobalKeys input), options sliders 96px (bug fix). Screenshots: download/verify-mobile-390-{menu,options,tabs}.png, download/verify-desktop-1280.png; dev server killed after.
- Behavior notes: (a) double-tap zoom intentionally limited to non-stroke taps (hand tool) — firing it for paint/selection taps would corrupt stroke dispatch (first tap already commits ink), per task's "skip if it risks breaking stroke dispatch"; (b) desktop OptionsBar sliders were 0px-wide before this task (pre-existing) and are now 96px — desktop layout otherwise untouched.

---
Task ID: 11
Agent: features (completed by orchestrator after agent timeout — all code was already written; orchestrator ran browser verification)
Task: Quick-win features — export scale presets + AVIF, histogram panel, dead rulers-setting removal

Work Log:
- ExportDialog: scale preset chips 25%/50%/100%/200% next to scale slider (click sets value, active chip highlighted); AVIF format with async feature-detect (1×1 canvas toBlob probe, module-level cached promise) — option hidden gracefully when browser can't encode AVIF (verified: headless Chromium falls back to PNG → option absent, i18n note 'export.avifNote' en+id)
- HistogramPanel (new src/workspace/panels/HistogramPanel.tsx): uses runHistogram (worker) on composited doc; RGB channel curves on small canvas; 250ms debounced recompute on revision change; mounted as desktop tab in RightPanels + mobile tab in MobileWorkspace sheet ('panel.histogram' en+id)
- Rulers: removed dead rulersVisible setting from state/types, store default, GlobalKeys shortcut, MenuBar View toggle, SettingsDialog (audit: zero render sites); orphan i18n keys cleaned
- Orchestrator browser verification: desktop histogram renders (white-doc spike at right), invert-on-layer → histogram CHANGED=true (checksum 9461641→9462023, debounced update works); export dialog chips work (50% click → slider 50); mobile 390×844 histogram tab renders (348×174 canvas); console clean (only pre-existing shadcn aria-describedby warning)

Stage Summary:
- Files: + src/workspace/panels/HistogramPanel.tsx; modified ExportDialog, RightPanels, MobileWorkspace, dictionaries, state/types, GlobalKeys, MenuBar, SettingsDialog
- Gates: tsc 0 errors, vitest 98/98, eslint 0 errors on changed files, i18n parity 436=436 (scripts/i18n-parity.ts added as repo utility)
- Screenshots: download/verify-histogram-{desktop,panel,after-stroke}.png, verify-export (dialog snapshot), verify-mobile-histogram.png

---
Task ID: 12
Agent: main (Super Z)
Task: v1.2 verification, worklog & release push

Work Log:
- Restored sandbox file-mode noise (166 files chmod 755→644, content untouched)
- Health at start: tsc 0, 90/90 tests; audit via Explore subagent (26 unused ui components, 33 unused deps, mobile gaps, perf hotspots, quick-win features)
- Wave 1 (parallel): Task 9-a cleanup + Task 9-b perf — see entries above
- Wave 2: Task 10 mobile UX; Wave 3: Task 11 features — see entries above
- Final gates: bunx tsc --noEmit → 0; bunx vitest run → 98/98 (9 files); eslint 0 errors; i18n parity 436=436; no console/page errors; browser smoke desktop + mobile pass

Stage Summary:
- v1.2 shipped: repo −4.4k lines (29 dead files, 33 deps), slider history coalescing (begin/updateLive/endLayerEdit), per-layer thumbnail cache, idle-stop rAF, checker pattern cache, shared composite for Navigator, mobile ⋯ menu + image import + tool options strip + 44px targets + double-tap zoom, export scale chips + AVIF (feature-detected), histogram panel (desktop+mobile), rulers setting removed, OptionsBar 0px-slider bug fixed, commitPixelEdit display-refresh intact

---
Task ID: 13
Agent: psd-import
Task: PSD import — production parser (src/formats/psdImport.ts), open-pipeline wiring, tests, docs

Work Log:
- Read worklog (B1/8: PSD writer exists; 9-a/9-b/10/11/12 context), psd.ts writer, psd.test.ts (lifted the TEST-ONLY readPSDStructure/decodePackBits into production), engine types/document/raster, commands.ts open pipeline, MenuBar/GlobalKeys/MobileWorkspace pickers, editorStore openDocument, documents/project.ts (loadProject construction pattern)
- Created src/formats/psdImport.ts (self-contained, browser-safe, no deps):
  - importPsd(source: ArrayBuffer | File): Promise<PsdImportResult> — PsdImportResult { name, width, height, layers: ImportedLayer[] (PSD file order, TOP first), usedComposite }; ImportedLayer { name, x, y, width, height, canvas (host canvas via makeCanvas), visible, opacity (0..1), blend (engine BlendMode) }
  - parse: 26-byte header (8BPS/v1/3-4ch/1..30000px), color-mode + resources skipped by length, layer & mask section (records: rect, channel infos, 8BIM|8B64 + 4-char blend key, opacity, flags bit1=hidden, Pascal name), channel data blocks (compression 0=raw / 1=RLE PackBits, planar rows), composite image-data section used as fallback (single 'Background' layer) when zero usable layer records
  - channel ids: 0/1/2 → R/G/B, -1 → alpha (missing → opaque), -2/-3 masks skipped, anything else → typed reject; bounds-checked big-endian reader throws on every truncation/invalid length
  - honest rejections (PsdImportError, user-facing messages): wrong signature, PSB v2, other versions, non-RGB color modes (named: CMYK/Grayscale/Indexed/Multichannel/Duotone/Lab/Bitmap), 1/16/32-bit depth, channel count ≠ 3/4, unknown channel ids, unknown compression, corrupted RLE, out-of-range dims
  - decodePackBits exported (production; bounds + length-mismatch errors); layer names: strict UTF-8 (TextDecoder fatal) with Latin-1 fallback — documented choice in code (Photoshop pascal names are historically Latin-1, modern files write UTF-8; 'luni' block deliberately unparsed)
- psd.ts extended additively (writer API untouched): exported PSD_TO_BLEND (inverse of BLEND_TO_PSD) + psdBlendMode(key) — unknown keys → normal
- commands.ts open pipeline: isPsdFile gate (extension .psd OR 8BPS magic via file.slice(0,4)) in handleOpenFiles → openPsdDocument builds a DocumentState (createDocument, transparent, no background layer), unshifts records bottom→top, maps name/x/y/visible/opacity/blend onto real raster layers, openDocument + success toast (reuses toast.imported); failure → toast with parser message. openFilePicker accept += '.psd'; MobileWorkspace hidden input accept="image/*,.psd" (string-only). MenuBar has no own input (routes through openFilePicker — no change needed); GlobalKeys Ctrl+O routes through openFilePicker too (verified) but its secondary 'pf:open-file' hidden input accept list was NOT touched (outside ownership — see notes)
- api.ts small honest additions: 'image/vnd.adobe.photoshop' in SUPPORTED_IMPORT_TYPES; UNSUPPORTED_HINT now lists PSD as supported / drops it from unsupported
- tests/unit/psd-import.test.ts (24 tests, node env, FakeCanvas/FakeContext2D vi.stubGlobal shim copied from psd.test.ts): A) exportPsd→importPsd roundtrip — pixel-exact layers (per-pixel RGBA equality), order/names (incl. latin-1 'Café'), hidden flags, opacity 128@0.5, blend mapping screen/multiply, offsets, ArrayBuffer input, zero-layer composite fallback; B) synthetic hand-built 2×1 RGB PSD (ByteBuf) — header/record/raw planes exact, missing-alpha → opaque, UTF-8 + Latin-1 names, unknown blend key → normal, hidden flag, absent layer section → composite, unknown channel id reject; C) rejections — signature, PSB, CMYK, 16-bit, too-small, truncated sections, extension-only non-PSD; D) decodePackBits KATs (repeat/literal/mixed/128-split/lossless roundtrips/truncated errors); E) isPsdFile extension+magic
- Fixed during dev (found by tests): synthetic builder reserved-bytes count (6 not 10), record length formula now channel-count aware (34 + 6n + extra, even-padded on extra), blendKey was parsed but not stored on LayerRecord (silently 'normal') — now stored and mapped; alpha (-1) false-rejection guard corrected after unknown-id hardening
- Docs: COMPATIBILITY.md import table PSD row → ⚠️ Partial (v1 RGB 8-bit layers/blend/opacity/visibility/offsets/names; composite fallback; not: PSB/CMYK/16-32bit/masks/smart filters); README feature list + PSD line, roadmap PSD/TIFF entry updated to TIFF-only
- i18n: did NOT touch dictionaries.ts (orchestrator owns it) — code uses toastText('import.psdFailed' as TranslationKey, 'Could not import PSD: {reason}', { reason }); toastText's hasOwnProperty guard renders the EN fallback gracefully until the key lands

Stage Summary:
- Files created: src/formats/psdImport.ts (~600 lines), tests/unit/psd-import.test.ts; modified: src/formats/psd.ts (+10 additive), src/workspace/commands.ts (+60), src/workspace/MobileWorkspace.tsx (accept string only), src/formats/api.ts (+3/-1), docs/COMPATIBILITY.md, README.md
- Public API: importPsd(source: ArrayBuffer | File): Promise<PsdImportResult>; isPsdFile(file: File): Promise<boolean>; decodePackBits(src, expectedLength): Uint8Array; PsdImportError (typed, user-facing messages); psd.ts: PSD_TO_BLEND, psdBlendMode(key) (exportPsd/packBits/PSD_EXTENSION intact)
- Blend map (PSD key → engine): norm→normal, 'mul '→multiply, scrn→screen, over→overlay, dark→darken, lite→lighten, 'div '→color-dodge, idiv→color-burn, hLit→hard-light, sLit→soft-light, diff→difference, smud→exclusion, 'hue '→hue, 'sat '→saturation, colr→color, 'lum '→luminosity; unknown→normal
- i18n keys needed (orchestrator): 'import.psdFailed' — EN 'Could not import PSD: {reason}' / ID 'Gagal mengimpor PSD: {reason}' (only missing key; success reuses toast.imported, unsupported reuses toast.unsupportedFormat)
- Gates: bunx tsc --noEmit → 0; bunx vitest run → 122/122 (98 pre-existing + 24 new, 10 files); bunx eslint on all changed files → 0 errors; git status → only ownership-list files touched
- Gate 5: roundtrip test asserts pixel-exact import of exportPsd output (per-pixel RGBA equality on all 3 layers incl. alpha + offsets)
- Honest scope notes: (a) GlobalKeys.tsx has a second hidden input (accept='…,.pfs' without .psd) reachable only via the undispatched 'pf:open-file' event — outside my ownership list, left untouched; orchestrator may append '.psd' there; (b) layer/adjustment/vector masks, smart filters, clipping stacks and layer groups are not reconstructed (groups import as flat siblings; masks skipped; text/shape/smart layers import as their stored raster pixels); (c) negative layer count (merged-alpha composite nuance) is tolerated but the merged alpha nuance is ignored; (d) composite fallback triggers only when zero usable layer records exist (flattened exports); (e) menu-bar File→Open + Ctrl+O + mobile picker all reach the PSD path through handleOpenFiles

---
Task ID: 14
Agent: webgpu-mobile
Task: WebGPU display path (settings-gated, fallback-safe) + mobile panel tabs overflow fix + i18n (incl. import.psdFailed for Task 13) + docs

Work Log:
- Read worklog (9-b idle-stop rAF + shared composite, 10 mobile, 11 histogram/rulers removal, 12/13), CanvasStage (1006 lines: drawDisplay/drawOverlay, dirty flags, applyViewTransform, publishSharedComposite), render.ts (composeDocument + shared composite API), pointerContract.docToScreen, state/types + editorStore defaults, StatusBar chip pattern, SettingsDialog SelectRow pattern, MobileWorkspace sheet TabsList, sheet.tsx (absolute close X at top-4 right-4), raster.ts paintChecker (parity anchored to CSS-px cell grid)
- Architecture decision (checker-in-GPU vs stacked canvas): chose SINGLE WebGPU canvas drawing both quads — (1) checkerboard quad over the doc's screen bbox with parity computed in the fragment shader from CSS-px coords (bit-identical to paintChecker: dark ⇔ (floor(x/cell)+floor(y/cell)) even, same #c8c8cd/#e3e3e6), (2) composite quad under doc→NDC mat3 with premultiplied source-over blending. Reasons: keeps the display surface single-owner (no third stacked DOM canvas / no checker-canvas↔gpu-canvas repaint coupling), checker parity is 5 lines of shader (exact same anchor math as Canvas2D), and the Canvas2D path stays byte-for-byte unchanged for the fallback. alphaMode 'premultiplied' (canvas clears transparent outside the doc; 'opaque' would black out the viewport).
- NEW src/canvas/gpu.ts (~700 lines): isWebGPUAvailable() (typeof navigator guard, SSR/test safe); pure math — viewToMat3 (F·R·T(pan)·S(zoom) expanded EXACTLY equal to docToScreen incl. rotated pan vector: row x = fx·[cos·z, −sin·z, cos·panX−sin·panY], row y = fy·[sin·z, cos·z, sin·panX+cos·panY] — caught+fixed by the new tests), mat3Multiply/mat3Apply/mat3Inverse, ndcFromCss, checkerCellIsDark (shader reference contract), mat3ToWgsl (padded column-major); resolveDisplayBackend(setting, available, previouslyFailed) pure wiring policy; DisplayBackend registry (setDisplayBackend/getDisplayBackend/subscribeDisplayBackend) so StatusBar shows the ACTIVE renderer; createGpuRenderer(canvas, {onDeviceLost}) → GpuRenderer|null — requestAdapter/requestDevice, context.configure(getPreferredCanvasFormat, alphaMode premultiplied), one WGSL module → checker+texture pipelines (layout 'auto', premultiplied blend one/one-minus-src-alpha), uniform buffers, linear+nearest samplers (zoom<3 bilinear / ≥3 nearest mirroring imageSmoothingEnabled), clamp-to-edge; ensureTexture: copyExternalImageToTexture(premultipliedAlpha) ONLY when composite identity/dims/contentVersion change (re-upload per revision, never per frame — the actual perf win); resize() re-presents without re-upload; render() try/catch (one bad frame never crashes the loop); device.lost → onDeviceLost → stage fallback; destroy() → texture/uniform destroy + unconfigure + device.destroy (destroyed flag makes late lost-callbacks no-op). NO @webgpu/types dependency — minimal structural types (tsc-clean without package.json changes)
- CanvasStage integration (additive, loop untouched): settings.renderer: 'auto'|'canvas2d' (types + defaultSettings, additive); rendererSetting → gpuStage chooser effect using resolveDisplayBackend; display <canvas> re-keyed on backend swap (one element can never carry both context types — React recreates it, main effect re-runs via gpuStage dep); main effect: gpuBackend closure + gpuRenderer/gpuDisposed/gpuDead locals, 8s init timeout, createGpuRenderer→then(gpuRenderer=…, setDisplayBackend('webgpu'), markDisplay) / fallbackToCanvas2d (gpuFailedRef permanent for the mount, setDisplayBackend('canvas2d'), setGpuStage(false)); drawDisplay branches: GPU path passes view+viewport+dpr+checkerCell+docScreenBBox-clipped checkerBBox+doc dims+contentVersion=revision; Canvas2D path byte-identical to before (displayCtxRef reset at effect start, getContext('2d') gated on !gpuBackend so the webgpu-keyed canvas is never poisoned); overlay canvas + ants + tool overlays untouched; cleanup destroys renderer + guards late init/device-lost
- SettingsDialog: SelectRow 'Renderer: Auto (WebGPU when available) / Canvas 2D' — live-swap (verified: toggle Canvas 2D→Auto with zero errors, stage keeps working)
- StatusBar: ACTIVE-renderer chip after sRGB (getDisplayBackend + subscribeDisplayBackend; shows WebGPU/Canvas 2D = what's actually used)
- Mobile tabs overflow fix (MobileWorkspace sheet TabsList): overflow-x-auto + pf-scroll + justify-start, triggers min-h-11 flex-none px-2.5 (44px targets kept), trailing aria-hidden w-8 spacer so the last tab scrolls clear of the sheet's absolute close X
- i18n (en+id, 7 keys): dialog.settings.renderer / rendererAuto / rendererCanvas2d, status.renderer / rendererWebgpu / rendererCanvas2d, import.psdFailed ('Could not import PSD: {reason}' / 'Gagal mengimpor PSD: {reason}' — {reason} interpolation mirrors existing toast keys; Task 13's toastText cast now resolves the real key)
- Tests tests/unit/gpu-math.test.ts (14, node, no GPU): viewToMat3≡docToScreen across 6 view combos × 3 points; flip algebra; mat3Inverse roundtrip ≡ screenToDoc; M·M⁻¹=I; ndcFromCss corners + viewport-center doc point chain; checkerCellIsDark parity vs tile rule + degenerate cell clamp; resolveDisplayBackend 4 cases; isWebGPUAvailable with stubbed navigator ({gpu}/{} /undefined)
- Docs: ARCHITECTURE §3 'Rendering backends (honest scope)' (Canvas2D compose + optional WebGPU display blit, fallback chain, what v1 does NOT do); COMPATIBILITY platform note (headless/old browsers → Canvas 2D, identical pixels); README roadmap WebGPU item → 'partially shipped' phrasing + status note adjusted
- Gates: bunx tsc --noEmit → 0; bunx vitest run → 136/136 (122 pre-existing + 14 new, 11 files); bunx eslint on all 10 changed/new files → 0 errors; scripts/i18n-parity.ts → 443=443, no missing keys
- Browser (dev server :3000 HTTP 200, agent-browser; headless Chromium): navigator.gpu EXISTS in this headless build — init path ran and fell back cleanly to Canvas 2D (StatusBar chip 'Canvas 2D' = honest ACTIVE renderer; zero console errors). Regression with real input + canvas pixel probe: brush stroke → 32/540 dark ink samples, Undo → 0/540, history 1/2→0/2, zoom unchanged; ctrl+wheel + pan paths untouched. Settings toggle Canvas 2D ↔ Auto live, [role=dialog] closes clean. Mobile 390×844: tablist scrollWidth 432 > clientWidth 390 (scrolls), all 6 tabs reachable, min tab height 44px, zero overlap with the close X, NO page-level horizontal scroll, Properties/Layers tab clicks swap panels. Screenshots: download/verify-gpu-badge.png (55.8KB), download/verify-mobile-tabs-fixed.png (20.4KB); dev server killed after (curl → DOWN)

Stage Summary:
- Files created: src/canvas/gpu.ts, tests/unit/gpu-math.test.ts; modified: src/canvas/CanvasStage.tsx (backend-swap integration), src/state/types.ts + src/state/editorStore.ts (settings.renderer additive only), src/workspace/dialogs/SettingsDialog.tsx (Renderer select), src/workspace/panels/StatusBar.tsx (active-renderer chip), src/workspace/MobileWorkspace.tsx (scrollable tablist + X-clear spacer), src/i18n/dictionaries.ts (+7 keys en+id), docs/ARCHITECTURE.md, docs/COMPATIBILITY.md, README.md. NOT touched (ownership): src/formats/*, src/workspace/commands.ts, engine/render.ts (shared-composite publish API from 9-b reused — no render.ts hook needed)
- Honest scope: v1 WebGPU = DISPLAY BLIT ONLY (checker quad + composite quad); compose pipeline, filters, adjustments, histogram all remain Canvas2D/worker; texture re-upload only on revision change (pan/zoom/resize re-present); no mipmaps (minFilter linear, acceptable shimmer <1× zoom vs Canvas2D 'high'); fallback chain auto→(feature/adapter/device/context/8s-timeout/device-loss)→permanent Canvas 2D per mount; headless had navigator.gpu but no usable adapter → chip honestly showed Canvas 2D; Matrix session caveat: several tool outputs arrived corrupted mid-task (hallucinated file contents); ground truth re-established via deterministic gates (tsc/vitest/eslint/i18n-parity all re-run clean at the end), bun module-surface probe, and pixel-level canvas probes
- Next: wire renderer swap into persistence review (settings.renderer now serializes with autosave), consider GPU checker-only fast path for 4K docs, mipmapped sampler when zoom<1

---
Task ID: 15
Agent: main (Super Z)
Task: v1.3 verification (incl. independent re-run after agent-14 reported corrupted tool outputs) + release

Work Log:
- Independent gates: bunx tsc --noEmit → 0; bunx vitest run → 136/136 (11 files); bunx eslint . → 0 errors (14 pre-existing warnings); scripts/i18n-parity.ts → 443=443
- Generated download/sample.psd fixture via temporary vitest (real exportPsd + proven node shim, 3 layers: Red Box / Green Box hidden / Blue Box screen @0.75, 96×64, 2928 bytes); temp test deleted after
- Browser E2E PSD import (agent-browser, desktop 1280×800): File→Open primes persistent body input → upload sample.psd → doc "sample" 96×64, 3 layers imported exactly (Blue Box opacity 75 + visible, Green Box hidden ✓, Red Box visible ✓), transparent checkerboard render correct, autosave OK
- Renderer badge confirmed: status bar honestly shows "Canvas 2D" (headless Chromium exposes navigator.gpu but init falls back cleanly — expected)
- Post-task fix: GlobalKeys hidden input accept += '.psd' (Task 13 note)
- Restored sandbox chmod noise twice (140 + 166 files, mode-only, content untouched)

Stage Summary:
- v1.3 shipped: PSD import (v1 RGB 8-bit, layers/blend/opacity/visibility/offsets, composite fallback, typed errors), WebGPU display path (settings-gated auto/canvas2d, checker+composite quads, texture re-upload only on revision, permanent fallback, live status badge), mobile panel tabs scrollable at 390px, i18n 443=443
- Suite grew 98 → 136 tests (+24 PSD import, +14 gpu-math); tsc/eslint clean; token never touched
