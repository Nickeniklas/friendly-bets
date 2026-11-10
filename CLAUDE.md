# CLAUDE.md

Operating brief for Claude Code: current state only. Detail lives in `docs/SCHEMA.md`
(data model, settlement contract), `docs/PLAN.md` (original design, v3 backlog) and
`README.md` (setup, commands).

Session history: docs/HISTORY.md (read when needed)

## Status
Live at `https://friendly-bets-rust.vercel.app` (Vercel project `friendly-bets`,
auto-deploys on push to `main` of `Nickeniklas/friendly-bets`). Next.js 16.2.9,
React 19.2.4, `@supabase/ssr` + `@supabase/supabase-js`, Tailwind 4. The v1 build order
in `docs/PLAN.md` (steps 1-8) is complete. No known open bugs and no planned work:
anything new is a v3 idea (`docs/PLAN.md` "v3 ideas") and is not started without
being asked.

**Competitions** (`competitions` table; header dropdown `CompetitionSelect` →
`setSelectedCompetition()` in `src/lib/competition-actions.ts` writes the
`fb-competition` cookie; `getSelectedCompetition()` in `src/lib/competitions.ts` reads
it, falling back to the first active by `sort_order`):

| id | sport | active | sort_order | Feed |
|---|---|---|---|---|
| `nhl-2027` | hockey | yes (default) | 0 | `src/lib/nhl.ts`: `api-web.nhle.com/v1/schedule/{date}`, four 7-day windows today−14…+13, `gameType = 2` only, `external_ref = nhl-{id}`, team names = `commonName.default` |
| `liiga-2027` | hockey | yes | 1 | `src/lib/liiga.ts`: liiga.fi `/api/v2/games?tournament=runkosarja&season=2027`, `external_ref = liiga-{id}` |
| `wc2026` | football | no (finished, still selectable) | 2 | `src/lib/openfootball.ts`: no longer fetched, code kept |

Hockey periods are `matches.group_label` "Week N" (Liiga: the API's `gameWeek`; NHL:
Monday weeks in Helsinki time from `WEEK_1_MONDAY` = 2026-09-28). NHL regulation
scores are reconstructed from `lastPeriodType` (the feed has no periods); an OT/SO
game whose margin isn't one goal is logged and left ungraded.

**Sync** (`src/app/api/sync/route.ts`): `GET` with `Authorization: Bearer
<SYNC_SECRET>`, called every 5 min by cron-job.org (which times out at 30 s). Loads the
`feeds` list (`nhl`, `liiga`) in parallel; every upstream fetch is capped at
`UPSTREAM_TIMEOUT_MS` = 8000 (`src/lib/openfootball.ts`). A failed feed is logged and
skipped (`feedErrors`); a timed-out feed is skipped too and turns the response into a
504 `{ error: "upstream timeout", feed, … }`. Before upserting, `result`/`result_ft`
of already-settled matches are frozen; the display-only score columns
(`ft_/et_/p_team1/2`) are not. It then calls `settle_match` for every unsettled match
with a result that kicked off more than `SETTLE_DELAY_HOURS` = 3 h ago; one failure is
recorded in `failed[]` and the rest continue. Normal response:
`{ synced, settled, failed?, feedErrors? }`.

**Pages** (Server Components that precompute every view and hand it to a small client
switcher; `/matches`, `/leaderboard` and `/stats` filter everything by the selected
competition and share `AppHeader` + `BottomNav` with Matches / Leaderboard / Stats tabs):
- `/matches` (`src/app/matches/`): Upcoming / Live / Past tabs (`MatchesTabs`),
  date-grouped under sticky "washi tape" headers, kickoff shown in `Europe/Helsinki`.
  Active competitions load ±14 days (`ACTIVE_WINDOW_DAYS`). `MatchCard` offers a
  three-way pick and, where `strictModeAvailable(sport, stage)`, the strict mode
  ("Win in 90′" on WC knockouts, "Win in 60′" on any hockey game; copy in
  `STRICT_MODE_COPY`). It calls `placeBet` directly (returns `PlaceBetResult`), shows a
  toast and `router.refresh()`es. Crowd split comes from the `match_bet_counts` view.
  Past cards show the score (hockey headline = 60-min score, note "3–2 OT" / "5–4 SO";
  football "a.e.t." / pens), winners in green and the user's pick as a neutral "Your
  pick" chip. Header pill = the user's points in this competition. Dismissible
  `IntroCard` (localStorage `fb-intro-dismissed`, hockey `fb-intro-dismissed-hockey-v2`).
