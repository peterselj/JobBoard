import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  addReferralPath, createContact, db, deleteOpportunity, logActivity, moveOppToStage, today,
  updateOpportunity, updateReferralPathStatus,
  type Activity, type Contact, type Opportunity, type PathStatus, type Priority, type Relationship, type Stage,
} from '../db';
import { alumniSearchUrl, parseProfileUrl, peopleSearchUrl } from '../lib/linkedin';
import { burstConfetti } from '../lib/confetti';
import { daysAgo, formatDate, formatTsDate, isoDate } from '../lib/format';

// Palette (matches the approved design tokens).
const C = {
  ink: '#1b211d', inkSoft: '#3c453e', muted: '#6f776d', faint: '#9aa298',
  paper: '#f3f3ee', line: '#e6e6df', lineStrong: '#d4d5cc',
  forest: '#234c3a', forest2: '#2f5e4a', forestDeep: '#15352a', sage: '#5e8f72', pale: '#aebfb0',
  amber: '#9a6b1f', amberBg: '#faf4e8', amberCard: '#fdf8ee',
  brick: '#9c3b32', brickBg: '#fbeeec', brickCard: '#fdf3f1',
};
const MONO = "'IBM Plex Mono',ui-monospace,monospace";
const SANS = "'Hanken Grotesk',system-ui,sans-serif";

// PathStatus ↔ board column. Three live columns + two terminal zones.
const COLUMNS: { status: PathStatus; name: string; dot: string }[] = [
  { status: 'identified', name: 'Identified', dot: C.pale },
  { status: 'referral-solicited', name: 'Contacted', dot: C.sage },
  { status: 'chat-booked', name: 'In conversation', dot: C.forest2 },
];
const STAGE_LABEL: Record<PathStatus, string> = {
  'identified': 'Identified', 'referral-solicited': 'Contacted', 'chat-booked': 'In conversation',
  'referral-made': 'Referred', 'dead-end': 'Dead end',
};

const fullName = (c?: Contact) => (c ? `${c.firstName} ${c.lastName}`.trim() : '');
const initials = (c?: Contact) =>
  c ? `${(c.firstName[0] ?? '').toUpperCase()}${(c.lastName[0] ?? '').toUpperCase()}` || '?' : '?';
const kk = (n: number) => Math.round(n / 1000);
function compBand(min?: number | null, max?: number | null): string | null {
  if (min != null && max != null) return min === max ? `$${kk(min)}k` : `$${kk(min)}–${kk(max)}k`;
  if (min != null) return `$${kk(min)}k+`;
  if (max != null) return `up to $${kk(max)}k`;
  return null;
}
function verbFor(a?: Activity): string {
  if (!a) return 'added';
  switch (a.type) {
    case 'outreach': case 'follow-up': case 'intro-solicited': return 'pinged';
    case 'chat-booked': case 'intro-call': return 'chat';
    case 'referral-secured': return 'referred';
    case 'applied': return 'applied';
    case 'recruiter-screen': case 'interview': return 'met';
    default: return 'noted';
  }
}

export default function OpportunityPage({ oppId, onClose }: { oppId: number; onClose: () => void }) {
  const opp = useLiveQuery(() => db.opportunities.get(oppId), [oppId]);
  if (!opp) return null;
  return <OppDetail key={oppId} opp={opp} onClose={onClose} />;
}

