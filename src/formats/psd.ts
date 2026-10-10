/**
 * Photoshop PSD (version 1) writer — RGB, 8-bit depth, layered export.
 *
 * Produces a spec-conformant big-endian PSD file containing:
 *  - a 26-byte file header (4 channels, 8 bpc, RGB color mode)
 *  - empty color-mode-data and image-resources sections
 *  - a layer & mask information section with one record per document layer
 *    (stored top-first, RLE-compressed R/G/B/A planes per layer)
 *  - an image data section with the RLE-compressed flattened composite.
 *
 * Layer mapping: raster layers are written from their own canvas + x/y
 * offset; every other leaf kind (text, shape, fill, adjustment) is
 * rasterized via renderLayerIsolated() at 0,0 in full document size.
 * Hidden layers are included with the PSD "not visible" flag (flags bit 1)
 * so visibility round-trips. Blend modes map onto the standard PSD keys.
 *
 * Layer groups: each group emits an 'lsct' section-divider record (type 1 =
 * open folder, 2 = closed folder — mirroring `GroupLayer.expanded`), then
 * its children recursively, then a hidden type-3 bounding divider named
 * '</Layer set>'. Divider records carry the group's name/blend/opacity and
 * a zero rect (0,0,0,0) with zero-length channel info — the same shape
 * GIMP writes and Photoshop accepts; there is no pixel data on dividers.
 * Names that are not fully Latin-1 additionally emit an 'luni' (Unicode
 * layer name) block, which readers (including ours) prefer over the
 * '?'-substituted pascal name.
 *
 * Self-contained and browser-safe: only engine canvas helpers are used,
 * no external dependencies.
 */

import type { DocumentState, GroupLayer, Layer } from '../engine/types';
import type { BlendMode } from '../engine/blend';
import { composeDocument, renderLayerIsolated } from '../engine/render';
import { imageDataFromCanvas, makeCanvas, type AnyCanvas } from '../engine/raster';

export const PSD_EXTENSION = 'psd';

const PSD_MIME = 'image/vnd.adobe.photoshop';
const PSD_SIGNATURE = '8BPS';
const MAX_LAYERS = 32767; // layer count is a signed 16-bit field

/** PSD 'lsct' layer section divider types (Adobe spec). */
const SECTION_DIVIDER = {
  OPEN_FOLDER: 1,
  CLOSED_FOLDER: 2,
  BOUNDING: 3,
} as const;

const BOUNDING_DIVIDER_NAME = '</Layer set>';

/** Engine blend mode → 4-character PSD blend key ('norm' for unknown). */
const BLEND_TO_PSD: Record<BlendMode, string> = {
  normal: 'norm',
  multiply: 'mul ',
  screen: 'scrn',
  overlay: 'over',
  darken: 'dark',
  lighten: 'lite',
  'color-dodge': 'div ',
  'color-burn': 'idiv',
  'hard-light': 'hLit',
  'soft-light': 'sLit',
  difference: 'diff',
  exclusion: 'smud',
  hue: 'hue ',
  saturation: 'sat ',
  color: 'colr',
  luminosity: 'lum ',
};

function psdBlendKey(mode: string): string {
  return BLEND_TO_PSD[mode as BlendMode] ?? 'norm';
}

/** 4-char PSD blend key → engine blend mode (inverse of BLEND_TO_PSD). */
export const PSD_TO_BLEND: Record<string, BlendMode> = Object.fromEntries(
  Object.entries(BLEND_TO_PSD).map(([mode, key]) => [key, mode]),
) as Record<string, BlendMode>;

/** Maps a PSD layer blend key onto the engine blend mode; unknown keys → normal. */
export function psdBlendMode(key: string): BlendMode {
  return PSD_TO_BLEND[key] ?? 'normal';
}

/* ------------------------------------------------------------------ */
/* PackBits RLE                                                        */
/* ------------------------------------------------------------------ */

