import type { Activity, Opportunity, Stage } from '../db';

export function stageMap(stages: Stage[]): Map<string, Stage> {
  return new Map(stages.map((s) => [s.id, s]));
}

/** Expected number of offers currently in the pipeline: Σ stage-weight over active opps. */
export function expectedOffers(opps: Opportunity[], stagesById: Map<string, Stage>): number {
  return opps.reduce((sum, opp) => {
    const stage = stagesById.get(opp.stageId);
    if (!stage || stage.kind !== 'active') return sum;
    return sum + stage.weight / 100;
  }, 0);
}

/** Probability-weighted compensation (midpoint of range) over active opps with comp data. */
export function weightedComp(opps: Opportunity[], stagesById: Map<string, Stage>): number {
  return opps.reduce((sum, opp) => {
    const stage = stagesById.get(opp.stageId);
    if (!stage || stage.kind !== 'active') return sum;
    const lo = opp.compMin ?? opp.compMax;
    const hi = opp.compMax ?? opp.compMin;
    if (lo == null || hi == null) return sum;
    return sum + ((lo + hi) / 2) * (stage.weight / 100);
  }, 0);
}

// ---------- Weekly metrics ----------

export interface WeekBucket {
  start: number; // ms, Monday 00:00 local
  label: string; // e.g. "Jun 8"
  newOpps: number;
  referralConvos: number;
  applications: number;
  interviews: number;
}

export function weekStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  return d.getTime();
}

function activityTs(a: Activity): number {
  // Activity dates are YYYY-MM-DD; parse at noon local to avoid timezone edge cases.
  const parsed = new Date(`${a.date}T12:00:00`).getTime();
  return Number.isNaN(parsed) ? a.createdAt : parsed;
}

export function weeklyMetrics(
  opps: Opportunity[],
  activities: Activity[],
  numWeeks = 8,
): WeekBucket[] {
  const thisWeek = weekStart(Date.now());
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const buckets: WeekBucket[] = [];
  for (let i = numWeeks - 1; i >= 0; i--) {
    const start = thisWeek - i * WEEK_MS;
    buckets.push({
      start,
      label: new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      newOpps: 0,
      referralConvos: 0,
      applications: 0,
      interviews: 0,
    });
  }
  const firstStart = buckets[0].start;
  const bucketFor = (ts: number): WeekBucket | undefined => {
    if (ts < firstStart) return undefined;
    const idx = Math.floor((ts - firstStart) / WEEK_MS);
    return buckets[idx];
  };

  for (const opp of opps) {
    const b = bucketFor(opp.createdAt);
    if (b) b.newOpps++;
  }
  for (const a of activities) {
    const b = bucketFor(activityTs(a));
    if (!b) continue;
    if (a.type === 'intro-call' || a.type === 'referral-secured') b.referralConvos++;
    else if (a.type === 'applied') b.applications++;
    else if (a.type === 'recruiter-screen' || a.type === 'interview') b.interviews++;
  }
  return buckets;
}

// ---------- Pipeline shape ----------

export interface ShapeIssue {
  severity: 'red' | 'amber';
  title: string;
  detail: string;
}

/**
 * Health checks on the pipeline's *stock* (how many opps sit where). The
 * searcher directly controls New Opp, Referral Convo and Applied w/ Referral;
 * the working rule of thumb is to hold them near 3:1:1 (~15:5:5) — a
 * researched bench of ~15 targets, ~5 referral convos in flight, ~5 live
 * referral applications. Grounding: referred candidates land interviews at
 * ~40–65% vs ~2–8% for cold applies, and coaches advise ~8–12 targeted
 * applications + ~4–5 networking conversations per week off a bench of
 * 15–25 researched companies.
 *
 * Stage-specific checks key off the default stage ids and quietly skip if the
 * user deleted those stages; the volume and lopsidedness checks are generic.
 */
export function pipelineShape(opps: Opportunity[], stagesById: Map<string, Stage>): ShapeIssue[] {
  const active = opps.filter((o) => stagesById.get(o.stageId)?.kind === 'active');
  const count = (stageId: string) => active.filter((o) => o.stageId === stageId).length;
  const has = (id: string) => stagesById.has(id);
  const issues: ShapeIssue[] = [];

  const newOpp = count('new-opp');
  const convo = count('referral-convo');
  const applied = count('applied-referral');
  const cold = count('cold-applied');

  const thinOverall = active.length < 10;
  if (thinOverall) {
    issues.push({
      severity: 'red',
      title: 'Needs more raw opportunities',
      detail: `${active.length} active opp${active.length === 1 ? '' : 's'} in total — most searches need 20+ in motion. Add researched targets to New Opp.`,
    });
  } else {
    // Ratio checks only make sense once there's some volume to balance.
    if (has('new-opp') && newOpp < 12) {
      issues.push({
        severity: newOpp < 5 ? 'red' : 'amber',
        title: 'Top-of-funnel bench is thin',
        detail: `${newOpp} in New Opp — keep ~15 researched targets ready (3 for every referral convo in flight).`,
      });
    }
    if (has('referral-convo') && newOpp >= 6 && convo < 3) {
      issues.push({
        severity: 'amber',
        title: 'Too few referral convos',
        detail: `${convo} convo${convo === 1 ? '' : 's'} in flight off a bench of ${newOpp} — aim for ~5. Pick targets and ask for intros.`,
      });
    }
    if (has('applied-referral') && convo >= 4 && applied < Math.ceil(convo / 2)) {
      issues.push({
        severity: 'amber',
        title: 'Convos aren’t becoming applications',
        detail: `${convo} referral convos but only ${applied} referral application${applied === 1 ? '' : 's'} — ask for the referral, then apply.`,
      });
    }
    const byStage = new Map<string, number>();
    for (const o of active) byStage.set(o.stageId, (byStage.get(o.stageId) ?? 0) + 1);
    for (const [sid, n] of byStage) {
      // A fat New Opp bench is healthy; any other stage hoarding >60% is a clog.
      if (sid !== 'new-opp' && n / active.length > 0.6) {
        issues.push({
          severity: 'amber',
          title: 'Pipeline is lopsided',
          detail: `${Math.round((n / active.length) * 100)}% of your active opps sit in ${stagesById.get(sid)?.name ?? sid} — advance or close some.`,
        });
        break;
      }
    }
  }
  if (has('cold-applied') && cold >= 3 && cold > applied) {
    issues.push({
      severity: 'amber',
      title: 'Cold-apply heavy',
      detail: `${cold} cold applies vs ${applied} with referral — referrals interview at ~40–65% vs ~2–8% cold. Work a path before (or after) applying.`,
    });
  }
  return issues;
}

// ---------- "What it takes" calculator ----------

export interface PaceResult {
  oppsNeededTotal: number; // additional opps needed to reach 1 expected offer
  oppsPerWeek: number;
}

/**
 * How many more opportunities you need to open to carry ≥1 expected offer,
 * assuming `conversionPct` of new opps eventually convert to an offer.
 */
export function paceToOffer(
  currentExpectedOffers: number,
  conversionPct: number,
  weeksRemaining: number,
): PaceResult {
  const conv = Math.max(conversionPct, 0.01) / 100;
  const gap = Math.max(0, 1 - currentExpectedOffers);
  const oppsNeededTotal = Math.ceil(gap / conv);
  const oppsPerWeek = weeksRemaining > 0 ? oppsNeededTotal / weeksRemaining : oppsNeededTotal;
  return { oppsNeededTotal, oppsPerWeek };
}
