import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, updateOpportunity, type Opportunity } from '../db';
import type { View } from '../App';

/**
 * Guided tour over the sample pipeline. Each step dims the page, cuts a
 * "spotlight" hole around one part of the screen (found by a CSS selector,
 * usually a data-tour="…" attribute) and shows a short card next to it.
 *
 * Three kinds of step:
 *  - read:  the spotlight is look-only; the Next button moves on.
 *  - try:   (`interactive`) the spotlight can be clicked, Next still moves on.
 *  - do:    (`done`) the spotlight can be clicked and the tour moves on by
 *           itself once the user has done the thing.
 *
 * If a step's spotlight target disappears (say the user pressed Esc and closed
 * the opportunity), the tour steps back to `backTo` rather than getting stuck.
 */

interface Ctx {
  opps: Opportunity[];
  /** Number of opportunities when the current step began. */
  baseline: number | null;
  /** The sample opportunity the tour opens. */
  demo?: Opportunity;
}

interface Step {
  id: string;
  /** CSS selector for the spotlight. Several matches are spotlit together. None = centred card. */
  target?: string;
  /** Which screen this step lives on (the tour switches to it). */
  view?: View;
  anchor?: string;
  title: string;
  body: ReactNode;
  interactive?: boolean;
  done?: (ctx: Ctx) => boolean;
  /** A helper button that does the step for the user. */
  cta?: { label: string; run: (ctx: Ctx) => void | Promise<void> };
  backTo?: string;
  next?: string;
}

const DEMO_COMPANY = 'Stripe';
const DEMO_LINKEDIN = 'https://www.linkedin.com/company/stripe/';
const exists = (sel: string) => !!document.querySelector(sel);
const b = (t: string) => <span style={{ fontWeight: 700 }}>{t}</span>;

const STEPS: Step[] = [
  {
    id: 'welcome',
    title: 'Welcome to JobBoard',
    body: <>This takes about two minutes. You're looking at a made-up job search, so there's something to click on. We'll add a job, look inside one, and connect it to LinkedIn so you can find people to refer you.</>,
    next: 'Show me',
  },
  {
    id: 'board',
    target: '[data-tour="board"]',
    title: 'Your pipeline',
    body: <>Each card is a job you're going after. Cards move left to right as you make progress, from {b('New Opp')} to {b('Negotiation')}. The percentage under each column is the rough chance that a job at that stage turns into an offer.</>,
  },
  {
    id: 'kpi',
    target: '[data-tour="kpi"]',
    title: 'The number that matters',
    body: <>{b('Expected offers')} adds up those chances across all your cards. Most people are surprised how small it is. Getting it to 1.0 takes a lot of opportunities and, above all, referrals.</>,
  },
  {
    id: 'add',
    target: '[data-tour="quick-add"]',
    title: 'Add a job',
    body: <>Try it. Type a company name in the box (or paste a link to a job posting) and press {b('Enter')}.</>,
    done: (c) => c.baseline != null && c.opps.length > c.baseline,
  },
  {
    id: 'open',
    target: `[data-tour-opp="${DEMO_COMPANY}"]`,
    title: 'It’s on the board',
    body: <>Your new card landed in {b('New Opp')}, marked “groom” until you fill in the details. Now let's look inside a job: click the {b(DEMO_COMPANY)} card.</>,
    done: () => exists('[data-tour="inroads"]'),
  },
  {
    id: 'inroads',
    target: '[data-tour="inroads"]',
    backTo: 'open',
    title: 'Inroads: your routes to a referral',
    body: <>Applying cold rarely works. An inroad is a person who can put your name forward. Here Maya, someone you know, can introduce you to Priya at {DEMO_COMPANY}. Drag a card to the right as the conversation moves along, and into {b('Referred!')} when they refer you.</>,
  },
  {
    id: 'company-li',
    target: '[data-tour="company-li"]',
    backTo: 'open',
    title: 'Connect the company’s LinkedIn page',
    body: <>This makes the LinkedIn links precise. Normally you click {b('find ↗')}, pick the company on LinkedIn, copy the address of its page and paste it here, once per company. For the tour, I can fill it in.</>,
    done: (c) => !!c.demo?.companyLinkedinUrl,
    cta: { label: `Fill in ${DEMO_COMPANY}’s for me`, run: async (c) => { if (c.demo?.id != null) await updateOpportunity(c.demo.id, { companyLinkedinUrl: DEMO_LINKEDIN }); } },
  },
  {
    id: 'find',
    target: '[data-tour="find"]',
    backTo: 'open',
    interactive: true,
    title: 'Find people who work there now',
    body: <>Each {b('Find ↗')} opens LinkedIn in a new tab, showing only current {DEMO_COMPANY} employees: people you know (1st degree) or people your connections know (2nd degree). When you spot someone, copy their profile address, paste it in the box and press Enter. They become an inroad card.</>,
  },
  {
    id: 'alumni',
    target: '[data-tour="alumni"]',
    backTo: 'open',
    title: 'Fellow alumni',
    body: <>People from your school are often the most willing to help. Once your schools are set up, each one gets its own link right here. Let's see where that's done.</>,
    next: 'Show me',
  },
  {
    id: 'schools',
    view: 'settings',
    anchor: 'settings-schools',
    target: '#settings-schools',
    interactive: true,
    title: 'Add your schools',
    body: <>Follow the four steps to add a school. It takes a minute and you only do it once; the school then shows up as a link on every job. Do it now, or come back later from {b('Settings')}.</>,
  },
  {
    id: 'today',
    view: 'dashboard',
    target: '[data-tour="today"]',
    title: 'Do this today',
    body: <>Your daily to-do list, built from your pipeline: jobs going quiet, jobs with no inroad yet, and whether you're adding enough new ones each week.</>,
  },
  {
    id: 'finish',
    view: 'dashboard',
    title: 'That’s the loop',
    body: <>Find a job, build inroads, get referred, then apply. Everything you just saw is sample data. Keep playing with it, or clear it and start your own search. Any schools you added are kept either way.</>,
  },
];

