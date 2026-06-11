import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ACTIVITY_LABELS, RELATIONSHIP_LABELS,
  db, deleteContact, logActivity, today,
  type ActivityType, type Contact, type Relationship,
} from '../db';
import { formatDate, relativeDays } from '../lib/format';
import { Badge, Button, Drawer, Field, Input, Select, SectionHeader, TextArea } from './ui';

const TOUCH_TYPES: ActivityType[] = ['outreach', 'intro-call', 'referral-secured', 'follow-up', 'note'];

export default function ContactDrawer({ contactId, onClose }: { contactId: number; onClose: () => void }) {
  const contact = useLiveQuery(() => db.contacts.get(contactId), [contactId]);
  if (!contact) return null;
  return (
    <Drawer onClose={onClose}>
      <ContactDetail key={contactId} contact={contact} onClose={onClose} />
    </Drawer>
  );
}

function ContactDetail({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const contactId = contact.id!;
  const links = useLiveQuery(() => db.oppContacts.where('contactId').equals(contactId).toArray(), [contactId]) ?? [];
  const opps = useLiveQuery(() => db.opportunities.toArray(), []) ?? [];
  const stages = useLiveQuery(() => db.stages.toArray(), []) ?? [];
  const activities = useLiveQuery(
    () => db.activities.where('contactId').equals(contactId).reverse().sortBy('createdAt'),
    [contactId],
  ) ?? [];

  const oppsById = useMemo(() => new Map(opps.map((o) => [o.id!, o])), [opps]);
  const stagesById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);

  const [draft, setDraft] = useState({
    firstName: contact.firstName, lastName: contact.lastName,
    company: contact.company ?? '', title: contact.title ?? '',
    email: contact.email ?? '', linkedinUrl: contact.linkedinUrl ?? '',
    relationship: contact.relationship, notes: contact.notes ?? '',
  });
  const [saved, setSaved] = useState(false);
  const save = async () => {
    await db.contacts.update(contactId, {
      firstName: draft.firstName.trim() || contact.firstName,
      lastName: draft.lastName.trim(),
      company: draft.company.trim() || undefined,
      title: draft.title.trim() || undefined,
      email: draft.email.trim() || undefined,
      linkedinUrl: draft.linkedinUrl.trim() || undefined,
      relationship: draft.relationship,
      notes: draft.notes.trim() || undefined,
    });
    setSaved(true);
  };
  const set = (k: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [k]: e.target.value }));
  };

  const [touchType, setTouchType] = useState<ActivityType>('outreach');
  const [touchNotes, setTouchNotes] = useState('');
  const logTouch = async () => {
    await logActivity({ contactId, type: touchType, date: today(), notes: touchNotes.trim() || undefined });
    setTouchNotes('');
  };

  const handleDelete = async () => {
    if (window.confirm(`Delete ${contact.firstName} ${contact.lastName}? Their opp links will be removed.`)) {
      await deleteContact(contactId);
      onClose();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{contact.firstName} {contact.lastName}</h2>
            <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
              {contact.title && <span>{contact.title}</span>}
              {contact.company && <span>· {contact.company}</span>}
              <Badge color="sky">{RELATIONSHIP_LABELS[contact.relationship]}</Badge>
              {contact.source === 'linkedin' && <Badge>LinkedIn import</Badge>}
            </div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        {contact.lastTouchedAt && (
          <p className="mt-2 text-xs text-slate-500">Last touched {relativeDays(contact.lastTouchedAt)}</p>
        )}
      </div>

      <div className="flex-1 space-y-6 px-6 py-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name"><Input value={draft.firstName} onChange={set('firstName')} /></Field>
          <Field label="Last name"><Input value={draft.lastName} onChange={set('lastName')} /></Field>
          <Field label="Company"><Input value={draft.company} onChange={set('company')} /></Field>
          <Field label="Title"><Input value={draft.title} onChange={set('title')} /></Field>
          <Field label="Email"><Input value={draft.email} onChange={set('email')} /></Field>
          <Field label="Relationship">
            <Select value={draft.relationship} onChange={set('relationship') as React.ChangeEventHandler<HTMLSelectElement>}>
              {Object.entries(RELATIONSHIP_LABELS).map(([v, l]) => <option key={v} value={v as Relationship}>{l}</option>)}
            </Select>
          </Field>
          <Field label="LinkedIn URL" className="col-span-2">
            <div className="flex gap-2">
              <Input value={draft.linkedinUrl} onChange={set('linkedinUrl')} />
              {draft.linkedinUrl && (
                <a href={draft.linkedinUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-indigo-600 hover:bg-slate-50">Open ↗</a>
              )}
            </div>
          </Field>
          <Field label="Notes" className="col-span-2"><TextArea rows={3} value={draft.notes} onChange={set('notes')} /></Field>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={save}>Save contact</Button>
          {saved && <span className="text-xs text-green-600">Saved ✓</span>}
        </div>

        <section>
          <SectionHeader title="Linked opportunities" />
          {links.length === 0 ? (
            <p className="text-sm text-slate-500">Not linked to any opportunities. Link from an opp's detail view.</p>
          ) : (
            <ul className="space-y-2">
              {links.map((l) => {
                const o = oppsById.get(l.oppId);
                if (!o) return null;
                const s = stagesById.get(o.stageId);
                return (
                  <li key={l.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <span className="font-medium">{o.company} — {o.role}</span>
                    {s && <Badge color="indigo">{s.name}</Badge>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <SectionHeader title="Log a touch" />
          <div className="flex gap-2">
            <Select value={touchType} onChange={(e) => setTouchType(e.target.value as ActivityType)} className="!w-auto">
              {TOUCH_TYPES.map((t) => <option key={t} value={t}>{ACTIVITY_LABELS[t]}</option>)}
            </Select>
            <Input value={touchNotes} onChange={(e) => setTouchNotes(e.target.value)} placeholder="Notes (optional)" onKeyDown={(e) => e.key === 'Enter' && logTouch()} />
            <Button variant="primary" onClick={logTouch}>Log</Button>
          </div>
          <ul className="mt-4 space-y-2 border-l-2 border-slate-200 pl-4">
            {activities.map((a) => (
              <li key={a.id} className="relative text-sm">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-sky-400" />
                <span className="font-medium">{ACTIVITY_LABELS[a.type]}</span>
                <span className="ml-2 text-xs text-slate-500">{formatDate(a.date)}</span>
                {a.oppId && oppsById.get(a.oppId) && (
                  <span className="ml-2 text-xs text-slate-500">re: {oppsById.get(a.oppId)!.company}</span>
                )}
                {a.notes && <div className="text-xs text-slate-600">{a.notes}</div>}
              </li>
            ))}
            {activities.length === 0 && <li className="text-sm text-slate-500">No touches logged yet.</li>}
          </ul>
        </section>

        <section className="border-t border-slate-200 pt-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Added {relativeDays(contact.createdAt)}{contact.connectedOn ? ` · Connected ${contact.connectedOn}` : ''}</span>
            <Button variant="danger" size="sm" onClick={handleDelete}>Delete contact</Button>
          </div>
        </section>
      </div>
    </div>
  );
}
