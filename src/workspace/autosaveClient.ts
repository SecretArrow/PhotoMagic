/**
 * Autosave singleton shared by the boot layer (EditorRoot) and the storage
 * dialog (clear + usage estimate). One AutosaveManager per app lifetime.
 */

'use client';

import { AutosaveManager } from '../storage/autosave';

let instance: AutosaveManager | null = null;

export function getAutosaveManager(): AutosaveManager {
  if (!instance) instance = new AutosaveManager();
  return instance;
}
