import Dexie, { type EntityTable } from 'dexie';
import { parseQuickAdd } from './lib/linkedin';

// ---------- Types ----------

export type StageKind = 'active' | 'won' | 'lost';

export interface Stage {
  id: string;
  name: string;
  weight: number; // percent, 0–100 (e.g. 2.5)
  order: number;
  kind: StageKind;
}

export type Priority = 'A' | 'B' | 'C';

export interface Opportunity {
  id?: number;
  company: string;
  role: string;
  jobUrl?: string;
  location?: string;
  compMin?: number | null;
  compMax?: number | null;
  stageId: string;
  priority: Priority;
  notes?: string;
  lostReason?: string;
  createdAt: number;
  updatedAt: number;
  stageEnteredAt: number;
  closedAt?: number | null;
  // When set to a future timestamp, the opp is "snoozed" from hygiene nudges
  // (stale / old) until then — bumped a week by the "Looks good" action.
  hygieneSnoozedUntil?: number | null;
  // A quick-add stub awaiting grooming. Excluded from active-opp counts and
  // Expected Offers until fleshed out (company/role filled in).
  draft?: boolean;
}

export type Relationship = '1st' | '2nd' | 'alum' | 'recruiter' | 'friend' | 'other';

export interface Contact {
  id?: number;
  firstName: string;
  lastName: string;
  company?: string;
  title?: string;
  email?: string;
  phone?: string;
  other?: string; // freeform "how to reach / context" line
  linkedinUrl?: string;
  relationship: Relationship;
  source: 'linkedin' | 'manual';
  notes?: string;
  connectedOn?: string;
  lastTouchedAt?: number | null;
  createdAt: number;
}

export type OppContactRole = 'recruiter' | 'interviewer' | 'other';

export interface OppContact {
  id?: number;
  oppId: number;
  contactId: number;
  role: OppContactRole;
}

/**
 * A referral path into an opportunity: the target referrer (often a 2nd-degree
 * contact at the company), optionally reached via a 1st-degree bridge contact
 * who can make the intro. A direct 1st-degree target has no bridge.
 */
export type PathStatus =
  | 'identified'
  | 'referral-solicited'
  | 'chat-booked'
  | 'referral-made'
  | 'dead-end';

export interface ReferralPath {
  id?: number;
  oppId: number;
  targetContactId: number;
  viaContactId?: number | null;
  status: PathStatus;
  createdAt: number;
  updatedAt: number;
}

export type ActivityType =
  | 'outreach'
  | 'intro-solicited'
  | 'intro-made'
  | 'chat-booked'
  | 'intro-call'
  | 'referral-secured'
  | 'applied'
  | 'recruiter-screen'
  | 'interview'
  | 'follow-up'
  | 'offer'
  | 'stage-change'
  | 'note';

export interface Activity {
  id?: number;
  oppId?: number | null;
  contactId?: number | null;
  type: ActivityType;
  date: string; // YYYY-MM-DD
  notes?: string;
  // For stage-change activities: which stage the opp moved into. Lets the
  // weekly tracker count opps reaching the referral / application stages.
  stageId?: string;
  createdAt: number;
}

export interface School {
  name: string;
  id: string; // LinkedIn's numeric school ID, used in people-search schoolFilter
}

export interface Settings {
  id: 'app';
  targets: {
    newOpps: number;
    referralConvos: number;
    applications: number;
  };
  staleDays: number;
  assumedOppToOffer: number; // percent: what share of new opps eventually become offers
  schools: School[];
}

// ---------- Labels ----------

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  'outreach': 'Outreach sent',
  'intro-solicited': 'Referral solicited',
  'intro-made': 'Intro made',
  'chat-booked': 'Chat booked',
  'intro-call': 'Referral convo / intro call',
  'referral-secured': 'Referral secured',
  'applied': 'Applied',
  'recruiter-screen': 'Recruiter screen',
  'interview': 'Interview round',
  'follow-up': 'Follow-up',
  'offer': 'Offer received',
  'stage-change': 'Stage change',
  'note': 'Note',
};

export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  '1st': '1st degree',
  '2nd': '2nd degree',
  'alum': 'Alum',
  'recruiter': 'Recruiter',
  'friend': 'Friend',
  'other': 'Other',
};

