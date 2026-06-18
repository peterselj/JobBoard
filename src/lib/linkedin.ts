// ---------- Profile URL parsing ----------

export interface ParsedProfile {
  firstName: string;
  lastName: string;
  linkedinUrl: string;
}

/**
 * Recognize a pasted LinkedIn profile URL (linkedin.com/in/<slug>) and guess a
 * name from the slug. Slugs are usually "first-last" plus optional junk like
 * trailing hex/id segments ("jane-doe-1a2b3c45"), which we drop.
 */
export function parseProfileUrl(text: string): ParsedProfile | null {
  const m = text.trim().match(/(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/in\/([^/?#\s]+)/i);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]);
  const parts = slug
    .split('-')
    .filter((p) => p && !/^\d+$/.test(p) && !(/\d/.test(p) && p.length >= 5));
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const firstName = parts.length ? cap(parts[0]) : slug;
  const lastName = parts.slice(1).map(cap).join(' ');
  return {
    firstName,
    lastName,
    linkedinUrl: `https://www.linkedin.com/in/${m[1]}`,
  };
}

// ---------- Quick-add parsing (URL → draft opp) ----------

/**
 * Domains where the URL's host is the *job board*, not the employer — so we
 * must NOT guess a company name from them (greenhouse.io is not a company).
 * For these we keep the URL and leave company blank to fill at grooming.
 */
export const JOB_BOARD_DOMAINS = new Set([
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com', 'monster.com',
  'dice.com', 'simplyhired.com', 'builtin.com', 'wellfound.com', 'angel.co', 'otta.com',
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'smartrecruiters.com',
  'jobvite.com', 'icims.com', 'taleo.net', 'myworkdayjobs.com', 'workday.com',
  'bamboohr.com', 'breezy.hr', 'recruitee.com', 'teamtailor.com', 'rippling.com',
  'dover.com', 'paylocity.com', 'adp.com', 'successfactors.com', 'jora.com',
  'hiring.cafe', 'hiringcafe.com', 'ashby.com', 'gh.io', 'jobs.io',
]);

function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.');
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

/** Title-case a domain's first label: "stripe.com" → "Stripe". */
function companyFromHost(host: string): string {
  const label = host.toLowerCase().replace(/^www\./, '').split('.')[0];
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : '';
}

export interface QuickAdd {
  company?: string;
  role?: string;
  jobUrl?: string;
}

/**
 * Turn a quick-add string into draft-opp fields. A URL becomes the job link,
 * and — for real company sites only — the company is guessed from the domain.
 * Known job boards (LinkedIn, Greenhouse, Lever, Workday, …) are NOT guessed
 * from; we just keep the URL. Plain text is taken as the company / opp name.
 */
export function parseQuickAdd(input: string): QuickAdd | null {
  const text = input.trim();
  if (!text) return null;
  const m = text.match(/^(?:https?:\/\/)?((?:[\w-]+\.)+[a-z]{2,})(?:[/?#]\S*)?$/i);
  if (m) {
    const host = m[1].toLowerCase().replace(/^www\./, '');
    const jobUrl = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const reg = registrableDomain(host);
    const isBoard =
      JOB_BOARD_DOMAINS.has(host) ||
      JOB_BOARD_DOMAINS.has(reg) ||
      [...JOB_BOARD_DOMAINS].some((d) => host === d || host.endsWith('.' + d));
    return { jobUrl, company: isBoard ? undefined : companyFromHost(host) };
  }
  return { company: text };
}

// ---------- Deep links into LinkedIn's own search (ToS-safe, no scraping) ----------

/** People search at a company. network: 'F' = 1st degree, 'S' = 2nd degree. */
export function peopleSearchUrl(company: string, network?: 'F' | 'S'): string {
  let url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company)}`;
  if (network) url += `&network=${encodeURIComponent(JSON.stringify([network]))}`;
  return url;
}

/**
 * People search filtered to alumni of a school, by LinkedIn's numeric school ID
 * (e.g. 4794 for Georgetown). Unlike the school-page keyword search, this shows
 * the actual people. Users grab the ID once from a filtered search URL — see
 * the instructions in Settings.
 */
export function alumniSearchUrl(schoolId: string, company: string): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company)}&schoolFilter=${encodeURIComponent(JSON.stringify([schoolId]))}`;
}
