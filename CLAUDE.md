# CLAUDE.md

Operating brief for Claude Code. Read `docs/PLAN.md` and `docs/SCHEMA.md` for full detail.
For a step-by-step account of how v1 was built (including bugs found and fixed along the
way), see `docs/HISTORY.md` — that detail has been moved out of this file to keep this
brief current and short.

## Status (as of 2026-06-16)
**v1 is complete and live** at `https://friendly-bets-rust.vercel.app`. All of
`docs/PLAN.md`'s build order (steps 1-8) is DONE:

> **2026-06-16 — model change: parimutuel → accuracy/points.** The staking/pool model
> was replaced with a fixed-points prediction model (see "Scoring rules" below): no
> stakes/pools/multipliers; players pick `team1`/`draw`/`team2`; correct = +10 (+5 if the
> outcome got <33% of bets = underdog), wrong = −5; balances start at 0 and may go
> negative. Draw is now a first-class pickable outcome. DB changes are in
> `supabase/migrations/20260616000000_accuracy_points_model.sql` (new `points_awarded`
> column, `pick` allows `draw`, stake column unused, stake-deduction trigger dropped,
> `settle_match` rewritten, profiles default 0). **Manual step:** apply that migration
> (`supabase db push` or paste into the SQL editor) — it also resets all existing
> balances to 0.

- Supabase schema, RPC (`settle_match`), `accuracy` view, RLS, and GRANTs are applied.
- `/api/sync` is deployed, protected by `SYNC_SECRET`, and triggered every 5 minutes by
  cron-job.org (syncs openfootball fixtures/results and auto-settles finished matches).
- Magic-link auth (`/login`, `/auth/confirm`, sign-out) works via custom SMTP (Brevo).
- `/matches` splits all fixtures into Upcoming/Live/Past tabs, date-grouped under sticky
  headers, with a three-way pick (home/draw/away) per bettable match and a crowd-split
  (% of picks per outcome) display. Kickoff times are shown in Finnish time.
- `/leaderboard` shows a points podium (top 3) plus one sortable all-players table
  (points, bets, correct, wrong, win %, streak).
- Vercel Web Analytics is enabled.

Post-v1 polish:
- `/login` now shows a persistent reminder (plus a post-submit message) to check
  spam/junk for the magic-link email, since the Brevo sending address has no domain
  reputation yet (commit `a85216a`).
- `/matches` now shows a small flag next to each team name (`src/components/flag.tsx`,
  `src/lib/flags.ts`, SVGs in `public/flags/` — see README "Team flags").
- Daily login bonus — **DISABLED 2026-06-16.** It was a streak-based 100-400
  point bonus on first page load each UTC day; under the new fixed-points
  scoring model it just inflated the prediction score, so all wiring was
  removed: `<DailyBonusToast />` unmounted from the layout, and the
  `claimDailyBonus()` action + `DailyBonusToast` component deleted. The DB
  objects are left dormant (never called): the `claim_daily_bonus()` RPC and
  the `profiles.last_bonus_date` / `streak_count` columns from migration
  `20260613000000_daily_bonus.sql` still exist but nothing invokes them. To
  re-enable later, restore the toast/action wiring. See `docs/HISTORY.md`.
- `/matches` got a mobile-first visual redesign (commit `02cd971`, merged to
  `main` 2026-06-13), implemented from a Claude Design mockup
  (`Matches.dc.html`): sticky header with a points pill + dark/light toggle, a
  dismissible "How to play" card (`intro-card.tsx`), tap-an-outcome predicting
  (`match-card.tsx`), read-only confirmed-pick/result rows, and a fixed bottom
  Matches/Leaderboard tab bar (`bottom-nav.tsx`). The dark/light toggle
  (default dark) is app-wide — see "Theme" below. **Note (2026-06-16):** the
  original design's stake mechanics (50/100/200/500pt quick-pick chips +
  live potential-win estimate) were removed in the move to the fixed-points
  model — the bet panel is now a three-way Home/Draw/Away pick with no stake.
- `/leaderboard` got the matching redesign (commit `4ad4e9a`, 2026-06-14),
  implemented from the same Claude Design bundle's `Leaderboard.dc.html`:
  same sticky header (brand + `ThemeToggle`, no balance pill) and bottom nav
  as `/matches`, and a podium for the top 3 players (gold/silver/bronze
  circular avatars with initials over medal-colored bases —
  `PODIUM_CONFIG` in `src/app/leaderboard/page.tsx`). Falls back to no podium
  if there are fewer than 3 players. New podium color tokens added to
  `globals.css`: `--gold-bg`, `--gold-text`, `--gold-base-bg`, `--silver-*`,
  `--bronze-*` (light + dark).
