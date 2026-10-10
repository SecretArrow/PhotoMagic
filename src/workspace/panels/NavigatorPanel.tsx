'use client';

/**
 * NavigatorPanel — debounced composite preview, approximate viewport rect
 * and a zoom slider. The rect math uses the real pan/zoom from the store
 * with a size estimate for the canvas stage, so it is indicative (v1).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { getSharedComposite } from '../../engine/render';
import { paintChecker } from '../../engine/raster';
import { useI18n } from '../../i18n';
import { dispatchFit } from '../commands';
import { Button } from '@/components/ui/button';
import { SliderRow } from './controls';
import { Maximize } from 'lucide-react';

const BOX_W = 240;
const BOX_H = 176;

function estimateStageSize(panelVisible: boolean): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 1024, h: 640 };
  return {
    w: Math.max(240, window.innerWidth - (panelVisible ? 420 : 130)),
    h: Math.max(200, window.innerHeight - 190),
  };
}

export default function NavigatorPanel() {
  const { t } = useI18n();
  const doc = useEditorStore((s) => s.doc);
  const revision = useEditorStore((s) => s.revision);
  const view = useEditorStore((s) => s.view);
  const panelsVisible = useEditorStore((s) => s.ui.panelsVisible);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stageSize, setStageSize] = useState(() => estimateStageSize(panelsVisible));

  const scale = useMemo(() => Math.min(BOX_W / Math.max(1, doc.width), BOX_H / Math.max(1, doc.height)), [doc.width, doc.height]);
  const dispW = Math.max(1, Math.round(doc.width * scale));
  const dispH = Math.max(1, Math.round(doc.height * scale));

  /* debounced preview render — reuses the viewport's cached composite when it
     is fresh for this doc (CanvasStage publishes it), so no full recompose. */
  useEffect(() => {
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = dispW;
      canvas.height = dispH;
      const composite = getSharedComposite(doc);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, dispW, dispH);
        paintChecker(ctx, 0, 0, dispW, dispH, 8); // same checker the old checker:true compose drew
        ctx.drawImage(composite as unknown as CanvasImageSource, 0, 0, dispW, dispH);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [doc, revision, dispW, dispH]);

  /* refresh the stage-size estimate on layout changes (derived during render) */
  const [lastPanelsVisible, setLastPanelsVisible] = useState(panelsVisible);
  if (lastPanelsVisible !== panelsVisible) {
    setLastPanelsVisible(panelsVisible);
    setStageSize(estimateStageSize(panelsVisible));
  }
  useEffect(() => {
    const onResize = () => setStageSize(estimateStageSize(panelsVisible));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [panelsVisible]);

  /* approximate visible-document rect in preview coordinates */
  const rect = useMemo(() => {
    const docX = -view.panX / Math.max(view.zoom, 0.0001);
    const docY = -view.panY / Math.max(view.zoom, 0.0001);
    const docW = stageSize.w / Math.max(view.zoom, 0.0001);
    const docH = stageSize.h / Math.max(view.zoom, 0.0001);
    const x = Math.max(0, docX * scale);
    const y = Math.max(0, docY * scale);
    const w = Math.min(dispW - x, docW * scale);
    const h = Math.min(dispH - y, docH * scale);
    return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
  }, [view.panX, view.panY, view.zoom, stageSize, scale, dispW, dispH]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex items-center justify-center rounded-md border border-[#2c2d33] bg-[#232429] p-2">
        <div className="relative" style={{ width: dispW, height: dispH }}>
          <canvas ref={canvasRef} className="block rounded-sm" style={{ width: dispW, height: dispH }} aria-label={t('panel.navigator')} />
          {view.zoom > 1.0001 && rect.w > 0 && rect.h > 0 ? (
            <div
              className="pointer-events-none absolute border border-red-500/90 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            />
          ) : null}
        </div>
      </div>

      <SliderRow
        label={t('status.zoom')}
        value={Math.round(view.zoom * 100)}
        min={5}
        max={800}
        onValueChange={(v) => useEditorStore.getState().setZoom(v / 100)}
      />

      <Button size="sm" variant="secondary" className="h-7 text-[11px]" onClick={dispatchFit}>
        <Maximize className="mr-1 size-3" />
        {t('view.fitScreen')}
      </Button>
    </div>
  );
}
