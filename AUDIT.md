# AUDIT

Read-only audit, 2026-11-11, at commit `97f20bc`. Nothing in the repo was changed
except this file (a local `next build` refreshed the gitignored `.next/`).

How things were checked, so each claim below can be weighed:

- **Read**: all of `src/`, `supabase/migrations/`, `supabase/scripts/`, config and docs.
- **Measured**: production pages as a logged-out guest with `curl` (5 runs each);
  the same build run locally with `next start`; read-only REST queries against the
  live database with the public anon key (row counts, payload sizes, latency).
- **Not done**: no logged-in session was used, and nothing was written to the
  database. Anything that depends on those is marked.

---

## 1. Top 5 findings (impact vs effort)

### 1. A logged-in player can write their own score — high impact, ~10 lines to fix

`supabase/migrations/20260610120000_grants.sql:35` grants `INSERT` on the whole
`bets` table to `authenticated`, and the only insert policy
(`20260609000000_initial_schema.sql:436-438`) checks `auth.uid() = user_id` and
nothing else. The `enforce_bet_window` trigger
(`20261016000000_hockey_ft_winner.sql:20-59`) validates the match but does not
touch the other columns. So with the public anon key and their own session, a
player can insert a bet on any open match with `points_awarded: 9999,
outcome: 'won'` (and a forged `placed_at`).

Why it matters: standings are not read from `profiles.points_balance` any more —
`/leaderboard` sums `bets.points_awarded` over rows where `outcome` is `won`/`lost`
(`src/app/leaderboard/page.tsx:335-341`), as do `/stats` (`src/app/stats/page.tsx:426-432`)
and the header pill (`src/app/matches/page.tsx:285-295`). The forged row counts
immediately and stays until that match settles and `settle_match` overwrites it;
Liiga publishes the whole season, so there is always a far-future match to use.
This breaks the "balances never change via direct client writes" invariant.

Fix: in `check_bet_bettable()` force `NEW.points_awarded := 0; NEW.outcome := NULL;
NEW.payout := NULL; NEW.placed_at := now();` — or replace the table-wide grant with
`GRANT INSERT (user_id, match_id, pick, ft_winner)`. Either is one small migration.

Status: confirmed from the migrations. **Not exploited against the live database**
(it would require a write).

### 2. Queries silently stop at 1,000 rows — high impact, lands within weeks, medium effort

No query in the app paginates, and PostgREST caps a response at `max_rows`
(`supabase/config.toml:18` = 1000; the hosted default is the same — see section 3).
A capped response is not an error; the rows are just missing.

| Query | Location | Rows today | What breaks past 1,000 |
|---|---|---|---|
| All settled matches (result-freeze guard) | `src/app/api/sync/route.ts:89-92` | 548, growing ~80/week | Guard misses some settled matches; a feed correction can overwrite a `result` points were already paid on. Crosses 1,000 around **late December 2026**. |
| Settled bets per competition | `src/app/leaderboard/page.tsx:335-341`, `src/app/stats/page.tsx:426-432` | NHL 320, Liiga 185, WC 447 | Leaderboard and stats computed from an arbitrary 1,000-bet subset — wrong totals, no error. NHL reaches it early 2027 at the current pace. |
| Bet counts for the whole competition | `src/app/matches/page.tsx:251-254`, `src/app/stats/page.tsx:433-436` | NHL 168 of an eventual ~1,300 matches | Crowd split and underdog hint vanish on some cards. |
| One player's bets in the competition | `src/app/matches/page.tsx:285-289` | under 320 | Existing pick not shown (card offers betting again, insert then fails as duplicate); points pill wrong. |

Fix: move the leaderboard/stats aggregation into a SQL view or RPC (created
`WITH (security_invoker = on)`) so the page receives one row per player; scope the
`/matches` count and bet queries to the loaded match ids; in `/api/sync` look up
only the `external_ref`s being upserted, in chunks. A shorter stopgap is a
`.range()` pagination helper used by all four.

### 3. `settle_match` can be called by anyone — low impact today, one-line fix

