/**
 * Content-aware fill — honest diffusion-based inpainting.
 *
 * SCOPE (read before extending): this is a Laplace/diffusion inpainter, NOT
 * texture synthesis. It smoothly interpolates hole pixels from their known
 * 4-neighbors, which reproduces smooth regions (skies, skin, walls, gradients,
 * bokeh) convincingly. It does NOT synthesize texture: structured content
 * (bricks, foliage, text, patterns) will come out blurred. There is no
 * PatchMatch/exemplar search here — that is future work and the UI copy says
 * so.
 *
 * Algorithm (deterministic, pure, no DOM / no Math.random — node-testable):
 *   1. Onion-peel initialization: repeatedly scan the hole; every still-
 *      unknown hole pixel that has at least one KNOWN 4-neighbor is assigned
 *      the average of those known neighbors and marked known. Passes repeat
 *      until every hole pixel is initialized (each pass fills the next
 *      "layer" of the onion).
 *   2. Jacobi refinement: a fixed number of Laplace smoothing iterations
 *      (default 120, override via opts.iterations) over hole pixels only,
 *      double-buffered so the result never depends on scan order. Only the
 *      RGB channels diffuse.
 *
 * Alpha policy — RGBA diffusion: the alpha channel diffuses exactly like RGB.
 * On fully opaque imagery (alpha 255 at the hole boundary) filled pixels stay
 * opaque, so photo behavior is unchanged. On transparent layers the boundary
 * transparency propagates inward — filling a selection around an object on a
 * transparent layer removes the object (reveals what is behind), which is the
 * intuitive content-aware behavior. We deliberately do NOT freeze alpha: the
 * earlier "alpha never written" policy left opaque remnants when removing
 * content drawn on transparent layers.
 *
 * Edge behavior: out-of-bounds neighbors are not counted (the divisor is the
 * number of in-bounds neighbors). Degenerate case: if the mask marks EVERY
 * pixel as a hole there is no known seed at all, so the image border ring is
 * used as the boundary condition (border pixels keep their values, the
 * interior diffuses from them).
 *
 * Mask contract: `mask[i] >= 128` means "hole to fill", anything below means
 * "keep". Callers rasterizing feathered selections should expect a hard
 * threshold at 128 (the same rule the marching-ants tracer uses).
 */

export const DEFAULT_INPAINT_ITERATIONS = 400;
/** Above this hole size the UI halves the iteration count to stay responsive. */
export const LARGE_HOLE_PIXELS = 2_000_000;
export const LARGE_HOLE_ITERATIONS = 120;

export interface InpaintOptions {
  iterations?: number;
}

/**
 * Fills masked hole pixels of an RGBA buffer in place.
 *
 * @param data   RGBA pixel buffer (width*height*4), mutated in place.
 * @param width  buffer width in pixels
 * @param height buffer height in pixels
 * @param mask   width*height bytes; >= 128 = hole, else keep
 */
