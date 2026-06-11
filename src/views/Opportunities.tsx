import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, moveOppToStage, type Opportunity } from '../db';
import { formatCompRange, formatDate, formatWeight, isOverdue, relativeDays } from '../lib/format';
import { Button, EmptyState, Input, PriorityBadge, Select } from '../components/ui';
import OppDrawer from '../components/OppDrawer';
import QuickAddOpp from '../components/QuickAddOpp';

type SortKey = 'company' | 'stage' | 'priority' | 'comp' | 'nextActionDate' | 'updatedAt';

export default function Opportunities() {
  const opps = useLiveQuery(() => db.opportunities.toArray(), []) ?? [];
  const stages = useLiveQuery(() => db.stages.orderBy('order').toArray(), []) ?? [];
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [selected, setSelected] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const stagesById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const compMid = (o: Opportunity) => {
      const lo = o.compMin ?? o.compMax;
      const hi = o.compMax ?? o.compMin;
      return lo != null && hi != null ? (lo + hi) / 2 : -1;
    };
    const sorters: Record<SortKey, (a: Opportunity, b: Opportunity) => number> = {
      company: (a, b) => a.company.localeCompare(b.company),
      stage: (a, b) => (stagesById.get(a.stageId)?.order ?? 0) - (stagesById.get(b.stageId)?.order ?? 0),
      priority: (a, b) => a.priority.localeCompare(b.priority),
      comp: (a, b) => compMid(a) - compMid(b),
      nextActionDate: (a, b) => (a.nextActionDate ?? '9999').localeCompare(b.nextActionDate ?? '9999'),
      updatedAt: (a, b) => a.updatedAt - b.updatedAt,
    };
    return opps
      .filter((o) => {
        const stage = stagesById.get(o.stageId);
        if (!showClosed && stage && stage.kind !== 'active') return false;
        if (stageFilter && o.stageId !== stageFilter) return false;
        if (q && !`${o.company} ${o.role} ${o.location ?? ''} ${o.source ?? ''}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => sorters[sortKey](a, b) * sortDir);
  }, [opps, search, stageFilter, showClosed, sortKey, sortDir, stagesById]);

  const header = (key: SortKey, label: string) => (
    <th
      className="cursor-pointer select-none px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
      onClick={() => {
        if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
        else { setSortKey(key); setSortDir(key === 'updatedAt' ? -1 : 1); }
      }}
    >
      {label} {sortKey === key ? (sortDir === 1 ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, role, source…"
          className="!w-72"
        />
        <Select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="!w-auto">
          <option value="">All stages</option>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="rounded" />
          Show closed
        </label>
        <div className="ml-auto">
          <Button variant="primary" onClick={() => setAdding(true)}>+ Add opportunity</Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No opportunities match">
          Add your first opportunity, or load sample data from Settings to see how it works.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                {header('company', 'Company / Role')}
                {header('stage', 'Stage')}
                {header('priority', 'Priority')}
                {header('comp', 'Comp')}
                {header('nextActionDate', 'Next action')}
                {header('updatedAt', 'Updated')}
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Weight</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const stage = stagesById.get(o.stageId);
                return (
                  <tr
                    key={o.id}
                    className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-indigo-50/40"
                    onClick={() => setSelected(o.id!)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{o.company}</div>
                      <div className="text-xs text-slate-500">{o.role}</div>
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={o.stageId}
                        onChange={(e) => moveOppToStage(o.id!, e.target.value)}
                        className="!w-auto !py-1 !text-xs"
                      >
                        {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </Select>
                    </td>
                    <td className="px-3 py-2.5"><PriorityBadge priority={o.priority} /></td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-600">{formatCompRange(o.compMin, o.compMax)}</td>
                    <td className="px-3 py-2.5">
                      {o.nextAction ? (
                        <div className={isOverdue(o.nextActionDate) ? 'text-red-600' : 'text-slate-600'}>
                          <div className="max-w-[200px] truncate">{o.nextAction}</div>
                          {o.nextActionDate && <div className="text-xs opacity-75">{formatDate(o.nextActionDate)}</div>}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{relativeDays(o.updatedAt)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{stage ? formatWeight(stage.weight) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected != null && <OppDrawer oppId={selected} onClose={() => setSelected(null)} />}
      {adding && <QuickAddOpp onClose={() => setAdding(false)} onCreated={(id) => setSelected(id)} />}
    </div>
  );
}
