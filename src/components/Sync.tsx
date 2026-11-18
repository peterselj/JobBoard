import { useEffect, useState } from 'react';
import {
  chooseBoard, deleteAccount, getSyncState, sendSignInLink, signOut, subscribeSync, syncNow, type SyncState,
} from '../lib/sync';
import { Button, Field, Input, SectionHeader } from './ui';

export function useSync(): SyncState {
  const [s, setS] = useState(getSyncState());
  useEffect(() => subscribeSync(setS), []);
  return s;
}

const when = (t: number | string) => {
  const d = new Date(t);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Settings → Sync between computers. Hidden until sign-in is switched on for the site. */
export function SyncSection() {
  const s = useSync();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  if (!s.configured) return null;

  const run = async (fn: () => Promise<void>, done = '') => {
    setBusy(true); setMsg('');
    try { await fn(); if (done) setMsg(done); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <section id="settings-sync" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <SectionHeader title="Sync between computers" />
      {s.email ? (
        <>
          <p className="mb-3 text-sm text-slate-500">
            Signed in as <span className="font-medium text-slate-700">{s.email}</span>.{' '}
            {s.status === 'syncing' ? 'Syncing…'
              : s.status === 'offline' ? "Can't reach your account right now. Your changes are safe on this computer and will sync when it's back."
              : s.status === 'choose' ? 'Waiting for you to pick a board.'
              : s.lastSynced ? `Up to date as of ${when(s.lastSynced)}.` : ''}
          </p>
          <p className="mb-3 text-sm text-slate-500">
            Your board is saved to your account a few seconds after each change, and loads on any computer where you
            sign in with this email.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run(syncNow)} disabled={busy}>Sync now</Button>
            <Button onClick={() => run(() => signOut(), 'Signed out. Your board stays on this computer.')} disabled={busy}>Sign out</Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Sign out and remove your board from this browser? It stays in your account, so signing in again brings it back.')) {
                  void run(() => signOut({ clear: true }), 'Signed out and removed the board from this browser.');
                }
              }}
            >
              Sign out and clear this computer
            </Button>
          </div>
          <details className="mt-4 text-sm text-slate-500">
            <summary className="cursor-pointer select-none">Delete my account</summary>
            <p className="mt-2">
              Deletes your sign-in and the copy of your board saved in your account. The board on this computer
              stays (export a backup first if you want one), and your other computers stop syncing.
            </p>
            <Button
              variant="danger" className="mt-2" disabled={busy}
              onClick={() => {
                if (window.confirm('Delete your JobBoard account and the board saved in it? This cannot be undone.')) {
                  void run(deleteAccount, 'Account deleted. Your board is still on this computer.');
                }
              }}
            >
              Delete my account
            </Button>
          </details>
        </>
      ) : sent ? (
        <>
          <p className="text-sm text-slate-600">
            We sent a sign-in link to <span className="font-medium">{email.trim()}</span>. Open it <b>in this browser on
            this computer</b>. It can take a minute, and it may land in spam the first time.
          </p>
          <button onClick={() => setSent(false)} className="mt-2 text-sm font-medium text-emerald-700 hover:underline">Use a different email</button>
        </>
      ) : (
        <>
          <p className="mb-2 text-sm text-slate-500">
            Want your board on more than one computer? Sign in with your email on each one and they'll stay in step.
            No password: we email you a link.
          </p>
          <p className="mb-3 text-sm text-slate-500">
            <span className="font-medium text-slate-600">What changes when you sign in:</span> a copy of your board
            (opportunities, contacts and notes) is kept in JobBoard's database, so your other computers can load it. Only
            you can open it from the app, but like any hosted service, the people who run JobBoard's database could see it.
            Skip this and everything stays in this browser only, as before.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Email">
              <Input
                type="email" autoComplete="email" className="!w-72" placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && email.includes('@') && run(async () => { await sendSignInLink(email); setSent(true); })}
              />
            </Field>
            <Button
              variant="primary" disabled={busy || s.starting || !email.includes('@')}
              onClick={() => run(async () => { await sendSignInLink(email); setSent(true); })}
            >
              {busy ? 'Sending…' : 'Email me a sign-in link'}
            </Button>
          </div>
        </>
      )}
      {(msg || s.error) && <p className="mt-3 text-sm text-slate-600">{msg || s.error}</p>}
    </section>
  );
}

/**
 * Shown when this computer and your account both have a board and we can't tell which you want
 * (first sign-in on a computer that already has a board, or edits on two computers while one was
 * offline). Whichever you don't keep is saved to Downloads first.
 */
export function SyncChoiceDialog() {
  const s = useSync();
  const [busy, setBusy] = useState(false);
  if (!s.choice) return null;
  const { here, account } = s.choice;
  const pick = async (keep: 'here' | 'account') => {
    setBusy(true);
    try { await chooseBoard(keep); } finally { setBusy(false); }
  };
  const card = (title: string, c: { opportunities: number; contacts: number }, note: string, keep: 'here' | 'account', label: string) => (
    <div className="flex flex-1 flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:min-w-[220px]">
      <div className="text-[11px] font-bold uppercase tracking-[.1em] text-slate-600">{title}</div>
      <div className="text-sm text-slate-700">{plural(c.opportunities, 'opportunity', 'opportunities')}, {plural(c.contacts, 'contact')}</div>
      <div className="text-xs text-slate-500">{note}</div>
      <Button variant="primary" className="mt-auto justify-center" disabled={busy} onClick={() => pick(keep)}>{label}</Button>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="mt-10 w-full max-w-xl rounded-xl bg-white p-5 shadow-2xl">
        <h2 className="text-base font-semibold">Which board do you want to keep?</h2>
        <p className="mt-1 text-sm text-slate-500">
          This computer and your account ({s.email}) each have a board, and they're different. Pick one to use on
          every computer. The other is saved to your Downloads folder first, so you can bring anything back with
          Settings → Import backup.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          {card('This computer', here, 'What you see on this screen now.', 'here', 'Keep this computer’s')}
          {card('Your account', account, `Last saved ${when(account.savedAt)}${account.savedBy ? ` from ${account.savedBy}` : ''}.`, 'account', 'Keep the account’s')}
        </div>
        {s.error && <p className="mt-3 text-sm text-red-600">{s.error}</p>}
      </div>
    </div>
  );
}

/** Thin strip while changes can't reach the account. */
export function SyncOfflineBanner() {
  const s = useSync();
  if (!s.email || s.status !== 'offline') return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] flex items-center gap-3 bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-md">
      <span className="min-w-0 flex-1">Can't reach your JobBoard account. Changes are saved on this computer and will sync when it's back.</span>
      <button onClick={() => syncNow()} className="shrink-0 rounded-md px-2 py-1 font-semibold hover:bg-amber-100">Try again</button>
    </div>
  );
}
