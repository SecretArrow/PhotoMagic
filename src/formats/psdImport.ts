/**
 * Photoshop PSD (version 1) reader — RGB, 8-bit depth, layered import.
 *
 * The read side of the PSD writer in `./psd`. Parses a spec-conformant
 * big-endian PSD file:
 *  - 26-byte file header (signature/version/channels/size/depth/color mode)
 *  - color mode data + image resources sections (skipped by length)
 *  - layer & mask information section (layer records + per-layer RLE/raw
 *    channel data), decoded into host canvases with offsets, blend modes,
 *    opacity and visibility
 *  - image data section — the flattened composite, used as a fallback when
 *    the file carries no usable layer records (flattened/foreign files).
 *
 * Layer groups: records carrying an 'lsct' additional-info block are section
 * dividers (1/2 = open/closed folder, 3 = the hidden '</Layer set>' bounding
 * divider). A stack reconstructs the nesting: an open divider pushes a group
 * (children accumulate into it), a type-3 divider closes it; unterminated
 * groups auto-close at the end and stray type-3 dividers are ignored. The
 * 'luni' Unicode layer name block, when present, supersedes the Pascal name.
 *
 * Honest rejection policy: anything this build cannot represent — PSB (v2),
 * non-RGB color modes, 1/16/32-bit depth, unknown channel layouts, corrupt
 * or truncated section lengths — throws a `PsdImportError` whose message is
 * user-facing (shown in a toast).
 *
 * Not imported (skipped, with the composite available as a fallback in
 * flattened exports): layer/adjustment/vector masks, smart filters, clipping
 * stacks.
 */

import type { BlendMode } from '../engine/blend';
import { psdBlendMode } from './psd';
import { makeCanvas, ctx2d, type AnyCanvas } from '../engine/raster';

const PSD_SIGNATURE = '8BPS';
/** Adobe's documented PSD (v1) dimension limit; PSB (v2) allows 300,000. */
const MAX_DIMENSION = 30000;
const MAX_LAYERS = 32767; // layer count is a signed 16-bit field

/* ------------------------------------------------------------------ */
/* errors + public result shape                                        */
/* ------------------------------------------------------------------ */

/** Typed import failure; `message` is user-facing (toast text). */
export class PsdImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PsdImportError';
  }
}

/** One decoded PSD layer, ready to become an engine layer. */
export interface ImportedLayer {
  name: string;
  /** layer offset within the document (PSD record left/top) */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Host canvas with the decoded RGBA pixels (size = width × height).
   * Group entries carry a 1×1 transparent placeholder — they have no pixels;
   * use `isGroup` + `children` instead.
   */
  canvas: AnyCanvas;
  visible: boolean;
  /** 0..1 (PSD stores 0..255) */
  opacity: number;
  blend: BlendMode;
  /** true for layer-group records ('lsct' section dividers; no pixels) */
  isGroup?: boolean;
  /** folder state — divider type 1 = open, 2 = closed */
  expanded?: boolean;
  /** nested layers in PSD file order (top first); only set on groups */
  children?: ImportedLayer[];
}

export interface PsdImportResult {
  /** document name derived from the PSD file name (when a File was given) */
  name: string;
  width: number;
  height: number;
  /**
   * Decoded layers in PSD file order (TOP first). The open pipeline
   * reverses these when building the bottom→top document layer stack.
   */
  layers: ImportedLayer[];
  /** true when no layer records existed and the flattened composite was used */
  usedComposite: boolean;
}

/* ------------------------------------------------------------------ */
/* PackBits RLE decoder                                                */
/* ------------------------------------------------------------------ */

/**
 * Standard PackBits decoder (counterpart of `packBits` in ./psd).
 *  - literal run: signed byte (n - 1), n = 1..128, followed by n raw bytes
 *  - repeat run:  signed byte (1 - n), n = 2..128, followed by the byte value
 * Throws `PsdImportError` on truncated input or a length mismatch.
 */
