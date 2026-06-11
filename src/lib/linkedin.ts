import Papa from 'papaparse';
import { db, type Contact } from '../db';

/**
 * LinkedIn lets every user export their own connections as CSV:
 * Settings & Privacy → Data privacy → Get a copy of your data → Connections.
 * The file sometimes begins with a multi-line "Notes:" preamble before the
 * real header row, so we locate the header line first.
 */
export interface ParsedConnection {
  firstName: string;
  lastName: string;
  linkedinUrl: string;
  email: string;
  company: string;
  title: string;
  connectedOn: string;
}

export function parseConnectionsCsv(text: string): ParsedConnection[] {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.includes('First Name') && l.includes('Last Name'));
  if (headerIdx === -1) throw new Error('Could not find the header row — is this a LinkedIn Connections.csv export?');
  const body = lines.slice(headerIdx).join('\n');
  const result = Papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true });
  return result.data
    .map((row) => ({
      firstName: (row['First Name'] ?? '').trim(),
      lastName: (row['Last Name'] ?? '').trim(),
      linkedinUrl: (row['URL'] ?? '').trim(),
      email: (row['Email Address'] ?? '').trim(),
      company: (row['Company'] ?? '').trim(),
      title: (row['Position'] ?? '').trim(),
      connectedOn: (row['Connected On'] ?? '').trim(),
    }))
    .filter((c) => c.firstName || c.lastName);
}

export interface ImportResult {
  added: number;
  skipped: number;
}

/** Import parsed connections as 1st-degree contacts, deduping against existing ones. */
export async function importConnections(connections: ParsedConnection[]): Promise<ImportResult> {
  const existing = await db.contacts.toArray();
  const byUrl = new Set(existing.map((c) => c.linkedinUrl).filter(Boolean));
  const byNameCo = new Set(
    existing.map((c) => `${c.firstName}|${c.lastName}|${c.company ?? ''}`.toLowerCase()),
  );
  const now = Date.now();
  const toAdd: Contact[] = [];
  let skipped = 0;
  for (const conn of connections) {
    const nameKey = `${conn.firstName}|${conn.lastName}|${conn.company}`.toLowerCase();
    if ((conn.linkedinUrl && byUrl.has(conn.linkedinUrl)) || byNameCo.has(nameKey)) {
      skipped++;
      continue;
    }
    byUrl.add(conn.linkedinUrl);
    byNameCo.add(nameKey);
    toAdd.push({
      firstName: conn.firstName,
      lastName: conn.lastName,
      company: conn.company || undefined,
      title: conn.title || undefined,
      email: conn.email || undefined,
      linkedinUrl: conn.linkedinUrl || undefined,
      relationship: '1st',
      source: 'linkedin',
      connectedOn: conn.connectedOn || undefined,
      createdAt: now,
    });
  }
  await db.contacts.bulkAdd(toAdd);
  return { added: toAdd.length, skipped };
}

// ---------- Deep links into LinkedIn's own search (ToS-safe, no scraping) ----------

/** People search at a company. network: 'F' = 1st degree, 'S' = 2nd degree. */
export function peopleSearchUrl(company: string, network?: 'F' | 'S'): string {
  let url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company)}`;
  if (network) url += `&network=${encodeURIComponent(JSON.stringify([network]))}`;
  return url;
}

/** Alumni from your school who match the company keyword. */
export function alumniSearchUrl(schoolSlug: string, company: string): string {
  return `https://www.linkedin.com/school/${encodeURIComponent(schoolSlug)}/people/?keywords=${encodeURIComponent(company)}`;
}