function OppDetail({ opp, onClose }: { opp: Opportunity; onClose: () => void }) {
  const oppId = opp.id!;
  const stages = useLiveQuery(() => db.stages.orderBy('order').toArray(), []) ?? [];
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) ?? [];
  const paths = useLiveQuery(() => db.referralPaths.where('oppId').equals(oppId).toArray(), [oppId]) ?? [];
  const activities = useLiveQuery(() => db.activities.toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.get('app'), []);

  const schools = settings?.schools ?? [];
  const contactsById = useMemo(() => new Map(contacts.map((c) => [c.id!, c])), [contacts]);
  const actsByContact = useMemo(() => {
    const m = new Map<number, Activity[]>();
    for (const a of activities) if (a.contactId != null) (m.get(a.contactId) ?? m.set(a.contactId, []).get(a.contactId)!).push(a);
    for (const list of m.values()) list.sort((x, y) => actTs(y) - actTs(x));
    return m;
  }, [activities]);

  const [editingPath, setEditingPath] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && editingPath == null) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, editingPath]);

  // ---- inroads (referral paths joined to contacts) ----
  const inroads = useMemo(
    () =>
      paths
        .map((p) => {
          const target = contactsById.get(p.targetContactId);
          if (!target) return null;
          const via = p.viaContactId ? contactsById.get(p.viaContactId) : undefined;
          const acts = actsByContact.get(target.id!) ?? [];
          const last = acts[0];
          const lastTs = last ? actTs(last) : p.createdAt;
          const idle = daysAgo(lastTs);
          return { path: p, target, via, acts, idle, lastVerb: verbFor(last), neverContacted: !last };
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    [paths, contactsById, actsByContact],
  );

  const nonTerminal = inroads.filter((i) => i.path.status !== 'referral-made' && i.path.status !== 'dead-end');
  const referred = inroads.filter((i) => i.path.status === 'referral-made');
  const deadEnds = inroads.filter((i) => i.path.status === 'dead-end');

  // Days since last activity across the whole opp (+ which contact).
  const pathContactIds = new Set<number>(paths.flatMap((p) => [p.targetContactId, ...(p.viaContactId ? [p.viaContactId] : [])]));
  const oppActs = activities
    .filter((a) => a.oppId === oppId || (a.contactId != null && pathContactIds.has(a.contactId)))
    .sort((x, y) => actTs(y) - actTs(x));
  const freshest = oppActs[0];
  const daysSince = freshest ? daysAgo(actTs(freshest)) : null;
  const freshestWho = freshest?.contactId != null ? contactsById.get(freshest.contactId) : undefined;

  // ---- drag & drop ----
  const dropTo = (status: PathStatus) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (!id) return;
    // Only celebrate a real advance — re-dropping an already-referred card is a no-op.
    const moved = paths.find((p) => p.id === id)?.status !== status;
    updateReferralPathStatus(id, status);
    if (status === 'referral-made' && moved) burstConfetti(e.clientX, e.clientY);
  };

  // ---- composer ----
  // Reuse an existing contact when the input matches one (LinkedIn URL, email,
  // or full name) — connectors especially recur across opps, and typing
  // "Maya Chen" twice must not create two Mayas.
  const resolveContact = async (input: string, relationship: Relationship, company?: string): Promise<number> => {
    const text = input.trim();
    const prof = parseProfileUrl(text);
    if (prof) {
      const existing = contacts.find((c) => c.linkedinUrl === prof.linkedinUrl);
      if (existing) return existing.id!;
      return createContact({ firstName: prof.firstName, lastName: prof.lastName, linkedinUrl: prof.linkedinUrl, relationship, company });
    }
    if (text.includes('@')) {
      const email = text.toLowerCase();
      const existing = contacts.find((c) => c.email?.toLowerCase() === email);
      if (existing) return existing.id!;
      return createContact({ firstName: text.split('@')[0], lastName: '', email: text, relationship, company });
    }
    const lower = text.toLowerCase();
    const existing = contacts.find((c) => fullName(c).toLowerCase() === lower);
    if (existing) return existing.id!;
    const parts = text.split(/\s+/);
    return createContact({ firstName: parts[0], lastName: parts.slice(1).join(' '), relationship, company });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(21,33,29,.45)', fontFamily: SANS, color: C.ink }} onMouseDown={(e) => e.target === e.currentTarget && editingPath == null && onClose()}>
      <div className="flex flex-col overflow-hidden" style={{ width: 'min(1320px, 97vw)', height: 'min(824px, 94vh)', background: C.paper, borderRadius: 2, boxShadow: '0 24px 70px rgba(0,0,0,.4)' }}>
        {/* ───── HEADER ───── */}
        <header className="flex shrink-0 items-stretch bg-white" style={{ height: 88, borderBottom: `1px solid ${C.lineStrong}` }}>
          <CompanyRoleCell opp={opp} />
          <KpiCell label="Inroads" value={String(nonTerminal.length)} guide="goal 3" color={C.amber} bg={C.amberBg} width={168} />
          <KpiCell label="Days since last activity" value={daysSince == null ? '—' : String(daysSince)} guide={freshest ? `${verbFor(freshest)}${freshestWho ? ` · ${freshestWho.firstName}` : ''}` : 'no activity yet'} color={C.forest} bg="#eef4f0" width={184} />
          <DetailsCell opp={opp} stages={stages} onClose={onClose} />
        </header>

        {/* ───── BODY ───── */}
        <div className="flex min-h-0 flex-1" style={{ position: 'relative' }}>
          {/* composer + notes sidebar */}
          <Composer
            company={opp.company}
            schools={schools}
            onCreate1st={async (v) => { const id = await resolveContact(v, '1st', opp.company); await addReferralPath(oppId, id, null); }}
            onCreate2nd={async (conn, tgt) => { const cid = await resolveContact(conn, '1st'); const tid = await resolveContact(tgt, '2nd', opp.company); await addReferralPath(oppId, tid, cid); }}
            onCreateAlumni={async (v) => { const id = await resolveContact(v, 'alum', opp.company); await addReferralPath(oppId, id, null); }}
            opp={opp}
            onDelete={async () => { if (window.confirm(`Delete "${opp.company || 'this opportunity'}" and all its inroads & activity? This cannot be undone.`)) { await deleteOpportunity(oppId); onClose(); } }}
          />

          {/* pipeline + terminal */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1" style={{ background: C.paper }}>
              {COLUMNS.map((col, ci) => {
                const list = nonTerminal.filter((i) => i.path.status === col.status);
                return (
                  <div
                    key={col.status}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(col.status); }}
                    onDragLeave={() => setDragOver((s) => (s === col.status ? null : s))}
                    onDrop={dropTo(col.status)}
                    className="flex min-w-0 flex-1 flex-col overflow-hidden"
                    style={{ borderRight: ci < 2 ? `1px solid ${C.line}` : undefined, background: dragOver === col.status ? '#eef4f0' : undefined }}
                  >
                    <div className="flex shrink-0 items-center gap-1.5 bg-white px-[13px]" style={{ height: 34, borderBottom: `1px solid ${C.line}` }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.dot }} />
                      <span style={{ fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap' }}>{col.name}</span>
                      <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint, marginLeft: 'auto' }}>{list.length}</span>
                    </div>
                    <div className="thin-scroll flex flex-1 flex-col gap-[9px] overflow-y-auto p-[10px]">
                      {list.map((i) => <InroadCard key={i.path.id} inroad={i} onOpen={() => setEditingPath(i.path.id!)} />)}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* terminal zones */}
            <div className="flex items-stretch gap-[10px] bg-[#fbfbf8] px-3 py-[9px]" style={{ height: 86, borderTop: `1px solid ${C.lineStrong}` }}>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver('__dead'); }}
                onDragLeave={() => setDragOver((s) => (s === '__dead' ? null : s))}
                onDrop={dropTo('dead-end')}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2"
                style={{ border: `2px dashed ${dragOver === '__dead' ? C.brick : C.lineStrong}`, background: dragOver === '__dead' ? C.brickBg : undefined }}
              >
                <div className="shrink-0">
                  <div className="flex items-center gap-1.5"><span style={{ width: 7, height: 7, borderRadius: 2, background: C.faint }} /><span style={{ fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700, color: C.muted }}>Dead end</span></div>
                  <span style={{ fontFamily: MONO, fontSize: 9, color: C.faint }}>{deadEnds.length} · drag here</span>
                </div>
                <div className="flex flex-wrap content-center gap-[7px]">
                  {deadEnds.slice(0, 6).map((i) => (
                    <div key={i.path.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i.path.id))} className="flex items-center gap-[7px] rounded-[5px] border bg-white px-[9px] py-1.5" style={{ borderColor: C.line, cursor: 'grab' }} title="Drag back to a column, or × to delete">
                      <button onClick={() => setEditingPath(i.path.id!)} style={{ fontSize: 11, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{fullName(i.target) || 'Contact'}</button>
                      <button title="Delete inroad" onClick={() => { if (window.confirm(`Delete the inroad "${fullName(i.target) || 'this contact'}" from ${opp.company || 'this opp'}?`)) db.referralPaths.delete(i.path.id!); }} style={{ color: C.faint, fontSize: 12, cursor: 'pointer', background: 'none', border: 'none' }}>×</button>
                    </div>
                  ))}
                </div>
              </div>
              <div
                draggable={referred.length > 0}
                onDragStart={(e) => referred[0] && e.dataTransfer.setData('text/plain', String(referred[0].path.id))}
                onDragOver={(e) => { e.preventDefault(); setDragOver('__ref'); }}
                onDragLeave={() => setDragOver((s) => (s === '__ref' ? null : s))}
                onDrop={dropTo('referral-made')}
                className="flex shrink-0 items-center gap-[10px] rounded-lg px-[14px] py-2"
                style={{ width: 300, border: `2px dashed ${dragOver === '__ref' ? '#cfe6d6' : '#bcd6c5'}`, background: C.forestDeep, color: '#eaf2ec', cursor: referred.length ? 'grab' : undefined }}
                title={referred.length ? 'Drag back to a column to undo' : undefined}
              >
                <span style={{ fontSize: 16, color: '#cfe6d6' }}>✦</span>
                <div className="min-w-0">
                  <div style={{ fontSize: 9, letterSpacing: '.09em', textTransform: 'uppercase', fontWeight: 700, color: '#9fc0ad' }}>Referred!</div>
                  <div className="truncate" style={{ fontSize: 12.5, fontWeight: 700, color: '#fff' }}>{referred.length ? fullName(referred[0].target) : 'Drag a contact here'}</div>
                  <div style={{ fontSize: 9.5, color: '#bcd6c5' }}>{referred.length ? `referred you${referred.length > 1 ? ` · ${referred.length}` : ''} 🎉` : 'when someone refers you'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* contact editor over the board */}
          {editingPath != null && (() => {
            const i = inroads.find((x) => x.path.id === editingPath);
            if (!i) return null;
            return <ContactEditor key={editingPath} oppId={oppId} target={i.target} connector={i.via} status={i.path.status} acts={i.acts} pathCreatedAt={i.path.createdAt} onClose={() => setEditingPath(null)} />;
          })()}
        </div>
      </div>
    </div>
  );
}

