# friendly-bets

A non-commercial World Cup 2026 prediction game for family & friends. See `CLAUDE.md`
and `docs/PLAN.md` / `docs/SCHEMA.md` for the full spec, build order, and current status.

## Status

- Supabase schema, RPC, view, and RLS are live (see `supabase/migrations/`).
- `/api/sync` (`src/app/api/sync/route.ts`) is deployed to Vercel and verified live at
  `https://friendly-bets-rust.vercel.app/api/sync` — pulls openfootball fixtures/results,
  upserts `matches`, and auto-settles via `settle_match`. The Vercel project is connected
  to this GitHub repo for auto-deploys on push to `main`.
- The cron-job.org schedule that triggers `/api/sync` every 2-3h is set up and
  confirmed working (200 OK). Step 2 is complete.
- Magic-link auth is built: `/login` sends a sign-in email, `/auth/confirm` completes
  it, and the home page shows the logged-in user's name + points balance with a sign-out
  button. Session cookies are kept fresh by `src/middleware.ts`. `NEXT_PUBLIC_SITE_URL`
  is set in Vercel and verified live — step 3 is fully complete.
- The match list page (`/matches`) shows all 104 World Cup 2026 fixtures grouped by
  kickoff date (UTC), with stage/group, kickoff time, and status. Readable by anyone
  (no login needed) and linked from the home page. Step 4 is complete.
- Place-bet flow is live: logged-in users can pick a side and a stake (default
  100) on any open match from `/matches`. The bet is inserted via a server
  action; DB triggers handle the bet-window check, balance deduction, and
  one-bet-per-match rule. Verified working end-to-end on the live site. Step 5
  is complete.
- Leaderboard (`/leaderboard`) shows a points-balance ranking and an accuracy
  table (W-L, win %, streak) from the `accuracy` view. Linked from the home
  page and `/matches`. Step 7 is complete — see `CLAUDE.md` for what's next
  (step 8: show pool size / implied multiplier per match).
- Vercel Web Analytics is enabled (`@vercel/analytics`).
- Magic-link emails go through custom SMTP (Brevo) — Supabase's default
  shared mailer caps at 2 emails/hour, which isn't enough for multiple
  people signing in. See `CLAUDE.md` ("Email / SMTP") for setup details.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.local.example` to `.env.local` and fill in your Supabase project values
(see that file for where to find each one — `.env.local` is gitignored).

The Supabase schema lives in `supabase/migrations/` — apply it with the Supabase CLI:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

### Testing /api/sync locally

With `npm run dev` running, in another terminal:

```bash
curl http://localhost:3000/api/sync -H "Authorization: Bearer <your-SYNC_SECRET>"
```

Expect `{"synced": <count>, "settled": [...]}`. The `matches` table should populate
with World Cup 2026 fixtures.

### Auth (magic link)

One-time setup in the Supabase dashboard — Authentication -> URL Configuration — DONE:

- **Site URL**: your deployed app URL (e.g. `https://friendly-bets-rust.vercel.app`)
- **Redirect URLs**: add that same URL plus `http://localhost:3000/**`

No email template edits are needed — the default "Magic Link" email works as-is
(`/auth/confirm` handles Supabase's PKCE `?code=...` redirect). Visit `/login`,
enter an email, and click the link from the email to sign in.

Magic-link emails are sent via custom SMTP (Brevo) — see `CLAUDE.md` ("Email
/ SMTP") for why and how it's configured. First-time recipients should check
their spam folder, since the sending address has no reputation yet.

`NEXT_PUBLIC_SITE_URL` is set in both `.env.local` (local dev) and the Vercel
project's Environment Variables (production), so `emailRedirectTo` resolves
correctly in both environments.

### Match list

`/matches` lists all synced fixtures, grouped by kickoff date (UTC). It's a
read-only Server Component — `matches` is readable by anyone via RLS, so no
login is required to view it.

### Place a bet

On `/matches`, any match that's still `scheduled` and hasn't kicked off yet
shows a pick (team1/team2) + stake form for logged-in users. Submitting it
inserts a row into `bets`; the DB triggers from
`supabase/migrations/20260609000000_initial_schema.sql` (plus the
`SECURITY DEFINER` fix in `20260611000000_...`) enforce the bet window,
deduct the stake from `points_balance`, and block a second bet on the same
match. Once you've bet on a match it shows "Your bet: ..." instead of the
form, including the outcome/payout after `settle_match` runs.

### Leaderboard

`/leaderboard` is a read-only Server Component (anyone can view, no login
required) with two sections: a points-balance ranking from `profiles`, and
an accuracy table (bets won/lost, win %, current streak) from the `accuracy`
view. The accuracy section shows an empty-state message until at least one
match has been settled.
