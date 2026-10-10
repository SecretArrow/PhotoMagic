/**
 * Unit tests — PSD writer (src/formats/psd).
 *
 * Node environment (no DOM/canvas): a minimal canvas stand-in is installed by
 * stubbing `document.createElement` (same approach as project.test.ts). The
 * 2D context shim implements exactly the drawing operations the engine uses
 * on the export path — putImageData, fillRect, clearRect, source-over
 * drawImage and getImageData. Pixel assertions only rely on exact,
 * well-defined paths (opaque solids, globalAlpha 1, source-over); engine
 * blend modes are approximated as source-over in the shim, which is fine
 * because blend correctness is asserted via the PSD blend keys instead.
 *
 * The produced files are verified with a small structural parser
 * (readPSDStructure) that walks header → color mode → resources → layer &
 * mask section (records + channel data + global mask) → composite section,
 * plus a reference PackBits decoder for losslessness and pixel checks.
 */

import { describe, expect, it, vi } from 'vitest';
import { PSD_EXTENSION, exportPsd, packBits } from '../../src/formats/psd';
import {
  createAdjustmentLayer,
  createDocument,
  createFillLayer,
  createGroupLayer,
  createRasterLayer,
} from '../../src/engine/document';
import { ctx2d, makeCanvas } from '../../src/engine/raster';
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

  /** Applies one source pixel using the current composite operation. */
  private compositePixel(o: number, r: number, g: number, b: number, a: number): void {
    const data = this.canvas.data;
    if (this.globalCompositeOperation === 'clear') {
      data[o] = 0;
      data[o + 1] = 0;
      data[o + 2] = 0;
      data[o + 3] = 0;
      return;
    }
    if (this.globalCompositeOperation === 'destination-in') {
      const dstA = data[o + 3] / 255;
      data[o] = Math.round(data[o] * a);
      data[o + 1] = Math.round(data[o + 1] * a);
      data[o + 2] = Math.round(data[o + 2] * a);
      data[o + 3] = Math.round(dstA * a * 255);
      return;
    }
    if (this.globalCompositeOperation === 'destination-out') {
      data[o + 3] = Math.round((data[o + 3] / 255) * (1 - a) * 255);
      return;
    }
    // 'source-over' and every engine blend mode (blends are approximated as
    // over — the tests never assert blended composite pixels)
    const dstA = data[o + 3] / 255;
    if (a >= 1) {
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
      return;
    }
    const outA = a + dstA * (1 - a);
    if (outA <= 0) {
      data[o] = 0;
      data[o + 1] = 0;
      data[o + 2] = 0;
      data[o + 3] = 0;
      return;
    }
    data[o] = Math.round((r * a + data[o] * dstA * (1 - a)) / outA);
    data[o + 1] = Math.round((g * a + data[o + 1] * dstA * (1 - a)) / outA);
    data[o + 2] = Math.round((b * a + data[o + 2] * dstA * (1 - a)) / outA);
    data[o + 3] = Math.round(outA * 255);
  }

  private paintPixel(x: number, y: number, r: number, g: number, b: number, a: number): void {
    const o = this.pixelOffset(x, y);
    if (o < 0) return;
    this.compositePixel(o, r, g, b, a);
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

  /** Nearest-neighbour drawImage with per-pixel source-over compositing. */
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
/* document helpers                                                    */
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

async function exportBytes(doc: DocumentState): Promise<Uint8Array> {
  const blob = await exportPsd(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

/* ------------------------------------------------------------------ */
/* minimal PSD structural parser (verification side)                   */
/* ------------------------------------------------------------------ */

interface ParsedChannel {
  id: number;
  dataLength: number;
}

interface ParsedLayer {
  top: number;
  left: number;
  bottom: number;
  right: number;
  channels: ParsedChannel[];
  blendKey: string;
  opacity: number;
  clipping: number;
  flags: number;
  name: string;
  /** additional layer info block keys, in file order ('lsct', 'luni', …) */
  keys: string[];
  /** 'lsct' divider type (0 = plain layer, 1/2 folder, 3 bounding) */
  sectionType: number;
}

interface ParsedPsd {
  version: number;
  channels: number;
  width: number;
  height: number;
  depth: number;
  colorMode: number;
  layerInfoLength: number;
  sectionLength: number;
  layerCount: number;
  layers: ParsedLayer[];
  globalMaskLength: number;
  compositeCompression: number;
  compositeRowLengths: number[];
  compositeDataOffset: number;
}

function pascalAligned(n: number): number {
  return Math.max(4, Math.ceil(n / 4) * 4);
}

/**
 * Walks a PSD file and returns its structure. Throws on any length/signature
 * inconsistency, which is itself a strong roundtrip assertion.
 */
function readPSDStructure(bytes: Uint8Array): ParsedPsd {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (sig !== '8BPS') throw new Error(`bad signature: ${sig}`);
  let off = 4;
  const version = view.getUint16(off, false);
  off += 2;
  off += 6; // reserved
  const channels = view.getUint16(off, false);
  off += 2;
  const height = view.getUint32(off, false);
  off += 4;
  const width = view.getUint32(off, false);
  off += 4;
  const depth = view.getUint16(off, false);
  off += 2;
  const colorMode = view.getUint16(off, false);
  off += 2;

  const colorModeLength = view.getUint32(off, false);
  off += 4 + colorModeLength;
  const resourcesLength = view.getUint32(off, false);
  off += 4 + resourcesLength;

  const sectionLength = view.getUint32(off, false);
  off += 4;
  const sectionEnd = off + sectionLength;

  const layerInfoLength = view.getUint32(off, false);
  off += 4;
  const layerInfoEnd = off + layerInfoLength;
  const layerCount = view.getInt16(off, false);
  off += 2;

  const layers: ParsedLayer[] = [];
  for (let i = 0; i < Math.abs(layerCount); i += 1) {
    const top = view.getInt32(off, false);
    const left = view.getInt32(off + 4, false);
    const bottom = view.getInt32(off + 8, false);
    const right = view.getInt32(off + 12, false);
    off += 16;
    const channelCount = view.getUint16(off, false);
    off += 2;
    const layerChannels: ParsedChannel[] = [];
    for (let c = 0; c < channelCount; c += 1) {
      layerChannels.push({ id: view.getInt16(off, false), dataLength: view.getUint32(off + 2, false) });
      off += 6;
    }
    const recordSig = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
    if (recordSig !== '8BIM') throw new Error(`bad layer record signature: ${recordSig}`);
    off += 4;
    const blendKey = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
    off += 4;
    const opacity = bytes[off];
    const clipping = bytes[off + 1];
    const flags = bytes[off + 2];
    off += 4; // opacity + clipping + flags + filler
    const extraLength = view.getUint32(off, false);
    off += 4;
    const extraEnd = off + extraLength;
    off += 4; // layer mask data length (0)
    off += 4; // layer blending ranges length (0)
    const nameLength = bytes[off];
    off += 1;
    const name = String.fromCharCode(...bytes.subarray(off, off + nameLength));
    off += nameLength;
    off += pascalAligned(1 + nameLength) - 1 - nameLength; // pascal padding
    // additional layer info blocks: '8BIM' + key + u32 length + data
    const keys: string[] = [];
    let sectionType = 0;
    while (off + 8 <= extraEnd) {
      const sig = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
      if (sig !== '8BIM' && sig !== '8B64') break;
      const key = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
      off += 8;
      const len = view.getUint32(off, false);
      off += 4;
      keys.push(key);
      if (key === 'lsct' && len >= 4) sectionType = view.getUint32(off, false);
      off += len;
    }
    if (off !== extraEnd) off = extraEnd; // tolerate unknown extra bytes
    layers.push({
      top,
      left,
      bottom,
      right,
      channels: layerChannels,
      blendKey,
      opacity,
      clipping,
      flags,
      name,
      keys,
      sectionType,
    });
  }

  // channel image data blocks follow the records, grouped per layer
  for (const layer of layers) {
    for (const channel of layer.channels) {
      const compression = view.getUint16(off, false);
      if (compression !== 1) throw new Error(`unexpected channel compression: ${compression}`);
      off += channel.dataLength;
    }
  }
  // Adobe rounds the layer info section length up to a multiple of 2
  const layerInfoPad = layerInfoEnd - off;
  if (layerInfoPad < 0 || layerInfoPad > 1) {
    throw new Error(`layer info padding out of range: ${layerInfoPad}`);
  }
  off = layerInfoEnd;

  const globalMaskLength = view.getUint32(off, false);
  off += 4;
  if (off !== sectionEnd) throw new Error(`layer & mask section mismatch: ${off} ≠ ${sectionEnd}`);

  const compositeCompression = view.getUint16(off, false);
  off += 2;
  const compositeRowLengths: number[] = [];
  for (let i = 0; i < channels * height; i += 1) {
    compositeRowLengths.push(view.getUint16(off, false));
    off += 2;
  }

  return {
    version,
    channels,
    width,
    height,
    depth,
    colorMode,
    layerInfoLength,
    sectionLength,
    layerCount,
    layers,
    globalMaskLength,
    compositeCompression,
    compositeRowLengths,
    compositeDataOffset: off,
  };
}

/* ------------------------------------------------------------------ */
/* PackBits reference decoder + composite decode                       */
/* ------------------------------------------------------------------ */

/** Reference PackBits decoder (mirrors the encoder contract). */
function decodePackBits(src: Uint8Array, expectedLength: number): Uint8Array {
  const out = new Uint8Array(expectedLength);
  let o = 0;
  let i = 0;
  while (i < src.length) {
    const n = (src[i] << 24) >> 24; // signed byte
    i += 1;
    if (n >= 0) {
      const count = n + 1;
      out.set(src.subarray(i, i + count), o);
      o += count;
      i += count;
    } else {
      const value = src[i];
      i += 1;
      out.fill(value, o, o + 1 - n);
      o += 1 - n;
    }
  }
  if (o !== expectedLength) throw new Error(`RLE decode length mismatch: ${o} ≠ ${expectedLength}`);
  return out;
}

/** Decodes the composite image-data section into interleaved RGBA. */
function decodeComposite(bytes: Uint8Array, psd: ParsedPsd): Uint8Array {
  const planes: Uint8Array[] = [];
  let off = psd.compositeDataOffset;
  for (let p = 0; p < psd.channels; p += 1) {
    const plane = new Uint8Array(psd.width * psd.height);
    for (let y = 0; y < psd.height; y += 1) {
      const rowLength = psd.compositeRowLengths[p * psd.height + y];
      const row = decodePackBits(bytes.subarray(off, off + rowLength), psd.width);
      plane.set(row, y * psd.width);
      off += rowLength;
    }
    planes.push(plane);
  }
  const rgba = new Uint8Array(psd.width * psd.height * 4);
  for (let i = 0; i < psd.width * psd.height; i += 1) {
    rgba[i * 4] = planes[0][i];
    rgba[i * 4 + 1] = planes[1][i];
    rgba[i * 4 + 2] = planes[2][i];
    rgba[i * 4 + 3] = planes[3][i];
  }
  return rgba;
}

function pixelAt(rgba: Uint8Array, width: number, x: number, y: number): [number, number, number, number] {
  const o = (y * width + x) * 4;
  return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]];
}

/* ------------------------------------------------------------------ */
/* tests                                                               */
/* ------------------------------------------------------------------ */

describe('PSD export — file header', () => {
  it('writes the 26-byte PSD v1 header with correct fields', async () => {
    const doc = blankDoc(4, 3);
    doc.layers.push(solidRasterLayer('L', 2, 2, [10, 20, 30, 255]));
    const blob = await exportPsd(doc);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/vnd.adobe.photoshop');
    expect(PSD_EXTENSION).toBe('psd');

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('8BPS');
    expect(view.getUint16(4, false)).toBe(1); // version
    expect(bytes[6]).toBe(0);
    expect(bytes[7]).toBe(0);
    expect(bytes[8]).toBe(0);
    expect(bytes[9]).toBe(0);
    expect(bytes[10]).toBe(0);
    expect(bytes[11]).toBe(0); // 6 reserved bytes
    expect(view.getUint16(12, false)).toBe(4); // channels
    expect(view.getUint32(14, false)).toBe(3); // height
    expect(view.getUint32(18, false)).toBe(4); // width
    expect(view.getUint16(22, false)).toBe(8); // depth
    expect(view.getUint16(24, false)).toBe(3); // RGB color mode
    expect(bytes.length).toBeGreaterThan(26 + 4 + 4 + 4);
  });
});

describe('PSD export — layer structure roundtrip', () => {
  it('writes layers top-first with rects, blend keys, opacity and hidden flags', async () => {
    const doc = blankDoc(6, 5);
    const base = solidRasterLayer('Base', 6, 5, [255, 255, 255, 255]);
    const mid = solidRasterLayer('Mid', 2, 3, [0, 0, 255, 255], 1, 0);
    mid.blendMode = 'multiply';
    mid.opacity = 0.5;
    const top = solidRasterLayer('Top', 2, 2, [0, 255, 0, 255], 2, 1);
    top.blendMode = 'screen';
    top.visible = false;
    doc.layers.push(base, mid, top); // bottom → top

    const bytes = await exportBytes(doc);
    const psd = readPSDStructure(bytes);
    expect(psd.width).toBe(6);
    expect(psd.height).toBe(5);
    expect(psd.layerCount).toBeGreaterThan(0);
    expect(psd.layerCount).toBe(3);
    expect(psd.layers.map((l) => l.name)).toEqual(['Top', 'Mid', 'Base']); // topmost record first

    const [topRecord, midRecord, baseRecord] = psd.layers;
    expect(topRecord.flags & 2).toBe(2); // hidden bit set
    expect(topRecord.blendKey).toBe('scrn');
    expect(topRecord.opacity).toBe(255);
    expect([topRecord.left, topRecord.top, topRecord.right, topRecord.bottom]).toEqual([2, 1, 4, 3]);

    expect(midRecord.flags & 2).toBe(0);
    expect(midRecord.blendKey).toBe('mul ');
    expect(midRecord.opacity).toBe(128); // 0.5 × 255, rounded
    expect([midRecord.left, midRecord.top, midRecord.right, midRecord.bottom]).toEqual([1, 0, 3, 3]);

    expect(baseRecord.flags).toBe(0);
    expect(baseRecord.blendKey).toBe('norm');
    expect(baseRecord.opacity).toBe(255);
    expect([baseRecord.left, baseRecord.top, baseRecord.right, baseRecord.bottom]).toEqual([0, 0, 6, 5]);

    // channel ids are R, G, B, alpha for every layer
    for (const layer of psd.layers) {
      expect(layer.channels.map((c) => c.id)).toEqual([0, 1, 2, -1]);
      expect(layer.clipping).toBe(0);
    }
    // Base is solid white 6×5: every row packs to 2 bytes → 2 + 2·5 + 5·2 = 22
    for (const channel of baseRecord.channels) expect(channel.dataLength).toBe(22);
    // exact section sizes: records 70+70+74, channel data 40+56+88, count 2
    expect(psd.layerInfoLength).toBe(2 + 70 + 70 + 74 + 40 + 56 + 88);
    // section = layer info length field (4) + layer info + global mask field (4)
    expect(psd.sectionLength).toBe(psd.layerInfoLength + 8);
    expect(psd.globalMaskLength).toBe(0);
    expect(psd.compositeCompression).toBe(1);
    expect(psd.compositeRowLengths).toHaveLength(4 * 5);
  });

  it('rasterizes fill layers at 0,0 in document size and flattens them', async () => {
    const doc = blankDoc(3, 3);
    doc.layers.push(createFillLayer('Fill', { type: 'solid', color: '#ff0000' }));

    const bytes = await exportBytes(doc);
    const psd = readPSDStructure(bytes);
    expect(psd.layerCount).toBe(1);
    const [fill] = psd.layers;
    expect(fill.name).toBe('Fill');
    expect([fill.left, fill.top, fill.right, fill.bottom]).toEqual([0, 0, 3, 3]);
    expect(fill.blendKey).toBe('norm');

    const rgba = decodeComposite(bytes, psd);
    expect(pixelAt(rgba, 3, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(rgba, 3, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(rgba, 3, 1, 0)).toEqual([255, 0, 0, 255]);
  });

  it('includes adjustment layers as doc-size records', async () => {
    const doc = blankDoc(4, 2);
    doc.layers.push(createAdjustmentLayer('Invert', { type: 'invert' }));

    const bytes = await exportBytes(doc);
    const psd = readPSDStructure(bytes);
    expect(psd.layerCount).toBe(1);
    const [adj] = psd.layers;
    expect(adj.name).toBe('Invert');
    expect([adj.left, adj.top, adj.right, adj.bottom]).toEqual([0, 0, 4, 2]);
    expect(adj.channels).toHaveLength(4);
  });
});

describe('PSD export — layer groups', () => {
  it('emits lsct divider records around group children, nested recursively', async () => {
    const doc = blankDoc(8, 6);
    const solo = solidRasterLayer('Solo', 3, 2, [255, 255, 0, 255], 5, 3);
    const hidden = solidRasterLayer('H', 2, 2, [255, 0, 0, 255], 0, 0);
    hidden.visible = false;
    const visible = solidRasterLayer('V', 3, 3, [0, 255, 0, 255], 2, 1);
    const deep = solidRasterLayer('Deep', 2, 1, [0, 0, 255, 255], 4, 4);
    const inner = createGroupLayer('Inner', [deep]);
    inner.expanded = false; // collapsed folder → divider type 2
    const outer = createGroupLayer('Outer', [hidden, visible, inner]);
    outer.opacity = 0.6;
    outer.blendMode = 'multiply';
    doc.layers.push(solo, outer); // bottom → top

    const bytes = await exportBytes(doc);
    const psd = readPSDStructure(bytes); // throws on any length inconsistency
    // top-first: Outer, Inner, Deep, close(Inner), V, H, close(Outer), Solo
    expect(psd.layerCount).toBe(8);
    expect(psd.layers.map((l) => l.name)).toEqual([
      'Outer', 'Inner', 'Deep', '</Layer set>', 'V', 'H', '</Layer set>', 'Solo',
    ]);
    expect(psd.layers.map((l) => l.sectionType)).toEqual([1, 2, 0, 3, 0, 0, 3, 0]);

    const [outerDiv, innerDiv, deepRec, closeInner, vRec, hRec, closeOuter, soloRec] = psd.layers;

    // opening dividers carry the group's name/blend/opacity, zero rect and
    // zero-length channel info (no pixel data)
    expect(outerDiv.keys).toEqual(['lsct']);
    expect(outerDiv.channels).toHaveLength(0);
    expect([outerDiv.left, outerDiv.top, outerDiv.right, outerDiv.bottom]).toEqual([0, 0, 0, 0]);
    expect(outerDiv.blendKey).toBe('mul ');
    expect(outerDiv.opacity).toBe(153); // 0.6 × 255 rounded
    expect(outerDiv.flags & 2).toBe(0); // visible group

    expect(innerDiv.keys).toEqual(['lsct']);
    expect(innerDiv.sectionType).toBe(2); // collapsed folder
    expect(innerDiv.flags & 2).toBe(0);

    // closing dividers are hidden '</Layer set>' records
    expect(closeInner.sectionType).toBe(3);
    expect(closeInner.flags & 2).toBe(2);
    expect(closeOuter.sectionType).toBe(3);
    expect(closeOuter.flags & 2).toBe(2);

    // leaves keep their pixel records and hidden flags
    for (const leaf of [deepRec, vRec, hRec, soloRec]) {
      expect(leaf.keys).toEqual([]); // latin-1 names → no additional info
      expect(leaf.channels.map((c) => c.id)).toEqual([0, 1, 2, -1]);
    }
    expect(hRec.flags & 2).toBe(2);
    expect(vRec.flags & 2).toBe(0);
    expect([soloRec.left, soloRec.top, soloRec.right, soloRec.bottom]).toEqual([5, 3, 8, 5]);
  });

  it('rasterizes non-raster leaves inside groups at 0,0 in document size', async () => {
    const doc = blankDoc(3, 3);
    const group = createGroupLayer('G', [createFillLayer('Fill', { type: 'solid', color: '#ff0000' })]);
    doc.layers.push(group);

    const psd = readPSDStructure(await exportBytes(doc));
    expect(psd.layerCount).toBe(3); // divider + fill + closing divider
    const [, fill] = psd.layers;
    expect(fill.name).toBe('Fill');
    expect([fill.left, fill.top, fill.right, fill.bottom]).toEqual([0, 0, 3, 3]);
    expect(fill.channels).toHaveLength(4);
  });

  it('emits luni for non-Latin-1 layer and group names (pascal name degrades to "?")', async () => {
    const doc = blankDoc(2, 2);
    const group = createGroupLayer('группа', [solidRasterLayer('図形', 2, 2, [9, 9, 9, 255])]);
    doc.layers.push(group);

    const psd = readPSDStructure(await exportBytes(doc));
    // top-first: group divider (lsct + luni), CJK leaf (luni), closing divider (lsct)
    expect(psd.layers.map((l) => l.keys)).toEqual([['lsct', 'luni'], ['luni'], ['lsct']]);
    expect(psd.layers[1].name).toBe('??'); // each CJK char degrades to "?" in the pascal name
  });

  it('still decodes the flattened composite for grouped documents', async () => {
    const doc = blankDoc(8, 6);
    const visible = solidRasterLayer('V', 3, 3, [0, 255, 0, 255], 2, 1);
    const solo = solidRasterLayer('Solo', 3, 2, [255, 255, 0, 255], 5, 3);
    const group = createGroupLayer('Outer', [visible]);
    group.opacity = 0.6;
    doc.layers.push(solo, group);

    const bytes = await exportBytes(doc);
    const psd = readPSDStructure(bytes);
    const rgba = decodeComposite(bytes, psd);
    // group at 60% opacity scales its children's alpha (0.6 × 255 = 153)
    expect(pixelAt(rgba, 8, 3, 2)).toEqual([0, 255, 0, 153]);
    expect(pixelAt(rgba, 8, 6, 4)).toEqual([255, 255, 0, 255]); // top-level layer untouched
    expect(pixelAt(rgba, 8, 0, 5)).toEqual([0, 0, 0, 0]);
  });
});

describe('packBits', () => {
  it('encodes a repeat run as signed (1-n) + value', () => {
    expect([...packBits(Uint8Array.from([65, 65, 65, 65, 65]))]).toEqual([252, 65]); // 1-5 = -4
    expect([...packBits(new Uint8Array(128).fill(9))]).toEqual([129, 9]); // 1-128 = -127
  });

  it('encodes literals as signed (n-1) + raw bytes', () => {
    expect([...packBits(Uint8Array.from([1, 2, 3]))]).toEqual([2, 1, 2, 3]);
    expect([...packBits(Uint8Array.from([7]))]).toEqual([0, 7]);
  });

  it('encodes mixed literal + repeat + literal sequences', () => {
    expect([...packBits(Uint8Array.from([1, 2, 3, 3, 3, 4]))]).toEqual([1, 1, 2, 254, 3, 0, 4]);
  });

  it('splits repeat runs longer than 128 into repeat + literal tail', () => {
    expect([...packBits(new Uint8Array(129).fill(7))]).toEqual([129, 7, 0, 7]);
  });

  it('encodes empty input to nothing', () => {
    expect(packBits(new Uint8Array(0))).toHaveLength(0);
  });

  it('round-trips losslessly on pseudo-random and run-heavy data', () => {
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
    const decoded = decodePackBits(packBits(mixed), mixed.length);
    expect(decoded).toEqual(mixed);

    // pathological alternating single/repeat pattern
    const spike = new Uint8Array(300);
    for (let i = 0; i < 300; i += 3) {
      spike[i] = 1;
      spike[i + 1] = 2;
      spike[i + 2] = 2;
    }
    expect(decodePackBits(packBits(spike), spike.length)).toEqual(spike);
  });
});

describe('PSD export — composite RLE', () => {
  it('decodes composite pixels of a 4×3 doc with an offset solid layer', async () => {
    const doc = blankDoc(4, 3);
    doc.layers.push(solidRasterLayer('Red', 2, 2, [255, 0, 0, 255], 1, 1));

    const bytes = await exportBytes(doc);
    const psd = readPSDStructure(bytes);
    expect(psd.compositeCompression).toBe(1);
    expect(psd.compositeRowLengths).toHaveLength(4 * 3);
    expect(psd.compositeRowLengths.every((len) => len > 0)).toBe(true);

    const rgba = decodeComposite(bytes, psd);
    expect(pixelAt(rgba, 4, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(rgba, 4, 3, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(rgba, 4, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(rgba, 4, 2, 1)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(rgba, 4, 1, 2)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(rgba, 4, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(rgba, 4, 0, 2)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(rgba, 4, 3, 2)).toEqual([0, 0, 0, 0]);
  });
});

describe('PSD export — edge cases', () => {
  it('writes a valid zero-layer PSD with an empty (transparent) composite', async () => {
    const bytes = await exportBytes(blankDoc(2, 2));
    const psd = readPSDStructure(bytes);
    expect(psd.layerCount).toBe(0);
    expect(psd.layerInfoLength).toBe(2); // just the layer count field
    expect(psd.sectionLength).toBe(10); // + layer info length field + global mask field
    expect(psd.compositeCompression).toBe(1);
    expect(psd.compositeRowLengths).toHaveLength(4 * 2);

    const rgba = decodeComposite(bytes, psd);
    expect(rgba.every((v) => v === 0)).toBe(true);
  });

  it('pads the layer info section to an even length (Adobe rounding)', async () => {
    // 6×1 layer whose packed channel rows are 7+6+6+2 = 21 bytes (odd total),
    // so the four channel blocks (each +2 compression +2 row table = +16)
    // sum to 37 and the layer info section needs one even-padding byte:
    // R → literal(1,2)+repeat(3,3)+literal(4) = 7, G/B → literal(1,2,3)+repeat(4) = 6,
    // A → repeat(255) = 2.
    const doc = blankDoc(6, 1);
    const canvas = makeCanvas(6, 1);
    const ctx = ctx2d(canvas);
    const img = ctx.createImageData(6, 1);
    const row: [number, number, number, number][] = [
      [1, 1, 1, 255],
      [2, 2, 2, 255],
      [3, 3, 3, 255],
      [3, 4, 4, 255],
      [3, 4, 4, 255],
      [4, 4, 4, 255],
    ];
    row.forEach(([r, g, b, a], x) => {
      img.data[x * 4] = r;
      img.data[x * 4 + 1] = g;
      img.data[x * 4 + 2] = b;
      img.data[x * 4 + 3] = a;
    });
    ctx.putImageData(img, 0, 0);
    doc.layers.push(createRasterLayer('Pad', 6, 1, canvas));

    const bytes = await exportBytes(doc);
    const psd = readPSDStructure(bytes); // throws if lengths are inconsistent
    expect(psd.layerCount).toBe(1);
    // 2 (count) + 70 (record) + 37 (channel data) = 109 content bytes + 1 pad
    expect(psd.layerInfoLength).toBe(110);
    expect(psd.sectionLength).toBe(psd.layerInfoLength + 8);
  });
});