function actTs(a: Activity): number {
  const parsed = new Date(`${a.date}T12:00:00`).getTime();
  return Number.isNaN(parsed) ? a.createdAt : parsed;
}

// ───────── header cells ─────────

function CompanyRoleCell({ opp }: { opp: Opportunity }) {
  const oppId = opp.id!;
  const [editing, setEditing] = useState(opp.company === '' && opp.role === '');
  const [company, setCompany] = useState(opp.company);
  const [role, setRole] = useState(opp.role);
  const commit = () => { updateOpportunity(oppId, { company: company.trim(), role: role.trim() }); setEditing(false); };
  return (
    <div className="hovrev relative flex shrink-0 flex-col justify-center gap-1 px-[18px]" style={{ width: 262, borderRight: `1px solid ${C.line}` }} onDoubleClick={() => setEditing(true)}>
      {editing ? (
        <>
          <input autoFocus value={company} onChange={(e) => setCompany(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commit()} placeholder="Company ↵" style={{ fontFamily: SANS, fontSize: 18, fontWeight: 800, border: `1px solid ${C.lineStrong}`, borderRadius: 5, padding: '2px 6px', outline: 'none' }} />
          <input value={role} onChange={(e) => setRole(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commit()} onBlur={commit} placeholder="Role / title ↵" style={{ fontFamily: SANS, fontSize: 12, color: C.inkSoft, border: `1px solid ${C.lineStrong}`, borderRadius: 5, padding: '2px 6px', outline: 'none' }} />
        </>
      ) : (
        <>
          <span className="truncate" style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-.02em', maxWidth: '100%' }} title={opp.company || undefined}>{opp.company || 'Untitled'}</span>
          <span className="truncate" style={{ fontSize: 12.5, color: C.inkSoft, maxWidth: '100%' }} title={opp.role || undefined}>{opp.role || 'role pending'}</span>
          <span className="hovhint" style={{ position: 'absolute', bottom: 9, right: 14, fontSize: 8, fontWeight: 600, color: C.muted, background: 'rgba(255,255,255,.94)', border: `1px solid ${C.lineStrong}`, borderRadius: 9, padding: '2px 7px', pointerEvents: 'none' }}>double-click to edit</span>
        </>
      )}
    </div>
  );
}

function KpiCell({ label, value, guide, color, bg, width }: { label: string; value: string; guide: string; color: string; bg: string; width: number }) {
  return (
    <div className="flex shrink-0 flex-col justify-center px-[18px]" style={{ width, borderRight: `1px solid ${C.line}`, borderTop: `3px solid ${color}`, background: bg }}>
      <span style={{ fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', color: C.inkSoft, fontWeight: 700 }}>{label}</span>
      <div className="flex items-baseline gap-[7px]" style={{ marginTop: 6 }}>
        <span style={{ fontFamily: MONO, fontSize: 32, fontWeight: 500, letterSpacing: '-.03em', color, lineHeight: 1 }}>{value}</span>
        <span style={{ fontSize: 11, color: C.faint, whiteSpace: 'nowrap' }}>{guide}</span>
      </div>
    </div>
  );
}

function DetailsCell({ opp, stages, onClose }: { opp: Opportunity; stages: Stage[]; onClose: () => void }) {
  const oppId = opp.id!;
  const band = compBand(opp.compMin, opp.compMax);
  return (
    <div className="hovrev flex min-w-0 flex-1 flex-col justify-center px-[18px]">
      <div className="mb-[10px] flex items-center gap-[10px]">
        <span style={{ fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', color: C.inkSoft, fontWeight: 700 }}>Opportunity</span>
        <span className="hovhint" style={{ fontSize: 10, color: C.forest, fontWeight: 600 }}>✎ double-click any field to edit</span>
        <button onClick={onClose} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.muted, cursor: 'pointer', background: 'none', border: 'none' }}>✕ <kbd>esc</kbd></button>
      </div>
      <div className="flex items-stretch">
        <StageField stageId={opp.stageId} stages={stages} onSave={(id) => moveOppToStage(oppId, id)} />
        <CompField opp={opp} band={band} />
        <PriorityField value={opp.priority} onSave={(p) => updateOpportunity(oppId, { priority: p })} />
        <TextField label="Location" value={opp.location ?? ''} placeholder="+ add" onSave={(v) => updateOpportunity(oppId, { location: v.trim() || undefined })} />
        <UrlField opp={opp} />
      </div>
    </div>
  );
}

const fieldLabel: CSSProperties = { fontSize: 8, letterSpacing: '.05em', textTransform: 'uppercase', color: C.faint, fontWeight: 700 };

function DetailField({ label, first, flex, children }: { label: string; first?: boolean; flex?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ padding: first ? '0 16px 0 0' : '0 16px', borderLeft: first ? undefined : `1px solid ${C.line}`, minWidth: flex ? 0 : undefined, flex: flex ? 1 : undefined }}>
      <div style={fieldLabel}>{label}</div>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

function TextField({ label, value, placeholder, onSave }: { label: string; value: string; placeholder: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const commit = () => { onSave(draft); setEditing(false); };
  return (
    <DetailField label={label}>
      {editing ? (
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }} style={{ fontFamily: SANS, fontSize: 12, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: '1px 5px', outline: 'none', width: 110 }} />
      ) : (
        <span onDoubleClick={() => { setDraft(value); setEditing(true); }} style={{ fontSize: 12, marginTop: 0, color: value ? C.ink : C.forest, fontWeight: 600, cursor: 'pointer' }}>{value || placeholder}</span>
      )}
    </DetailField>
  );
}

function StageField({ stageId, stages, onSave }: { stageId: string; stages: Stage[]; onSave: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const cur = stages.find((s) => s.id === stageId);
  return (
    <DetailField label="Stage" first>
      {editing ? (
        <select autoFocus value={stageId} onChange={(e) => { onSave(e.target.value); setEditing(false); }} onBlur={() => setEditing(false)} style={{ fontFamily: SANS, fontSize: 12, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: '1px 4px', outline: 'none', maxWidth: 150 }}>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      ) : (
        <span onDoubleClick={() => setEditing(true)} style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600, cursor: 'pointer' }}>
          {cur?.name ?? '—'} {cur && <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint, fontWeight: 500 }}>{cur.weight % 1 === 0 ? cur.weight : cur.weight.toFixed(1)}%</span>}
        </span>
      )}
    </DetailField>
  );
}

