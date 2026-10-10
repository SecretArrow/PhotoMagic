'use client';

/**
 * StatusBar — zoom, document size, layer count, color depth/profile,
 * JS heap (when exposed), history position and saved state.
 *
 * v2 note: live pointer position once the canvas stage publishes it.
 */

import { useEffect, useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { currentDocFingerprint } from '../../state/editorStore';
import { historyBytes } from '../../history';
import { useI18n } from '../../i18n';
import { getDisplayBackend, subscribeDisplayBackend, type DisplayBackend } from '../../canvas/gpu';

interface HeapInfo {
  usedJSHeapSize: number;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export default function StatusBar() {
  const { t } = useI18n();
  const zoom = useEditorStore((s) => s.view.zoom);
  const doc = useEditorStore((s) => s.doc);
  const history = useEditorStore((s) => s.history);
  const savedFingerprint = useEditorStore((s) => s.extras.savedFingerprint);
  const revision = useEditorStore((s) => s.revision);
  const [heapMb, setHeapMb] = useState<number | null>(null);
  /* what the stage ACTUALLY presents with (not just the preference) */
  const [backend, setBackend] = useState<DisplayBackend>(getDisplayBackend);

  useEffect(() => subscribeDisplayBackend(setBackend), []);

  useEffect(() => {
    const read = () => {
      const heap = (performance as unknown as { memory?: HeapInfo }).memory;
      if (heap && typeof heap.usedJSHeapSize === 'number') setHeapMb(heap.usedJSHeapSize / (1024 * 1024));
    };
    read();
    const timer = setInterval(read, 5000);
    return () => clearInterval(timer);
  }, []);

  const dirty = savedFingerprint === null || savedFingerprint !== currentDocFingerprint();
  const layerCount = doc.layers.length;

  return (
    <div className="flex h-7 shrink-0 items-center gap-4 overflow-hidden border-t border-[#2c2d33] bg-[#1b1c20] px-3 text-[11px] text-muted-foreground">
      <span className="shrink-0 tabular-nums" title={t('status.zoom')}>
        {t('status.zoom')} {Math.round(zoom * 100)}%
      </span>
      <span className="shrink-0 tabular-nums" title={t('status.doc')}>
        {t('status.doc')} {doc.width} × {doc.height}
      </span>
      <span className="shrink-0">{t('status.layerCount', { n: layerCount })}</span>
      <span className="hidden shrink-0 md:inline">{t('status.colorDepth')}</span>
      <span className="hidden shrink-0 md:inline">{t('status.profile')}</span>
      <span className="hidden shrink-0 md:inline" title={t('status.renderer')}>
        {backend === 'webgpu' ? t('status.rendererWebgpu') : t('status.rendererCanvas2d')}
      </span>
      {heapMb !== null ? (
        <span className="hidden shrink-0 tabular-nums lg:inline" title={t('status.memory')}>
          {t('status.memory')} {heapMb.toFixed(0)} MB
        </span>
      ) : null}
      <span className="hidden shrink-0 tabular-nums xl:inline" title={t('panel.history')}>
        {t('panel.history')} {history.index + 1}/{history.entries.length} · {formatBytes(historyBytes(history))}
      </span>
      <span className={`ml-auto shrink-0 ${dirty ? 'text-amber-400/90' : 'text-emerald-400/90'}`}>
        {dirty ? t('status.unsaved') : t('status.saved')}
      </span>
      <span className="sr-only">rev {revision}</span>
    </div>
  );
}
