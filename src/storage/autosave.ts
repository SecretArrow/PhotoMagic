/**
 * PixelForge Studio — autosave manager.
 *
 * Periodically persists the current document (serialized .pfs JSON) into the
 * IndexedDB `autosave` store under the fixed key `current`, so an accidental
 * tab close or reload never loses more than one interval of work.
 *
 * Behavior:
 *  - skips writes when the serialized JSON is unchanged (FNV-1a hash compare)
 *  - saves eagerly on `visibilitychange → hidden` and on `pagehide`
 *  - never throws into the UI; all storage failures are swallowed
 *
 * Client-only: all persistence calls are SSR/test-safe (see storage/idb).
 */

import { AUTOSAVE_KEY, idbDelete, idbGet, idbSet } from './idb';

export interface AutosaveMeta {
  name: string;
  width: number;
  height: number;
}

/** Shape stored under 'autosave' / 'current'. */
export interface AutosaveRecord {
  json: string;
  savedAt: number;
  /** hash of `json` at write time (change detection across sessions) */
  hash: string;
  meta: AutosaveMeta | null;
}

export interface AutosaveSnapshot {
  json: string;
  savedAt: number;
}

/** Deterministic FNV-1a hash + length suffix — cheap change detection. */
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16).padStart(8, '0')}:${s.length.toString(16)}`;
}

const MIN_INTERVAL_MS = 1000;

export class AutosaveManager {
  private getJson: (() => Promise<string>) | null = null;
  private getMeta: (() => AutosaveMeta | null) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastHash: string | null = null;
  private inFlight = false;
  private queued = false;

  /**
   * Starts the interval-based autosave loop and page-lifecycle listeners.
   * Safe to call again — restarts cleanly.
   */
  start(
    getJson: () => Promise<string>,
    intervalMs: number,
    getMeta?: () => AutosaveMeta | null,
  ): void {
    this.stop();
    this.getJson = getJson;
    this.getMeta = getMeta ?? null;
    this.lastHash = null; // first tick always writes a fresh baseline
    const interval = Math.max(MIN_INTERVAL_MS, Math.round(intervalMs));
    this.timer = setInterval(() => void this.persist(), interval);

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', this.onPageHide);
    }
  }

  /** Stops timers and page-lifecycle listeners without touching stored data. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('pagehide', this.onPageHide);
    }
    this.getJson = null;
    this.getMeta = null;
  }

  /** Removes the stored autosave snapshot and forgets the change baseline. */
  async clear(): Promise<void> {
    this.lastHash = null;
    await idbDelete('autosave', AUTOSAVE_KEY);
  }

  /** Returns the newest stored snapshot, or null when there is none. */
  async restore(): Promise<AutosaveSnapshot | null> {
    const record = await idbGet<AutosaveRecord>('autosave', AUTOSAVE_KEY);
    if (!record || typeof record.json !== 'string') return null;
    return { json: record.json, savedAt: record.savedAt ?? 0 };
  }

  /** Storage usage estimate (bytes) via the Storage Quota API, or null. */
  async estimateUsage(): Promise<{ usage: number; quota: number } | null> {
    try {
      if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.estimate !== 'function') {
        return null;
      }
      const est = await navigator.storage.estimate();
      return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
    } catch {
      return null;
    }
  }

  /**
   * Runs one save cycle immediately (also used by lifecycle listeners).
   * Concurrent calls are coalesced; unchanged JSON is skipped by hash.
   */
  async saveNow(): Promise<void> {
    await this.persist();
  }

  private onVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      void this.persist();
    }
  };

  private onPageHide = (): void => {
    void this.persist();
  };

  private async persist(): Promise<void> {
    const getJson = this.getJson;
    if (!getJson) return;
    if (this.inFlight) {
      this.queued = true; // coalesce overlapping ticks
      return;
    }
    this.inFlight = true;
    try {
      const json = await getJson();
      const hash = hashString(json);
      if (hash === this.lastHash) return; // document unchanged — skip write
      const record: AutosaveRecord = {
        json,
        savedAt: Date.now(),
        hash,
        meta: this.getMeta ? this.getMeta() : null,
      };
      await idbSet('autosave', AUTOSAVE_KEY, record);
      this.lastHash = hash;
    } catch {
      // Autosave is best-effort; a full/quota storage must never break editing.
    } finally {
      this.inFlight = false;
      if (this.queued) {
        this.queued = false;
        void this.persist();
      }
    }
  }
}