No migration revokes `EXECUTE` on `public.settle_match` (only `claim_daily_bonus`
was revoked, `20260617000000_disable_daily_bonus_grant.sql:28-30`), so the
security-definer function is exposed through the REST API.

Verified live: calling it as anon with a non-existent id returns the function's own
`match … not found` error, where `claim_daily_bonus` returns `permission denied`.

Why it is only low impact: the function's own guards (result present, kickoff more
than 3 h ago, not already settled — `20260701000000_ft_winner_pick.sql:122-134`)
mean an outsider can only do what the cron job would do within five minutes. It
becomes a real problem the moment those guards are loosened, and it contradicts
"called by the sync job only".

Fix: `REVOKE EXECUTE ON FUNCTION public.settle_match(uuid) FROM PUBLIC, anon, authenticated;`
(service_role keeps it).

### 4. "Underdog calls" rank on `/stats` uses the wrong test — low impact, one-line fix

`src/app/stats/page.tsx:503` counts an underdog hit as `points_awarded === 15`. But a
correct "Win in 60′" pick is worth 15 with no underdog bonus, and an underdog
"Win in 60′" hit is worth 20. The player's own count uses the correct
`isUnderdogHit()` (`src/lib/stats.ts:135-143`), so the "Underdog calls #N of M" line
(`src/lib/stats.ts:319-323`) compares a correct number against an inflated field.
In hockey, where the strict pick is offered on every game, the rank is routinely wrong.

Fix: use `isUnderdogHit(b)` at line 503. The label "Underdog calls landed (+15)"
(`src/app/stats/page.tsx:217`) is also stale for strict picks.

### 5. An NHL game that is not graded within 14 days is never graded — low likelihood, small fix

`fetchNhlGames()` only fetches today−14…+13 (`src/lib/nhl.ts:99-103`). A game left
ungraded on purpose (`src/lib/nhl.ts:167-187`: missing score, unknown period type,
OT/SO margin not one) or missed during a sync outage longer than two weeks drops out
of the window; its row keeps `result = NULL` and its bets stay unsettled forever,
with only a `console.warn` in the Vercel logs. `/matches` also stops showing it
after 14 days, so nobody sees it.

Fix: after the upsert, select NHL rows with `result IS NULL` and `kickoff_at` older
than a day, refetch those dates, and include a count of still-ungraded old matches
in the sync response so cron-job.org surfaces it. **How often this happens is a
guess** — I found no such row today, but did not query for one specifically.

### Smaller items, not ranked

- **Secrets in git history: none found.** 82 commits scanned for `.env` files and
  JWT / Supabase / Brevo / Google secret patterns. `.env.local`, `backups/` and
  `.vercel/` are gitignored and were never committed.
- **Auth checks:** `/api/sync` checks the bearer secret before doing anything
  (`route.ts:27-32`); `placeBet` checks the user and validates `pick`
  (`src/app/matches/actions.ts:38-52`); `safeNext()` blocks open redirects
  (`src/app/auth/confirm/route.ts:27-32`). No gaps found.
- **Public data by design, worth knowing:** `profiles` is world-readable and
  `display_name` defaults to the email local-part
  (`20260609000000_initial_schema.sql:168-187`, `406-408`), so the part of every
  player's email before the `@` is readable with the anon key. Every bet is also
  readable before kickoff, per player.
- `/login` prints the `message` and `error` query parameters as text
  (`src/app/login/page.tsx:72-75`). React escapes it, so no script injection, but a
  crafted link can display arbitrary text on the real login page.
- `friendlyBetError()` returns unrecognised raw database error text to the browser
  (`src/app/matches/actions.ts:82`).

---

## 2. Tests that would catch real breakage

There is no test suite. These five cover the places where a mistake costs points
or goes unnoticed.

1. **Feed parsers, from fixtures** (`toNhlMatchRow`, `toLiigaMatchRow`): regulation
   win, OT win, shootout win, not finished, and an OT game with a two-goal margin.
   Assert `result`, `result_ft` and the six score columns. Pure functions, no
   infrastructure; this is where every past grading bug started.
