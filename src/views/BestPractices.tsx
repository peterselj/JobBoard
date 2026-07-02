import { useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveSettings } from '../db';
import { expectedOffers, paceToOffer, stageMap, weeklyMetrics } from '../lib/pipeline';
import { Input, SectionHeader } from '../components/ui';

export default function BestPractices() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <WhatItTakes />
      <PracticesSection />
      <FaqSection />
    </div>
  );
}

// ---------- What it takes (pace calculator) ----------

function WhatItTakes() {
  const opps = useLiveQuery(() => db.opportunities.toArray(), []) ?? [];
  const stages = useLiveQuery(() => db.stages.toArray(), []) ?? [];
  const activities = useLiveQuery(() => db.activities.toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const [weeksRemaining, setWeeksRemaining] = useState(12);

  const stagesById = useMemo(() => stageMap(stages), [stages]);
  const expOffers = expectedOffers(opps, stagesById);
  const weeks = useMemo(() => weeklyMetrics(opps, activities, 8), [opps, activities]);
  const recentPace = weeks.slice(-5, -1).reduce((s, w) => s + w.newOpps, 0) / 4;

  const conversionPct = settings?.assumedOppToOffer ?? 2.5;
  const pace = paceToOffer(expOffers, conversionPct, weeksRemaining);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <SectionHeader title="What it takes" />
      <p className="mb-3 text-sm text-slate-500">
        A job search is a numbers game. This estimates how many opportunities you need to open to carry at least
        one expected offer at your assumed conversion rate.
      </p>
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Offer within (weeks)</span>
          <Input type="number" min={1} value={weeksRemaining} onChange={(e) => setWeeksRemaining(Math.max(1, Number(e.target.value) || 1))} className="!w-24" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">% of opps that close</span>
          <Input
            type="number" min={0.1} step={0.1} value={conversionPct}
            onChange={(e) => saveSettings({ assumedOppToOffer: Math.max(0.1, Number(e.target.value) || 0.1) })}
            className="!w-24"
          />
        </label>
      </div>
      <div className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">
        {pace.oppsNeededTotal === 0 ? (
          <p>Your pipeline already carries ≥ 1 expected offer. Keep advancing what you have.</p>
        ) : (
          <p>
            To carry a full expected offer you need about{' '}
            <span className="font-bold">{pace.oppsNeededTotal} more opportunities</span> — that's{' '}
            <span className="font-bold">{pace.oppsPerWeek < 10 ? pace.oppsPerWeek.toFixed(1) : Math.ceil(pace.oppsPerWeek)} new opps/week</span>{' '}
            for {weeksRemaining} weeks. Your recent pace: {recentPace.toFixed(1)}/week.
          </p>
        )}
      </div>
    </section>
  );
}

// ---------- Best practices ----------