/**
 * Standard PackBits encoder.
 *  - literal run: signed byte (n - 1), n = 1..128, followed by n raw bytes
 *  - repeat run:  signed byte (1 - n), n = 2..128, followed by the byte value
 */
export function packBits(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(src.length * 2 + 16);
  let o = 0;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const value = src[i];
    let run = 1;
    while (run < 128 && i + run < n && src[i + run] === value) run += 1;
    if (run >= 2) {
      out[o] = (1 - run) & 0xff;
      out[o + 1] = value;
      o += 2;
      i += run;
    } else {
      // literal run: extends until a repeat of >= 2 begins or 128 bytes
      const start = i;
      i += 1;
      while (i < n && i - start < 128 && !(i + 1 < n && src[i] === src[i + 1])) i += 1;
      const len = i - start;
      out[o] = len - 1;
      out.set(src.subarray(start, i), o + 1);
      o += len + 1;
    }
  }
  return out.slice(0, o);
}

/* ------------------------------------------------------------------ */
/* byte writer (big-endian)                                            */
/* ------------------------------------------------------------------ */

/** Growable big-endian byte buffer backed by DataView. */
class ByteWriter {
  private buf: Uint8Array<ArrayBuffer>;
  private view: DataView;
  private pos = 0;

  constructor(initialCapacity = 1 << 16) {
    this.buf = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buf.buffer);
  }

  get length(): number {
    return this.pos;
  }

  private ensure(extra: number): void {
    if (this.pos + extra <= this.buf.length) return;
    let cap = Math.max(this.buf.length * 2, 1024);
    while (cap < this.pos + extra) cap *= 2;
    const grown: Uint8Array<ArrayBuffer> = new Uint8Array(cap);
    grown.set(this.buf.subarray(0, this.pos));
    this.buf = grown;
    this.view = new DataView(grown.buffer);
  }

  u8(value: number): this {
    this.ensure(1);
    this.view.setUint8(this.pos, value);
    this.pos += 1;
    return this;
  }

  u16(value: number): this {
    this.ensure(2);
    this.view.setUint16(this.pos, value, false);
    this.pos += 2;
    return this;
  }

  i16(value: number): this {
    this.ensure(2);
    this.view.setInt16(this.pos, value, false);
    this.pos += 2;
    return this;
  }

  u32(value: number): this {
    this.ensure(4);
    this.view.setUint32(this.pos, value, false);
    this.pos += 4;
    return this;
  }

  i32(value: number): this {
    this.ensure(4);
    this.view.setInt32(this.pos, value, false);
    this.pos += 4;
    return this;
  }

  /** Writes one byte per character (Latin-1 range; higher chars truncate). */
  ascii(text: string): this {
    this.ensure(text.length);
    for (let i = 0; i < text.length; i += 1) {
      this.view.setUint8(this.pos + i, text.charCodeAt(i) & 0xff);
    }
    this.pos += text.length;
    return this;
  }

  raw(bytes: Uint8Array): this {
    this.ensure(bytes.length);
    this.buf.set(bytes, this.pos);
    this.pos += bytes.length;
    return this;
  }

  finish(): Uint8Array<ArrayBuffer> {
    return this.buf.slice(0, this.pos);
  }
}

/* ------------------------------------------------------------------ */
/* layer collection                                                    */
/* ------------------------------------------------------------------ */

interface PsdChannelData {
  /** PackBits-compressed rows, one entry per layer row */
  rows: Uint8Array[];
  /** compressed byte length of each row */
  rowLengths: number[];
}

interface PsdLayerEntry {
  name: Uint8Array; // latin-1 bytes, max 255
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number; // 0..255
  blendKey: string; // 4 chars
  visible: boolean;
  channels: PsdChannelData[]; // R, G, B, alpha (empty for section dividers)
  /** 0 = plain layer, 1/2 = open/closed folder, 3 = bounding '</Layer set>' */
  sectionType: 0 | 1 | 2 | 3;
  /** 'luni' payload (u32 unit count + UTF-16BE) when the name is not Latin-1 */
  luni: Uint8Array | null;
}

