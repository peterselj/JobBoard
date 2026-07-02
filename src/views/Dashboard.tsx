import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  createDraftOpp, db, deleteOpportunity, logActivity, moveOppToStage, snoozeHygiene,
  type Opportunity, type Priority, type Stage,
} from '../db';
import {
  ACTIVE_OPP_GOAL, expectedOffers, hygieneFor, isLiveActive, pipelineShape, stageMap,
  weeklyMetrics, type ShapeIssue,
} from '../lib/pipeline';
import { findWarmPaths } from '../lib/companyMatch';
import { getBackupState, subscribeBackup } from '../lib/autobackup';
import { burstConfetti } from '../lib/confetti';
import { daysAgo, formatExpectedOffers, formatMoney, formatWeight } from '../lib/format';
import { loadSampleData } from '../lib/sampleData';
import OpportunityPage from '../components/OpportunityPage';
import QuickAddOpp from '../components/QuickAddOpp';

// Palette (matches the approved design tokens).
const C = {
  ink: '#1b211d', inkSoft: '#3c453e', muted: '#6f776d', faint: '#9aa298',
  paper: '#f3f3ee', paper2: '#fbfbf8', line: '#e6e6df', lineStrong: '#d4d5cc',
  forest: '#234c3a', forest2: '#2f5e4a', forestDeep: '#15352a',
  sage: '#5e8f72', pale: '#aebfb0', gold: '#9a6b1f', goldBg: '#faf4e8',
  brick: '#9c3b32', brickBg: '#fbeeec',
};

// KPI traffic light vs. goal: green ≥100% · amber 75–99% · red <75%.
const colFor = (pct: number) => (pct >= 1 ? C.forest : pct >= 0.75 ? C.gold : C.brick);
const tintFor = (pct: number) => (pct >= 1 ? '#eef4f0' : pct >= 0.75 ? C.goldBg : C.brickBg);

const REP_SERIES = [
  { key: 'newOpps' as const, label: 'New opps', color: C.forest },
  { key: 'referralConvos' as const, label: 'Referral', color: C.sage },
  { key: 'applications' as const, label: 'Applied', color: C.pale },
];

type Nav = (view: 'settings' | 'best-practices', anchor?: string) => void;

type SortKey = 'tier-asc' | 'tier-desc' | 'active-desc' | 'active-asc' | 'alpha-asc' | 'alpha-desc' | 'comp-desc';
const compMid = (o: Opportunity): number => {
  const lo = o.compMin ?? o.compMax, hi = o.compMax ?? o.compMin;
  return lo != null && hi != null ? (lo + hi) / 2 : -1;
};

const SORTERS: Record<SortKey, (a: Opportunity, b: Opportunity) => number> = {
  'tier-asc': (a, b) => a.priority.localeCompare(b.priority) || b.updatedAt - a.updatedAt,
  'tier-desc': (a, b) => b.priority.localeCompare(a.priority) || b.updatedAt - a.updatedAt,
  'active-desc': (a, b) => b.updatedAt - a.updatedAt,
  'active-asc': (a, b) => a.updatedAt - b.updatedAt,
  'alpha-asc': (a, b) => (a.company || '~').localeCompare(b.company || '~') || a.role.localeCompare(b.role),
  'alpha-desc': (a, b) => (b.company || '~').localeCompare(a.company || '~'),
  'comp-desc': (a, b) => compMid(b) - compMid(a),
};