const PAD = 6;
const CARD_W = 340;
const DIM = 'rgba(15,26,21,.62)';
const FOREST = '#234c3a';

interface Box { top: number; left: number; width: number; height: number }

/** Bounding box around every element matching the selector, or null if none are on screen. */
function measure(sel: string): Box | null {
  const els = [...document.querySelectorAll(sel)];
  if (!els.length) return null;
  let t = Infinity, l = Infinity, r = -Infinity, btm = -Infinity;
  for (const el of els) {
    const q = el.getBoundingClientRect();
    if (!q.width && !q.height) continue;
    t = Math.min(t, q.top); l = Math.min(l, q.left); r = Math.max(r, q.right); btm = Math.max(btm, q.bottom);
  }
  if (t === Infinity) return null;
  return { top: Math.round(t), left: Math.round(l), width: Math.round(r - l), height: Math.round(btm - t) };
}

/** Clear the sample pipeline but keep settings (schools, stages, targets). */
async function clearSamples() {
  const tables = [db.opportunities, db.contacts, db.oppContacts, db.referralPaths, db.activities];
  await db.transaction('rw', tables, async () => { for (const t of tables) await t.clear(); });
}

export default function Tour({ view, navigate, onEnd }: {
  view: View;
  navigate: (v: View, anchor?: string) => void;
  onEnd: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(200);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = STEPS[index];

  const opps = useLiveQuery(() => db.opportunities.toArray(), []) ?? [];
  const ctx = useRef<Ctx>({ opps: [], baseline: null });
  ctx.current.opps = opps;
  ctx.current.demo = opps.find((o) => o.company === DEMO_COMPANY);

  const goTo = (id: string) => setIndex(Math.max(0, STEPS.findIndex((s) => s.id === id)));
  const next = () => (index >= STEPS.length - 1 ? onEnd() : setIndex(index + 1));

  // On entering a step: switch screens if needed and note how many opps exist.
  useEffect(() => {
    if (step.view && step.view !== view) navigate(step.view, step.anchor);
    ctx.current.baseline = null;
    let live = true;
    void db.opportunities.count().then((n) => { if (live) ctx.current.baseline = n; });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Every frame: follow the spotlight target, move on when a "do" step is done,
  // and step back if the target has gone missing for a moment.
  useEffect(() => {
    let raf = 0;
    let missingSince: number | null = null;
    const tick = () => {
      if (step.done?.(ctx.current)) { next(); return; }
      const m = step.target ? measure(step.target) : null;
      setBox((prev) => (prev && m && prev.top === m.top && prev.left === m.left && prev.width === m.width && prev.height === m.height ? prev : m));
      if (step.target && !m) {
        missingSince ??= performance.now();
        if (step.backTo && performance.now() - missingSince > 700) { goTo(step.backTo); return; }
      } else {
        missingSince = null;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [index, box]);

  // Keep the dashboard's "N" shortcut from opening a form underneath the tour.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      if (!typing && (e.key === 'n' || e.key === 'N')) e.stopPropagation();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  const vw = window.innerWidth, vh = window.innerHeight;
  const hole = box && { top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 };
  const clickable = !!(step.done || step.interactive);

  // Card position: beside the spotlight where there's room, else tucked inside its bottom corner.
  let cardStyle: CSSProperties;
  if (!hole) {
    cardStyle = { top: Math.max(12, (vh - cardH) / 2), left: Math.max(12, (vw - CARD_W) / 2) };
  } else {
    const gap = 14;
    const room = {
      bottom: vh - (hole.top + hole.height) - gap,
      right: vw - (hole.left + hole.width) - gap,
      left: hole.left - gap,
      top: hole.top - gap,
    };
    const clampX = (x: number) => Math.min(Math.max(12, x), vw - CARD_W - 12);
    const clampY = (y: number) => Math.min(Math.max(12, y), vh - cardH - 12);
    if (room.bottom >= cardH + 12) cardStyle = { top: hole.top + hole.height + gap, left: clampX(hole.left) };
    else if (room.right >= CARD_W + 12) cardStyle = { top: clampY(hole.top), left: hole.left + hole.width + gap };
    else if (room.left >= CARD_W + 12) cardStyle = { top: clampY(hole.top), left: hole.left - gap - CARD_W };
    else if (room.top >= cardH + 12) cardStyle = { top: hole.top - gap - cardH, left: clampX(hole.left) };
    else cardStyle = { top: clampY(hole.top + hole.height - cardH - 20), left: clampX(hole.left + hole.width - CARD_W - 20) };
  }

  const dim: CSSProperties = { position: 'fixed', background: DIM, zIndex: 80 };
  const last = index === STEPS.length - 1;
  const linkBtn: CSSProperties = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: '#6f776d' };
  const primaryBtn: CSSProperties = { background: FOREST, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
  const ghostBtn: CSSProperties = { background: '#fff', color: FOREST, border: `1px solid ${FOREST}`, borderRadius: 6, padding: '7px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };

  return (
    <div role="dialog" aria-label="Guided tour" style={{ fontFamily: 'var(--font-sans)' }}>
      {hole ? (
        <>
          {/* four dim panels around the spotlight */}
          <div style={{ ...dim, top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
          <div style={{ ...dim, top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
          <div style={{ ...dim, top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
          <div style={{ ...dim, top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
          {/* look-only steps: an invisible shield so the spotlight can't be clicked */}
          {!clickable && <div style={{ position: 'fixed', zIndex: 80, ...hole }} />}
          <div style={{ position: 'fixed', zIndex: 81, pointerEvents: 'none', ...hole, borderRadius: 8, boxShadow: '0 0 0 2px #fff, 0 0 0 5px #d9a441' }} />
        </>
      ) : (
        <div style={{ ...dim, inset: 0 }} />
      )}

      <div ref={cardRef} style={{ position: 'fixed', zIndex: 82, width: CARD_W, maxWidth: 'calc(100vw - 24px)', background: '#fff', borderRadius: 12, boxShadow: '0 18px 50px rgba(0,0,0,.35)', padding: '16px 18px 14px', color: '#1b211d', ...cardStyle }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: '#9aa298', letterSpacing: '.04em' }}>
          {step.target || index > 0 ? `STEP ${index + 1} OF ${STEPS.length}` : 'GUIDED TOUR'}
          {step.done && <span style={{ color: '#9a6b1f', marginLeft: 8 }}>YOUR TURN</span>}
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.01em', margin: '5px 0 6px' }}>{step.title}</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: '#3c453e' }}>{step.body}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button style={linkBtn} onClick={onEnd}>{last ? '' : 'Skip tour'}</button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {last ? (
              <>
                <button style={ghostBtn} onClick={onEnd}>Keep exploring</button>
                <button style={primaryBtn} onClick={async () => { await clearSamples(); onEnd(); }}>Clear samples, start mine</button>
              </>
            ) : step.done ? (
              <>
                <button style={linkBtn} onClick={next}>Skip this step</button>
                {step.cta && <button style={primaryBtn} onClick={() => void step.cta!.run(ctx.current)}>{step.cta.label}</button>}
              </>
            ) : (
              <button style={primaryBtn} onClick={next}>{step.next ?? 'Next'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
