import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addReferralPath, db, saveSettings, updateOpportunity, type Opportunity } from '../db';
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
  /** Inroads on the demo opportunity. */
  demoPaths: number;
  /** Counts when the current step began (null until read). */
  baseline: { opps: number; demoPaths: number } | null;
  /** The sample opportunity the tour opens. */
  demo?: Opportunity;
  /** The opportunity the user added during the tour, if any. */
  added?: Opportunity;
}

type Dyn<T> = T | ((c: Ctx) => T);
const val = <T,>(d: Dyn<T>, c: Ctx): T => (typeof d === 'function' ? (d as (c: Ctx) => T)(c) : d);

interface Step {
  id: string;
  /** CSS selector for the spotlight. Several matches are spotlit together. None = centred card. */
  target?: string;
  /** Short tag pointing at the spotlight ("Click this one"). */
  label?: string;
  /** A second thing to light up for context. It can be seen but not clicked. */
  also?: (c: Ctx) => { target: string; label: string } | null;
  /** Which screen this step lives on (the tour switches to it). */
  view?: View;
  anchor?: string;
  /** Preferred side for the card. */
  place?: 'right';
  title: string;
  body: Dyn<ReactNode>;
  /** A small picture shown under the text. */
  art?: ReactNode;
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

/** Add the sample inroad (Maya introduces Priya) for a user who'd rather not type it. */
async function addDemoInroad(c: Ctx) {
  if (c.demo?.id == null) return;
  const contacts = await db.contacts.toArray();
  const maya = contacts.find((x) => x.firstName === 'Maya' && x.lastName === 'Chen');
  const priya = contacts.find((x) => x.firstName === 'Priya' && x.lastName === 'Raman');
  if (maya?.id != null && priya?.id != null) await addReferralPath(c.demo.id, priya.id, maya.id);
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    title: 'Welcome to JobBoard',
    body: <>This takes about two minutes. You're looking at a made-up job search, so there's something to click on. We'll add a job, look inside one, connect it to LinkedIn, and line up someone to refer you.</>,
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
    done: (c) => !!c.baseline && c.opps.length > c.baseline.opps,
  },
  {
    id: 'open',
    target: `[data-tour-opp="${DEMO_COMPANY}"]`,
    label: 'Click this one',
    also: (c) => (c.added?.id != null ? { target: `[data-tour-opp-id="${c.added.id}"]`, label: 'Your new job' } : null),
    place: 'right',
    title: 'It’s on the board',
    body: (c) => c.added
      ? <>There's {b(c.added.company || 'your new job')}, in {b('New Opp')}. It's marked “groom” until you fill in the details, and it will wait there for you. To see what's inside a job, we'll use a sample that has more going on: click the {b(DEMO_COMPANY)} card.</>
      : <>To see what's inside a job, click the {b(DEMO_COMPANY)} card.</>,
    done: () => exists('[data-tour="inroads"]'),
  },
  {
    id: 'company-li',
    target: '[data-tour="company-li"]',
    backTo: 'open',
    title: 'First, connect the company’s LinkedIn page',
    body: <>This is one job, opened up. Before looking for people, tell JobBoard which company this is on LinkedIn. Normally you click {b('find ↗')}, pick the company, copy the address of its page and paste it here, once per company. For the tour, I can fill it in.</>,
    done: (c) => !!c.demo?.companyLinkedinUrl,
    cta: { label: `Fill in ${DEMO_COMPANY}’s for me`, run: async (c) => { if (c.demo?.id != null) await updateOpportunity(c.demo.id, { companyLinkedinUrl: DEMO_LINKEDIN }); } },
  },
  {
    id: 'find',
    target: '[data-tour~="find"]',
    backTo: 'open',
    interactive: true,
    title: 'Find people who work there now',
    body: <>Each {b('Find ↗')} now opens the company's People page on LinkedIn in a new tab, narrowed to people you know (1st degree) or people your connections know (2nd degree). {b('Scroll down past the bar charts')} to see the people themselves. Try one if you like, then come back.</>,
    art: <LinkedInSketch />,
  },
  {
    id: 'add-inroad',
    target: '[data-tour~="find-2nd"]',
    backTo: 'open',
    title: 'Add the person you found',
    body: <>Say that search showed your friend {b('Maya Chen')} knows {b('Priya Raman')} at {DEMO_COMPANY}. Type Maya's name in the first box and Priya's in the second, then press {b('Enter')}. (In real use you can paste a LinkedIn profile address instead of a name.)</>,
    done: (c) => !!c.baseline && c.demoPaths > c.baseline.demoPaths,
    cta: { label: 'Add them for me', run: addDemoInroad },
  },
  {
    id: 'inroads',
    target: '[data-tour="inroads"]',
    backTo: 'open',
    title: 'That’s an inroad',
    body: <>An inroad is a route to a referral: here, Maya introducing you to Priya. Applying cold rarely works, so aim for a few inroads per job. Drag a card to the right as the conversation moves along, and into {b('Referred!')} when they put your name forward.</>,
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

/**
 * A looping sketch of the LinkedIn People page: company header, then bar
 * charts, then (after scrolling) the people. Drawn, not a screenshot, so no
 * real profiles appear in the app. Holds still on the people if the viewer
 * prefers reduced motion.
 */
function LinkedInSketch() {
  const grey = '#dfe3dc', line = '#cfd4cb';
  const bar = (w: string) => <div style={{ height: 5, width: w, background: '#7fa589', borderRadius: 3 }} />;
  const chart = (
    <div style={{ flex: 1, border: `1px solid ${line}`, borderRadius: 5, padding: 6, display: 'flex', flexDirection: 'column', gap: 5, background: '#fff' }}>
      <div style={{ height: 4, width: '55%', background: grey, borderRadius: 2 }} />
      {bar('90%')}{bar('60%')}{bar('35%')}
    </div>
  );
  const person = (
    <div style={{ flex: 1, border: '1.5px solid #d9a441', borderRadius: 5, padding: '7px 5px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: '#fffaf0' }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#c9d6cc' }} />
      <div style={{ height: 4, width: '70%', background: '#9aa298', borderRadius: 2 }} />
      <div style={{ height: 3, width: '50%', background: grey, borderRadius: 2 }} />
      <div style={{ fontSize: 8, fontWeight: 700, color: '#234c3a', border: '1px solid #234c3a', borderRadius: 8, padding: '0 6px' }}>2nd</div>
    </div>
  );
  return (
    <div aria-label="Sketch: on LinkedIn, the people are listed below the bar charts" role="img" style={{ marginTop: 10, border: `1px solid ${line}`, borderRadius: 8, background: '#f3f3ee', height: 104, overflow: 'hidden', position: 'relative' }}>
      <style>{`
        @keyframes tour-li-scroll { 0%, 30% { transform: translateY(0) } 55%, 92% { transform: translateY(-86px) } 100% { transform: translateY(0) } }
        .tour-li-page { animation: tour-li-scroll 5.5s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce) { .tour-li-page { animation: none; transform: translateY(-86px) } }
      `}</style>
      <div className="tour-li-page" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 16, height: 16, borderRadius: 3, background: '#234c3a' }} />
          <div style={{ height: 5, width: 70, background: '#9aa298', borderRadius: 2 }} />
          <div style={{ marginLeft: 'auto', fontSize: 8, fontWeight: 700, color: '#234c3a', borderBottom: '2px solid #234c3a' }}>People</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>{chart}{chart}{chart}</div>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#9a6b1f', textAlign: 'center' }}>↓ scroll down ↓</div>
        <div style={{ display: 'flex', gap: 6 }}>{person}{person}{person}{person}</div>
      </div>
    </div>
  );
}

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

const same = (x: Box | null, y: Box | null) =>
  x === y || (!!x && !!y && x.top === y.top && x.left === y.left && x.width === y.width && x.height === y.height);
const grow = (q: Box): Box => ({ top: q.top - PAD, left: q.left - PAD, width: q.width + PAD * 2, height: q.height + PAD * 2 });
function union(x: Box, y: Box): Box {
  const top = Math.min(x.top, y.top), left = Math.min(x.left, y.left);
  return { top, left, width: Math.max(x.left + x.width, y.left + y.width) - left, height: Math.max(x.top + x.height, y.top + y.height) - top };
}

/** A small tag sitting to the left of a spotlit item, pointing at it. */
function Tag({ box, text, strong }: { box: Box; text: string; strong?: boolean }) {
  return (
    <div style={{
      position: 'fixed', zIndex: 82, pointerEvents: 'none', top: box.top + box.height / 2, right: `calc(100vw - ${Math.max(box.left - 10, 120)}px)`,
      transform: 'translateY(-50%)', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700, padding: '4px 9px', borderRadius: 6,
      background: strong ? '#d9a441' : 'rgba(255,255,255,.14)', color: strong ? '#1b211d' : '#fff', border: strong ? 'none' : '1px dashed rgba(255,255,255,.7)',
    }}>
      {text} →
    </div>
  );
}

/**
 * Clear the sample pipeline but keep settings (schools, stages, targets), and
 * land on the empty board rather than back on the welcome screen.
 */
async function clearSamples() {
  const tables = [db.opportunities, db.contacts, db.oppContacts, db.referralPaths, db.activities];
  await db.transaction('rw', tables, async () => { for (const t of tables) await t.clear(); });
  await saveSettings({ welcomeDismissed: true });
}

export default function Tour({ view, navigate, onEnd }: {
  view: View;
  navigate: (v: View, anchor?: string) => void;
  onEnd: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [boxes, setBoxes] = useState<{ main: Box | null; also: Box | null }>({ main: null, also: null });
  const startedAt = useRef(Date.now());
  const [cardH, setCardH] = useState(200);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = STEPS[index];

  const opps = useLiveQuery(() => db.opportunities.toArray(), []) ?? [];
  const paths = useLiveQuery(() => db.referralPaths.toArray(), []) ?? [];
  const ctx = useRef<Ctx>({ opps: [], demoPaths: 0, baseline: null });
  const c = ctx.current;
  c.opps = opps;
  // The sample Stripe card (not one the user may have typed themselves during the tour).
  c.demo = opps.find((o) => o.company === DEMO_COMPANY && o.createdAt < startedAt.current);
  c.added = opps.filter((o) => o.createdAt >= startedAt.current).sort((x, y) => y.createdAt - x.createdAt)[0];
  c.demoPaths = paths.filter((p) => p.oppId === c.demo?.id).length;
  const also = step.also?.(c) ?? null;

  const goTo = (id: string) => setIndex(Math.max(0, STEPS.findIndex((s) => s.id === id)));
  const next = () => (index >= STEPS.length - 1 ? onEnd() : setIndex(index + 1));

  // On entering a step: switch screens if needed and note how many opps exist.
  useEffect(() => {
    if (step.view && step.view !== view) navigate(step.view, step.anchor);
    ctx.current.baseline = null;
    let live = true;
    void Promise.all([db.opportunities.count(), db.referralPaths.toArray()]).then(([n, ps]) => {
      if (live) ctx.current.baseline = { opps: n, demoPaths: ps.filter((p) => p.oppId === ctx.current.demo?.id).length };
    });
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
      const extra = step.also?.(ctx.current);
      const a = extra ? measure(extra.target) : null;
      setBoxes((prev) => (same(prev.main, m) && same(prev.also, a) ? prev : { main: m, also: a }));
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
  }, [index, boxes]);

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
  const box = boxes.main;
  const lit = box && boxes.also ? union(box, boxes.also) : box;
  const hole = lit && grow(lit);
  const mainRing = box && grow(box);
  const alsoRing = boxes.also && grow(boxes.also);
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
    if (step.place === 'right' && room.right >= CARD_W + 12) cardStyle = { top: clampY(hole.top), left: hole.left + hole.width + gap };
    else if (room.bottom >= cardH + 12) cardStyle = { top: hole.top + hole.height + gap, left: clampX(hole.left) };
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
          <div style={{ position: 'fixed', zIndex: 81, pointerEvents: 'none', ...mainRing!, borderRadius: 8, boxShadow: '0 0 0 2px #fff, 0 0 0 5px #d9a441' }} />
          {step.label && <Tag box={mainRing!} text={step.label} strong />}
          {/* the "also" item: lit so it can be seen, shielded so it can't be clicked */}
          {alsoRing && also && (
            <>
              <div style={{ position: 'fixed', zIndex: 81, ...alsoRing, borderRadius: 8, border: '2px dashed rgba(255,255,255,.95)' }} />
              <Tag box={alsoRing} text={also.label} />
            </>
          )}
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
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: '#3c453e' }}>{val(step.body, c)}</div>
        {step.art}

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