/** PSD channel ids in write order: R, G, B, transparency. */
const PSD_CHANNEL_IDS = [0, 1, 2, -1] as const;

/** Splits interleaved RGBA ImageData into planar R/G/B/A byte planes. */
function splitPlanes(data: ImageData): [Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
  const size = data.width * data.height;
  const src = data.data;
  const r = new Uint8Array(size);
  const g = new Uint8Array(size);
  const b = new Uint8Array(size);
  const a = new Uint8Array(size);
  for (let i = 0, p = 0; i < size; i += 1, p += 4) {
    r[i] = src[p];
    g[i] = src[p + 1];
    b[i] = src[p + 2];
    a[i] = src[p + 3];
  }
  return [r, g, b, a];
}

/** PackBits-compresses every row of a planar channel. */
function compressChannel(plane: Uint8Array, width: number, height: number): PsdChannelData {
  const rows: Uint8Array[] = [];
  const rowLengths: number[] = [];
  for (let y = 0; y < height; y += 1) {
    const packed = packBits(plane.subarray(y * width, (y + 1) * width));
    rows.push(packed);
    rowLengths.push(packed.length);
  }
  return { rows, rowLengths };
}

/** Full channel-data block size: compression tag + row table + packed rows. */
function channelBlockLength(channel: PsdChannelData): number {
  let rows = 0;
  for (const len of channel.rowLengths) rows += len;
  return 2 + 2 * channel.rowLengths.length + rows;
}

/** Converts a layer name to latin-1 bytes; non-latin-1 chars become '?'. */
function latin1Name(name: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0x3f;
    bytes.push(code <= 0xff ? code : 0x3f);
  }
  return Uint8Array.from(bytes.slice(0, 255));
}

/** Total pascal-string size: length byte + chars, 4-byte aligned, min 4. */
function pascalStringLength(name: Uint8Array): number {
  return Math.max(4, Math.ceil((1 + name.length) / 4) * 4);
}

/** True when every character of `name` is representable in Latin-1. */
function isLatin1(name: string): boolean {
  for (const char of name) {
    if ((char.codePointAt(0) ?? 0x3f) > 0xff) return false;
  }
  return true;
}

/**
 * Builds the 'luni' (Unicode layer name) additional-info payload:
 * u32 UTF-16 code-unit count followed by the name in UTF-16BE.
 */
function luniPayload(name: string): Uint8Array {
  const units: number[] = [];
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0x3f;
    if (code > 0xffff) {
      const v = code - 0x10000;
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)); // surrogate pair
    } else {
      units.push(code);
    }
  }
  const data = new Uint8Array(4 + units.length * 2);
  const view = new DataView(data.buffer);
  view.setUint32(0, units.length, false);
  units.forEach((unit, i) => view.setUint16(4 + i * 2, unit, false));
  return data;
}

function layerOpacityByte(opacity: number): number {
  return Math.round(Math.min(1, Math.max(0, opacity)) * 255);
}

/**
 * Group divider record: carries the group's name/blend/opacity/visibility
 * with a zero rect and no channel data (parsing is purely structural).
 */
function groupDividerEntry(group: GroupLayer, open: boolean): PsdLayerEntry {
  const name = group.name;
  return {
    name: latin1Name(name),
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    opacity: layerOpacityByte(group.opacity),
    blendKey: psdBlendKey(group.blendMode),
    visible: group.visible,
    channels: [],
    sectionType: open ? SECTION_DIVIDER.OPEN_FOLDER : SECTION_DIVIDER.CLOSED_FOLDER,
    luni: isLatin1(name) ? null : luniPayload(name),
  };
}

/** Hidden bounding divider that closes the currently open group. */
function boundingDividerEntry(): PsdLayerEntry {
  return {
    name: latin1Name(BOUNDING_DIVIDER_NAME),
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    opacity: 255,
    blendKey: 'norm',
    visible: false,
    channels: [],
    sectionType: SECTION_DIVIDER.BOUNDING,
    luni: null,
  };
}

