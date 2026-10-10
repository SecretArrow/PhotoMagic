/**
 * Unit tests — PSD import (src/formats/psdImport).
 *
 * Node environment (no DOM/canvas): reuses the FakeCanvas/FakeContext2D shim
 * pattern proven in psd.test.ts (stubbed document.createElement) so both the
 * PSD writer and the reader run without a browser. Three strategies:
 *  A. writer roundtrip — exportPsd → importPsd → pixel-exact layer assertion
 *  B. synthetic bytes — a hand-built minimal 2×1 RGB PSD parsed field by field
 *  C. honest rejection — truncated/unsupported files throw typed errors
 * plus PackBits decoder KATs (moved from the writer's reference decoder).
 */

import { describe, expect, it, vi } from 'vitest';
import { exportPsd, packBits } from '../../src/formats/psd';
import {
  PsdImportError,
  decodePackBits,
  importPsd,
  isPsdFile,
  type ImportedLayer,
} from '../../src/formats/psdImport';
import { createDocument, createGroupLayer, createRasterLayer } from '../../src/engine/document';
import { ctx2d, makeCanvas, type AnyCanvas } from '../../src/engine/raster';
import type { DocumentState, RasterLayer } from '../../src/engine/types';

/* ------------------------------------------------------------------ */
/* canvas shim (node has no canvas — stub document.createElement)      */
/* ------------------------------------------------------------------ */

class FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.data = new Uint8ClampedArray(Math.max(0, width) * Math.max(0, height) * 4);
    this.width = width;
    this.height = height;
  }
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Minimal CSS color parser for the fill styles used by the engine. */
function parseColor(style: string): Rgba {
  const hex = style.startsWith('#') ? style.slice(1) : '';
  if (hex.length === 3 || hex.length === 4) {
    const channels = hex.split('').map((c) => parseInt(c + c, 16));
    return {
      r: channels[0] ?? 0,
      g: channels[1] ?? 0,
      b: channels[2] ?? 0,
      a: channels.length === 4 ? (channels[3] ?? 255) : 255,
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255,
    };
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(style.replace(/\s+/g, ''));
  if (rgba) {
    const parts = rgba[1].split(',').map(Number);
    return {
      r: parts[0] ?? 0,
      g: parts[1] ?? 0,
      b: parts[2] ?? 0,
      a: Math.round((parts.length === 4 ? (parts[3] ?? 1) : 1) * 255),
    };
  }
  return { r: 0, g: 0, b: 0, a: 255 };
}

class FakeCanvas {
  private _width: number;
  private _height: number;
  private _data: Uint8ClampedArray;
  private _ctx: FakeContext2D | null = null;

  constructor(width = 0, height = 0) {
    this._width = width;
    this._height = height;
    this._data = new Uint8ClampedArray(width * height * 4);
  }

  get width(): number {
    return this._width;
  }
  set width(value: number) {
    this.resize(value, this._height);
  }
  get height(): number {
    return this._height;
  }
  set height(value: number) {
    this.resize(this._width, value);
  }
  get data(): Uint8ClampedArray {
    return this._data;
  }

  /** A real canvas clears its bitmap when resized. */
  resize(width: number, height: number): void {
    if (width === this._width && height === this._height) return;
    this._width = width;
    this._height = height;
    this._data = new Uint8ClampedArray(width * height * 4);
  }

  getContext(_type?: string, _options?: unknown): FakeContext2D | null {
    if (!this._ctx) this._ctx = new FakeContext2D(this);
    return this._ctx;
  }
}

class FakeContext2D {
  canvas: FakeCanvas;
  fillStyle = '#000000';
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation | 'clear' = 'source-over';
  imageSmoothingEnabled = true;
  imageSmoothingQuality: ImageSmoothingQuality = 'low';

  constructor(canvas: FakeCanvas) {
    this.canvas = canvas;
  }

  save(): void {}
  restore(): void {}
  beginPath(): void {}
  rect(): void {}
  clip(): void {}

  private pixelOffset(x: number, y: number): number {
    const { width, height } = this.canvas;
    if (x < 0 || y < 0 || x >= width || y >= height) return -1;
    return (y * width + x) * 4;
  }

  private paintPixel(x: number, y: number, r: number, g: number, b: number, a: number): void {
    const o = this.pixelOffset(x, y);
    if (o < 0) return;
    // putImageData-equivalent paths are exact; blend modes are irrelevant here
    // because the import tests never composite through this shim.
    const data = this.canvas.data;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = Math.round(a * 255);
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) {
        const o = this.pixelOffset(xx, yy);
        if (o < 0) continue;
        const data = this.canvas.data;
        data[o] = 0;
        data[o + 1] = 0;
        data[o + 2] = 0;
        data[o + 3] = 0;
      }
    }
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const { r, g, b, a } = parseColor(this.fillStyle);
    const alpha = (a / 255) * this.globalAlpha;
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) {
        this.paintPixel(xx, yy, r, g, b, alpha);
      }
    }
  }

  drawImage(source: FakeCanvas, dx: number, dy: number, dw?: number, dh?: number): void {
    const sw = source.width;
    const sh = source.height;
    if (sw < 1 || sh < 1) return;
    const destW = dw ?? sw;
    const destH = dh ?? sh;
    const src = source.data;
    for (let y = 0; y < destH; y += 1) {
      const sy = Math.min(sh - 1, Math.floor((y * sh) / destH));
      for (let x = 0; x < destW; x += 1) {
        const sx = Math.min(sw - 1, Math.floor((x * sw) / destW));
        const so = (sy * sw + sx) * 4;
        this.paintPixel(
          dx + x,
          dy + y,
          src[so],
          src[so + 1],
          src[so + 2],
          (src[so + 3] / 255) * this.globalAlpha,
        );
      }
    }
  }

  createImageData(width: number, height: number): ImageData {
    return new FakeImageData(width, height) as unknown as ImageData;
  }

  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData {
    const img = new FakeImageData(sw, sh) as unknown as ImageData & { data: Uint8ClampedArray };
    const data = this.canvas.data;
    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        const so = this.pixelOffset(sx + x, sy + y);
        if (so < 0) continue;
        const o = (y * sw + x) * 4;
        img.data[o] = data[so];
        img.data[o + 1] = data[so + 1];
        img.data[o + 2] = data[so + 2];
        img.data[o + 3] = data[so + 3];
      }
    }
    return img;
  }

  putImageData(img: ImageData, dx: number, dy: number): void {
    const data = this.canvas.data;
    const src = img.data;
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) {
        const o = this.pixelOffset(dx + x, dy + y);
        if (o < 0) continue;
        const so = (y * img.width + x) * 4;
        data[o] = src[so];
        data[o + 1] = src[so + 1];
        data[o + 2] = src[so + 2];
        data[o + 3] = src[so + 3];
      }
    }
  }
}

