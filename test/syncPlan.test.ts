import { describe, expect, it } from 'vitest';
import { deviceLabel, planSync } from '../src/lib/syncPlan';

const mem = (revision: number, dirty = false) => ({ userId: 'u', revision, dirty });

describe('planSync', () => {
  it('sends this computer’s board when the account has none yet', () => {
    expect(planSync({ remoteRevision: null, memory: null, localEmpty: false })).toBe('create');
    expect(planSync({ remoteRevision: null, memory: null, localEmpty: true })).toBe('create');
  });

  it('on a computer meeting the account for the first time, loads the account’s board only if this one is empty', () => {
    expect(planSync({ remoteRevision: 4, memory: null, localEmpty: true })).toBe('pull');
    // A board here and a board there: never overwrite either without asking.
    expect(planSync({ remoteRevision: 4, memory: null, localEmpty: false })).toBe('ask');
  });

  it('does nothing when both sides match, and sends changes made here', () => {
    expect(planSync({ remoteRevision: 4, memory: mem(4), localEmpty: false })).toBe('none');
    expect(planSync({ remoteRevision: 4, memory: mem(4, true), localEmpty: false })).toBe('push');
  });

  it('loads what the other computer saved, unless this one has unsent changes too', () => {
    expect(planSync({ remoteRevision: 6, memory: mem(4), localEmpty: false })).toBe('pull');
    expect(planSync({ remoteRevision: 6, memory: mem(4, true), localEmpty: false })).toBe('ask');
  });

  it('asks when the account is somehow behind this computer', () => {
    expect(planSync({ remoteRevision: 2, memory: mem(4), localEmpty: false })).toBe('ask');
    expect(planSync({ remoteRevision: 2, memory: mem(4), localEmpty: true })).toBe('pull');
  });
});

describe('deviceLabel', () => {
  it('names the computer and browser', () => {
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toBe('Mac · Chrome');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Windows · Edge');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15')).toBe('Mac · Safari');
  });
});
