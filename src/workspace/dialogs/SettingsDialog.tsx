'use client';

/**
 * SettingsDialog — language, autosave, rulers/grid/snap preferences.
 * Writes through store.updateSettings (autosave restart is handled by
 * EditorRoot's effect on settings).
 */

import { useEditorStore } from '../../state/editorStore';
import { useI18n } from '../../i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { NumInput, SelectRow, SwitchRow } from '../panels/controls';
import type { WorkspaceDialogProps } from './NewDocumentDialog';

export default function SettingsDialog({ open, onOpenChange }: WorkspaceDialogProps) {
  const { t } = useI18n();
  const settings = useEditorStore((s) => s.settings);
  const update = useEditorStore((s) => s.updateSettings);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('dialog.settings.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('dialog.settings.title')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <SelectRow
            label={t('dialog.settings.language')}
            value={settings.language}
            onValueChange={(v) => update({ language: v as 'en' | 'id' })}
            items={[
              { value: 'en', label: 'English' },
              { value: 'id', label: 'Bahasa Indonesia' },
            ]}
          />
          <SwitchRow label={t('dialog.settings.autosave')} checked={settings.autosaveEnabled} onCheckedChange={(v) => update({ autosaveEnabled: v })} />
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="flex-1">{t('dialog.settings.autosaveInterval')}</span>
            <NumInput
              value={settings.autosaveIntervalSec}
              min={5}
              max={600}
              onChange={(v) => update({ autosaveIntervalSec: v })}
              className="h-7 w-20 px-2 text-xs"
              ariaLabel={t('dialog.settings.autosaveInterval')}
            />
          </div>
          <SwitchRow label={t('dialog.settings.rulers')} checked={settings.rulersVisible} onCheckedChange={(v) => update({ rulersVisible: v })} />
          <SwitchRow label={t('dialog.settings.grid')} checked={settings.gridVisible} onCheckedChange={(v) => update({ gridVisible: v })} />
          {settings.gridVisible ? (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="flex-1">{t('options.size')}</span>
              <NumInput
                value={settings.gridSize}
                min={2}
                max={500}
                onChange={(v) => update({ gridSize: v })}
                className="h-7 w-20 px-2 text-xs"
                ariaLabel={t('options.size')}
              />
            </div>
          ) : null}
          <SwitchRow label={t('dialog.settings.snap')} checked={settings.snapEnabled} onCheckedChange={(v) => update({ snapEnabled: v })} />
          <Button variant="secondary" size="sm" className="text-xs" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