vi.stubGlobal('document', {
  createElement: (tag: string) => (tag === 'canvas' ? new FakeCanvas() : {}),
});

/* ------------------------------------------------------------------ */
/* document helpers (mirrors psd.test.ts)                              */
/* ------------------------------------------------------------------ */

/** Empty doc with no layers and a transparent background. */
function blankDoc(width: number, height: number): DocumentState {
  const doc = createDocument({ width, height, background: 'transparent', withBackgroundLayer: false });
  doc.layers = [];
  return doc;
}

/** Opaque/semi-transparent solid raster layer at the given offset. */
function solidRasterLayer(
  name: string,
  width: number,
  height: number,
  rgba: [number, number, number, number],
  x = 0,
  y = 0,
): RasterLayer {
  const canvas = makeCanvas(width, height);
  const ctx = ctx2d(canvas);
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = rgba[0];
    img.data[i + 1] = rgba[1];
    img.data[i + 2] = rgba[2];
    img.data[i + 3] = rgba[3];
  }
  ctx.putImageData(img, 0, 0);
  const layer = createRasterLayer(name, width, height, canvas);
  layer.x = x;
  layer.y = y;
  return layer;
}

async function exportBytes(doc: DocumentState): Promise<Uint8Array<ArrayBuffer>> {
  const blob = await exportPsd(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

/** Asserts two canvases carry identical RGBA pixels. */
function expectSamePixels(actual: AnyCanvas, expected: AnyCanvas): void {
  expect(actual.width).toBe(expected.width);
  expect(actual.height).toBe(expected.height);
  const a = ctx2d(actual).getImageData(0, 0, actual.width, actual.height);
  const b = ctx2d(expected).getImageData(0, 0, expected.width, expected.height);
  expect(Array.from(a.data)).toEqual(Array.from(b.data));
}

/* ------------------------------------------------------------------ */
/* synthetic PSD builder (strategy B)                                  */
/* ------------------------------------------------------------------ */

/** Tiny big-endian byte buffer for hand-building PSD files. */
class ByteBuf {
  private buf: number[] = [];

  get length(): number {
    return this.buf.length;
  }

  u8(v: number): this {
    this.buf.push(v & 0xff);
    return this;
  }

  u16(v: number): this {
    return this.u8(v >> 8).u8(v);
  }

  i16(v: number): this {
    return this.u16(v & 0xffff);
  }

  u32(v: number): this {
    return this.u8(v >>> 24).u8((v >>> 16) & 0xff).u8((v >>> 8) & 0xff).u8(v);
  }

  i32(v: number): this {
    return this.u32(v >>> 0); // negative values wrap to two's complement
  }

  ascii(s: string): this {
    for (let i = 0; i < s.length; i += 1) this.u8(s.charCodeAt(i));
    return this;
  }

  raw(bytes: ArrayLike<number>): this {
    for (let i = 0; i < bytes.length; i += 1) this.u8(bytes[i]);
    return this;
  }

  finish(): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(this.buf) as Uint8Array<ArrayBuffer>;
  }
}

interface SynthOptions {
  width?: number;
  height?: number;
  /** header/composite channel count (3 = no alpha plane) */
  compositeChannels?: number;
  /** layer channel ids; null = no layer & mask section at all */
  layerChannels?: number[] | null;
  /** channel id → raw plane bytes (defaults below) */
  layerPlanes?: Record<number, number[]>;
  blendKey?: string;
  opacity?: number;
  flags?: number;
  nameBytes?: number[];
  /** composite plane bytes per channel (defaults below) */
  compositePlanes?: number[][];
}

const DEFAULT_LAYER_PLANES: Record<number, number[]> = {
  0: [0x10, 0x20], // R
  1: [0x30, 0x40], // G
  2: [0x50, 0x60], // B
  [-1]: [0xff, 0x80], // A
};

const DEFAULT_COMPOSITE_PLANES = [
  [1, 2], // R
  [3, 4], // G
  [5, 6], // B
  [255, 255], // A
];

/** Builds a minimal 2×1 (by default) RGB 8-bit PSD with raw channel data. */
function buildSyntheticPsd(opts: SynthOptions = {}): Uint8Array<ArrayBuffer> {
  const width = opts.width ?? 2;
  const height = opts.height ?? 1;
  const compositeChannels = opts.compositeChannels ?? 4;
  const layerChannels = opts.layerChannels === undefined ? [0, 1, 2, -1] : opts.layerChannels;
  const nameBytes = opts.nameBytes ?? [0x41]; // 'A'
  const blendKey = opts.blendKey ?? 'mul ';
  const opacity = opts.opacity ?? 128;
  const flags = opts.flags ?? 0;
  const planeSize = width * height;

  const out = new ByteBuf();
  // a. header
  out.ascii('8BPS').u16(1).u16(0).u16(0).u16(0); // version + 6 reserved bytes
  out.u16(compositeChannels).u32(height).u32(width).u16(8).u16(3);
  // b. color mode data + c. image resources: empty
  out.u32(0).u32(0);

  if (layerChannels !== null) {
    // d. layer & mask information section (one record, raw channel data)
    const pascal = Math.max(4, Math.ceil((1 + nameBytes.length) / 4) * 4);
    let extraLength = 8 + pascal;
    if (extraLength % 2 !== 0) extraLength += 1; // keep the record even (base is always even)
    // rect 16 + count 2 + 6/channel + sig 4 + blend 4 + opacity/clip/flags/filler 4 + extraLen 4
    const recordLength = 34 + 6 * layerChannels.length + extraLength;
    const channelBlock = 2 + planeSize; // compression u16 + raw plane
    const layerInfoLength =
      2 + recordLength + layerChannels.length * channelBlock;
    const layerInfoPad = layerInfoLength % 2;
    out.u32(layerInfoLength + layerInfoPad + 8); // section length
    out.u32(layerInfoLength + layerInfoPad); // layer info length
    out.i16(1); // one layer record
    out.i32(0).i32(0).i32(height).i32(width); // top/left/bottom/right
    out.u16(layerChannels.length);
    for (const id of layerChannels) out.i16(id).u32(channelBlock);
    out.ascii('8BIM').ascii(blendKey);
    out.u8(opacity).u8(0).u8(flags).u8(0);
    // extra data: mask length + blending ranges + pascal name (+ padding)
    const extra = new ByteBuf();
    extra.u32(0).u32(0).u8(nameBytes.length).raw(nameBytes);
    while (extra.length < extraLength) extra.u8(0);
    out.u32(extraLength).raw(extra.finish());
    // channel data blocks, grouped per layer
    for (const id of layerChannels) {
      const plane = opts.layerPlanes?.[id] ?? DEFAULT_LAYER_PLANES[id] ?? new Array(planeSize).fill(0);
      out.u16(0).raw(plane.slice(0, planeSize));
    }
    for (let i = 0; i < layerInfoPad; i += 1) out.u8(0);
    // d2. global layer mask info: empty
    out.u32(0);
  } else {
    // no layer & mask section at all
    out.u32(0);
  }

  // e. image data section (raw flattened composite)
  out.u16(0);
  for (let p = 0; p < compositeChannels; p += 1) {
    const plane = opts.compositePlanes?.[p] ?? DEFAULT_COMPOSITE_PLANES[p] ?? new Array(planeSize).fill(0);
    out.raw(plane.slice(0, planeSize));
  }
  return out.finish();
}

/* ------------------------------------------------------------------ */
/* multi-record synthetic PSD builder (groups / malformed nesting)      */
/* ------------------------------------------------------------------ */

interface SynthChannel {
  id: number;
  /** raw plane bytes after the compression tag; null = zero-length info */
  data?: number[] | null;
}

interface SynthRecord {
  name?: string;
  flags?: number;
  opacity?: number;
  blendKey?: string;
  /** 'lsct' divider type (0/undefined = plain layer) */
  sectionType?: number;
  /** [top, left, bottom, right]; defaults to the full canvas for leaves */
  rect?: [number, number, number, number];
  /** defaults to R/G/B/A raw planes for leaves, none for dividers */
  channels?: SynthChannel[];
  /** 'luni' Unicode name block (preferred by the reader over the pascal name) */
  luni?: string | null;
}

/**
 * Builds a PSD with an arbitrary number of layer records (raw channel data,
 * transparent raw composite) for group-nesting tests.
 */
function buildMultiRecordPsd(
  records: SynthRecord[],
  opts: { width?: number; height?: number } = {},
): Uint8Array<ArrayBuffer> {
  const width = opts.width ?? 4;
  const height = opts.height ?? 2;

  const recordBufs: ByteBuf[] = [];
  const channelBufs: ByteBuf[] = [];
  for (const rec of records) {
    const rect = rec.rect ?? [0, 0, height, width];
    const rectW = rect[3] - rect[1];
    const rectH = rect[2] - rect[0];
    const planeSize = Math.max(0, rectW * rectH);
    const channels =
      rec.channels ??
      (rec.sectionType
        ? []
        : [
            { id: 0, data: new Array(planeSize).fill(0x11) },
            { id: 1, data: new Array(planeSize).fill(0x22) },
            { id: 2, data: new Array(planeSize).fill(0x33) },
            { id: -1, data: new Array(planeSize).fill(0xff) },
          ]);
    const nameBytes = Array.from(rec.name ?? 'Layer', (c) => c.charCodeAt(0) & 0xff);

    const record = new ByteBuf();
    record.i32(rect[0]).i32(rect[1]).i32(rect[2]).i32(rect[3]);
    record.u16(channels.length);
    const channelData = new ByteBuf();
    for (const channel of channels) {
      if (channel.data) {
        record.i16(channel.id).u32(2 + channel.data.length);
        channelData.u16(0).raw(channel.data); // compression 0 = raw
      } else {
        record.i16(channel.id).u32(0); // zero-length channel info (divider style)
      }
    }
    record.ascii('8BIM').ascii(rec.blendKey ?? 'norm');
    record.u8(rec.opacity ?? 255).u8(0).u8(rec.flags ?? 0).u8(0);

    const extra = new ByteBuf();
    extra.u32(0).u32(0); // mask + blending ranges
    extra.u8(nameBytes.length).raw(nameBytes);
    const pascal = Math.max(4, Math.ceil((1 + nameBytes.length) / 4) * 4);
    while (extra.length < 8 + pascal) extra.u8(0);
    if (rec.sectionType) {
      extra.ascii('8BIM').ascii('lsct').u32(8).u32(rec.sectionType).u32(0);
    }
    if (rec.luni !== undefined && rec.luni !== null) {
      const units = Array.from(rec.luni, (c) => c.codePointAt(0) ?? 0x3f);
      extra.ascii('8BIM').ascii('luni').u32(4 + units.length * 2).u32(units.length);
      for (const unit of units) extra.u16(unit);
    }
    if (extra.length % 2 !== 0) extra.u8(0);
    record.u32(extra.length).raw(extra.finish());

    recordBufs.push(record);
    channelBufs.push(channelData);
  }

  const recordsTotal = recordBufs.reduce((a, b) => a + b.length, 0);
  const channelsTotal = channelBufs.reduce((a, b) => a + b.length, 0);
  const rawInfo = 2 + recordsTotal + channelsTotal;
  const pad = rawInfo % 2;

  const out = new ByteBuf();
  out.ascii('8BPS').u16(1).u16(0).u16(0).u16(0);
  out.u16(4).u32(height).u32(width).u16(8).u16(3);
  out.u32(0).u32(0); // color mode + resources
  out.u32(rawInfo + pad + 8); // layer & mask section length
  out.u32(rawInfo + pad); // layer info length
  out.i16(records.length);
  for (const buf of recordBufs) out.raw(buf.finish());
  for (const buf of channelBufs) out.raw(buf.finish());
  for (let i = 0; i < pad; i += 1) out.u8(0);
  out.u32(0); // global mask info

  out.u16(0); // composite: raw, transparent
  for (let p = 0; p < 4; p += 1) out.raw(new Array(width * height).fill(0));
  return out.finish();
}

/* ------------------------------------------------------------------ */
/* strategy A — writer → reader roundtrip                              */
/* ------------------------------------------------------------------ */

describe('PSD import — writer roundtrip', () => {
  it('imports layered export pixel-exactly (order, names, flags, blend, opacity, offsets)', async () => {
    const doc = blankDoc(6, 5);
    const base = solidRasterLayer('Base', 6, 5, [255, 255, 255, 255]);
    const mid = solidRasterLayer('Mid', 2, 3, [0, 0, 255, 255], 1, 0);
    mid.blendMode = 'multiply';
    mid.opacity = 0.5;
    const top = solidRasterLayer('Café', 2, 2, [0, 255, 0, 128], 2, 1);
    top.blendMode = 'screen';
    top.visible = false;
    doc.layers.push(base, mid, top); // bottom → top

    const bytes = await exportBytes(doc);
    const result = await importPsd(new File([bytes], 'Roundtrip.psd'));

    expect(result.name).toBe('Roundtrip');
    expect(result.width).toBe(6);
    expect(result.height).toBe(5);
    expect(result.usedComposite).toBe(false);
    // PSD stores records top-first
    expect(result.layers.map((l) => l.name)).toEqual(['Café', 'Mid', 'Base']);

    const [importedTop, importedMid, importedBase] = result.layers;

    expect(importedTop.visible).toBe(false);
    expect(importedTop.blend).toBe('screen');
    expect(importedTop.opacity).toBe(1);
    expect([importedTop.x, importedTop.y, importedTop.width, importedTop.height]).toEqual([2, 1, 2, 2]);
    expectSamePixels(importedTop.canvas, top.canvas as HTMLCanvasElement);

    expect(importedMid.visible).toBe(true);
    expect(importedMid.blend).toBe('multiply');
    expect(Math.round(importedMid.opacity * 255)).toBe(128); // 0.5 × 255 rounded
    expect([importedMid.x, importedMid.y, importedMid.width, importedMid.height]).toEqual([1, 0, 2, 3]);
    expectSamePixels(importedMid.canvas, mid.canvas as HTMLCanvasElement);

    expect(importedBase.visible).toBe(true);
    expect(importedBase.blend).toBe('normal');
    expect(importedBase.opacity).toBe(1);
    expect([importedBase.x, importedBase.y, importedBase.width, importedBase.height]).toEqual([0, 0, 6, 5]);
    expectSamePixels(importedBase.canvas, base.canvas as HTMLCanvasElement);
  });

  it('accepts a raw ArrayBuffer (name falls back to Untitled)', async () => {
    const doc = blankDoc(2, 1);
    doc.layers.push(solidRasterLayer('L', 2, 1, [9, 8, 7, 255]));
    const bytes = await exportBytes(doc);
    const result = await importPsd(bytes.buffer);
    expect(result.name).toBe('Untitled');
    expect(result.width).toBe(2);
    expect(result.height).toBe(1);
    expect(result.layers).toHaveLength(1);
  });

  it('falls back to the flattened composite for zero-layer files', async () => {
    const bytes = await exportBytes(blankDoc(2, 2));
    const result = await importPsd(new File([bytes], 'flat.psd'));
    expect(result.usedComposite).toBe(true);
    expect(result.layers).toHaveLength(1);
    const [background] = result.layers;
    expect(background.name).toBe('Background');
    expect([background.x, background.y, background.width, background.height]).toEqual([0, 0, 2, 2]);
    expect(background.visible).toBe(true);
    expect(background.opacity).toBe(1);
    expect(background.blend).toBe('normal');
    const img = ctx2d(background.canvas).getImageData(0, 0, 2, 2);
    expect(Array.from(img.data)).toEqual(new Array(16).fill(0)); // transparent composite
  });
});

/* ------------------------------------------------------------------ */
/* layer groups — tree roundtrip                                       */
/* ------------------------------------------------------------------ */

describe('PSD import — layer groups', () => {
  it('round-trips a grouped document (tree shape, names, expanded flags, pixels, offsets)', async () => {
    const doc = blankDoc(8, 6);
    const solo = solidRasterLayer('Solo', 3, 2, [255, 255, 0, 255], 5, 3);
    const hidden = solidRasterLayer('H', 2, 2, [255, 0, 0, 255], 0, 0);
    hidden.visible = false;
    const visible = solidRasterLayer('V', 3, 3, [0, 255, 0, 255], 2, 1);
    const deep = solidRasterLayer('Deep', 2, 1, [0, 0, 255, 255], 4, 4);
    const inner = createGroupLayer('Inner', [deep]);
    inner.expanded = false;
    const outer = createGroupLayer('Outer', [hidden, visible, inner]);
    doc.layers.push(solo, outer); // bottom → top

    const bytes = await exportBytes(doc);
    const result = await importPsd(new File([bytes], 'Groups.psd'));

    expect(result.usedComposite).toBe(false);
    expect(result.width).toBe(8);
    expect(result.height).toBe(6);
    // PSD file order is top-first: the outer group precedes the top-level leaf
    expect(result.layers.map((l) => l.name)).toEqual(['Outer', 'Solo']);

    const [outerL, soloL] = result.layers as [ImportedLayer, ImportedLayer];
    expect(outerL.isGroup).toBe(true);
    expect(outerL.expanded).toBe(true);
    expect(outerL.visible).toBe(true);
    expect(outerL.opacity).toBe(1);
    expect(outerL.blend).toBe('normal');
    expect(outerL.children!.map((c) => c.name)).toEqual(['Inner', 'V', 'H']);

    const [innerL, vL, hL] = outerL.children!;
    expect(innerL.isGroup).toBe(true);
    expect(innerL.expanded).toBe(false);
    expect(innerL.children!.map((c) => c.name)).toEqual(['Deep']);

    const deepL = innerL.children![0];
    expect(deepL.isGroup).toBeFalsy();
    expect([deepL.x, deepL.y, deepL.width, deepL.height]).toEqual([4, 4, 2, 1]);
    expectSamePixels(deepL.canvas, deep.canvas as HTMLCanvasElement);

    expect(vL.isGroup).toBeFalsy();
    expect(vL.visible).toBe(true);
    expect([vL.x, vL.y, vL.width, vL.height]).toEqual([2, 1, 3, 3]);
    expectSamePixels(vL.canvas, visible.canvas as HTMLCanvasElement);

    expect(hL.isGroup).toBeFalsy();
    expect(hL.visible).toBe(false);
    expectSamePixels(hL.canvas, hidden.canvas as HTMLCanvasElement);

    expect(soloL.isGroup).toBeFalsy();
    expect(soloL.expanded).toBeUndefined();
    expect([soloL.x, soloL.y, soloL.width, soloL.height]).toEqual([5, 3, 3, 2]);
    expectSamePixels(soloL.canvas, solo.canvas as HTMLCanvasElement);
  });

  it('preserves group blend, opacity, visibility and collapsed state', async () => {
    const doc = blankDoc(4, 4);
    const child = solidRasterLayer('C', 1, 1, [1, 2, 3, 255]);
    const group = createGroupLayer('G', [child]);
    group.expanded = false;
    group.blendMode = 'screen';
    group.opacity = 0.5;
    group.visible = false;
    doc.layers.push(group);

    const bytes = await exportBytes(doc);
    const result = await importPsd(bytes.buffer);
    expect(result.layers).toHaveLength(1);
    const [imported] = result.layers;
    expect(imported.isGroup).toBe(true);
    expect(imported.name).toBe('G');
    expect(imported.expanded).toBe(false);
    expect(imported.blend).toBe('screen');
    expect(Math.round(imported.opacity * 255)).toBe(128); // 0.5 × 255 rounded
    expect(imported.visible).toBe(false);
    expect(imported.children).toHaveLength(1);
    expect(imported.children![0].name).toBe('C');
  });

  it('imports an empty group as a childless group layer', async () => {
    const doc = blankDoc(2, 2);
    doc.layers.push(createGroupLayer('Empty'));
    const bytes = await exportBytes(doc);
    const result = await importPsd(bytes.buffer);
    expect(result.usedComposite).toBe(false);
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].isGroup).toBe(true);
    expect(result.layers[0].name).toBe('Empty');
    expect(result.layers[0].children).toEqual([]);
  });

  it('round-trips non-Latin-1 group and layer names via luni', async () => {
    const doc = blankDoc(3, 2);
    const leaf = solidRasterLayer('図形', 2, 1, [7, 7, 7, 255], 1, 1);
    doc.layers.push(createGroupLayer('группа', [leaf]));
    const bytes = await exportBytes(doc);
    const result = await importPsd(bytes.buffer);
    expect(result.layers[0].name).toBe('группа');
    expect(result.layers[0].children![0].name).toBe('図形');
  });

  it('parses hand-built Photoshop-style dividers with zero-length channel info', async () => {
    // Real Photoshop files declare R/G/B/A channel infos with dataLength 0 on
    // divider records — they must not trip the channel-data walker.
    const bytes = buildMultiRecordPsd([
      { name: 'Grp', sectionType: 1, opacity: 200, channels: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: -1 }] },
      { name: 'Leaf', rect: [0, 1, 2, 3], channels: [
        { id: 0, data: [1, 2, 3, 4] },
        { id: 1, data: [5, 6, 7, 8] },
        { id: 2, data: [9, 10, 11, 12] },
        { id: -1, data: [255, 255, 255, 128] },
      ] },
      { name: '</Layer set>', sectionType: 3, flags: 2 },
    ]);
    const result = await importPsd(new File([bytes], 'psd-dividers.psd'));
    expect(result.usedComposite).toBe(false);
    expect(result.layers).toHaveLength(1);
    const [group] = result.layers;
    expect(group.isGroup).toBe(true);
    expect(group.name).toBe('Grp');
    expect(Math.round(group.opacity * 255)).toBe(200);
    expect(group.children).toHaveLength(1);
    const [leaf] = group.children!;
    expect(leaf.name).toBe('Leaf');
    expect([leaf.x, leaf.y, leaf.width, leaf.height]).toEqual([1, 0, 2, 2]);
    const img = ctx2d(leaf.canvas).getImageData(0, 0, 2, 2);
    expect(Array.from(img.data)).toEqual([
      1, 5, 9, 255, 2, 6, 10, 255,
      3, 7, 11, 255, 4, 8, 12, 128,
    ]);
  });

  it('handles nested groups and keeps children in PSD (top-first) order', async () => {
    const bytes = buildMultiRecordPsd([
      { name: 'A', sectionType: 1 },
      { name: 'B', sectionType: 2 },
      { name: 'leaf-in-B' },
      { name: '</Layer set>', sectionType: 3, flags: 2 },
      { name: 'leaf-in-A' },
      { name: '</Layer set>', sectionType: 3, flags: 2 },
    ]);
    const result = await importPsd(bytes.buffer);
    expect(result.layers.map((l) => l.name)).toEqual(['A']);
    const [a] = result.layers;
    expect(a.isGroup).toBe(true);
    expect(a.expanded).toBe(true);
    expect(a.children!.map((l) => l.name)).toEqual(['B', 'leaf-in-A']);
    expect(a.children![0].isGroup).toBe(true);
    expect(a.children![0].expanded).toBe(false);
    expect(a.children![0].children!.map((l) => l.name)).toEqual(['leaf-in-B']);
  });

  it('auto-closes unterminated groups at the end of the record list', async () => {
    const bytes = buildMultiRecordPsd([
      { name: 'Open', sectionType: 1 },
      { name: 'L' },
      { name: 'L2' },
    ]);
    const result = await importPsd(bytes.buffer);
    expect(result.usedComposite).toBe(false);
    expect(result.layers).toHaveLength(1);
    const [group] = result.layers;
    expect(group.isGroup).toBe(true);
    expect(group.children!.map((l) => l.name)).toEqual(['L', 'L2']);
  });

  it('ignores stray bounding dividers without an open group', async () => {
    const bytes = buildMultiRecordPsd([
      { name: 'L' },
      { name: '</Layer set>', sectionType: 3, flags: 2 },
    ]);
    const result = await importPsd(bytes.buffer);
    expect(result.usedComposite).toBe(false);
    expect(result.layers.map((l) => l.name)).toEqual(['L']);
  });

  it('falls back to the composite when the only record is a stray bounding divider', async () => {
    const bytes = buildMultiRecordPsd([
      { name: '</Layer set>', sectionType: 3, flags: 2 },
    ]);
    const result = await importPsd(bytes.buffer);
    expect(result.usedComposite).toBe(true);
    expect(result.layers.map((l) => l.name)).toEqual(['Background']);
  });

  it('prefers the luni Unicode name over the pascal name', async () => {
    const bytes = buildMultiRecordPsd([{ name: '?', luni: '認' }]);
    const result = await importPsd(bytes.buffer);
    expect(result.layers[0].name).toBe('認');
  });

  it('keeps the pascal name when luni is empty', async () => {
    const bytes = buildMultiRecordPsd([{ name: 'Pascal', luni: '' }]);
    const result = await importPsd(bytes.buffer);
    expect(result.layers[0].name).toBe('Pascal');
  });
});

