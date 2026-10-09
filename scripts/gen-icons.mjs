#!/usr/bin/env node
/**
 * PixelForge Studio — app icon generator.
 *
 * Standalone Node script (uses the existing `sharp` dependency):
 *   node scripts/gen-icons.mjs
 *
 * Renders `public/icons/icon.svg` — a rounded square with a subtle vertical
 * gradient (#1d5c3f → #58c08a) and a white geometric "forge/spark" glyph
 * (bold four-point spark, no text, no trademark) — then exports:
 *   - public/icons/icon-192.png           (app icon)
 *   - public/icons/icon-512.png           (app icon)
 *   - public/icons/icon-maskable-512.png  (same art, glyph shrunk into a 10% safe zone)
 *
 * `public/favicon.ico` is intentionally NOT generated.
 */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICON_DIR = path.join(ROOT, 'public', 'icons');
const BASE_SIZE = 512;

/** Four-point spark polygon centered at (cx, cy). */
function sparkPoints(cx, cy, radius, innerRatio) {
  const inner = radius * innerRatio;
  const d = inner * Math.SQRT1_2; // inner points sit on the 45° diagonals
  return [
    [cx, cy - radius], // N
    [cx + d, cy - d], // NE (inner)
    [cx + radius, cy], // E
    [cx + d, cy + d], // SE (inner)
    [cx, cy + radius], // S
    [cx - d, cy + d], // SW (inner)
    [cx - radius, cy], // W
    [cx - d, cy - d], // NW (inner)
  ]
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
}

/** Small secondary spark (offset companion, like a flying ember). */
function smallSparkPoints(cx, cy, radius, innerRatio) {
  return sparkPoints(cx, cy, radius, innerRatio);
}

/**
 * Builds the icon SVG.
 * @param {object} opts
 * @param {number} [opts.size]         canvas size in px
 * @param {number} [opts.glyphScale]   glyph scale relative to the default (safe-zone shrink)
 * @param {number} [opts.cornerRadius] rounded-square corner radius
 */
function iconSvg({ size = BASE_SIZE, glyphScale = 1, cornerRadius = Math.round(size * 0.18) } = {}) {
  const s = size;
  const c = s / 2;
  const mainR = s * 0.3 * glyphScale; // bold primary spark
  const miniR = s * 0.09 * glyphScale; // secondary ember, top-right
  const miniCx = c + s * 0.21 * glyphScale;
  const miniCy = c - s * 0.21 * glyphScale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="pf-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1d5c3f"/>
      <stop offset="1" stop-color="#58c08a"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${s}" height="${s}" rx="${cornerRadius}" ry="${cornerRadius}" fill="url(#pf-bg)"/>
  <polygon points="${sparkPoints(c, c + s * 0.01, mainR, 0.34)}" fill="#ffffff"/>
  <polygon points="${smallSparkPoints(miniCx, miniCy, miniR, 0.34)}" fill="#ffffff" opacity="0.92"/>
</svg>\n`;
}

async function main() {
  await mkdir(ICON_DIR, { recursive: true });

  const appSvg = iconSvg(); // rounded-square art
  const maskableSvg = iconSvg({
    // full-bleed background; glyph pulled into the central 80% (10% safe zone)
    glyphScale: 0.8,
    cornerRadius: 0,
  });

  await writeFile(path.join(ICON_DIR, 'icon.svg'), appSvg, 'utf8');
  console.log(`wrote ${path.relative(ROOT, path.join(ICON_DIR, 'icon.svg'))}`);

  const appBuffer = Buffer.from(appSvg);
  const maskableBuffer = Buffer.from(maskableSvg);

  await sharp(appBuffer).resize(192, 192).png().toFile(path.join(ICON_DIR, 'icon-192.png'));
  console.log(`wrote ${path.relative(ROOT, path.join(ICON_DIR, 'icon-192.png'))}`);

  await sharp(appBuffer).resize(512, 512).png().toFile(path.join(ICON_DIR, 'icon-512.png'));
  console.log(`wrote ${path.relative(ROOT, path.join(ICON_DIR, 'icon-512.png'))}`);

  await sharp(maskableBuffer).resize(512, 512).png().toFile(path.join(ICON_DIR, 'icon-maskable-512.png'));
  console.log(`wrote ${path.relative(ROOT, path.join(ICON_DIR, 'icon-maskable-512.png'))}`);

  for (const name of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
    const info = await stat(path.join(ICON_DIR, name));
    if (!info.isFile() || info.size === 0) throw new Error(`missing or empty: ${name}`);
    console.log(`verified ${name} (${info.size} bytes)`);
  }
}

main().catch((err) => {
  console.error('icon generation failed:', err);
  process.exitCode = 1;
});