- `/leaderboard`'s ranked list (4th+) and separate accuracy table were later
  replaced by **one sortable all-players table** (commit `7407268`,
  2026-06-14) — `src/components/leaderboard-table.tsx` (`LeaderboardTable`,
  `"use client"`). The podium above is unchanged (still points-only, top 3,
  not sortable). The table covers every player with columns rank, player,
  points, bets placed, correct, wrong, win rate %, streak; all six numeric
  columns are sortable by clicking the header (toggles ascending/descending,
  ▲/▼ shows the active column; default is points descending), and rank
  recomputes to match. `src/app/leaderboard/page.tsx` joins `profiles` +
  the `accuracy` view into one row per player (players with no settled bets
  default to zeros, since they're absent from `accuracy`) and passes that to
  `LeaderboardTable`, which sorts entirely client-side — no refetch on
  re-sort. See `docs/HISTORY.md`.
- `/login` got the matching redesign (commit `117e670`, 2026-06-14),
  implemented from the same bundle's `Login.dc.html`: centered ⚽ Friendly
  Bets / World Cup 2026 logo, a "Sign in" card (email input + green "Send
  magic link →" button, reusing the existing `signInWithMagicLink` action and
  `SubmitButton` pending-state pattern), the existing spam/timing/
  double-submit warnings restyled as a "Heads up" card, and a labeled
  dark/light toggle pill below the card (`src/app/login/theme-toggle-pill.tsx`,
  `ThemeTogglePill` — same `useTheme` hook as `ThemeToggle`, styled per the
  design since `/login` has no header). New tokens added to `globals.css`:
  `--input-bg`, `--warn-bg`, `--warn-border` (light + dark).

- `/matches` kickoff times now display in Finnish time (`Europe/Helsinki`,
  handles the EET/EEST DST switch automatically) instead of UTC — only the
  display changed, `kickoff_at` is still stored in UTC. Commit `d92506a`.
- `/matches` is now split into Upcoming/Live/Past tabs (default Upcoming),
  each date-grouped under sticky headers with a match count and an
  empty-state message. Upcoming/Live are soonest-first; Past is
  most-recent-first. New `src/app/matches/matches-tabs.tsx` (`MatchesTabs`)
  plus `groupByDay()`/`renderMatchCard()`/`renderDayGroups()` helpers in
  `src/app/matches/page.tsx`. Commit `f75ddf8`. See `docs/HISTORY.md` for
  details.

All three pages from the Claude Design bundle (`Matches.dc.html`,
`Leaderboard.dc.html`, `Login.dc.html`) are now implemented and visually
consistent (shared header/bottom-nav/theme system where applicable). No known
open bugs and no further UI redesign work is planned — anything else is a v2
idea (see `docs/PLAN.md` "v2 ideas"), not part of the original plan, don't
start on these without being asked.

- `src/middleware.ts` was renamed to `src/proxy.ts` (commit `4cb951a`,
  2026-06-14) — Next.js 16 renamed this file convention from "middleware" to
  "proxy" (`config.matcher` export unchanged). Purely a naming/convention
  change, no behavior change. If you see references to "middleware" in older
  docs/comments, they mean this file.
- `/api/sync`'s cron-job.org schedule was reduced from every 2-3h to every 5
  minutes (2026-06-14, external config change, no code) — see "Cron setup"
  below. The openfootball source itself isn't updated live, so this doesn't
  bring live in-match scores any sooner; the real benefit is that
  `settle_match` now fires within ~5 minutes of a match crossing the
  3-hour-post-kickoff threshold, instead of up to ~3h late.
- Google OAuth sign-in added to `/login` alongside magic-link auth
  (2026-06-16) — see "Google OAuth" below. Same `/auth/confirm` PKCE return
  path; magic-link flow unchanged. The login buttons (Google + magic-link
  submit) also got hover/active polish (lift + shadow, matching the
  match-card interaction) — `src/app/login/google-button.tsx` and
  `src/app/login/submit-button.tsx`.

## Cron setup (DONE — reference only)
1. Go to https://cron-job.org, sign up / log in.
2. Create a new cronjob:
   - URL: `https://friendly-bets-rust.vercel.app/api/sync`
   - Schedule: every 5 minutes (reduced from every 2-3h on 2026-06-14 — see
     "Status" above; cron-job.org's free tier supports down to 1-minute
     intervals)
   - Request method: GET
   - Add a custom header: `Authorization: Bearer <SYNC_SECRET>` (value from
     `.env.local` / Vercel project env vars — do not commit it anywhere)
3. Save, then use cron-job.org's "Run now" / test execution to confirm it
   returns `{"synced": <n>, "settled": [...]}` with HTTP 200.

## Google OAuth (DONE — code + dashboard, reference only)
Google sign-in was added alongside (not replacing) magic-link auth — purely
additive, 2026-06-16. The code: a `GoogleButton` client component
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
display name falls back to the email local-part. The magic-link flow was not
touched.

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
that's the default for *every* Supabase project, hosted included). During
early testing this got exhausted, and a login attempt failed immediately with
"Email rate limit exceeded" / `error_code: over_email_send_rate_limit` and
sent nothing.

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

Since this sender has no domain reputation yet, first-time recipients often
find the magic-link email in spam/trash. `/login` now tells users this
directly (see Gotchas) — no need to repeat it when sharing the link.

## Theme: dark/light toggle (DONE — reference only)
The whole app's dark mode is now a manual, app-wide toggle (default dark)
instead of following OS preference:

- `src/app/globals.css` defines color tokens (`--background`, `--foreground`,
  `--surface`, `--surface-2`, `--line`, `--muted`, `--green*`, `--gold`,
  `--red`, all OKLCH) in `:root` (light) and `.dark` (dark), plus
  `@custom-variant dark (&:where(.dark, .dark *));` — this repoints every
  `dark:` Tailwind utility (across `/`, `/login`, `/leaderboard`, `/matches`)
  at a `.dark` class on `<html>` instead of `prefers-color-scheme`.
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
- `src/components/theme-toggle.tsx` (`ThemeToggle`, ☀/🌙 button) is rendered
  in both `/matches`' and `/leaderboard`'s sticky headers. `/login` has no
  header, so it instead gets its own labeled pill toggle
  (`src/app/login/theme-toggle-pill.tsx`, `ThemeTogglePill`) below the
  sign-in card — same `useTheme` hook, styled per `Login.dc.html`. The home
  page (`/`) has no toggle control yet but still follows whatever `.dark`
  state is set.
- Font is now `next/font/google`'s `Space Grotesk` (`--font-space-grotesk` in
  `src/app/layout.tsx` / `globals.css`), replacing the default Geist fonts.

