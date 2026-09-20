# friendly-bets

A non-commercial sports prediction game for family & friends — built for the World
Cup 2026, now running the **Liiga 2026–27 regular season** (Finnish ice hockey), with
a header dropdown to switch competitions. See `CLAUDE.md`
and `docs/PLAN.md` / `docs/SCHEMA.md` for the full spec, build order, and current status.
`docs/HISTORY.md` has the detailed step-by-step build log.

## Status

**v2 is complete and live** at `https://friendly-bets-rust.vercel.app`.

> **2026-09-18 — Liiga + multiple competitions.** The active competition is now the
> Liiga 2026–27 regular season; the finished World Cup stays selectable from a
> dropdown in the header. Same game (home/draw/away, +10 / +5 underdog / −5), with
> hockey graded on the 60-minute result. DB changes are in
> `supabase/migrations/20260918120000_competitions.sql` (applied). See "Competitions"
> below.

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
  reduced from every 2-3h on 2026-06-14) — pulls Liiga fixtures/results from
  liiga.fi (openfootball, the WC source, is no longer fetched), upserts `matches`,
  and auto-settles via `settle_match`. The Vercel project is
  connected to this GitHub repo for auto-deploys on push to `main`.
- Auth is built two ways: **magic link** (`/login` sends a sign-in email,
  `/auth/confirm` completes it) and **Google OAuth** (a "Sign in with Google"
  button on `/login`, same `/auth/confirm` return path). The home page shows the
  logged-in user's name + points balance with a sign-out button. Session cookies
  are kept fresh by `src/proxy.ts`. `NEXT_PUBLIC_SITE_URL` is set in Vercel and
  verified live. See "Auth" below.
- The match list page (`/matches`) splits the selected competition's fixtures into
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
  streak). A segmented **period selector** sits above the podium: **All time**
  (the selected competition's settled bets), **Last 10** (each player's recent
  form), and one pill per **period** that has settled bets — a tournament round
  for football, a game week for hockey (newest first) — both the podium and the
  table re-scope to the selected period. Linked from the home page and
  `/matches`.
- Stats tab (`/stats`) "for the curious": a **You** section (login-gated —
  your accuracy by period, pick tendencies, contrarian record, ranking and best
  calls), a public **The Crowd** section (wisdom-of-the-crowd accuracy, biggest
  upset, most divisive/consensus matches, draw-shyness, fan favourite), and a
  public **Records** section (league-wide superlatives). All derived from
  existing data — no new DB objects. See "Stats" below.
- Vercel Web Analytics is enabled (`@vercel/analytics`).
- Magic-link emails go through custom SMTP (Brevo) — Supabase's default
  shared mailer caps at 2 emails/hour, which isn't enough for multiple
  people signing in. See `CLAUDE.md` ("Email / SMTP") for setup details.
  Since the sending address has no domain reputation yet, `/login` shows a
  reminder to check spam/junk for the magic-link email.
- Team flags (World Cup) and club logos (Liiga) are shown next to team names
  on `/matches` (see "Team flags and logos" below).
- Daily login bonus — **disabled 2026-06-16** (it inflated the prediction
  score under the new fixed-points model). The DB RPC/columns remain dormant;
  all app wiring was removed. See "Daily login bonus (disabled)" below.
- `/matches` has a mobile-first redesign: sticky header with points total + a
  dark/light toggle, a dismissible "How to play" card, tap-an-outcome
  predicting (home / draw / away), and a bottom Matches/Leaderboard/Stats tab
  bar (see "Place a prediction" and "Theme" below). The dark/light toggle is
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
Login) are implemented, plus the `/stats` tab (the former "Analysis tab" v3
idea, shipped 2026-06-29). Anything else further is a v3 idea — see
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

Expect `{"synced": <count>, "settled": [...]}` (plus `feedErrors` if a feed failed —
that feed is skipped for the tick, the rest still runs). The `matches` table should
populate with Liiga 2026–27 regular-season games (`competition = 'liiga-2027'`).

### Competitions

Every match belongs to a row in the `competitions` table (`wc2026` = World Cup 2026,
football, finished; `liiga-2027` = Liiga 2026–27, hockey, active). The dropdown in the
sticky header (`src/components/competition-select.tsx`) stores the choice in the
`fb-competition` cookie and refreshes the page; `getSelectedCompetition()`
(`src/lib/competitions.ts`) reads it on the server and falls back to the first active
competition. `/matches`, `/leaderboard` and `/stats` show only the selected
competition — points and standings are summed from that competition's bets.

