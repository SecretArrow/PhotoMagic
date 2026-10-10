'use client';

/**
 * EditorRoot — top-level client boundary of the editor.
 *
 * Responsibilities:
 *  - I18nProvider around everything
 *  - desktop/mobile shell switch (matchMedia ≥1024px)
 *  - crash-recovery boot protocol (see src/storage/recovery.ts header):
 *      1. wasCrashDetected() → offer the stored snapshot
 *      2. armCrashGuard() once recovery handling is settled
 *      3. each successful autosave persists a recovery snapshot + markCrashSafe()
 *  - one AutosaveManager driving .pfs serialization into IndexedDB,
 *    saved-fingerprint marking, first-run toast and storage info refresh
 */

import { useEffect, useRef, useState } from 'react';
import { useEditorStore, currentDocFingerprint } from '../state/editorStore';
import { APP_VERSION } from '../engine/document';
import { saveProjectToString } from '../documents/project';
import { getAutosaveManager } from './autosaveClient';
import {
  armCrashGuard,
  clearRecoverySnapshot,
  loadRecoverySnapshot,
  markCrashSafe,
  saveRecoverySnapshot,
  wasCrashDetected,
} from '../storage/recovery';
import { loadProject } from '../documents/project';
import { I18nProvider, useI18n } from '../i18n';
import { composeDocument } from '../engine/render';
import { toast } from '../hooks/use-toast';
import { useViewportTier, useOrientation } from './useViewportTier';
import DesktopWorkspace from './DesktopWorkspace';
import MobileWorkspace from './MobileWorkspace';
import GlobalKeys from './GlobalKeys';
import DialogHost from './dialogs/DialogHost';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function EditorRoot() {
  return (
    <I18nProvider>
      <Workspace />
    </I18nProvider>
  );
}

function Workspace() {
  const tier = useViewportTier();
  const orientation = useOrientation();
  useEffect(() => {
    // dev debugging handle (harmless in prod)
    (window as unknown as Record<string, unknown>).__pfStore = useEditorStore;
    (window as unknown as Record<string, unknown>).__pfCompose = composeDocument;
  }, []);
  const { t } = useI18n();
  const [recoveryJson, setRecoveryJson] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);

  /* boot: crash-recovery protocol */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (wasCrashDetected()) {
          const snapshot = await loadRecoverySnapshot();
          if (!cancelled && snapshot) setRecoveryJson(snapshot.json);
          await clearRecoverySnapshot();
        }
      } catch {
        /* recovery is best-effort */
      } finally {
        if (!cancelled) armCrashGuard();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* autosave lifecycle follows settings */
  const autosaveEnabled = useEditorStore((s) => s.settings.autosaveEnabled);
  const autosaveIntervalSec = useEditorStore((s) => s.settings.autosaveIntervalSec);
  const firstAutosaveToastRef = useRef(false);

  useEffect(() => {
    if (!autosaveEnabled) return;
    const manager = getAutosaveManager();
    let lastJson: string | null = null;

    manager.start(
      async () => {
        const state = useEditorStore.getState();
        const json = await saveProjectToString(state.doc, APP_VERSION);

        // keep the crash-recovery snapshot in sync (skip unchanged payloads;
        // string inequality only costs a full scan when the doc changed)
        if (json !== lastJson) {
          lastJson = json;
          void saveRecoverySnapshot(json).then(() => markCrashSafe());
        }

        // saved-fingerprint + storage info (mirrors one save cycle)
        state.markSaved(currentDocFingerprint());
        void manager
          .estimateUsage()
          .then((info) => {
            if (info) useEditorStore.getState().setStorageInfo(info);
          });

        if (!firstAutosaveToastRef.current) {
          firstAutosaveToastRef.current = true;
          toast({ title: t('toast.autosaved') });
        }
        return json;
      },
      Math.max(5, autosaveIntervalSec) * 1000,
      () => {
        const state = useEditorStore.getState();
        return { name: state.doc.name, width: state.doc.width, height: state.doc.height };
      },
    );

    return () => manager.stop();
    // t() is stable per language; language changes don't require a restart
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveEnabled, autosaveIntervalSec]);

  const acceptRecovery = async () => {
    if (!recoveryJson) return;
    setRecovering(true);
    try {
      const doc = await loadProject(recoveryJson);
      useEditorStore.getState().openDocument(doc);
      toast({ title: t('toast.recovered') });
    } catch {
      toast({ title: t('toast.importFailed', { name: t('dialog.recover.title') }) });
    } finally {
      setRecovering(false);
      setRecoveryJson(null);
      await clearRecoverySnapshot();
    }
  };

  return (
    <div
      className="pf-workspace h-[100dvh] w-full overflow-hidden"
      data-tier={tier}
      data-orientation={orientation}
    >
      {tier === 'desktop' ? <DesktopWorkspace /> : <MobileWorkspace />}
      <GlobalKeys />
      <DialogHost />

      {recoveryJson !== null ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setRecoveryJson(null);
          }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{t('dialog.recover.title')}</DialogTitle>
              <DialogDescription>{t('dialog.recover.body')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRecoveryJson(null)} disabled={recovering}>
                {t('dialog.recover.discard')}
              </Button>
              <Button onClick={() => void acceptRecovery()} disabled={recovering}>
                {t('dialog.recover.accept')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
