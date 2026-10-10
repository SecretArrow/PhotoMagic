'use client';

/**
 * MobileWorkspace — compact shell below 1024px: slim top bar, canvas,
 * floating zoom controls, scrollable tool dock, slide-up panel sheet and a
 * full tools grid sheet. Panel components are shared with the desktop shell.
 */

import { useRef, type ChangeEvent } from 'react';
import { useEditorStore } from '../state/editorStore';
import type { UiState } from '../state/types';
import CanvasStage from '../canvas/CanvasStage';
import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n/dictionaries';
import { dispatchFit, handleOpenFiles } from './commands';
import { MOBILE_TOOL_ORDER, TOOL_ORDER, toolIcon, toolLabelKey } from './toolMeta';
import OptionsBar from './panels/OptionsBar';
import LayersPanel from './panels/LayersPanel';
import HistoryPanel from './panels/HistoryPanel';
import AdjustmentsPanel from './panels/AdjustmentsPanel';
import ColorPanel from './panels/ColorPanel';
import HistogramPanel from './panels/HistogramPanel';
import PropertiesPanel from './panels/PropertiesPanel';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Download,
  LayoutGrid,
  Maximize,
  MoreHorizontal,
  PanelBottom,
  Plus,
  Redo2,
  Undo2,
} from 'lucide-react';

const MOBILE_TABS: { id: NonNullable<UiState['mobilePanel']>; labelKey: TranslationKey }[] = [
  { id: 'layers', labelKey: 'panel.layers' },
  { id: 'history', labelKey: 'panel.history' },
  { id: 'adjustments', labelKey: 'panel.adjustments' },
  { id: 'color', labelKey: 'panel.color' },
  { id: 'histogram', labelKey: 'panel.histogram' },
  { id: 'properties', labelKey: 'panel.properties' },
];

