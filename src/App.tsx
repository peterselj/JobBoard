import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { expectedOffers, stageMap } from './lib/pipeline';
import { formatExpectedOffers } from './lib/format';
import { APP_VERSION } from './version';
import { Button } from './components/ui';
import QuickAddOpp from './components/QuickAddOpp';
import Dashboard from './views/Dashboard';
import Settings from './views/Settings';
import BestPractices from './views/BestPractices';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'settings', label: 'Settings' },
  { id: 'best-practices', label: 'Best Practices' },
] as const;

// A small lift in the footer — one is picked at random each visit.
const FOOTER_NUDGES = [
  'you\'re doing great',
  'glad you\'re here',
  'keep going',
  'nice work today',
  'thanks for stopping by',
  'be kind to yourself',
  "today's a good day to start",
  "you're closer than you think",
  'keep the momentum',
  'this page believes in you',
  'keep it simple',
  "you're on the right track",
  'nice to see you',
  'enjoy the process',
  "you're doing just fine",
  'keep showing up',
  'progress over perfection',
  'something good is happening',
  'this page is rooting for you',
  'the right one is out there',
].map((m) => `${m} : )`);

type TabId = (typeof TABS)[number]['id'];

export default function App() {
  const [tab, setTab] = useState<TabId>('dashboard');
  const [adding, setAdding] = useState(false);

  const opps = useLiveQuery(() => db.opportunities.toArray(), []) ?? [];
  const stages = useLiveQuery(() => db.stages.toArray(), []) ?? [];
  const expOffers = useMemo(() => expectedOffers(opps, stageMap(stages)), [opps, stages]);
  const nudge = useMemo(() => FOOTER_NUDGES[Math.floor(Math.random() * FOOTER_NUDGES.length)], []);

  // Press "N" (for New) anywhere outside a text field to add an opportunity.
  // Plain key — no Ctrl/Cmd — so it never collides with browser shortcuts.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'n' && e.key !== 'N') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      setAdding(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
            <Button variant="primary" onClick={() => setAdding(true)} title="Add an opportunity (shortcut: N)">
              + Add opp
              <kbd className="ml-1.5 rounded border border-emerald-300/60 bg-emerald-600/40 px-1 text-[10px] font-semibold leading-tight text-emerald-50">N</kbd>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-6">
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'settings' && <Settings />}
        {tab === 'best-practices' && <BestPractices />}
      </main>

      <footer className="flex items-center justify-center gap-2 border-t border-slate-200 py-3 text-xs text-slate-400">
        <span>JobBoard {APP_VERSION}</span>
        <span>·</span>
        <span>{nudge}</span>
      </footer>

      {adding && <QuickAddOpp onClose={() => setAdding(false)} />}
    </div>
  );
}