function PriorityField({ value, onSave }: { value: Priority; onSave: (p: Priority) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <DetailField label="Priority">
      {editing ? (
        <div className="flex gap-[3px]">
          {(['A', 'B', 'C'] as Priority[]).map((p) => {
            const on = p === value;
            return (
              <button key={p} onClick={() => { onSave(p); setEditing(false); }} style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, width: 20, height: 18, borderRadius: 4, border: `1px solid ${on ? C.forest : C.lineStrong}`, background: on ? C.forest : '#fff', color: on ? '#fff' : C.muted, cursor: 'pointer' }}>{p}</button>
            );
          })}
        </div>
      ) : (
        <span onDoubleClick={() => setEditing(true)} style={{ fontSize: 12, color: C.ink, fontWeight: 600, cursor: 'pointer' }}>{value}</span>
      )}
    </DetailField>
  );
}

function CompField({ opp, band }: { opp: Opportunity; band: string | null }) {
  const oppId = opp.id!;
  const [editing, setEditing] = useState(false);
  const [lo, setLo] = useState(opp.compMin ? String(kk(opp.compMin)) : '');
  const [hi, setHi] = useState(opp.compMax ? String(kk(opp.compMax)) : '');
  const commit = () => {
    updateOpportunity(oppId, { compMin: lo ? Number(lo) * 1000 : null, compMax: hi ? Number(hi) * 1000 : null });
    setEditing(false);
  };
  return (
    <DetailField label="Comp band">
      {editing ? (
        <span className="flex items-center gap-1" style={{ fontFamily: MONO, fontSize: 11 }} onBlur={commit}>
          $<input autoFocus value={lo} onChange={(e) => setLo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commit()} style={{ width: 34, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: '1px 3px', fontFamily: MONO, outline: 'none' }} />–
          <input value={hi} onChange={(e) => setHi(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commit()} style={{ width: 34, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: '1px 3px', fontFamily: MONO, outline: 'none' }} />k
        </span>
      ) : (
        <span onDoubleClick={() => { setLo(opp.compMin ? String(kk(opp.compMin)) : ''); setHi(opp.compMax ? String(kk(opp.compMax)) : ''); setEditing(true); }} style={{ fontFamily: band ? MONO : SANS, fontSize: 12, color: band ? C.inkSoft : C.forest, fontWeight: band ? 400 : 600, cursor: 'pointer' }}>{band ?? '+ set'}</span>
      )}
    </DetailField>
  );
}

function UrlField({ opp }: { opp: Opportunity }) {
  const oppId = opp.id!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(opp.jobUrl ?? '');
  const commit = () => { updateOpportunity(oppId, { jobUrl: draft.trim() || undefined }); setEditing(false); };
  const display = (opp.jobUrl ?? '').replace(/^https?:\/\//, '');
  return (
    <DetailField label="Job URL" flex>
      {editing ? (
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }} placeholder="https://…" style={{ fontFamily: MONO, fontSize: 11, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: '2px 6px', outline: 'none', width: '100%' }} />
      ) : opp.jobUrl ? (
        <div className="flex items-center gap-[7px]">
          <span onDoubleClick={() => { setDraft(opp.jobUrl ?? ''); setEditing(true); }} className="truncate" style={{ fontFamily: MONO, fontSize: 12, color: C.inkSoft, maxWidth: 148, cursor: 'pointer' }} title={opp.jobUrl}>{display}</span>
          <a href={opp.jobUrl} target="_blank" rel="noreferrer" style={{ fontSize: 9.5, fontWeight: 700, color: C.forest, border: `1px solid ${C.lineStrong}`, borderRadius: 5, padding: '3px 8px', flexShrink: 0, textDecoration: 'none' }}>Visit ↗</a>
        </div>
      ) : (
        <span onDoubleClick={() => setEditing(true)} style={{ fontSize: 12, color: C.forest, fontWeight: 600, cursor: 'pointer' }}>+ add</span>
      )}
    </DetailField>
  );
}

