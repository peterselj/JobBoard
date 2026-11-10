// An opportunity arriving from another tool (JobSnipe's "Send to JobBoard"), carried in this page's
// address: ?add=1&company=…&role=…&url=…&location=…&compMin=…&compMax=…&from=jobsnipe
//
// Nothing is saved from the address by itself: it only fills in the Add opportunity form, and you
// press Save. Anyone can write an address, so every value is treated as plain text, capped in
// length, and the job link is kept only if it's an ordinary web link.

export interface Handoff {
  company: string;
  role: string;
  jobUrl: string;
  location: string;
  compMin: string;
  compMax: string;
  /** Where it came from, for the form's note ("From JobSnipe"). */
  from: string;
}

const text = (v: string | null, max: number) => (v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A web link, or '' for anything else ("javascript:" links must never reach a clickable spot). */
export function webLink(v: string | null | undefined): string {
  try {
    const u = new URL((v ?? '').trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString().slice(0, 1000) : '';
  } catch {
    return '';
  }
}

const money = (v: string | null) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n < 100_000_000 ? String(n) : '';
};

export function parseHandoff(search: string): Handoff | null {
  const q = new URLSearchParams(search);
  if (!q.has('add')) return null;
  const h: Handoff = {
    company: text(q.get('company'), 120),
    role: text(q.get('role'), 200),
    jobUrl: webLink(q.get('url')),
    location: text(q.get('location'), 120),
    compMin: money(q.get('compMin')),
    compMax: money(q.get('compMax')),
    from: q.get('from') === 'jobsnipe' ? 'JobSnipe' : '',
  };
  return h.company || h.role || h.jobUrl ? h : null;
}

/** Read a handoff from the address once, then tidy the address so a reload doesn't reopen the form. */
export function takeHandoff(): Handoff | null {
  const h = parseHandoff(window.location.search);
  if (new URLSearchParams(window.location.search).has('add')) {
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }
  return h;
}