## What we're building
A non-commercial World Cup 2026 prediction game for family & friends. No real money.
Players predict each match's outcome — **home win / draw / away win** (no stake) — and
earn or lose points at settlement based on whether they were right and how the crowd bet
(an underdog bonus). Everyone starts at 0 points; balances may go negative. A separate
accuracy leaderboard tracks raw prediction skill.

## Stack (decided — do not re-litigate without being asked)
- Next.js on Vercel
- Supabase: Postgres + Auth (magic link) + realtime
- Match data: openfootball `worldcup.json` (free, no key), synced every 5
  minutes via cron-job.org → `/api/sync`
- No odds — a fixed-points scoring model (see scoring rules below)

Owner is new to Next.js. Prefer clear, conventional, well-commented code over clever
tricks. Explain non-obvious Next.js / Supabase choices inline.

## Scoring rules (the points model)
- Pick one of three outcomes per match: `team1` (home win) / `draw` / `team2` (away win).
  No stake.
- **Correct pick: +10 points.**
- **Underdog bonus: +5** if the player's picked outcome got **fewer than 33%** of all
  bets placed on that match (correct underdog pick = **15** total).
- **Wrong pick: −5 points.**
- Balances may go negative — intended.

## Hard rules / invariants
- A bet may be placed ONLY while match.status = 'scheduled' AND now() < kickoff_at.
  Enforce in the DB (the `enforce_bet_window` trigger), not just the UI.
- A bet is just a prediction — `pick` ∈ {`team1`, `draw`, `team2`}, no stake, nothing
  deducted on placement. `UNIQUE (user_id, match_id)` = one prediction per match.
- Settlement (`settle_match`) is ONE atomic transaction, idempotent (skips already-settled
  matches), and is now the ONLY path that changes a balance (the daily-bonus RPC is
  disabled — see below). It is called automatically by the sync job, not by an admin. It
  writes each bet's `points_awarded` and adds it to `profiles.points_balance`.
- Underdog determination at settlement is crowd-based: the result outcome is an underdog
  if it drew fewer than 33% of all bets on the match (only correct picks can earn the
  bonus, and a correct pick's outcome is the result, so the match shares one
  determination).
- Draw is a first-class outcome — pickable, can win, counts toward the bet distribution.
  No push / refund logic exists anymore.
- Balances never change via direct client writes — only via the settlement RPC. Lock this
  down with RLS; the settlement RPC is security-definer.
- Daily login bonus (`claim_daily_bonus`) — **DISABLED 2026-06-16.** All app wiring was
  removed; the RPC + `profiles.last_bonus_date`/`streak_count` columns remain in the DB but
  dormant (nothing calls them). It inflated the prediction score under the new model. See
  the Status note above and `docs/HISTORY.md`.

