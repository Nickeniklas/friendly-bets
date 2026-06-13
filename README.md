# friendly-bets

A non-commercial World Cup 2026 prediction game for family & friends. See `CLAUDE.md`
and `docs/PLAN.md` / `docs/SCHEMA.md` for the full spec, build order, and current status.
`docs/HISTORY.md` has the detailed step-by-step build log.

## Status

**v1 is complete and live** at `https://friendly-bets-rust.vercel.app`.

- Supabase schema, RPC (`settle_match`), `accuracy` view, and RLS are live (see
  `supabase/migrations/`).
- `/api/sync` (`src/app/api/sync/route.ts`) is deployed to Vercel, protected by a
  shared secret, and triggered every 2-3h by cron-job.org (200 OK confirmed) —
  pulls openfootball fixtures/results, upserts `matches`, and auto-settles via
  `settle_match`. The Vercel project is connected to this GitHub repo for
  auto-deploys on push to `main`.
- Magic-link auth is built: `/login` sends a sign-in email, `/auth/confirm` completes
  it, and the home page shows the logged-in user's name + points balance with a sign-out
  button. Session cookies are kept fresh by `src/middleware.ts`. `NEXT_PUBLIC_SITE_URL`
  is set in Vercel and verified live.
- The match list page (`/matches`) shows all 104 World Cup 2026 fixtures grouped by
  kickoff date (UTC), with stage/group, kickoff time, and status. Readable by anyone
  (no login needed) and linked from the home page.
- Place-bet flow is live: logged-in users can pick a side and a stake (default
  100) on any open match from `/matches`, including a live pool size / implied
  multiplier per side. The bet is inserted via a server action; DB triggers handle
  the bet-window check, balance deduction, and one-bet-per-match rule. Verified
  working end-to-end on the live site.
- Leaderboard (`/leaderboard`) shows a points-balance ranking and an accuracy
  table (W-L, win %, streak) from the `accuracy` view. Linked from the home
  page and `/matches`.
- Vercel Web Analytics is enabled (`@vercel/analytics`).
- Magic-link emails go through custom SMTP (Brevo) — Supabase's default
  shared mailer caps at 2 emails/hour, which isn't enough for multiple
  people signing in. See `CLAUDE.md` ("Email / SMTP") for setup details.
  Since the sending address has no domain reputation yet, `/login` shows a
  reminder to check spam/junk for the magic-link email.
- Team flags are shown next to team names on `/matches` (see "Team flags"
  below).

No known open bugs. Anything further is a v2 idea — see `docs/PLAN.md`.

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
their spam folder, since the sending address has no reputation yet — `/login`
itself now reminds users of this, so you shouldn't need to repeat it when
sharing the link.

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

### Team flags

`/matches` shows a small flag next to each team name. `src/lib/flags.ts` maps
the 48 real WC2026 country names (as they appear in openfootball's
`team1`/`team2`) to [flag-icons](https://flagicons.lipis.dev/) codes; the SVGs
themselves live in `public/flags/` (copied from the `flag-icons` npm package
by `scripts/copy-flags.mjs`, which is also how to add a flag later). The
`Flag` component (`src/components/flag.tsx`) renders nothing for team names
not in the map — currently just the ~64 unresolved knockout-bracket
placeholders (`"1A"`, `"W74"`, etc.), which get real country names as the
bracket plays out. If a placeholder resolves to a country not yet in
`TEAM_FLAG_CODES`, add it there and re-run the copy script.
