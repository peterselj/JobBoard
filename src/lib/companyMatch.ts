import type { Contact } from '../db';

const SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'gmbh', 'plc', 'sa', 'ag', 'the', 'group', 'holdings',
]);

/** Normalize a company name for matching: lowercase, strip punctuation and legal suffixes. */
function normalizeCompany(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t && !SUFFIXES.has(t));
  return tokens.join(' ');
}

/** Conservative match: normalized equality, or one is a word-boundary prefix of the other. */
function companiesMatch(a: string, b: string): boolean {
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.startsWith(`${nb} `) || nb.startsWith(`${na} `);
}

/** Find contacts who work (or worked) at the given company — potential warm referral paths. */
export function findWarmPaths(company: string, contacts: Contact[]): Contact[] {
  if (!company.trim()) return [];
  return contacts.filter((c) => c.company && companiesMatch(company, c.company));
}
