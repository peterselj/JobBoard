import type { Activity, Opportunity, Stage } from '../db';

export function stageMap(stages: Stage[]): Map<string, Stage> {
  return new Map(stages.map((s) => [s.id, s]));
}

export function isActiveOpp(opp: Opportunity, stagesById: Map<string, Stage>): boolean {
  return stagesById.get(opp.stageId)?.kind === 'active';
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