2. **`settle_match` against a local Postgres** (`supabase start` or pgTAP): one OT
   game with a standard team pick, a draw pick, a strict pick on the winner and a
   pick on the loser; assert +10 / +10 / −5 / −5, the 33% underdog boundary, and
   that a second call changes nothing.
3. **Bet insert rules, as an authenticated role:** rejected after kickoff, rejected
   for another `user_id`, rejected with `ft_winner` on a WC group match, and
   `points_awarded` / `outcome` supplied by the client are refused or zeroed. The
   last assertion fails today (finding 1).
4. **Leaderboard and stats aggregation with more than 1,000 settled bets:** totals
   must equal a plain SQL `SUM`. Fails today (finding 2). Include one strict-pick
   underdog hit so finding 4 is covered. Needs `buildRowsByKey` / `buildRecentRows`
   moved out of `page.tsx` so they can be imported.
5. **`/api/sync` with mocked feeds:** 401 without the secret; one feed throwing
   still upserts and settles the other; a settled match's `result` is not
   overwritten by a changed feed value; a timeout yields 504 with the rest done.

---

## 3. Could not verify

- **Finding 1 was not executed.** It rests on reading the grant, policy and trigger;
  the live database could differ from the migrations (a dashboard-made change).
- **Hosted `max_rows`.** No live response exceeded 1,000 rows, so the cap was not
  observed. 1,000 is the Supabase default and the value in `config.toml`.
- **Supabase project region.** Inferred to be in Europe from ~50 ms REST latency
  from this machine via Cloudflare's Helsinki edge. Check Project Settings → General.
- **Every logged-in timing.** I had no session. Guest timings are measured;
  logged-in figures in section 4 are the measured guest numbers plus the extra
  calls the code makes, and are labelled estimates.
- **Dashboard-only configuration:** Supabase Auth settings, redirect allow-list,
  magic-link expiry (the login page says "1 minute"), Vercel env vars and function
  region setting, cron-job.org schedule and header.
- **Live schema vs migrations** (indexes, triggers, policies, grants) — only
  `settle_match` and `claim_daily_bonus` exposure were probed.
- **Secrets outside this clone:** GitHub forks, PRs, Vercel build logs.
- **The NHL pages in a browser** — still unchecked, as CLAUDE.md already notes.
- **Cold starts.** The very first `/matches` request took 2.0 s against ~1.0 s
  warm. One sample; treat as a guess.

---

## 4. Performance

Two things were asked about: placing a bet, and switching tabs. "Tabs" here means
the bottom navigation (Matches / Leaderboard / Stats). The Upcoming / Live / Past
tabs inside `/matches` are a client-side toggle with no request
(`src/app/matches/matches-tabs.tsx:32-59`) and are not the problem.

### Measurements

Guest, warm, 4–5 runs each. "Local" is the same build under `next start` on this
machine, which sits ~50 ms from the database.

| Request | Production | Local | Sequential DB calls |
|---|---|---|---|
| Static asset (CDN only) | 0.05 s | — | 0 |
| `/login` | 0.34–0.63 s | 0.08–0.16 s | 1 |
| Tab switch to `/leaderboard` | 0.66–0.88 s | 0.11–0.24 s | 2 |
| Tab switch to `/stats` | 0.67–0.78 s | 0.18–0.25 s | 2 |
| Tab switch to `/matches` | 0.92–1.18 s | 0.19–0.25 s | 2 |

- Every production response carried `x-vercel-id: arn1::iad1::…`: the request enters
  at Stockholm and the function runs in **Washington, D.C. (iad1)**.
- Each added database call costs roughly 0.25–0.3 s in production and a few tens of
  milliseconds locally.
- Payload size is not the cause: `/matches` is 127 KB of RSC data but 12 KB
  compressed; the others are under 4 KB.
- The database queries themselves take 50–220 ms from here, including transfer.

### Path A — switching tabs

1. Tap in `BottomNav` (`src/components/bottom-nav.tsx:22-26`), a plain `<Link>`.
   Nothing changes on screen: there is no `loading.tsx` anywhere in `src/app` and no
   pending state on the link.
