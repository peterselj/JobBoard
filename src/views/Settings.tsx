import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveSettings, type School, type Settings as SettingsType, type Stage } from '../db';
import { clearAllData, exportBackup, importBackup } from '../lib/backup';
import {
  chooseBackupFile, disconnectBackupFile, getBackupState, reconnectBackupFile,
  restoreFromBackupFile, saveNow, subscribeBackup,
} from '../lib/autobackup';
import { loadSampleData } from '../lib/sampleData';
import { Button, Field, Input, SectionHeader } from '../components/ui';

export default function Settings() {
  const stages = useLiveQuery(() => db.stages.orderBy('order').toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.get('app'), []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <StageEditor stages={stages} />
      {settings && <TargetsEditor settings={settings} />}
      {settings && <SchoolsEditor settings={settings} />}
      <BackupSection />
      <DataSection />
      <SharingSection />
    </div>
  );
}

// ---------- Stages ----------

function StageEditor({ stages }: { stages: Stage[] }) {
  const [newName, setNewName] = useState('');
  const [newWeight, setNewWeight] = useState('');

  const move = async (stage: Stage, dir: -1 | 1) => {
    const idx = stages.findIndex((s) => s.id === stage.id);
    const neighbor = stages[idx + dir];
    if (!neighbor) return;
    await db.transaction('rw', db.stages, async () => {
      await db.stages.update(stage.id, { order: neighbor.order });
      await db.stages.update(neighbor.id, { order: stage.order });
    });
  };

  const remove = async (stage: Stage) => {
    const count = await db.opportunities.where('stageId').equals(stage.id).count();
    if (count > 0) {
      window.alert(`Can't delete "${stage.name}" — ${count} opportunit${count === 1 ? 'y is' : 'ies are'} in this stage. Move them first.`);
      return;
    }
    if (window.confirm(`Delete stage "${stage.name}"?`)) await db.stages.delete(stage.id);
  };

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    const weight = Math.min(100, Math.max(0, Number(newWeight) || 0));
    const firstTerminal = stages.find((s) => s.kind !== 'active');
    const insertOrder = firstTerminal ? firstTerminal.order : (stages.at(-1)?.order ?? 0) + 1;
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString(36)}`;
    await db.transaction('rw', db.stages, async () => {
      for (const s of stages) {
        if (s.order >= insertOrder) await db.stages.update(s.id, { order: s.order + 1 });
      }
      await db.stages.add({ id, name, weight, order: insertOrder, kind: 'active' });
    });
    setNewName('');
    setNewWeight('');
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <SectionHeader title="Pipeline stages & weights" />
      <p className="mb-3 text-sm text-slate-500">
        A stage's weight is the probability an opp at that stage becomes an offer. Tune them as you learn your
        own conversion rates; everything recalculates instantly.
      </p>
      <div className="space-y-1.5">
        {stages.map((s, idx) => (
          <div key={s.id} className="flex items-center gap-2">
            <div className="flex flex-col">
              <button onClick={() => move(s, -1)} disabled={idx === 0} className="text-xs leading-none text-slate-400 hover:text-slate-700 disabled:opacity-25" aria-label="Move up">▲</button>
              <button onClick={() => move(s, 1)} disabled={idx === stages.length - 1} className="text-xs leading-none text-slate-400 hover:text-slate-700 disabled:opacity-25" aria-label="Move down">▼</button>
            </div>
            <Input
              defaultValue={s.name}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.name && db.stages.update(s.id, { name: e.target.value.trim() })}
              className="!w-56"
            />
            <div className="flex items-center gap-1">
              <Input
                type="number" min={0} max={100} step={0.1}
                defaultValue={s.weight}
                onBlur={(e) => {
                  const w = Math.min(100, Math.max(0, Number(e.target.value)));
                  if (!Number.isNaN(w) && w !== s.weight) db.stages.update(s.id, { weight: w });
                }}
                className="!w-24"
              />
              <span className="text-sm text-slate-400">%</span>
            </div>
            <span className="text-xs text-slate-400">
              {s.kind === 'won' ? 'terminal · won' : s.kind === 'lost' ? 'terminal · lost' : ''}
            </span>
            {s.kind === 'active' && (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => remove(s)}>Delete</Button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-end gap-2 border-t border-slate-100 pt-4">
        <Field label="New stage name"><Input value={newName} onChange={(e) => setNewName(e.target.value)} className="!w-56" placeholder="e.g. Take-home exercise" /></Field>
        <Field label="Weight %"><Input type="number" min={0} max={100} step={0.1} value={newWeight} onChange={(e) => setNewWeight(e.target.value)} className="!w-24" /></Field>
        <Button variant="primary" onClick={add}>Add stage</Button>
      </div>
    </section>
  );
}

// ---------- Targets ----------

function TargetsEditor({ settings }: { settings: SettingsType }) {
  const setTarget = (key: keyof SettingsType['targets']) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Math.max(0, Number(e.target.value) || 0);
    saveSettings({ targets: { ...settings.targets, [key]: v } });
  };
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <SectionHeader title="Weekly targets & preferences" />
      <p className="mb-3 text-sm text-slate-500">
        Set an ambitious pace — the point of this tool is to roughly 4× the volume you'd run unaided.
      </p>
      <div className="grid grid-cols-4 gap-3">
        <Field label="New opps / week"><Input type="number" min={0} defaultValue={settings.targets.newOpps} onBlur={setTarget('newOpps')} /></Field>
        <Field label="Referral convos / week"><Input type="number" min={0} defaultValue={settings.targets.referralConvos} onBlur={setTarget('referralConvos')} /></Field>
        <Field label="Applications / week"><Input type="number" min={0} defaultValue={settings.targets.applications} onBlur={setTarget('applications')} /></Field>
        <Field label="Stale after (days)">
          <Input type="number" min={1} defaultValue={settings.staleDays} onBlur={(e) => saveSettings({ staleDays: Math.max(1, Number(e.target.value) || 7) })} />
        </Field>
      </div>
    </section>
  );
}

// ---------- Schools (alumni search) ----------

function SchoolsEditor({ settings }: { settings: SettingsType }) {
  const schools = settings.schools ?? [];
  const [name, setName] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [error, setError] = useState('');

  const add = async () => {
    const cleanName = name.trim();
    const cleanId = schoolId.trim().replace(/\D/g, '');
    if (!cleanName || !cleanId) {
      setError('Both a school name and its numeric LinkedIn ID are needed.');
      return;
    }
    if (schools.some((s) => s.id === cleanId)) {
      setError('That school ID is already added.');
      return;
    }
    await saveSettings({ schools: [...schools, { name: cleanName, id: cleanId }] });
    setName('');
    setSchoolId('');
    setError('');
  };

  const remove = async (school: School) => {
    await saveSettings({ schools: schools.filter((s) => s.id !== school.id) });
  };

  return (
    <section id="settings-schools" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <SectionHeader title="Your schools (alumni search)" />
      <p className="mb-3 text-sm text-slate-500">
        Each school you add becomes a one-click "alumni at this company" search link on every opportunity.
        Add as many as apply — undergrad, grad school, etc.
      </p>
      {schools.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {schools.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <span><span className="font-medium">{s.name}</span><span className="ml-2 text-xs text-slate-400">ID {s.id}</span></span>
              <Button size="sm" variant="ghost" onClick={() => remove(s)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <Field label="School name"><Input value={name} onChange={(e) => setName(e.target.value)} className="!w-64" placeholder="e.g. Georgetown University" /></Field>
        <Field label="LinkedIn school ID"><Input value={schoolId} onChange={(e) => setSchoolId(e.target.value)} className="!w-36" placeholder="e.g. 4794" /></Field>
        <Button variant="primary" onClick={add}>Add school</Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
        <span className="font-semibold text-slate-600">Finding your school's ID (one time):</span> on LinkedIn, run any
        people search → <span className="font-medium">All filters → School</span> → select your school →{' '}
        <span className="font-medium">Show results</span>. The page URL will now contain{' '}
        <code className="rounded bg-slate-200 px-1">schoolFilter=%5B%22<span className="font-bold">4794</span>%22%5D</code>{' '}
        — that number is the ID. (4794 is Georgetown, for example.)
      </div>
    </section>
  );
}

// ---------- Local backup file (autosave) ----------

function BackupSection() {
  const [s, setS] = useState(getBackupState());
  const [msg, setMsg] = useState('');
  useEffect(() => subscribeBackup(setS), []);

  const lastSaved = s.lastSaved ? new Date(s.lastSaved).toLocaleTimeString() : '—';

  const choose = async () => {
    setMsg('');
    try { await chooseBackupFile(); setMsg('Backup file connected — autosaving now.'); }
    catch (e) { if ((e as { name?: string })?.name !== 'AbortError') setMsg('Could not set up the file.'); }
  };
  const restore = async () => {
    if (!window.confirm('Replace ALL current data with the contents of the backup file?')) return;
    const r = await restoreFromBackupFile();
    if (r) setMsg(`Restored ${r.counts.opportunities} opps, ${r.counts.contacts} contacts, ${r.counts.activities} activities.`);
  };

  return (
    <section id="settings-backup" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <SectionHeader title="Local backup file (autosave)" />
      {!s.supported ? (
        <p className="text-sm text-slate-500">
          You need Chrome or Edge as your browser to autosave to your machine. In this browser, your data is saved in
          the browser only. You may want to switch browsers for extra reassurance, or just manually export your data
          regularly.
        </p>
      ) : s.connected ? (
        <>
          <p className="mb-3 text-sm text-slate-500">
            Autosaving to <span className="font-medium text-slate-700">{s.fileName}</span> a few seconds after every
            change — no downloads, nothing leaves your computer. {s.saving ? 'Saving…' : `Last saved ${lastSaved}.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={async () => { await saveNow(); setMsg('Saved.'); }}>Save now</Button>
            <Button onClick={restore}>Restore from file…</Button>
            <Button variant="danger" onClick={async () => { await disconnectBackupFile(); setMsg('Disconnected. Your data and the file are untouched.'); }}>Disconnect</Button>
          </div>
        </>
      ) : s.needsReconnect ? (
        <>
          <p className="mb-3 text-sm text-slate-500">
            A backup file (<span className="font-medium">{s.fileName}</span>) is set up but needs one click to reconnect this session.
          </p>
          <Button variant="primary" onClick={() => reconnectBackupFile()}>Reconnect autosave</Button>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-500">
            Pick a file on your computer to autosave into. We rewrite it a few seconds after every change, so if this
            browser ever loses its data you can recover everything from that file — no account, no cloud.
            Persistent storage: <span className="font-medium">{s.persistent ? 'granted' : 'requested'}</span>.
          </p>
          <Button variant="primary" onClick={choose}>Choose Backup Location &amp; Save File…</Button>
        </>
      )}
      {msg && <p className="mt-3 text-sm text-slate-600">{msg}</p>}
    </section>
  );
}