Liiga data comes from liiga.fi's public site API (`src/lib/liiga.ts`, one request per
sync). Hockey is graded on the **60-minute result**: a game tied after regulation is a
**Draw**, whoever wins in overtime or the shootout. So a Past card's headline score is
always the **60-minute score** (a 2–2 headline means Draw won), with the final score
underneath as a note: "3–2 OT" after overtime, "5–4 SO" after a shootout (regulation +
the shootout decider, the way liiga.fi counts it), nothing for a regulation finish.
Football keeps its "a.e.t." / "pens" notes with the after-extra-time headline. The
"Win in 90′" option only exists on World Cup knockout matches.

To add a competition (e.g. NHL): insert a `competitions` row, write a parser in
`src/lib` that returns `MatchRow[]`, and add it to the `feeds` list in
`src/app/api/sync/route.ts`. No page changes needed.

### Auth (magic link + Google)

`/login` offers two sign-in options, separated by an "or" divider:

1. **Magic link** — enter an email, get a sign-in link.
2. **Sign in with Google** — OAuth via the Google provider.

Both end at the same `/auth/confirm` route, which exchanges Supabase's PKCE
`?code=...` for a session (the flow is identical for both). The new-user
`profiles` trigger fires the same way regardless of which method created the
account, so a Google signup gets a profile just like a magic-link signup.

`/login` also has a "View matches as guest" button (a full-width bordered
button directly under the sign-in options) — `/matches` and `/leaderboard` are
public (read-only without login), so visitors can browse before signing in;
they just can't place predictions until they do. Guests aren't stranded on
those pages either: the shared sticky header (`src/components/app-header.tsx`)
shows a green **"Log in"** link when no one is signed in (handy for someone
linked straight to `/matches`), and swaps it for a "Sign out" button
(`src/components/sign-out-button.tsx`) once signed in.

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

For an active competition (Liiga), Upcoming and Past only show the next / last 14
days — a regular season has ~540 games. The finished World Cup shows everything.

Within each tab, matches are grouped under a sticky date header per kickoff
day, styled as a bold green "washi tape" banner (clipped/angled corners) with
the date and that day's match count. Kickoff times are shown in Finnish time
(`Europe/Helsinki`, handles the EET/EEST daylight-saving switch automatically)
— `kickoff_at` itself is still stored in UTC. A tab with no matches shows a
short message (e.g. "No live matches right now") instead of a blank area.

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
(Correct +N / Wrong −5) once `settle_match` runs. A settled prediction is only
ever Correct or Wrong — there's no refund, so picking home/away on a match that
ends in a draw is just a wrong pick (−5); only a correct `draw` pick wins.
Scoring lives in the rewritten `settle_match` RPC
(`20260616000000_accuracy_points_model.sql`).

### Leaderboard

`/leaderboard` is a read-only Server Component (anyone can view, no login
required). At the top, a segmented **period selector**
(`src/components/leaderboard-view.tsx`, `LeaderboardView`) lets you switch
which period the podium + table show:

- **All time** (default) — aggregated from the selected competition's settled
  bets; lists every registered player (zeros for those with no settled bets in
  that competition). `profiles.points_balance` is no longer shown — it's a
  running total across all competitions.
- **Last 10** — each player's recent form, aggregated over only their 10 most
  recent settled predictions (newest first, across all rounds).
- **One pill per period** — what a period is depends on the competition's
  **sport** (never its id):
  - *football* → the tournament round (`Group stage`, `Round of 32`, …,
    `Final`), in tournament order;
  - *hockey* → the game week (`Week 12`, from `matches.group_label`, which
    `src/lib/liiga.ts` fills in), **newest week first**, so the current week is
    the first pill after Last 10. A league season has one `stage` for every
    match, so grouping it by round would just duplicate All time.

  A pill appears only once that period has settled bets, and shows only the
  players who predicted in it. The helpers (`periodKey` / `periodLabel` /
  `orderPeriodKeys` / `periodNoun`) live in `src/lib/stats.ts` next to
  `STAGE_LABELS` / `STAGE_ORDER` and are shared with `/stats`; an unknown sport
  falls back to the football behavior.

