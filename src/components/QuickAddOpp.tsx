import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { createOpportunity, db, type Priority } from '../db';
import { formatWeight } from '../lib/format';
import { Button, Field, Input, Modal, Select, TextArea } from './ui';

export default function QuickAddOpp({ onClose, onCreated }: { onClose: () => void; onCreated?: (id: number) => void }) {
  const stages = useLiveQuery(() => db.stages.orderBy('order').toArray(), []) ?? [];
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [jobUrl, setJobUrl] = useState('');
  const [location, setLocation] = useState('');
  const [source, setSource] = useState('');
  const [priority, setPriority] = useState<Priority>('B');
  const [stageId, setStageId] = useState('new-opp');
  const [compMin, setCompMin] = useState('');
  const [compMax, setCompMax] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    if (!company.trim() || !role.trim()) {
      setError('Company and role are required.');
      return;
    }
    const id = await createOpportunity({
      company: company.trim(),
      role: role.trim(),
      jobUrl: jobUrl.trim() || undefined,
      location: location.trim() || undefined,
      source: source.trim() || undefined,
      priority,
      stageId: stages.some((s) => s.id === stageId) ? stageId : 'new-opp',
      compMin: compMin ? Number(compMin) : null,
      compMax: compMax ? Number(compMax) : null,
      notes: notes.trim() || undefined,
    });
    onCreated?.(id);
    onClose();
  };

  return (
    <Modal title="Add opportunity" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company *"><Input autoFocus value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
        <Field label="Role *"><Input value={role} onChange={(e) => setRole(e.target.value)} /></Field>
        <Field label="Job URL" className="col-span-2"><Input value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} placeholder="https://…" /></Field>
        <Field label="Location"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        <Field label="Source"><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Job board, referral…" /></Field>
        <Field label="Stage">
          <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name} ({formatWeight(s.weight)})</option>)}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="A">A — dream job</option>
            <option value="B">B — solid fit</option>
            <option value="C">C — backup</option>
          </Select>
        </Field>
        <Field label="Comp min ($)"><Input type="number" value={compMin} onChange={(e) => setCompMin(e.target.value)} /></Field>
        <Field label="Comp max ($)"><Input type="number" value={compMax} onChange={(e) => setCompMax(e.target.value)} /></Field>
        <Field label="Notes" className="col-span-2"><TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Add opportunity</Button>
      </div>
    </Modal>
  );
}