export default function Dashboard({ onNavigate }: { onNavigate: Nav }) {
  const opps = useLiveQuery(() => db.opportunities.toArray(), []) ?? [];
  const stages = useLiveQuery(() => db.stages.orderBy('order').toArray(), []) ?? [];
  const activities = useLiveQuery(() => db.activities.toArray(), []) ?? [];
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) ?? [];
  const oppContacts = useLiveQuery(() => db.oppContacts.toArray(), []) ?? [];
  const referralPaths = useLiveQuery(() => db.referralPaths.toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.get('app'), []);

  const [selected, setSelected] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [quickText, setQuickText] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const quickRef = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState(getBackupState());
  useEffect(() => subscribeBackup(setBackup), []);

  // "N" anywhere outside a field opens the full add modal.
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

  const stagesById = useMemo(() => stageMap(stages), [stages]);
  const activeStages = useMemo(() => stages.filter((s) => s.kind === 'active'), [stages]);
  const lostStage = useMemo(() => stages.find((s) => s.kind === 'lost'), [stages]);
  const wonStage = useMemo(() => stages.find((s) => s.kind === 'won'), [stages]);
  const staleDays = settings?.staleDays ?? 7;
  const targets = settings?.targets ?? { newOpps: 10, referralConvos: 5, applications: 5 };

  const activeOpps = useMemo(() => opps.filter((o) => isLiveActive(o, stagesById)), [opps, stagesById]);
  const expSum = expectedOffers(opps, stagesById);
  const weeks = useMemo(() => weeklyMetrics(opps, activities, 8), [opps, activities]);
  const thisWeek = weeks[weeks.length - 1] ?? { newOpps: 0, referralConvos: 0, applications: 0 };

  // Filters
  const [search, setSearch] = useState('');
  const [loc, setLoc] = useState('');
  const [pri, setPri] = useState<Set<Priority>>(new Set(['A', 'B', 'C']));
  const [sort, setSort] = useState<SortKey>('tier-asc');
  const locations = useMemo(
    () => [...new Set(opps.map((o) => o.location?.trim()).filter((l): l is string => !!l))].sort(),
    [opps],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return opps.filter((o) => {
      if (!pri.has(o.priority)) return false;
      if (loc && o.location?.trim() !== loc) return false;
      if (q && !`${o.company} ${o.role} ${o.location ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [opps, search, loc, pri]);

  // Early-stage opps with no known way in: no linked inroad AND no warm contact
  // at the company. Computed once and shared by the board cards and the queue.
  const linkedOppIds = useMemo(
    () => new Set<number>([...oppContacts.map((l) => l.oppId), ...referralPaths.map((p) => p.oppId)]),
    [oppContacts, referralPaths],
  );
  const noPathOpps = useMemo(
    () =>
      opps.filter(
        (o) =>
          (stagesById.get(o.stageId)?.weight ?? 0) < 2.5 &&
          !o.draft && !!o.company && !linkedOppIds.has(o.id!) &&
          findWarmPaths(o.company, contacts).length === 0,
      ),
    [opps, stagesById, linkedOppIds, contacts],
  );
  const noPathIds = useMemo(() => new Set(noPathOpps.map((o) => o.id!)), [noPathOpps]);

  const board = useMemo(
    () =>
      activeStages.map((s) => {
        const list = filtered.filter((o) => o.stageId === s.id).sort(SORTERS[sort]);
        const real = list.filter((o) => !o.draft).length;
        const draft = list.length - real;
        return { stage: s, list, count: draft ? `${real} +${draft}` : String(real) };
      }),
    [activeStages, filtered, sort],
  );

  const lostList = useMemo(
    () => (lostStage ? opps.filter((o) => o.stageId === lostStage.id).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)) : []),
    [opps, lostStage],
  );
  const wonList = useMemo(
    () => (wonStage ? opps.filter((o) => o.stageId === wonStage.id).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)) : []),
    [opps, wonStage],
  );

  // ---- drag & drop ----
  const onDropStage = (stageId: string, kind: Stage['kind']) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (!id) return;
    const opp = opps.find((o) => o.id === id);
    moveOppToStage(id, stageId);
    if (opp && opp.stageId !== stageId && kind === 'won') burstConfetti(e.clientX, e.clientY);
  };

  // ---- quick add ----
  const submitQuick = async () => {
    if (!quickText.trim()) return;
    await createDraftOpp(quickText);
    setQuickText('');
  };

  // ---- "Do this today" action queue ----
  const queue = useMemo(
    () => buildQueue({
      activeOpps, opps, staleDays, noPathOpps,
      shapeIssues: pipelineShape(opps, stagesById),
      showAutosave: backup.supported && !backup.connected,
      showSchools: (settings?.schools?.length ?? 0) === 0,
      onAddOpp: () => setAdding(true),
      onReview: setSelected,
      onNudge: (id) => logActivity({ oppId: id, type: 'follow-up' }),
      onClose: (id) => lostStage && moveOppToStage(id, lostStage.id),
      onSnooze: (id) => snoozeHygiene(id),
      onAutosave: () => onNavigate('settings', 'settings-backup'),
      onSchools: () => onNavigate('settings', 'settings-schools'),
      onHow: () => onNavigate('best-practices'),
    }),
    [activeOpps, opps, stagesById, staleDays, noPathOpps, lostStage, onNavigate, backup.supported, backup.connected, settings?.schools],
  );

  // ---- empty state ----
  if (opps.length === 0 && contacts.length === 0) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-5 bg-paper px-6 text-center">
        <div>
          <div className="text-2xl font-extrabold tracking-tight text-ink">JobBoard 🎯</div>
          <div className="mx-auto mt-3 max-w-md space-y-2.5 text-sm text-muted">
            <p>JobBoard is a high-volume, referral-first job search CRM.</p>
            <p>Use JobBoard if you want a tool to help organize a critical mass of leads (especially warm referrals) and you want sober metrics to track your progress.</p>
            <p>JobBoard can't promise you a new job, but used effectively you should be able to land your new job weeks or months sooner than you would on your own. <span className="font-medium text-ink">Let's begin.</span></p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setAdding(true)} className="rounded-md bg-forest px-4 py-2 text-sm font-semibold text-white hover:bg-forest-deep">+ Add your first opportunity</button>
          <button onClick={() => loadSampleData()} className="rounded-md border border-line-strong bg-white px-4 py-2 text-sm font-medium text-ink-soft hover:bg-paper-2">Load sample data</button>
        </div>
        {adding && <QuickAddOpp onClose={() => setAdding(false)} />}
      </div>
    );
  }

  const kpis = [
    { label: 'Expected offers', value: formatExpectedOffers(expSum), guide: 'goal ≥ 1.0', pct: expSum / 1 },
    { label: 'Active opps', value: String(activeOpps.length), guide: `goal ${ACTIVE_OPP_GOAL}`, pct: activeOpps.length / ACTIVE_OPP_GOAL },
  ];

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: C.paper, color: C.ink, fontFamily: 'var(--font-sans)' }}>
      {/* ───────── HEADER ───────── */}
      <header className="flex shrink-0 items-stretch border-b bg-white" style={{ borderColor: C.lineStrong }}>
        <div className="flex w-[236px] shrink-0 items-center border-r px-[18px]" style={{ borderColor: C.line }}>
          <span className="text-base font-extrabold tracking-tight">JobBoard🎯</span>
        </div>

        {/* KPIs */}
        {kpis.map((k) => {
          const color = colFor(k.pct);
          return (
            <div key={k.label} className="flex shrink-0 flex-col justify-start" style={{ minWidth: 168, padding: '9px 20px 12px', borderRight: `1px solid ${C.line}`, borderTop: `3px solid ${color}`, background: tintFor(k.pct) }}>
              <span style={{ fontSize: 9.5, letterSpacing: '.07em', textTransform: 'uppercase', fontWeight: 700, color: C.inkSoft }}>{k.label}</span>
              <div className="flex items-baseline gap-[9px]" style={{ marginTop: 5 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 34, fontWeight: 500, letterSpacing: '-.03em', color, lineHeight: 1 }}>{k.value}</span>
                <span style={{ fontSize: 11, color: C.faint }}>{k.guide}</span>
              </div>
            </div>
          );
        })}

        {/* This week's reps */}
        <div className="shrink-0 border-l px-[18px] py-3" style={{ borderColor: C.line }}>
          <div style={{ fontSize: 9.5, letterSpacing: '.07em', textTransform: 'uppercase', fontWeight: 700, color: C.inkSoft, whiteSpace: 'nowrap', marginBottom: 8 }}>This week's reps</div>
          <div className="flex gap-[14px]">
            {REP_SERIES.map((s) => <RepRing key={s.key} value={thisWeek[s.key]} target={targets[s.key]} label={s.label} color={s.color} />)}
          </div>
        </div>

        {/* 8-week trend */}
        <div className="hidden min-w-0 flex-1 flex-col border-l px-[18px] py-3 lg:flex" style={{ borderColor: C.line }}>
          <div style={{ fontSize: 9.5, letterSpacing: '.07em', textTransform: 'uppercase', fontWeight: 700, color: C.inkSoft, marginBottom: 8 }}>8-week trend</div>
          <div className="flex flex-col gap-1.5">
            {REP_SERIES.map((s) => <TrendRow key={s.key} weeks={weeks} seriesKey={s.key} target={targets[s.key]} label={s.label} color={s.color} />)}
          </div>
        </div>

        {/* Add cell */}
        <div className="flex w-[288px] shrink-0 flex-col justify-center gap-2 border-l px-[14px] py-[10px]" style={{ borderColor: C.line, background: '#f4f8f5' }}>
          <button onClick={() => setAdding(true)} title="Add a full opportunity (N)" className="flex items-center justify-center gap-[7px] rounded-md px-3 py-[10px] text-[12.5px] font-semibold text-white" style={{ background: C.forest }}>
            + Add full opp
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, background: 'rgba(255,255,255,.18)', borderRadius: 3, padding: '1px 5px' }}>N</span>
          </button>
          <input
            ref={quickRef}
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitQuick()}
            placeholder="Quick add: paste URL or type a name ↵"
            className="w-full rounded-md border bg-white px-2.5 py-[7px] text-[10.5px] outline-none placeholder:text-faint"
            style={{ borderColor: C.lineStrong }}
          />
        </div>
      </header>

      {/* ───────── BODY ───────── */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT RAIL: Do this today */}
        <aside className="flex w-[236px] shrink-0 flex-col overflow-hidden border-r" style={{ borderColor: C.lineStrong, background: C.paper2 }}>
          <div className="flex items-center justify-between px-[14px] py-[7px]" style={{ background: C.forestDeep }}>
            <span style={{ fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, color: '#eaf2ec' }}>Do this today</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#9fc0ad' }}>{queue.length}</span>
          </div>
          <div className="thin-scroll flex-1 overflow-y-auto">
            {queue.map((a, i) => (
              <div key={i} className="px-[14px] py-2" style={{ borderBottom: `1px solid ${C.line}`, borderLeft: `3px solid ${C.gold}` }}>
                <span style={tagYellow}>{a.tag}</span>
                <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4, lineHeight: 1.2 }}>{a.action}</div>
                <div className="mt-1.5 flex items-center justify-between">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: C.muted }}>{a.metric}</span>
                  <div className="flex gap-[9px]">
                    {a.btns.map((b, j) => (
                      <button key={j} onClick={b.onClick} style={{ fontSize: 9.5, fontWeight: 600, cursor: 'pointer', color: b.primary ? C.forest : C.muted, background: 'none', border: 'none', padding: 0 }}>{b.label}</button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {queue.length === 0 && <div className="px-[14px] py-4 text-[11px]" style={{ color: C.faint }}>All clear — nice work 🎉</div>}
          </div>
          <div className="flex items-center gap-3 px-[14px] py-[9px]" style={{ borderTop: `1px solid ${C.lineStrong}` }}>
            <button onClick={() => onNavigate('settings')} style={{ fontSize: 10.5, color: C.muted, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Settings</button>
            <button onClick={() => onNavigate('best-practices')} style={{ fontSize: 10.5, color: C.muted, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Best Practices</button>
          </div>
        </aside>

        {/* RIGHT COLUMN */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* filters */}
          <div className="flex items-center gap-2 border-b bg-white px-[14px] py-2" style={{ borderColor: C.line }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter company, title, location…" className="w-[220px] rounded-[5px] border px-[9px] py-1.5 text-[11.5px] outline-none placeholder:text-faint" style={{ borderColor: C.lineStrong }} />
            {locations.length > 0 && (
              <select value={loc} onChange={(e) => setLoc(e.target.value)} className="rounded-[5px] border bg-white px-2 py-1.5 text-[11.5px]" style={{ borderColor: C.lineStrong, color: C.inkSoft }}>
                <option value="">All locations</option>
                {locations.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            )}
            <div className="flex gap-1">
              {(['A', 'B', 'C'] as Priority[]).map((p) => {
                const on = pri.has(p);
                return (
                  <button
                    key={p}
                    onClick={() => setPri((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; })}
                    style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, padding: '5px 9px', borderRadius: 5, border: `1px solid ${on ? C.forest : C.line}`, background: on ? C.forest : '#fff', color: on ? '#fff' : C.faint }}
                  >
                    {on ? '✓' : ''}{p}
                  </button>
                );
              })}
            </div>
            <label className="ml-auto flex items-center gap-1.5 text-[11px]" style={{ color: C.muted }}>
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-[5px] border bg-white px-2 py-1.5 text-[11.5px]" style={{ borderColor: C.lineStrong, color: C.inkSoft }}>
                <option value="tier-asc">Tier A → C</option>
                <option value="tier-desc">Tier C → A</option>
                <option value="active-desc">Most recently active</option>
                <option value="active-asc">Least recently active</option>
                <option value="alpha-asc">Alpha A → Z</option>
                <option value="alpha-desc">Alpha Z → A</option>
                <option value="comp-desc">Comp $$$ → $</option>
              </select>
            </label>
          </div>

          {/* board */}
          <div className="flex min-h-0 flex-1">
            {board.map(({ stage, list, count }) => (
              <div
                key={stage.id}
                onDragOver={(e) => { e.preventDefault(); setDragOver(stage.id); }}
                onDragLeave={() => setDragOver((s) => (s === stage.id ? null : s))}
                onDrop={onDropStage(stage.id, stage.kind)}
                className="flex min-w-0 flex-1 flex-col overflow-hidden border-r"
                style={{ borderColor: C.line, background: dragOver === stage.id ? '#eef4f0' : undefined }}
              >
                <div className="border-b bg-white px-1.5 py-1.5" style={{ borderColor: C.line }}>
                  <div className="flex items-center justify-between gap-0.5">
                    <span className="truncate" style={{ fontSize: 9, fontWeight: 700 }} title={stage.name}>{stage.name}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: C.faint }}>{count}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 7.5, color: C.sage, marginTop: 1 }}>{formatWeight(stage.weight)}</div>
                </div>
                <div className="thin-scroll flex flex-1 flex-col gap-[5px] overflow-y-auto p-[5px]">
                  {list.map((o) => (
                    <OppCardView key={o.id} opp={o} stale={hygieneFor(o, staleDays).stale} needsConn={noPathIds.has(o.id!)} onClick={() => setSelected(o.id!)} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* closed */}
          <div className="flex items-stretch gap-[10px] border-t px-[14px] py-[9px]" style={{ borderColor: C.lineStrong, background: C.paper2, height: 96 }}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver('__lost'); }}
              onDragLeave={() => setDragOver((s) => (s === '__lost' ? null : s))}
              onDrop={lostStage ? onDropStage(lostStage.id, 'lost') : undefined}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2"
              style={{ border: `2px dashed ${dragOver === '__lost' ? C.brick : C.lineStrong}`, background: dragOver === '__lost' ? C.brickBg : undefined }}
            >
              <div className="shrink-0">
                <div className="flex items-center gap-1.5">
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: C.faint }} />
                  <span style={{ fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700, color: C.muted }}>Closed Lost</span>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: C.faint }}>{lostList.length} · drag here</span>
              </div>
              <div className="flex flex-1 flex-wrap content-center gap-[7px] overflow-hidden">
                {lostList.slice(0, 6).map((o) => (
                  <div key={o.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(o.id))} className="flex items-center gap-[7px] rounded-[5px] border bg-white px-[9px] py-1.5" style={{ borderColor: C.line, cursor: 'grab' }} title="Drag back to a stage, or × to delete">
                    <button onClick={() => setSelected(o.id!)} style={{ fontSize: 11, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{o.company || 'Untitled'}</button>
                    <span style={{ fontSize: 9.5, color: C.muted }}>{o.role}</span>
                    <button title="Delete opportunity" onClick={() => { if (window.confirm(`Delete "${o.company || o.role || 'this opportunity'}" and all its inroads & activity? This cannot be undone.`)) deleteOpportunity(o.id!); }} style={{ color: C.faint, fontSize: 12, cursor: 'pointer', background: 'none', border: 'none', lineHeight: 1, padding: '0 1px' }}>×</button>
                  </div>
                ))}
              </div>
            </div>
            <div
              draggable={wonList.length > 0}
              onDragStart={(e) => wonList[0] && e.dataTransfer.setData('text/plain', String(wonList[0].id))}
              onDragOver={(e) => { e.preventDefault(); setDragOver('__won'); }}
              onDragLeave={() => setDragOver((s) => (s === '__won' ? null : s))}
              onDrop={wonStage ? onDropStage(wonStage.id, 'won') : undefined}
              className="flex w-[236px] shrink-0 items-center gap-[10px] rounded-lg px-[14px] py-2"
              style={{ border: `2px dashed ${dragOver === '__won' ? '#cfe6d6' : '#bcd6c5'}`, background: C.forestDeep, color: '#eaf2ec', cursor: wonList.length ? 'grab' : undefined }}
              title={wonList.length ? 'Drag back to a stage to undo' : undefined}
            >
              <span style={{ fontSize: 16, color: '#cfe6d6' }}>✦</span>
              <div className="min-w-0">
                <div style={{ fontSize: 9, letterSpacing: '.09em', textTransform: 'uppercase', fontWeight: 700, color: '#9fc0ad' }}>Closed Won</div>
                <div className="truncate" style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{wonList[0]?.company || (wonList.length ? 'Untitled' : 'drag a win here')}</div>
                <div style={{ fontSize: 9.5, color: '#bcd6c5' }}>{wonList.length ? `offer accepted${wonList.length > 1 ? ` · ${wonList.length} total` : ''}` : '🎉'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {selected != null && <OpportunityPage oppId={selected} onClose={() => setSelected(null)} />}
      {adding && <QuickAddOpp onClose={() => setAdding(false)} />}
    </div>
  );
}

const tagYellow: CSSProperties = {
  fontSize: 8.5, letterSpacing: '.05em', textTransform: 'uppercase', fontWeight: 700,
  color: C.gold, border: `1px solid ${C.gold}`, background: C.goldBg, padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap',
};

// ───────── card ─────────

function OppCardView({ opp, stale, needsConn, onClick }: { opp: Opportunity; stale: boolean; needsConn: boolean; onClick: () => void }) {
  const days = daysAgo(opp.stageEnteredAt);
  const daysLabel = opp.draft ? 'new' : days === 0 ? 'today' : `${days}d`;
  const compMid = opp.compMin != null && opp.compMax != null ? (opp.compMin + opp.compMax) / 2
    : opp.compMin ?? opp.compMax ?? null;
  const compLabel = compMid != null ? formatMoney(compMid) : '—';

  let accent = C.forest, dashed = false, tag: string | null = null, tagColor = C.gold, tagBg = C.goldBg;
  if (opp.draft) { accent = C.gold; dashed = true; tag = 'groom'; }
  else if (stale) { accent = C.gold; tag = 'stale'; }
  else if (needsConn) { accent = C.sage; tag = 'no path'; tagColor = C.sage; tagBg = '#eef4f0'; }

  const pStyle: CSSProperties = opp.priority === 'A' ? { background: C.forest, color: '#fff' }
    : opp.priority === 'B' ? { background: '#e4ede7', color: C.forest }
    : { background: '#eceee8', color: C.faint };

  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', String(opp.id))}
      onClick={onClick}
      style={{ border: dashed ? `1px dashed ${accent}` : `1px solid ${C.line}`, borderLeft: `2px solid ${accent}`, padding: '5px 6px', background: dashed ? '#fbf7ee' : '#fcfcfa', cursor: 'pointer', borderRadius: 4 }}
    >
      <div className="flex justify-between gap-[3px]">
        <span className="truncate" style={{ fontSize: 10.5, fontWeight: 700, lineHeight: 1.1 }}>{opp.company || 'Untitled'}</span>
        <span className="shrink-0" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 13, height: 12, padding: '0 3px', borderRadius: 3, fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700, ...pStyle }}>{opp.priority}</span>
      </div>
      <div className="truncate" style={{ fontSize: 8.5, color: C.muted, marginTop: 1 }}>{opp.role || 'role pending'}</div>
      <div className="mt-[3px] flex items-center justify-between gap-[3px]" style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: C.faint }}>
        <span>{daysLabel}</span>
        {tag && <span style={{ color: tagColor, background: tagBg, border: `1px solid ${tagColor}`, padding: '0 4px', borderRadius: 2, fontSize: 7.5 }}>{tag}</span>}
        <span>{compLabel}</span>
      </div>
    </div>
  );
}

// ───────── header reps / trend ─────────

function RepRing({ value, target, label, color }: { value: number; target: number; label: string; color: string }) {
  const pct = Math.min(value / (target || 1), 1);
  const done = value >= (target || 1);
  const deg = pct * 360;
  return (
    <div className="flex flex-col items-center gap-[5px]">
      <div style={{ width: 50, height: 50, borderRadius: '50%', background: `conic-gradient(${color} ${deg}deg, ${C.line} 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: done ? C.forest : C.ink }}>{done ? '✓' : value}</span>
        </div>
      </div>
      <div style={{ fontSize: 8.5, fontWeight: 600, color: C.inkSoft, whiteSpace: 'nowrap' }}>{label}</div>
    </div>
  );
}

function TrendRow({ weeks, seriesKey, target, label, color }: { weeks: { newOpps: number; referralConvos: number; applications: number }[]; seriesKey: 'newOpps' | 'referralConvos' | 'applications'; target: number; label: string; color: string }) {
  const thisWeekVal = weeks[weeks.length - 1]?.[seriesKey] ?? 0;
  return (
    <div className="flex items-center gap-[9px]">
      <span style={{ fontSize: 9.5, color: C.muted, width: 62, flexShrink: 0 }}>{label}</span>
      <div className="flex gap-[5px]">
        {weeks.map((w, i) => {
          const v = w[seriesKey]; const t = target || 1; const pct = Math.min(v / t, 1); const deg = Math.round(pct * 360);
          const style: CSSProperties = v === 0
            ? { width: 13, height: 13, borderRadius: '50%', background: '#fff', border: `1.5px solid ${C.lineStrong}` }
            : { width: 13, height: 13, borderRadius: '50%', background: `conic-gradient(${color} ${deg}deg, #e9eae3 0deg)`, border: `1px solid ${C.lineStrong}` };
          return <div key={i} title={`${v}/${t}`} style={style} />;
        })}
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, color: C.faint, marginLeft: 4 }} title="This week vs. your weekly target">{thisWeekVal} / {target || 0}</span>
    </div>
  );
}

