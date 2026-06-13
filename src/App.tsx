import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { expectedOffers, stageMap } from './lib/pipeline';
import { formatExpectedOffers } from './lib/format';
import { APP_VERSION } from './version';
import { Button } from './components/ui';
import QuickAddOpp from './components/QuickAddOpp';
import FAQModal from './components/FAQModal';
import Dashboard from './views/Dashboard';
import Settings from './views/Settings';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'settings', label: 'Settings' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function App() {
  const [tab, setTab] = useState<TabId>('dashboard');
  const [adding, setAdding] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);

  const opps = useLiveQuery(() => db.opportunities.toArray(), []) ?? [];
  const stages = useLiveQuery(() => db.stages.toArray(), []) ?? [];
  const expOffers = useMemo(() => expectedOffers(opps, stageMap(stages)), [opps, stages]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-6">
          <button onClick={() => setTab('dashboard')} className="flex items-baseline gap-2" title="Back to dashboard">
            <span className="text-lg font-bold tracking-tight">🎯 JobBoard</span>
            <span className="hidden text-xs text-slate-400 xl:inline">referral-first job search CRM</span>
          </button>
          <nav className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.id ? 'bg-emerald-700 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span
              className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold tabular-nums text-emerald-800 ring-1 ring-inset ring-emerald-200"
              title="Expected offers currently in your pipeline (Σ stage weights of active opps)"
            >
              Σ {formatExpectedOffers(expOffers)} expected offers
            </span>
            <Button variant="primary" onClick={() => setAdding(true)}>+ Add opp</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-6">
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'settings' && <Settings />}
      </main>

      <footer className="flex items-center justify-center gap-2 border-t border-slate-200 py-3 text-xs text-slate-400">
        <span>JobBoard {APP_VERSION}</span>
        <span>·</span>
        <button onClick={() => setFaqOpen(true)} className="font-medium text-emerald-700 hover:underline">FAQ</button>
        <span>·</span>
        <span>Your data never leaves this browser — back it up in Settings</span>
      </footer>

      {adding && <QuickAddOpp onClose={() => setAdding(false)} />}
      {faqOpen && <FAQModal onClose={() => setFaqOpen(false)} />}
    </div>
  );
}
