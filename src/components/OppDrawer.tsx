import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ACTIVITY_LABELS, PATH_PROGRESS, PATH_STATUS_LABELS, RELATIONSHIP_LABELS,
  addReferralPath, createContact, db, deleteOpportunity, logActivity, moveOppToStage,
  today, updateOpportunity, updateReferralPathStatus,
  type Activity, type ActivityType, type Contact, type Opportunity,
  type PathStatus, type Relationship,
} from '../db';
import { findWarmPaths } from '../lib/companyMatch';
import { alumniSearchUrl, parseProfileUrl, peopleSearchUrl } from '../lib/linkedin';
import { formatDate, formatWeight, isoDate, relativeDays } from '../lib/format';
import { Badge, Button, Drawer, Field, Input, PriorityToggle, Select, SectionHeader, TextArea } from './ui';
import ContactDrawer from './ContactDrawer';

// Manual logging keeps only the types you'd type by hand; intro-solicited /
// intro-made / chat-booked / referral-secured are auto-logged when a referral
// path's status advances, so listing them here just invited double entries.
const LOGGABLE_TYPES: ActivityType[] = [
  'outreach', 'intro-call', 'applied', 'recruiter-screen', 'interview', 'follow-up', 'offer', 'note',
];

const QUICK_LOGS: { label: string; type: ActivityType; daysBack: number }[] = [
  { label: 'Outreach sent · today', type: 'outreach', daysBack: 0 },
  { label: 'Outreach sent · yesterday', type: 'outreach', daysBack: 1 },
  { label: 'Follow-up · today', type: 'follow-up', daysBack: 0 },
  { label: 'Applied · today', type: 'applied', daysBack: 0 },
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
  const allContacts = useLiveQuery(() => db.contacts.toArray(), []) ?? [];

  const stage = stages.find((s) => s.id === opp.stageId);
  const schools = settings?.schools ?? [];
  const [viewContactId, setViewContactId] = useState<number | null>(null);
  const contactsById = useMemo(() => new Map(allContacts.map((c) => [c.id!, c])), [allContacts]);
  const usedContactIds = useMemo(
    () => new Set(paths.map((p) => p.targetContactId)),
    [paths],
  );
  const warmPaths = useMemo(
    () => findWarmPaths(opp.company, allContacts).filter((c) => !usedContactIds.has(c.id!)),
    [opp.company, allContacts, usedContactIds],
  );

  // Editable draft (explicit save for text fields; stage/priority commit instantly)
  const [draft, setDraft] = useState({
    company: opp.company, role: opp.role, jobUrl: opp.jobUrl ?? '', location: opp.location ?? '',
    compMin: opp.compMin?.toString() ?? '', compMax: opp.compMax?.toString() ?? '',
    notes: opp.notes ?? '', lostReason: opp.lostReason ?? '',
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
      compMin: draft.compMin ? Number(draft.compMin) : null,
      compMax: draft.compMax ? Number(draft.compMax) : null,
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
    return [...ids].map((id) => contactsById.get(id)).filter((c): c is Contact => !!c);
  }, [paths, contactsById]);
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
          {stage && <Badge color="emerald">{formatWeight(stage.weight)} weight</Badge>}
        </div>
        <div className="mt-2">
          <PriorityToggle value={opp.priority} onChange={(p) => updateOpportunity(oppId, { priority: p })} />
        </div>
      </div>

      <div className="flex-1 space-y-6 px-6 py-5">
        {/* Details */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Job URL" className="col-span-2">
            <div className="flex gap-2">
              <Input value={draft.jobUrl} onChange={set('jobUrl')} placeholder="https://…" />
              {draft.jobUrl && (
                <a href={draft.jobUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-emerald-700 hover:bg-slate-50">Open ↗</a>
              )}
            </div>
          </Field>
          <Field label="Location" className="col-span-2"><Input value={draft.location} onChange={set('location')} /></Field>
          <Field label="Comp min ($)"><Input type="number" value={draft.compMin} onChange={set('compMin')} /></Field>
          <Field label="Comp max ($)"><Input type="number" value={draft.compMax} onChange={set('compMax')} /></Field>
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
          onOpenContact={setViewContactId}
        />

        {/* LinkedIn search links */}
        <section>
          <SectionHeader title="Find more paths on LinkedIn" />
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <a className="text-xs font-medium text-emerald-700 hover:underline" target="_blank" rel="noreferrer" href={peopleSearchUrl(opp.company, 'S')}>
              2nd-degree at {opp.company} ↗
            </a>
            <a className="text-xs font-medium text-emerald-700 hover:underline" target="_blank" rel="noreferrer" href={peopleSearchUrl(opp.company, 'F')}>
              1st-degree ↗
            </a>
            {schools.map((school) => (
              <a key={school.id} className="text-xs font-medium text-emerald-700 hover:underline" target="_blank" rel="noreferrer" href={alumniSearchUrl(school.id, opp.company)}>
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

        {/* Activity */}
        <section>
          <SectionHeader title="Log activity" />
          <div className="mb-3 flex flex-wrap gap-1.5">
            {QUICK_LOGS.map((q) => (
              <Button
                key={q.label}
                size="sm"
                onClick={() => logActivity({ oppId, type: q.type, date: isoDate(q.daysBack) })}
              >
                {q.label}
              </Button>
            ))}
          </div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Custom</div>
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
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-emerald-500" />
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

      {viewContactId != null && <ContactDrawer contactId={viewContactId} onClose={() => setViewContactId(null)} />}
    </div>
  );
}

// ---------- Referral paths ----------

function ReferralPathsSection({
  oppId, company, paths, contactsById, allContacts, warmPaths, onOpenContact,
}: {
  oppId: number;
  company: string;
  paths: { id?: number; targetContactId: number; viaContactId?: number | null; status: PathStatus }[];
  contactsById: Map<number, Contact>;
  allContacts: Contact[];
  warmPaths: Contact[];
  onOpenContact: (id: number) => void;
}) {
  const [bridgeId, setBridgeId] = useState<number | null>(null);
  const [warmSearch, setWarmSearch] = useState('');
  const [showAllWarm, setShowAllWarm] = useState(false);

  const bridge = bridgeId ? contactsById.get(bridgeId) : undefined;

  // Picking (or creating) the target referrer creates the path immediately —
  // no extra "Add path" step — then resets the picker and any chosen bridge.
  const pickTarget = async (targetId: number) => {
    await addReferralPath(oppId, targetId, bridgeId);
    setBridgeId(null);
  };

  const pathTargetIds = useMemo(() => new Set(paths.map((p) => p.targetContactId)), [paths]);

  const filteredWarm = useMemo(() => {
    const q = warmSearch.trim().toLowerCase();
    if (!q) return warmPaths;
    return warmPaths.filter((c) => `${c.firstName} ${c.lastName} ${c.title ?? ''}`.toLowerCase().includes(q));
  }, [warmPaths, warmSearch]);
  const visibleWarm = showAllWarm ? filteredWarm : filteredWarm.slice(0, 5);

  return (
    <section>
      <SectionHeader title="Referral paths" />
      <p className="mb-2 text-xs text-slate-500">
        Who gets you the referral? For a 2nd-degree target, add the 1st-degree bridge who can make the intro
        (one row per bridge). Advance each path: referral solicited → chat booked → referral made.
      </p>

      {/* Contacts you already know at this company — start a path in one click. */}
      {warmPaths.length > 0 && (
        <div className="mb-3 rounded-lg border border-green-200 bg-green-50/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-green-800">
              Start a path with someone at {company}
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
                  <span className="ml-2"><Badge color="sky">{RELATIONSHIP_LABELS[c.relationship]}</Badge></span>
                  {c.title && <span className="ml-2 text-xs text-slate-500">{c.title}</span>}
                </div>
                <Button size="sm" variant="primary" onClick={() => addReferralPath(oppId, c.id!, null)}>+ Add path</Button>
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

      {paths.length > 0 && (
        <ul className="space-y-2">
          {paths.map((p) => {
            const t = contactsById.get(p.targetContactId);
            const v = p.viaContactId ? contactsById.get(p.viaContactId) : undefined;
            if (!t) return null;
            return (
              <li key={p.id} className={`rounded-lg border px-3 py-2 ${p.status === 'dead-end' ? 'border-slate-200 bg-slate-50 opacity-70' : p.status === 'referral-made' ? 'border-green-300 bg-green-50/50' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 text-sm">
                    {v && (
                      <span className="text-slate-600">
                        <button onClick={() => onOpenContact(v.id!)} className="hover:text-emerald-700 hover:underline">{v.firstName} {v.lastName}</button>
                        <span className="mx-1 text-slate-400">→</span>
                      </span>
                    )}
                    <button onClick={() => onOpenContact(t.id!)} className="font-medium hover:text-emerald-700 hover:underline">
                      {t.firstName} {t.lastName}
                    </button>
                    <span className="ml-2"><Badge color="sky">{RELATIONSHIP_LABELS[t.relationship]}</Badge></span>
                  </div>
                  <button
                    onClick={() => db.referralPaths.delete(p.id!)}
                    className="shrink-0 rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
                    aria-label="Remove path"
                  >✕</button>
                </div>
                <div className="mt-2">
                  <PathStepper status={p.status} onChange={(s) => updateReferralPathStatus(p.id!, s)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add a path */}
      <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-3">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
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
          <ContactPicker
            placeholder="Target referrer"
            contacts={allContacts}
            exclude={pathTargetIds}
            onPick={pickTarget}
            createMeta={{ relationship: bridgeId ? '2nd' : '1st', company }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">
          A direct 1st-degree contact needs no bridge. Type a name — or paste a LinkedIn profile URL — and pick
          "create" if they're not in your contacts yet.
        </p>
      </div>

      {paths.length === 0 && warmPaths.length === 0 && (
        <p className="mt-2 text-sm text-slate-500">
          No known contacts at {company} yet — find your person with the LinkedIn search links below, then paste
          their profile URL above.
        </p>
      )}
    </section>
  );
}

// A compact, one-click-per-step progress control for a referral path. Clicking
// a step advances to it; clicking the current furthest step steps back one.
function PathStepper({ status, onChange }: { status: PathStatus; onChange: (s: PathStatus) => void }) {
  const dead = status === 'dead-end';
  const currentIdx = dead ? 0 : PATH_PROGRESS.indexOf(status); // 0 = identified
  const steps = PATH_PROGRESS.slice(1); // skip "identified"
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {steps.map((s, i) => {
        const stepNum = i + 1; // index within PATH_PROGRESS
        const reached = !dead && currentIdx >= stepNum;
        const isCurrent = !dead && currentIdx === stepNum;
        return (
          <button
            key={s}
            onClick={() => onChange(isCurrent ? PATH_PROGRESS[stepNum - 1] : s)}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
              reached
                ? 'bg-emerald-600 text-white ring-emerald-600'
                : 'bg-white text-slate-600 ring-slate-300 hover:ring-emerald-400'
            }`}
            title={reached ? 'Click to step back' : `Mark ${PATH_STATUS_LABELS[s]}`}
          >
            <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] ${reached ? 'bg-white/25' : 'ring-1 ring-inset ring-slate-300'}`}>
              {reached ? '✓' : ''}
            </span>
            {PATH_STATUS_LABELS[s]}
          </button>
        );
      })}
      <button
        onClick={() => onChange(dead ? 'identified' : 'dead-end')}
        className={`ml-auto rounded-full px-2 py-1 text-xs font-medium transition-colors ${
          dead ? 'bg-slate-200 text-slate-600' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
        }`}
        title={dead ? 'Reopen this path' : 'Mark this path a dead end'}
      >
        {dead ? 'Reopen' : 'Dead end'}
      </button>
    </div>
  );
}

function SelectedChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center justify-between gap-1 rounded-md bg-emerald-50 px-2.5 py-1.5 text-sm font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
      <span className="truncate">{label}</span>
      <button onClick={onClear} className="text-emerald-400 hover:text-emerald-700" aria-label="Clear">✕</button>
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
  const profile = useMemo(() => parseProfileUrl(q), [q]);
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query || profile) return [];
    return contacts
      .filter((c) => !exclude?.has(c.id!) && `${c.firstName} ${c.lastName} ${c.company ?? ''}`.toLowerCase().includes(query))
      .slice(0, 6);
  }, [q, contacts, exclude, profile]);
  const showCreate = !!createMeta && q.trim().length > 1;

  const create = async () => {
    // A pasted LinkedIn profile URL creates the contact with the URL attached,
    // guessing the name from the slug (editable later via the contact drawer).
    const existing = profile && contacts.find((c) => c.linkedinUrl === profile.linkedinUrl);
    if (existing) {
      setQ('');
      onPick(existing.id!);
      return;
    }
    const parts = q.trim().split(/\s+/);
    const id = await createContact({
      firstName: profile ? profile.firstName : parts[0],
      lastName: profile ? profile.lastName : parts.slice(1).join(' '),
      linkedinUrl: profile?.linkedinUrl,
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
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-emerald-50"
                onClick={() => { setQ(''); onPick(c.id!); }}
              >
                <span>{c.firstName} {c.lastName}</span>
                <span className="ml-2 truncate text-xs text-slate-500">{c.company ?? ''}</span>
              </button>
            </li>
          ))}
          {showCreate && (
            <li className="border-t border-slate-100">
              <button className="w-full px-3 py-2 text-left text-sm font-medium text-emerald-700 hover:bg-emerald-50" onClick={create}>
                {profile
                  ? `+ Create "${`${profile.firstName} ${profile.lastName}`.trim()}" from LinkedIn URL`
                  : `+ Create "${q.trim()}"${createMeta?.company ? ` at ${createMeta.company}` : ''}`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