export function decodePackBits(src: Uint8Array, expectedLength: number): Uint8Array {
  const out = new Uint8Array(expectedLength);
  let o = 0;
  let i = 0;
  while (i < src.length) {
    const n = (src[i] << 24) >> 24; // signed byte
    i += 1;
    if (n >= 0) {
      const count = n + 1;
      if (i + count > src.length) throw new PsdImportError('Corrupted image data (truncated RLE literal run).');
      if (o + count > expectedLength) throw new PsdImportError('Corrupted image data (RLE row overflow).');
      out.set(src.subarray(i, i + count), o);
      o += count;
      i += count;
    } else {
      if (i >= src.length) throw new PsdImportError('Corrupted image data (truncated RLE repeat run).');
      const value = src[i];
      i += 1;
      const count = 1 - n;
      if (o + count > expectedLength) throw new PsdImportError('Corrupted image data (RLE row overflow).');
      out.fill(value, o, o + count);
      o += count;
    }
  }
  if (o !== expectedLength) {
    throw new PsdImportError(`Corrupted image data (decoded ${o} bytes, expected ${expectedLength}).`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* big-endian reader with bounds checks                                */
/* ------------------------------------------------------------------ */

class PsdReader {
  readonly bytes: Uint8Array;
  private view: DataView;
  pos = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.bytes.length) {
      throw new PsdImportError('This PSD file is truncated or corrupted.');
    }
  }

  u8(): number {
    this.need(1);
    return this.bytes[this.pos++];
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, false);
    this.pos += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, false);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, false);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, false);
    this.pos += 4;
    return v;
  }

  ascii(n: number): string {
    this.need(n);
    let s = '';
    for (let i = 0; i < n; i += 1) s += String.fromCharCode(this.bytes[this.pos + i]);
    this.pos += n;
    return s;
  }

  raw(n: number): Uint8Array {
    this.need(n);
    const sub = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return sub;
  }

  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }
}

/* ------------------------------------------------------------------ */
/* header                                                              */
/* ------------------------------------------------------------------ */

interface PsdHeader {
  version: number;
  channels: number;
  width: number;
  height: number;
  depth: number;
  colorMode: number;
}

const COLOR_MODE_NAMES: Record<number, string> = {
  0: 'Bitmap',
  1: 'Grayscale',
  2: 'Indexed',
  4: 'CMYK',
  7: 'Multichannel',
  8: 'Duotone',
  9: 'Lab',
};

function readHeader(r: PsdReader): PsdHeader {
  const signature = r.ascii(4);
  if (signature !== PSD_SIGNATURE) {
    throw new PsdImportError('This file is not a Photoshop document (PSD).');
  }
  const version = r.u16();
  if (version === 2) {
    throw new PsdImportError('Photoshop Large Document (PSB) files are not supported.');
  }
  if (version !== 1) {
    throw new PsdImportError(`Unsupported PSD version ${version} (only version 1 is supported).`);
  }
  r.skip(6); // reserved
  const channels = r.u16();
  const height = r.u32();
  const width = r.u32();
  const depth = r.u16();
  const colorMode = r.u16();

  const modeName = COLOR_MODE_NAMES[colorMode];
  if (colorMode !== 3) {
    throw new PsdImportError(
      `${modeName ?? `Color mode ${colorMode}`} PSD files are not supported — convert the file to RGB 8-bit and try again.`,
    );
  }
  if (depth !== 8) {
    throw new PsdImportError(`${depth}-bit PSD files are not supported — convert the file to 8 bits/channel and try again.`);
  }
  if (channels !== 3 && channels !== 4) {
    throw new PsdImportError(`Unsupported channel count (${channels}) for an RGB document.`);
  }
  if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new PsdImportError(`PSD dimensions ${width}×${height} are out of the supported 1..${MAX_DIMENSION} px range.`);
  }
  return { version, channels, width, height, depth, colorMode };
}

/* ------------------------------------------------------------------ */
/* layer records                                                       */
/* ------------------------------------------------------------------ */

