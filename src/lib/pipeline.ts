import type { Activity, Opportunity, Stage } from '../db';
import { daysAgo } from './format';

export function stageMap(stages: Stage[]): Map<string, Stage> {
  return new Map(stages.map((s) => [s.id, s]));
}

/** Healthy number of active opportunities to keep in motion. */
export const ACTIVE_OPP_GOAL = 15;

/** Active = in an active stage and not a draft (ungroomed quick-adds don't count). */
export function isLiveActive(opp: Opportunity, stagesById: Map<string, Stage>): boolean {
  return !opp.draft && stagesById.get(opp.stageId)?.kind === 'active';
}

/** Expected number of offers currently in the pipeline: Σ stage-weight over active opps. */
export function expectedOffers(opps: Opportunity[], stagesById: Map<string, Stage>): number {
  return opps.reduce((sum, opp) => {
    const stage = stagesById.get(opp.stageId);
    if (!stage || stage.kind !== 'active' || opp.draft) return sum;
    return sum + stage.weight / 100;
  }, 0);
}

// ---------- Weekly metrics ----------

export interface WeekBucket {
  start: number; // ms, Monday 00:00 local
  label: string; // e.g. "Jun 8"
  newOpps: number;
  referralConvos: number;
  applications: number;
}

function weekStart(ts: number): number {
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
  // Track distinct opps per week so a stage move *and* a hand-logged activity
  // for the same opp in the same week count once, not twice.
  const convoKeys: Set<string>[] = [];
  const appKeys: Set<string>[] = [];
  const buckets: WeekBucket[] = [];
  for (let i = numWeeks - 1; i >= 0; i--) {
    const start = thisWeek - i * WEEK_MS;
    buckets.push({
      start,
      label: new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      newOpps: 0,
      referralConvos: 0,
      applications: 0,
    });
    convoKeys.push(new Set());
    appKeys.push(new Set());
  }
  const firstStart = buckets[0].start;
  const indexFor = (ts: number): number => {
    if (ts < firstStart) return -1;
    const idx = Math.floor((ts - firstStart) / WEEK_MS);
    return idx < buckets.length ? idx : -1;
  };

  for (const opp of opps) {
    const i = indexFor(opp.createdAt);
    if (i >= 0) buckets[i].newOpps++;
  }
  for (const a of activities) {
    const i = indexFor(activityTs(a));
    if (i < 0) continue;
    const key = a.oppId != null ? `o${a.oppId}` : `a${a.id}`;
    // A "referral convo" = a logged intro call / secured referral, OR an opp
    // entering the Referral Convo stage. An "application" = a logged apply, OR
    // an opp entering an applied stage (warm or cold).
    const isConvo =
      a.type === 'intro-call' ||
      a.type === 'referral-secured' ||
      (a.type === 'stage-change' && a.stageId === 'referral-convo');
    const isApp =
      a.type === 'applied' ||
      (a.type === 'stage-change' && (a.stageId === 'applied-referral' || a.stageId === 'cold-applied'));
    if (isConvo) convoKeys[i].add(key);
    if (isApp) appKeys[i].add(key);
  }
  for (let i = 0; i < buckets.length; i++) {
    buckets[i].referralConvos = convoKeys[i].size;
    buckets[i].applications = appKeys[i].size;
  }
  return buckets;
}

// ---------- Hygiene ----------

/** Opps left untouched this long (days in current stage / no activity) get nudged. */
const HYGIENE_OLD_DAYS = 40;

export interface HygieneFlag {
  stale: boolean; // no activity for staleDays+
  old: boolean; // 40+ days in the pipeline
  snoozed: boolean; // "looks good" pressed recently
  snoozedUntil: number | null;
  needsAttention: boolean; // (stale || old) && !snoozed
}

export function hygieneFor(opp: Opportunity, staleDays: number): HygieneFlag {
  const snoozedUntil = opp.hygieneSnoozedUntil ?? null;
  const snoozed = snoozedUntil != null && snoozedUntil > Date.now();
  const stale = daysAgo(opp.updatedAt) >= staleDays;
  const old = daysAgo(opp.createdAt) >= HYGIENE_OLD_DAYS;
  return { stale, old, snoozed, snoozedUntil, needsAttention: (stale || old) && !snoozed };
}

// ---------- Pipeline shape ----------

export interface ShapeIssue {
  severity: 'red' | 'amber';
  title: string;
  detail: string;
}

/**
 * Whether the *shape* of the working pipeline is balanced. The searcher
 * directly controls New Opp, Referral Convo and Applied w/ Referral; the rule
 * of thumb is to hold them near 3 : 1 : 1 — a researched bench of targets, a
 * third of that many referral convos in flight, and roughly as many warm
 * applications. (Raw volume is checked separately.) Grounding: referred
 * candidates land interviews at ~40–65% vs ~2–8% for cold applies.
 *
 * Stage-specific checks key off the default stage ids and quietly skip if the
 * user deleted those stages.
 */
export function pipelineShape(opps: Opportunity[], stagesById: Map<string, Stage>): ShapeIssue[] {
  const active = opps.filter((o) => isLiveActive(o, stagesById));
  const count = (stageId: string) => active.filter((o) => o.stageId === stageId).length;
  const has = (id: string) => stagesById.has(id);
  const issues: ShapeIssue[] = [];

  const newOpp = count('new-opp');
  const convo = count('referral-convo');
  const applied = count('applied-referral');
  const cold = count('cold-applied');

  // Top of funnel should run ~3× the referral convos in flight.
  if (has('new-opp') && convo > 0 && newOpp < convo * 3) {
    issues.push({
      severity: newOpp < convo ? 'red' : 'amber',
      title: 'New Opp bench underweight',
      detail: `${newOpp} in New Opp behind ${convo} referral convo${convo === 1 ? '' : 's'} — aim ~3:1 (about ${convo * 3}). Add new opps.`,
    });
  }
  // Convos should run ~⅓ of the bench — too few means you're not asking for intros.
  if (has('referral-convo') && newOpp >= 6 && convo < Math.round(newOpp / 3)) {
    issues.push({
      severity: 'amber',
      title: 'Too few referral convos',
      detail: `${convo} convo${convo === 1 ? '' : 's'} off ${newOpp} in New Opp — start intros to reach ~${Math.round(newOpp / 3)} (1 per 3 targets).`,
    });
  }
  // Convos should convert to warm applies at roughly 1:1.
  if (has('applied-referral') && convo >= 3 && applied < Math.ceil(convo / 2)) {
    issues.push({
      severity: 'amber',
      title: 'Convos aren’t becoming warm applies',
      detail: `${convo} referral convos but ${applied} warm application${applied === 1 ? '' : 's'} — once the referral’s in, apply. Aim ~1:1.`,
    });
  }
  // Any non-New-Opp active stage hoarding >60% of the pipeline is a clog.
  const byStage = new Map<string, number>();
  for (const o of active) byStage.set(o.stageId, (byStage.get(o.stageId) ?? 0) + 1);
  for (const [sid, n] of byStage) {
    if (sid !== 'new-opp' && active.length >= 5 && n / active.length > 0.6) {
      issues.push({
        severity: 'amber',
        title: 'Pipeline is lopsided',
        detail: `${Math.round((n / active.length) * 100)}% of active opps sit in ${stagesById.get(sid)?.name ?? sid} — advance or close some.`,
      });
      break;
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
