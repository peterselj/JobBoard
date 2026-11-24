import { describe, expect, it } from 'vitest';
import { parseCompanyLinkedin } from '../src/lib/linkedin';
import { webLink } from '../src/lib/handoff';
import { looksLikeDataLoss, recordCount } from '../src/lib/autobackup';

describe('parseCompanyLinkedin', () => {
  it('keeps a real LinkedIn people-search address, as a full https link', () => {
    expect(parseCompanyLinkedin('https://www.linkedin.com/search/results/people/?currentCompany=%5B%221035%22%5D')).toEqual({
      url: 'https://www.linkedin.com/search/results/people/?currentCompany=%5B%221035%22%5D',
      companyIds: ['1035'],
    });
    expect(parseCompanyLinkedin('linkedin.com/jobs/search/?f_C=1035')?.url).toBe('https://linkedin.com/jobs/search/?f_C=1035');
  });

  it('never stores a script link, even one carrying a company id', () => {
    for (const bad of [
      'javascript:alert(document.domain)//?currentCompany=1',
      'JavaScript:alert(1)//linkedin.com/x?currentCompany=1',
      'data:text/html,hi?currentCompany=1',
      'https://evil.example/?currentCompany=1',
      'https://linkedin.com.evil.example/?currentCompany=1',
    ]) {
      const parsed = parseCompanyLinkedin(bad);
      if (parsed) expect(parsed.url).toMatch(/^https:\/\/(www\.)?linkedin\.com\//);
    }
  });

  it('still reads company pages', () => {
    expect(parseCompanyLinkedin('https://www.linkedin.com/company/stripe/people/')).toEqual({ url: 'https://www.linkedin.com/company/stripe/' });
    expect(parseCompanyLinkedin('linkedin.com/company/1035/')).toEqual({ url: 'https://www.linkedin.com/company/1035/', companyIds: ['1035'] });
  });
});

describe('webLink', () => {
  it('passes web links and blocks everything else', () => {
    expect(webLink('https://example.com/a')).toBe('https://example.com/a');
    expect(webLink('javascript:alert(1)')).toBe('');
    expect(webLink(' data:text/html,x')).toBe('');
    expect(webLink(undefined)).toBe('');
  });
});

describe('autosave data-loss guard', () => {
  const payload = (opps: number, contacts: number) => ({
    data: { opportunities: Array(opps).fill({}), contacts: Array(contacts).fill({}) },
  });

  it('counts opportunities and contacts', () => {
    expect(recordCount(payload(3, 4))).toBe(7);
    expect(recordCount(null)).toBe(0);
  });

  it('pauses when a save would wipe most of the backup', () => {
    expect(looksLikeDataLoss(40, 0)).toBe(true); // wiped browser
    expect(looksLikeDataLoss(40, 3)).toBe(true); // wiped browser + tour sample
    expect(looksLikeDataLoss(40, 19)).toBe(true);
  });

  it('lets normal saves through', () => {
    expect(looksLikeDataLoss(40, 38)).toBe(false); // deleted a couple
    expect(looksLikeDataLoss(40, 60)).toBe(false); // grew
    expect(looksLikeDataLoss(0, 0)).toBe(false); // first save
    expect(looksLikeDataLoss(4, 0)).toBe(false); // tiny file: nothing much to lose
  });
});
