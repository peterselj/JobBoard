import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveSettings, type Opportunity } from '../db';
import { expectedOffers, paceToOffer, stageMap, weeklyMetrics, weightedComp, weekStart, type WeekBucket } from '../lib/pipeline';
import { findWarmPaths } from '../lib/companyMatch';
import { daysAgo, formatExpectedOffers, formatMoney, formatWeight } from '../lib/format';
import { Badge, Button, EmptyState, Input, SectionHeader, StatCard } from '../components/ui';
import OppDrawer from '../components/OppDrawer';
import QuickAddOpp from '../components/QuickAddOpp';
import { loadSampleData } from '../lib/sampleData';

export default function Dashboard() {
  const opps = useLiveQuery(() => db.opportunities.toArray(), []) ?? [];
  const stages = useLiveQuery(() => db.stages.orderBy('order').toArray(), []) ?? [];
  const activities = useLiveQuery(() => db.activities.toArray(), []) ?? [];
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) ?? [];
  const oppContacts = useLiveQuery(() => db.oppContacts.toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const [selected, setSelected] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [weeksRemaining, setWeeksRemaining] = useState(12);

  const stagesById = useMemo(() => stageMap(stages), [stages]);
  const activeOpps = useMemo(
    () => opps.filter((o) => stagesById.get(o.stageId)?.kind === 'active'),
    [opps, stagesById],
  );
  const expOffers = expectedOffers(opps, stagesById);
  const expComp = weightedComp(opps, stagesById);
  const lateStage = activeOpps.filter((o) => (stagesById.get(o.stageId)?.weight ?? 0) >= 7.5);
  const weeks = useMemo(() => weeklyMetrics(opps, activities, 8), [opps, activities]);
  const thisWeek = weeks[weeks.length - 1];

  const conversionPct = settings?.assumedOppToOffer ?? 2.5;
  const pace = paceToOffer(expOffers, conversionPct, weeksRemaining);
  const recentPace = weeks.slice(-5, -1).reduce((s, w) => s + w.newOpps, 0) / 4;

  // Needs attention
  const staleDays = settings?.staleDays ?? 7;
  const linkedOppIds = useMemo(() => new Set(oppContacts.map((l) => l.oppId)), [oppContacts]);
  const stale = activeOpps.filter((o) => daysAgo(o.updatedAt) >= staleDays);
  const noNextAction = activeOpps.filter((o) => !o.nextAction);
  const warmAvailable = activeOpps.filter(
    (o) =>
      (stagesById.get(o.stageId)?.weight ?? 0) < 2.5 &&
      !linkedOppIds.has(o.id!) &&
      findWarmPaths(o.company, contacts).length > 0,
  );

  if (opps.length === 0 && contacts.length === 0) {
    return (
      <div className="mx-auto max-w-2xl pt-10">
        <EmptyState title="Welcome to JobBoard 🎯">
          <p className="mx-auto max-w-lg">
            A job search is a sales pipeline: most opportunities won't close, so the winning move is to run
            <span className="font-medium"> more</span> of them, referral-first, and track every one. Start by adding
            an opportunity, importing your LinkedIn connections — or load sample data to look around.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="primary" onClick={() => setAdding(true)}>+ Add your first opportunity</Button>
            <Button onClick={() => loadSampleData()}>Load sample data</Button>
          </div>
        </EmptyState>
        {adding && <QuickAddOpp onClose={() => setAdding(false)} />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stat row */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          accent
          label="Expected offers in pipeline"
          value={formatExpectedOffers(expOffers)}
          sub={expOffers < 1 ? 'Rule of thumb: keep this ≥ 1.0 — ideally 2–3' : 'Healthy! Keep feeding the top of funnel'}
        />
        <StatCard label="Active opportunities" value={activeOpps.length} sub={`${opps.length - activeOpps.length} closed`} />
        <StatCard label="In interviews" value={lateStage.length} sub="At recruiter screen or beyond" />
        <StatCard label="Weighted comp value" value={expComp > 0 ? formatMoney(expComp) : '—'} sub="Σ comp midpoint × stage weight" />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Funnel */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <SectionHeader title="Pipeline by stage" />
          <Funnel opps={opps} stagesByIdSize={stages} onSelect={setSelected} />
          <details className="mt-4 text-sm text-slate-600">
            <summary className="cursor-pointer font-medium text-indigo-700">Why weight the pipeline?</summary>
            <p className="mt-2">
              Each stage's weight is the realistic chance that opp becomes an offer. A new opp is ~0%; even a
              final round is only ~{formatWeight(stagesById.get('final-round')?.weight ?? 33)}. Summing the weights
              gives your <span className="font-medium">expected offers</span> — most searches need the sum above
              1.0 before an offer actually lands. If your number looks small, that's not failure; it's the signal
              to open more opportunities and convert cold ones into referral paths.
            </p>
          </details>
        </section>

        {/* Calculator */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <SectionHeader title="What it takes" />
          <div className="flex flex-wrap items-end gap-4 text-sm">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Offer within (weeks)</span>
              <Input type="number" min={1} value={weeksRemaining} onChange={(e) => setWeeksRemaining(Math.max(1, Number(e.target.value) || 1))} className="!w-24" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">% of opps that close</span>
              <Input
                type="number" min={0.1} step={0.1} value={conversionPct}
                onChange={(e) => saveSettings({ assumedOppToOffer: Math.max(0.1, Number(e.target.value) || 0.1) })}
                className="!w-24"
              />
            </label>
          </div>
          <div className="mt-4 rounded-lg bg-indigo-50 p-4 text-sm text-indigo-900">
            {pace.oppsNeededTotal === 0 ? (
              <p>Your pipeline already carries ≥ 1 expected offer. Keep advancing what you have.</p>
            ) : (
              <p>
                To carry a full expected offer you need about{' '}
                <span className="font-bold">{pace.oppsNeededTotal} more opportunities</span> — that's{' '}
                <span className="font-bold">{pace.oppsPerWeek < 10 ? pace.oppsPerWeek.toFixed(1) : Math.ceil(pace.oppsPerWeek)} new opps/week</span>{' '}
                for {weeksRemaining} weeks. Your recent pace: {recentPace.toFixed(1)}/week.
              </p>
            )}
            <p className="mt-2 text-xs text-indigo-700/80">
              Referral-first searches convert several times better than portal drops — that's how a 16-week search becomes 12.
            </p>
          </div>
        </section>
      </div>

      {/* Weekly activity */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <SectionHeader title="Weekly activity (last 8 weeks)" />
        <WeeklyChart weeks={weeks} />
        {settings && thisWeek && (
          <div className="mt-4 grid grid-cols-4 gap-4">
            <TargetBar label="New opps" value={thisWeek.newOpps} target={settings.targets.newOpps} color="bg-indigo-500" />
            <TargetBar label="Referral convos" value={thisWeek.referralConvos} target={settings.targets.referralConvos} color="bg-green-500" />
            <TargetBar label="Applications" value={thisWeek.applications} target={settings.targets.applications} color="bg-sky-500" />
            <TargetBar label="Interviews" value={thisWeek.interviews} target={settings.targets.interviews} color="bg-amber-500" />
          </div>
        )}
      </section>

      {/* Needs attention */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <SectionHeader title="Needs attention" />
        <div className="grid grid-cols-3 gap-5">
          <AttentionList
            title={`Warm path available (${warmAvailable.length})`}
            hint="You know someone at these companies — get the referral before (or after) applying."
            opps={warmAvailable}
            badge={(o) => <Badge color="green">{findWarmPaths(o.company, contacts).length} contact{findWarmPaths(o.company, contacts).length > 1 ? 's' : ''}</Badge>}
            onSelect={setSelected}
          />
          <AttentionList
            title={`Stale ${staleDays}+ days (${stale.length})`}
            hint="No activity recently — follow up or close them out."
            opps={stale}
            badge={(o) => <Badge color="amber">{daysAgo(o.updatedAt)}d</Badge>}
            onSelect={setSelected}
          />
          <AttentionList
            title={`No next action (${noNextAction.length})`}
            hint="Every active opp should have a concrete next step."
            opps={noNextAction}
            badge={() => <Badge color="red">set one</Badge>}
            onSelect={setSelected}
          />
        </div>
      </section>

      {selected != null && <OppDrawer oppId={selected} onClose={() => setSelected(null)} />}
      {adding && <QuickAddOpp onClose={() => setAdding(false)} />}
    </div>
  );
}

function Funnel({ opps, stagesByIdSize: stages, onSelect }: { opps: Opportunity[]; stagesByIdSize: { id: string; name: string; weight: number; kind: string }[]; onSelect: (id: number) => void }) {
  void onSelect;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of opps) m.set(o.stageId, (m.get(o.stageId) ?? 0) + 1);
    return m;
  }, [opps]);
  const max = Math.max(1, ...stages.map((s) => counts.get(s.id) ?? 0));
  return (
    <div className="space-y-1.5">
      {stages.map((s) => {
        const count = counts.get(s.id) ?? 0;
        const weighted = count * (s.weight / 100);
        return (
          <div key={s.id} className="flex items-center gap-3 text-sm">
            <span className="w-36 shrink-0 truncate text-slate-600">{s.name}</span>
            <div className="h-5 flex-1 rounded bg-slate-100">
              <div
                className={`h-5 rounded ${s.kind === 'won' ? 'bg-green-500' : s.kind === 'lost' ? 'bg-slate-300' : 'bg-indigo-500'}`}
                style={{ width: `${(count / max) * 100}%`, minWidth: count > 0 ? 8 : 0 }}
              />
            </div>
            <span className="w-8 shrink-0 text-right tabular-nums text-slate-700">{count}</span>
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-slate-400">
              {s.kind === 'active' && count > 0 ? `+${weighted.toFixed(2)} exp` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function WeeklyChart({ weeks }: { weeks: WeekBucket[] }) {
  const series = [
    { key: 'newOpps' as const, label: 'New opps', color: 'bg-indigo-500' },
    { key: 'referralConvos' as const, label: 'Referral convos', color: 'bg-green-500' },
    { key: 'applications' as const, label: 'Applications', color: 'bg-sky-500' },
    { key: 'interviews' as const, label: 'Interviews', color: 'bg-amber-500' },
  ];
  const max = Math.max(1, ...weeks.flatMap((w) => series.map((s) => w[s.key])));
  const currentWeekStart = weekStart(Date.now());
  return (
    <div>
      <div className="flex items-end gap-2">
        {weeks.map((w) => (
          <div key={w.start} className={`flex-1 rounded-lg p-2 ${w.start === currentWeekStart ? 'bg-indigo-50/70' : ''}`}>
            <div className="flex h-24 items-end justify-center gap-1">
              {series.map((s) => (
                <div
                  key={s.key}
                  title={`${s.label}: ${w[s.key]}`}
                  className={`w-3 rounded-t ${s.color} ${w[s.key] === 0 ? 'opacity-15' : ''}`}
                  style={{ height: `${Math.max((w[s.key] / max) * 100, 4)}%` }}
                />
              ))}
            </div>
            <div className="mt-1 text-center text-[11px] text-slate-400">{w.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-center gap-4 text-xs text-slate-500">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded ${s.color}`} /> {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function TargetBar({ label, value, target, color }: { label: string; value: number; target: number; color: string }) {
  const pct = target > 0 ? Math.min((value / target) * 100, 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-600">
        <span>{label}</span>
        <span className="tabular-nums">{value} / {target}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function AttentionList({
  title, hint, opps, badge, onSelect,
}: {
  title: string;
  hint: string;
  opps: Opportunity[];
  badge: (o: Opportunity) => React.ReactNode;
  onSelect: (id: number) => void;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
      <ul className="mt-2 space-y-1.5">
        {opps.slice(0, 6).map((o) => (
          <li key={o.id}>
            <button
              onClick={() => onSelect(o.id!)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-indigo-300 hover:bg-indigo-50/40"
            >
              <span className="min-w-0 truncate">
                <span className="font-medium">{o.company}</span>
                <span className="ml-1.5 text-xs text-slate-500">{o.role}</span>
              </span>
              {badge(o)}
            </button>
          </li>
        ))}
        {opps.length === 0 && <li className="text-xs text-slate-400">Nothing here 🎉</li>}
        {opps.length > 6 && <li className="text-xs text-slate-400">+{opps.length - 6} more</li>}
      </ul>
    </div>
  );
}