- `/leaderboard`: period pills (`LeaderboardView`): All time, Last 10, then one per
  period (football: `stage` in tournament order; hockey: week, newest first). Podium
  (top 3, `PODIUM_CONFIG`) plus the sortable `LeaderboardTable` (points, bets, correct,
  wrong, win %, streak; sorted client-side). All periods are aggregated in JS from the
  competition's settled bets (`buildRowsByKey`, `buildRecentRows`); All time also lists
  players with no bets as zeros.
- `/stats`: You (login-gated) / The Crowd / Records (`StatsView`). All math is pure
  code in `src/lib/stats.ts` (`computePersonalStats(sport, …)`, `computeCrowdFacts`,
  `computeRecords(sport, …)`, period helpers `periodKey` / `periodLabel` /
  `orderPeriodKeys` / `periodNoun`, `isUnderdogHit`).
- `/login`: magic link + Google OAuth, a "View matches as guest →" button, a spam/junk
  reminder; icon and subtitle follow the selected competition. Guests on other pages get
  a "Log in" link in `AppHeader`; logged-in users get `SignOutButton`.
- `/auth/confirm`: exchanges the PKCE `code` (or `token_hash` fallback); `next` is
  validated by `safeNext()`.
- `/`: redirects to `/matches` (`src/app/page.tsx`). Not in the bottom nav.
- Vercel Web Analytics (`<Analytics />` in the root layout) and a web manifest
  (`src/app/manifest.ts`, standalone, `start_url` `/matches`).

**Known and deliberately left:**
- `/stats` crowd facts key off `result` (the final winner), not `result_ft`, so a WC
  knockout decided after 90′ or a hockey OT/SO game counts as a win for the winner,
  not a draw.
- `profiles.points_balance` is a cross-competition total (still written by
  `settle_match`) and may be off for some players (see the `UPDATE … FROM` gotcha).
  No page displays it; standings are per-competition sums of `bets.points_awarded`.
