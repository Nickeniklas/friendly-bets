# PROJECT_CONTEXT

Self-contained summary — paste into Claude project knowledge so fresh chats start informed.

## Project
A fun, non-commercial prediction game for family & friends (~10–50 people), for the
2026 FIFA World Cup. No real money, ever. Live at
`https://friendly-bets-rust.vercel.app`. **v2 is complete and live**, and the
tournament itself has now finished (the final was 2026-07-19). View matches,
predict home/draw/away, a leaderboard with a period selector, and a stats tab.
Built by an owner who is new to Next.js and has no football knowledge (which is
exactly why the scoring design needs no oddsmaking).

## Stack (settled — do not re-litigate)
- Next.js (App Router, TypeScript) on Vercel, auto-deploy on push to `main`
- Supabase — Postgres + Auth (magic link via Brevo SMTP + Google OAuth) + realtime
- openfootball worldcup.json for fixtures + results (free, no API key)
- No odds — a fixed-points scoring model (see below)
- Sync + settlement run together in a protected `/api/sync` route, triggered **every
  5 minutes** by cron-job.org (Vercel Hobby cron is once-daily only, so the schedule
  lives outside Vercel)

## How the game works (fixed-points model, replaced parimutuel 2026-06-16)
- No stakes, no pools. A bet just picks one of three outcomes: `team1` (home win) /
  `draw` / `team2` (away win). Draw is a first-class pickable outcome.
- Everyone starts at 0 points; balances may go negative (intended).
- **Correct pick: +10.** A pick is correct if it matches the overall result OR the
  full-time (90-min) result (`result_ft`) — so on a knockout decided in extra
  time/penalties, both a `draw` pick and the advancing team's pick win.
- **Underdog bonus: +5** if the picked outcome got fewer than 33% of the match's bets
  (per picked outcome, since two outcomes can win a knockout).
- **"Wins in 90′" bonus: +5** — on knockout matches only, a team pick can be upgraded
  to predict the team leads at full time; graded strictly on `result_ft` (loses if the
  team only advanced via ET/pens).
- **Wrong pick: −5.** No push/refund logic exists.
- Settlement is automatic: the sync job settles any match with a result, kickoff >3h
  ago, not yet settled. `settle_match` is atomic, idempotent, and the ONLY path that
  changes a balance.
- A separate accuracy view tracks bets placed / correct / wrong / win rate % / streak.

## Auth
- Magic link (`/login` → `/auth/confirm`, custom SMTP via Brevo — Supabase's shared
  mailer caps at 2 emails/hour) plus **Google OAuth** (same `/auth/confirm` PKCE
  return path). Account linking enabled, so same-email users merge into one account.
- Guests can browse `/matches`, `/leaderboard`, and the public `/stats` sections
  without logging in.

## Pages
- `/matches` — Upcoming/Live/Past tabs, date-grouped ("washi tape" banners), Finnish
  kickoff times, team flags, three-way pick with crowd-split %, real scores on Past
  (incl. a.e.t./pens), mobile-first design, dark/light toggle (app-wide, default dark).
- `/leaderboard` — top-3 podium + one sortable all-players table, with a period
  selector: All time / Last 10 / one pill per settled tournament round.
- `/stats` — You (login-gated personal stats) / The Crowd / Records sections, all
  derived from existing data.
- `/login` — magic link + Google + guest link.

## Key decisions & why
- Fixed points over parimutuel: pools broke down at small scale (thin pools, payout
  swings); the points model needs zero oddsmaking and rewards prediction skill.
- openfootball over a paid API: free, no key; not a live feed, so the 5-min sync
  mainly means settlement fires promptly, not live scores.
- Idempotency is the core pattern: `settle_match` (and formerly `claim_daily_bonus`)
  are safely re-callable.
- Daily login bonus **disabled 2026-06-16** (inflated the prediction score); its RPC +
  columns remain dormant in the DB, EXECUTE grant revoked from all client roles.
- `result_ft` column (2026-06-30) fixes knockout draw picks: openfootball stores the
  advancer as `result`, so 90-min draws were wrongly graded as losses before.
- Match-score columns (`ft_/et_/p_team1`/`2`, 2026-07-01) are display-only, never
  graded, and excluded from the sync's result "freeze" so they backfill on every sync.

## Build context
- Building in VS Code with Claude Code; conversations with Claude are planning
  sessions producing structured prompts.
- Owner is new to Next.js — prefers conventional, well-commented code and brief
  explanations of non-obvious choices. Prefers direct decisions over option menus.
- Docs maintained in repo: `CLAUDE.md` (current state), `docs/SCHEMA.md` (data model +
  settlement contract), `docs/PLAN.md` (reference-only design rationale),
  `docs/HISTORY.md` (full build log).
- No test suite — verify with `npx tsc --noEmit` + eslint.

## Open items
- None. No known open bugs; v2 is feature-complete and the tournament has ended.

## v3 ideas (backlog — don't start without being asked)
- Live in-match scores/stats (needs a different data source than openfootball).
- Knockout-bracket-specific logic (predict who advances, bracket-wide scoring).
- Crowd facts in `/stats` still key off `result` (advancer) not `result_ft` — known
  minor inconsistency, deliberately left.
- Guard against orphaned match rows from `buildExternalRef`'s dual keying. If
  openfootball adds a `num` to a match that previously had none, the external_ref
  changes and the next sync inserts a new row while the old one is orphaned — never
  updated, never settled, but still `scheduled` and therefore bettable. This bit the
  third-place match and final (ghost "L101 vs L102" / "W101 vs W102" cards, deleted
  2026-07-18). Simplest fix if this codebase is reused: a sync-time report of any
  match row whose `external_ref` no longer appears in the feed (report, don't
  auto-delete — deleting cascades to bets). Not worth building for WC2026, which has
  ended.