export default function MobileWorkspace() {
  const { t } = useI18n();
  const doc = useEditorStore((s) => s.doc);
  const history = useEditorStore((s) => s.history);
  const tool = useEditorStore((s) => s.tool);
  const mobilePanel = useEditorStore((s) => s.ui.mobilePanel);
  const mobileToolbarSheet = useEditorStore((s) => s.ui.mobileToolbarSheet);
  const setTool = useEditorStore((s) => s.setTool);
  const setMobilePanel = useEditorStore((s) => s.setMobilePanel);
  const setMobileToolbarSheet = useEditorStore((s) => s.setMobileToolbarSheet);
  const workRef = useRef<HTMLDivElement | null>(null);
  /** hidden picker for "Open image…" — feeds the shared handleOpenFiles pipeline */
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onImportFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (files && files.length > 0) void handleOpenFiles(files);
    e.target.value = ''; // allow re-picking the same file
  };

  /** zoom to exactly 100% keeping the viewport center anchored */
  const zoomTo100 = (): void => {
    const el = workRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const st = useEditorStore.getState();
    st.zoomBy(1 / st.view.zoom, rect.width / 2, rect.height / 2);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* top bar (safe-area aware) */}
      <div
        className="flex min-h-11 shrink-0 items-center gap-1 border-b border-[#2c2d33] bg-[#1b1c20] px-2"
        style={{ paddingTop: 'var(--pf-safe-top)' }}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{doc.name}</span>
        <Button variant="ghost" size="icon" className="size-11" aria-label={t('mobile.undo')} disabled={history.index < 0} onClick={() => useEditorStore.getState().undo()}>
          <Undo2 className="size-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon" className="size-11"
          aria-label={t('mobile.redo')}
          disabled={history.index >= history.entries.length - 1}
          onClick={() => useEditorStore.getState().redo()}
        >
          <Redo2 className="size-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon" className="size-11"
          aria-label={t('mobile.panels')}
          onClick={() => setMobilePanel(mobilePanel ?? 'layers')}
        >
          <PanelBottom className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-11" aria-label={t('file.export')} onClick={() => useEditorStore.getState().setDialog('export')}>
          <Download className="size-5" />
        </Button>
        {/* ⋯ overflow menu — the mobile entry point for file/dialog commands */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-11" aria-label={t('mobile.more')}>
              <MoreHorizontal className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" className="w-56">
            <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>{t('mobile.openImage')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useEditorStore.getState().setDialog('new-document')}>{t('file.new')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useEditorStore.getState().setDialog('image-size')}>{t('image.imageSize')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useEditorStore.getState().setDialog('canvas-size')}>{t('image.canvasSize')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useEditorStore.getState().setDialog('filter-gallery')}>{t('filter.gallery')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => useEditorStore.getState().setDialog('settings')}>{t('edit.preferences')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useEditorStore.getState().setDialog('storage')}>{t('dialog.settings.storage')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useEditorStore.getState().setDialog('about')}>{t('help.about')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* canvas + floating zoom */}
      <div ref={workRef} className="pf-workspace relative min-h-0 flex-1 overflow-hidden">
        <CanvasStage />
        <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-2">
          <button
            type="button"
            aria-label={t('view.zoomIn')}
            className="flex size-11 items-center justify-center rounded-full border border-[#3a3b42] bg-black/40 text-foreground backdrop-blur-sm active:bg-black/60"
            onClick={() => useEditorStore.getState().zoomBy(1.25)}
          >
            <Plus className="size-5" />
          </button>
          <button
            type="button"
            aria-label={t('view.zoomOut')}
            className="flex size-11 items-center justify-center rounded-full border border-[#3a3b42] bg-black/40 text-foreground backdrop-blur-sm active:bg-black/60"
            onClick={() => useEditorStore.getState().zoomBy(1 / 1.25)}
          >
            <span className="text-lg leading-none">−</span>
          </button>
          <button
            type="button"
            aria-label={t('view.actualSize')}
            className="flex size-11 items-center justify-center rounded-full border border-[#3a3b42] bg-black/40 text-[10px] font-semibold text-foreground backdrop-blur-sm active:bg-black/60"
            onClick={zoomTo100}
          >
            1:1
          </button>
          <button
            type="button"
            aria-label={t('view.fitScreen')}
            className="flex size-11 items-center justify-center rounded-full border border-[#3a3b42] bg-black/40 text-foreground backdrop-blur-sm active:bg-black/60"
            onClick={dispatchFit}
          >
            <Maximize className="size-4" />
          </button>
        </div>
      </div>

      {/* hidden image picker — same handleOpenFiles pipeline as the desktop menu */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={onImportFile}
      />

      {/* context-sensitive tool options (crop apply/cancel, brush sliders…) */}
      <OptionsBar />

      {/* tool dock (safe-area aware) */}
      <div
        className="pf-scroll flex h-14 shrink-0 items-center gap-1 overflow-x-auto border-t border-[#2c2d33] bg-[#1b1c20] px-2"
        style={{ paddingBottom: 'var(--pf-safe-bottom)' }}
      >
        {MOBILE_TOOL_ORDER.map((id) => {
          const Icon = toolIcon(id);
          const name = t(toolLabelKey(id));
          return (
            <button
              key={id}
              type="button"
              className="pf-tool-btn h-11 w-11 shrink-0"
              data-active={tool === id || undefined}
              aria-label={name}
              onClick={() => setTool(id)}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
        <Button
          variant="ghost"
          size="icon"
          className="ml-1 h-11 w-11 shrink-0"
          aria-label={t('mobile.more')}
          onClick={() => setMobileToolbarSheet(true)}
        >
          <LayoutGrid className="size-4" />
        </Button>
      </div>

      {/* slide-up panel sheet */}
      <Sheet open={mobilePanel !== null} onOpenChange={(open) => !open && setMobilePanel(null)}>
        <SheetContent side="bottom" className="h-[45vh] gap-0 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{t('mobile.panels')}</SheetTitle>
          </SheetHeader>
          <Tabs
            value={mobilePanel ?? 'layers'}
            onValueChange={(v) => setMobilePanel(v as UiState['mobilePanel'])}
            className="flex h-full min-h-0 flex-col gap-0"
          >
            <TabsList className="h-13 w-full shrink-0 justify-start rounded-none border-b border-[#2c2d33] bg-[#1b1c20] p-1">
              {MOBILE_TABS.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id} className="min-h-11 px-1 text-[10px]">
                  {t(tab.labelKey)}
                </TabsTrigger>
              ))}
            </TabsList>
            {MOBILE_TABS.map((tab) => (
              <TabsContent key={tab.id} value={tab.id} className="mt-0 min-h-0 flex-1">
                <MobileTabBody id={tab.id} />
              </TabsContent>
            ))}
          </Tabs>
        </SheetContent>
      </Sheet>

      {/* full tools grid sheet */}
      <Sheet open={mobileToolbarSheet} onOpenChange={setMobileToolbarSheet}>
        <SheetContent side="bottom" className="h-[65vh] p-4">
          <SheetHeader className="p-0 pb-2">
            <SheetTitle className="text-sm">{t('mobile.tools')}</SheetTitle>
          </SheetHeader>
          <div className="pf-scroll grid max-h-full grid-cols-4 gap-1.5 overflow-y-auto pb-4">
            {TOOL_ORDER.map((id) => {
              const Icon = toolIcon(id);
              const name = t(toolLabelKey(id));
              return (
                <button
                  key={id}
                  type="button"
                  data-active={tool === id || undefined}
                  aria-label={name}
                  onClick={() => {
                    setTool(id);
                    setMobileToolbarSheet(false);
                  }}
                  className={`flex h-16 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border text-[10px] ${
                    tool === id ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300' : 'border-border text-muted-foreground hover:bg-accent'
                  }`}
                >
                  <Icon className="size-4" />
                  <span className="leading-none">{name}</span>
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function MobileTabBody({ id }: { id: NonNullable<UiState['mobilePanel']> }) {
  switch (id) {
    case 'layers':
      return <LayersPanel />;
    case 'history':
      return <HistoryPanel />;
    case 'adjustments':
      return <AdjustmentsPanel />;
    case 'color':
      return <ColorPanel />;
    case 'histogram':
      return <HistogramPanel />;
    case 'properties':
      return <PropertiesPanel />;
    default:
      return null;
  }
}
