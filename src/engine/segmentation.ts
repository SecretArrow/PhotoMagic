/**
 * On-device background segmentation (zero-upload).
 *
 * Border-seeded region growing: every border pixel seeds a flood fill that
 * absorbs 4-neighbours whose colour is within `tolerance` of either the
 * neighbour it grew from (handles gradients / soft shadows) or the global
 * border average (handles noisy but uniform backgrounds). Already
 * transparent pixels are absorbed unconditionally so existing cutouts stay
 * cut out. The resulting binary mask is optionally feathered with a
 * separable box blur and multiplied into the alpha channel, giving smooth,
 * anti-aliased edges.
 *
 * Deterministic and pure: same input always yields the same output, so the
 * routine is safe to run both in the filter registry (worker + main thread)
 * and in tests.
 */

export interface RemoveBackgroundOptions {
  /** max colour distance (0..255, normalized euclidean RGB) for region growing */
  tolerance: number;
  /** mask blur radius in px (0 = hard edge, max 10) */
  feather: number;
}

/** Normalized euclidean RGB distance, 0..255 scale. */
function colorDistance(
  data: Uint8ClampedArray,
  o1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const dr = data[o1] - r2;
  const dg = data[o1 + 1] - g2;
  const db = data[o1 + 2] - b2;
  return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
}

/**
 * Removes the background from an RGBA buffer in place by growing a region
 * from the image borders and scaling alpha down accordingly.
 */
export function removeBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts: RemoveBackgroundOptions,
): void {
  if (width < 2 || height < 2 || data.length < width * height * 4) return;
  const tolerance = Math.max(0, Math.min(255, opts.tolerance));
  const n = width * height;

  /* ---- global border average (ignores already-transparent pixels) ---- */
  let br = 0;
  let bg = 0;
  let bb = 0;
  let count = 0;
  const sampleBorder = (x: number, y: number): void => {
    const o = (y * width + x) * 4;
    if (data[o + 3] >= 16) {
      br += data[o];
      bg += data[o + 1];
      bb += data[o + 2];
      count++;
    }
  };
  for (let x = 0; x < width; x++) {
    sampleBorder(x, 0);
    sampleBorder(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    sampleBorder(0, y);
    sampleBorder(width - 1, y);
  }
  if (count === 0) return; // fully transparent image: nothing to segment
  br /= count;
  bg /= count;
  bb /= count;

  /* ---- region growing from border seeds (BFS, typed arrays) ---- */
  const mask = new Uint8ClampedArray(n); // 255 = background
  const queue = new Int32Array(n); // each pixel enqueued at most once
  let head = 0;
  let tail = 0;

  const trySeed = (x: number, y: number): void => {
    const p = y * width + x;
    if (mask[p] !== 0) return;
    const o = p * 4;
    // already transparent → part of the "background" trivially
    if (data[o + 3] < 16 || colorDistance(data, o, br, bg, bb) <= tolerance) {
      mask[p] = 255;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < width; x++) {
    trySeed(x, 0);
    trySeed(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    trySeed(0, y);
    trySeed(width - 1, y);
  }

  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    const y = (p - x) / width;
    const o = p * 4;
    // neighbours join when close to the pixel they grew from OR to the
    // global border average (uniform-but-noisy backgrounds)
    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 0 ? -1 : d === 1 ? 1 : 0);
      const ny = y + (d === 2 ? -1 : d === 3 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const np = ny * width + nx;
      if (mask[np] !== 0) continue;
      const no = np * 4;
      if (colorDistance(data, no, data[o], data[o + 1], data[o + 2]) <= tolerance || colorDistance(data, no, br, bg, bb) <= tolerance) {
        mask[np] = 255;
        queue[tail++] = np;
      }
    }
  }

  /* ---- optional feather: separable box blur on the binary mask ---- */
  const radius = Math.round(Math.max(0, Math.min(10, opts.feather)));
  if (radius >= 1) {
    const tmp = new Uint8ClampedArray(n);
    blurMaskH(mask, tmp, width, height, radius);
    blurMaskV(tmp, mask, width, height, radius);
  }

  /* ---- apply: alpha *= 1 - mask/255 ---- */
  for (let p = 0; p < n; p++) {
    const m = mask[p];
    if (m === 0) continue;
    const o = p * 4;
    data[o + 3] = data[o + 3] * (1 - m / 255);
  }
}

function blurMaskH(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number): void {
  const window = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum / window;
      const add = row + Math.min(w - 1, x + r + 1);
      const sub = row + Math.max(0, x - r);
      sum += src[add] - src[sub];
    }
  }
}

function blurMaskV(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number): void {
  const window = r * 2 + 1;
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum / window;
      const add = Math.min(h - 1, y + r + 1) * w + x;
      const sub = Math.max(0, y - r) * w + x;
      sum += src[add] - src[sub];
    }
  }
}
