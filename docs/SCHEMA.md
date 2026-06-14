# SCHEMA — data model & settlement contract

The heart of the project. Get the tables and the settlement RPC right and the rest is UI.

## Tables

### `profiles`
Extra game data per user. Supabase Auth owns `auth.users`; this hangs off it.

| column | type | notes |
|---|---|---|
| id | uuid (PK) | = auth.users.id |
| display_name | text | shown on leaderboard |
| points_balance | int | starts at 1000 |
| created_at | timestamptz | default now() |
| last_bonus_date | date | null until first claim; UTC date of last daily-bonus claim |
| streak_count | int | consecutive daily-bonus claims, capped at 7; default 0 |

New users get a row with `points_balance = 1000` (trigger on auth signup, or on first login).

### `matches`
One row per game, synced from openfootball.

| column | type | notes |
|---|---|---|
| id | uuid (PK) | |
| external_ref | text (unique) | stable key from openfootball to dedupe on re-sync |
| team1 | text | |
| team2 | text | |
| kickoff_at | timestamptz | betting closes at this time |
| group_label | text | e.g. "Group A" |
| stage | text | group / r32 / r16 / qf / sf / final |
| status | text | `scheduled` → `closed` → `settled` |
| result | text | `team1` / `team2` / `draw` / null until played |
| settled_at | timestamptz | null until settled |

`external_ref`: openfootball doesn't ship a clean id, so build one deterministically
and upsert on it so re-syncs update rows instead of duplicating them.

Implemented strategy (`src/lib/openfootball.ts`):
- Knockout matches (have a stable `num` field) → `wc2026-m{num}`.
- Group-stage matches (stable team names from day one, no `num`) →
  `{date}-{team1}-{team2}` slugified.

Knockout `team1`/`team2` start as placeholders (`"2A"`, `"W74"`) that get overwritten
with real team names as the bracket resolves — keying on team names there would create
duplicate rows on re-sync, hence the `num`-based key for knockouts.

### `bets`
One row per bet. Stake is deducted from balance the moment this row is created.

| column | type | notes |
|---|---|---|
| id | uuid (PK) | |
| user_id | uuid (FK→profiles) | |
| match_id | uuid (FK→matches) | |
| pick | text | `team1` / `team2` (see draw note) |
| stake | int | > 0 |
| payout | int | null until settlement |
| outcome | text | `won` / `lost` / `refunded` / null |
| placed_at | timestamptz | default now() |

Rule: a bet may only be inserted while the match is `scheduled` AND now() < kickoff_at.
Enforce in the DB (RPC or policy), not just UI.

### accuracy — a VIEW, not a table
Derive from `bets` + `matches` so it can never drift:
- bets_placed = count of settled, non-refunded bets
- correct = count where pick matched match.result
- wrong = bets_placed − correct
- win_rate = correct / bets_placed
- streak = current run of consecutive correct (compute in the query/app)

## The seed / pool rule
At settlement, `pot = sum(stake)` over all bets on the match.
If `pot < 300`, set `pot = 300` — the difference is house-funded (points appear from
nowhere; fine, it's a fun game). A healthy pool (≥300) is never topped up.

## Settlement — `settle_match(match_id)` RPC

MUST be one atomic transaction. Idempotent: if the match is already `settled`, do nothing
and return. Runs once effectively per match even though the sync job may call it repeatedly.

Triggered automatically by the sync job (every 5 minutes), NOT by an admin button. The job
selects matches to settle with all of:
- `result` is set (not null), and
- `kickoff_at` is more than 3 hours in the past (avoid provisional/half-time results), and
- `status` is not already `settled`.

```
function settle_match(match_id):
  load match
  if match.status = 'settled': return        # idempotent guard — never double-pay
  assert result is set and kickoff_at < now() - 3h
  bets = all bets for match_id
  pot = sum(b.stake for b in bets)
  if pot < 300: pot = 300

  if result == 'draw':
      # push — refund every stake, no winners (v1: no 'draw' pick exists)
      for b in bets:
          profiles[b.user_id].points_balance += b.stake
          b.payout = b.stake; b.outcome = 'refunded'
      match.status = 'settled'; match.settled_at = now(); return

  winning_pick = result   # 'team1' or 'team2'
  winners = [b for b in bets if b.pick == winning_pick]
  winning_stake = sum(b.stake for b in winners)

  if winning_stake == 0:
      # push — nobody picked the winner; refund every stake
      for b in bets:
          profiles[b.user_id].points_balance += b.stake
          b.payout = b.stake; b.outcome = 'refunded'
  else:
      for b in bets:
          if b.pick == winning_pick:
              b.payout = round(b.stake / winning_stake * pot)
              profiles[b.user_id].points_balance += b.payout
              b.outcome = 'won'
          else:
              b.payout = 0; b.outcome = 'lost'   # stake already deducted at placement

  match.status = 'settled'; match.settled_at = now()
```

Note loser stakes are NOT re-deducted — they were taken when the bet was placed.
Winners get their proportional slice credited. Net effect for a winner = payout − stake.

## Daily login bonus — `claim_daily_bonus()` RPC

Called once per app load (client-side, via a Server Action) for the logged-in
user. Atomically checks/updates `profiles.last_bonus_date` and `streak_count`:

- Already claimed today -> returns 0 (no-op).
- Claimed yesterday -> streak += 1 (capped at 7).
- Otherwise (streak broken, or first-ever claim) -> streak resets to 1.

Bonus = `100 + (streak - 1) * 50`, capped at 400 (day 7+). Added to
`points_balance` in the same statement. Dates are UTC (`CURRENT_DATE`),
consistent with how match times are displayed elsewhere in the app.

## Draw handling (decided — push for v1)
Group games can draw. For v1, a draw is a **push**: if `result = 'draw'`, refund every
bet on the match (same path as the no-winner push). Picks stay team1/team2 only — there
is no 'draw' pick in v1.

In the settlement function this means: if `result = 'draw'`, refund all stakes and skip
the proportional-payout branch entirely.

v2 idea: add 'draw' as a real third pick with its own pool side. Deferred — it adds UI
and turns settlement into a three-way split.

## RLS (Supabase)
- `profiles`: a user reads all (leaderboard) but updates none directly — balance only
  changes via bet placement, settlement RPC, and the daily-bonus RPC.
- `bets`: a user inserts only their own (and only on a bettable match); reads all
  (so the pool is visible).
- `matches`: read for all; writes only by the sync job / admin (service role).
- Settlement runs as a `security definer` RPC so normal users can't touch balances.

Implementation note: RLS policies alone aren't sufficient — Postgres also requires
baseline table GRANTs for `anon`/`authenticated`/`service_role` (a separate permission
layer checked *before* RLS; `service_role`'s BYPASSRLS doesn't skip it). See
`supabase/migrations/20260610120000_grants.sql`.
