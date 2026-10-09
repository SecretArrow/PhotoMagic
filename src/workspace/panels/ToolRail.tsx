'use client';

/**
 * ToolRail — vertical tool strip with tooltips (name + shortcut) and the
 * foreground/background color chip cluster at the bottom.
 */

import { useMemo } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { TOOL_SHORTCUTS } from '../../shortcuts';
import { formatShortcut } from '../../shortcuts';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/dictionaries';
import { TOOL_ORDER, toolIcon, toolLabelKey } from '../toolMeta';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HsvPicker } from './HsvPicker';
import { ArrowLeftRight, RotateCcw } from 'lucide-react';

/** ToolId → shortcut expression (reverse of TOOL_SHORTCUTS). */
const SHORTCUT_BY_TOOL: Record<string, string> = {};
for (const [expr, toolId] of Object.entries(TOOL_SHORTCUTS)) {
  SHORTCUT_BY_TOOL[toolId] = expr;
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
  const platform = typeof navigator.platform === 'string' ? navigator.platform : '';
  return /Mac|iPhone|iPad|iPod/.test(ua) || /Mac|iPhone|iPad|iPod/.test(platform);
}

export default function ToolRail() {
  const { t } = useI18n();
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const fgColor = useEditorStore((s) => s.fgColor);
  const bgColor = useEditorStore((s) => s.bgColor);
  const mac = useMemo(() => isMacPlatform(), []);

  return (
    <div className="pf-scroll flex w-11 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-[#2c2d33] bg-[#1b1c20] py-1.5">
      {TOOL_ORDER.map((id) => {
        const Icon = toolIcon(id);
        const name = t(toolLabelKey(id));
        const expr = SHORTCUT_BY_TOOL[id];
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="pf-tool-btn"
                data-active={tool === id || undefined}
                aria-label={name}
                onClick={() => setTool(id)}
              >
                <Icon className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="px-2 py-1 text-[11px]">
              {name}
              {expr ? <span className="ml-2 text-muted-foreground">{formatShortcut(expr, mac)}</span> : null}
            </TooltipContent>
          </Tooltip>
        );
      })}

      <div className="my-1.5 h-px w-6 shrink-0 bg-[#2c2d33]" />

      {/* fg / bg chips */}
      <div className="relative mb-1 h-11 w-11 shrink-0">
        <ColorChip
          color={bgColor}
          onChange={(hex) => useEditorStore.getState().setBgColor(hex)}
          ariaLabel={t('color.bg')}
          className="absolute bottom-0 right-0.5"
        />
        <ColorChip
          color={fgColor}
          onChange={(hex) => useEditorStore.getState().setFgColor(hex)}
          ariaLabel={t('color.fg')}
          className="absolute left-0.5 top-0 z-10"
        />
      </div>
      <div className="flex shrink-0 flex-col gap-0.5">
        <button
          type="button"
          className="pf-tool-btn h-7 w-7"
          aria-label={t('color.swap')}
          title={t('color.swap')}
          onClick={() => useEditorStore.getState().swapColors()}
        >
          <ArrowLeftRight className="size-3" />
        </button>
        <button
          type="button"
          className="pf-tool-btn h-7 w-7"
          aria-label={t('color.reset')}
          title={t('color.reset')}
          onClick={() => {
            const store = useEditorStore.getState();
            store.setFgColor('#111111');
            store.setBgColor('#ffffff');
          }}
        >
          <RotateCcw className="size-3" />
        </button>
      </div>
    </div>
  );
}

function ColorChip({
  color,
  onChange,
  ariaLabel,
  className,
}: {
  color: string;
  onChange: (hex: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          title={ariaLabel}
          className={`size-7 cursor-pointer rounded border border-[#4b4d55] shadow-md outline-none focus-visible:ring-1 focus-visible:ring-ring ${className ?? ''}`}
          style={{ backgroundColor: color }}
        />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-52 p-3">
        <HsvPicker value={color} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
