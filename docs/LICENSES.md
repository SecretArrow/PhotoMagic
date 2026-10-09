# Licenses

## Application license

PixelForge Studio is released under the **MIT License** — see the [`LICENSE`](../LICENSE) file at the repository root.

> Copyright (c) PixelForge Studio contributors. Permission is hereby granted, free of charge, to any person obtaining a copy of this software to deal in the software without restriction, subject to the standard MIT conditions (include the copyright notice and permission notice in all copies or substantial portions of the software). THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

## Dependency license summary

| Package          | License | Role in PixelForge Studio                        |
| ---------------- | ------- | ------------------------------------------------ |
| next             | MIT     | App framework (App Router, build tooling)        |
| react            | MIT     | UI runtime                                       |
| zustand          | MIT     | Editor state management                          |
| tailwindcss      | MIT     | Styling (utility CSS)                            |
| shadcn/ui        | MIT     | UI component primitives (copied-in components)   |
| lucide-react     | ISC     | Interface icon set                               |
| vitest           | MIT     | Unit test runner                                 |
| sharp            | ISC     | App icon generation (`scripts/gen-icons.mjs`)    |

All licenses above are permissive and compatible with redistribution under the project MIT license, provided their copyright and license notices are preserved per their terms.

### Before redistributing

Run a license audit on the exact tree you ship (dependency sets change between versions):

```bash
bun pm ls                      # resolved dependency tree
bunx license-checker --summary # or your preferred audit tool
```

## Bundled content

- **No proprietary codecs** are bundled. Image decode/encode uses the browser's own PNG/JPEG/WebP/GIF/BMP/SVG codecs.
- **No proprietary assets** (fonts, stock imagery, sampled sounds) are included; the app icon and UI art are original, generated from source in this repository (`public/icons/icon.svg` via `scripts/gen-icons.mjs`).
- lucide-react icons are ISC-licensed interface icons used as a runtime dependency, not copied assets.
