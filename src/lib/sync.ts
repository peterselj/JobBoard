// ─────────────────────────────────────────────────────────────────────────
// Sync between computers (optional; needs sign-in).
//
// The board still lives in this browser (IndexedDB) and the page works from that copy, so it's as
// fast as before and keeps working offline. When you're signed in, a few seconds after each change
// the whole board is sent to your account, and when you come back to a tab (or open JobBoard on
// your other computer) any newer board saved from elsewhere is loaded.
//
// Nothing here runs for people who never sign in: the Supabase code isn't even downloaded.
//
// When both this computer and your account have changes we can't line up (say you edited on both
// computers while one was offline), the page asks which board to keep and saves the other one to
// your Downloads folder first, so nothing is lost without a copy.
// ─────────────────────────────────────────────────────────────────────────

import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { clearAllData, collectBackup, downloadBackup, importBackup, type BackupPayload } from './backup';
import { db, today } from '../db';
import { onLocalChange } from './changes';
import { cloud, cloudConfigured, signInStarted } from './cloud';
import { deviceLabel, planSync, type SyncMemory } from './syncPlan';

export interface BoardCounts { opportunities: number; contacts: number }

export interface SyncChoice {
  here: BoardCounts;
  account: BoardCounts & { savedAt: string; savedBy: string };
}

export interface SyncState {
  /** Sign-in is switched on for this site (cloud.ts has a key). */
  configured: boolean;
  /** Still finding out whether this browser is signed in. */
  starting: boolean;
  email: string | null;
  status: 'signed-out' | 'syncing' | 'synced' | 'offline' | 'choose';
  lastSynced: number | null;
  error: string | null;
  /** Set while the page needs you to pick a board. */
  choice: SyncChoice | null;
}

let state: SyncState = {
  configured: cloudConfigured, starting: false, email: null, status: 'signed-out',
  lastSynced: null, error: null, choice: null,
};
const listeners = new Set<(s: SyncState) => void>();
function set(patch: Partial<SyncState>) { state = { ...state, ...patch }; listeners.forEach((l) => l(state)); }
export function subscribeSync(l: (s: SyncState) => void): () => void {
  listeners.add(l); l(state); return () => { listeners.delete(l); };
}
export function getSyncState(): SyncState { return state; }

// ---------- what this computer remembers (localStorage) ----------

const MEMORY_KEY = 'jobboard.sync';

function readMemory(userId: string): SyncMemory | null {
  try {
    const m = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? 'null') as SyncMemory | null;
    return m && m.userId === userId && typeof m.revision === 'number' ? m : null;
  } catch { return null; }
}
function writeMemory(m: SyncMemory | null) {
  try {
    if (m) localStorage.setItem(MEMORY_KEY, JSON.stringify(m));
    else localStorage.removeItem(MEMORY_KEY);
  } catch { /* storage blocked: we'll ask again next time */ }
}
function anyMemory(): SyncMemory | null {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY) ?? 'null'); } catch { return null; }
}

// ---------- helpers ----------

const SAVE_DELAY_MS = 3000;
const RETRY_MS = 60_000;
const CHECK_EVERY_MS = 5 * 60_000;

let userId: string | null = null;
/** True while we're loading the account's board, so that load doesn't count as your change. */
let applying = false;
/** Goes up with each change made here; lets a save tell whether more changes came in meanwhile. */
let changeCount = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** The account's board, held while you choose, so it can be saved to Downloads. */
let pendingAccountBoard: { payload: BackupPayload; revision: number } | null = null;

const me = () => deviceLabel(navigator.userAgent);
const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e));

function countsOf(p: BackupPayload | null | undefined): BoardCounts {
  return {
    opportunities: Array.isArray(p?.data?.opportunities) ? p!.data.opportunities.length : 0,
    contacts: Array.isArray(p?.data?.contacts) ? p!.data.contacts.length : 0,
  };
}
async function localCounts(): Promise<BoardCounts> {
  return { opportunities: await db.opportunities.count(), contacts: await db.contacts.count() };
}

async function applyAccountBoard(payload: BackupPayload, revision: number) {
  applying = true;
  try {
    await importBackup(JSON.stringify(payload));
  } finally {
    applying = false;
  }
  writeMemory({ userId: userId!, revision, dirty: false });
}

// ---------- the sync loop ----------

let running = false;
let again = false;

/** Line this computer up with the account. Safe to call often; runs one at a time. */
export async function syncNow(): Promise<void> {
  if (!userId || state.choice) return;
  if (running) { again = true; return; }
  running = true;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  set({ status: 'syncing' });
  try {
    do {
      again = false;
      await syncOnce(await cloud());
    } while (again && userId && !state.choice);
    if (userId && !state.choice) set({ status: 'synced', lastSynced: Date.now(), error: null });
  } catch (e) {
    set({ status: 'offline', error: errText(e) });
    scheduleSave(RETRY_MS);
  } finally {
    running = false;
  }
}

