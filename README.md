# friendly-bets

A non-commercial sports prediction game for family and friends: pick home win, draw or
away win, and climb the leaderboard. No real money.

It was built for the 2026 World Cup and now runs the NHL and Liiga 2026–27 ice hockey
regular seasons. A header dropdown switches competitions. There are no bookmaker odds.
Scoring is fixed points with a crowd-based underdog bonus, so nobody has to set odds.
The tricky part is grading games that go past regulation (extra time, penalties,
overtime, shootouts) so that both "draw after regulation" and "the eventual winner" can
be correct picks.

Live at https://friendly-bets-rust.vercel.app.

## What it does
- Players predict each match before kickoff: correct +10, wrong −5, +5 more if the
  picked outcome drew under 33% of all picks. An optional strict pick ("Win in 90′" on
  World Cup knockouts, "Win in 60′" in hockey) is worth +5 more.
- A sync job pulls fixtures and results from each league's public feed every 5 minutes
  and settles finished matches automatically.
- `/matches` shows Upcoming / Live / Past tabs with the crowd split, scores and team
  logos.
- `/leaderboard` shows a podium and a sortable table, filtered by period: all time,
  last 10, or one round or week.
- `/stats` has personal stats, crowd facts and records.
- Sign-in is by magic link or Google. Guests can browse read-only.

## Requirements
- Node.js 20.9+ (Next.js 16).
- A Supabase project (Postgres + Auth) and the Supabase CLI.
- Five env vars, all listed with instructions in `.env.local.example`:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (server-only), `SYNC_SECRET`, `NEXT_PUBLIC_SITE_URL`.
- For production: a Vercel project with the same env vars, and an external scheduler
  (cron-job.org) that calls `/api/sync`.

## Install
```bash
git clone https://github.com/Nickeniklas/friendly-bets.git
cd friendly-bets
npm install
cp .env.local.example .env.local   # then fill in the values
```

Apply the database schema (everything in `supabase/migrations/`):
```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Auth needs some one-time dashboard setup: redirect URLs, custom SMTP for magic links,
and the Google provider. It's documented in `CLAUDE.md` under "Google OAuth" and
"Email / SMTP".

## Usage
```bash
npm run dev            # dev server on http://localhost:3000
npm run build          # production build
npm run lint           # eslint
npx tsc --noEmit       # type-check (there is no test suite)
```

Trigger a sync locally (fetches all feeds, upserts matches, settles finished ones):
```bash
curl http://localhost:3000/api/sync -H "Authorization: Bearer <your-SYNC_SECRET>"
```
It returns `{"synced": <n>, "settled": [...]}`. A failed feed appears in
`feedErrors`, and an upstream timeout returns a 504.

Regenerate static assets (one-off scripts; commit what they write):
```bash
node scripts/copy-flags.mjs       # World Cup country flags → public/flags/
node scripts/copy-team-logos.mjs  # Liiga logos → public/teams/
node scripts/copy-nhl-logos.mjs   # NHL logos → public/teams/nhl/
node scripts/make-app-icons.mjs   # favicon, Apple and manifest icons
```

## How it works
Next.js (App Router, TypeScript) on Vercel, with Supabase for Postgres and Auth.

1. **Sync.** `src/app/api/sync/route.ts`, protected by `SYNC_SECRET`, loads each feed in
   parallel. The feed parsers are `src/lib/nhl.ts` (api-web.nhle.com), `src/lib/liiga.ts`
   (liiga.fi) and the retired `src/lib/openfootball.ts` (World Cup). Each one turns its
   league's JSON into `matches` rows keyed on `external_ref`. The job then upserts the
   rows and calls the `settle_match` RPC for every match that has a result and kicked
   off more than 3 hours ago.
2. **Grading.** Each match stores two results. `result` is the final winner, after
   extra time, penalties, overtime or a shootout. `result_ft` is the result after
   regulation. A pick wins if it matches either one. `settle_match` is atomic,
   idempotent, and the only thing that changes points.
3. **Rules in the database.** The `enforce_bet_window` trigger rejects picks after
   kickoff. Row-level security makes all data public-read, and lets users write only
   their own picks.
4. **Pages.** `/matches`, `/leaderboard` and `/stats` are Server Components that filter
   everything by the selected competition (`fb-competition` cookie,
   `src/lib/competitions.ts`). They precompute every view server-side for small client
   switchers. Stats math lives in `src/lib/stats.ts`. Anything sport-specific
   (OT/SO labels, weekly periods, the 🏒 icon) keys off `competitions.sport`, never the
   competition id.

Further docs: `docs/SCHEMA.md` (data model and settlement contract), `CLAUDE.md`
(current status, invariants, gotchas), `docs/PLAN.md` (original design) and
`docs/HISTORY.md` (build log).

## Project structure
```
src/app/            pages (matches, leaderboard, stats, login), /api/sync, /auth/confirm
src/components/     shared UI (header, bottom nav, flag/logo, leaderboard + stats views)
src/lib/            feed parsers, competitions, stats, logo/flag maps, Supabase clients
src/proxy.ts        session-refresh proxy (Next 16's name for middleware)
supabase/migrations schema, RPCs, views, RLS (applied with `supabase db push`)
supabase/scripts    one-off data fixes, pasted into the SQL editor by hand
scripts/            asset generators (flags, logos, icons)
```

## Limitations
- The feeds aren't live: scores update only when the 5-minute sync runs.
- The NHL and liiga.fi APIs are unofficial and undocumented, so they can change
  without notice.
- Playoff and series formats aren't supported. Each competition is one regular season
  or one tournament.