/* ------------------------------------------------------------------ */
/* strategy B — synthetic bytes                                        */
/* ------------------------------------------------------------------ */

describe('PSD import — synthetic 2×1 RGB PSD', () => {
  it('parses header, record fields and raw channel planes exactly', async () => {
    const file = new File([buildSyntheticPsd()], 'Synth.psd');
    expect(await isPsdFile(file)).toBe(true);

    const result = await importPsd(file);
    expect(result.name).toBe('Synth');
    expect(result.width).toBe(2);
    expect(result.height).toBe(1);
    expect(result.usedComposite).toBe(false);
    expect(result.layers).toHaveLength(1);

    const [layer] = result.layers;
    expect(layer.name).toBe('A');
    expect([layer.x, layer.y, layer.width, layer.height]).toEqual([0, 0, 2, 1]);
    expect(layer.visible).toBe(true);
    expect(layer.blend).toBe('multiply'); // 'mul '
    expect(layer.opacity).toBeCloseTo(128 / 255, 10);

    const img = ctx2d(layer.canvas).getImageData(0, 0, 2, 1);
    expect(Array.from(img.data)).toEqual([0x10, 0x30, 0x50, 255, 0x20, 0x40, 0x60, 128]);
  });

  it('treats a missing alpha channel as opaque', async () => {
    const result = await importPsd(
      new File(
        [buildSyntheticPsd({ compositeChannels: 3, layerChannels: [0, 1, 2] })],
        'noalpha.psd',
      ),
    );
    expect(result.layers).toHaveLength(1);
    const img = ctx2d(result.layers[0].canvas).getImageData(0, 0, 2, 1);
    expect(Array.from(img.data)).toEqual([0x10, 0x30, 0x50, 255, 0x20, 0x40, 0x60, 255]);
  });

  it('decodes UTF-8 pascal names', async () => {
    const bytes = buildSyntheticPsd({ nameBytes: [0x43, 0x61, 0x66, 0xc3, 0xa9] }); // 'Café' in UTF-8
    const result = await importPsd(new File([bytes], 'utf8.psd'));
    expect(result.layers[0].name).toBe('Café');
  });

  it('falls back to Latin-1 for non-UTF-8 name bytes', async () => {
    const bytes = buildSyntheticPsd({ nameBytes: [0x43, 0x61, 0x66, 0xe9] }); // latin-1 'Café'
    const result = await importPsd(new File([bytes], 'latin1.psd'));
    expect(result.layers[0].name).toBe('Café');
  });

  it('maps unknown blend keys to normal and applies hidden flags', async () => {
    const result = await importPsd(
      new File([buildSyntheticPsd({ blendKey: 'zzz ', flags: 2, opacity: 255 })], 'flags.psd'),
    );
    const [layer] = result.layers;
    expect(layer.blend).toBe('normal');
    expect(layer.visible).toBe(false);
    expect(layer.opacity).toBe(1);
  });

  it('rejects layers that declare unknown channel ids', async () => {
    const bytes = buildSyntheticPsd({ layerChannels: [0, 1, 2, 5] }); // id 5 = spot channel
    await expect(importPsd(new File([bytes], 'spot.psd'))).rejects.toThrow(PsdImportError);
    await expect(importPsd(new File([bytes], 'spot.psd'))).rejects.toThrow('Unsupported channel id 5');
  });

  it('uses the composite section when the layer section is absent', async () => {
    const result = await importPsd(new File([buildSyntheticPsd({ layerChannels: null })], 'flat.psd'));
    expect(result.usedComposite).toBe(true);
    expect(result.layers).toHaveLength(1);
    const [background] = result.layers;
    expect(background.name).toBe('Background');
    expect([background.x, background.y, background.width, background.height]).toEqual([0, 0, 2, 1]);
    const img = ctx2d(background.canvas).getImageData(0, 0, 2, 1);
    expect(Array.from(img.data)).toEqual([1, 3, 5, 255, 2, 4, 6, 255]);
  });
});

