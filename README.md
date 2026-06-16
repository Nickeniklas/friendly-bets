# friendly-bets

A non-commercial World Cup 2026 prediction game for family & friends. See `CLAUDE.md`
and `docs/PLAN.md` / `docs/SCHEMA.md` for the full spec, build order, and current status.
`docs/HISTORY.md` has the detailed step-by-step build log.

## Status

**v1 is complete and live** at `https://friendly-bets-rust.vercel.app`.

> **2026-06-16 — model change: parimutuel pool → fixed-points scoring.** Players no
> longer stake points. They predict each match's outcome (home win / draw / away win)
> and score fixed points at settlement: correct +10, +5 underdog bonus if the picked
> outcome got fewer than 33% of the match's bets (correct underdog = 15), wrong −5.
> Everyone starts at 0 points and balances may go negative. Draw is now a first-class
> pickable outcome. DB changes are in
> `supabase/migrations/20260616000000_accuracy_points_model.sql` (apply it with
> `supabase db push` — it resets existing balances to 0).

- Supabase schema, RPC (`settle_match`), `accuracy` view, and RLS are live (see
  `supabase/migrations/`).
- `/api/sync` (`src/app/api/sync/route.ts`) is deployed to Vercel, protected by a
  shared secret, and triggered every 5 minutes by cron-job.org (200 OK confirmed,
  reduced from every 2-3h on 2026-06-14) — pulls openfootball fixtures/results,
  upserts `matches`, and auto-settles via `settle_match`. The Vercel project is
  connected to this GitHub repo for auto-deploys on push to `main`.
- Auth is built two ways: **magic link** (`/login` sends a sign-in email,
  `/auth/confirm` completes it) and **Google OAuth** (a "Sign in with Google"
  button on `/login`, same `/auth/confirm` return path). The home page shows the
  logged-in user's name + points balance with a sign-out button. Session cookies
  are kept fresh by `src/proxy.ts`. `NEXT_PUBLIC_SITE_URL` is set in Vercel and
  verified live. See "Auth" below.
- The match list page (`/matches`) splits all World Cup 2026 fixtures into
  Upcoming/Live/Past tabs (default Upcoming), each grouped by kickoff date under
  sticky headers with stage/group, kickoff time (Finnish time), status, and a
  per-tab match count. Readable by anyone (no login needed) and linked from the
  home page.
- Place-pick flow is live: logged-in users predict one of three outcomes
  (home win / draw / away win) on any open match from `/matches`, alongside a
  crowd-split display (% of picks per outcome). The pick is inserted via a
  server action; the `enforce_bet_window` trigger and the one-pick-per-match
  UNIQUE constraint do the enforcement. Verified working end-to-end on the
  live site.
- Leaderboard (`/leaderboard`) shows a points podium (top 3) plus one
  sortable table covering every player (points, bets, correct, wrong, win %,
  streak) joined from `profiles` and the `accuracy` view. Linked from the home
  page and `/matches`.
- Vercel Web Analytics is enabled (`@vercel/analytics`).
- Magic-link emails go through custom SMTP (Brevo) — Supabase's default
  shared mailer caps at 2 emails/hour, which isn't enough for multiple
  people signing in. See `CLAUDE.md` ("Email / SMTP") for setup details.
  Since the sending address has no domain reputation yet, `/login` shows a
  reminder to check spam/junk for the magic-link email.
- Team flags are shown next to team names on `/matches` (see "Team flags"
  below).
- Daily login bonus — **disabled 2026-06-16** (it inflated the prediction
  score under the new fixed-points model). The DB RPC/columns remain dormant;
  all app wiring was removed. See "Daily login bonus (disabled)" below.
- `/matches` has a mobile-first redesign: sticky header with points total + a
  dark/light toggle, a dismissible "How to play" card, tap-an-outcome
  predicting (home / draw / away), and a bottom Matches/Leaderboard tab bar
  (see "Place a prediction" and "Theme" below). The dark/light toggle is
  app-wide.
- `/leaderboard` has the matching redesign: same sticky header + bottom nav,
  a podium for the top 3 players (gold/silver/bronze avatars and bases), and
  below it a single sortable table covering every player (see "Leaderboard"
  below).
- `/login` has the matching redesign: centered logo, a "Sign in" card with
  email input + magic-link button, the spam/timing/double-submit warnings as
  a "Heads up" card, and a labeled dark/light toggle pill (see "Theme"
  below).

No known open bugs. All three Claude Design pages (Matches, Leaderboard,
Login) are implemented. Anything else further is a v2 idea — see
`docs/PLAN.md`.

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

### Auth (magic link + Google)

`/login` offers two sign-in options, separated by an "or" divider:

1. **Magic link** — enter an email, get a sign-in link.
2. **Sign in with Google** — OAuth via the Google provider.

Both end at the same `/auth/confirm` route, which exchanges Supabase's PKCE
`?code=...` for a session (the flow is identical for both). The new-user
`profiles` trigger fires the same way regardless of which method created the
account, so a Google signup gets a profile just like a magic-link signup.

`/login` also has a "View matches as guest" link — `/matches` and
`/leaderboard` are public (read-only without login), so visitors can browse
before signing in; they just can't place predictions until they do. Once signed
in, the `/matches` and `/leaderboard` sticky headers show a "Sign out" button
(`src/components/sign-out-button.tsx`).

