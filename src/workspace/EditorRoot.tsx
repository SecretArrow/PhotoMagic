'use client';

/**
 * EditorRoot — top-level client boundary of the editor.
 * Phase 1 scaffold: renders a functional smoke-test shell proving the engine
 * core (document model + renderer + store) works. Replaced by the full
 * workspace in the UI phase.
 */

import { useEffect, useRef } from 'react';
import { useEditorStore } from '../state/editorStore';
import { composeDocument } from '../engine/render';
import { I18nProvider, useI18n } from '../i18n';

function SmokeShell() {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const doc = useEditorStore((s) => s.doc);
  const revision = useEditorStore((s) => s.revision);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const composite = composeDocument(doc, { checker: true });
    canvas.width = doc.width;
    canvas.height = doc.height;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(composite as unknown as CanvasImageSource, 0, 0);
  }, [doc, revision]);

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-[#232429]">
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-lg font-semibold text-neutral-200">{t('app.name')}</h1>
        <p className="text-xs text-neutral-500">{t('app.tagline')}</p>
      </div>
      <canvas ref={canvasRef} className="pf-canvas max-h-[70vh] max-w-[80vw] rounded shadow-2xl" />
      <p className="text-[11px] text-neutral-500">
        {doc.width} × {doc.height} · rev {revision}
      </p>
    </div>
  );
}

export default function EditorRoot() {
  return (
    <I18nProvider>
      <SmokeShell />
    </I18nProvider>
  );
}
