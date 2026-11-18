# Switching on sign-in and sync

One-time setup for the owner. Until it's done, JobBoard works exactly as it always has: everything
in each person's browser, no accounts, and the page never contacts Supabase.

How it fits together: the page keeps working from the board in your browser. When you sign in
(email link, no password), the whole board is also saved to your row in a **Supabase** database a
few seconds after each change, and your other computers load it from there. Row-level security
means each person can only read and write their own board. People who never sign in are untouched.

Keys and where they live:

| Key | Lives in | Who sees it |
|---|---|---|
| Supabase project URL + publishable key | `src/lib/cloud.ts` | Public by design; row-level security limits it to each person's own board |
| Supabase secret key | Nowhere. JobBoard doesn't need it | Don't copy it anywhere |
| Brevo SMTP key | Supabase → Authentication → SMTP | Only Supabase (sign-in emails) |

## 1. A separate Supabase project

Create a **new** project for JobBoard (Supabase → New project, name `jobboard`) rather than reusing
JobSnipe's. Why:

- **JobBoard holds more sensitive data.** JobSnipe stores job postings (public anyway) and your
  filters. JobBoard stores names, emails and phone numbers of real people who aren't users, plus your
  private notes about them and about interviews and pay.
- **JobSnipe's secret key would reach it.** That key sits in GitHub Actions for a public repo so the
  hourly checker can run. Anything in the same project is readable with it. A separate project keeps
  a JobSnipe leak from becoming a JobBoard leak.
- **No surprises between the two apps.** In JobSnipe's project, every new sign-in gets a JobSnipe
  profile automatically, and "Delete my account" removes the JobSnipe account too.

The cost: people sign in to each app separately. The free plan allows two projects.

## 2. The database

SQL Editor → New query → paste all of
[`supabase/migrations/0001_boards.sql`](../supabase/migrations/0001_boards.sql) → **Run**. Later
files in that folder, if any, go in number order, each in a fresh query.

## 3. Sign-in links

Authentication → **URL Configuration**:

- Site URL: `https://peterselj.github.io/JobBoard/`
- Redirect URLs: add `https://peterselj.github.io/JobBoard/**` and `http://localhost:5173/JobBoard/**`

## 4. Sign-in emails through Brevo

Supabase's built-in email only sends to the project's own team, a few an hour, so anyone else
(Jake) would never get a link. Use the Brevo account JobSnipe already uses: Authentication → Emails →
**SMTP Settings** → enable custom SMTP:

- Sender email `postalservice@joshpetersel.com`, sender name `JobBoard`
- Host `smtp-relay.brevo.com`, port `587`
- Username: the Brevo SMTP **Login**; password: a Brevo **SMTP key** (Brevo → SMTP & API → SMTP;
  generate a new one named `JobBoard` so each app's can be revoked on its own)

Optional: Authentication → Emails → **Magic Link** template, change the subject to "Your JobBoard
sign-in link".

## 5. Who can sign up

Sign-up is open by default: anyone who finds the page can create an account and store a board (up
to 5 MB each). To keep it to people you invite: Authentication → Sign In / Providers → turn off
**Allow new users to sign up**, then add people from Authentication → Users → **Invite user**.
Recommended while it's just the two of you; easy to reopen later.

## 6. Switch it on

Project Settings → **Data API** for the project URL, and **API Keys** for the `sb_publishable_…`
key. Put both in `src/lib/cloud.ts` in a pull request. Merging it publishes the **Sync between
computers** section in Settings and the "Already using JobBoard on another computer?" link on the
welcome screen.

Before merging, tell anyone actively using JobBoard (Jake). Nothing happens to their board unless they
choose to sign in, but it's a good moment to **Settings → Export backup**, and to know what signing
in means (their board gets stored in the database you run; see "Who can see a synced board" below).

## 7. Try it

1. On your main computer: Settings → Sync between computers → enter your email → open the link **in
   the same browser**. Your board is saved to your account.
2. On your other computer, same steps. If that browser's board is empty, your board appears. If it
   already has a board, you're asked which one to keep, and the other is saved to Downloads first.
3. Make a change on one, switch to the other's tab: it shows up within a few seconds of switching.

## Who can see a synced board

- **The person who signed in**, on any computer where they sign in with that email.
- **Whoever runs the Supabase project** (you) can see every synced board in the Supabase dashboard
  (Table Editor → boards). That's the honest trade-off of a hosted service, and the Settings section
  says so before anyone signs in. If that ever needs to change, the fix is encrypting each board in
  the browser with a passphrase only its owner knows, at the cost of the board being unrecoverable
  if they forget it.
- **Supabase** stores it, as it does JobSnipe's data.
- **Anyone who gets into your email** can sign in as you, the same as with JobSnipe.

## How sync decides (for the curious)

Each save carries a revision number. A computer only saves "on top of" the revision it last saw, so
if your other computer saved in between, the save is refused and the page looks again: if this
computer had no unsent changes, it loads the newer board; if both have changes, it asks which to
keep. The logic is in `src/lib/syncPlan.ts` (tested in `test/syncPlan.test.ts`), and the database
rules are tested in `test/db.test.ts`.