interface ChannelRef {
  id: number;
  /** byte length of the whole channel block, including the compression tag */
  dataLength: number;
  /** offset of the payload (after the compression u16) */
  offset: number;
  compression: number;
}

interface LayerRecord {
  top: number;
  left: number;
  width: number;
  height: number;
  opacity: number; // 0..255
  blendKey: string; // 4-char PSD key, mapped via psdBlendMode()
  visible: boolean;
  name: string;
  /** 'lsct' section divider type (0 = plain layer, 1/2 folder, 3 bounding) */
  sectionType: 0 | 1 | 2 | 3;
  channels: ChannelRef[];
}

function pascalAligned(n: number): number {
  return Math.max(4, Math.ceil(n / 4) * 4);
}

/**
 * Layer names: Photoshop's Pascal string is historically Latin-1, but modern
 * files write UTF-8 bytes and the authoritative Unicode name lives in the
 * optional 'luni' tagged block (preferred when present — see
 * `decodeUtf16be`). Strict UTF-8 decoding is attempted first; invalid
 * sequences fall back to a byte-exact Latin-1 decode (one byte = one code
 * point).
 */
function decodeLayerName(bytes: Uint8Array): string {
  if (typeof TextDecoder === 'undefined') {
    let s = '';
    for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
    return s;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let s = '';
    for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
    return s;
  }
}

/**
 * Decodes a UTF-16BE byte string (the 'luni' payload after its u32 count).
 * Surrogate code units are preserved, so astral-plane names survive.
 */
function decodeUtf16be(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  }
  return s;
}

/**
 * Reads the layer info section: pass 1 parses every layer record (rect,
 * channel infos, blend key, opacity, flags, Pascal name, additional layer
 * info — which is followed by the channel image data blocks, grouped per
 * layer in record order, whose file offsets are recorded per channel).
 * Leaves the reader just past the last channel block, before the even-length
 * section padding.
 */