/**
 * Turns one engine layer into a PSD layer entry; returns null when the
 * layer has no pixels (zero-width/height canvas).
 */
function collectLayer(layer: Layer, doc: DocumentState): PsdLayerEntry | null {
  let canvas: AnyCanvas;
  let left: number;
  let top: number;
  if (layer.kind === 'raster') {
    canvas = layer.canvas;
    left = Math.round(layer.x);
    top = Math.round(layer.y);
  } else {
    // text/shape/fill/adjustment leaves: rasterized at 0,0 in document size
    canvas = renderLayerIsolated(layer, doc);
    left = 0;
    top = 0;
  }
  const width = canvas.width;
  const height = canvas.height;
  if (width < 1 || height < 1) return null;
  const name = layer.name;
  const planes = splitPlanes(imageDataFromCanvas(canvas));
  return {
    name: latin1Name(name),
    left,
    top,
    width,
    height,
    opacity: layerOpacityByte(layer.opacity),
    blendKey: psdBlendKey(layer.blendMode),
    visible: layer.visible,
    channels: planes.map((plane) => compressChannel(plane, width, height)),
    sectionType: 0,
    luni: isLatin1(name) ? null : luniPayload(name),
  };
}

/**
 * Walks the layer tree top-first and appends PSD layer entries: groups
 * emit an open/closed divider record, their children (recursively), then a
 * hidden '</Layer set>' bounding divider; leaves emit pixel records.
 */
function collectTree(layers: Layer[], doc: DocumentState, entries: PsdLayerEntry[]): void {
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (layer.kind === 'group') {
      const group = layer as GroupLayer;
      entries.push(groupDividerEntry(group, group.expanded));
      collectTree(group.children, doc, entries);
      entries.push(boundingDividerEntry());
    } else {
      const entry = collectLayer(layer, doc);
      if (entry) entries.push(entry);
    }
  }
}

/* ------------------------------------------------------------------ */
/* export                                                              */
/* ------------------------------------------------------------------ */

/**
 * Exports the whole document (layers + flattened composite) as a PSD v1
 * Blob (RGB, 8-bit, RLE-compressed).
 */
