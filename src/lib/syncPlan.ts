// What to do when this computer and your account's saved board meet. Kept free of any browser or
// database code so it can be tested on its own (test/syncPlan.test.ts).

/** What this computer remembers about its last sync, per account. */
export interface SyncMemory {
  userId: string;
  /** The account's revision this computer last saved or loaded. */
  revision: number;
  /** This computer has changes it hasn't sent yet. */
  dirty: boolean;
}

export type SyncStep =
  /** Nothing to do: both sides match. */
  | 'none'
  /** The account has no board yet: send this computer's. */
  | 'create'
  /** Send this computer's changes on top of the account's board. */
  | 'push'
  /** Load the account's board onto this computer. */
  | 'pull'
  /** Both sides have something different and we can't tell which you want: ask. */
  | 'ask';

export function planSync(args: {
  /** The account's latest revision, or null if it has no board yet. */
  remoteRevision: number | null;
  /** What this computer remembers for this account (null if it never synced with it). */
  memory: SyncMemory | null;
  /** This computer's board has no opportunities or contacts. */
  localEmpty: boolean;
}): SyncStep {
  const { remoteRevision, memory, localEmpty } = args;
  if (remoteRevision === null) return 'create';
  if (!memory) {
    // First time this computer meets this account. An empty board here has nothing to lose.
    return localEmpty ? 'pull' : 'ask';
  }
  if (remoteRevision === memory.revision) return memory.dirty ? 'push' : 'none';
  if (remoteRevision > memory.revision) {
    // Another computer saved since. Take its board, unless this one has unsent changes too.
    return memory.dirty ? 'ask' : 'pull';
  }
  // The account is behind what this computer last saw: its board was deleted and remade elsewhere.
  return localEmpty ? 'pull' : 'ask';
}

/** A short, human name for this computer, e.g. "Mac · Chrome". */
export function deviceLabel(ua: string): string {
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'Chromebook'
    : /Linux/.test(ua) ? 'Linux'
    : 'Computer';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'browser';
  return `${os} · ${browser}`;
}
