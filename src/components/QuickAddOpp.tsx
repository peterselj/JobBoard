import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { createOpportunity, db, type Priority } from '../db';
import { formatWeight } from '../lib/format';
import { Button, Field, Input, Modal, PriorityToggle, Select, TextArea } from './ui';

export default function QuickAddOpp({ onClose, initialStageId }: { onClose: () => void; initialStageId?: string }) {
  // Bumping the key remounts a clean form ("Save & add another").
  const [formKey, setFormKey] = useState(0);
  const [lastSaved, setLastSaved] = useState('');

  return (
    <Modal title="Add opportunity" onClose={onClose}>
      <AddOppForm
        key={formKey}
        lastSaved={lastSaved}
        initialStageId={initialStageId}
        onClose={onClose}
        onSavedAndAddAnother={(company) => {
          setLastSaved(company);
          setFormKey((k) => k + 1);
        }}
      />
    </Modal>
  );
}

function AddOppForm({
  lastSaved, initialStageId, onClose, onSavedAndAddAnother,
}: {
  lastSaved: string;
  initialStageId?: string;
  onClose: () => void;
  onSavedAndAddAnother: (company: string) => void;
}) {
  const stages = useLiveQuery(() => db.stages.orderBy('order').toArray(), []) ?? [];
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [jobUrl, setJobUrl] = useState('');
  const [location, setLocation] = useState('');
  const [priority, setPriority] = useState<Priority>('B');
  const [stageId, setStageId] = useState(initialStageId ?? 'new-opp');
  const [compMin, setCompMin] = useState('');
  const [compMax, setCompMax] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const save = async (): Promise<number | null> => {
    const c = company.trim(), r = role.trim(), u = jobUrl.trim();
    if (!c && !r && !u) {
      setError('Add at least a company, role, or job URL.');
      return null;
    }
    return createOpportunity({
      company: c,
      role: r,
      jobUrl: u || undefined,
      location: location.trim() || undefined,
      priority,
      stageId: stages.some((s) => s.id === stageId) ? stageId : 'new-opp',
      compMin: compMin ? Number(compMin) : null,
      compMax: compMax ? Number(compMax) : null,
      notes: notes.trim() || undefined,
    });
  };

  const submit = async () => {
    const id = await save();
    if (id == null) return;
    onClose();
  };

  const submitAndAddAnother = async () => {
    const id = await save();
    if (id == null) return;
    onSavedAndAddAnother(company.trim() || role.trim() || 'opportunity');
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company"><Input autoFocus value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
        <Field label="Role"><Input value={role} onChange={(e) => setRole(e.target.value)} /></Field>
        <Field label="Job URL" className="col-span-2"><Input value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} placeholder="https://…" /></Field>
        <Field label="Location"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        <Field label="Stage">
          <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name} ({formatWeight(s.weight)})</option>)}
          </Select>
        </Field>
        <Field label="Priority" className="col-span-2">
          <PriorityToggle value={priority} onChange={setPriority} />
        </Field>
        <Field label="Comp min ($)"><Input type="number" value={compMin} onChange={(e) => setCompMin(e.target.value)} /></Field>
        <Field label="Comp max ($)"><Input type="number" value={compMax} onChange={(e) => setCompMax(e.target.value)} /></Field>
        <Field label="Notes" className="col-span-2"><TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex items-center gap-2">
        {lastSaved && (
          <span className="min-w-0 flex-1 truncate text-xs text-emerald-700" title={`Saved ${lastSaved}`}>
            Saved {lastSaved} ✓
          </span>
        )}
        <div className="ml-auto flex shrink-0 gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={submitAndAddAnother}>Save &amp; add another</Button>
          <Button variant="primary" onClick={submit}>Save opportunity</Button>
        </div>
      </div>
    </>
  );
}
