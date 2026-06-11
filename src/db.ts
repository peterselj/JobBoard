import Dexie, { type EntityTable } from 'dexie';

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
  source?: string;
  nextAction?: string;
  nextActionDate?: string; // YYYY-MM-DD
  notes?: string;
  lostReason?: string;
  createdAt: number;
  updatedAt: number;
  stageEnteredAt: number;
  closedAt?: number | null;
}

export type Relationship = '1st' | '2nd' | 'alum' | 'recruiter' | 'friend' | 'other';

export interface Contact {
  id?: number;
  firstName: string;
  lastName: string;
  company?: string;
  title?: string;
  email?: string;
  linkedinUrl?: string;
  relationship: Relationship;
  source: 'linkedin' | 'manual';
  notes?: string;
  connectedOn?: string;
  lastTouchedAt?: number | null;
  createdAt: number;
}

export type OppContactRole = 'target-referrer' | 'referrer' | 'recruiter' | 'interviewer' | 'other';

export interface OppContact {
  id?: number;
  oppId: number;
  contactId: number;
  role: OppContactRole;
}

export type ActivityType =
  | 'outreach'
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
  createdAt: number;
}

export interface Settings {
  id: 'app';
  targets: {
    newOpps: number;
    referralConvos: number;
    applications: number;
    interviews: number;
  };
  staleDays: number;
  assumedOppToOffer: number; // percent: what share of new opps eventually become offers
  schoolSlug: string; // linkedin.com/school/<slug> for alumni search links
}

// ---------- Labels ----------

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  'outreach': 'Outreach sent',
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
  'target-referrer': 'Target referrer',
  'referrer': 'Referrer',
  'recruiter': 'Recruiter',
  'interviewer': 'Interviewer',
  'other': 'Other',
};

// ---------- Defaults ----------

export const DEFAULT_STAGES: Stage[] = [
  { id: 'new-opp', name: 'New Opp', weight: 0, order: 1, kind: 'active' },
  { id: 'cold-applied', name: 'Cold Applied', weight: 0.1, order: 2, kind: 'active' },
  { id: 'referral-convo', name: 'Referral Convo', weight: 2.5, order: 3, kind: 'active' },
  { id: 'applied-referral', name: 'Applied w/ Referral', weight: 5, order: 4, kind: 'active' },
  { id: 'recruiter-screen', name: 'Recruiter Screen', weight: 7.5, order: 5, kind: 'active' },
  { id: 'hiring-manager', name: 'Hiring Manager', weight: 12.5, order: 6, kind: 'active' },
  { id: 'final-round', name: 'Final Round', weight: 33, order: 7, kind: 'active' },
  { id: 'negotiation', name: 'Negotiation', weight: 75, order: 8, kind: 'active' },
  { id: 'won', name: 'Closed Won', weight: 100, order: 9, kind: 'won' },
  { id: 'lost', name: 'Closed Lost', weight: 0, order: 10, kind: 'lost' },
];

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  targets: { newOpps: 15, referralConvos: 5, applications: 10, interviews: 3 },
  staleDays: 7,
  assumedOppToOffer: 2.5,
  schoolSlug: '',
};

// ---------- Database ----------

export const db = new Dexie('jobboard') as Dexie & {
  opportunities: EntityTable<Opportunity, 'id'>;
  contacts: EntityTable<Contact, 'id'>;
  oppContacts: EntityTable<OppContact, 'id'>;
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

export async function createOpportunity(
  data: Partial<Opportunity> & { company: string; role: string },
): Promise<number> {
  const now = Date.now();
  const id = await db.opportunities.add({
    priority: 'B',
    stageId: 'new-opp',
    ...data,
    createdAt: now,
    updatedAt: now,
    stageEnteredAt: now,
  } as Opportunity);
  return id as number;
}

export async function updateOpportunity(id: number, changes: Partial<Opportunity>) {
  await db.opportunities.update(id, { ...changes, updatedAt: Date.now() });
}

export async function moveOppToStage(oppId: number, stageId: string) {
  const [stage, opp] = await Promise.all([db.stages.get(stageId), db.opportunities.get(oppId)]);
  if (!stage || !opp || opp.stageId === stageId) return;
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
    createdAt: now,
  });
}

export async function deleteOpportunity(oppId: number) {
  await db.transaction('rw', [db.opportunities, db.activities, db.oppContacts], async () => {
    await db.activities.where('oppId').equals(oppId).delete();
    await db.oppContacts.where('oppId').equals(oppId).delete();
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
  await db.transaction('rw', [db.contacts, db.oppContacts, db.activities], async () => {
    await db.oppContacts.where('contactId').equals(contactId).delete();
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

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('app')) ?? DEFAULT_SETTINGS;
}

export async function saveSettings(changes: Partial<Settings>) {
  const current = await getSettings();
  await db.settings.put({ ...current, ...changes, id: 'app' });
}