2. Browser → Vercel edge (Stockholm) → function (Washington).
3. `src/proxy.ts:38` — `auth.getUser()`, an HTTP call to Supabase Auth. Skipped for
   guests (no session cookie).
4. `getSelectedCompetition()` — `select … from competitions`
   (`src/lib/competitions.ts:68-71`). Awaited alone, before anything else.
5. The page's own batch:
   - `/leaderboard` (`page.tsx:326-342`): `auth.getUser()` again, `profiles`,
     settled `bets` joined to `matches` and `profiles` — in parallel.
   - `/stats` (`page.tsx:424-438`): `auth.getUser()` again, settled `bets` with
     joins, `match_bet_counts`, `profiles` — in parallel.
   - `/matches` (`page.tsx:222-289`): `auth.getUser()` again **on its own**, then
     `matches` + `match_bet_counts` in parallel, then the user's `bets` **on its own**.
6. Render, stream back, client swaps the page.

Sequential round trips, logged in: 3 for leaderboard and stats, 5 for matches.
Guests: 2 each.

### Path B — placing a bet

1. "Place pick" → `handlePlaceBet` (`src/app/matches/match-card.tsx:126-141`),
   button shows "Placing…".
2. POST (Server Action) → edge → function.
3. `src/proxy.ts:38` — `auth.getUser()`.
4. `src/app/matches/actions.ts:38-40` — `auth.getUser()` again.
5. `actions.ts:54-59` — `insert into bets`. In the database: RLS check, the
   `enforce_bet_window` trigger (one `matches`⋈`competitions` lookup), unique index.
6. Response → toast → `router.refresh()` (`match-card.tsx:139`). The card still
   shows the unpicked state.
7. A second request, the full `/matches` render from Path A: proxy `getUser`,
   `competitions`, `getUser`, `matches` + counts, the user's `bets`.
8. All 187 cards (NHL today) are re-rendered and reconciled; only now does the
   card show "Predicted".

That is two function invocations and **eight sequential round trips** to Supabase,
three of them the same `getUser()` call. At the measured ~0.25–0.3 s per call this
is roughly 2 s from tap to the card changing. **Estimate — not measured**, since it
needs a logged-in session.

### Causes, in order of effect

1. **The functions run on the wrong continent.** Players are in Finland, the
   database is (inferred) in Europe, and the code runs in Washington, so every
   database call crosses the Atlantic and back. Evidence: the `iad1` header on every
   response, and identical code being ~4× faster locally (0.11–0.25 s vs 0.66–1.18 s).
   Fix: Vercel → Project Settings → Functions → Function Region, set to the region
   matching the Supabase project (Stockholm `arn1` or Frankfurt `fra1`). No code
   change. Expect tab switches of roughly 0.2–0.3 s.
2. **Calls are made one after another, and some twice.** `getUser()` runs in the
   proxy and again in every page and action; `competitions` (three rows that change
   once a season) is fetched uncached and blocks everything behind it; on `/matches`
   the user's bets wait for the previous batch. Fix: put competitions, user and the
   data queries in one `Promise.all` (the competition id is already in the cookie),
   cache the competitions list, and validate the token once per request. Note the
   project signs JWTs with HS256, so `getClaims()` would still make a network call
   until asymmetric signing keys are enabled.
3. **No feedback while waiting.** A tab tap shows nothing until the whole server
   render arrives, and `<Link>` prefetch fetches nothing useful — the prefetch
   response for `/leaderboard` was 190 bytes with no page content, because the pages
   are fully dynamic with no loading boundary. Fix: add a `loading.tsx` skeleton per
   route. This makes the tap respond instantly even before causes 1 and 2 are fixed.
4. **A bet waits for a full page re-render before it shows.** Fix: mark the card
   "Predicted" from the action's success result (local state or `useOptimistic`) and
   let `router.refresh()` finish in the background. Removes steps 7–8 from what the
   player perceives.
5. **Queries fetch more than the page shows — small today, grows all season.**
   `/matches` loads bet counts for the entire competition, not the ±14-day window
   (`page.tsx:251-254`); leaderboard and stats download every settled bet with its
   match and profile repeated on each row (86–198 KB of JSON per request now, linear
   in bets placed). Same fix as finding 2.
