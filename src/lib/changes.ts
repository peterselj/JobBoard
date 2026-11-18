import { db } from '../db';

// One place that hears about every change to the board made in this tab (adds, edits, deletes),
// for the autosave file and for sync. Changes made in other tabs aren't reported here.

const listeners = new Set<() => void>();
let installed = false;

function install() {
  if (installed) return;
  installed = true;
  const notify = () => { listeners.forEach((l) => l()); };
  for (const t of db.tables) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = t as any;
    table.hook('creating', notify);
    table.hook('updating', notify);
    table.hook('deleting', notify);
  }
}

export function onLocalChange(listener: () => void): () => void {
  install();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
