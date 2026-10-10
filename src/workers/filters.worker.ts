/// <reference lib="webworker" />

/**
 * PixelForge Studio — filter Web Worker.
 *
 * Runs the deterministic pixel engine (filters / adjustments / histograms)
 * off the main thread. The wire protocol lives in engine/types
 * (FilterRequest / FilterResponse). Incoming RGBA buffers are adopted as
 * views (zero-copy), processed in place and transferred back so the main
 * thread never pays for an extra copy.
 *
 * This module must stay DOM-free: it is compiled as a module worker via
 * `new Worker(new URL('./filters.worker.ts', import.meta.url), { type: 'module' })`.
 */

import { getFilter } from '../engine/filters/registry';
import { applyAdjustments } from '../engine/adjustments';
import { computeHistogram } from '../engine/color';
import { inpaintRegion } from '../engine/inpaint';
import type { FilterRequest, FilterResponse } from '../engine/types';

export {};

/**
 * Worker-scope `self`. The DOM lib also declares a global `self`, so we
 * shadow it with the DedicatedWorkerGlobalScope typing inside this module.
 */
declare const self: DedicatedWorkerGlobalScope;

function respond(response: FilterResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, transfer);
}

self.onmessage = (event: MessageEvent<FilterRequest>): void => {
  const msg = event.data;
  if (!msg || typeof msg.jobId !== 'number') return;
  const { jobId } = msg;
  try {
    switch (msg.type) {
      case 'inpaint': {
        // Content-aware fill: RGBA + hole mask both arrive transferred
        // (zero-copy) and are posted straight back after mutation.
        const data = new Uint8ClampedArray(msg.buffer);
        const mask = new Uint8Array(msg.mask);
        inpaintRegion(data, msg.width, msg.height, mask, { iterations: msg.iterations });
        respond(
          { type: 'inpaint', jobId, buffer: data.buffer, mask: mask.buffer },
          [data.buffer, mask.buffer],
        );
        break;
      }
      case 'ping': {
        respond({ type: 'pong', jobId });
        break;
      }
      case 'filter': {
        const def = getFilter(msg.op);
        if (!def) throw new Error(`Unknown filter: ${msg.op}`);
        const data = new Uint8ClampedArray(msg.buffer); // view over the cloned buffer
        def.apply(data, msg.width, msg.height, msg.params);
        respond({ type: 'filter', jobId, buffer: data.buffer }, [data.buffer]);
        break;
      }
      case 'adjust': {
        const data = new Uint8ClampedArray(msg.buffer);
        applyAdjustments(data, msg.adjustments);
        respond({ type: 'adjust', jobId, buffer: data.buffer }, [data.buffer]);
        break;
      }
      case 'histogram': {
        const data = new Uint8ClampedArray(msg.buffer);
        const hist = computeHistogram(data, msg.precision);
        respond({
          type: 'histogram',
          jobId,
          luminance: hist.luminance,
          r: hist.r,
          g: hist.g,
          b: hist.b,
          max: hist.max,
        });
        break;
      }
      default:
        break; // unknown message kinds are ignored (protocol forward-compat)
    }
  } catch (err) {
    respond({ type: 'error', jobId, message: err instanceof Error ? err.message : String(err) });
  }
};
