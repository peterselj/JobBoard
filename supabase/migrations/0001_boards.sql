-- JobBoard sync. Run once in Supabase → SQL Editor (paste all, then Run). Setup: docs/SETUP.md.
--
-- One row per person: their whole board as one JSON document, the same shape as a backup file.
-- Each person can only read and change their own row. The browser keeps working from its own copy
-- (IndexedDB) and sends the whole board here a few seconds after each change.
--
-- `revision` goes up by one with every save. A computer saves only "on top of" the revision it last
-- saw, so if your other computer saved in between, the save matches no row and the page asks you
-- which board to keep instead of quietly overwriting it.

create table public.boards (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  -- Which computer saved last, e.g. "Mac · Chrome", so the page can say where a newer board came from.
  saved_by text not null default '' check (length(saved_by) <= 80),
  updated_at timestamptz not null default now(),
  -- A board is normally well under 1 MB; this stops anyone using the database as free storage.
  constraint boards_size check (octet_length(data::text) <= 5000000),
  -- coalesce: a missing field makes the test unknown, which a check would otherwise let through.
  constraint boards_shape check (coalesce(data ->> 'app' = 'jobboard' and jsonb_typeof(data -> 'data') = 'object', false))
);

alter table public.boards enable row level security;

create policy "read own board" on public.boards for select to authenticated
  using (user_id = (select auth.uid()));
create policy "add own board" on public.boards for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "change own board" on public.boards for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own board" on public.boards for delete to authenticated
  using (user_id = (select auth.uid()));

-- Signed-out visitors get nothing at all; signed-in people only the columns they need.
revoke all on public.boards from anon, authenticated;
grant select, delete on public.boards to authenticated;
grant insert (data, revision, saved_by) on public.boards to authenticated;
grant update (data, revision, saved_by) on public.boards to authenticated;

-- The server sets the time, so a computer with a wrong clock can't make its save look newer.
create function public.boards_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger boards_touch before insert or update on public.boards
  for each row execute function public.boards_touch();

-- Settings → Delete my account: removes the sign-in and the board with it (on delete cascade).
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Sign in first'; end if;
  delete from auth.users where id = me;
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
