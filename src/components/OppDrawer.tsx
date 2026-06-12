import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ACTIVITY_LABELS, OPP_CONTACT_ROLE_LABELS, PATH_STATUS_LABELS, PATH_STATUS_ORDER, RELATIONSHIP_LABELS,
  addReferralPath, createContact, db, deleteOpportunity, linkContactToOpp, logActivity, moveOppToStage,
  today, updateOpportunity, updateReferralPathStatus,
  type Activity, type ActivityType, type Contact, type Opportunity, type OppContactRole,
  type PathStatus, type Priority, type Relationship,
} from '../db';
import { findWarmPaths } from '../lib/companyMatch';
import { alumniSearchUrl, peopleSearchUrl } from '../lib/linkedin';
import { formatDate, formatWeight, relativeDays } from '../lib/format';
import { Badge, Button, Drawer, Field, Input, Select, SectionHeader, TextArea } from './ui';

const LOGGABLE_TYPES: ActivityType[] = [
  'outreach', 'intro-solicited', 'intro-made', 'chat-booked', 'intro-call', 'referral-secured',
  'applied', 'recruiter-screen', 'interview', 'follow-up', 'offer', 'note',
];

export default function OppDrawer({ oppId, onClose }: { oppId: number; onClose: () => void }) {
  const opp = useLiveQuery(() => db.opportunities.get(oppId), [oppId]);
  if (!opp) return null;
  return (
    <Drawer onClose={onClose}>
      <OppDetail key={oppId} opp={opp} onClose={onClose} />
    </Drawer>
  );
}