// ---------- Data ----------

function DataSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');

  const handleImport = async (file: File) => {
    if (!window.confirm('Importing a backup REPLACES all current data. Continue?')) return;
    try {
      const result = await importBackup(await file.text());
      setMessage(`Restored ${result.counts.opportunities} opps, ${result.counts.contacts} contacts, ${result.counts.activities} activities.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <SectionHeader title="Your data" />
      <p className="mb-3 text-sm text-slate-500">
        Everything lives in this browser only — nothing is uploaded anywhere. Export a backup regularly
        (and before clearing browser data); the file restores your whole workspace on any machine.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => exportBackup()}>Export backup (JSON)</Button>
        <Button onClick={() => fileRef.current?.click()}>Import backup…</Button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])} />
        <Button onClick={() => { if (window.confirm('Add demo opportunities, contacts, and activity on top of your current data?')) loadSampleData(); }}>
          Load sample data
        </Button>
        <Button
          variant="danger"
          onClick={async () => {
            if (window.confirm('Delete ALL data (opps, contacts, activities, custom stages)?') &&
                window.confirm('Really sure? Export a backup first if in doubt.')) {
              await clearAllData();
              setMessage('All data cleared.');
            }
          }}
        >
          Clear all data
        </Button>
      </div>
      {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}
    </section>
  );
}

function SharingSection() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <SectionHeader title="Sharing with a friend" />
      <p className="text-sm text-slate-500">
        Just send them this site's URL. Data is stored per-browser, so they automatically get their own private,
        empty workspace — no accounts, and you'll never see each other's pipelines. To move <em>your</em> data to
        another computer, use Export backup → Import backup.
      </p>
    </section>
  );
}
