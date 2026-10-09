'use client';

/**
 * ShortcutsDialog — grouped keyboard reference generated from
 * SHORTCUT_TABLE, formatted per platform via formatShortcut().
 */

import { useMemo } from 'react';
import { SHORTCUT_TABLE, formatShortcut, type ShortcutDef } from '../../shortcuts';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/dictionaries';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { WorkspaceDialogProps } from './NewDocumentDialog';

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
  const platform = typeof navigator.platform === 'string' ? navigator.platform : '';
  return /Mac|iPhone|iPad|iPod/.test(ua) || /Mac|iPhone|iPad|iPod/.test(platform);
}

const GROUPS: { scope: ShortcutDef['scope']; titleKey: 'shortcuts.tools' | 'shortcuts.global' | 'shortcuts.view' }[] = [
  { scope: 'global', titleKey: 'shortcuts.global' },
  { scope: 'tool', titleKey: 'shortcuts.tools' },
  { scope: 'view', titleKey: 'shortcuts.view' },
];

export default function ShortcutsDialog({ open, onOpenChange }: WorkspaceDialogProps) {
  const { t } = useI18n();
  const mac = useMemo(() => isMacPlatform(), []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('dialog.shortcuts.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('dialog.shortcuts.title')}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="flex flex-col gap-4">
            {GROUPS.map((group) => {
              const defs = SHORTCUT_TABLE.filter((d) => d.scope === group.scope);
              if (defs.length === 0) return null;
              return (
                <section key={group.scope}>
                  <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t(group.titleKey)}</h3>
                  <div className="flex flex-col gap-0.5">
                    {defs.map((def) => (
                      <div key={def.id} className="flex items-center justify-between gap-3 rounded px-2 py-1 text-xs odd:bg-accent/30">
                        <span className="truncate text-muted-foreground">{t(def.labelKey as TranslationKey)}</span>
                        <span className="flex shrink-0 gap-1">
                          {(def.keysMac && mac ? [def.keysMac] : [def.keys]).map((expr, i) => (
                            <kbd
                              key={i}
                              className="rounded border border-border bg-[#26272c] px-1.5 py-0.5 font-mono text-[10px] text-foreground"
                            >
                              {formatShortcut(expr, mac)}
                            </kbd>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