export const OPP_CONTACT_ROLE_LABELS: Record<OppContactRole, string> = {
  'recruiter': 'Recruiter',
  'interviewer': 'Interviewer',
  'other': 'Other',
};

export const PATH_STATUS_LABELS: Record<PathStatus, string> = {
  'identified': 'Identified',
  'referral-solicited': 'Referral solicited',
  'chat-booked': 'Chat booked',
  'referral-made': 'Referral made ✓',
  'dead-end': 'Dead end',
};

// The advanceable steps of a path, in order. "identified" is the starting
// point (no step reached yet); "dead-end" is handled separately.
export const PATH_PROGRESS: PathStatus[] = [
  'identified', 'referral-solicited', 'chat-booked', 'referral-made',
];

// ---------- Defaults ----------

export const DEFAULT_STAGES: Stage[] = [
  { id: 'new-opp', name: 'New Opp', weight: 0, order: 1, kind: 'active' },
  { id: 'cold-applied', name: 'Cold Applied', weight: 0.1, order: 2, kind: 'active' },
  { id: 'source-connection', name: 'Source Connection', weight: 1, order: 3, kind: 'active' },
  { id: 'referral-convo', name: 'Referral Convo', weight: 2.5, order: 4, kind: 'active' },
  { id: 'applied-referral', name: 'Applied w/ Referral', weight: 5, order: 5, kind: 'active' },
  { id: 'recruiter-screen', name: 'Recruiter Screen', weight: 7.5, order: 6, kind: 'active' },
  { id: 'hiring-manager', name: 'Hiring Manager', weight: 12.5, order: 7, kind: 'active' },
  { id: 'final-round', name: 'Final Round', weight: 33, order: 8, kind: 'active' },
  { id: 'negotiation', name: 'Negotiation', weight: 75, order: 9, kind: 'active' },
  { id: 'won', name: 'Closed Won', weight: 100, order: 10, kind: 'won' },
  { id: 'lost', name: 'Closed Lost', weight: 0, order: 11, kind: 'lost' },
];

// Inserts the Source Connection stage (v0.7) into an existing pipeline if it's
// missing, shifting later stages down one. Shared by the live-DB migration and
// the backup importer so existing users and restored backups both get it.
export async function ensureSourceConnectionStage(stages: {
  get: (id: string) => Promise<Stage | undefined>;
  toArray: () => Promise<Stage[]>;
  update: (id: string, changes: Partial<Stage>) => Promise<unknown>;
  add: (row: Stage) => Promise<unknown>;
}) {
  if (await stages.get('source-connection')) return;
  const cold = await stages.get('cold-applied');
  const insertOrder = (cold?.order ?? 2) + 1;
  for (const s of await stages.toArray()) {
    if (s.order >= insertOrder) await stages.update(s.id, { order: s.order + 1 });
  }
  await stages.add({ id: 'source-connection', name: 'Source Connection', weight: 1, order: insertOrder, kind: 'active' });
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  targets: { newOpps: 10, referralConvos: 5, applications: 5 },
  staleDays: 7,
  assumedOppToOffer: 2.5,
  schools: [],
};

// ---------- Database ----------

export const db = new Dexie('jobboard') as Dexie & {
  opportunities: EntityTable<Opportunity, 'id'>;
  contacts: EntityTable<Contact, 'id'>;
  oppContacts: EntityTable<OppContact, 'id'>;
  referralPaths: EntityTable<ReferralPath, 'id'>;
  activities: EntityTable<Activity, 'id'>;
  stages: EntityTable<Stage, 'id'>;
  settings: EntityTable<Settings, 'id'>;
};

db.version(1).stores({
  opportunities: '++id, company, stageId, priority, updatedAt, nextActionDate',
  contacts: '++id, company, lastName, linkedinUrl, relationship',
  oppContacts: '++id, oppId, contactId, [oppId+contactId]',
  activities: '++id, oppId, contactId, date, type, createdAt',
  stages: 'id, order',
  settings: 'id',
});