function OppDetail({ opp, onClose }: { opp: Opportunity; onClose: () => void }) {
  const oppId = opp.id!;
  const stages = useLiveQuery(() => db.stages.orderBy('order').toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const activities = useLiveQuery(
    () => db.activities.where('oppId').equals(oppId).reverse().sortBy('createdAt'),
    [oppId],
  ) ?? [];
  const paths = useLiveQuery(() => db.referralPaths.where('oppId').equals(oppId).toArray(), [oppId]) ?? [];
  const otherLinks = useLiveQuery(() => db.oppContacts.where('oppId').equals(oppId).toArray(), [oppId]) ?? [];
  const allContacts = useLiveQuery(() => db.contacts.toArray(), []) ?? [];

  const stage = stages.find((s) => s.id === opp.stageId);
  const schools = settings?.schools ?? [];
  const contactsById = useMemo(() => new Map(allContacts.map((c) => [c.id!, c])), [allContacts]);
  const usedContactIds = useMemo(
    () => new Set([...paths.map((p) => p.targetContactId), ...otherLinks.map((l) => l.contactId)]),
    [paths, otherLinks],
  );
  const warmPaths = useMemo(
    () => findWarmPaths(opp.company, allContacts).filter((c) => !usedContactIds.has(c.id!)),
    [opp.company, allContacts, usedContactIds],
  );

  // Editable draft (explicit save for text fields; stage/priority commit instantly)
  const [draft, setDraft] = useState({
    company: opp.company, role: opp.role, jobUrl: opp.jobUrl ?? '', location: opp.location ?? '',
    source: opp.source ?? '', compMin: opp.compMin?.toString() ?? '', compMax: opp.compMax?.toString() ?? '',
    nextAction: opp.nextAction ?? '', nextActionDate: opp.nextActionDate ?? '', notes: opp.notes ?? '',
    lostReason: opp.lostReason ?? '',
  });
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [k]: e.target.value }));
  };
  const save = async () => {
    await updateOpportunity(oppId, {
      company: draft.company.trim() || opp.company,
      role: draft.role.trim() || opp.role,
      jobUrl: draft.jobUrl.trim() || undefined,
      location: draft.location.trim() || undefined,
      source: draft.source.trim() || undefined,
      compMin: draft.compMin ? Number(draft.compMin) : null,
      compMax: draft.compMax ? Number(draft.compMax) : null,
      nextAction: draft.nextAction.trim() || undefined,
      nextActionDate: draft.nextActionDate || undefined,
      notes: draft.notes.trim() || undefined,
      lostReason: draft.lostReason.trim() || undefined,
    });
    setSaved(true);
  };

  // Activity logger
  const [actType, setActType] = useState<ActivityType>('outreach');
  const [actDate, setActDate] = useState(today());
  const [actNotes, setActNotes] = useState('');
  const [actContact, setActContact] = useState('');
  const involvedContacts = useMemo(() => {
    const ids = new Set<number>();
    for (const p of paths) {
      ids.add(p.targetContactId);
      if (p.viaContactId) ids.add(p.viaContactId);
    }
    for (const l of otherLinks) ids.add(l.contactId);
    return [...ids].map((id) => contactsById.get(id)).filter((c): c is Contact => !!c);
  }, [paths, otherLinks, contactsById]);
  const addActivity = async () => {
    await logActivity({
      oppId, type: actType, date: actDate, notes: actNotes.trim() || undefined,
      contactId: actContact ? Number(actContact) : null,
    });
    setActNotes('');
  };

  const handleDelete = async () => {
    if (window.confirm(`Delete "${opp.company} — ${opp.role}" and all its activity? This cannot be undone.`)) {
      await deleteOpportunity(oppId);
      onClose();
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-6 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Input value={draft.company} onChange={set('company')} className="!text-lg !font-semibold" aria-label="Company" />
            <Input value={draft.role} onChange={set('role')} className="mt-1.5" aria-label="Role" />
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Select
            value={opp.stageId}
            onChange={(e) => moveOppToStage(oppId, e.target.value)}
            className="!w-auto"
            aria-label="Stage"
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({formatWeight(s.weight)})</option>
            ))}
          </Select>
          <Select
            value={opp.priority}
            onChange={(e) => updateOpportunity(oppId, { priority: e.target.value as Priority })}
            className="!w-auto"
            aria-label="Priority"
          >
            <option value="A">Priority A</option>
            <option value="B">Priority B</option>
            <option value="C">Priority C</option>
          </Select>
          {stage && <Badge color="indigo">{formatWeight(stage.weight)} weight</Badge>}
        </div>
      </div>

      <div className="flex-1 space-y-6 px-6 py-5">
        {/* Details */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Job URL" className="col-span-2">
            <div className="flex gap-2">
              <Input value={draft.jobUrl} onChange={set('jobUrl')} placeholder="https://…" />
              {draft.jobUrl && (
                <a href={draft.jobUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-indigo-600 hover:bg-slate-50">Open ↗</a>
              )}
            </div>
          </Field>
          <Field label="Location"><Input value={draft.location} onChange={set('location')} /></Field>
          <Field label="Source"><Input value={draft.source} onChange={set('source')} placeholder="Referral, job board…" /></Field>
          <Field label="Comp min ($)"><Input type="number" value={draft.compMin} onChange={set('compMin')} /></Field>
          <Field label="Comp max ($)"><Input type="number" value={draft.compMax} onChange={set('compMax')} /></Field>
          <Field label="Next action"><Input value={draft.nextAction} onChange={set('nextAction')} /></Field>
          <Field label="Next action date"><Input type="date" value={draft.nextActionDate} onChange={set('nextActionDate')} /></Field>
          {stage?.kind === 'lost' && (
            <Field label="Lost reason" className="col-span-2"><Input value={draft.lostReason} onChange={set('lostReason')} /></Field>
          )}
          <Field label="Notes" className="col-span-2"><TextArea rows={3} value={draft.notes} onChange={set('notes')} /></Field>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={save}>Save details</Button>
          {saved && <span className="text-xs text-green-600">Saved ✓</span>}
        </div>

        {/* Referral paths */}
        <ReferralPathsSection
          oppId={oppId}
          company={opp.company}
          paths={paths}
          contactsById={contactsById}
          allContacts={allContacts}
          warmPaths={warmPaths}
        />

        {/* LinkedIn search links */}
        <section>
          <SectionHeader title="Find more paths on LinkedIn" />
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <a className="text-xs font-medium text-indigo-600 hover:underline" target="_blank" rel="noreferrer" href={peopleSearchUrl(opp.company, 'S')}>
              2nd-degree at {opp.company} ↗
            </a>
            <a className="text-xs font-medium text-indigo-600 hover:underline" target="_blank" rel="noreferrer" href={peopleSearchUrl(opp.company, 'F')}>
              1st-degree ↗
            </a>
            {schools.map((school) => (
              <a key={school.id} className="text-xs font-medium text-indigo-600 hover:underline" target="_blank" rel="noreferrer" href={alumniSearchUrl(school.id, opp.company)}>
                {school.name} alumni ↗
              </a>
            ))}
          </div>
          {schools.length === 0 && (
            <p className="mt-1.5 text-xs text-slate-400">
              Add your school(s) in Settings to get one-click alumni searches here.
            </p>
          )}
        </section>

        {/* Other contacts (recruiters, interviewers) */}
        <section>
          <SectionHeader title="Other contacts" />
          {otherLinks.length === 0 && <p className="text-sm text-slate-500">Recruiters, interviewers, etc. — none linked yet.</p>}
          <ul className="space-y-2">
            {otherLinks.map((link) => {
              const c = contactsById.get(link.contactId);
              if (!c) return null;
              return (
                <li key={link.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                  <div className="min-w-0 text-sm">
                    <span className="font-medium">{c.firstName} {c.lastName}</span>
                    {c.title && <span className="ml-2 text-xs text-slate-500">{c.title}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={link.role}
                      onChange={(e) => db.oppContacts.update(link.id!, { role: e.target.value as OppContactRole })}
                      className="!w-auto !py-1 !text-xs"
                    >
                      {Object.entries(OPP_CONTACT_ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                    <Button size="sm" variant="ghost" onClick={() => db.oppContacts.delete(link.id!)}>Unlink</Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-2">
            <ContactPicker
              placeholder="Search contacts to link as recruiter/interviewer…"
              contacts={allContacts}
              exclude={usedContactIds}
              onPick={(id) => linkContactToOpp(oppId, id, 'recruiter')}
            />
          </div>
        </section>

        {/* Activity */}
        <section>
          <SectionHeader title="Log activity" />
          <div className="grid grid-cols-2 gap-2">
            <Select value={actType} onChange={(e) => setActType(e.target.value as ActivityType)}>
              {LOGGABLE_TYPES.map((t) => <option key={t} value={t}>{ACTIVITY_LABELS[t]}</option>)}
            </Select>
            <Input type="date" value={actDate} onChange={(e) => setActDate(e.target.value)} />
            <Select value={actContact} onChange={(e) => setActContact(e.target.value)}>
              <option value="">No contact</option>
              {involvedContacts.map((c) => (
                <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
              ))}
            </Select>
            <Input value={actNotes} onChange={(e) => setActNotes(e.target.value)} placeholder="Notes (optional)" onKeyDown={(e) => e.key === 'Enter' && addActivity()} />
          </div>
          <Button variant="primary" className="mt-2" onClick={addActivity}>Add activity</Button>

          <ul className="mt-4 space-y-2 border-l-2 border-slate-200 pl-4">
            {activities.map((a: Activity) => (
              <li key={a.id} className="relative text-sm">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-indigo-400" />
                <span className="font-medium">{ACTIVITY_LABELS[a.type] ?? a.type}</span>
                <span className="ml-2 text-xs text-slate-500">{formatDate(a.date)}</span>
                {a.contactId && contactsById.get(a.contactId) && (
                  <span className="ml-2 text-xs text-slate-500">
                    w/ {contactsById.get(a.contactId)!.firstName} {contactsById.get(a.contactId)!.lastName}
                  </span>
                )}
                {a.notes && <div className="text-xs text-slate-600">{a.notes}</div>}
              </li>
            ))}
            {activities.length === 0 && <li className="text-sm text-slate-500">No activity yet.</li>}
          </ul>
        </section>

        <section className="border-t border-slate-200 pt-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Created {relativeDays(opp.createdAt)} · In stage {relativeDays(opp.stageEnteredAt)}</span>
            <Button variant="danger" size="sm" onClick={handleDelete}>Delete opportunity</Button>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------- Referral paths ----------

function ReferralPathsSection({
  oppId, company, paths, contactsById, allContacts, warmPaths,
}: {
  oppId: number;
  company: string;
  paths: { id?: number; targetContactId: number; viaContactId?: number | null; status: PathStatus }[];
  contactsById: Map<number, Contact>;
  allContacts: Contact[];
  warmPaths: Contact[];
}) {
  const [bridgeId, setBridgeId] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [warmSearch, setWarmSearch] = useState('');
  const [showAllWarm, setShowAllWarm] = useState(false);

  const bridge = bridgeId ? contactsById.get(bridgeId) : undefined;
  const target = targetId ? contactsById.get(targetId) : undefined;

  const addPath = async () => {
    if (!targetId) return;
    await addReferralPath(oppId, targetId, bridgeId);
    setBridgeId(null);
    setTargetId(null);
  };

  const filteredWarm = useMemo(() => {
    const q = warmSearch.trim().toLowerCase();
    if (!q) return warmPaths;
    return warmPaths.filter((c) => `${c.firstName} ${c.lastName} ${c.title ?? ''}`.toLowerCase().includes(q));
  }, [warmPaths, warmSearch]);
  const visibleWarm = showAllWarm ? filteredWarm : filteredWarm.slice(0, 5);

  const statusColor = (s: PathStatus) =>
    s === 'referral-made' ? '!border-green-300 !bg-green-50' : s === 'dead-end' ? '!border-slate-200 !bg-slate-100 !text-slate-400' : '';

  return (
    <section>
      <SectionHeader title="Referral paths" />
      <p className="mb-2 text-xs text-slate-500">
        Who gets you the referral? For 2nd-degree targets, add the 1st-degree bridge who can make the intro
        (one row per bridge). Track each path: intro solicited → intro made → chat booked → referral made.
      </p>

      {paths.length > 0 && (
        <ul className="space-y-2">
          {paths.map((p) => {
            const t = contactsById.get(p.targetContactId);
            const v = p.viaContactId ? contactsById.get(p.viaContactId) : undefined;
            if (!t) return null;
            return (
              <li key={p.id} className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${p.status === 'dead-end' ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-slate-200'}`}>
                <div className="min-w-0 text-sm">
                  {v && (
                    <span className="text-slate-600">{v.firstName} {v.lastName} <span className="mx-1 text-slate-400">→</span></span>
                  )}
                  <span className="font-medium">{t.firstName} {t.lastName}</span>
                  <span className="ml-2"><Badge color="sky">{RELATIONSHIP_LABELS[t.relationship]}</Badge></span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Select
                    value={p.status}
                    onChange={(e) => updateReferralPathStatus(p.id!, e.target.value as PathStatus)}
                    className={`!w-auto !py-1 !text-xs ${statusColor(p.status)}`}
                  >
                    {PATH_STATUS_ORDER.map((s) => <option key={s} value={s}>{PATH_STATUS_LABELS[s]}</option>)}
                  </Select>
                  <button
                    onClick={() => db.referralPaths.delete(p.id!)}
                    className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
                    aria-label="Remove path"
                  >✕</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add a path */}
      <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-3">
        <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
          {bridge ? (
            <SelectedChip label={`${bridge.firstName} ${bridge.lastName}`} onClear={() => setBridgeId(null)} />
          ) : (
            <ContactPicker
              placeholder="1st-degree bridge (optional)"
              contacts={allContacts}
              onPick={setBridgeId}
              createMeta={{ relationship: '1st' }}
            />
          )}
          <span className="text-slate-400">→</span>
          {target ? (
            <SelectedChip label={`${target.firstName} ${target.lastName}`} onClear={() => setTargetId(null)} />
          ) : (
            <ContactPicker
              placeholder="Target referrer"
              contacts={allContacts}
              onPick={setTargetId}
              createMeta={{ relationship: '2nd', company }}
            />
          )}
          <Button variant="primary" size="sm" disabled={!targetId} onClick={addPath}>Add path</Button>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">
          Type a name and pick "create" if they're not in your contacts yet (e.g. a 2nd-degree person you found on LinkedIn).
        </p>
      </div>

      {/* Warm suggestions */}
      {warmPaths.length > 0 && (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-green-800">
              You know {warmPaths.length} {warmPaths.length === 1 ? 'person' : 'people'} at {company}
            </span>
            {warmPaths.length > 5 && (
              <Input
                value={warmSearch}
                onChange={(e) => { setWarmSearch(e.target.value); setShowAllWarm(false); }}
                placeholder="Filter by name or title…"
                className="!w-52 !py-1 !text-xs"
              />
            )}
          </div>
          <ul className={`mt-2 space-y-1.5 ${showAllWarm ? 'max-h-64 overflow-y-auto pr-1 thin-scroll' : ''}`}>
            {visibleWarm.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 rounded-md bg-white/70 px-2.5 py-1.5">
                <div className="min-w-0 truncate text-sm">
                  <span className="font-medium">{c.firstName} {c.lastName}</span>
                  {c.title && <span className="ml-2 text-xs text-slate-500">{c.title}</span>}
                </div>
                <Button size="sm" onClick={() => addReferralPath(oppId, c.id!, null)}>Add as target</Button>
              </li>
            ))}
          </ul>
          {filteredWarm.length > visibleWarm.length && (
            <button onClick={() => setShowAllWarm(true)} className="mt-1.5 text-xs font-medium text-green-700 hover:underline">
              Show all {filteredWarm.length}
            </button>
          )}
          {filteredWarm.length === 0 && <p className="mt-2 text-xs text-slate-500">No matches for "{warmSearch}".</p>}
        </div>
      )}
      {paths.length === 0 && warmPaths.length === 0 && (
        <p className="mt-2 text-sm text-slate-500">
          No known contacts at {company} yet — import your LinkedIn connections (Contacts tab) or use the search links below.
        </p>
      )}
    </section>
  );
}

function SelectedChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center justify-between gap-1 rounded-md bg-indigo-50 px-2.5 py-1.5 text-sm font-medium text-indigo-800 ring-1 ring-inset ring-indigo-200">
      <span className="truncate">{label}</span>
      <button onClick={onClear} className="text-indigo-400 hover:text-indigo-700" aria-label="Clear">✕</button>
    </span>
  );
}

/** Small combobox: search contacts, optionally create a new one from the query. */
function ContactPicker({
  placeholder, contacts, exclude, onPick, createMeta,
}: {
  placeholder: string;
  contacts: Contact[];
  exclude?: Set<number>;
  onPick: (id: number) => void;
  createMeta?: { relationship: Relationship; company?: string };
}) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    return contacts
      .filter((c) => !exclude?.has(c.id!) && `${c.firstName} ${c.lastName} ${c.company ?? ''}`.toLowerCase().includes(query))
      .slice(0, 6);
  }, [q, contacts, exclude]);
  const showCreate = !!createMeta && q.trim().length > 1;

  const create = async () => {
    const parts = q.trim().split(/\s+/);
    const id = await createContact({
      firstName: parts[0],
      lastName: parts.slice(1).join(' '),
      relationship: createMeta!.relationship,
      company: createMeta!.company,
    });
    setQ('');
    onPick(id);
  };

  return (
    <div className="relative min-w-0">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {(matches.length > 0 || showCreate) && q.trim() && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-indigo-50"
                onClick={() => { setQ(''); onPick(c.id!); }}
              >
                <span>{c.firstName} {c.lastName}</span>
                <span className="ml-2 truncate text-xs text-slate-500">{c.company ?? ''}</span>
              </button>
            </li>
          ))}
          {showCreate && (
            <li className="border-t border-slate-100">
              <button className="w-full px-3 py-2 text-left text-sm font-medium text-indigo-600 hover:bg-indigo-50" onClick={create}>
                + Create "{q.trim()}"{createMeta?.company ? ` at ${createMeta.company}` : ''}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
