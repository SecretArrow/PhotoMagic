'use client';

/**
 * AboutDialog — app identity, privacy statement, license.
 */

import { APP_VERSION } from '../../engine/document';
import { getDisplayBackend } from '../../canvas/gpu';
import { HISTORY_MAX_ENTRIES, HISTORY_MEMORY_BUDGET } from '../../history';
import { useI18n } from '../../i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import type { WorkspaceDialogProps } from './NewDocumentDialog';

export default function AboutDialog({ open, onOpenChange }: WorkspaceDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-sm overflow-y-auto pf-scroll">
        <DialogHeader>
          <DialogTitle>{t('dialog.about.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('dialog.about.title')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon.svg" alt="" width={64} height={64} className="rounded-xl" />
          <div>
            <p className="text-sm font-semibold text-foreground">{t('app.name')}</p>
            <p className="text-[11px] text-muted-foreground">{t('dialog.about.version', { v: APP_VERSION })}</p>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('dialog.about.body')}</p>
          <Separator />
          <div className="w-full text-left">
            <p className="mb-1 text-[11px] font-semibold text-foreground">{t('about.underTheHood')}</p>
            <ul className="flex flex-col gap-1 text-[11px] leading-relaxed text-muted-foreground">
              <li>{t('about.privacy')}</li>
              <li>
                {t('about.renderer', {
                  backend:
                    getDisplayBackend() === 'webgpu'
                      ? t('status.rendererWebgpu')
                      : t('status.rendererCanvas2d'),
                })}
              </li>
              <li>{t('about.workers', { count: typeof Worker !== 'undefined' ? 1 : 0 })}</li>
              <li>
                {t('about.memory', {
                  mb: Math.round(HISTORY_MEMORY_BUDGET / (1024 * 1024)),
                  count: HISTORY_MAX_ENTRIES,
                })}
              </li>
            </ul>
          </div>
          <p className="text-[10px] text-muted-foreground/80">{t('dialog.about.license')}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
