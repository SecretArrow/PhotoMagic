'use client';

/**
 * RightPanels — tab header + the active panel body. The tab strip drives
 * store.ui.rightPanel; the same panel components are reused by the mobile
 * bottom sheet.
 */

import type { ComponentType } from 'react';
import { useEditorStore } from '../../state/editorStore';
import type { RightPanelId } from '../../state/types';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/dictionaries';
import { Compass, History as HistoryIcon, Layers, Palette, Settings2, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import LayersPanel from './LayersPanel';
import HistoryPanel from './HistoryPanel';
import AdjustmentsPanel from './AdjustmentsPanel';
import ColorPanel from './ColorPanel';
import NavigatorPanel from './NavigatorPanel';
import PropertiesPanel from './PropertiesPanel';

const TABS: { id: RightPanelId; icon: LucideIcon; labelKey: TranslationKey }[] = [
  { id: 'layers', icon: Layers, labelKey: 'panel.layers' },
  { id: 'history', icon: HistoryIcon, labelKey: 'panel.history' },
  { id: 'adjustments', icon: SlidersHorizontal, labelKey: 'panel.adjustments' },
  { id: 'color', icon: Palette, labelKey: 'panel.color' },
  { id: 'navigator', icon: Compass, labelKey: 'panel.navigator' },
  { id: 'properties', icon: Settings2, labelKey: 'panel.properties' },
];

const PANEL_BODIES: Record<RightPanelId, ComponentType> = {
  layers: LayersPanel,
  history: HistoryPanel,
  adjustments: AdjustmentsPanel,
  color: ColorPanel,
  navigator: NavigatorPanel,
  properties: PropertiesPanel,
};

export default function RightPanels() {
  const { t } = useI18n();
  const rightPanel = useEditorStore((s) => s.ui.rightPanel);
  const setRightPanel = useEditorStore((s) => s.setRightPanel);

  const Body = PANEL_BODIES[rightPanel] ?? LayersPanel;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#1b1c20]">
      <div className="flex shrink-0 items-stretch border-b border-[#2c2d33]">
        {TABS.map((tab) => {
          const active = rightPanel === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-label={t(tab.labelKey)}
              title={t(tab.labelKey)}
              data-active={active || undefined}
              onClick={() => setRightPanel(tab.id)}
              className={`flex flex-1 cursor-pointer flex-col items-center gap-0.5 px-0.5 py-1.5 text-[9px] leading-none ${
                active ? 'bg-[#26272c] text-emerald-300' : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
              }`}
            >
              <tab.icon className="size-3.5" />
              <span className="w-full truncate text-center">{t(tab.labelKey)}</span>
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1">
        <Body />
      </div>
    </div>
  );
}
