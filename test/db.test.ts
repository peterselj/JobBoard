import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

// Runs the real migration on Postgres (PGlite) with small stand-ins for the Supabase parts it uses
// (the roles, auth.users and auth.uid()), then checks that each person can reach only their own board.
const SUPABASE_STUBS = `
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

const migrations = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'));

const JOSH = '00000000-0000-0000-0000-00000000000a';
const JAKE = '00000000-0000-0000-0000-00000000000b';
const board = (note: string) => JSON.stringify({ app: 'jobboard', version: 1, exportedAt: '', data: { opportunities: [{ company: note }] } });

let db: PGlite;

/** Run SQL as a signed-in person (or a signed-out visitor when `who` is null), the way Supabase would. */
async function as<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${who ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [who ?? '']);
    return (await tx.query<T>(sql, params)).rows;
  });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const m of migrations) await db.exec(m);
  await db.exec(`insert into auth.users values ('${JOSH}', 'josh@example.com'), ('${JAKE}', 'jake@example.com')`);
}, 30_000);

describe('boards', () => {
  it('lets each person save and read only their own board', async () => {
    await as(JOSH, `insert into boards (data, saved_by) values ($1, 'Mac · Chrome')`, [board('josh')]);
    await as(JAKE, `insert into boards (data) values ($1)`, [board('jake')]);
    expect(await as(JOSH, `select data->'data'->'opportunities'->0->>'company' as c from boards`)).toEqual([{ c: 'josh' }]);
    expect(await as(JAKE, `select data->'data'->'opportunities'->0->>'company' as c from boards`)).toEqual([{ c: 'jake' }]);
  });

  it("doesn't let anyone change, delete or claim someone else's board", async () => {
    await as(JAKE, `update boards set data = $1, revision = 99`, [board('hacked')]); // matches no rows
    await as(JAKE, `delete from boards where user_id = '${JOSH}'`);
    const rows = await db.query<{ c: string; revision: number }>(`select data->'data'->'opportunities'->0->>'company' as c, revision from boards where user_id = '${JOSH}'`);
    expect(rows.rows).toEqual([{ c: 'josh', revision: 1 }]);
    // Writing a board under someone else's id is refused outright.
    await expect(as(JAKE, `insert into boards (user_id, data) values ('${JOSH}', $1)`, [board('x')])).rejects.toThrow(/permission denied/);
    await expect(as(JAKE, `update boards set user_id = '${JOSH}'`)).rejects.toThrow(/permission denied/);
  });

  it('gives signed-out visitors nothing', async () => {
    await expect(as(null, 'select * from boards')).rejects.toThrow(/permission denied/);
    await expect(as(null, `insert into boards (data) values ($1)`, [board('x')])).rejects.toThrow(/permission denied/);
    await expect(as(null, 'select delete_my_account()')).rejects.toThrow(/permission denied/);
  });

  it('saves only on top of the revision you last saw, so two computers never quietly overwrite each other', async () => {
    const first = await as(JOSH, `update boards set data = $1, revision = 2 where revision = 1 returning revision`, [board('laptop')]);
    expect(first).toEqual([{ revision: 2 }]);
    // The desktop still thinks it's on revision 1: its save matches nothing, and the page will ask.
    const stale = await as(JOSH, `update boards set data = $1, revision = 2 where revision = 1 returning revision`, [board('desktop')]);
    expect(stale).toEqual([]);
  });

  it('sets the save time itself and refuses things that aren’t JobBoard boards', async () => {
    await expect(as(JOSH, `update boards set updated_at = '2000-01-01'`)).rejects.toThrow(/permission denied/);
    await expect(as(JOSH, `update boards set data = '{"hello":1}'`)).rejects.toThrow(/boards_shape/);
    const huge = JSON.stringify({ app: 'jobboard', data: { notes: 'x'.repeat(5_100_000) } });
    await expect(as(JOSH, `update boards set data = $1`, [huge])).rejects.toThrow(/boards_size/);
  });

  it('deletes your account and your board together, and only yours', async () => {
    await as(JAKE, 'select delete_my_account()');
    expect((await db.query('select email from auth.users')).rows).toEqual([{ email: 'josh@example.com' }]);
    expect((await db.query<{ n: number }>('select count(*)::int as n from boards')).rows).toEqual([{ n: 1 }]);
  });
});
