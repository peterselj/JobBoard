import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ACTIVITY_LABELS, OPP_CONTACT_ROLE_LABELS, RELATIONSHIP_LABELS,
  db, deleteOpportunity, linkContactToOpp, logActivity, moveOppToStage, today, updateOpportunity,
  type Activity, type ActivityType, type Contact, type Opportunity, type OppContactRole, type Priority,
} from '../db';
import { findWarmPaths } from '../lib/companyMatch';
import { alumniSearchUrl, peopleSearchUrl } from '../lib/linkedin';
import { formatDate, formatWeight, relativeDays } from '../lib/format';
import { Badge, Button, Drawer, Field, Input, Select, SectionHeader, TextArea } from './ui';

const LOGGABLE_TYPES: ActivityType[] = [
  'outreach', 'intro-call', 'referral-secured', 'applied', 'recruiter-screen', 'interview', 'follow-up', 'offer', 'note',
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
  const links = useLiveQuery(() => db.oppContacts.where('oppId').equals(oppId).toArray(), [oppId]) ?? [];
  const allContacts = useLiveQuery(() => db.contacts.toArray(), []) ?? [];

  const stage = stages.find((s) => s.id === opp.stageId);
  const contactsById = useMemo(() => new Map(allContacts.map((c) => [c.id!, c])), [allContacts]);
  const linkedIds = useMemo(() => new Set(links.map((l) => l.contactId)), [links]);
  const warmPaths = useMemo(
    () => findWarmPaths(opp.company, allContacts).filter((c) => !linkedIds.has(c.id!)),
    [opp.company, allContacts, linkedIds],
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
  const addActivity = async () => {
    await logActivity({
      oppId, type: actType, date: actDate, notes: actNotes.trim() || undefined,
      contactId: actContact ? Number(actContact) : null,
    });
    setActNotes('');
  };

  // Contact linking
  const [contactSearch, setContactSearch] = useState('');
  const searchMatches = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return [];
    return allContacts
      .filter((c) => !linkedIds.has(c.id!) && `${c.firstName} ${c.lastName} ${c.company ?? ''}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [contactSearch, allContacts, linkedIds]);

  const handleDelete = async () => {
    if (window.confirm(`Delete "${opp.company} — ${opp.role}" and all its activity? This cannot be undone.`)) {
      await deleteOpportunity(oppId);
      onClose();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
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

        {/* Warm paths */}
        <section>
          <SectionHeader title={`Warm paths at ${opp.company}`} />
          {warmPaths.length === 0 ? (
            <p className="text-sm text-slate-500">
              No contacts at {opp.company} yet. Import your LinkedIn connections (Contacts tab) or use the search links below.
            </p>
          ) : (
            <ul className="space-y-2">
              {warmPaths.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50/50 px-3 py-2">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{c.firstName} {c.lastName}</span>
                    <span className="ml-2 text-xs text-slate-500">{c.title ?? ''}</span>
                    <Badge color="green">{RELATIONSHIP_LABELS[c.relationship]}</Badge>
                  </div>
                  <Button size="sm" onClick={() => linkContactToOpp(oppId, c.id!, 'target-referrer')}>Link as referrer target</Button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <a className="text-xs font-medium text-indigo-600 hover:underline" target="_blank" rel="noreferrer" href={peopleSearchUrl(opp.company, 'S')}>
              2nd-degree at {opp.company} ↗
            </a>
            <a className="text-xs font-medium text-indigo-600 hover:underline" target="_blank" rel="noreferrer" href={peopleSearchUrl(opp.company, 'F')}>
              1st-degree ↗
            </a>
            {settings?.schoolSlug && (
              <a className="text-xs font-medium text-indigo-600 hover:underline" target="_blank" rel="noreferrer" href={alumniSearchUrl(settings.schoolSlug, opp.company)}>
                Alumni ↗
              </a>
            )}
          </div>
        </section>

        {/* Linked contacts */}
        <section>
          <SectionHeader title="Linked contacts" />
          {links.length === 0 && <p className="text-sm text-slate-500">No contacts linked yet.</p>}
          <ul className="space-y-2">
            {links.map((link) => {
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
          <div className="relative mt-2">
            <Input
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              placeholder="Search contacts to link…"
            />
            {searchMatches.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
                {searchMatches.map((c) => (
                  <li key={c.id}>
                    <button
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-indigo-50"
                      onClick={() => { linkContactToOpp(oppId, c.id!, 'target-referrer'); setContactSearch(''); }}
                    >
                      <span>{c.firstName} {c.lastName}</span>
                      <span className="text-xs text-slate-500">{c.company ?? ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
              {links.map((l) => {
                const c = contactsById.get(l.contactId);
                return c ? <option key={l.contactId} value={l.contactId}>{c.firstName} {c.lastName}</option> : null;
              })}
            </Select>
            <Input value={actNotes} onChange={(e) => setActNotes(e.target.value)} placeholder="Notes (optional)" onKeyDown={(e) => e.key === 'Enter' && addActivity()} />
          </div>
          <Button variant="primary" className="mt-2" onClick={addActivity}>Add activity</Button>

          <ul className="mt-4 space-y-2 border-l-2 border-slate-200 pl-4">
            {activities.map((a: Activity) => (
              <li key={a.id} className="relative text-sm">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-indigo-400" />
                <span className="font-medium">{ACTIVITY_LABELS[a.type]}</span>
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