function parseLayerRecords(r: PsdReader, layerInfoEnd: number): LayerRecord[] {
  const count = r.i16();
  const n = Math.abs(count); // negative count ⇒ merged-alpha nuance, layers are the same
  if (n > MAX_LAYERS) {
    throw new PsdImportError(`Corrupted layer section (${n} layers declared).`);
  }
  const records: LayerRecord[] = [];
  const declared: { id: number; dataLength: number }[][] = [];
  for (let i = 0; i < n; i += 1) {
    const top = r.i32();
    const left = r.i32();
    const bottom = r.i32();
    const right = r.i32();
    const channelCount = r.u16();
    if (channelCount > 64) {
      throw new PsdImportError(`Corrupted layer record (${channelCount} channels declared).`);
    }
    const refs: { id: number; dataLength: number }[] = [];
    for (let c = 0; c < channelCount; c += 1) {
      refs.push({ id: r.i16(), dataLength: r.u32() });
    }
    const signature = r.ascii(4);
    if (signature !== '8BIM' && signature !== '8B64') {
      throw new PsdImportError(`Unsupported layer record signature "${signature}" — the file may be corrupt.`);
    }
    const blendKey = r.ascii(4);
    const opacity = r.u8();
    r.u8(); // clipping: 0 = base, 1 = non-base (clipping stacks are not represented)
    const flags = r.u8();
    r.u8(); // filler
    const extraLength = r.u32();
    const extraEnd = r.pos + extraLength;
    if (extraEnd > layerInfoEnd) {
      throw new PsdImportError('This PSD file is truncated or corrupted.');
    }
    const maskLength = r.u32();
    r.skip(maskLength); // layer mask data — masks are not imported
    const blendRangesLength = r.u32();
    r.skip(blendRangesLength); // layer blending ranges
    const nameLength = r.u8();
    const nameBytes = r.raw(nameLength);
    const padding = pascalAligned(1 + nameLength) - 1 - nameLength;
    if (padding > 0) r.skip(padding);

    // Additional layer info (Photoshop 4+): '8BIM'/'8B64' + key + length +
    // data. Only 'lsct' (layer section divider) and 'luni' (Unicode name)
    // are meaningful here; unknown blocks are skipped by length.
    let sectionType: 0 | 1 | 2 | 3 = 0;
    let unicodeName: string | null = null;
    while (r.pos + 8 <= extraEnd) {
      const sig = r.ascii(4);
      if (sig !== '8BIM' && sig !== '8B64') break;
      const key = r.ascii(4);
      const infoLength = r.u32();
      if (infoLength > extraEnd - r.pos) break; // tolerate a corrupt tail
      const data = r.raw(infoLength);
      if (key === 'lsct' && infoLength >= 4) {
        const type = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, false);
        if (type <= 3) sectionType = type as 0 | 1 | 2 | 3;
      } else if (key === 'luni' && infoLength >= 4) {
        const units = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, false);
        if (4 + units * 2 <= infoLength) {
          const name = decodeUtf16be(data.subarray(4, 4 + units * 2));
          if (name.length > 0) unicodeName = name;
        }
      }
    }
    r.pos = extraEnd; // tolerate unknown extra fields

    declared.push(refs);
    records.push({
      top,
      left,
      width: right - left,
      height: bottom - top,
      opacity,
      blendKey,
      visible: (flags & 0x02) === 0, // PSD flag bit 1 = "not visible"
      name: unicodeName ?? decodeLayerName(nameBytes),
      sectionType,
      channels: [],
    });
  }

  // Pass 2: channel image data blocks, grouped per layer in record order.
  // Section-divider records (layer groups) declare zero-length channel info
  // — those carry no data block at all.
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const refs = declared[i] ?? [];
    for (const ref of refs) {
      if (ref.dataLength === 0) {
        record.channels.push({ id: ref.id, dataLength: 0, offset: r.pos, compression: -1 });
        continue;
      }
      if (ref.dataLength === 1) {
        throw new PsdImportError('This PSD file is truncated or corrupted.');
      }
      const compression = r.u16();
      if (compression !== 0 && compression !== 1) {
        throw new PsdImportError(`Unsupported channel compression ${compression} (expected raw or RLE).`);
      }
      record.channels.push({ id: ref.id, dataLength: ref.dataLength, offset: r.pos, compression });
      r.skip(ref.dataLength - 2);
    }
  }
  return records;
}

/* ------------------------------------------------------------------ */
/* channel decoding                                                    */
/* ------------------------------------------------------------------ */

/** Decodes one channel block into a `width`-byte-per-row plane. */
function decodeChannelPlane(r: PsdReader, channel: ChannelRef, width: number, height: number): Uint8Array {
  const payload = r.bytes.subarray(channel.offset, channel.offset + channel.dataLength - 2);
  if (channel.compression === 0) {
    if (payload.length < width * height) {
      throw new PsdImportError('This PSD file is truncated or corrupted.');
    }
    return payload.slice(0, width * height);
  }
  // RLE: u16 row byte counts for every row, then the packed rows
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  if (payload.length < 2 * height) {
    throw new PsdImportError('This PSD file is truncated or corrupted.');
  }
  let cursor = 2 * height;
  const plane = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const rowLength = view.getUint16(y * 2, false);
    if (cursor + rowLength > payload.length) {
      throw new PsdImportError('This PSD file is truncated or corrupted.');
    }
    const row = decodePackBits(payload.subarray(cursor, cursor + rowLength), width);
    plane.set(row, y * width);
    cursor += rowLength;
  }
  return plane;
}

/**
 * Decodes a layer record's channel data into a host canvas. Returns null for
 * records without pixels (empty rect) or without any color channel.
 */
