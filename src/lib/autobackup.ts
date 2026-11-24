// ─────────────────────────────────────────────────────────────────────────
// Durable local backup, no backend.
//
// Two layers of durability, both local & private (nothing leaves the machine):
//   1. navigator.storage.persist() — ask the browser not to evict our IndexedDB
//      under storage pressure.
//   2. File System Access API — the user picks ONE backup file on their own
//      computer; we keep a handle to it (stored in a separate IndexedDB) and
//      silently rewrite it a few seconds after every change. No download prompts.
//      If the browser data is ever wiped, the file on disk still has everything;
//      the user re-picks it and restores. On a blank visit where a handle still
//      exists, we offer to restore automatically.
//
// File System Access is Chromium-only (Chrome/Edge). Elsewhere we degrade to
// persistent-storage + manual export/import.
// ─────────────────────────────────────────────────────────────────────────

import { db } from '../db';
import { collectBackup, importBackup, type BackupPayload } from './backup';

export const FS_SUPPORTED = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

/**
 * Brave ships Chromium but disables the File System Access API by default (it's
 * one of the APIs they gate for privacy), so showSaveFilePicker isn't present.
 * Detect Brave so we can show tailored guidance instead of "use Chrome/Edge".
 */
export async function isBraveBrowser(): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any;
  try {
    return !!(nav.brave && typeof nav.brave.isBrave === 'function' && (await nav.brave.isBrave()));
  } catch {
    return false;
  }
}

// Minimal shape of the bits of FileSystemFileHandle we use (some aren't in lib.dom).
interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  queryPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

// ---------- handle store (separate IndexedDB so it survives table clears) ----------

const HANDLE_DB = 'jobboard-fs';
const STORE = 'handles';
const KEY = 'backup';

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function handleGet(): Promise<FileHandle | undefined> {
  try {
    const idb = await openHandleDb();
    return await new Promise((resolve, reject) => {
      const r = idb.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve(r.result as FileHandle | undefined);
      r.onerror = () => reject(r.error);
    });
  } catch { return undefined; }
}
async function handlePut(h: FileHandle): Promise<void> {
  const idb = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(h, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function handleDel(): Promise<void> {
  const idb = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- permissions / file IO ----------

async function permState(h: FileHandle): Promise<PermissionState> {
  return h.queryPermission ? h.queryPermission({ mode: 'readwrite' }) : 'granted';
}
async function ensurePermission(h: FileHandle): Promise<boolean> {
  if (!h.requestPermission) return true;
  if ((await permState(h)) === 'granted') return true;
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}
async function writeFile(h: FileHandle, payload: BackupPayload): Promise<void> {
  const w = await h.createWritable();
  await w.write(JSON.stringify(payload, null, 2));
  await w.close();
}
/** Records that matter (opportunities + contacts) in a backup payload. */
export function recordCount(p: { data?: Record<string, unknown[] | undefined> } | null | undefined): number {
  return (p?.data?.opportunities?.length ?? 0) + (p?.data?.contacts?.length ?? 0);
}
/** Records in the backup file on disk, or 0 if it's empty / not a JobBoard backup. */
async function fileRecordCount(h: FileHandle): Promise<number> {
  try {
    const file = await h.getFile();
    if (file.size < 5) return 0;
    const p = JSON.parse(await file.text());
    return p?.app === 'jobboard' ? recordCount(p) : 0;
  } catch { return 0; }
}
async function fileHasData(h: FileHandle): Promise<boolean> {
  return (await fileRecordCount(h)) > 0;
}

/**
 * Would an automatic save shrink the file enough that it looks like data loss
 * (a wiped browser, a cleared database, a wrong import)? Then autosave pauses
 * and asks, rather than overwriting the one copy that still has everything.
 */
export function looksLikeDataLoss(fileRecords: number, newRecords: number): boolean {
  return fileRecords >= 5 && newRecords < fileRecords / 2;
}

// ---------- persistent storage ----------

export async function persistentStatus(): Promise<boolean> {
  return !!(navigator.storage?.persisted && (await navigator.storage.persisted()));
}
export async function requestPersistent(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

// ---------- autosave manager (module singleton) ----------

export interface BackupState {
  supported: boolean;
  connected: boolean;
  fileName: string;
  lastSaved: number | null;
  saving: boolean;
  needsReconnect: boolean; // handle stored but permission must be re-granted (needs a click)
  restorable: boolean; // DB empty but the backup file has data — offer to restore
  /** Autosave paused: saving would shrink the file from `was` to `now` records. */
  shrinkBlocked: { was: number; now: number } | null;
  persistent: boolean;
}

let state: BackupState = {
  supported: FS_SUPPORTED, connected: false, fileName: '', lastSaved: null,
  saving: false, needsReconnect: false, restorable: false, shrinkBlocked: null, persistent: false,
};
const listeners = new Set<(s: BackupState) => void>();
function set(patch: Partial<BackupState>) { state = { ...state, ...patch }; listeners.forEach((l) => l(state)); }
export function subscribeBackup(l: (s: BackupState) => void): () => void {
  listeners.add(l); l(state); return () => { listeners.delete(l); };
}
export function getBackupState(): BackupState { return state; }

let handle: FileHandle | null = null;
let dirty = false;
let saving = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void flush(); }, 3500);
}

/** Flag that data changed; debounced write a few seconds later. */
export function markDirty() {
  // While a restore is on offer, nothing is written: the file is the good copy.
  if (!handle || state.restorable) return;
  dirty = true;
  schedule();
}

/**
 * Write the database to the file. `force` is for an explicit user choice
 * ("Save now", "Save anyway"); automatic saves never overwrite a restore
 * offer or a much larger file.
 */
async function flush(force = false) {
  if (!handle || saving) return;
  if (!force && (!dirty || state.restorable || state.shrinkBlocked)) return;
  saving = true; dirty = false; set({ saving: true });
  try {
    const payload = await collectBackup();
    if (!force) {
      const was = await fileRecordCount(handle);
      const now = recordCount(payload);
      if (looksLikeDataLoss(was, now)) {
        dirty = true;
        set({ saving: false, shrinkBlocked: { was, now } });
        return;
      }
    }
    await writeFile(handle, payload);
    set({ saving: false, lastSaved: Date.now(), restorable: false, shrinkBlocked: null });
  } catch {
    dirty = true; // permission may have lapsed; surface a reconnect
    set({ saving: false, needsReconnect: true });
  } finally {
    saving = false;
    // Changes made while this save was running still need saving.
    if (dirty && !state.needsReconnect && !state.shrinkBlocked && !state.restorable) schedule();
  }
}
/** Save immediately. Pass `force` only for an explicit user choice. */
export async function saveNow(force = false): Promise<void> {
  if (!handle) return;
  if (timer) { clearTimeout(timer); timer = null; }
  dirty = true;
  await flush(force);
}

function start(h: FileHandle, restorable = false) {
  handle = h;
  set({ connected: true, fileName: h.name, needsReconnect: false, restorable, shrinkBlocked: null });
}

// Register dirty-tracking hooks on every data table, once.
let hooksInstalled = false;
function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  for (const t of db.tables) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = t as any;
    table.hook('creating', () => { markDirty(); });
    table.hook('updating', () => { markDirty(); });
    table.hook('deleting', () => { markDirty(); });
  }
  // Closing or hiding the tab: save now rather than lose the last few seconds.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && dirty && timer) { clearTimeout(timer); timer = null; void flush(); }
    });
  }
}

