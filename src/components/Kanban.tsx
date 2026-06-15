import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, moveOppToStage, type Opportunity, type Priority } from '../db';
import { burstConfetti } from '../lib/confetti';
import { hygieneFor } from '../lib/pipeline';
import { daysAgo, formatTsDate, formatWeight } from '../lib/format';
import { Input, Select } from './ui';
import QuickAddOpp from './QuickAddOpp';

// Column sort options. "Age" is the opportunity's overall age (createdAt).
type SortKey = 'name-asc' | 'name-desc' | 'tier-asc' | 'tier-desc' | 'age-new' | 'age-old';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'tier-asc', label: 'Tier A → C' },
  { value: 'tier-desc', label: 'Tier C → A' },
  { value: 'name-asc', label: 'Name A → Z' },
  { value: 'name-desc', label: 'Name Z → A' },
  { value: 'age-new', label: 'Age: newest first' },
  { value: 'age-old', label: 'Age: oldest first' },
];

const byName = (a: Opportunity, b: Opportunity) =>
  a.company.localeCompare(b.company) || a.role.localeCompare(b.role);

const SORT_COMPARATORS: Record<SortKey, (a: Opportunity, b: Opportunity) => number> = {
  'name-asc': byName,
  'name-desc': (a, b) => -byName(a, b),
  // Tier ties break by most recently touched; keeps the old default behaviour.
  'tier-asc': (a, b) => a.priority.localeCompare(b.priority) || b.updatedAt - a.updatedAt,
  'tier-desc': (a, b) => b.priority.localeCompare(a.priority) || b.updatedAt - a.updatedAt,
  'age-new': (a, b) => b.createdAt - a.createdAt,
  'age-old': (a, b) => a.createdAt - b.createdAt,
};

/**
 * The pipeline board. Active stages share the available width (no horizontal
 * scrolling on a 13" laptop); terminal stages are tucked behind a toggle.
 */
