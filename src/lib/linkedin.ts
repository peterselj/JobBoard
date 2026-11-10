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
const JOB_BOARD_DOMAINS = new Set([
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
    // A board if the host, its registrable domain, or any parent domain is listed.
    const isBoard =
      JOB_BOARD_DOMAINS.has(registrableDomain(host)) ||
      [...JOB_BOARD_DOMAINS].some((d) => host === d || host.endsWith('.' + d));
    return { jobUrl, company: isBoard ? undefined : companyFromHost(host) };
  }
  return { company: text };
}

// ---------- Deep links into LinkedIn's own search (ToS-safe, no scraping) ----------

/**
 * Keyword fallback: quoted so multi-word names ("Skyroot Aerospace") match as a
 * phrase instead of OR-ing the words. Quoting single words is harmless.
 */
function quotedKeywords(company: string): string {
  return `keywords=${encodeURIComponent(`"${company.trim()}"`)}`;
}

/**
 * What we know about an opp's company on LinkedIn. The more we know, the more
 * precise the Find links get:
 *  - ids  → people search with a currentCompany filter (exact)
 *  - slug → the company page's own People tab, which only ever lists current
 *           employees — so no numeric ID is needed, just the page address
 *  - name only → quoted keyword search (fuzzy: also hits past employers)
 */
export interface CompanyTarget {
  name: string;
  ids?: string[];
  slug?: string;
}

/** Pull the page slug out of a stored company URL (linkedin.com/company/<slug>/). */
export function companySlug(url?: string): string | undefined {
  return (url ?? '').match(/linkedin\.com\/company\/([^/?#\s]+)/i)?.[1];
}

/** True when Find links will show current employees only (not a keyword match). */
export function isExactCompany(co: CompanyTarget): boolean {
  return !!(co.ids?.length || co.slug);
}

/** The company page's People tab — current employees by construction. */
function companyPeopleUrl(slug: string, facets: Record<string, string>): string {
  const q = Object.entries(facets).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `https://www.linkedin.com/company/${slug}/people/${q ? `?${q}` : ''}`;
}

/**
 * People at a company. network: 'F' = 1st degree, 'S' = 2nd degree.
 * See CompanyTarget for the three precision levels.
 */
export function peopleSearchUrl(co: CompanyTarget, network?: 'F' | 'S'): string {
  if (!co.ids?.length && co.slug) return companyPeopleUrl(co.slug, network ? { facetConnection: network === 'F' ? 'ConnectionDegree_FIRST' : 'ConnectionDegree_SECOND' } : {});
  let url = 'https://www.linkedin.com/search/results/people/?';
  url += co.ids?.length
    ? `currentCompany=${encodeURIComponent(JSON.stringify(co.ids))}`
    : quotedKeywords(co.name);
  if (network) url += `&network=${encodeURIComponent(JSON.stringify([network]))}`;
  return url;
}

/**
 * Alumni of a school at a company, by LinkedIn's numeric school ID (e.g. 4794
 * for Georgetown). Users grab the ID once from a filtered search URL — see the
 * instructions in Settings.
 */
export function alumniSearchUrl(schoolId: string, co: CompanyTarget): string {
  if (!co.ids?.length && co.slug) return companyPeopleUrl(co.slug, { facetSchool: schoolId });
  const companyPart = co.ids?.length
    ? `currentCompany=${encodeURIComponent(JSON.stringify(co.ids))}`
    : quotedKeywords(co.name);
  return `https://www.linkedin.com/search/results/people/?${companyPart}&schoolFilter=${encodeURIComponent(JSON.stringify([schoolId]))}`;
}

/** LinkedIn's company search for a name — one click to find the company page. */
export function companyFindUrl(company: string): string {
  return `https://www.linkedin.com/search/results/companies/?${quotedKeywords(company)}`;
}

/** People search showing everyone from one school — a quick "is this the right school?" check. */
export function schoolCheckUrl(schoolId: string): string {
  return `https://www.linkedin.com/search/results/people/?schoolFilter=${encodeURIComponent(JSON.stringify([schoolId]))}`;
}

/**
 * Extract a numeric LinkedIn school ID from user input: either a bare ID
 * ("4794"), a people-search URL containing a schoolFilter (what you get from
 * All filters → School → Show results), or a company People-tab URL containing
 * facetSchool. Returns null if none.
 */
export function parseSchoolId(text: string): string | null {
  const input = text.trim();
  if (!input) return null;
  if (/^\d+$/.test(input)) return input;
  // schoolFilter: people search. facetSchool: a company page's People tab.
  const m = input.match(/[?&](?:schoolFilter|facetSchool)=([^&#\s]+)/i);
  if (!m) return null;
  try {
    let parsed: unknown = decodeURIComponent(m[1]);
    try { parsed = JSON.parse(parsed as string); } catch { parsed = String(parsed).split(','); }
    const first = (Array.isArray(parsed) ? parsed : [parsed]).map(String).find((s) => /^\d+$/.test(s));
    return first ?? null;
  } catch {
    return null;
  }
}

// ---------- Company LinkedIn key ----------

export interface CompanyLinkedin {
  /** Cleaned URL to keep on the opp (company page, or the pasted search URL). */
  url: string;
  /** Numeric currentCompany filter IDs, when the pasted URL contained them. */
  companyIds?: string[];
}

const numericIds = (raw: string): string[] => {
  let v: unknown = decodeURIComponent(raw);
  try { v = JSON.parse(v as string); } catch { /* not JSON: a plain or comma-separated list */ }
  const list = Array.isArray(v) ? v : String(v).split(',');
  return list.map((x) => String(x).trim()).filter((x) => /^\d+$/.test(x));
};

/**
 * Parse a pasted company-LinkedIn string. Any address from the company works:
 *  1. The company page, or any tab of it (linkedin.com/company/<slug>/people/,
 *     /jobs/, …) — the slug is enough for current-employee Find links. If the
 *     address uses the numeric form (/company/12345/), that is the company ID.
 *  2. A people-search URL with a currentCompany filter ("See all X employees")
 *     or a jobs-search URL with f_C — both carry the numeric company IDs.
 */
export function parseCompanyLinkedin(text: string): CompanyLinkedin | null {
  const input = text.trim();
  if (!input) return null;
  const idsMatch = input.match(/[?&](?:currentCompany|f_C)=([^&#\s]+)/i);
  if (idsMatch) {
    try {
      const ids = numericIds(idsMatch[1]);
      if (ids.length) return { url: input, companyIds: ids };
    } catch {
      /* fall through to slug parsing */
    }
  }
  const slug = companySlug(input);
  if (!slug) return null;
  const url = `https://www.linkedin.com/company/${slug}/`;
  return /^\d+$/.test(slug) ? { url, companyIds: [slug] } : { url };
}