export async function exportPsd(doc: DocumentState): Promise<Blob> {
  // PSD stores layer records top-first; doc.layers is bottom→top. Groups
  // expand into divider + children + bounding-divider record sequences.
  const entries: PsdLayerEntry[] = [];
  collectTree(doc.layers, doc, entries);
  if (entries.length > MAX_LAYERS) {
    throw new Error(`PSD export supports at most ${MAX_LAYERS} layers (got ${entries.length})`);
  }

  // Flattened composite (doc-sized); degenerate docs fall back to 1×1.
  const composite =
    doc.width >= 1 && doc.height >= 1
      ? imageDataFromCanvas(composeDocument(doc))
      : imageDataFromCanvas(makeCanvas(1, 1));
  const width = composite.width;
  const height = composite.height;
  const compositeChannels = splitPlanes(composite).map((plane) =>
    compressChannel(plane, width, height),
  );

  // ---- section sizes (all lengths must be written exactly) ----
  // extra data = mask length (4) + blending ranges (4) + pascal name
  // (+ additional layer info blocks), padded so the whole layer record
  // stays an even number of bytes
  const extraLengths = entries.map((e) => {
    let base = 8 + pascalStringLength(e.name);
    if (e.sectionType !== 0) base += 20; // '8BIM' + 'lsct' + len + 8-byte data
    if (e.luni) base += 12 + e.luni.length; // '8BIM' + 'luni' + len + payload
    return base % 2 === 0 ? base : base + 1;
  });
  // record = rect(16) + channelCount(2) + 6×channelCount + '8BIM'(4)
  //        + blend(4) + opacity/clipping/flags/filler(4) + extraLength(4)
  const recordLengths = entries.map((e, i) => 34 + 6 * e.channels.length + extraLengths[i]);
  let channelDataTotal = 0;
  for (const e of entries) {
    for (const channel of e.channels) channelDataTotal += channelBlockLength(channel);
  }
  const rawLayerInfoLength = 2 + recordLengths.reduce((a, b) => a + b, 0) + channelDataTotal;
  // Adobe rounds the layer info section length (inclusive of the padding) up
  // to a multiple of 2 — channel data blocks can be odd-sized even though
  // every layer record is even
  const layerInfoPad = rawLayerInfoLength % 2;
  const layerInfoLength = rawLayerInfoLength + layerInfoPad;
  // section content = layer info length field (4) + layer info + global mask field (4)
  const sectionLength = layerInfoLength + 8;

  const out = new ByteWriter(1 << 16);

  // a. file header (26 bytes)
  out.ascii(PSD_SIGNATURE);
  out.u16(1); // version
  out.u16(0);
  out.u16(0);
  out.u16(0); // 6 reserved bytes
  out.u16(4); // channels: composite R, G, B + alpha
  out.u32(height);
  out.u32(width);
  out.u16(8); // depth
  out.u16(3); // color mode: RGB

  // b. color mode data (empty for RGB)
  out.u32(0);

  // c. image resources (empty)
  out.u32(0);

  // d. layer & mask information section
  out.u32(sectionLength);

  // d1. layer info
  out.u32(layerInfoLength);
  out.u16(entries.length); // layer count (positive)
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    out.i32(e.top);
    out.i32(e.left);
    out.i32(e.top + e.height); // bottom
    out.i32(e.left + e.width); // right
    out.u16(e.channels.length); // channel count (0 on section dividers)
    for (let c = 0; c < e.channels.length; c += 1) {
      out.i16(PSD_CHANNEL_IDS[c]);
      out.u32(channelBlockLength(e.channels[c]));
    }
    out.ascii('8BIM');
    out.ascii(e.blendKey);
    out.u8(e.opacity);
    out.u8(0); // clipping: not clipped
    out.u8(e.visible ? 0 : 2); // flags: bit 1 = not visible
    out.u8(0); // filler

    // extra data: layer mask data + layer blending ranges + pascal name
    // + additional layer info ('lsct' on dividers, 'luni' for non-Latin-1 names)
    const extra = new ByteWriter(64);
    extra.u32(0); // layer mask data length
    extra.u32(0); // layer blending ranges length
    extra.u8(e.name.length); // pascal length byte (excludes padding)
    extra.raw(e.name);
    while (extra.length < 8 + pascalStringLength(e.name)) extra.u8(0);
    if (e.sectionType !== 0) {
      // 'lsct' section divider — Photoshop's 8-byte form: u32 type + 4-byte filler
      extra.ascii('8BIM').ascii('lsct').u32(8).u32(e.sectionType).u32(0);
    }
    if (e.luni) {
      // 'luni' Unicode layer name — supersedes the pascal name on import
      extra.ascii('8BIM').ascii('luni').u32(e.luni.length).raw(e.luni);
    }
    if (extra.length % 2 !== 0) extra.u8(0); // keep the record even (defensive)
    out.u32(extra.length);
    out.raw(extra.finish());
  }
  // channel image data blocks, grouped per layer in record order
  for (const e of entries) {
    for (const channel of e.channels) {
      out.u16(1); // compression: RLE
      for (const len of channel.rowLengths) out.u16(len);
      for (const row of channel.rows) out.raw(row);
    }
  }
  for (let i = 0; i < layerInfoPad; i += 1) out.u8(0); // even-length padding

  // d2. global layer mask info (empty)
  out.u32(0);

  // e. image data section (flattened composite)
  out.u16(1); // compression: RLE
  for (const channel of compositeChannels) {
    for (const len of channel.rowLengths) out.u16(len);
  }
  for (const channel of compositeChannels) {
    for (const row of channel.rows) out.raw(row);
  }

  return new Blob([out.finish()], { type: PSD_MIME });
}