One-time setup in the Supabase dashboard — Authentication -> URL Configuration — DONE:

- **Site URL**: your deployed app URL (e.g. `https://friendly-bets-rust.vercel.app`)
- **Redirect URLs**: add that same URL plus `http://localhost:3000/**`

No email template edits are needed — the default "Magic Link" email works as-is.
Visit `/login`, enter an email, and click the link from the email to sign in.

Magic-link emails are sent via custom SMTP (Brevo) — see `CLAUDE.md` ("Email
/ SMTP") for why and how it's configured. First-time recipients should check
their spam folder, since the sending address has no reputation yet — `/login`
itself now reminds users of this, so you shouldn't need to repeat it when
sharing the link.

Google OAuth needs the Google provider enabled in Supabase plus an OAuth client
in Google Cloud Console (with Supabase's callback URL as the authorized redirect
URI) and account linking turned on — all done, full step-by-step in `CLAUDE.md`
("Google OAuth"). The redirect URL is environment-aware (built from the
browser's `window.location.origin`), so the same code works in dev and prod.

`NEXT_PUBLIC_SITE_URL` is set in both `.env.local` (local dev) and the Vercel
project's Environment Variables (production), so `emailRedirectTo` resolves
correctly in both environments.

### Match list

`/matches` is a read-only Server Component — `matches` is readable by anyone
via RLS, so no login is required to view it. Fixtures are split into three
tabs, each showing a match count:

- **Upcoming** (default) — not yet settled, kickoff still in the future
  (these are the bettable ones). Soonest first.
- **Live** — not yet settled, kickoff already passed (sync hasn't recorded a
  result yet). Soonest-started first.
- **Past** — settled. Most recent result first.

Within each tab, matches are grouped under a sticky date header per kickoff
day. Kickoff times are shown in Finnish time (`Europe/Helsinki`, handles the
EET/EEST daylight-saving switch automatically) — `kickoff_at` itself is still
stored in UTC. A tab with no matches shows a short message (e.g. "No live
matches right now") instead of a blank area.

### Place a prediction

On `/matches`, tap one of the three outcomes (Home win / Draw / Away win) in a
match that's still `scheduled` and hasn't kicked off yet — a confirm panel
slides open below the match card showing the scoring for that pick (correct
+10, +15 if it's an underdog under 33% of picks, wrong −5). There's no stake
to choose. Tap "Place pick →" to submit, or "Cancel" to close the panel.
Submitting inserts a row into `bets`; the `enforce_bet_window` trigger (from
`supabase/migrations/20260609000000_initial_schema.sql`) enforces the bet
window and the `UNIQUE (user_id, match_id)` constraint blocks a second pick on
the same match. Once you've predicted a match, the card shows a read-only
"Predicted — Outcome" row instead of the panel (no editing), and the result
(Correct +N / Wrong −5) once `settle_match` runs. Scoring lives in the
rewritten `settle_match` RPC (`20260616000000_accuracy_points_model.sql`).

### Leaderboard

`/leaderboard` is a read-only Server Component (anyone can view, no login
required). If there are at least 3 players, the top 3 by points balance are
shown as a permanent podium (gold/silver/bronze circular avatars with
initials, over medal-colored bases) — this is points-only and not affected by
sorting below.

Below the podium, `LeaderboardTable` (`src/components/leaderboard-table.tsx`)
shows every player in one sortable table: rank, player, points, bets placed,
correct, wrong, win rate %, and 🔥 streak. The page joins `profiles`
(points) with the `accuracy` view (bets/correct/wrong/win rate/streak,
defaulting to 0 for players with no settled bets) into a single row per
player and passes it to the table as plain data — no schema or view changes.

Tap any column header to sort by it; tapping the active column again toggles
ascending/descending (an arrow shows the direction). All six numeric columns
are sortable. Sorting is entirely client-side (`useState`/`useMemo`, no
refetch), defaults to points descending on load, and the rank column always
reflects the current sort order.

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

### Daily login bonus (disabled)

**Disabled as of 2026-06-16.** It originally awarded a streak-based 100-400
point bonus on the first app load each UTC day, but under the new fixed-points
scoring model that just inflated everyone's prediction score, so it was turned
off.

What was removed: the `<DailyBonusToast />` mount in `src/app/layout.tsx`, the
`DailyBonusToast` component, the `claimDailyBonus()` server action
(`src/app/actions.ts`), and the home page's streak display. What remains
dormant in the database (never called now): the `claim_daily_bonus()` RPC and
the `profiles.last_bonus_date` / `streak_count` columns from migration
`20260613000000_daily_bonus.sql`. To bring it back, restore the toast + action
wiring (and decide how a bonus should fit the points model).

### Theme (dark/light mode)

The whole app has a manual dark/light toggle, defaulting to dark and
persisted in `localStorage` (`fb-dark`) as a `.dark` class on `<html>` — all
`dark:` Tailwind styles across the app follow this toggle rather than your
OS theme. The ☀/🌙 toggle button (`src/components/theme-toggle.tsx`) lives
in `/matches`' and `/leaderboard`'s sticky headers. `/login` has no header,
so it shows its own labeled toggle pill instead
(`src/app/login/theme-toggle-pill.tsx`). The home page (`/`) doesn't have a
toggle control yet but still renders in whichever mode is active. See
`CLAUDE.md` ("Theme: dark/light toggle") for the implementation.