// v0.2: referral paths (bridge → target chains). Existing referral-ish contact
// links are converted in place; user data is never dropped.
db.version(2)
  .stores({
    referralPaths: '++id, oppId, targetContactId, viaContactId',
  })
  .upgrade(async (tx) => {
    const links = await tx.table('oppContacts').toArray();
    const now = Date.now();
    for (const link of links) {
      const role = link.role as string;
      if (role === 'target-referrer' || role === 'referrer') {
        await tx.table('referralPaths').add({
          oppId: link.oppId,
          targetContactId: link.contactId,
          viaContactId: null,
          status: role === 'referrer' ? 'referral-made' : 'identified',
          createdAt: now,
          updatedAt: now,
        });
        await tx.table('oppContacts').delete(link.id);
      }
    }
  });

// v0.6: referral-path timeline collapses "intro solicited" / "intro made" into
// a single "referral solicited" step. Remap existing paths in place.
db.version(3).upgrade(async (tx) => {
  const paths = await tx.table('referralPaths').toArray();
  for (const p of paths) {
    if (p.status === 'intro-solicited' || p.status === 'intro-made') {
      await tx.table('referralPaths').update(p.id, { status: 'referral-solicited' });
    }
  }
});

// v0.7: insert the Source Connection stage ("who can intro me") between Cold
// Applied and Referral Convo for existing pipelines.
db.version(4).upgrade(async (tx) => {
  await ensureSourceConnectionStage(tx.table('stages') as never);
});

db.on('populate', (tx) => {
  tx.table('stages').bulkAdd(DEFAULT_STAGES);
  tx.table('settings').add(DEFAULT_SETTINGS);
});

// ---------- Mutations ----------

export function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export async function createOpportunity(data: Partial<Opportunity> = {}): Promise<number> {
  const now = Date.now();
  // company/role default to empty — they're no longer required, so quick-add
  // drafts (and partially-known opps) can be saved and groomed later.
  const id = await db.opportunities.add({
    company: '',
    role: '',
    priority: 'B',
    stageId: 'new-opp',
    ...data,
    createdAt: now,
    updatedAt: now,
    stageEnteredAt: now,
  } as Opportunity);
  return id as number;
}

/**
 * Create a draft opp from a quick-add string (pasted URL or typed name).
 * Lands in New Opp, flagged `draft` for grooming. Returns null for empty input.
 */
export async function createDraftOpp(input: string): Promise<number | null> {
  const parsed = parseQuickAdd(input);
  if (!parsed) return null;
  return createOpportunity({
    company: parsed.company ?? '',
    role: parsed.role ?? '',
    jobUrl: parsed.jobUrl,
    stageId: 'new-opp',
    priority: 'B',
    draft: true,
  });
}

export async function updateOpportunity(id: number, changes: Partial<Opportunity>) {
  await db.opportunities.update(id, { ...changes, updatedAt: Date.now() });
}

export async function moveOppToStage(oppId: number, stageId: string) {
  const [stage, opp] = await Promise.all([db.stages.get(stageId), db.opportunities.get(oppId)]);
  if (!stage || !opp || opp.stageId === stageId) return;
  const fromStage = await db.stages.get(opp.stageId);
  // Only a *forward* move (advancing the funnel) counts toward weekly targets;
  // tagging stageId is what the weekly tracker keys off. Moving an opp backward
  // still logs the change for the timeline but must not let you run up the bars.
  const forward = !fromStage || stage.order > fromStage.order;
  const now = Date.now();
  await db.opportunities.update(oppId, {
    stageId,
    stageEnteredAt: now,
    updatedAt: now,
    closedAt: stage.kind === 'active' ? null : now,
  });
  await db.activities.add({
    oppId,
    type: 'stage-change',
    date: today(),
    notes: `Moved to ${stage.name}`,
    stageId: forward ? stageId : undefined,
    createdAt: now,
  });
}

/** Snooze hygiene nudges (stale / old) for this opp by a week — "Looks good". */
export async function snoozeHygiene(oppId: number, days = 7) {
  await db.opportunities.update(oppId, {
    hygieneSnoozedUntil: Date.now() + days * 24 * 3600 * 1000,
  });
}

export async function deleteOpportunity(oppId: number) {
  await db.transaction('rw', [db.opportunities, db.activities, db.oppContacts, db.referralPaths], async () => {
    await db.activities.where('oppId').equals(oppId).delete();
    await db.oppContacts.where('oppId').equals(oppId).delete();
    await db.referralPaths.where('oppId').equals(oppId).delete();
    await db.opportunities.delete(oppId);
  });
}

