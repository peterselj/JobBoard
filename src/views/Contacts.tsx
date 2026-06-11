import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { RELATIONSHIP_LABELS, createContact, db, type Relationship } from '../db';
import { importConnections, parseConnectionsCsv, type ImportResult } from '../lib/linkedin';
import { relativeDays } from '../lib/format';
import { Badge, Button, EmptyState, Field, Input, Modal, Select } from '../components/ui';
import ContactDrawer from '../components/ContactDrawer';

export default function Contacts() {
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) ?? [];
  const oppContacts = useLiveQuery(() => db.oppContacts.toArray(), []) ?? [];
  const [search, setSearch] = useState('');
  const [relFilter, setRelFilter] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const linkCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const l of oppContacts) m.set(l.contactId, (m.get(l.contactId) ?? 0) + 1);
    return m;
  }, [oppContacts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts
      .filter((c) => {
        if (relFilter && c.relationship !== relFilter) return false;
        if (q && !`${c.firstName} ${c.lastName} ${c.company ?? ''} ${c.title ?? ''}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => (b.lastTouchedAt ?? 0) - (a.lastTouchedAt ?? 0) || a.lastName.localeCompare(b.lastName));
  }, [contacts, search, relFilter]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, company, title…" className="!w-72" />
        <Select value={relFilter} onChange={(e) => setRelFilter(e.target.value)} className="!w-auto">
          <option value="">All relationships</option>
          {Object.entries(RELATIONSHIP_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <span className="text-xs text-slate-500">{contacts.length} contact{contacts.length === 1 ? '' : 's'}</span>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setImporting(true)}>Import LinkedIn CSV</Button>
          <Button variant="primary" onClick={() => setAdding(true)}>+ Add contact</Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No contacts yet">
          Your network is your job-search engine. Import your LinkedIn connections to instantly see warm referral
          paths into every company you target.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                {['Name', 'Company', 'Title', 'Relationship', 'Linked opps', 'Last touched', ''].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-indigo-50/40" onClick={() => setSelected(c.id!)}>
                  <td className="px-3 py-2.5 font-medium">{c.firstName} {c.lastName}</td>
                  <td className="px-3 py-2.5 text-slate-600">{c.company ?? '—'}</td>
                  <td className="max-w-[220px] truncate px-3 py-2.5 text-slate-600">{c.title ?? '—'}</td>
                  <td className="px-3 py-2.5"><Badge color="sky">{RELATIONSHIP_LABELS[c.relationship]}</Badge></td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">{linkCounts.get(c.id!) ?? 0}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{c.lastTouchedAt ? relativeDays(c.lastTouchedAt) : 'never'}</td>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    {c.linkedinUrl && (
                      <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-indigo-600 hover:underline">in ↗</a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected != null && <ContactDrawer contactId={selected} onClose={() => setSelected(null)} />}
      {adding && <AddContactModal onClose={() => setAdding(false)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </div>
  );
}

function AddContactModal({ onClose }: { onClose: () => void }) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('1st');
  const [error, setError] = useState('');

  const submit = async () => {
    if (!first.trim()) { setError('First name is required.'); return; }
    await createContact({
      firstName: first.trim(), lastName: last.trim(),
      company: company.trim() || undefined, title: title.trim() || undefined,
      linkedinUrl: linkedinUrl.trim() || undefined, relationship,
    });
    onClose();
  };

  return (
    <Modal title="Add contact" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name *"><Input autoFocus value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
        <Field label="Last name"><Input value={last} onChange={(e) => setLast(e.target.value)} /></Field>
        <Field label="Company"><Input value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="LinkedIn URL" className="col-span-2"><Input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} /></Field>
        <Field label="Relationship">
          <Select value={relationship} onChange={(e) => setRelationship(e.target.value as Relationship)}>
            {Object.entries(RELATIONSHIP_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Add contact</Button>
      </div>
    </Modal>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      const text = await file.text();
      const parsed = parseConnectionsCsv(text);
      setResult(await importConnections(parsed));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import file.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Import LinkedIn connections" onClose={onClose}>
      {!result ? (
        <>
          <p className="text-sm text-slate-600">
            LinkedIn doesn't offer an API for your connections, but it <em>does</em> let you export them yourself:
          </p>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
            <li>On LinkedIn, go to <span className="font-medium">Settings &amp; Privacy → Data privacy → Get a copy of your data</span></li>
            <li>Pick <span className="font-medium">"Want something in particular?" → Connections</span> and request the archive</li>
            <li>LinkedIn emails you a download link (usually within ~10 minutes)</li>
            <li>Unzip it and upload <span className="font-medium">Connections.csv</span> below</li>
          </ol>
          <p className="mt-3 text-xs text-slate-500">
            Everyone imports as a 1st-degree contact (they're your connections). Re-importing later is safe — duplicates are skipped.
          </p>
          <div className="mt-4">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-700"
            />
          </div>
          {busy && <p className="mt-3 text-sm text-slate-500">Importing…</p>}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </>
      ) : (
        <>
          <p className="text-sm text-slate-700">
            ✅ Imported <span className="font-semibold">{result.added}</span> contact{result.added === 1 ? '' : 's'}
            {result.skipped > 0 && <> ({result.skipped} duplicate{result.skipped === 1 ? '' : 's'} skipped)</>}.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Warm referral paths will now light up automatically on any opportunity whose company matches someone in your network.
          </p>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
