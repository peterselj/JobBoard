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
