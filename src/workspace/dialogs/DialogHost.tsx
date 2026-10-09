'use client';

/**
 * DialogHost — renders the modal matching store.ui.dialog. Shared by the
 * desktop and mobile workspaces. The filter gallery is driven by
 * extras.filterDialog (op + params) with ui.dialog providing open/close.
 */

import { useEditorStore } from '../../state/editorStore';
import NewDocumentDialog from './NewDocumentDialog';
import ExportDialog from './ExportDialog';
import ImageSizeDialog from './ImageSizeDialog';
import CanvasSizeDialog from './CanvasSizeDialog';
import FilterDialog from './FilterDialog';
import ShortcutsDialog from './ShortcutsDialog';
import AboutDialog from './AboutDialog';
import SettingsDialog from './SettingsDialog';
import StorageDialog from './StorageDialog';

export default function DialogHost() {
  const dialog = useEditorStore((s) => s.ui.dialog);
  const setDialog = useEditorStore((s) => s.setDialog);

  const onOpenChange = (open: boolean) => {
    if (!open) setDialog(null);
  };

  switch (dialog) {
    case 'new-document':
      return <NewDocumentDialog open onOpenChange={onOpenChange} />;
    case 'export':
      return <ExportDialog open onOpenChange={onOpenChange} />;
    case 'image-size':
      return <ImageSizeDialog open onOpenChange={onOpenChange} />;
    case 'canvas-size':
      return <CanvasSizeDialog open onOpenChange={onOpenChange} />;
    case 'filter-gallery':
      return <FilterDialog open onOpenChange={onOpenChange} />;
    case 'shortcuts':
      return <ShortcutsDialog open onOpenChange={onOpenChange} />;
    case 'about':
      return <AboutDialog open onOpenChange={onOpenChange} />;
    case 'settings':
      return <SettingsDialog open onOpenChange={onOpenChange} />;
    case 'storage':
      return <StorageDialog open onOpenChange={onOpenChange} />;
    default:
      return null;
  }
}
