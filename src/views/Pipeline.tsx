import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, moveOppToStage, type Opportunity, type Stage } from '../db';
import { findWarmPaths } from '../lib/companyMatch';
import { daysAgo, formatWeight, isOverdue } from '../lib/format';
import { Badge, PriorityBadge } from '../components/ui';
import OppDrawer from '../components/OppDrawer';

export default function Pipeline() {
  const stages = useLiveQuery(() => db.stages.orderBy('order').toArray(), []) ?? [];
  const opps = useLiveQuery(() => db.opportunities.toArray(), []) ?? [];
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) ?? [];
  const oppContacts = useLiveQuery(() => db.oppContacts.toArray(), []) ?? [];
  const referralPaths = useLiveQuery(() => db.referralPaths.toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const [selected, setSelected] = useState<number | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

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

  const byStage = useMemo(() => {
    const m = new Map<string, Opportunity[]>();
    for (const s of stages) m.set(s.id, []);
    for (const o of opps) m.get(o.stageId)?.push(o);
    for (const list of m.values()) {
      list.sort((a, b) => a.priority.localeCompare(b.priority) || b.updatedAt - a.updatedAt);
    }
    return m;
  }, [stages, opps]);

  const handleDrop = (stageId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverStage(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id) moveOppToStage(id, stageId);
  };

  return (
    <div className="flex h-full gap-3 overflow-x-auto pb-4 thin-scroll">
      {stages.map((stage) => {
        const list = byStage.get(stage.id) ?? [];
        const weighted = list.length * (stage.weight / 100);
        return (
          <div
            key={stage.id}
            onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage.id); }}
            onDragLeave={() => setDragOverStage((s) => (s === stage.id ? null : s))}
            onDrop={handleDrop(stage.id)}
            className={`flex w-64 shrink-0 flex-col rounded-xl border bg-slate-50 ${
              dragOverStage === stage.id ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-slate-200'
            } ${stage.kind !== 'active' ? 'bg-slate-100/80' : ''}`}
          >
            <div className="border-b border-slate-200 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">{stage.name}</span>
                <span className="text-xs text-slate-400">{list.length}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-xs text-slate-400">
                <span>{formatWeight(stage.weight)} weight</span>
                {stage.kind === 'active' && list.length > 0 && <span>Σ {weighted.toFixed(2)} offers</span>}
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2 thin-scroll" style={{ minHeight: 120 }}>
              {list.map((opp) => (
                <OppCard
                  key={opp.id}
                  opp={opp}
                  stage={stage}
                  stale={stage.kind === 'active' && daysAgo(opp.updatedAt) >= staleDays}
                  warmPathCount={(linkCounts.get(opp.id!) ?? 0) === 0 ? warmCounts.get(opp.id!) ?? 0 : 0}
                  onClick={() => setSelected(opp.id!)}
                />
              ))}
            </div>
          </div>
        );
      })}
      {selected != null && <OppDrawer oppId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

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
      className={`cursor-pointer rounded-lg border bg-white p-3 shadow-sm transition-shadow hover:shadow-md ${
        stale ? 'border-amber-300' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold leading-tight">{opp.company}</span>
        <PriorityBadge priority={opp.priority} />
      </div>
      <div className="mt-0.5 truncate text-xs text-slate-500">{opp.role}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-slate-400">{days === 0 ? 'today' : `${days}d in stage`}</span>
        {stale && <Badge color="amber" title="No activity recently">stale</Badge>}
        {warmPathCount > 0 && stage.kind === 'active' && stage.weight < 2.5 && (
          <Badge color="green" title="Contacts at this company — open the card to link a referrer">
            {warmPathCount} warm path{warmPathCount > 1 ? 's' : ''}
          </Badge>
        )}
      </div>
      {opp.nextAction && (
        <div className={`mt-1.5 truncate text-xs ${isOverdue(opp.nextActionDate) ? 'font-medium text-red-600' : 'text-slate-600'}`}>
          → {opp.nextAction}
        </div>
      )}
    </div>
  );
}
