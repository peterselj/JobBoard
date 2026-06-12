import { db, today, type Activity, type Contact, type Opportunity, type OppContact, type ReferralPath } from '../db';

const DAY = 24 * 3600 * 1000;

function dateStr(daysBack: number): string {
  const d = new Date(Date.now() - daysBack * DAY);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Load a demo pipeline so the app's features are visible immediately. Adds on top of existing data. */
export async function loadSampleData() {
  const now = Date.now();

  const contacts: Contact[] = [
    { firstName: 'Maya', lastName: 'Chen', company: 'Datadog', title: 'Senior PM', relationship: '1st', source: 'manual', linkedinUrl: 'https://www.linkedin.com/in/sample-maya', lastTouchedAt: now - 2 * DAY, createdAt: now - 40 * DAY },
    { firstName: 'Jordan', lastName: 'Okafor', company: 'Figma', title: 'Engineering Manager', relationship: 'alum', source: 'manual', linkedinUrl: 'https://www.linkedin.com/in/sample-jordan', lastTouchedAt: now - 9 * DAY, createdAt: now - 35 * DAY },
    { firstName: 'Priya', lastName: 'Raman', company: 'Stripe', title: 'Staff Engineer', relationship: '2nd', source: 'manual', linkedinUrl: 'https://www.linkedin.com/in/sample-priya', createdAt: now - 30 * DAY },
    { firstName: 'Sam', lastName: 'Whitfield', company: 'Notion', title: 'Recruiter', relationship: 'recruiter', source: 'manual', lastTouchedAt: now - 5 * DAY, createdAt: now - 28 * DAY },
    { firstName: 'Alex', lastName: 'Gutierrez', company: 'Linear', title: 'Product Lead', relationship: 'friend', source: 'manual', lastTouchedAt: now - 1 * DAY, createdAt: now - 25 * DAY },
    { firstName: 'Dana', lastName: 'Kim', company: 'Vercel', title: 'Solutions Engineer', relationship: '1st', source: 'manual', createdAt: now - 20 * DAY },
  ];
  const contactIds = (await db.contacts.bulkAdd(contacts, { allKeys: true })) as number[];
  const [maya, jordan, priya, sam, alex] = contactIds;

  const opps: Opportunity[] = [
    { company: 'Stripe', role: 'Product Manager, Payments', stageId: 'new-opp', priority: 'A', source: 'Job board', jobUrl: 'https://stripe.com/jobs', compMin: 180000, compMax: 220000, nextAction: 'Ask Priya for an intro call', nextActionDate: dateStr(-2), createdAt: now - 3 * DAY, updatedAt: now - 3 * DAY, stageEnteredAt: now - 3 * DAY },
    { company: 'Vercel', role: 'Senior PM, Platform', stageId: 'cold-applied', priority: 'C', source: 'Company site', createdAt: now - 12 * DAY, updatedAt: now - 12 * DAY, stageEnteredAt: now - 11 * DAY, notes: 'Applied via portal before finding a referral path. Dana works here!' },
    { company: 'Figma', role: 'Product Manager, Growth', stageId: 'referral-convo', priority: 'A', source: 'Alumni network', compMin: 170000, compMax: 200000, nextAction: 'Send Jordan my tailored resume', nextActionDate: dateStr(0), createdAt: now - 10 * DAY, updatedAt: now - 2 * DAY, stageEnteredAt: now - 4 * DAY },
    { company: 'Datadog', role: 'Senior Product Manager', stageId: 'applied-referral', priority: 'B', source: 'Referral', compMin: 160000, compMax: 190000, nextAction: 'Follow up with recruiter', nextActionDate: dateStr(-1), createdAt: now - 18 * DAY, updatedAt: now - 6 * DAY, stageEnteredAt: now - 7 * DAY },
    { company: 'Notion', role: 'Product Manager, AI', stageId: 'recruiter-screen', priority: 'A', source: 'Recruiter outreach', compMin: 175000, compMax: 210000, nextAction: 'Prep for recruiter screen Thursday', nextActionDate: dateStr(-3), createdAt: now - 21 * DAY, updatedAt: now - 5 * DAY, stageEnteredAt: now - 5 * DAY },
    { company: 'Linear', role: 'Product Lead', stageId: 'hiring-manager', priority: 'A', source: 'Friend referral', compMin: 190000, compMax: 230000, nextAction: 'Send HM thank-you + case study', nextActionDate: dateStr(0), createdAt: now - 28 * DAY, updatedAt: now - 1 * DAY, stageEnteredAt: now - 2 * DAY },
    { company: 'Duolingo', role: 'Senior PM, Learning', stageId: 'final-round', priority: 'B', source: 'Job board', compMin: 165000, compMax: 195000, nextAction: 'Final round panel prep', nextActionDate: dateStr(-1), createdAt: now - 35 * DAY, updatedAt: now - 1 * DAY, stageEnteredAt: now - 3 * DAY },
    { company: 'Anthropic', role: 'Product Manager', stageId: 'lost', priority: 'B', source: 'Company site', lostReason: 'Role filled internally', createdAt: now - 45 * DAY, updatedAt: now - 14 * DAY, stageEnteredAt: now - 14 * DAY, closedAt: now - 14 * DAY },
  ];
  const oppIds = (await db.opportunities.bulkAdd(opps, { allKeys: true })) as number[];
  const [stripe, , figma, datadog, notion, linear, duolingo] = oppIds;

  const links: OppContact[] = [
    { oppId: notion, contactId: sam, role: 'recruiter' },
  ];
  await db.oppContacts.bulkAdd(links);

  const paths: ReferralPath[] = [
    // 2nd-degree chain: Maya (1st) bridges to Priya (2nd) at Stripe
    { oppId: stripe, targetContactId: priya, viaContactId: maya, status: 'intro-solicited', createdAt: now - 2 * DAY, updatedAt: now - 1 * DAY },
    { oppId: figma, targetContactId: jordan, viaContactId: null, status: 'chat-booked', createdAt: now - 9 * DAY, updatedAt: now - 4 * DAY },
    { oppId: datadog, targetContactId: maya, viaContactId: null, status: 'referral-made', createdAt: now - 14 * DAY, updatedAt: now - 8 * DAY },
    { oppId: linear, targetContactId: alex, viaContactId: null, status: 'referral-made', createdAt: now - 17 * DAY, updatedAt: now - 16 * DAY },
  ];
  await db.referralPaths.bulkAdd(paths);

  const acts: Activity[] = [
    { oppId: figma, contactId: jordan, type: 'outreach', date: dateStr(9), notes: 'Pinged Jordan on LinkedIn about the Growth PM role', createdAt: now - 9 * DAY },
    { oppId: figma, contactId: jordan, type: 'intro-call', date: dateStr(4), notes: '20-min call; happy to refer once resume is tailored', createdAt: now - 4 * DAY },
    { oppId: datadog, contactId: maya, type: 'intro-call', date: dateStr(13), notes: 'Maya walked me through the org', createdAt: now - 13 * DAY },
    { oppId: datadog, contactId: maya, type: 'referral-secured', date: dateStr(8), notes: 'Maya submitted the referral', createdAt: now - 8 * DAY },
    { oppId: datadog, type: 'applied', date: dateStr(7), notes: 'Applied with referral code', createdAt: now - 7 * DAY },
    { oppId: notion, contactId: sam, type: 'recruiter-screen', date: dateStr(5), notes: '30 min with Sam; JD walkthrough', createdAt: now - 5 * DAY },
    { oppId: linear, contactId: alex, type: 'referral-secured', date: dateStr(16), createdAt: now - 16 * DAY },
    { oppId: linear, type: 'applied', date: dateStr(15), createdAt: now - 15 * DAY },
    { oppId: linear, type: 'recruiter-screen', date: dateStr(9), createdAt: now - 9 * DAY },
    { oppId: linear, type: 'interview', date: dateStr(2), notes: 'Hiring manager round — went well', createdAt: now - 2 * DAY },
    { oppId: duolingo, type: 'applied', date: dateStr(30), createdAt: now - 30 * DAY },
    { oppId: duolingo, type: 'recruiter-screen', date: dateStr(22), createdAt: now - 22 * DAY },
    { oppId: duolingo, type: 'interview', date: dateStr(10), notes: 'Product sense round', createdAt: now - 10 * DAY },
    { oppId: duolingo, type: 'interview', date: dateStr(3), notes: 'Onsite scheduled', createdAt: now - 3 * DAY },
    { contactId: alex, type: 'follow-up', date: dateStr(1), notes: 'Coffee catch-up', createdAt: now - 1 * DAY },
    { type: 'note', date: today(), notes: 'Weekly review: need more top-of-funnel this week', createdAt: now },
  ];
  await db.activities.bulkAdd(acts);
}