6. **Nothing is cached.** All three pages return `private, no-store`. The Crowd and
   Records sections and the leaderboard are identical for every visitor and change
   only when the 5-minute sync settles something. Worth doing only after 1–4.

Doing 1 and 3 alone — one dashboard setting and three small files — should remove
most of the perceived slowness.

---

## 5. Cheating, from a player's seat

The attacker here is a logged-in member of the group with a browser console: they
have the public anon key and their own session, and can call Supabase and the
Server Actions directly.

How this was checked: by reading the grants, policies, triggers and actions, plus
live probes **as the anon role only**. The write probes (`PATCH` / `DELETE` /
`POST`) used filters that match no row, and all were refused with `42501
permission denied` before any row was considered, so nothing changed. I had no
player session, so "blocked" for the `authenticated` role rests on the migrations.

### Summary

| # | Attempt | Works? | Fix |
|---|---|---|---|
| 5.1 | Extra accounts to rig the underdog bonus or restart at zero | **Yes** | Close signups (dashboard switch) |
| 5.2 | Pick last, after reading everyone else's picks | **Yes**, by design | Hide open picks until kickoff — a rules decision |
| 5.3 | Write a score directly through the API | **Yes** | Finding 1 |
| 5.4 | Lock in a wrong result before the feed corrects it | Marginal | Finding 3 |
| 5.5 | Bet twice on one match with one account | No | — |
| 5.6 | Bet after kickoff or after the result is known | No (one guess-level gap) | — |
| 5.7 | Edit or delete a bet | No | — |
| 5.8 | Dispute or change a result | No | — |
| 5.9 | Change a balance directly | No | — |
| 5.10 | Other direct backend calls | No | — |

### 5.1 Extra accounts — works

Anyone can register: the live Auth settings report `disable_signup: false`, and the
magic-link action accepts any address (`src/app/login/actions.ts:14-22`). Gmail
`+tag` aliases make this free. Three uses:

- **Rig the underdog bonus.** `settle_match` counts every bet equally when deciding
  whether a pick drew under 33%
  (`supabase/migrations/20260701000000_ft_winner_pick.sql:139-167`). The median
  match has 2 bets and the busiest has 8, so the crowd is tiny: with me and one
  rival on a match, two throwaway accounts on the third outcome take my pick from
  50% to 25% and every correct pick pays +15 instead of +10. The throwaways lose
  5 each, which costs me nothing.
- **Restart at zero.** A player on negative points can abandon the account and
  register again. "All time" lists every profile, with no-bet players at 0
  (`src/app/leaderboard/page.tsx:362-376`), so the new account ranks above everyone
  below zero immediately.
- **Borrow a name.** `handle_new_user` takes `display_name` from client-supplied
  signup metadata (`supabase/migrations/20260616000000_accuracy_points_model.sql:53-60`),
  so a direct call to the Auth API can register a second "Niklas". Cosmetic, but it
  muddies the leaderboard.

Not executed — it would create accounts.

Smallest fix: Supabase → Authentication → turn off "Allow new users to sign up" now
that the group is in, and re-enable briefly to add someone. For the name, drop the
metadata branch of the `COALESCE` in `handle_new_user`.

### 5.2 Picking last with full information — works, and is how the game is built