function PracticesSection() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <SectionHeader title="Best practices" />
      <div className="space-y-6">
        <Practice title="Track new openings & apply fast">
          <p>
            Set up notifications so you get pinged the moment the right job is announced — there are outsized
            returns to applying within the first day or two, before the pile of applicants gets deep.
          </p>
          <ul className="ml-4 mt-2 list-disc space-y-1 text-slate-600">
            <li>
              <span className="font-medium text-slate-700">LinkedIn:</span> save a job search with your keywords and
              filters, then set the <span className="font-medium">Job alert</span> toggle to <em>Daily</em> (or
              instant) — alerts arrive by email and in the notifications tab.
            </li>
            <li>
              <span className="font-medium text-slate-700">Glassdoor / Indeed:</span> create a saved search and turn
              on email alerts for new postings that match.
            </li>
            <li>
              <span className="font-medium text-slate-700">Company careers / changelogs:</span> for a short list of
              dream companies, use a page-change watcher (e.g. <span className="font-medium">Visualping</span> or{' '}
              <span className="font-medium">distill.io</span>) on their careers page, or subscribe to their careers
              RSS where offered.
            </li>
            <li>
              <span className="font-medium text-slate-700">Gmail filters:</span> route all of the above into a
              dedicated <span className="font-medium">“Job alerts”</span> label, and filter by keyword (role,
              location, “remote”) so the signal isn't buried. A starred filter for your A-tier companies makes the
              must-act-today ones jump out.
            </li>
          </ul>
        </Practice>

        <Practice title="Templatize your routine comms">
          <p>
            You'll write basically the same warm-referral request every time. Keep a couple of fill-in-the-blank
            templates in a Google Doc and paste-and-tweak rather than starting from scratch. Starters:
          </p>
          <Template>
{`Hi [1st Degree],

Would you mind introducing me to [2nd Degree]? I see you're connected on
LinkedIn. I'd love to learn about the [role] role at [company], because of my
experience working at [past job] doing [past experience]. I'll leave a bit more
about me below the fold.`}
          </Template>
          <p>And, once they offer to help:</p>
          <Template>
{`Hi [2nd Degree],

Thanks so much for offering to help. Are you available for a 20 min chat in any
of these slots?
  - Slot 1
  - Slot 2
  - Slot 3

Like [1st Degree] said, I'm so excited…`}
          </Template>
          <p className="text-slate-600">Store these in a Google Doc for quick reference.</p>
        </Practice>

        <Practice title="Bookmark interesting openings & companies">
          <p>
            Use your browser's bookmarks, your notes app, email yourself — whatever's easiest. Capture interesting
            ideas wherever the friction is lowest, so you can turn them into actionable leads the next time you open
            JobBoard.
          </p>
        </Practice>

        <Practice title="Read “Getting a Job at a Blockbuster”">
          <p>
            A great primer on running a referral-first search.{' '}
            <a
              className="font-medium text-emerald-700 hover:underline"
              href="https://docs.google.com/document/d/1M9ceViOtbRBu2Zh_-3g2bIX_ZCEFtbQUIKSXmc9DdzE/edit?tab=t.0"
              target="_blank"
              rel="noreferrer"
            >
              Read it here ↗
            </a>
          </p>
        </Practice>

        <Practice title="Get a free coaching call from Josh">
          <p>
            Hi! I built this. Email me{' '}
            <a className="font-medium text-emerald-700 hover:underline" href="mailto:josh@joshpetersel.com">
              josh@joshpetersel.com
            </a>{' '}
            if talking things through a bit would help!
          </p>
        </Practice>
      </div>
    </section>
  );
}

function Practice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <div className="mt-1 space-y-2 text-sm leading-relaxed text-slate-600">{children}</div>
    </div>
  );
}

// ---------- FAQ ----------

function FaqSection() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <SectionHeader title="FAQ" />
      <div className="space-y-5">
        <FaqItem q="Why weight the pipeline?">
          Each stage's weight is the realistic chance that an opportunity at that stage becomes an offer. A new
          opp is ~0%; even a final round is only ~33%. Summing the weights of your active opps gives your{' '}
          <span className="font-medium">expected offers</span> — most searches need that sum above 1.0 before an
          offer actually lands. If your number looks small, that's not failure; it's the signal to open more
          opportunities and convert cold ones into referral paths. You can tune every weight (and add your own
          stages) in Settings.
        </FaqItem>
        <FaqItem q="Why referral-first?">
          Referral-first searches convert several times better than portal drops — a referral gets your resume
          read by a human and often skips the screening pile entirely. That's how a 16-week search becomes a
          12-week one, and it's why a cold portal application is weighted at just 0.1% here. The intended loop:
          identify the job → find your person there (or a bridge who can intro you) → get the referral → then apply.
        </FaqItem>
        <FaqItem q="How do inroads work?">
          Open any opportunity and add an inroad for each route to a referral: a 1st-degree contact at the company,
          a 2nd-degree target reached via a connector you know (e.g. Priya → Devon), or an alum from your school.
          Each inroad is a card you drag across the mini-board — Identified → Contacted → In conversation — and into
          <span className="font-medium"> Referred!</span> when they put your name forward (or Dead end if it fizzles).
          Double-click a card to edit contact details and log activity; everything lands on that contact's timeline.
        </FaqItem>
        <FaqItem q="Where does my data live? Will updates erase it?">
          Everything is stored in your own browser (IndexedDB) — nothing is ever uploaded. App updates never touch
          your data; new versions migrate it carefully in place. For extra durability, set up the autosave backup
          file (Settings → Local backup file): the app silently rewrites a JSON file on your computer after every
          change, so even a wiped browser can be restored in one click.
        </FaqItem>
        <FaqItem q="How do I share this with a friend?">
          Send them this site's URL. Data is per-browser, so they automatically get their own private, empty
          workspace — you'll never see each other's pipelines.
        </FaqItem>
      </div>
    </section>
  );
}

function FaqItem({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-800">{q}</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{children}</p>
    </div>
  );
}

function Template({ children }: { children: string }) {
  return (
    <pre className="my-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-sans text-xs leading-relaxed text-slate-700">
      {children}
    </pre>
  );
}
