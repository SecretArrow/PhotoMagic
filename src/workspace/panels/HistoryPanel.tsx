'use client';

/**
 * HistoryPanel — nonlinear undo timeline. Clicking any state jumps to it
 * (walks undo/redo via store.jumpHistory). Shows memory usage in the footer.
 */

import { memo, useMemo } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { historyBytes } from '../../history';
import type { HistoryEntry, HistoryEntryKind } from '../../engine/types';
import { dictionaries, type TranslationKey } from '../../i18n/dictionaries';
import { useI18n } from '../../i18n';
import { Button } from '@/components/ui/button';
import { Brush, File, Layers2, Redo2, Settings2, SquareDashed, Undo2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const KIND_ICONS: Record<HistoryEntryKind, LucideIcon> = {
  pixel: Brush,
  structure: Layers2,
  'layer-prop': Settings2,
  selection: SquareDashed,
  document: File,
  composite: Layers2,
};

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

/** History labels may use keys added later; fall back to the entry's label. */
export function tLabel(labelKey: string, labelFallback: string, t: (k: TranslationKey) => string): string {
  if (Object.prototype.hasOwnProperty.call(dictionaries.en, labelKey)) {
    return t(labelKey as TranslationKey);
  }
  return labelFallback;
}

interface RowProps {
  entry: HistoryEntry;
  index: number;
  position: number;
  displayIndex: number;
  onJump: (index: number) => void;
}

const HistoryRow = memo(function HistoryRow({ entry, index, position, displayIndex, onJump }: RowProps) {
  const { t } = useI18n();
  const Icon = KIND_ICONS[entry.kind] ?? Layers2;
  const done = index <= position;
  return (
    <button
      type="button"
      onClick={() => onJump(index)}
      data-state={index === position ? 'current' : done ? 'past' : 'future'}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
        index === position
          ? 'bg-emerald-500/15 text-foreground'
          : done
            ? 'text-muted-foreground hover:bg-accent/60'
            : 'text-muted-foreground/40 hover:bg-accent/40'
      }`}
      title={`#${displayIndex}`}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{tLabel(entry.labelKey, entry.labelFallback, t)}</span>
    </button>
  );
});

export default function HistoryPanel() {
  const { t } = useI18n();
  const history = useEditorStore((s) => s.history);
  const jumpHistory = useEditorStore((s) => s.jumpHistory);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const bytes = useMemo(() => historyBytes(history), [history]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-[#2c2d33] p-1.5">
        <Button variant="ghost" size="icon" className="size-7" aria-label={t('edit.undo')} title={t('edit.undo')} disabled={history.index < 0} onClick={() => undo()}>
          <Undo2 className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon" className="size-7"
          aria-label={t('edit.redo')}
          title={t('edit.redo')}
          disabled={history.index >= history.entries.length - 1}
          onClick={() => redo()}
        >
          <Redo2 className="size-3.5" />
        </Button>
        <span className="ml-auto pr-1 text-[11px] text-muted-foreground">
          {history.entries.length > 0 ? `${history.index + 1}/${history.entries.length}` : ''}
        </span>
      </div>

      <div className="pf-scroll min-h-0 flex-1 overflow-y-auto p-1">
        {history.entries.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t('history.empty')}</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {history.entries
              .map((entry, index) => ({ entry, index }))
              .reverse()
              .map(({ entry, index }) => (
                <HistoryRow
                  key={entry.id}
                  entry={entry}
                  index={index}
                  position={history.index}
                  displayIndex={index + 1}
                  onJump={jumpHistory}
                />
              ))}
          </div>
        )}
      </div>

      <div className="border-t border-[#2c2d33] px-2 py-1 text-[11px] text-muted-foreground">
        {t('status.memory')}: {formatBytes(bytes)}
      </div>
    </div>
  );
}