export function inpaintRegion(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
  opts?: InpaintOptions,
): void {
  const n = width * height;
  if (n === 0) return;
  if (mask.length < n) throw new Error('inpaintRegion: mask smaller than image');
  if (data.length < n * 4) throw new Error('inpaintRegion: pixel buffer smaller than image');

  const isHole = new Uint8Array(n);
  let holeCount = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i] >= 128) {
      isHole[i] = 1;
      holeCount++;
    }
  }
  if (holeCount === 0) return; // nothing to fill — bit-exact no-op

  // Degenerate "select everything" case: seed the diffusion from the image
  // border ring (documented boundary fallback, see module docstring).
  if (holeCount === n) {
    for (let x = 0; x < width; x++) {
      isHole[x] = 0;
      isHole[(height - 1) * width + x] = 0;
    }
    for (let y = 0; y < height; y++) {
      isHole[y * width] = 0;
      isHole[y * width + width - 1] = 0;
    }
  }

  const iterations = Math.max(1, Math.round(opts?.iterations ?? DEFAULT_INPAINT_ITERATIONS));

  /* ---- phase 1: onion-peel initialization ------------------------------ */

  const known = new Uint8Array(n); // 1 = reliable source (grows inward)
  const init = new Float64Array(n * 4); // running RGBA estimate per hole pixel
  let remaining = 0;
  for (let i = 0; i < n; i++) {
    if (isHole[i]) remaining++;
    else known[i] = 1;
  }

  const nb = [0, 0, 0, 0];
  const neighborsOf = (i: number): number => {
    const x = i % width;
    const y = (i / width) | 0;
    let c = 0;
    if (x > 0) nb[c++] = i - 1;
    if (x < width - 1) nb[c++] = i + 1;
    if (y > 0) nb[c++] = i - width;
    if (y < height - 1) nb[c++] = i + width;
    return c;
  };

  const CH = 4; // diffused channels: R, G, B, A
  while (remaining > 0) {
    let filledThisPass = 0;
    for (let i = 0; i < n; i++) {
      if (!isHole[i] || known[i]) continue;
      const c = neighborsOf(i);
      let ch0 = 0;
      let ch1 = 0;
      let ch2 = 0;
      let ch3 = 0;
      let count = 0;
      for (let k = 0; k < c; k++) {
        const j = nb[k];
        if (!known[j]) continue;
        const o = j * 4;
        ch0 += data[o];
        ch1 += data[o + 1];
        ch2 += data[o + 2];
        ch3 += data[o + 3];
        count++;
      }
      if (count === 0) continue;
      const v = i * CH;
      init[v] = ch0 / count;
      init[v + 1] = ch1 / count;
      init[v + 2] = ch2 / count;
      init[v + 3] = ch3 / count;
      known[i] = 1;
      filledThisPass++;
    }
    if (filledThisPass === 0) break; // safety net; unreachable with n >= 1
    remaining -= filledThisPass;
  }

  /* ---- phase 2: Jacobi Laplace smoothing over hole pixels --------------- */

  // `cur` is a full-image float field (RGBA): known pixels hold their real
  // values (they are the boundary condition), hole pixels hold the onion-peel
  // estimate. `next` copies the boundary once and recomputes hole entries per
  // pass.
  let cur = new Float64Array(n * CH);
  let next = new Float64Array(n * CH);
  for (let i = 0; i < n; i++) {
    const v = i * CH;
    const o = i * 4;
    if (isHole[i]) {
      cur[v] = init[v];
      cur[v + 1] = init[v + 1];
      cur[v + 2] = init[v + 2];
      cur[v + 3] = init[v + 3];
    } else {
      cur[v] = data[o];
      cur[v + 1] = data[o + 1];
      cur[v + 2] = data[o + 2];
      cur[v + 3] = data[o + 3];
    }
    // boundary values never change; hole entries are overwritten each pass
    next[v] = cur[v];
    next[v + 1] = cur[v + 1];
    next[v + 2] = cur[v + 2];
    next[v + 3] = cur[v + 3];
  }

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      if (!isHole[i]) continue;
      const c = neighborsOf(i);
      let ch0 = 0;
      let ch1 = 0;
      let ch2 = 0;
      let ch3 = 0;
      for (let k = 0; k < c; k++) {
        const v = nb[k] * CH;
        ch0 += cur[v];
        ch1 += cur[v + 1];
        ch2 += cur[v + 2];
        ch3 += cur[v + 3];
      }
      const v = i * CH;
      next[v] = ch0 / c; // c >= 1 for every grid pixel (width/height >= 1)
      next[v + 1] = ch1 / c;
      next[v + 2] = ch2 / c;
      next[v + 3] = ch3 / c;
    }
    const swap = cur;
    cur = next;
    next = swap; // stale hole entries are fully overwritten next pass; boundary entries are identical
  }

  /* ---- write back: RGBA ------------------------------------------------- */

  for (let i = 0; i < n; i++) {
    if (!isHole[i]) continue;
    const v = i * CH;
    const o = i * 4;
    data[o] = Math.round(cur[v]);
    data[o + 1] = Math.round(cur[v + 1]);
    data[o + 2] = Math.round(cur[v + 2]);
    data[o + 3] = Math.round(cur[v + 3]);
  }
}

/**
 * Rough work estimate for the UI (unit ops ≈ hole pixels × iterations × 3
 * channels). Used to pick a responsive iteration count / hint copy — never
 * shown as a hard time promise.
 */
export function inpaintEstimateCost(
  width: number,
  height: number,
  holePx: number,
  iterations: number = DEFAULT_INPAINT_ITERATIONS,
): number {
  const area = Math.max(0, Math.min(width * height, holePx));
  return area * iterations * 3;
}
