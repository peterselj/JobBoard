import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, moveOppToStage, snoozeHygiene, type Opportunity } from '../db';
import {
  expectedOffers, hygieneFor, pipelineShape, SHAPE_TARGET_RATIO, stageMap, weeklyMetrics, weekStart,
  weightedComp, type ShapeIssue, type WeekBucket,
} from '../lib/pipeline';
import { daysAgo, formatDate, formatExpectedOffers, formatMoney } from '../lib/format';
import { Badge, Button, EmptyState, SectionHeader, StatCard } from '../components/ui';
import Kanban from '../components/Kanban';
import OppDrawer from '../components/OppDrawer';
import QuickAddOpp from '../components/QuickAddOpp';
import { loadSampleData } from '../lib/sampleData';

export default function Dashboard() {
  const opps = useLiveQuery(() => db.opportunities.toArray(), []) ?? [];
  const stages = useLiveQuery(() => db.stages.orderBy('order').toArray(), []) ?? [];
  const activities = useLiveQuery(() => db.activities.toArray(), []) ?? [];
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const [selected, setSelected] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

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

  // Needs attention
  const staleDays = settings?.staleDays ?? 7;
  const shapeIssues = useMemo(() => pipelineShape(opps, stagesById), [opps, stagesById]);
  const lostStageId = useMemo(() => stages.find((s) => s.kind === 'lost')?.id, [stages]);
  const hygiene = useMemo(
    () =>
      activeOpps
        .filter((o) => hygieneFor(o, staleDays).needsAttention)
        .sort((a, b) => a.updatedAt - b.updatedAt),
    [activeOpps, staleDays],
  );

  if (opps.length === 0 && contacts.length === 0) {
    return (
      <div className="mx-auto max-w-2xl pt-10">
        <EmptyState title="Welcome to JobBoard 🎯">
          <p className="mx-auto max-w-lg">
            A job search is a sales pipeline: most opportunities won't close, so the winning move is to run
            <span className="font-medium"> more</span> of them, referral-first, and track every one. Start by adding
            an opportunity — or load sample data to look around.
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
      {/* Needs attention */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <SectionHeader title="Needs attention" />
        <div className="grid grid-cols-3 gap-5">
          <VolumeCheck count={activeOpps.length} />
          <ShapeList issues={shapeIssues} />
          <HygieneList
            opps={hygiene}
            staleDays={staleDays}
            onSelect={setSelected}
            onCloseOut={(id) => lostStageId && moveOppToStage(id, lostStageId)}
            onLooksGood={(id) => snoozeHygiene(id)}
          />
        </div>
      </section>

      {/* Stat row */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          accent
          label="Expected offers in pipeline"
          value={formatExpectedOffers(expOffers)}
          sub={expOffers < 1 ? 'Rule of thumb: keep this ≥ 1.0 — ideally 2–3' : 'Healthy! Keep feeding the top of funnel'}
        />
        <StatCard label="Active opportunities" value={activeOpps.length} />
        <StatCard label="In interviews" value={lateStage.length} sub="At recruiter screen or beyond" />
        <StatCard label="Weighted comp value" value={expComp > 0 ? formatMoney(expComp) : '—'} sub="Σ comp midpoint × stage weight" />
      </div>

      {/* Kanban board */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <SectionHeader title="Pipeline" />
        <Kanban onSelect={setSelected} />
      </section>

      {/* Weekly activity */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <SectionHeader title="Weekly activity" />
        {settings && (
          <>
            <WeeklyChart weeks={weeks} targets={settings.targets} />
            {thisWeek && (
              <div className="mt-4 grid grid-cols-3 gap-4">
                <TargetBar label="New opps" value={thisWeek.newOpps} target={settings.targets.newOpps} color="bg-emerald-600" />
                <TargetBar label="Referral convos" value={thisWeek.referralConvos} target={settings.targets.referralConvos} color="bg-teal-500" />
                <TargetBar label="Applications" value={thisWeek.applications} target={settings.targets.applications} color="bg-sky-500" />
              </div>
            )}
          </>
        )}
      </section>

      {selected != null && <OppDrawer oppId={selected} onClose={() => setSelected(null)} />}
      {adding && <QuickAddOpp onClose={() => setAdding(false)} />}
    </div>
  );
}

// ---------- Weekly activity ----------

const WEEKLY_SERIES = [
  { key: 'newOpps' as const, label: 'New opps', color: 'bg-emerald-600' },
  { key: 'referralConvos' as const, label: 'Referral convos', color: 'bg-teal-500' },
  { key: 'applications' as const, label: 'Applications', color: 'bg-sky-500' },
];

// The target sits at 80% of the plot height so on-pace bars reach the dashed
// line and over-performance still has headroom to show above it.
const TARGET_FRAC = 0.8;

function WeeklyChart({ weeks, targets }: { weeks: WeekBucket[]; targets: { newOpps: number; referralConvos: number; applications: number } }) {
  const currentWeekStart = weekStart(Date.now());
  const barHeight = (w: WeekBucket, key: (typeof WEEKLY_SERIES)[number]['key']) => {
    const target = targets[key] || 1;
    const pct = (w[key] / target) * TARGET_FRAC * 100;
    if (w[key] === 0) return 0;
    return Math.max(Math.min(pct, 100), 4);
  };
  return (
    <div>
      <div className="relative">
        {/* Target line */}
        <div className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-emerald-500/60" style={{ bottom: `${TARGET_FRAC * 100}%` }} />
        <span className="pointer-events-none absolute left-0 z-20 -translate-y-[40%] bg-white pr-1 text-[10px] font-medium text-emerald-600" style={{ bottom: `${TARGET_FRAC * 100}%` }}>
          target
        </span>
        <div className="flex h-28 items-stretch gap-2">
          {weeks.map((w) => (
            <div key={w.start} className={`flex flex-1 items-end justify-center gap-1 rounded-lg px-1 ${w.start === currentWeekStart ? 'bg-emerald-50/70' : ''}`}>
              {WEEKLY_SERIES.map((s) => (
                <div
                  key={s.key}
                  title={`${s.label}: ${w[s.key]} / ${targets[s.key]}`}
                  className={`w-3 rounded-t ${s.color} ${w[s.key] === 0 ? 'opacity-15' : ''}`}
                  style={{ height: `${barHeight(w, s.key)}%` }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex gap-2">
        {weeks.map((w) => (
          <div key={w.start} className="flex-1 text-center text-[11px] text-slate-400">{w.label}</div>
        ))}
      </div>
      <div className="mt-2 flex justify-center gap-4 text-xs text-slate-500">
        {WEEKLY_SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded ${s.color}`} /> {s.label} <span className="text-slate-400">(target {targets[s.key]})</span>
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

// ---------- Needs-attention columns ----------

function VolumeCheck({ count }: { count: number }) {
  let issue: { severity: 'red' | 'amber'; tag: string; detail: string } | null = null;
  if (count < 15) {
    issue = {
      severity: 'red',
      tag: 'fix now',
      detail: `Only ${count} active opp${count === 1 ? '' : 's'} — get to at least 15. A thin pipe can't carry an offer; add new opps.`,
    };
  } else if (count < 20) {
    issue = {
      severity: 'amber',
      tag: 'fix now',
      detail: `${count} active opps — workable, but push toward 20–30 so the funnel has enough shots on goal.`,
    };
  } else if (count > 30) {
    issue = {
      severity: 'amber',
      tag: 'pulse check',
      detail: `${count} active opps — plenty in motion. If you're stretched thin, declutter the long shots so you can do each one justice.`,
    };
  }
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700">Volume</h3>
      <p className="mt-0.5 min-h-[2.5rem] text-xs text-slate-500">Enough opportunities in motion? Aim for ~15–30 active.</p>
      {issue ? (
        <div className="mt-2 rounded-lg border border-slate-200 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-2xl font-bold tabular-nums text-slate-900">{count}</span>
            <Badge color={issue.severity}>{issue.tag}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{issue.detail}</p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-400">Enough volume 🎉</p>
      )}
    </div>
  );
}

function ShapeList({ issues }: { issues: ShapeIssue[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700">Shape</h3>
      <p className="mt-0.5 min-h-[2.5rem] text-xs text-slate-500">
        Target ratio: <span className="font-medium text-slate-600">{SHAPE_TARGET_RATIO}</span>.
      </p>
      <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1 thin-scroll">
        {issues.map((issue) => (
          <li key={issue.title} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{issue.title}</span>
              <Badge color={issue.severity === 'red' ? 'red' : 'amber'}>
                {issue.severity === 'red' ? 'fix now' : 'rebalance'}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">{issue.detail}</p>
          </li>
        ))}
        {issues.length === 0 && <li className="text-xs text-slate-400">Funnel looks balanced 🎉</li>}
      </ul>
    </div>
  );
}

function HygieneList({
  opps, staleDays, onSelect, onCloseOut, onLooksGood,
}: {
  opps: Opportunity[];
  staleDays: number;
  onSelect: (id: number) => void;
  onCloseOut: (id: number) => void;
  onLooksGood: (id: number) => void;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700">Hygiene</h3>
      <p className="mt-0.5 min-h-[2.5rem] text-xs text-slate-500">
        Stale ({staleDays}+ days quiet) or old (40+ days in pipeline). Close out or confirm they're still live.
      </p>
      <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1 thin-scroll">
        {opps.map((o) => {
          const h = hygieneFor(o, staleDays);
          return (
            <li key={o.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => onSelect(o.id!)} className="min-w-0 truncate text-left hover:text-emerald-700">
                  <span className="font-medium">{o.company}</span>
                  <span className="ml-1.5 text-xs text-slate-500">{o.role}</span>
                </button>
                <div className="flex shrink-0 gap-1">
                  {h.old && <Badge color="red">{daysAgo(o.createdAt)}d old</Badge>}
                  {h.stale && <Badge color="amber">{daysAgo(o.updatedAt)}d quiet</Badge>}
                </div>
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <Button size="sm" variant="danger" onClick={() => onCloseOut(o.id!)}>Close out</Button>
                <Button size="sm" onClick={() => onLooksGood(o.id!)}>Looks good</Button>
              </div>
            </li>
          );
        })}
        {opps.length === 0 && <li className="text-xs text-slate-400">Everything's fresh 🎉</li>}
      </ul>
    </div>
  );
}