export async function createContact(
  data: Partial<Contact> & { firstName: string; lastName: string },
): Promise<number> {
  const id = await db.contacts.add({
    relationship: '1st',
    source: 'manual',
    ...data,
    createdAt: Date.now(),
  } as Contact);
  return id as number;
}

export async function deleteContact(contactId: number) {
  await db.transaction('rw', [db.contacts, db.oppContacts, db.activities, db.referralPaths], async () => {
    await db.oppContacts.where('contactId').equals(contactId).delete();
    await db.referralPaths.where('targetContactId').equals(contactId).delete();
    await db.referralPaths.where('viaContactId').equals(contactId).modify({ viaContactId: null });
    await db.activities.where('contactId').equals(contactId).modify({ contactId: null });
    await db.contacts.delete(contactId);
  });
}

export async function logActivity(data: {
  oppId?: number | null;
  contactId?: number | null;
  type: ActivityType;
  date?: string;
  notes?: string;
}) {
  const now = Date.now();
  await db.activities.add({
    oppId: data.oppId ?? null,
    contactId: data.contactId ?? null,
    type: data.type,
    date: data.date || today(),
    notes: data.notes,
    createdAt: now,
  });
  if (data.oppId) await db.opportunities.update(data.oppId, { updatedAt: now });
  if (data.contactId) await db.contacts.update(data.contactId, { lastTouchedAt: now });
}

export async function linkContactToOpp(oppId: number, contactId: number, role: OppContactRole) {
  const existing = await db.oppContacts.where('[oppId+contactId]').equals([oppId, contactId]).first();
  if (existing) {
    await db.oppContacts.update(existing.id!, { role });
  } else {
    await db.oppContacts.add({ oppId, contactId, role });
  }
}

export async function addReferralPath(
  oppId: number,
  targetContactId: number,
  viaContactId?: number | null,
) {
  const existing = await db.referralPaths.where('oppId').equals(oppId).toArray();
  const via = viaContactId ?? null;
  if (existing.some((p) => p.targetContactId === targetContactId && (p.viaContactId ?? null) === via)) return;
  const now = Date.now();
  await db.referralPaths.add({
    oppId,
    targetContactId,
    viaContactId: via,
    status: 'identified',
    createdAt: now,
    updatedAt: now,
  });
  await db.opportunities.update(oppId, { updatedAt: now });
}

export async function updateReferralPathStatus(pathId: number, status: PathStatus) {
  const path = await db.referralPaths.get(pathId);
  if (!path || path.status === status) return;
  const now = Date.now();
  await db.referralPaths.update(pathId, { status, updatedAt: now });
  const [target, via] = await Promise.all([
    db.contacts.get(path.targetContactId),
    path.viaContactId ? db.contacts.get(path.viaContactId) : Promise.resolve(undefined),
  ]);
  const tName = target ? `${target.firstName} ${target.lastName}`.trim() : 'target';
  const vName = via ? `${via.firstName} ${via.lastName}`.trim() : null;
  const log: Partial<Record<PathStatus, { type: ActivityType; note: string }>> = {
    'referral-solicited': {
      type: 'intro-solicited',
      note: vName ? `Asked ${vName} for a referral to ${tName}` : `Asked ${tName} for a referral`,
    },
    'chat-booked': { type: 'chat-booked', note: `Chat booked with ${tName}` },
    'referral-made': { type: 'referral-secured', note: `Referral secured from ${tName}` },
    'dead-end': {
      type: 'note',
      note: `Referral path ${vName ? `via ${vName} ` : ''}to ${tName} hit a dead end`,
    },
  };
  const entry = log[status];
  if (entry) {
    await logActivity({
      oppId: path.oppId,
      contactId: status === 'referral-solicited' && via ? via.id : target?.id,
      type: entry.type,
      notes: entry.note,
    });
  } else {
    await db.opportunities.update(path.oppId, { updatedAt: now });
  }
}

export async function getSettings(): Promise<Settings> {
  const stored = await db.settings.get('app');
  // Merge with defaults so records written by older app versions stay valid.
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    id: 'app',
    targets: { ...DEFAULT_SETTINGS.targets, ...stored?.targets },
    schools: stored?.schools ?? [],
  };
}

export async function saveSettings(changes: Partial<Settings>) {
  const current = await getSettings();
  await db.settings.put({ ...current, ...changes, id: 'app' });
}
