# PixelForge Studio

**A free, professional-grade photo editor that runs entirely in your browser.**

PixelForge Studio is a client-side image editor with a Photoshop-style workflow — layers, blend modes, masks, adjustments, filters, text, shapes and a full undo history — with a privacy-first guarantee: **your images never leave your device**. There is no account, no upload, no server-side processing. Open the page, edit, export.

---

## Features

- **Layers** — raster, text, shape, fill, adjustment and group layers, with drag reorder, opacity, locking, visibility and clipping masks
- **Blend modes** — the full Canvas2D set (multiply, screen, overlay, soft light, hue/saturation/color/luminosity, …)
- **Masks** — non-destructive raster layer masks (paintable, invertible)
- **Adjustments** — brightness/contrast, exposure, levels, curves-style gamma, hue/saturation, vibrance, temperature/tint, invert, grayscale, sepia, posterize, threshold — as live adjustment layers or direct pixel ops
- **Filters** — blur, sharpen, noise, stylize, distort, light and artistic effects applied through a Web Worker (UI never blocks)
- **Text** — point and paragraph text with font, weight, style, alignment, letter spacing and line height
- **Shapes** — rectangles (rounded), ellipses, lines, polygons, stars and pen paths, with fills, strokes and smart-vector re-editing
- **Selections** — rectangular/elliptical marquees, lasso, polygonal lasso, magic wand (contiguous + global), add/subtract/intersect modes, feather, grow/contract, border, invert
- **Content-aware fill (diffusion inpainting)** — Edit ▸ Content-aware fill fills the selection from its surroundings; best on smooth areas (see `docs/COMPATIBILITY.md` for the honest scope)
- **Transforms** — move, scale, rotate, flip, crop, canvas resize with per-layer content
- **History** — memory-aware undo/redo (384 MB budget, 200 entries) with a browsable history panel and jump-to-state
- **Autosave & recovery** — periodic snapshot to IndexedDB, save-on-hide, and crash recovery of the last safe state
- **PWA / offline** — installable app with a service worker; keep editing without a network connection
- **EN / ID localization** — full English and Indonesian dictionaries
- **Native project format** — `.pfs` files (versioned JSON with embedded PNG buffers) that save and restore complete documents
- **Photoshop (PSD) import & export** — layered PSD v1 (RGB 8-bit) files open with layers, blend modes, opacity, visibility and offsets preserved; non-raster layers import rasterized

## Tech stack

| Layer          | Technology                                      |
| -------------- | ----------------------------------------------- |
| Framework      | Next.js 16 (App Router) + React 19              |
| Language       | TypeScript (strict)                             |
| Styling        | Tailwind CSS 4 + shadcn/ui                      |
| State          | Zustand                                         |
| Engine         | Custom Canvas2D compositing engine              |
| Heavy compute  | Web Workers (filters, adjustments, histograms)  |
| Persistence    | IndexedDB (autosave/recovery), `.pfs` files     |
| Icons          | sharp-generated PNGs from a single SVG source   |
| Testing        | Vitest (node environment, unit suites)          |
| CI             | GitHub Actions with Bun                         |

## Getting started

Requires [Bun](https://bun.sh) (recommended) or Node.js 20+.

```bash
# install
bun install            # or: npm install

# development server → http://localhost:3000
bun run dev

# production build + start
bun run build
bun run start
```

### Testing

```bash
bunx vitest run        # unit suites: history, selections, color, project
```

### Icons

App icons are generated from a single SVG source via `sharp`:

```bash
node scripts/gen-icons.mjs   # writes public/icons/*.png + icon.svg
```

## Project structure

```
src/
  engine/      # pure document model + pixel engine (no React)
  state/       # Zustand editor store — actions, history wiring, settings
  canvas/      # pointer/event contract between workspace and tools
  tools/       # tool implementations (brush, marquee, wand, text, shapes…)
  workspace/   # editor shell — panels, options bar, canvas viewport
  formats/     # import/export adapters (PNG/JPEG/WebP/GIF/BMP/SVG)
  documents/   # .pfs native project serializer (save/load/validate)
  storage/     # IndexedDB autosave + crash-recovery snapshots
  workers/     # Web Worker entry for filters/adjustments/histograms
  i18n/        # EN/ID dictionaries + provider
  shortcuts/   # keyboard shortcut registry
docs/          # architecture, compatibility matrix, licenses
```

## Roadmap

> **Status note:** the items below are **NOT fully implemented** in the current build. They are planned (or partially shipped, where marked) work, tracked here so nobody mistakes them for complete features.

- **WebGPU render backend** — **partially shipped**: an optional WebGPU *display* path presents the composed document as a GPU quad (texture uploads only on content changes; automatic, permanent Canvas 2D fallback wherever WebGPU is unavailable). The compose/filter pipeline itself is still Canvas2D — full GPU composition is future work (see `docs/ARCHITECTURE.md`).
- **TIFF import** — not supported yet; TIFF files must be converted first (layered **PSD import is supported** — see `docs/COMPATIBILITY.md`).
- **Content-aware fill** — **partially shipped (v1 diffusion inpainting)**: Edit ▸ Content-aware fill diffuses the selection from its boundary (worker-powered, deterministic). Honest scope: smooth regions (sky, skin, walls, gradients) — it is **not** texture synthesis, so structured textures come out blurred. PatchMatch/exemplar-based fill remains future work.

## Privacy

PixelForge Studio is **privacy-first by architecture, not by policy alone**:

- Images, layers, selections and exports are processed **entirely in your browser** (CPU + Canvas2D/Web Workers).
- There is **no upload endpoint** — pixel data is never sent to any server.
- Autosave and crash recovery live in your browser's own IndexedDB storage; clearing site data removes them.
- No accounts, no analytics on your images, no third-party image services.

## License

[MIT](LICENSE) — free for personal and commercial use. See [`docs/LICENSES.md`](docs/LICENSES.md) for the dependency license summary.