// ───────── composer sidebar ─────────

function Composer({
  company, schools, onCreate1st, onCreate2nd, onCreateAlumni, opp, onDelete,
}: {
  company: string;
  schools: { name: string; id: string }[];
  onCreate1st: (v: string) => Promise<void>;
  onCreate2nd: (conn: string, tgt: string) => Promise<void>;
  onCreateAlumni: (v: string) => Promise<void>;
  opp: Opportunity;
  onDelete: () => void;
}) {
  const [first1, setFirst1] = useState('');
  const [conn, setConn] = useState('');
  const [tgt, setTgt] = useState('');
  const [alum, setAlum] = useState('');
  const [connErr, setConnErr] = useState(false);
  const [tgtErr, setTgtErr] = useState(false);
  const [notes, setNotes] = useState(opp.notes ?? '');
  const notesSave = () => updateOpportunity(opp.id!, { notes: notes.trim() || undefined });

  const submit1 = async () => { if (first1.trim()) { await onCreate1st(first1); setFirst1(''); } };
  const submit2 = async () => {
    const ce = !conn.trim(), te = !tgt.trim();
    setConnErr(ce); setTgtErr(te);
    if (ce || te) return;
    await onCreate2nd(conn, tgt); setConn(''); setTgt(''); setConnErr(false); setTgtErr(false);
  };
  const path2err = connErr && tgtErr ? 'Add a connector and a target to submit this path'
    : tgtErr ? 'Add a target to submit this path'
    : connErr ? 'Add a connector to submit this path' : '';
  const submitA = async () => { if (alum.trim()) { await onCreateAlumni(alum); setAlum(''); } };

  const inputCss: CSSProperties = { width: '100%', fontFamily: SANS, fontSize: 11, padding: '8px 10px', border: `1px solid ${C.lineStrong}`, borderRadius: 6, outline: 'none', background: '#fff' };
  const findLink: CSSProperties = { fontSize: 10.5, color: C.forest, fontWeight: 600, cursor: 'pointer', textDecoration: 'none' };
  const sectionTitle: CSSProperties = { fontSize: 11.5, fontWeight: 800 };
  const barStyle: CSSProperties = { height: 34, flexShrink: 0, padding: '0 14px', background: C.forestDeep, display: 'flex', alignItems: 'center' };
  const barText: CSSProperties = { fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, color: '#eaf2ec' };

  return (
    <aside className="flex shrink-0 flex-col overflow-hidden bg-[#fbfbf8]" style={{ width: 262, borderRight: `1px solid ${C.lineStrong}` }}>
      <div style={barStyle}><span style={barText}>Add an inroad</span></div>
      <div className="thin-scroll flex flex-col gap-[17px] overflow-y-auto px-[14px] py-[15px]">
        <div>
          <div className="mb-2 flex items-center gap-1.5"><span style={sectionTitle}>1st degree</span><a style={{ ...findLink, marginLeft: 'auto' }} href={peopleSearchUrl(company, 'F')} target="_blank" rel="noreferrer">Find ↗</a></div>
          <input value={first1} onChange={(e) => setFirst1(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit1()} placeholder="Name, email, or URL ↵" style={inputCss} />
        </div>
        <div>
          <div className="mb-2 flex items-center gap-1.5"><span style={sectionTitle}>2nd degree</span><a style={{ ...findLink, marginLeft: 'auto' }} href={peopleSearchUrl(company, 'S')} target="_blank" rel="noreferrer">Find ↗</a></div>
          <input value={conn} onChange={(e) => { setConn(e.target.value); if (e.target.value.trim()) setConnErr(false); }} onKeyDown={(e) => e.key === 'Enter' && submit2()} placeholder="Connector you know ↵" style={{ ...inputCss, border: connErr ? `1.5px solid ${C.brick}` : `1px solid ${C.lineStrong}`, boxShadow: connErr ? '0 0 0 3px rgba(156,59,50,.08)' : undefined }} />
          <div className="ml-1 mt-1.5 flex items-center gap-1.5">
            <span style={{ fontSize: 12, color: C.muted }}>↳</span>
            <input value={tgt} onChange={(e) => { setTgt(e.target.value); if (e.target.value.trim()) setTgtErr(false); }} onKeyDown={(e) => e.key === 'Enter' && submit2()} placeholder={`Target at ${company || 'company'} ↵`} style={{ ...inputCss, flex: 1, minWidth: 0, border: tgtErr ? `1.5px solid ${C.brick}` : `1px solid ${C.lineStrong}`, boxShadow: tgtErr ? '0 0 0 3px rgba(156,59,50,.08)' : undefined }} />
          </div>
          {path2err && <div style={{ fontSize: 9, color: C.brick, margin: '5px 0 0 22px', fontWeight: 600 }}>{path2err}</div>}
        </div>
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span style={sectionTitle}>Alumni</span>
            <div className="ml-auto flex gap-2">
              {schools.length === 0 && <span style={{ fontSize: 9.5, color: C.faint }}>add schools in Settings</span>}
              {schools.map((s) => <a key={s.id} style={findLink} href={alumniSearchUrl(s.id, company)} target="_blank" rel="noreferrer">{s.name} ↗</a>)}
            </div>
          </div>
          <input value={alum} onChange={(e) => setAlum(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitA()} placeholder="Name, email, or URL ↵" style={inputCss} />
        </div>
      </div>

      {/* Opp notes (also a spot for other contacts) */}
      <div style={barStyle}><span style={barText}>Notes</span></div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={notesSave}
        placeholder="Opp-level notes — recruiters, interviewers, anything to remember…"
        className="thin-scroll flex-1"
        style={{ resize: 'none', fontFamily: SANS, fontSize: 10.5, lineHeight: 1.5, padding: '10px 12px', border: 'none', outline: 'none', background: '#fbfbf8', color: C.inkSoft, minHeight: 60 }}
      />
      <button onClick={onDelete} title="Delete this opportunity" style={{ flexShrink: 0, textAlign: 'left', fontSize: 9.5, color: C.faint, padding: '6px 14px', borderTop: `1px solid ${C.line}`, background: '#fbfbf8', border: 'none', cursor: 'pointer' }}>Delete opportunity</button>
    </aside>
  );
}

// ───────── inroad card ─────────

function InroadCard({ inroad, onOpen }: { inroad: { path: { id?: number }; target: Contact; via?: Contact; idle: number; lastVerb: string; neverContacted: boolean }; onOpen: () => void }) {
  const { target, via, idle, lastVerb, neverContacted } = inroad;
  const tone = idle >= 7 ? 'brick' : idle >= 3 ? 'amber' : 'none';
  const cardStyle: CSSProperties =
    tone === 'brick' ? { background: C.brickCard, border: `1px solid ${C.brick}` }
    : tone === 'amber' ? { background: C.amberCard, border: `1px solid ${C.amber}` }
    : { background: '#fff', border: `1px solid ${C.line}` };
  const actColor = tone === 'brick' ? C.brick : tone === 'amber' ? C.amber : C.faint;
  const chip = via ? `2nd · via ${via.firstName}` : target.relationship === 'alum' ? 'Alum' : '1st';
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', String(inroad.path.id))}
      onDoubleClick={onOpen}
      style={{ ...cardStyle, borderRadius: 8, padding: '11px 12px', cursor: 'grab', boxShadow: '0 1px 2px rgba(0,0,0,.03)' }}
    >
      <div className="flex items-start gap-[9px]">
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#eef0ea', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.inkSoft, flexShrink: 0 }}>{initials(target)}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate" style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.15 }}>{fullName(target) || 'Contact'}</div>
          <div className="truncate" style={{ fontSize: 9.5, color: C.muted }}>{target.title || '—'}</div>
        </div>
        <span style={{ fontSize: 12, color: C.faint, letterSpacing: '-1px' }}>⋮⋮</span>
      </div>
      <div className="mt-[9px] flex items-center gap-[5px]">
        <span style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: C.muted, background: '#f0f1ec', borderRadius: 3, padding: '2px 6px' }}>{chip}</span>
        <span style={{ fontFamily: MONO, fontSize: 8.5, color: actColor, fontWeight: tone === 'none' ? 400 : 600, marginLeft: 'auto' }}>{neverContacted ? 'added' : lastVerb} · {idle}d</span>
      </div>
    </div>
  );
}

