'use client';

/**
 * NumericPromptDialog — generic number prompt used by the Select menu
 * (feather / grow / contract / border). Rendered by DesktopWorkspace.
 */

import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/dictionaries';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface NumericPromptState {
  titleKey: TranslationKey;
  min: number;
  max: number;
  initial: number;
  onApply: (value: number) => void;
}

export default function NumericPromptDialog({
  state,
  onClose,
}: {
  state: NumericPromptState | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(0);
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    setValue(state ? state.initial : 0);
  }

  const apply = () => {
    if (!state) return;
    const clamped = Math.min(state.max, Math.max(state.min, Math.round(value)));
    state.onApply(clamped);
    onClose();
  };

  return (
    <Dialog open={state !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>{state ? t(state.titleKey) : ''}</DialogTitle>
          <DialogDescription className="sr-only">{state ? t(state.titleKey) : ''}</DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          type="number"
          min={state?.min ?? 0}
          max={state?.max ?? 100}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && apply()}
          className="pf-num h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={state ? t(state.titleKey) : ''}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button onClick={apply}>{t('dialog.ok')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