The period and Last-10 standings are aggregated **in JS, server-side** from a
single settled-bets fetch (joined to each match's `stage` + `group_label`)
using the same formulas as the `accuracy` view — no new DB view/RPC. Every period's standings
are precomputed on the server and handed to `LeaderboardView`, so switching
pills is instant (no refetch).

For the selected period: if it has at least 3 players, the top 3 by points are
shown as a podium (gold/silver/bronze circular avatars with initials, over
medal-colored bases). Below it, `LeaderboardTable`
(`src/components/leaderboard-table.tsx`) shows that period's players in one
sortable table: rank, player, points, bets, correct, wrong, win rate %, and 🔥
streak.

Tap any column header to sort by it; tapping the active column again toggles
ascending/descending (an arrow shows the direction). All six numeric columns
are sortable. Sorting is entirely client-side (`useState`/`useMemo`, no
refetch), defaults to points descending on load, and the rank column always
reflects the current sort order.

### Stats

`/stats` is a third read-only tab "for the curious" (anyone can view; the
personal section is gated behind login). Like `/leaderboard`, it's a Server
Component that computes everything up front and hands precomputed sections to a
client switcher (`src/components/stats-view.tsx`, `StatsView`) — switching is
instant, no refetch. Like the other pages it only covers the selected
competition. All aggregation lives in `src/lib/stats.ts` (pure
functions; same formulas as the `accuracy` view), and it needs **no new DB
view/RPC** — everything derives from the existing `bets`, `matches`,
`match_bet_counts`, `profiles`, and `accuracy` objects.

Three sections:

- **You** (login-gated; guests see a "log in to unlock" card) — overview tiles
  (points, rank, win %, current/best streak, predictions), accuracy by period
  (round or week, see the Leaderboard section — the card is titled "Accuracy by
  round" / "Accuracy by week" accordingly),
  your home/draw/away pick tendencies, your record with vs. against the crowd
  plus underdog calls landed, where you rank vs. the field, and your best/
  toughest single calls.
- **The Crowd** (public) — wisdom-of-the-crowd accuracy %, biggest upset, most
  divisive and strongest-consensus matches (as 3-way split bars), whether we're
  draw-shy, and the most-backed team.
- **Records** (public) — longest win streak, biggest single-period haul
  ("Biggest single-round haul" for football, "…single-week haul" for hockey),
  best
  underdog hunter, most accurate, most predictions, sharpest contrarian
  (rate-based records need at least 5 settled predictions to qualify).

### Team flags and logos

`/matches` shows a small mark next to each team name: a country flag for
national teams, a club logo for Liiga teams, nothing otherwise. The `Flag`
component (`src/components/flag.tsx`) checks the flag map first, then the logo
map, and renders nothing for names in neither.

**Flags.** `src/lib/flags.ts` maps the 48 real WC2026 country names (as they
appear in openfootball's `team1`/`team2`) to
[flag-icons](https://flagicons.lipis.dev/) codes. The SVGs live in
`public/flags/`, copied from the `flag-icons` npm package by
`scripts/copy-flags.mjs`, which is also how to add a flag later. Knockout-bracket
placeholders (`"1A"`, `"W74"`, etc.) have no entry and got no flag; as of
2026-07-18 the bracket is fully resolved, so none remain.

**Club logos.** liiga.fi's games API (the same one `/api/sync` uses) includes
each team's logo, but as CMS asset URLs that can change, so the app doesn't
hotlink them. `scripts/copy-team-logos.mjs` fetches the feed once, downloads
every team's logo into `public/teams/` (`kalpa.webp`, plus `lukko-dark.png`
where liiga.fi has a separate dark-background variant) and **regenerates**
`src/lib/team-logos.ts` (`TEAM_LOGOS`, keyed by the exact `teamName` stored in
`matches.team1`/`team2`). Logos render square (`object-contain`). In dark mode
each logo sits on a small near-white circle so black logos (e.g. TPS) stay
visible. The exception is a team with its own dark-background variant (Lukko),
which switches to that variant instead, with no circle. Both follow the app's
dark/light toggle via CSS `dark:` classes, so there's no flash. Re-run the script when the team set changes
(e.g. a team is promoted) or when the season changes (update the URL in the
script to match `src/lib/liiga.ts`), then commit the images and the
regenerated map:

```bash
node scripts/copy-team-logos.mjs
```

### Icons

The app has one sport-neutral icon everywhere (a white check in a ring on the
app green), since it covers several competitions. `node scripts/make-app-icons.mjs`
generates every icon file from one SVG definition:

| File | Used for |
|---|---|
| `src/app/icon.svg` | Browser tab (scalable, rounded corners) |
| `src/app/favicon.ico` | Tab fallback for browsers without SVG favicons (16/32/48) |
| `src/app/apple-icon.png` | iOS "Add to Home Screen" (180×180) |
| `public/icons/icon-192.png`, `icon-512.png` | Web manifest, `purpose: "any"` |
| `public/icons/maskable-192.png`, `maskable-512.png` | Web manifest, `purpose: "maskable"` (Android adaptive icons) |

The `src/app` files are Next.js metadata file conventions, so Next adds their
`<link>` tags itself. The `public/icons` ones are listed in `src/app/manifest.ts`,
which also opens the installed app standalone on `/matches`. The home-screen PNGs
are fully opaque on purpose, because iOS turns transparent pixels black. The
maskable variants shrink the mark so it stays inside the central 80% safe zone
that Android keeps when it crops the icon to a circle or squircle.

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