// ───────── contact editor ─────────

const QUICK_ACTS: { label: string; type: Activity['type']; daysBack: number }[] = [
  { label: 'Pinged · today', type: 'outreach', daysBack: 0 },
  { label: 'Pinged · yesterday', type: 'outreach', daysBack: 1 },
  { label: 'Convo booked', type: 'chat-booked', daysBack: 0 },
];

function ContactEditor({
  oppId, target, connector, status, acts, pathCreatedAt, onClose,
}: {
  oppId: number;
  target: Contact;
  connector?: Contact;
  status: PathStatus;
  acts: Activity[];
  pathCreatedAt: number;
  onClose: () => void;
}) {
  const is2nd = !!connector;
  const [t, setT] = useState({ name: fullName(target), title: target.title ?? '', linkedinUrl: target.linkedinUrl ?? '', email: target.email ?? '', phone: target.phone ?? '', other: target.other ?? '', notes: target.notes ?? '' });
  const [c, setC] = useState(connector ? { name: fullName(connector), linkedinUrl: connector.linkedinUrl ?? '', email: connector.email ?? '', phone: connector.phone ?? '', other: connector.other ?? '' } : null);
  const [customDate, setCustomDate] = useState(today());
  const [customAct, setCustomAct] = useState('');

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);

  const splitName = (n: string) => { const p = n.trim().split(/\s+/); return { firstName: p[0] ?? '', lastName: p.slice(1).join(' ') }; };
  const save = async () => {
    await db.contacts.update(target.id!, { ...splitName(t.name), title: t.title.trim() || undefined, linkedinUrl: t.linkedinUrl.trim() || undefined, email: t.email.trim() || undefined, phone: t.phone.trim() || undefined, other: t.other.trim() || undefined, notes: t.notes.trim() || undefined });
    if (connector && c) await db.contacts.update(connector.id!, { ...splitName(c.name), linkedinUrl: c.linkedinUrl.trim() || undefined, email: c.email.trim() || undefined, phone: c.phone.trim() || undefined, other: c.other.trim() || undefined });
    onClose();
  };
  const quickLog = (type: Activity['type'], daysBack: number, label: string) => {
    logActivity({ oppId, contactId: target.id!, type, date: isoDate(daysBack), notes: label.split(' · ')[0] });
  };
  const logCustom = () => { if (!customAct.trim()) return; logActivity({ oppId, contactId: target.id!, type: 'note', date: customDate, notes: customAct.trim() }); setCustomAct(''); };

  const fieldRow = (label: string, value: string, onChange: (v: string) => void, mono = false, placeholder = `add ${label.toLowerCase()}`) => (
    <div className="flex items-center gap-[7px]">
      <span style={{ fontSize: 9, color: C.muted, width: 46, flexShrink: 0 }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ flex: 1, minWidth: 0, fontFamily: mono ? MONO : SANS, fontSize: 10.5, padding: '6px 9px', border: `1px solid ${C.lineStrong}`, borderRadius: 6, outline: 'none', background: '#fff', color: C.inkSoft }} />
    </div>
  );

  const timeline = [...acts].map((a) => ({ key: `a${a.id}`, label: a.notes || a.type, date: formatDate(a.date) }));
  // Local date, not toISOString (UTC) — an evening add must not show tomorrow's date.
  timeline.push({ key: 'added', label: 'Added as an inroad', date: formatTsDate(pathCreatedAt) });

  return (
    <>
      <div className="absolute inset-0" style={{ background: 'rgba(21,53,42,.36)' }} onMouseDown={onClose} />
      <div className="absolute" style={{ top: '50%', left: 'calc(262px + (100% - 262px)/2)', transform: 'translate(-50%,-50%)', width: 'min(776px, 90%)', maxHeight: '95%', background: '#fff', borderRadius: 13, boxShadow: '0 28px 70px rgba(0,0,0,.42)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* editor header */}
        <div className="flex items-center gap-3 px-4 py-[13px]" style={{ borderBottom: `1px solid ${C.line}`, background: '#fbfbf8' }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#eef0ea', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: C.inkSoft, flexShrink: 0 }}>{initials(target)}</div>
          <div className="min-w-0">
            <input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} style={{ fontFamily: SANS, fontSize: 16, fontWeight: 700, padding: '2px 6px', border: '1px solid transparent', borderRadius: 5, outline: 'none', width: 200 }} onFocus={(e) => (e.target.style.borderColor = C.lineStrong)} onBlur={(e) => (e.target.style.borderColor = 'transparent')} />
            <input value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} placeholder="title" style={{ display: 'block', fontFamily: SANS, fontSize: 11, color: C.muted, padding: '1px 6px', border: '1px solid transparent', borderRadius: 5, outline: 'none', width: 200 }} onFocus={(e) => (e.target.style.borderColor = C.lineStrong)} onBlur={(e) => (e.target.style.borderColor = 'transparent')} />
          </div>
          <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: C.muted, background: '#f0f1ec', borderRadius: 4, padding: '5px 9px' }}>Stage: {STAGE_LABEL[status]}</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={save} style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: C.forest, borderRadius: 7, padding: '8px 17px', cursor: 'pointer', border: 'none' }}>Save</button>
            <button onClick={onClose} style={{ fontSize: 12, fontWeight: 600, color: C.muted, padding: '8px 4px', cursor: 'pointer', background: 'none', border: 'none' }}>Cancel</button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          {/* left — sized to content; never scrolls (timeline + notes scroll instead) */}
          <div className="flex flex-col gap-3 px-4 py-[14px]" style={{ width: 344, flexShrink: 0, borderRight: `1px solid ${C.line}` }}>
            <div>
              <div style={{ fontSize: 8.5, letterSpacing: '.06em', textTransform: 'uppercase', color: C.faint, fontWeight: 700, marginBottom: 7 }}>Contact</div>
              <div className="flex flex-col gap-1.5">
                {fieldRow('LinkedIn', t.linkedinUrl, (v) => setT({ ...t, linkedinUrl: v }), true)}
                {fieldRow('Email', t.email, (v) => setT({ ...t, email: v }))}
                {fieldRow('Phone', t.phone, (v) => setT({ ...t, phone: v }))}
                {fieldRow('Other', t.other, (v) => setT({ ...t, other: v }))}
              </div>
            </div>
            {is2nd && c && (
              <>
                <div style={{ height: 1, background: C.line }} />
                <div>
                  <div className="mb-[7px] flex items-center gap-[7px]"><span style={{ fontSize: 8.5, letterSpacing: '.06em', textTransform: 'uppercase', color: C.faint, fontWeight: 700 }}>Reached via</span><span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: C.muted, background: '#f0f1ec', borderRadius: 3, padding: '2px 6px' }}>2nd degree</span></div>
                  <div style={{ background: '#fbfbf8', border: `1px solid ${C.line}`, borderRadius: 8, padding: '9px 10px' }}>
                    <div className="mb-1.5 flex items-center gap-[7px]"><span style={{ fontSize: 9, fontWeight: 700, color: C.inkSoft, width: 46, flexShrink: 0 }}>Connector</span><input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} style={{ flex: 1, minWidth: 0, fontFamily: SANS, fontSize: 10.5, fontWeight: 600, padding: '6px 9px', border: `1px solid ${C.lineStrong}`, borderRadius: 6, outline: 'none', background: '#fff' }} /></div>
                    <div className="flex flex-col gap-[5px]">
                      {fieldRow('LinkedIn', c.linkedinUrl, (v) => setC({ ...c, linkedinUrl: v }), true)}
                      {fieldRow('Email', c.email, (v) => setC({ ...c, email: v }))}
                      {fieldRow('Phone', c.phone, (v) => setC({ ...c, phone: v }))}
                      {fieldRow('Other', c.other, (v) => setC({ ...c, other: v }))}
                    </div>
                  </div>
                </div>
              </>
            )}
            <div style={{ height: 1, background: C.line }} />
            <div>
              <div style={{ fontSize: 8.5, letterSpacing: '.06em', textTransform: 'uppercase', color: C.faint, fontWeight: 700, marginBottom: 7 }}>Notes</div>
              <textarea value={t.notes} onChange={(e) => setT({ ...t, notes: e.target.value })} placeholder="Context, what to mention, mutual interests…" style={{ width: '100%', height: is2nd ? 64 : 150, resize: 'vertical', fontFamily: SANS, fontSize: 10.5, lineHeight: 1.5, padding: '8px 10px', border: `1px solid ${C.lineStrong}`, borderRadius: 6, outline: 'none', background: '#fff', color: C.inkSoft }} />
            </div>
          </div>
          {/* right */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="px-4 py-[14px]" style={{ borderBottom: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 8.5, letterSpacing: '.06em', textTransform: 'uppercase', color: C.faint, fontWeight: 700, marginBottom: 8 }}>Log activity</div>
              <div className="mb-[9px] flex flex-wrap gap-1.5">
                {QUICK_ACTS.map((q) => (
                  <button key={q.label} onClick={() => quickLog(q.type, q.daysBack, q.label)} style={{ flex: 1, textAlign: 'center', fontSize: 10.5, fontWeight: 600, color: C.inkSoft, background: '#fff', border: `1px solid ${C.lineStrong}`, borderRadius: 6, padding: '6px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{q.label}</button>
                ))}
              </div>
              <div className="flex items-center gap-[7px]">
                <span style={{ fontSize: 9, color: C.faint, fontWeight: 600, flexShrink: 0 }}>Custom</span>
                <input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} style={{ width: 120, flexShrink: 0, fontFamily: MONO, fontSize: 9.5, padding: '6px 7px', border: `1px solid ${C.lineStrong}`, borderRadius: 6, outline: 'none', background: '#fff', color: C.inkSoft }} />
                <input value={customAct} onChange={(e) => setCustomAct(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && logCustom()} placeholder="Activity ↵" style={{ flex: 1, minWidth: 0, fontFamily: SANS, fontSize: 10.5, padding: '6px 9px', border: `1px solid ${C.lineStrong}`, borderRadius: 6, outline: 'none', background: '#fff' }} />
              </div>
            </div>
            <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-[14px]">
              <div style={{ fontSize: 8.5, letterSpacing: '.06em', textTransform: 'uppercase', color: C.faint, fontWeight: 700, marginBottom: 11 }}>Timeline</div>
              <div style={{ position: 'relative', paddingLeft: 14 }}>
                <div style={{ position: 'absolute', left: 3, top: 5, bottom: 5, width: 1.5, background: C.line }} />
                <div className="flex flex-col gap-[13px]">
                  {timeline.map((e) => (
                    <div key={e.key} style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: -14, top: 2, width: 7, height: 7, borderRadius: '50%', background: C.muted, border: '2px solid #fff', boxShadow: `0 0 0 1.5px ${C.line}` }} />
                      <div style={{ fontSize: 11, fontWeight: 600 }}>{e.label}</div>
                      <div style={{ fontFamily: MONO, fontSize: 8.5, color: C.faint }}>{e.date}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
