/**
 * PixelForge Studio — main-thread filter runner.
 *
 * Singleton wrapper around the filter Web Worker (engine + worker protocol).
 * Every public API returns a Promise and transparently falls back to
 * synchronous in-thread execution when Workers are unavailable (SSR, unit
 * tests, blocked workers), so callers never need to branch.
 *
 * Buffers sent to the worker are always cloned first — the source ImageData
 * is never mutated, and the clone's ArrayBuffer is transferred for zero-copy.
 */

import type { AdjustmentSpec, FilterRequest, FilterResponse } from '../engine/types';
import { getFilter } from '../engine/filters/registry';
import { applyAdjustments } from '../engine/adjustments';
import { computeHistogram, type HistogramResult } from '../engine/color';
import { inpaintRegion, DEFAULT_INPAINT_ITERATIONS } from '../engine/inpaint';

interface PendingJob {
  resolve: (response: FilterResponse) => void;
  reject: (reason: Error) => void;
}

let worker: Worker | null = null;
let workerUnavailable = false;
let nextJobId = 1;
const pending = new Map<number, PendingJob>();

/** Lazily creates the singleton worker; returns null when unavailable. */
export function ensureWorker(): Worker | null {
  if (workerUnavailable || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/filters.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<FilterResponse>) => {
      const response = event.data;
      if (!response || !pending.has(response.jobId)) return;
      const job = pending.get(response.jobId) as PendingJob;
      pending.delete(response.jobId);
      if (response.type === 'error') job.reject(new Error(response.message));
      else job.resolve(response);
    };
    worker.onerror = () => {
      // Worker crashed (script load failure / uncaught error): reject all
      // in-flight jobs and permanently prefer the synchronous fallback.
      failAllPending(new Error('Filter worker crashed'));
      worker = null;
      workerUnavailable = true;
    };
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

function failAllPending(error: Error): void {
  for (const job of pending.values()) job.reject(error);
  pending.clear();
}

function send(request: FilterRequest, transfer: Transferable[]): Promise<FilterResponse> {
  const w = ensureWorker();
  if (!w) return Promise.reject(new Error('Worker unavailable'));
  return new Promise<FilterResponse>((resolve, reject) => {
    pending.set(request.jobId, { resolve, reject });
    try {
      w.postMessage(request, transfer);
    } catch (err) {
      pending.delete(request.jobId);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** Clones the pixel buffer so the original ImageData is never detached. */
function cloneBuffer(imageData: ImageData): ArrayBuffer {
  return new Uint8ClampedArray(imageData.data).buffer;
}

function toImageData(buffer: ArrayBuffer, width: number, height: number): ImageData {
  return new ImageData(new Uint8ClampedArray(buffer), width, height);
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/** Applies a registry filter (see engine/filters/registry) to a copy of the image. */
export function runFilter(
  imageData: ImageData,
  op: string,
  params: Record<string, number | string | boolean> = {},
): Promise<ImageData> {
  const { width, height } = imageData;
  const buffer = cloneBuffer(imageData);
  const w = ensureWorker();
  if (!w) return syncFilter(buffer, width, height, op, params);
  const jobId = nextJobId++;
  return send({ type: 'filter', jobId, op, params, width, height, buffer }, [buffer]).then((response) => {
    if (response.type !== 'filter') throw new Error('Unexpected worker response');
    return toImageData(response.buffer, width, height);
  });
}

/** Applies a chain of adjustments (see engine/adjustments) to a copy of the image. */
export function runAdjust(imageData: ImageData, specs: AdjustmentSpec[]): Promise<ImageData> {
  const { width, height } = imageData;
  const buffer = cloneBuffer(imageData);
  const w = ensureWorker();
  if (!w) return syncAdjust(buffer, width, height, specs);
  const jobId = nextJobId++;
  return send({ type: 'adjust', jobId, adjustments: specs, width, height, buffer }, [buffer]).then((response) => {
    if (response.type !== 'adjust') throw new Error('Unexpected worker response');
    return toImageData(response.buffer, width, height);
  });
}

/** Computes per-channel + luma histograms (see engine/color). */
export function runHistogram(imageData: ImageData, precision = 256): Promise<HistogramResult> {
  const buffer = cloneBuffer(imageData);
  const w = ensureWorker();
  if (!w) return Promise.resolve(computeHistogram(new Uint8ClampedArray(buffer), precision));
  const jobId = nextJobId++;
  return send({ type: 'histogram', jobId, buffer, precision }, [buffer]).then((response) => {
    if (response.type !== 'histogram') throw new Error('Unexpected worker response');
    return { r: response.r, g: response.g, b: response.b, luminance: response.luminance, max: response.max };
  });
}

/**
 * Content-aware fill (see engine/inpaint): diffuses the masked hole pixels
 * of a COPY of `imageData` (holes where `mask >= 128`). Both the pixel buffer
 * and the mask are cloned before being transferred, so the caller's ImageData
 * and mask are never detached or mutated. Falls back to synchronous in-thread
 * execution when Workers are unavailable.
 */
export function runInpaint(imageData: ImageData, mask: Uint8Array, iterations?: number): Promise<ImageData> {
  const { width, height } = imageData;
  if (mask.length < width * height) return Promise.reject(new Error('Inpaint mask smaller than image'));
  const buffer = cloneBuffer(imageData);
  const maskCopy = mask.slice(); // own buffer — the transfer must not detach the caller's mask
  const w = ensureWorker();
  if (!w) return syncInpaint(buffer, maskCopy, width, height, iterations);
  const jobId = nextJobId++;
  return send(
    {
      type: 'inpaint',
      jobId,
      width,
      height,
      iterations: iterations ?? DEFAULT_INPAINT_ITERATIONS,
      buffer,
      mask: maskCopy.buffer as ArrayBuffer,
    },
    [buffer, maskCopy.buffer as ArrayBuffer],
  ).then((response) => {
    if (response.type !== 'inpaint') throw new Error('Unexpected worker response');
    return toImageData(response.buffer, width, height);
  });
}

/** Terminates the worker and rejects anything still in flight. */
export function disposeRunner(): void {
  failAllPending(new Error('Filter runner disposed'));
  if (worker) {
    worker.terminate();
    worker = null;
  }
  workerUnavailable = false;
}

/* ------------------------------------------------------------------ */
/* synchronous fallback (no Worker available)                          */
/* ------------------------------------------------------------------ */

function syncFilter(
  buffer: ArrayBuffer,
  width: number,
  height: number,
  op: string,
  params: Record<string, number | string | boolean>,
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const def = getFilter(op);
    if (!def) {
      reject(new Error(`Unknown filter: ${op}`));
      return;
    }
    const data = new Uint8ClampedArray(buffer);
    try {
      def.apply(data, width, height, params);
      resolve(toImageData(data.buffer, width, height));
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function syncAdjust(buffer: ArrayBuffer, width: number, height: number, specs: AdjustmentSpec[]): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const data = new Uint8ClampedArray(buffer);
    try {
      applyAdjustments(data, specs);
      resolve(toImageData(data.buffer, width, height));
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function syncInpaint(
  buffer: ArrayBuffer,
  mask: Uint8Array,
  width: number,
  height: number,
  iterations: number | undefined,
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const data = new Uint8ClampedArray(buffer);
    try {
      inpaintRegion(data, width, height, mask, { iterations });
      resolve(toImageData(data.buffer, width, height));
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
