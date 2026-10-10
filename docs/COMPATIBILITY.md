# PixelForge Studio — Compatibility

Honest support matrix for the current build (`version` 1 / app 1.0.0). If a format is not listed as supported, it is **not** supported — the import dialog tells you so instead of silently flattening or corrupting files.

---

## Import

| Format                   | Support            | Notes                                                                        |
| ------------------------ | ------------------ | ---------------------------------------------------------------------------- |
| PNG                      | ✅ Supported        | Full alpha; decoded to a raster layer.                                       |
| JPEG / JPG               | ✅ Supported        | Baseline + progressive via browser decoders.                                 |
| WebP                     | ✅ Supported        | Animated WebP imports the first frame (browser decoder behavior).            |
| GIF                      | ⚠️ Partial          | **First frame only** in this build — no animated GIF import/editing yet.      |
| BMP                      | ✅ Supported        | Standard uncompressed variants via browser decoder.                          |
| SVG                      | ⚠️ Partial          | **Rasterized on import** (sanitized by re-drawing). Vector nodes are not editable after import. |
| TIFF                     | ❌ Not supported    | Browsers ship no TIFF decoder; needs a custom decoder (planned — see below).  |
| PSD (Photoshop)          | ⚠️ Partial          | **Import:** PSD v1, RGB, 8-bit (raw/RLE channel data) — layers with blend modes, opacity, visibility, offsets and names; **layer groups ('lsct' section dividers) are reconstructed as nested folders** (expanded state, group blend/opacity/visibility); Unicode layer names ('luni') are preferred; text/shape/smart layers import as their stored raster pixels; flattened files fall back to the composite. Not supported: PSB, CMYK/grayscale/indexed/Lab, 16/32-bit, layer/vector masks, smart filters, clipping stacks. **Export** to PSD is supported — see below. |
| PDF                      | ❌ Not supported    | Out of scope for an image editor v1.                                          |
| HEIC / HEIF              | ❌ Not supported    | Licensing + platform decoder variance; not bundled.                           |
| AVIF                     | ❌ Not supported    | Deliberately not wired in this build even where platform decoders exist.      |
| Camera RAW (CR2/NEF/ARW…)| ❌ Not supported    | Requires per-camera demosaicing — significant future work.                    |
| `.pfs` project           | ✅ Supported        | Native format (see below).                                                    |

**Rationale:** the client-side, zero-upload architecture means every decoder must run in the browser. Formats the platform decodes natively (PNG/JPEG/WebP/GIF/BMP/SVG) are free; the rest need substantial bundled code (WASM decoders, layer parsers) and are future work, tracked in the README roadmap.

## Export

| Format | Support     | Notes                                                     |
| ------ | ----------- | --------------------------------------------------------- |
| PNG    | ✅ Supported | Full alpha; recommended for lossless output.              |
| JPEG   | ✅ Supported | Quality slider; alpha flattened onto background.          |
| WebP   | ✅ Supported | Lossy/lossless per browser encoder support.               |
| PSD    | ✅ Supported | RGB 8-bit, **layer groups written as 'lsct' section dividers (open/closed state, nested recursively)**, layers with blend modes/opacity/visibility/names (Unicode names via 'luni'); text/shape layers rasterized; masks, smart filters and clipping stacks are not baked into layer pixels; 100% scale; opens in Photoshop/GIMP/Photopea. |
| `.pfs` | ✅ Supported | Native project (see below).                               |
| TIFF   | ❌ Not supported | Same decoder rationale as import.                     |
| PDF    | ❌ Not supported | —                                                     |

## Native project format (`.pfs`)

- **Spec:** versioned JSON (`format: 'pixelforge-studio'`, `version: 1`) with raster/mask buffers embedded as **PNG data URLs**; layers stored top→bottom; document header carries name, size, dpi, background, description, guides.
- **Size limit:** 512 MB on serialized size (safety cap) — base64-embedded PNGs make files larger than a zip container, which is an accepted v1 trade-off for self-contained, inspectable files.
- **Forward compatibility:** files with a newer `version` are rejected with a clear message rather than mis-decoded.
- Editing history is not embedded; a `.pfs` stores the current document state.

## Color & depth pipeline

| Capability            | This build                                                          |
| --------------------- | ------------------------------------------------------------------- |
| Color model           | **8 bits/channel, sRGB** (`colorMode: 'rgb-8bit'`)                   |
| Blend modes           | Full Canvas2D `globalCompositeOperation` set: normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity |
| CMYK                  | ❌ Not supported (JPEGs with CMYK profiles may render shifted before conversion) |
| 16-bit / 32-bit float | ❌ Not supported yet — high-bit-depth files are converted to 8-bit on import |
| ICC profile handling  | ❌ Minimal — color-managed conversion is future work                  |
| Histograms / luma     | Rec.601 luma for grayscale & quick ops                               |

## Editing features (honest scope)

| Feature | Support | Notes |
| ------- | ------- | ----- |
| Content-aware fill | ⚠️ Partial | **Diffusion-based inpainting only** (onion-peel seeding + fixed-iteration Laplace smoothing, worker-powered, deterministic). Best on **smooth regions** — sky, skin, walls, gradients. It is **not** texture synthesis: structured textures (bricks, foliage, text, patterns) come out blurred, and large holes fill with smooth color, not detail. Feathered selections are filled at a hard 128/255 threshold. Alpha diffuses like RGB: opaque imagery stays opaque (255-boundary), while content on transparent layers is removed (transparency propagates inward). Exemplar/PatchMatch-based fill is future work. |

## Platform notes

- The editor is a **client-only** app; storage (autosave/recovery) uses IndexedDB and sessionStorage. Browsers in strict private modes may deny persistence — autosave then no-ops gracefully.
- Offline support (PWA service worker) requires a production build served over HTTPS (or localhost, where registration is intentionally skipped).
- **Renderer preference (Preferences → Renderer):** `Auto` uses a WebGPU *display* path (the composed document is presented as a GPU quad; compositing itself stays Canvas2D) whenever the browser exposes `navigator.gpu` and initialization succeeds. Headless browsers, Safari < 26 / older Firefox, and any init or device-loss failure silently use Canvas 2D instead — output pixels are identical, only the blit differs. The status bar shows the renderer actually in use.