/* ------------------------------------------------------------------ */
/* strategy C — honest rejection                                       */
/* ------------------------------------------------------------------ */

describe('PSD import — rejection of unsupported/corrupt files', () => {
  it('rejects files without the 8BPS signature', async () => {
    const bytes = buildSyntheticPsd();
    bytes[0] = 0x58; // 'X'
    await expect(importPsd(bytes.buffer)).rejects.toThrow(PsdImportError);
    await expect(importPsd(bytes.buffer)).rejects.toThrow('not a Photoshop document');
  });

  it('rejects PSB (version 2) files', async () => {
    const bytes = buildSyntheticPsd();
    bytes[5] = 2; // version u16 at offset 4
    await expect(importPsd(bytes.buffer)).rejects.toThrow('PSB');
  });

  it('rejects CMYK color mode', async () => {
    const bytes = buildSyntheticPsd();
    bytes[25] = 4; // color mode u16 at offset 24
    await expect(importPsd(bytes.buffer)).rejects.toThrow('CMYK');
  });

  it('rejects 16-bit depth', async () => {
    const bytes = buildSyntheticPsd();
    bytes[23] = 16; // depth u16 at offset 22
    await expect(importPsd(bytes.buffer)).rejects.toThrow('16-bit');
  });

  it('rejects files too small to hold a header', async () => {
    await expect(importPsd(new Uint8Array(10).buffer)).rejects.toThrow('too small');
  });

  it('rejects truncated section data', async () => {
    const bytes = buildSyntheticPsd().slice(0, 30); // header ok, sections cut off
    await expect(importPsd(bytes.buffer)).rejects.toThrow('truncated or corrupted');
  });

  it('rejects non-PSD files picked by extension only', async () => {
    const notPsd = new File([Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])], 'weird.psd');
    expect(await isPsdFile(notPsd)).toBe(true);
    await expect(importPsd(notPsd)).rejects.toThrow(PsdImportError);
  });

  it('detects PSD files by extension or magic bytes', async () => {
    expect(await isPsdFile(new File([new Uint8Array(0)], 'x.PSD'))).toBe(true);
    expect(
      await isPsdFile(new File([Uint8Array.from([0x38, 0x42, 0x50, 0x53])], 'raw.bin')),
    ).toBe(true);
    expect(await isPsdFile(new File([Uint8Array.from([1, 2, 3, 4])], 'no.txt'))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* PackBits decoder KATs (production decoder)                          */
/* ------------------------------------------------------------------ */

describe('decodePackBits', () => {
  it('decodes repeat runs as signed (1-n) + value', () => {
    expect([...decodePackBits(Uint8Array.from([252, 65]), 5)]).toEqual([65, 65, 65, 65, 65]);
    expect([...decodePackBits(Uint8Array.from([129, 9]), 128)]).toEqual(new Array(128).fill(9));
  });

  it('decodes literals as signed (n-1) + raw bytes', () => {
    expect([...decodePackBits(Uint8Array.from([2, 1, 2, 3]), 3)]).toEqual([1, 2, 3]);
    expect([...decodePackBits(Uint8Array.from([0, 7]), 1)]).toEqual([7]);
  });

  it('decodes mixed literal + repeat + literal sequences', () => {
    expect([...decodePackBits(Uint8Array.from([1, 1, 2, 254, 3, 0, 4]), 6)]).toEqual([1, 2, 3, 3, 3, 4]);
  });

  it('decodes repeat runs split by the encoder at 128', () => {
    expect([...decodePackBits(Uint8Array.from([129, 7, 0, 7]), 129)]).toEqual(new Array(129).fill(7));
  });

  it('round-trips packBits output losslessly on pseudo-random, run-heavy and pathological data', () => {
    let seed = 0x2f6e2b1;
    const mixed = new Uint8Array(2048);
    for (let i = 0; i < 1024; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      mixed[i] = (seed >>> 16) & 0xff;
    }
    mixed.fill(200, 1024, 1536); // long repeat run
    for (let i = 1536; i < 2048; i += 4) {
      mixed[i] = 10;
      mixed[i + 1] = 10;
      mixed[i + 2] = 20;
      mixed[i + 3] = 20; // pairs (minimum repeat length)
    }
    expect(decodePackBits(packBits(mixed), mixed.length)).toEqual(mixed);

    // pathological alternating single/repeat pattern
    const spike = new Uint8Array(300);
    for (let i = 0; i < 300; i += 3) {
      spike[i] = 1;
      spike[i + 1] = 2;
      spike[i + 2] = 2;
    }
    expect(decodePackBits(packBits(spike), spike.length)).toEqual(spike);
  });

  it('throws PsdImportError on truncated or mismatched RLE data', () => {
    expect(() => decodePackBits(Uint8Array.from([5, 1, 2]), 6)).toThrow(PsdImportError); // literal cut short
    expect(() => decodePackBits(Uint8Array.from([2, 1, 2, 3]), 4)).toThrow(PsdImportError); // length mismatch
    expect(() => decodePackBits(Uint8Array.from([254]), 2)).toThrow(PsdImportError); // repeat value missing
  });
});