- Bets settled before the points model show `0 pts` (`points_awarded` was added with
  `DEFAULT 0` and old matches weren't re-settled). The legacy `refunded` outcome renders
  as a loss.
- The daily login bonus is disabled (see invariants).
- No automatic guard against orphaned openfootball rows (see Gotchas).
- Not yet checked in a browser: the NHL pages (data was verified via the API).

## What we're building
A non-commercial sports prediction game for family & friends: built for the World
Cup 2026, now running the NHL and Liiga 2026–27 regular seasons (competition selector
in the header). No real money.
Players predict each match's outcome (**home win / draw / away win**, no stake) and
earn or lose points at settlement based on whether they were right and how the crowd
picked (an underdog bonus). Everyone starts at 0 points; balances may go negative. The
leaderboard table also shows raw prediction accuracy (correct, wrong, win %, streak).

## Stack (decided — do not re-litigate without being asked)
- Next.js on Vercel
- Supabase: Postgres + Auth (magic link) + realtime. (Google OAuth was added alongside
  magic link; no code uses realtime yet.)
- Match data: api-web.nhle.com (public, unofficial) for NHL and liiga.fi public API
  for Liiga (both active); openfootball `worldcup.json` for the finished WC (no longer
  fetched). Synced every 5 minutes via cron-job.org → `/api/sync`
- No odds — a fixed-points scoring model (see scoring rules below)

Owner is new to Next.js. Prefer clear, conventional, well-commented code over clever
tricks. Explain non-obvious Next.js / Supabase choices inline.

## Scoring rules (the points model)
- Pick one of three outcomes per match: `team1` (home win) / `draw` / `team2` (away win).
  No stake.
- **Correct pick: +10 points.** A pick is correct if it matches the overall result OR the
  full-time (90-min) result — so on a knockout that went to extra time/penalties, a `draw`
  pick wins (it was level at 90) AND the team that advanced wins.
- **Underdog bonus: +5** if the player's picked outcome got **fewer than 33%** of all
  bets placed on that match (correct underdog pick = **15** total).
- **"Wins in 90′" bonus: +5** (knockout team picks only; hockey's equivalent is "Win in
  60′", below) — a player may upgrade a team pick to predict that team is *ahead at full
  time* (90 min). Graded strictly on `result_ft`: correct = +15 (or +20 with the
  underdog bonus), but it loses if the team only advanced via extra time/penalties. Draw
  and group matches don't offer it.
- **Wrong pick: −5 points.**
- Balances may go negative — intended.
- **Hockey:** same model as a WC knockout. A team pick wins if that team wins at all
  (60′, OT or shootout); a `draw` pick wins if it was tied after 60′ — so an OT/SO game
  pays both. **"Win in 60′" (+5)** is the strict team pick, graded on the 60-min result
  only (+15 / +20 with underdog; loses if the team only won in OT/SO).

## Hard rules / invariants
- A bet may be placed ONLY while match.status = 'scheduled' AND now() < kickoff_at.
  Enforce in the DB (the `enforce_bet_window` trigger, function `check_bet_bettable()`),
  not just the UI. The same trigger allows `ft_winner` only on WC knockout stages or
  hockey competitions; `strictModeAvailable()` in `src/lib/competitions.ts` mirrors it —
  keep them in sync. `ft_winner` is team-picks-only (CHECK constraint).
- A bet is just a prediction — `pick` ∈ {`team1`, `draw`, `team2`}, no stake, nothing
  deducted on placement. `UNIQUE (user_id, match_id)` = one prediction per match.
- Settlement (`settle_match`) is ONE atomic transaction, idempotent (skips already-settled
  matches), and the ONLY path that changes a balance. It is called automatically by the
  sync job, not by an admin. It writes each bet's `points_awarded` and adds it to
  `profiles.points_balance`.
- A pick is CORRECT if it matches EITHER the overall result OR the full-time result:
  `pick = matches.result OR pick = matches.result_ft`. `result_ft` is the 90-min result
  (WC) or 60-min result (hockey). A regulation finish makes them equal; for a game decided
  in extra time/penalties/OT/shootout, `result` is the winner and `result_ft` is `draw`,
  so both the winner pick and a `draw` pick win. A `ft_winner` pick wins only on
  `pick = result_ft`.
- Underdog determination at settlement is crowd-based and **per picked outcome**: a correct
  pick earns the +5 bonus if the outcome *it* picked drew fewer than 33% of all bets on the
  match. (Since two outcomes can win the same game, the bonus can't be a single per-match
  determination; for a single-winner match it reduces to the simple rule.)
- Draw is a first-class outcome — pickable, can win (incl. as the full-time result of a
  game that went past regulation), counts toward the bet distribution. No push / refund
  logic exists.
- Balances never change via direct client writes — only via the settlement RPC. Lock this
  down with RLS; the settlement RPC is security-definer.
- Daily login bonus (`claim_daily_bonus`) is disabled: no app code calls it, and EXECUTE
  is revoked from `authenticated`/`anon`/`PUBLIC`
  (`20260617000000_disable_daily_bonus_grant.sql`). The RPC and the
  `profiles.last_bonus_date`/`streak_count` columns are kept, so re-enabling needs the
  grant **and** the toast/action wiring restored. It inflated the prediction score under
  the points model.

## Gotchas
- Adding a competition: insert a `competitions` row, write a parser
  in `src/lib` returning `MatchRow[]` (with `competition` set — the column has no
  default), and add it to the `feeds` list in `/api/sync`. Apply the row BEFORE
  deploying the feed: one unknown competition id fails the FK and the whole
  combined upsert (every feed) for that tick. Logos: generate a per-league map and
  register it in `src/lib/team-logos.ts` (keyed by competition id, so names can't
  collide across leagues). Pages need no change;
  anything sport-specific must key off `competitions.sport`, never the id. Any new
  query on `/matches`/`/leaderboard`/`/stats` must filter by the selected
  competition (bets/`match_bet_counts` via `matches!inner(competition)`).
- Season rollover: the season ids are hard-coded — `LIIGA_COMPETITION_ID` + the
  `season=` URL in `src/lib/liiga.ts` (keep `scripts/copy-team-logos.mjs` in sync),
  and `NHL_COMPETITION_ID` + `WEEK_1_MONDAY` in `src/lib/nhl.ts`.
- Rollout order for a change that needs a migration and a re-grade: (1) apply the
  migration, (2) deploy (push to `main`), (3) run any `supabase/scripts/` fix, (4)
  trigger `/api/sync`. Running a re-settle script before the new parser is deployed lets
  the old code re-settle the same wrong way.
- `/matches` depends on the `match_bet_counts` view; the page errors without it.
- When rules change, bump the intro card's localStorage key (`storageKey()` in
  `src/app/matches/intro-card.tsx`) so everyone sees the new copy. The hockey key is
  shared across hockey leagues on purpose.
- `SETTLE_DELAY_HOURS` in `/api/sync` must match `settle_match`'s own
  `kickoff_at > now() - interval '3 hours'` guard, or the job keeps selecting matches
  the RPC rejects.
- `friendlyBetError()` in `src/app/matches/actions.ts` matches raw DB error text
  (`"betting is closed"`, `"duplicate key value"`, `"ft_winner picks are not allowed"`).
  Don't change those strings when editing user-facing copy.
- No test suite in this repo. Verify changes with `npx tsc --noEmit` (fast,
  catches missing props / type drift); there is no `npm test`.
- A `{/* comment */}` placed *between* JSX attributes is a parse error
  (`TS1005`) — put the comment on a line above the element/tag instead.
- One-off data-fix SQL (not schema changes) lives in `supabase/scripts/`, NOT
  `supabase/migrations/`. `supabase db push` only runs `migrations/`, so these
  are pasted into the SQL editor by hand.
- `UPDATE … FROM` with several source rows per target row applies only ONE of them
  (Postgres picks one arbitrarily). When reversing balances across many bets, sum per
  player in a subquery first (see `resettle_liiga_ot.sql`). The older
  `resettle_knockout_matches.sql` did NOT do this, so players with several settled
  knockout bets had only one reversed — `profiles.points_balance` may be off for them.
- Re-grading already-settled matches: `settle_match` skips `status='settled'`
  (idempotent), so you must first un-settle them. Template:
  `supabase/scripts/resettle_liiga_ot.sql` — reverse each player's summed
  `points_awarded` out of the balance, reset `bets.points_awarded`/`outcome`, set
  `matches.status='closed'` and `settled_at`/`result`/`result_ft` NULL (clearing the
  result stops a failed feed tick from re-settling on the stale value) — then let
  `/api/sync` repopulate results and re-settle under the new logic. (The sync settles
  anything not `settled`, so `closed` works; the older `resettle_knockout_matches.sql`
  used `scheduled` and kept the result.)
- openfootball has no clean match id. Implemented external_ref strategy
  (`buildExternalRef` in `src/lib/openfootball.ts`): knockout matches (have a stable
  `num` field) → `wc2026-m{num}`; group-stage matches (stable team names from day one,
  no `num`) → `{date}-{team1}-{team2}` slugified. Knockout team1/team2 start as
  placeholders ("2A", "W74") that get overwritten as the bracket resolves — keying on
  team names there would create duplicate rows on re-sync, hence the num-based key.
- **That dual keying can orphan rows.** The branch taken depends on whether the feed
  supplies `num` *at the moment of that sync* — if openfootball later ADDS a `num` to a
  match that had none, its external_ref changes, the next sync inserts a new row, and the
  old one is orphaned: never updated or settled, but still `status='scheduled'`, so it
  renders as a bettable card with placeholder names (this produced the ghost "L101 vs
  L102" / "W101 vs W102" cards). Check: any knockout row whose `external_ref` doesn't
  match `^wc2026-m\d+$` is a suspect orphan. Cleanup = delete the row (bets cascade;
  `supabase/scripts/delete_orphan_placeholder_matches.sql`). No automatic guard exists —
  deliberately; see `docs/PLAN.md` v3 ideas. The NHL and Liiga feeds have stable numeric
  ids, so this applies only to openfootball.
- accuracy is a derived VIEW, not a stored table — keeps it from drifting. (The pages no
  longer read it; standings are aggregated in JS per competition with the same formulas.)
- New views default to security definer (they run as the view owner, bypassing
  RLS) and trigger the Supabase Advisor's "Security Definer View" warning. Always
  create them `WITH (security_invoker = on)`, and make sure every table they read
  has anon/authenticated SELECT grants + RLS policies, or guests get "permission
  denied" / fewer rows. `CREATE OR REPLACE VIEW` without the option can drop the
  setting — repeat `WITH (security_invoker = on)` whenever you redefine a view.
- RLS policies alone aren't enough — Postgres also requires baseline table GRANTs
  for anon/authenticated/service_role (a separate permission layer checked *before*
  RLS; service_role's BYPASSRLS doesn't skip it). Tables created via `supabase db push`
  didn't get Supabase's usual auto-grants, causing "permission denied for table X".
  Fixed in `supabase/migrations/20260610120000_grants.sql` — if new tables are added
  later, grant there too.
- Any trigger/function that writes to a table the calling role lacks a GRANT/RLS policy
  for must be `SECURITY DEFINER` (as `handle_new_user`, `settle_match` and
  `claim_daily_bonus` are). The old stake-deduction trigger (`deduct_stake`, function
  `deduct_stake_on_bet()`) and its `20260611000000_*` fix are dead history: both were
  dropped in `20260616000000_accuracy_points_model.sql`; the `bets.stake` column is
  unused.
- Magic-link auth: Supabase's *default* email service won't let you edit email
  templates (Authentication -> Email Templates shows "Set up custom SMTP to edit
  templates"). No need — `@supabase/ssr` defaults to the PKCE flow, so the default
  "Magic Link" email's link goes through Supabase's hosted `/auth/v1/verify` and
  redirects back to `emailRedirectTo` with `?code=...`. `/auth/confirm/route.ts`
  exchanges that via `exchangeCodeForSession` (it also accepts `token_hash`/`type`
  as a fallback if a customized template is set up later). Authentication -> URL
  Configuration: Site URL = the Vercel URL, and Redirect URLs include both the Vercel
  URL and `http://localhost:3000/**`.
- PKCE magic links + double-submit: each call to `signInWithOtp` writes a new
  PKCE `code_verifier` to a cookie, overwriting the previous one. If a user
  submits the login form twice (e.g. because nothing visibly happened), the
  *first* email's link now points to a `code` whose verifier was just
  overwritten — `exchangeCodeForSession` for that link fails. Only the
  *second* (latest) email's link still works. Mitigated by
  `src/app/login/submit-button.tsx` (a small client component using
  `useFormStatus`) which disables the button and shows "Sending..." on
  submit, so the round-trip to Supabase is visible and double-clicks are
  prevented. If a user does end up with two emails, tell them to use the
  most recently received one.
- Convention: any action that does a real network round-trip (DB write,
  Supabase Auth call, etc.) should disable its trigger and show a "Verb-ing..."
  label while pending. For `<form action={serverAction}>`, do this with a small
  `"use client"` submit button using `useFormStatus().pending` — see
  `src/app/login/submit-button.tsx`. `match-card.tsx` instead calls the
  `placeBet` action directly (not via a `<form>`) and tracks its own `pending`
  state with `useState` for the same effect. Without this, slow round-trips
  look unresponsive and invite double-submits, which surface as confusing
  errors (stale magic-link, duplicate-pick constraint, etc.).
- Magic-link emails sent via Brevo (see "Email / SMTP" below) may land in
  spam/trash for first-time recipients, since the sending address has no
  reputation yet. `src/app/login/page.tsx` shows a persistent reminder
  about this, and `src/app/login/actions.ts`'s post-submit success message
  repeats it — so this doesn't need to be said manually when sharing the
  link.
- If a client-side script mutates an attribute React also controls on an
  element before/during hydration (e.g. `themeScript` toggling the `.dark`
  class on `<html>` — see "Theme" below), React throws a hydration-mismatch
  error comparing the server-rendered attribute to the client's. Fixed by
  adding `suppressHydrationWarning` to that element (`<html>` in
  `src/app/layout.tsx`) — the standard next-themes-style fix. Apply the same
  fix to any future element whose attributes get patched by a pre-hydration
  inline script.
- `src/proxy.ts` is Next.js 16's name for middleware (session refresh via
  `getUser()`); older docs/comments saying "middleware" mean this file.

## Static assets: flags, logos, icons (reference)
All generated by one-off scripts in `scripts/` — not part of the build or
`/api/sync`. Commit the files they write.

- **Flags** (`node scripts/copy-flags.mjs`): `src/lib/flags.ts` maps the 48 WC2026
  country names (openfootball's `team1`/`team2`) to flag-icons codes; SVGs in
  `public/flags/`, copied from the `flag-icons` npm package. Knockout placeholders
  ("1A", "W74") have no entry and render no flag.
- **Club logos** are looked up per competition: `teamLogo(competition, team)` in
  `src/lib/team-logos.ts` (hand-written) over generated per-league maps, keyed by the
  exact name stored in `matches.team1`/`team2`. `Flag` (`src/components/flag.tsx`)
  checks the flag map first, then the logo, else renders nothing.
  - Liiga — `node scripts/copy-team-logos.mjs` → `public/teams/*.webp|png` +
    `src/lib/team-logos-liiga.ts` (keyed by liiga.fi `teamName`). Never hotlink the
    liiga.fi CMS URLs. Re-run when a team is promoted or the season (URL in the script,
    keep in sync with `src/lib/liiga.ts`) changes.
  - NHL — `node scripts/copy-nhl-logos.mjs` walks the schedule from the season start
    until it has all 32 teams → `public/teams/nhl/{abbrev}.svg` + `{abbrev}-dark.svg` +
    `src/lib/team-logos-nhl.ts` (keyed by `commonName.default`). Re-run after a
    relocation/expansion/rebrand.
  - Dark mode: a logo with a `dark` variant (Lukko, every NHL team) swaps to it via
    `dark:` classes; others sit on a near-white circle so black logos (TPS) stay
    visible. Rasters go through the image optimizer, SVGs are `unoptimized`.
- **App icons** (`node scripts/make-app-icons.mjs`, one sport-neutral mark from one SVG
  definition):

  | File | Used for |
  |---|---|
  | `src/app/icon.svg` | Browser tab |
  | `src/app/favicon.ico` | Tab fallback (16/32/48) |
  | `src/app/apple-icon.png` | iOS home screen (180×180, fully opaque — iOS turns transparency black) |
  | `public/icons/icon-192.png`, `icon-512.png` | Manifest, `purpose: "any"` |
  | `public/icons/maskable-192.png`, `maskable-512.png` | Manifest, `purpose: "maskable"` (mark inside the 80% safe zone) |

  The `src/app` files are Next.js metadata conventions (Next adds the `<link>` tags);
  the `public/icons` ones are listed in `src/app/manifest.ts` (standalone,
  `start_url` `/matches`). The root layout also sets `appleWebApp` metadata.

## Theme: dark/light toggle (reference)
The whole app's dark mode is a manual, app-wide toggle (default dark) instead of
following OS preference:

- `src/app/globals.css` defines color tokens (`--background`, `--foreground`,
  `--surface`, `--surface-2`, `--line`, `--muted`, `--green*`, `--gold`,
  `--red`, podium `--gold-*`/`--silver-*`/`--bronze-*`, login `--input-bg`/`--warn-*`,
  all OKLCH) in `:root` (light) and `.dark` (dark), plus
  `@custom-variant dark (&:where(.dark, .dark *));` — this repoints every
  `dark:` Tailwind utility at a `.dark` class on `<html>` instead of
  `prefers-color-scheme`.
- `src/components/theme-provider.tsx` exports `ThemeProvider`/`useTheme`
  (tracks the toggle via `useSyncExternalStore` on
  `document.documentElement.classList`, persists to
  `localStorage['fb-dark']`; default is dark — anything other than the
  literal string `'false'`) and `themeScript`, a string of inline JS.
- `src/app/layout.tsx` injects `themeScript` into `<head>` so the `.dark`
  class is applied *before* React hydrates (no flash of the wrong theme),
  and wraps the app in `ThemeProvider`. Because that script mutates
  `<html>`'s class before hydration, `<html>` has `suppressHydrationWarning`
  — see Gotchas.
- `src/components/theme-toggle.tsx` (`ThemeToggle`, ☀/🌙 button) is rendered in
  `AppHeader` (`/matches`, `/leaderboard`, `/stats`). `/login` has no header, so it
  gets its own labeled pill toggle (`src/app/login/theme-toggle-pill.tsx`,
  `ThemeTogglePill`) below the sign-in card — same `useTheme` hook. The home page (`/`)
  has no toggle control but still follows the `.dark` state.
- Font is `next/font/google`'s `Space Grotesk` (`--font-space-grotesk` in
  `src/app/layout.tsx` / `globals.css`).

## Cron setup (DONE — reference only)
1. Go to https://cron-job.org, sign up / log in.
2. Create a new cronjob:
   - URL: `https://friendly-bets-rust.vercel.app/api/sync`
   - Schedule: every 5 minutes. The feeds aren't live, so a faster schedule doesn't
     bring in-match scores sooner; it means `settle_match` fires within ~5 minutes of a
     match crossing the 3-hour-post-kickoff threshold.
   - Request method: GET
   - Add a custom header: `Authorization: Bearer <SYNC_SECRET>` (value from
     `.env.local` / Vercel project env vars — do not commit it anywhere)
3. Save, then use cron-job.org's "Run now" / test execution to confirm it
   returns `{"synced": <n>, "settled": [...]}` with HTTP 200 (504 if a feed timed out).

## Google OAuth (DONE — code + dashboard, reference only)
Google sign-in was added alongside (not replacing) magic-link auth. The code: a
`GoogleButton` client component
(`src/app/login/google-button.tsx`) calls
`supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`
from the browser, rendered under an "or" divider on `/login` below the
magic-link form. The existing `/auth/confirm` route already exchanges the
returned `?code=...` via `exchangeCodeForSession` — OAuth and magic links use
the identical PKCE return flow, so **no new callback route was needed**.
`redirectTo` is built from `window.location.origin` (env-aware: localhost in
dev, the Vercel URL in prod — no hardcoding; this is the *browser* origin, not
the server-only `NEXT_PUBLIC_SITE_URL` the magic-link action uses). The
new-user `profiles` trigger (`on_auth_user_created`, AFTER INSERT on
auth.users — `20260609000000_initial_schema.sql`) fires for Google signups
too; since Google doesn't set `raw_user_meta_data->>'display_name'`, the
display name falls back to the email local-part.

Dashboard setup that was done (one-time, NOT in code — keep for reference if
the project is ever re-provisioned):
1. **Google Cloud Console** → APIs & Services → Credentials → Create
   Credentials → OAuth client ID → **Web application**. Authorized redirect
   URI = the Supabase callback (shown in Supabase's Google provider panel as
   "Callback URL (for OAuth)"):
   `https://tutpgfsmrfpetctkdyta.supabase.co/auth/v1/callback`. This is
   *Supabase's* callback, NOT our `/auth/confirm` — Google → Supabase →
   Supabase redirects to our `redirectTo`. (No `localhost` entry is needed in
   Google; Google only ever calls back to Supabase.)
2. **OAuth consent screen / Branding**: App name "Friendly Bets" + support
   email. Left in **Testing** mode, so each tester's Google email must be added
   under Audience → Test users (or publish the app). App name is what the
   consent screen shows.
3. **Supabase → Authentication → Providers → Google** (URL slug `/auth/providers`,
   labelled "Sign In / Providers" in the current dashboard): enabled, Client ID
   + Client Secret pasted in. "Skip nonce checks" and "Allow users without an
   email" both left OFF.
4. **Authentication → URL Configuration → Redirect URLs**: Vercel URL +
   `http://localhost:3000/**` (already present from magic-link setup; covers
   `/auth/confirm`).
5. **Authentication → Settings**: account linking enabled so a magic-link user
   and a Google user with the same *verified* email become one account. Both
   providers give verified emails, so this is safe.

Gotcha — the Google consent screen shows the raw
`tutpgfsmrfpetctkdyta.supabase.co` domain (not "Friendly Bets") as the site
you're signing in to, and lists "name + email" access. This is **expected** for
any Supabase-hosted OAuth (Google sees Supabase, which owns the callback, as the
requesting party) and minimal (just the basic email/profile scopes). Setting the
consent-screen App name/logo softens it ("Sign in to Friendly Bets"); fully
replacing the `supabase.co` domain would need a paid Supabase custom domain —
deliberately not worth it for a family app.

## Email / SMTP (DONE — reference only)
Supabase's default/shared email service caps magic-link sends at 2/hour
project-wide (`supabase/config.toml` `[auth.rate_limit] email_sent = 2` —
that's the default for *every* Supabase project, hosted included). When exhausted,
a login attempt fails immediately with "Email rate limit exceeded" /
`error_code: over_email_send_rate_limit` and sends nothing.

Fixed with custom SMTP via Brevo (https://www.brevo.com, free tier — 300
emails/day, no domain required):
- Brevo: a sender email is verified under Settings -> Senders, Domains &
  Dedicated IPs -> Senders.
- Brevo: Settings -> SMTP & API -> SMTP tab gives a dedicated SMTP login
  (format `xxxxx@smtp-brevo.com` — **not** the Brevo account email) and an
  SMTP key (generated once, shown only at creation time).
- Supabase Dashboard -> Authentication -> Emails -> SMTP Settings: Custom
  SMTP enabled, host `smtp-relay.brevo.com`, port `587`, username = the
  `xxxxx@smtp-brevo.com` login, password = the SMTP key, sender = the
  verified Brevo sender address.
- Supabase Dashboard -> Authentication -> Rate Limits -> "Rate limit for
  sending emails" raised from 2 to ~30/hour (now bounded by Brevo's quota,
  not Supabase's shared mailer).

These credentials live ONLY in the Supabase dashboard — not in `.env.local`,
not in Vercel env vars, not committed anywhere. This app never talks to
Brevo directly; only Supabase's auth server does.

## Secrets
Supabase URL, anon key, service-role key, SYNC_SECRET, and NEXT_PUBLIC_SITE_URL live
in `.env.local` (copy from `.env.local.example`; same vars go into Vercel project env
when deployed — set NEXT_PUBLIC_SITE_URL to the Vercel URL there). Service-role key is
server-only — never ship it to the client. The `/api/sync` route checks a shared secret
(`SYNC_SECRET`) passed by the external scheduler — store it in env, never commit it.
Never commit `.env*.local`.

Note: Supabase's dashboard now shows new "Publishable"/"Secret" key formats by default,
with the old `anon`/`service_role` JWTs under "Legacy API Keys" — both work identically
with `@supabase/supabase-js`. This project currently uses the legacy JWT keys.
