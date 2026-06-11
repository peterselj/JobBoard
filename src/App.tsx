import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { expectedOffers, stageMap } from './lib/pipeline';
import { formatExpectedOffers } from './lib/format';
import { Button } from './components/ui';
import QuickAddOpp from './components/QuickAddOpp';
import Dashboard from './views/Dashboard';
import Pipeline from './views/Pipeline';
import Opportunities from './views/Opportunities';
import Contacts from './views/Contacts';
import Settings from './views/Settings';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'settings', label: 'Settings' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function App() {
  const [tab, setTab] = useState<TabId>('dashboard');
  const [adding, setAdding] = useState(false);

  const opps = useLiveQuery(() => db.opportunities.toArray(), []) ?? [];
  const stages = useLiveQuery(() => db.stages.toArray(), []) ?? [];
  const expOffers = useMemo(() => expectedOffers(opps, stageMap(stages)), [opps, stages]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-6">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold tracking-tight">🎯 JobBoard</span>
            <span className="hidden text-xs text-slate-400 xl:inline">referral-first job search CRM</span>
          </div>
          <nav className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span
              className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold tabular-nums text-indigo-700 ring-1 ring-inset ring-indigo-200"
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
        {tab === 'pipeline' && <Pipeline />}
        {tab === 'opportunities' && <Opportunities />}
        {tab === 'contacts' && <Contacts />}
        {tab === 'settings' && <Settings />}
      </main>

      <footer className="border-t border-slate-200 py-3 text-center text-xs text-slate-400">
        Your data never leaves this browser · back it up in Settings
      </footer>

      {adding && <QuickAddOpp onClose={() => setAdding(false)} />}
    </div>
  );
}
