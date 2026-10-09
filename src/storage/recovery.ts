/**
 * PixelForge Studio — crash-recovery snapshots.
 *
 * The recovery store keeps the last known-good document JSON in IndexedDB
 * (survives crashes and restarts) plus a tiny per-tab session marker in
 * sessionStorage (survives reloads and crash-restore, not tab close) used to
 * detect an unclean exit.
 *
 * Intended protocol:
 *   1. boot:  `if (wasCrashDetected()) offerRecovery(loadRecoverySnapshot())`
 *   2. boot:  `armCrashGuard()` — marks this session as "live"
 *   3. save:  `saveRecoverySnapshot(json)` then `markCrashSafe()`
 *   4. after recovery was handled/dismissed: `clearRecoverySnapshot()`
 *
 * Everything is guarded for SSR/test environments (no-op / null / false).
 */

import { RECOVERY_KEY, idbDelete, idbGet, idbSet } from './idb';

export interface RecoverySnapshot {
  json: string;
  savedAt: number;
}

const SESSION_FLAG = 'pixelforge:session-state';
const FLAG_OPEN = 'open';
const FLAG_SAFE = 'safe';

function sessionStorageOk(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    return null; // storage disabled (privacy mode, sandbox, SSR shim)
  }
}

/* ------------------------- recovery store (IDB) ------------------------- */

/** Persists a crash-recovery snapshot (overwrites the previous one). */
export async function saveRecoverySnapshot(json: string): Promise<boolean | null> {
  const record: RecoverySnapshot = { json, savedAt: Date.now() };
  return idbSet('recovery', RECOVERY_KEY, record);
}

/** Returns the stored snapshot, or null when there is none / unsupported. */
export async function loadRecoverySnapshot(): Promise<RecoverySnapshot | null> {
  const record = await idbGet<RecoverySnapshot>('recovery', RECOVERY_KEY);
  if (!record || typeof record.json !== 'string') return null;
  return { json: record.json, savedAt: record.savedAt ?? 0 };
}

/** Removes the stored snapshot (call once recovery was handled or dismissed). */
export async function clearRecoverySnapshot(): Promise<boolean | null> {
  return idbDelete('recovery', RECOVERY_KEY);
}

/* ---------------------- session flag (sessionStorage) ---------------------- */

/**
 * Marks the current session as holding a persisted safe point. Called after
 * every successful recovery save and on graceful page hide.
 */
export function markCrashSafe(): void {
  const ss = sessionStorageOk();
  if (ss) ss.setItem(SESSION_FLAG, FLAG_SAFE);
}

/**
 * Arms the crash guard for this session ("live, not yet safe"). Called at
 * boot after the crash check. A session that dies while armed — without ever
 * reaching `markCrashSafe()` — is detected as a crash on next boot.
 */
export function armCrashGuard(): void {
  const ss = sessionStorageOk();
  if (ss) ss.setItem(SESSION_FLAG, FLAG_OPEN);
}

/**
 * True when the previous run of this tab was armed but never reached a safe
 * point (crash / force-kill). Returns false on fresh tabs and when storage
 * is unavailable (fail-safe: never nag the user spuriously).
 */
export function wasCrashDetected(): boolean {
  const ss = sessionStorageOk();
  if (!ss) return false;
  try {
    return ss.getItem(SESSION_FLAG) === FLAG_OPEN;
  } catch {
    return false;
  }
}
