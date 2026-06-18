import { useState } from 'react';
import { APP_VERSION } from './version';
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

  if (view === 'dashboard') return <Dashboard onNavigate={setView} />;

  const title = view === 'settings' ? 'Settings' : 'Best Practices';
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-paper text-ink">
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
