import { DEFAULT_SETTINGS, DEFAULT_STAGES, db, today } from '../db';

const TABLES = ['opportunities', 'contacts', 'oppContacts', 'activities', 'stages', 'settings'] as const;

export async function exportBackup() {
  const data: Record<string, unknown[]> = {};
  for (const name of TABLES) {
    data[name] = await db.table(name).toArray();
  }
  const payload = { app: 'jobboard', version: 1, exportedAt: new Date().toISOString(), data };
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
