import { DEFAULT_SETTINGS, DEFAULT_STAGES, db, ensureSourceConnectionStage, today } from '../db';

const TABLES = ['opportunities', 'contacts', 'oppContacts', 'referralPaths', 'activities', 'stages', 'settings'] as const;

export interface BackupPayload {
  app: 'jobboard';
  version: number;
  exportedAt: string;
  data: Record<string, unknown[]>;
}

/** Snapshot every table into a plain backup object (used by manual export + autosave). */
export async function collectBackup(): Promise<BackupPayload> {
  const data: Record<string, unknown[]> = {};
  for (const name of TABLES) {
    data[name] = await db.table(name).toArray();
  }
  return { app: 'jobboard', version: 1, exportedAt: new Date().toISOString(), data };
}

export async function exportBackup() {
  const payload = await collectBackup();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jobboard-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export interface RestoreResult {
  counts: Record<string, number>;
}

/** Replace ALL current data with the contents of a backup file. */
export async function importBackup(text: string): Promise<RestoreResult> {
  let payload: { app?: string; data?: Record<string, unknown[]> };
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Not a valid JSON file.');
  }
  if (payload.app !== 'jobboard' || !payload.data) {
    throw new Error('Not a JobBoard backup file.');
  }
  const data = payload.data;
  const counts: Record<string, number> = {};
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const name of TABLES) {
      const rows = Array.isArray(data[name]) ? data[name] : [];
      await db.table(name).clear();
      if (rows.length) await db.table(name).bulkAdd(rows);
      counts[name] = rows.length;
    }
    // Backups from v0.1 stored referral targets as contact links — convert
    // them to referral paths, same as the live-DB migration.
    const links = await db.oppContacts.toArray();
    const now = Date.now();
    for (const link of links) {
      const role = link.role as string;
      if (role === 'target-referrer' || role === 'referrer') {
        await db.referralPaths.add({
          oppId: link.oppId,
          targetContactId: link.contactId,
          viaContactId: null,
          status: role === 'referrer' ? 'referral-made' : 'identified',
          createdAt: now,
          updatedAt: now,
        });
        await db.oppContacts.delete(link.id!);
      }
    }
    // Older backups used the "intro solicited / intro made" path steps —
    // collapse them into the single "referral solicited" step.
    const paths = await db.referralPaths.toArray();
    for (const p of paths) {
      const s = p.status as string;
      if (s === 'intro-solicited' || s === 'intro-made') {
        await db.referralPaths.update(p.id!, { status: 'referral-solicited' });
      }
    }
    // v0.7: backups predating the Source Connection stage get it inserted.
    await ensureSourceConnectionStage(db.stages as never);
  });
  return { counts };
}

export async function clearAllData() {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const name of TABLES) await db.table(name).clear();
  });
  // Re-seed stages and settings so the app remains usable.
  await db.stages.bulkAdd(DEFAULT_STAGES);
  await db.settings.add(DEFAULT_SETTINGS);
}