async function syncOnce(sb: SupabaseClient) {
  const uid = userId!;
  const { data: row, error } = await sb.from('boards').select('revision, updated_at, saved_by').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  const memory = readMemory(uid);
  const local = await localCounts();
  const step = planSync({
    remoteRevision: row ? Number(row.revision) : null,
    memory,
    localEmpty: local.opportunities === 0 && local.contacts === 0,
  });

  if (step === 'none') return;

  if (step === 'pull') {
    const { data, error: e2 } = await sb.from('boards').select('data, revision').eq('user_id', uid).single();
    if (e2) throw e2;
    await applyAccountBoard(data.data as BackupPayload, Number(data.revision));
    return;
  }

  if (step === 'ask') {
    const { data, error: e2 } = await sb.from('boards').select('data, revision, updated_at, saved_by').eq('user_id', uid).single();
    if (e2) throw e2;
    pendingAccountBoard = { payload: data.data as BackupPayload, revision: Number(data.revision) };
    set({
      status: 'choose',
      error: null,
      choice: { here: local, account: { ...countsOf(pendingAccountBoard.payload), savedAt: data.updated_at, savedBy: data.saved_by } },
    });
    return;
  }

  // 'create' or 'push': send this computer's board.
  const before = changeCount;
  const payload = await collectBackup();
  if (step === 'create') {
    const { error: e2 } = await sb.from('boards').insert({ data: payload, revision: 1, saved_by: me() });
    if (e2) {
      if (e2.code === '23505') { again = true; return; } // another computer created it a moment ago
      throw e2;
    }
    writeMemory({ userId: uid, revision: 1, dirty: changeCount !== before });
  } else {
    const base = memory!.revision;
    const { data, error: e2 } = await sb.from('boards')
      .update({ data: payload, revision: base + 1, saved_by: me() })
      .eq('user_id', uid).eq('revision', base)
      .select('revision');
    if (e2) throw e2;
    if (!data?.length) { again = true; return; } // the other computer saved first: look again
    writeMemory({ userId: uid, revision: base + 1, dirty: changeCount !== before });
  }
  if (changeCount !== before) again = true;
}

function scheduleSave(ms = SAVE_DELAY_MS) {
  if (!userId) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; void syncNow(); }, ms);
}

/** A change was made on this computer. */
function noteChange() {
  if (applying) return;
  changeCount++;
  // Remembered even while signed out (say the session lapsed), so it's sent once you're back.
  const m = anyMemory();
  if (m && !m.dirty) writeMemory({ ...m, dirty: true });
  scheduleSave();
}

// ---------- the choice ----------

/** Keep one board when both sides differ. The other is saved to Downloads first. */
export async function chooseBoard(keep: 'here' | 'account'): Promise<void> {
  const acct = pendingAccountBoard;
  if (!userId || !acct) return;
  set({ status: 'syncing', error: null });
  try {
    if (keep === 'account') {
      downloadBackup(await collectBackup(), `jobboard-this-computer-${today()}.json`);
      await applyAccountBoard(acct.payload, acct.revision);
    } else {
      downloadBackup(acct.payload, `jobboard-account-copy-${today()}.json`);
      // Save on top of the account's board as it was when we asked; dirty so the next sync sends it.
      writeMemory({ userId, revision: acct.revision, dirty: true });
    }
    pendingAccountBoard = null;
    set({ choice: null });
    await syncNow();
  } catch (e) {
    set({ status: 'choose', error: errText(e) });
  }
}

// ---------- sign-in ----------

function onSession(session: Session | null) {
  const newId = session?.user.id ?? null;
  if (newId === userId) return;
  userId = newId;
  pendingAccountBoard = null;
  if (!session) {
    set({ email: null, status: 'signed-out', choice: null, lastSynced: null });
    return;
  }
  set({ email: session.user.email ?? null, choice: null });
  // Not straight away: Supabase is still inside its own sign-in step, and calling it back from here can stall.
  setTimeout(() => { void syncNow(); }, 0);
}

let started = false;

/** Called once on app load. Does nothing unless this browser has started signing in before. */
export async function initSync(): Promise<void> {
  if (!cloudConfigured || started) return;
  onLocalChange(noteChange);
  const q = new URLSearchParams(location.search);
  const arrivingFromLink = q.has('code') || q.has('error_description');
  if (!signInStarted() && !arrivingFromLink) return;
  await startClient();
  if (arrivingFromLink) {
    const reason = q.get('error_description');
    if (reason) set({ error: `That sign-in link didn't work (${reason}). Send yourself a new one.` });
    for (const k of ['code', 'error', 'error_code', 'error_description']) q.delete(k);
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  }
}

async function startClient() {
  if (started) return;
  started = true;
  set({ starting: true });
  try {
    const sb = await cloud();
    sb.auth.onAuthStateChange((_event, session) => { onSession(session); });
    const { data, error } = await sb.auth.getSession();
    if (error) {
      set({ error: /verifier/i.test(error.message)
        ? 'Open the sign-in link in the same browser where you asked for it.'
        : error.message });
    }
    onSession(data.session);
  } catch (e) {
    set({ error: errText(e) });
  } finally {
    set({ starting: false });
  }
  document.addEventListener('visibilitychange', () => { if (userId) void syncNow(); });
  setInterval(() => { if (userId && document.visibilityState === 'visible') void syncNow(); }, CHECK_EVERY_MS);
}

/** Email a one-time sign-in link. The same link creates the account the first time. */
export async function sendSignInLink(email: string): Promise<void> {
  await startClient();
  const sb = await cloud();
  const { error } = await sb.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
}

/** Sign out on this computer. With `clear`, also remove the board from this browser. */
export async function signOut(opts: { clear?: boolean } = {}): Promise<void> {
  if (userId && anyMemory()?.dirty) await syncNow();
  const sb = await cloud();
  await sb.auth.signOut({ scope: 'local' });
  writeMemory(null);
  onSession(null);
  if (opts.clear) {
    applying = true;
    try { await clearAllData(); } finally { applying = false; }
  }
}

/** Delete the sign-in and the board saved with it. This computer's copy stays. */
export async function deleteAccount(): Promise<void> {
  const sb = await cloud();
  const { error } = await sb.rpc('delete_my_account');
  if (error) throw error;
  await sb.auth.signOut({ scope: 'local' });
  writeMemory(null);
  onSession(null);
}