## Build order
All steps DONE — see `docs/PLAN.md` for the full table and `docs/HISTORY.md` for the
step-by-step build log:
1. Supabase schema (tables, RPC, view, RLS) — see SCHEMA.md
2. openfootball sync + auto-settle (`/api/sync`, cron-job.org)
3. Next.js skeleton + Supabase client helpers + magic-link auth
4. Match list page (`/matches`)
5. Place-pick flow (`placeBet` server action — three-way pick, no stake)
6. `settle_match` RPC (idempotent, called by the sync job)
7. Leaderboard + accuracy view (`/leaderboard`)
8. Polish: crowd-split (% of picks per outcome) display on `/matches`

## Gotchas
- openfootball has no clean match id. Implemented external_ref strategy (see
  `src/lib/openfootball.ts`): knockout matches (have a stable `num` field) →
  `wc2026-m{num}`; group-stage matches (stable team names from day one, no `num`) →
  `{date}-{team1}-{team2}` slugified. Knockout team1/team2 start as placeholders
  ("2A", "W74") that get overwritten as the bracket resolves — keying on team names
  there would create duplicate rows on re-sync, hence the num-based key for knockouts.
- Don't re-deduct loser stakes at settlement; they were taken at placement.
- accuracy is a derived VIEW, not a stored table — keeps it from drifting.
- RLS policies alone aren't enough — Postgres also requires baseline table GRANTs
  for anon/authenticated/service_role (a separate permission layer checked *before*
  RLS; service_role's BYPASSRLS doesn't skip it). Tables created via `supabase db push`
  didn't get Supabase's usual auto-grants, causing "permission denied for table X".
  Fixed in `supabase/migrations/20260610120000_grants.sql` — if new tables are added
  later, grant there too.
- Magic-link auth: Supabase's *default* email service won't let you edit email
  templates (Authentication -> Email Templates shows "Set up custom SMTP to edit
  templates"). No need — `@supabase/ssr` defaults to the PKCE flow, so the default
  "Magic Link" email's link goes through Supabase's hosted `/auth/v1/verify` and
  redirects back to `emailRedirectTo` with `?code=...`. `/auth/confirm/route.ts`
  exchanges that via `exchangeCodeForSession` (it also accepts `token_hash`/`type`
  as a fallback if custom SMTP + a customized template are set up later). Only
  manual step needed is Authentication -> URL Configuration: Site URL = the
  Vercel URL, and Redirect URLs include both the Vercel URL and
  `http://localhost:3000/**`. DONE.
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
- The stake-deduction trigger (`deduct_stake_on_bet`) was DROPPED in
  `20260616000000_accuracy_points_model.sql` — the points model has no stake,
  so nothing is deducted on bet placement. Migrations `20260611000000_*` (its
  SECURITY DEFINER fix) and the `stake > 0` check are now dead history; left in
  place but no longer active. The general caution still applies: any trigger
  that writes to a table the calling role lacks a GRANT/RLS policy for must be
  `SECURITY DEFINER` (as `handle_new_user`, `settle_match`, and
  `claim_daily_bonus` all are).
- Convention: any action that does a real network round-trip (DB write,
  Supabase Auth call, etc.) should disable its trigger and show a "Verb-ing..."
  label while pending. For `<form action={serverAction}>`, do this with a small
  `"use client"` submit button using `useFormStatus().pending` — see
  `src/app/login/submit-button.tsx`. `match-card.tsx` instead calls the
  `placeBet` action directly (not via a `<form>`) and tracks its own `pending`
  state with `useState` for the same effect. Without this, slow round-trips
  look unresponsive and invite double-submits, which surface as confusing
  errors (stale magic-link, duplicate-pick constraint, etc.).
- Magic-link emails sent via Brevo (see "Email / SMTP" above) may land in
  spam/trash for first-time recipients, since the sending address has no
  reputation yet. `src/app/login/page.tsx` now shows a persistent reminder
  about this, and `src/app/login/actions.ts`'s post-submit success message
  repeats it — so this no longer needs to be said manually when sharing the
  link. This should improve over time as the address sends more mail.
- (Historical) `claim_daily_bonus()` was idempotent by design (date-guarded
  atomic UPDATE) so the now-deleted `DailyBonusToast` could call it on every
  mount safely. The daily bonus is disabled as of 2026-06-16 (see invariants) —
  this note is kept only for the idempotent-RPC pattern.
- If a client-side script mutates an attribute React also controls on an
  element before/during hydration (e.g. `themeScript` toggling the `.dark`
  class on `<html>` — see "Theme" above), React throws a hydration-mismatch
  error comparing the server-rendered attribute to the client's. Fixed by
  adding `suppressHydrationWarning` to that element (`<html>` in
  `src/app/layout.tsx`) — the standard next-themes-style fix. Apply the same
  fix to any future element whose attributes get patched by a pre-hydration
  inline script.

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
