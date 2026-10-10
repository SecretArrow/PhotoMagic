'use client';

/**
 * HistogramPanel — document-wide RGB histogram on a small canvas.
 *
 * Recomputes debounced (250ms) on doc revision changes. Pixels come from the
 * shared composite published by CanvasStage (falls back to composing when no
 * fresh stage composite exists), downsampled to ≤512px on the long edge so
 * the copy + getImageData stay cheap. The histogram itself runs off the main
 * thread via filterRunner.runHistogram (sync in-thread fallback when Workers
 * are unavailable). Pixel sampling is wrapped in try/catch — this panel can
 * never break rendering.
 */

import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { getSharedComposite } from '../../engine/render';
import { makeCanvas, ctx2d, type AnyCanvas } from '../../engine/raster';
import { runHistogram } from '../../lib/filterRunner';
import type { HistogramResult } from '../../engine/color';
import { useI18n } from '../../i18n';

const DISPLAY_W = 200; // logical display size (~200×100 per spec)
const DISPLAY_H = 100;
const BACKING_SCALE = 2; // 2x internal resolution for crisp lines
const SAMPLE_MAX_EDGE = 512; // cap for the downsampled composite copy
const DEBOUNCE_MS = 250;
const SLOW_HINT_MS = 120; // show "processing…" only if a compute exceeds this

export default function HistogramPanel() {
  const { t } = useI18n();
  const doc = useEditorStore((s) => s.doc);
  const revision = useEditorStore((s) => s.revision);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hist, setHist] = useState<HistogramResult | null>(null);
  const [slow, setSlow] = useState(false);
  const jobRef = useRef(0);

  /* debounced recompute — a doc-wide histogram must stay off the hot path */
  useEffect(() => {
    const job = ++jobRef.current;
    let slowTimer: number | undefined;
    const timer = window.setTimeout(() => {
      void (async () => {
        setSlow(false);
        slowTimer = window.setTimeout(() => {
          if (jobRef.current === job) setSlow(true); // only after >1 frame of work
        }, SLOW_HINT_MS);
        /* sample the composited document (never touch layer internals) */
        let imageData: ImageData;
        try {
          const composite: AnyCanvas = getSharedComposite(doc);
          const scale = Math.min(1, SAMPLE_MAX_EDGE / Math.max(composite.width, composite.height));
          const sw = Math.max(1, Math.round(composite.width * scale));
          const sh = Math.max(1, Math.round(composite.height * scale));
          const sample = makeCanvas(sw, sh);
          const sctx = ctx2d(sample);
          sctx.imageSmoothingEnabled = true;
          sctx.imageSmoothingQuality = 'high';
          sctx.drawImage(composite as CanvasImageSource, 0, 0, sw, sh);
          imageData = sctx.getImageData(0, 0, sw, sh);
        } catch {
          window.clearTimeout(slowTimer);
          return; // sampling failed (tainted canvas, OOM…) — skip this round silently
        }
        try {
          const result = await runHistogram(imageData, 256);
          window.clearTimeout(slowTimer);
          if (jobRef.current !== job) return; // a newer revision arrived meanwhile
          setHist(result);
          setSlow(false);
        } catch {
          window.clearTimeout(slowTimer);
          /* worker error / fallback failure — keep the last good histogram */
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      jobRef.current++; // invalidate any in-flight result
      window.clearTimeout(timer);
      if (slowTimer !== undefined) window.clearTimeout(slowTimer);
    };
  }, [doc, revision]);

  /* paint whenever a new histogram lands */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = DISPLAY_W * BACKING_SCALE;
    const h = DISPLAY_H * BACKING_SCALE;
    canvas.width = w;
    canvas.height = h;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#232429'; // same card background as the navigator preview
    ctx.fillRect(0, 0, w, h);
    if (!hist) return;

    const max = Math.max(1, hist.max);
    const channels: { bins: number[]; stroke: string; fill: string }[] = [
      { bins: hist.r, stroke: 'rgba(255, 70, 70, 0.6)', fill: 'rgba(255, 70, 70, 0.22)' },
      { bins: hist.g, stroke: 'rgba(80, 235, 110, 0.6)', fill: 'rgba(80, 235, 110, 0.22)' },
      { bins: hist.b, stroke: 'rgba(90, 140, 255, 0.6)', fill: 'rgba(90, 140, 255, 0.22)' },
    ];
    ctx.globalCompositeOperation = 'lighter'; // screen-ish channel overlap
    ctx.lineJoin = 'round';
    const binW = w / (hist.r.length - 1);
    for (const ch of channels) {
      const yAt = (i: number) => h - Math.min(1, ch.bins[i] / max) * (h - 2);
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < ch.bins.length; i++) ctx.lineTo(i * binW, yAt(i));
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = ch.fill;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, yAt(0));
      for (let i = 1; i < ch.bins.length; i++) ctx.lineTo(i * binW, yAt(i));
      ctx.strokeStyle = ch.stroke;
      ctx.lineWidth = BACKING_SCALE;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }, [hist]);

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="relative rounded-md border border-[#2c2d33] bg-[#232429] p-2">
        <canvas
          ref={canvasRef}
          className="block h-auto w-full rounded-sm"
          style={{ aspectRatio: `${DISPLAY_W} / ${DISPLAY_H}` }}
          aria-label={t('panel.histogram')}
        />
        {slow ? (
          <span className="pointer-events-none absolute bottom-1.5 right-2 text-[9px] leading-none text-muted-foreground/70">
            {t('common.processing')}
          </span>
        ) : null}
      </div>
    </div>
  );
}
