/**
 * PixelForge Studio — minimal promise-based IndexedDB wrapper.
 *
 * Backs autosave snapshots and crash-recovery snapshots with two dedicated
 * object stores inside a single database (`pixelforge`). The wrapper is
 * intentionally tiny: keyed get/set/delete/clear with a single upgrade hook
 * that creates the stores on first open.
 *
 * Every call is guarded with `typeof indexedDB === 'undefined'` and resolves
 * to `null` when IndexedDB is unavailable (SSR, tests, private-mode blocks),
 * so callers never need environment checks.
 */

export const DB_NAME = 'pixelforge';
export const DB_VERSION = 1;

/** Object stores created on upgrade. */
export type StoreName = 'autosave' | 'recovery';

/** Fixed key for the latest autosave snapshot. */
export const AUTOSAVE_KEY = 'current';
/** Fixed key for the crash-recovery snapshot. */
export const RECOVERY_KEY = 'crash';

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** Opens (and upgrades) the database. Rejects on open errors. */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('autosave')) db.createObjectStore('autosave');
      if (!db.objectStoreNames.contains('recovery')) db.createObjectStore('recovery');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked by another connection'));
  });
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Reads a value; `null` when unsupported or the key does not exist. */
export async function idbGet<T>(store: StoreName, key: string): Promise<T | null> {
  if (!hasIndexedDB()) return null;
  const db = await openDb();
  try {
    const value = await requestToPromise(db.transaction(store, 'readonly').objectStore(store).get(key));
    return (value ?? null) as T | null;
  } finally {
    db.close();
  }
}

/** Writes a value; resolves `true`, or `null` when IndexedDB is unavailable. */
export async function idbSet<T>(store: StoreName, key: string, value: T): Promise<boolean | null> {
  if (!hasIndexedDB()) return null;
  const db = await openDb();
  try {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    await transactionDone(tx);
    return true;
  } finally {
    db.close();
  }
}

/** Deletes a key; resolves `true`, or `null` when IndexedDB is unavailable. */
export async function idbDelete(store: StoreName, key: string): Promise<boolean | null> {
  if (!hasIndexedDB()) return null;
  const db = await openDb();
  try {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await transactionDone(tx);
    return true;
  } finally {
    db.close();
  }
}

/** Removes every entry of a store; resolves `true`, or `null` when unavailable. */
export async function idbClearStore(store: StoreName): Promise<boolean | null> {
  if (!hasIndexedDB()) return null;
  const db = await openDb();
  try {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    await transactionDone(tx);
    return true;
  } finally {
    db.close();
  }
}
