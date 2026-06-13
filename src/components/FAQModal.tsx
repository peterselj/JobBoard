import type { ReactNode } from 'react';
import { Modal } from './ui';

export default function FAQModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="FAQ" onClose={onClose} wide>
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
        <FaqItem q="How do referral paths work?">
          On any opportunity, add a path for each route to a referral. A 1st-degree contact at the company is a
          direct target. For a 2nd-degree target, add one row per bridge: the 1st-degree friend who can make the
          intro (e.g. Adrienne → Markus). Then advance each path's status — intro solicited, intro made, chat
          booked, referral made — and it's all logged to the opp's timeline automatically.
        </FaqItem>
        <FaqItem q="Where does my data live? Will updates erase it?">
          Everything is stored in your own browser (IndexedDB) — nothing is ever uploaded. App updates never touch
          your data; new versions migrate it carefully in place. Still, export a backup occasionally
          (Settings → Export backup), especially before clearing browser data or switching machines.
        </FaqItem>
        <FaqItem q="How do I share this with a friend?">
          Send them this site's URL. Data is per-browser, so they automatically get their own private, empty
          workspace — you'll never see each other's pipelines.
        </FaqItem>
        <FaqItem q="Who made this?">
          <a href="mailto:josh@joshpetersel.com" className="font-medium text-emerald-700 hover:underline">
            josh@joshpetersel.com
          </a>
        </FaqItem>
      </div>
    </Modal>
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