function decodeLayerCanvas(r: PsdReader, record: LayerRecord): AnyCanvas | null {
  const { width, height } = record;
  if (width <= 0 || height <= 0) return null;
  const planes = new Map<number, Uint8Array>();
  for (const channel of record.channels) {
    if (channel.dataLength <= 2) continue; // no payload (divider info / bare compression tag)
    if (channel.id === -2 || channel.id === -3) continue; // user/real-user masks — not imported
    if (channel.id >= 0 ? channel.id > 2 : channel.id !== -1) {
      // unknown color/spot channel ids — reject honestly instead of guessing
      throw new PsdImportError(`Unsupported channel id ${channel.id} in layer "${record.name}".`);
    }
    planes.set(channel.id, decodeChannelPlane(r, channel, width, height));
  }
  if (!planes.has(0) && !planes.has(1) && !planes.has(2)) return null;

  const canvas = makeCanvas(width, height);
  const ctx = ctx2d(canvas);
  const img = ctx.createImageData(width, height);
  const data = img.data;
  const rPlane = planes.get(0);
  const gPlane = planes.get(1);
  const bPlane = planes.get(2);
  const aPlane = planes.get(-1); // missing alpha → opaque
  const size = width * height;
  for (let i = 0, p = 0; i < size; i += 1, p += 4) {
    data[p] = rPlane ? rPlane[i] : 0;
    data[p + 1] = gPlane ? gPlane[i] : 0;
    data[p + 2] = bPlane ? bPlane[i] : 0;
    data[p + 3] = aPlane ? aPlane[i] : 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* flattened composite (fallback)                                      */
/* ------------------------------------------------------------------ */

/** Decodes the image data section (flattened composite) into a canvas. */
function decodeCompositeImage(r: PsdReader, width: number, height: number, channels: number): AnyCanvas {
  const compression = r.u16();
  if (compression !== 0 && compression !== 1) {
    throw new PsdImportError(`Unsupported composite compression ${compression} (expected raw or RLE).`);
  }
  const size = width * height;
  const planes: Uint8Array[] = [];
  if (compression === 0) {
    for (let p = 0; p < channels; p += 1) {
      planes.push(r.raw(size).slice());
    }
  } else {
    const rowCount = channels * height;
    const rowLengths: number[] = [];
    for (let i = 0; i < rowCount; i += 1) rowLengths.push(r.u16());
    for (let p = 0; p < channels; p += 1) {
      const plane = new Uint8Array(size);
      for (let y = 0; y < height; y += 1) {
        const rowLength = rowLengths[p * height + y] ?? 0;
        const row = decodePackBits(r.raw(rowLength), width);
        plane.set(row, y * width);
      }
      planes.push(plane);
    }
  }
  const canvas = makeCanvas(width, height);
  const ctx = ctx2d(canvas);
  const img = ctx.createImageData(width, height);
  const data = img.data;
  for (let i = 0, p = 0; i < size; i += 1, p += 4) {
    data[p] = planes[0][i];
    data[p + 1] = planes[1][i];
    data[p + 2] = planes[2][i];
    // 3-channel files carry no alpha plane → opaque; 4-channel carry it
    data[p + 3] = channels >= 4 ? planes[3][i] : 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* entry points                                                        */
/* ------------------------------------------------------------------ */

const PSD_EXTENSION_RE = /\.psd$/i;

/** True when the file looks like a PSD: `.psd` extension or `8BPS` magic. */
export async function isPsdFile(file: File): Promise<boolean> {
  if (PSD_EXTENSION_RE.test(file.name)) return true;
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return (
      head.length === 4 &&
      head[0] === 0x38 && // '8'
      head[1] === 0x42 && // 'B'
      head[2] === 0x50 && // 'P'
      head[3] === 0x53 // 'S'
    );
  } catch {
    return false;
  }
}

function cleanPsdName(fileName: string): string {
  const base = fileName.replace(PSD_EXTENSION_RE, '').trim();
  return (base || 'Untitled').slice(0, 120);
}

/**
 * Parses a PSD file (v1, RGB, 8-bit — raw or RLE channel data) into layered
 * document info consumable by the open pipeline. Throws `PsdImportError`
 * with a user-facing message for every unsupported or corrupt input.
 */
export async function importPsd(source: ArrayBuffer | File): Promise<PsdImportResult> {
  const name = source instanceof File ? cleanPsdName(source.name) : 'Untitled';
  const buffer = source instanceof File ? await source.arrayBuffer() : source;
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 26) {
    throw new PsdImportError('This file is too small to be a PSD document.');
  }

  const r = new PsdReader(bytes);
  const header = readHeader(r);

  // b. color mode data (profile bytes for indexed/duotone — skipped)
  r.skip(r.u32());
  // c. image resources (skipped by length)
  r.skip(r.u32());

  // d. layer & mask information section
  const layers: ImportedLayer[] = [];
  let usedComposite = false;
  const sectionLength = r.u32();
  if (sectionLength > 0) {
    const sectionEnd = r.pos + sectionLength;
    if (sectionEnd > bytes.length) {
      throw new PsdImportError('This PSD file is truncated or corrupted.');
    }
    const layerInfoLength = r.u32();
    const layerInfoEnd = r.pos + layerInfoLength;
    if (layerInfoEnd > sectionEnd) {
      throw new PsdImportError('This PSD file is truncated or corrupted.');
    }
    let records: LayerRecord[] = [];
    if (layerInfoLength >= 2) {
      records = parseLayerRecords(r, layerInfoEnd);
    }
    r.pos = layerInfoEnd; // skip unread bytes + even-length padding

    // d2. global layer mask info (length-prefixed; skipped)
    if (r.pos + 4 <= sectionEnd) {
      r.skip(r.u32());
    }
    // tolerate trailing tagged blocks inside the section
    r.pos = sectionEnd;

    // Reconstruct the group nesting: an 'lsct' divider of type 1/2 opens a
    // group (children accumulate into it), type 3 closes the innermost open
    // group. Unterminated groups auto-close at the end; a stray type-3
    // divider without an open group is ignored.
    const openGroups: ImportedLayer[] = [];
    const attach = (layer: ImportedLayer): void => {
      const parent = openGroups[openGroups.length - 1];
      if (parent) (parent.children ??= []).push(layer);
      else layers.push(layer);
    };
    for (const record of records) {
      if (record.sectionType === 1 || record.sectionType === 2) {
        const group: ImportedLayer = {
          name: record.name || 'Group',
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          canvas: makeCanvas(1, 1), // transparent placeholder — groups have no pixels
          visible: record.visible,
          opacity: Math.min(1, Math.max(0, record.opacity / 255)),
          blend: psdBlendMode(record.blendKey),
          isGroup: true,
          expanded: record.sectionType === 1,
          children: [],
        };
        openGroups.push(group);
      } else if (record.sectionType === 3) {
        const group = openGroups.pop();
        if (group) attach(group);
      } else {
        const canvas = decodeLayerCanvas(r, record);
        if (!canvas) continue; // empty rect / no color channels
        attach({
          name: record.name || 'Layer',
          x: record.left,
          y: record.top,
          width: record.width,
          height: record.height,
          canvas,
          visible: record.visible,
          opacity: Math.min(1, Math.max(0, record.opacity / 255)),
          blend: psdBlendMode(record.blendKey),
        });
      }
    }
    let open = openGroups.pop();
    while (open) {
      attach(open); // unterminated group → auto-close at the end of the records
      open = openGroups.pop();
    }
  }

  // e. image data section — used as the flattened fallback when the file has
  // no usable layer records (zero-layer or fully skipped records)
  if (layers.length === 0) {
    const canvas = decodeCompositeImage(r, header.width, header.height, header.channels);
    layers.push({
      name: 'Background',
      x: 0,
      y: 0,
      width: header.width,
      height: header.height,
      canvas,
      visible: true,
      opacity: 1,
      blend: 'normal',
    });
    usedComposite = true;
  }

  return { name, width: header.width, height: header.height, layers, usedComposite };
}