Every pick is world-readable before kickoff
(`supabase/migrations/20260609000000_initial_schema.sql:428-430`; I read the
currently open picks as anon, with each player's id), and the card shows the split
(`src/app/matches/match-card.tsx:238-244`). The bonus is decided on the final split,
so a player who waits until a minute before kickoff knows which side will be under
33% and takes it whenever the game is close to a coin flip. Early pickers cannot
respond: a bet cannot be changed. Over a season that is a steady edge for whoever
bets latest.

This is not a bug so much as a rules question — the underdog hint is advertised.
If you want it closed, the smallest change is one policy: allow `SELECT` on `bets`
only where `user_id = auth.uid()` or the match has kicked off. `match_bet_counts`
is `security_invoker`, so it follows automatically; the card then needs to hide the
split while a match is open.

### 5.3 Writing a score through the API — works

Finding 1. One addition: the API accepts a bet on any scheduled match, not just
the ±14 days the page shows (`src/app/matches/page.tsx:242-247` is a display
filter only). Harmless on its own, but it is what lets a forged row sit on a Liiga
game months away and count all season.

### 5.4 Locking in a wrong result — marginal

There is no way for a player to dispute or alter a result (5.8). The one lever is
finding 3: at exactly three hours after kickoff, anyone can call `settle_match`
before the next 5-minute tick. If the feed is showing a provisional score that
favours me, settling first makes it permanent, because the sync then freezes
settled results (`src/app/api/sync/route.ts:89-113`). It needs a feed error at the
right moment, so treat it as theoretical. Fixed by the revoke in finding 3.

### 5.5 Double-betting on one account — blocked

`UNIQUE (user_id, match_id)`
(`supabase/migrations/20260609000000_initial_schema.sql:73`) is enforced by the
index, so two simultaneous requests cannot both succeed. The strict-mode flag is a
column on the same row, not a second bet.

### 5.6 Betting after kickoff — blocked

The trigger rejects any insert once `now() >= kickoff_at` or the status is not
`scheduled` (`supabase/migrations/20261016000000_hockey_ft_winner.sql:40-46`). It
uses the database clock and runs for direct API inserts too, so changing the
device clock or skipping the UI does nothing.

One gap, and it is **a guess**: the trigger trusts `kickoff_at` from the feed. If a
feed ever lists a start time later than the real one (a placeholder time, or a
suspended game given a new date), betting stays open while the game is known. I
found no such case — no match is more than 24 hours past kickoff without a result —
so no fix is proposed.

### 5.7 Editing or deleting a bet — blocked

`authenticated` is granted only `SELECT` and `INSERT` on `bets`
(`supabase/migrations/20260610120000_grants.sql:34-36`) and there are no update or
delete policies (`20260609000000_initial_schema.sql:440`). No Server Action does
either. A player also cannot delete their own account to cascade their bets away;
that needs the service role. Live as anon: `PATCH` and `DELETE` both refused.

### 5.8 Disputing or changing a result — blocked

Results come only from the feeds through `/api/sync`, which requires the bearer
secret (`src/app/api/sync/route.ts:27-32`). Players have no write grant on
`matches` or `competitions` (refused live as anon). Re-grading needs the scripts in
`supabase/scripts/`, run by hand in the SQL editor.

### 5.9 Changing a balance directly — blocked

No update grant on `profiles` (refused live as anon), and `claim_daily_bonus` is
revoked (`supabase/migrations/20260617000000_disable_daily_bonus_grant.sql:28-30`,
refused live as anon). The only way to move a score is finding 1 — and
`profiles.points_balance` is not what the pages display anyway.

### 5.10 Other direct backend calls — blocked

- **Placing a bet in someone else's name** (to saddle a rival with a bad pick):
  refused by the insert policy, `auth.uid() = user_id`
  (`20260609000000_initial_schema.sql:436-438`).
- **Inserting without logging in:** no grant (refused live).
- **Strict pick where it is a free bonus:** the trigger rejects it on WC group
  matches (`20261016000000_hockey_ft_winner.sql:51-55`) and a CHECK rejects it on a
  draw (`20260701000000_ft_winner_pick.sql:36-38`).
- **Calling `placeBet` directly with odd input:** `pick` is validated
  (`src/app/matches/actions.ts:46-52`); a junk `matchId` only produces a database
  error. The action adds nothing the database does not already enforce.
- **`setSelectedCompetition`:** writes a cookie, nothing else
  (`src/lib/competition-actions.ts:15-30`).
- **Trigger functions** (`check_bet_bettable`, `handle_new_user`) return `trigger`
  and are not callable as RPCs.

### What to do

Three things work, and two of them are fixed by changes already listed: finding 1
(forged score) and finding 3 (public `settle_match`). The new one is 5.1 — turn off
open signups. 5.2 is a decision about how you want the game to play, not a defect.
