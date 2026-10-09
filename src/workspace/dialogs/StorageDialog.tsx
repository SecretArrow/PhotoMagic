'use client';

/**
 * StorageDialog — IndexedDB usage vs quota and a clear-data action
 * (autosave snapshot + recovery snapshot + stored estimate refresh).
 */

import { useEffect, useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { getAutosaveManager } from '../autosaveClient';
import { clearRecoverySnapshot } from '../../storage/recovery';
import { useI18n } from '../../i18n';
import { toast } from '../../hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export default function StorageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const storageInfo = useEditorStore((s) => s.ui.storageInfo);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!open) return;
    void getAutosaveManager()
      .estimateUsage()
      .then((info) => {
        if (info) useEditorStore.getState().setStorageInfo(info);
      });
  }, [open]);

  const usage = storageInfo?.usage ?? 0;
  const quota = storageInfo?.quota ?? 0;
  const pct = quota > 0 ? Math.min(100, (usage / quota) * 100) : 0;

  const clear = async () => {
    setClearing(true);
    try {
      await getAutosaveManager().clear();
      await clearRecoverySnapshot();
      toast({ title: t('toast.storageCleared') });
      const info = await getAutosaveManager().estimateUsage();
      useEditorStore.getState().setStorageInfo(info);
    } finally {
      setClearing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('dialog.settings.storage')}</DialogTitle>
          <DialogDescription className="sr-only">{t('dialog.settings.storage')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Progress value={pct} aria-label={t('dialog.settings.storage')} />
          <p className="text-[11px] text-muted-foreground">
            {t('dialog.storage.used')}: {formatBytes(usage)} {quota > 0 ? `/ ${formatBytes(quota)} (${pct.toFixed(1)}%)` : ''}
          </p>
          {quota === 0 ? (
            <p className="text-[10px] text-muted-foreground/80">{t('common.loading')}</p>
          ) : null}
          <Button variant="destructive" size="sm" className="text-xs" disabled={clearing} onClick={() => void clear()}>
            {t('dialog.storage.clear')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
