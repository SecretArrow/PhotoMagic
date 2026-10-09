'use client';

/**
 * AboutDialog — app identity, privacy statement, license.
 */

import { APP_VERSION } from '../../engine/document';
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
      <DialogContent className="max-w-sm">
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
          <p className="text-[10px] text-muted-foreground/80">{t('dialog.about.license')}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
