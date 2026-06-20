import { useEffect, useState } from 'react';
import { APP_VERSION } from './version';
import {
  dismissRestore, initAutoBackup, reconnectBackupFile, restoreFromBackupFile,
  subscribeBackup, type BackupState,
} from './lib/autobackup';
import Dashboard from './views/Dashboard';
import Settings from './views/Settings';
import BestPractices from './views/BestPractices';

export type View = 'dashboard' | 'settings' | 'best-practices';

/**
 * v0.7 shell: the dashboard is a full-viewport, no-scroll cockpit that owns its
 * own header. Settings and Best Practices are secondary, scrollable views
 * reached from the dashboard's left rail and dismissed with "← Dashboard".
 */
export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [backup, setBackup] = useState<BackupState | null>(null);

  const navigate = (v: View, a?: string) => { setView(v); setAnchor(a ?? null); };

  useEffect(() => {
    const unsub = subscribeBackup(setBackup);
    void initAutoBackup();
    return unsub;
  }, []);

  // After switching into a sub-view, scroll to the requested section.
  useEffect(() => {
    if (view === 'dashboard' || !anchor) return;
    const t = setTimeout(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setAnchor(null);
    }, 90);
    return () => clearTimeout(t);
  }, [view, anchor]);

  const banner = backup && (backup.restorable || backup.needsReconnect)
    ? <BackupBanner state={backup} onOpenSettings={() => navigate('settings')} />
    : null;

  if (view === 'dashboard') {
    return <>{banner}<Dashboard onNavigate={navigate} /></>;
  }

  const title = view === 'settings' ? 'Settings' : 'Best Practices';
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-paper text-ink">
      {banner}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line-strong bg-white px-4">
        <button
          onClick={() => setView('dashboard')}
          className="flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1 text-sm font-medium text-ink-soft transition-colors hover:bg-paper"
        >
          ← Dashboard
        </button>
        <span className="text-sm font-bold tracking-tight">{title}</span>
        <span className="ml-auto font-mono text-[11px] text-faint">JobBoard {APP_VERSION}</span>
      </header>
      <main className="flex-1 overflow-y-auto px-6 py-6">
        {view === 'settings' ? <Settings /> : <BestPractices />}
      </main>
    </div>
  );
}

/** Thin top strip shown only when the autosave file needs a click (reconnect or restore). */
function BackupBanner({ state, onOpenSettings }: { state: BackupState; onOpenSettings: () => void }) {
  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex items-center gap-3 bg-forest px-4 py-2 text-sm text-white shadow-md">
      {state.restorable ? (
        <>
          <span className="min-w-0 flex-1 truncate">
            This browser has no data, but your backup file <span className="font-semibold">{state.fileName}</span> has a saved copy.
          </span>
          <button
            onClick={async () => { if (window.confirm('Restore all data from your backup file?')) await restoreFromBackupFile(); }}
            className="shrink-0 rounded-md bg-white/15 px-3 py-1 font-semibold hover:bg-white/25"
          >
            Restore my data
          </button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">
            Autosave is set up to <span className="font-semibold">{state.fileName}</span> — reconnect to resume saving.
          </span>
          <button onClick={() => reconnectBackupFile()} className="shrink-0 rounded-md bg-white/15 px-3 py-1 font-semibold hover:bg-white/25">Reconnect</button>
        </>
      )}
      <button onClick={() => { dismissRestore(); onOpenSettings(); }} className="shrink-0 rounded-md px-2 py-1 text-white/70 hover:text-white" title="Manage in Settings">Settings</button>
    </div>
  );
}
