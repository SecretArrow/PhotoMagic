'use client';

/**
 * DesktopWorkspace — the full editor shell for viewports ≥ 1024px:
 * top bar, menu bar, options bar, tool rail, resizable canvas + right panel
 * column, status bar and the numeric select-ops prompt.
 */

import { useState } from 'react';
import { useEditorStore, currentDocFingerprint } from '../state/editorStore';
import CanvasStage from '../canvas/CanvasStage';
import { useI18n } from '../i18n';
import { dispatchFit, resetWorkspace } from './commands';
import MenuBar from './panels/MenuBar';
import OptionsBar from './panels/OptionsBar';
import StatusBar from './panels/StatusBar';
import ToolRail from './panels/ToolRail';
import RightPanels from './panels/RightPanels';
import NumericPromptDialog, { type NumericPromptState } from './dialogs/NumericPromptDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Maximize, PanelRightClose, PanelRightOpen, Redo2, RotateCcw, Undo2 } from 'lucide-react';

export default function DesktopWorkspace() {
  const [numericPrompt, setNumericPrompt] = useState<NumericPromptState | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar />
      <MenuBar openNumericPrompt={setNumericPrompt} />
      <OptionsBar />
      <MiddleRow />
      <StatusBar />
      <NumericPromptDialog state={numericPrompt} onClose={() => setNumericPrompt(null)} />
    </div>
  );
}

/* ------------------------------- middle row ------------------------------- */

function MiddleRow() {
  const panelsVisible = useEditorStore((s) => s.ui.panelsVisible);

  return (
    <div className="flex min-h-0 flex-1">
      <ToolRail />
      <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={panelsVisible ? 78 : 100} minSize={30}>
          <div className="pf-workspace relative h-full w-full overflow-hidden">
            <CanvasStage />
          </div>
        </ResizablePanel>
        {panelsVisible ? (
          <>
            <ResizableHandle withHandle className="w-px bg-[#2c2d33]" />
            <ResizablePanel defaultSize={22} minSize={14} maxSize={40}>
              <RightPanels />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
    </div>
  );
}

/* --------------------------------- top bar --------------------------------- */

const ZOOM_STEPS = [0.25, 0.5, 1, 2];

function TopBar() {
  const { t } = useI18n();
  const doc = useEditorStore((s) => s.doc);
  const zoom = useEditorStore((s) => s.view.zoom);
  const history = useEditorStore((s) => s.history);
  const savedFingerprint = useEditorStore((s) => s.extras.savedFingerprint);
  const revision = useEditorStore((s) => s.revision);
  const panelsVisible = useEditorStore((s) => s.ui.panelsVisible);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const setZoom = useEditorStore((s) => s.setZoom);
  const togglePanels = useEditorStore((s) => s.togglePanels);

  const dirty = savedFingerprint === null || savedFingerprint !== currentDocFingerprint();

  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const commitName = () => {
    const next = nameDraft.trim();
    if (next && next !== doc.name) useEditorStore.getState().updateDocMeta({ name: next });
    setEditing(false);
  };

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[#2c2d33] bg-[#1b1c20] px-3">
      {/* app identity */}
      <div className="flex min-w-0 items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon.svg" alt="" width={22} height={22} className="rounded-md" />
        <span className="hidden text-xs font-semibold text-foreground lg:inline">{t('app.name')}</span>
      </div>

      {/* document name + dirty dot */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
        {editing ? (
          <Input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="h-6 w-48 text-center text-xs"
            aria-label={t('dialog.newDocument.name')}
          />
        ) : (
          <button
            type="button"
            title={t('common.rename')}
            className="max-w-60 truncate rounded px-2 py-0.5 text-xs text-foreground hover:bg-accent/60"
            onDoubleClick={() => {
              setNameDraft(doc.name);
              setEditing(true);
            }}
          >
            {doc.name}
          </button>
        )}
        <span
          aria-label={dirty ? t('status.unsaved') : t('status.saved')}
          title={dirty ? t('status.unsaved') : t('status.saved')}
          className={`size-1.5 shrink-0 rounded-full ${dirty ? 'bg-amber-400' : 'bg-emerald-400/70'}`}
        />
      </div>

      {/* history */}
      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="icon" className="size-7" aria-label={t('edit.undo')} title={t('edit.undo')} disabled={history.index < 0} onClick={() => undo()}>
          <Undo2 className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon" className="size-7"
          aria-label={t('edit.redo')}
          title={t('edit.redo')}
          disabled={history.index >= history.entries.length - 1}
          onClick={() => redo()}
        >
          <Redo2 className="size-4" />
        </Button>
      </div>

      {/* zoom */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] tabular-nums">
            {Math.round(zoom * 100)}%
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuLabel className="text-[10px] text-muted-foreground">{t('status.zoom')}</DropdownMenuLabel>
          {ZOOM_STEPS.map((z) => (
            <DropdownMenuItem key={z} onClick={() => setZoom(z)}>
              {Math.round(z * 100)}%
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={dispatchFit}>
            <Maximize className="mr-2 size-3" />
            {t('view.fitScreen')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* workspace reset + panel toggle */}
      <Button variant="ghost" size="icon" className="size-7" aria-label={t('view.resetWorkspace')} title={t('view.resetWorkspace')} onClick={resetWorkspace}>
        <RotateCcw className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" aria-label={t('view.togglePanels')} title={t('view.togglePanels')} onClick={() => togglePanels()}>
        {panelsVisible ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
      </Button>
      <span className="sr-only">rev {revision}</span>
    </div>
  );
}