// ───────── action queue ─────────

interface QueueBtn { label: React.ReactNode; primary: boolean; onClick: () => void }
interface QueueItem { tag: string; action: string; metric: string; btns: QueueBtn[] }

function buildQueue(ctx: {
  activeOpps: Opportunity[];
  opps: Opportunity[];
  staleDays: number;
  noPathOpps: Opportunity[];
  shapeIssues: ShapeIssue[];
  showAutosave: boolean;
  showSchools: boolean;
  onAddOpp: () => void;
  onReview: (id: number) => void;
  onNudge: (id: number) => void;
  onClose: (id: number) => void;
  onSnooze: (id: number) => void;
  onAutosave: () => void;
  onSchools: () => void;
  onHow: () => void;
}): QueueItem[] {
  const { activeOpps, opps, staleDays, noPathOpps, shapeIssues } = ctx;
  const items: QueueItem[] = [];
  const name = (o: Opportunity) => o.company || o.role || 'an opp';

  // Volume
  if (activeOpps.length < ACTIVE_OPP_GOAL) {
    const gap = ACTIVE_OPP_GOAL - activeOpps.length;
    items.push({
      tag: 'Volume', action: `Add ${gap} opportunit${gap === 1 ? 'y' : 'ies'}`,
      metric: `${activeOpps.length} / ${ACTIVE_OPP_GOAL} active`,
      btns: [{ label: <>Add opp <kbd>N</kbd></>, primary: true, onClick: ctx.onAddOpp }],
    });
  }

  // First-run setup nudges
  if (ctx.showAutosave) {
    items.push({ tag: 'Setup', action: 'Set up autosave', metric: 'never lose your data', btns: [{ label: 'Settings ↗', primary: true, onClick: ctx.onAutosave }] });
  }
  if (ctx.showSchools) {
    items.push({ tag: 'Setup', action: 'Add your alumni schools', metric: 'unlocks alumni outreach', btns: [{ label: 'Settings ↗', primary: true, onClick: ctx.onSchools }] });
  }

  // Drafts to groom
  const drafts = opps.filter((o) => o.draft);
  if (drafts.length) {
    items.push({
      tag: 'Hygiene', action: `Groom ${drafts.length} draft opp${drafts.length === 1 ? '' : 's'}`,
      metric: drafts.slice(0, 3).map(name).join(' · '),
      btns: [{ label: 'Review', primary: true, onClick: () => ctx.onReview(drafts[0].id!) }],
    });
  }

  // Hygiene: stale / old
  const hygiene = activeOpps
    .map((o) => ({ o, h: hygieneFor(o, staleDays) }))
    .filter(({ h }) => h.needsAttention)
    .sort((a, b) => a.o.updatedAt - b.o.updatedAt);
  for (const { o, h } of hygiene.slice(0, 5)) {
    items.push({
      tag: 'Hygiene', action: `Re-engage ${name(o)}`,
      metric: h.old ? `${daysAgo(o.createdAt)}d old` : `quiet ${daysAgo(o.updatedAt)}d`,
      btns: [
        { label: 'Nudge', primary: true, onClick: () => ctx.onNudge(o.id!) },
        { label: 'Close', primary: false, onClick: () => ctx.onClose(o.id!) },
      ],
    });
  }

  // No path on early-stage opps (shares the board's computation)
  for (const o of noPathOpps.slice(0, 3)) {
    items.push({
      tag: 'Hygiene', action: `Source a connection for ${name(o)}`, metric: 'no path',
      btns: [
        { label: 'Find', primary: true, onClick: () => ctx.onReview(o.id!) },
        { label: 'Snooze', primary: false, onClick: () => ctx.onSnooze(o.id!) },
      ],
    });
  }

  // Shape
  for (const s of shapeIssues.slice(0, 3)) {
    items.push({ tag: 'Shape', action: s.title, metric: s.severity === 'red' ? 'fix now' : 'rebalance', btns: [{ label: 'How', primary: false, onClick: ctx.onHow }] });
  }

  return items;
}