export default function Kanban({ onSelect }: { onSelect: (id: number) => void }) {
  const stages = useLiveQuery(() => db.stages.orderBy('order').toArray(), []) ?? [];
  const opps = useLiveQuery(() => db.opportunities.toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [addToStage, setAddToStage] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [priorities, setPriorities] = useState<Record<Priority, boolean>>({ A: true, B: true, C: true });
  const [sort, setSort] = useState<SortKey>('tier-asc');

  const staleDays = settings?.staleDays ?? 7;

  const locations = useMemo(
    () => [...new Set(opps.map((o) => o.location?.trim()).filter((l): l is string => !!l))].sort(),
    [opps],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return opps.filter((o) => {
      if (!priorities[o.priority]) return false;
      if (locationFilter && o.location?.trim() !== locationFilter) return false;
      if (q && !`${o.company} ${o.role} ${o.location ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [opps, search, locationFilter, priorities]);

  const byStage = useMemo(() => {
    const cmp = SORT_COMPARATORS[sort];
    const m = new Map<string, Opportunity[]>();
    for (const s of stages) m.set(s.id, []);
    for (const o of filtered) m.get(o.stageId)?.push(o);
    for (const list of m.values()) list.sort(cmp);
    return m;
  }, [stages, filtered, sort]);

  const priorityFiltered = !(priorities.A && priorities.B && priorities.C);
  const filtering = !!(search.trim() || locationFilter) || priorityFiltered;

  const handleDrop = (stageId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverStage(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (!id) return;
    const opp = opps.find((o) => o.id === id);
    moveOppToStage(id, stageId);
    if (opp && opp.stageId !== stageId && stages.find((s) => s.id === stageId)?.kind === 'won') {
      burstConfetti(e.clientX, e.clientY);
    }
  };

  return (
    <div>
      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by company, title, location…"
          className="!w-64 !py-1"
        />
        {locations.length > 0 && (
          <Select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="!w-auto !py-1">
            <option value="">All locations</option>
            {locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
        )}
        <div className="flex items-center gap-1.5">
          {(['A', 'B', 'C'] as Priority[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriorities((s) => ({ ...s, [p]: !s[p] }))}
              title={`${priorities[p] ? 'Hide' : 'Show'} priority ${p}`}
              className={`rounded-md px-2.5 py-1 text-xs font-bold ring-1 ring-inset transition-colors ${
                priorities[p] ? PRIORITY_CHIP[p] : 'bg-white text-slate-300 ring-slate-200'
              }`}
            >
              {priorities[p] ? '✓ ' : ''}{p}
            </button>
          ))}
        </div>
        {filtering && (
          <span className="text-xs text-slate-500">
            {filtered.length} of {opps.length} shown
            <button
              onClick={() => { setSearch(''); setLocationFilter(''); setPriorities({ A: true, B: true, C: true }); }}
              className="ml-2 font-medium text-emerald-700 hover:underline"
            >
              clear
            </button>
          </span>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
          Sort
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="!w-auto !py-1">
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </label>
      </div>

      {/* Board */}
      <div className="flex gap-2">
        {stages.map((stage) => {
          const list = byStage.get(stage.id) ?? [];
          const weighted = list.length * (stage.weight / 100);
          return (
            <div
              key={stage.id}
              onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage.id); }}
              onDragLeave={() => setDragOverStage((s) => (s === stage.id ? null : s))}
              onDrop={handleDrop(stage.id)}
              className={`flex min-w-0 flex-1 flex-col rounded-xl border bg-slate-50 ${
                dragOverStage === stage.id ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-slate-200'
              } ${stage.kind !== 'active' ? 'bg-slate-100/80' : ''}`}
            >
              <div className="border-b border-slate-200 px-2 py-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-semibold text-slate-700" title={stage.name}>{stage.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">{list.length}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-400">
                  <span>{formatWeight(stage.weight)}</span>
                  {stage.kind === 'active' && list.length > 0 && <span>Σ {weighted.toFixed(2)}</span>}
                </div>
              </div>
              {/* ~5 cards visible, then the column scrolls */}
              <div className="flex-1 space-y-1.5 overflow-y-auto p-1.5 thin-scroll" style={{ minHeight: 80, maxHeight: 440 }}>
                {list.map((opp) => {
                  const hyg = stage.kind === 'active' ? hygieneFor(opp, staleDays) : null;
                  return (
                    <OppCard
                      key={opp.id}
                      opp={opp}
                      stale={!!hyg && hyg.stale && !hyg.snoozed}
                      okUntil={hyg?.snoozed ? hyg.snoozedUntil : null}
                      onClick={() => onSelect(opp.id!)}
                    />
                  );
                })}
              </div>
              <button
                onClick={() => setAddToStage(stage.id)}
                title={`Add an opp to ${stage.name}`}
                className="m-1.5 mt-0 rounded-lg border border-dashed border-slate-300 py-1 text-sm font-medium text-slate-400 transition-colors hover:border-emerald-400 hover:bg-emerald-50/60 hover:text-emerald-700"
              >
                +
              </button>
            </div>
          );
        })}
      </div>

      {addToStage != null && <QuickAddOpp initialStageId={addToStage} onClose={() => setAddToStage(null)} />}
    </div>
  );
}

const PRIORITY_CHIP: Record<Priority, string> = {
  A: 'bg-emerald-200 text-emerald-900 ring-emerald-300',
  B: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  C: 'bg-slate-100 text-slate-600 ring-slate-200',
};

function OppCard({
  opp, stale, okUntil, onClick,
}: {
  opp: Opportunity;
  stale: boolean;
  okUntil: number | null;
  onClick: () => void;
}) {
  const days = daysAgo(opp.stageEnteredAt);
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', String(opp.id))}
      onClick={onClick}
      className={`cursor-pointer rounded-lg border bg-white p-2 shadow-sm transition-shadow hover:shadow-md ${
        stale ? 'border-amber-300' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="min-w-0 truncate text-xs font-semibold leading-tight" title={opp.company}>{opp.company}</span>
        <span
          className={`shrink-0 rounded px-1 text-[10px] font-bold ring-1 ring-inset ${PRIORITY_CHIP[opp.priority]}`}
          title={`Priority ${opp.priority}`}
        >
          {opp.priority}
        </span>
      </div>
      <div className="mt-0.5 truncate text-[11px] text-slate-500" title={opp.role}>{opp.role}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
        <span className="text-slate-400">{days === 0 ? 'today' : `${days}d`}</span>
        {stale && (
          <span className="rounded bg-amber-50 px-1 font-medium text-amber-800 ring-1 ring-inset ring-amber-200" title="No activity recently">
            stale
          </span>
        )}
        {okUntil && (
          <span className="rounded bg-green-50 px-1 font-medium text-green-700 ring-1 ring-inset ring-green-200" title="You marked this as looking good">
            all good until {formatTsDate(okUntil)}
          </span>
        )}
      </div>
    </div>
  );
}
