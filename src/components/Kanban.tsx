import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, moveOppToStage, type Opportunity, type Priority, type Stage } from '../db';
import { findWarmPaths } from '../lib/companyMatch';
import { burstConfetti } from '../lib/confetti';
import { daysAgo, formatWeight, isOverdue } from '../lib/format';
import { Input, Select } from './ui';
import QuickAddOpp from './QuickAddOpp';

/**
 * The pipeline board. Active stages share the available width (no horizontal
 * scrolling on a 13" laptop); terminal stages are tucked behind a toggle.
 */
export default function Kanban({ onSelect }: { onSelect: (id: number) => void }) {
  const stages = useLiveQuery(() => db.stages.orderBy('order').toArray(), []) ?? [];
  const opps = useLiveQuery(() => db.opportunities.toArray(), []) ?? [];
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) ?? [];
  const oppContacts = useLiveQuery(() => db.oppContacts.toArray(), []) ?? [];
  const referralPaths = useLiveQuery(() => db.referralPaths.toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [addToStage, setAddToStage] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<'' | Priority>('');
  const [showClosed, setShowClosed] = useState(false);

  const staleDays = settings?.staleDays ?? 7;
  const linkCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const l of oppContacts) m.set(l.oppId, (m.get(l.oppId) ?? 0) + 1);
    for (const p of referralPaths) m.set(p.oppId, (m.get(p.oppId) ?? 0) + 1);
    return m;
  }, [oppContacts, referralPaths]);

  const warmCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const o of opps) m.set(o.id!, findWarmPaths(o.company, contacts).length);
    return m;
  }, [opps, contacts]);

  const locations = useMemo(
    () => [...new Set(opps.map((o) => o.location?.trim()).filter((l): l is string => !!l))].sort(),
    [opps],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return opps.filter((o) => {
      if (priorityFilter && o.priority !== priorityFilter) return false;
      if (locationFilter && o.location?.trim() !== locationFilter) return false;
      if (q && !`${o.company} ${o.role} ${o.location ?? ''} ${o.source ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [opps, search, locationFilter, priorityFilter]);

  const byStage = useMemo(() => {
    const m = new Map<string, Opportunity[]>();
    for (const s of stages) m.set(s.id, []);
    for (const o of filtered) m.get(o.stageId)?.push(o);
    for (const list of m.values()) {
      list.sort((a, b) => a.priority.localeCompare(b.priority) || b.updatedAt - a.updatedAt);
    }
    return m;
  }, [stages, filtered]);

  const closedCount = useMemo(() => {
    const terminal = new Set(stages.filter((s) => s.kind !== 'active').map((s) => s.id));
    return opps.filter((o) => terminal.has(o.stageId)).length;
  }, [stages, opps]);

  const visibleStages = showClosed ? stages : stages.filter((s) => s.kind === 'active');
  const filtering = !!(search.trim() || locationFilter || priorityFilter);

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
        <Select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as '' | Priority)} className="!w-auto !py-1">
          <option value="">All priorities</option>
          <option value="A">A — dream job</option>
          <option value="B">B — solid fit</option>
          <option value="C">C — backup</option>
        </Select>
        {filtering && (
          <span className="text-xs text-slate-500">
            {filtered.length} of {opps.length} shown
            <button
              onClick={() => { setSearch(''); setLocationFilter(''); setPriorityFilter(''); }}
              className="ml-2 font-medium text-emerald-700 hover:underline"
            >
              clear
            </button>
          </span>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="rounded" />
          Show closed ({closedCount})
        </label>
      </div>

      {/* Board */}
      <div className="flex gap-2">
        {visibleStages.map((stage) => {
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
                {list.map((opp) => (
                  <OppCard
                    key={opp.id}
                    opp={opp}
                    stage={stage}
                    stale={stage.kind === 'active' && daysAgo(opp.updatedAt) >= staleDays}
                    warmPathCount={(linkCounts.get(opp.id!) ?? 0) === 0 ? warmCounts.get(opp.id!) ?? 0 : 0}
                    onClick={() => onSelect(opp.id!)}
                  />
                ))}
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
  A: 'bg-red-50 text-red-700 ring-red-200',
  B: 'bg-amber-50 text-amber-800 ring-amber-200',
  C: 'bg-slate-100 text-slate-600 ring-slate-200',
};

function OppCard({
  opp, stage, stale, warmPathCount, onClick,
}: {
  opp: Opportunity;
  stage: Stage;
  stale: boolean;
  warmPathCount: number;
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
        {warmPathCount > 0 && stage.kind === 'active' && stage.weight < 2.5 && (
          <span
            className="rounded bg-green-50 px-1 font-medium text-green-700 ring-1 ring-inset ring-green-200"
            title="Contacts at this company — open the card to link a referrer"
          >
            {warmPathCount} warm
          </span>
        )}
      </div>
      {opp.nextAction && (
        <div
          className={`mt-1 truncate text-[11px] ${isOverdue(opp.nextActionDate) ? 'font-medium text-red-600' : 'text-slate-600'}`}
          title={opp.nextAction}
        >
          → {opp.nextAction}
        </div>
      )}
    </div>
  );
}