/** Blank database but a backup file with data: offer a restore instead of saving. */
async function shouldOfferRestore(h: FileHandle): Promise<boolean> {
  return (await db.opportunities.count()) === 0 && (await fileHasData(h));
}

/** Called once on app load: set up persistence and resume autosave if possible. */
export async function initAutoBackup(): Promise<void> {
  installHooks();
  set({ persistent: await requestPersistent() });
  if (!FS_SUPPORTED) return;
  const h = await handleGet();
  if (!h) return;
  const perm = await permState(h);
  if (perm === 'granted') {
    const offer = await shouldOfferRestore(h);
    start(h, offer);
    if (!offer) void saveNow();
  } else {
    // Stored, but the OS/browser needs a fresh click to re-grant access.
    set({ fileName: h.name, needsReconnect: true, restorable: await fileHasData(h) });
  }
}

/** User picks a backup file (first-time setup). Writes current data, unless that would shrink an existing backup. */
export async function chooseBackupFile(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h: FileHandle = await (window as any).showSaveFilePicker({
    suggestedName: 'jobboard-backup.json',
    types: [{ description: 'JobBoard backup', accept: { 'application/json': ['.json'] } }],
  });
  await handlePut(h);
  start(h);
  await saveNow();
}

/** Re-grant access to the stored file (needs a user gesture). */
export async function reconnectBackupFile(): Promise<void> {
  const h = handle ?? (await handleGet());
  if (!h) return;
  if (!(await ensurePermission(h))) return;
  await handlePut(h);
  const offer = await shouldOfferRestore(h);
  start(h, offer);
  if (!offer) await saveNow();
}

/** Restore the database from the connected backup file. */
export async function restoreFromBackupFile(): Promise<{ counts: Record<string, number> } | null> {
  const h = handle ?? (await handleGet());
  if (!h) return null;
  if (!(await ensurePermission(h))) return null;
  const file = await h.getFile();
  // Keep autosave from writing mid-import; the file already matches what we load.
  const prev = state.restorable;
  set({ restorable: true });
  let result;
  try {
    result = await importBackup(await file.text());
  } catch (e) {
    set({ restorable: prev });
    throw e;
  }
  if (timer) { clearTimeout(timer); timer = null; }
  dirty = false;
  start(h);
  return result;
}

/** Stop autosaving and forget the file (data stays; the file stays). */
export async function disconnectBackupFile(): Promise<void> {
  if (timer) clearTimeout(timer);
  handle = null;
  await handleDel();
  set({ connected: false, fileName: '', needsReconnect: false, restorable: false, shrinkBlocked: null, lastSaved: null });
}
