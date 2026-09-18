# SCHEMA — data model & settlement contract

The heart of the project. Get the tables and the settlement RPC right and the rest is UI.

## Tables

### `profiles`
Extra game data per user. Supabase Auth owns `auth.users`; this hangs off it.

| column | type | notes |
|---|---|---|
| id | uuid (PK) | = auth.users.id |
| display_name | text | shown on leaderboard |
| points_balance | int | running points total across ALL competitions; starts at 0, may go negative. Still written by `settle_match`, but no page displays it since 2026-09-18 — standings are per-competition sums of `bets.points_awarded` |
| created_at | timestamptz | default now() |
| last_bonus_date | date | null until first claim; UTC date of last daily-bonus claim |
| streak_count | int | consecutive daily-bonus claims, capped at 7; default 0 |

New users get a row with `points_balance = 0` (trigger on auth signup). The balance
is a running total of points earned/lost at settlement — it is no longer a wallet of
stakable points, and is allowed to go negative. (`last_bonus_date` / `streak_count`
belong to the daily login bonus, which is disabled as of 2026-06-16 — see below.)

### `competitions` (2026-09-18)
One row per league/tournament season. Read-all RLS + SELECT grant to
`anon`/`authenticated`; only `service_role` writes. Migration
`20260918120000_competitions.sql`.

| column | type | notes |
|---|---|---|
| id | text (PK) | `wc2026`, `liiga-2027` |
| name | text | display name, e.g. "Liiga 2026–27" |
| sport | text | `football` / `hockey` — drives sport-specific display (OT/SO labels, icon) |
| is_active | bool | currently running: default selection + /matches ±14-day window |
| sort_order | int | dropdown order, lowest first |

The UI's selected competition is a cookie (`fb-competition`), resolved by
`getSelectedCompetition()` in `src/lib/competitions.ts` (unknown ids fall back to the
first active competition by `sort_order`).

### `matches`
One row per game, synced by `/api/sync` (Liiga from liiga.fi; the WC rows came from
openfootball and are frozen).

| column | type | notes |
|---|---|---|
| id | uuid (PK) | |
| external_ref | text (unique) | stable key from the feed to dedupe on re-sync |
| competition | text (FK→competitions, NOT NULL) | `wc2026` / `liiga-2027`; no default — the sync must set it |
| team1 | text | home team |
| team2 | text | away team |
| kickoff_at | timestamptz | betting closes at this time |
| group_label | text | e.g. "Group A" (WC), "Week 3" (Liiga) |
| stage | text | WC: group / r32 / r16 / qf / sf / third_place / final; leagues: `regular` |
| status | text | `scheduled` → `closed` → `settled` |
| result | text | `team1` / `team2` / `draw` / null until played |
| result_ft | text | full-time result (WC: 90-min; hockey: 60-min = same as `result`) |
| ft_/et_/p_team1, ft_/et_/p_team2 | int | display-only scores (never graded): WC 90′/after ET/pens; hockey regulation/after OT/shootout period |
| settled_at | timestamptz | null until settled |

**Liiga** (`src/lib/liiga.ts`): `external_ref = liiga-{id}` (the API's numeric game
id — stable, single keying, so no orphan risk). Graded on the regulation (60-min)
score = sum of `NORMAL` periods; `result = result_ft` = that outcome, set only when
`ended`. `et_*` is set only if `finishedType` shows OT/SO, `p_*` only for a shootout.

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
One row per bet — just a prediction of the outcome, no stake. Nothing is deducted on
placement.

| column | type | notes |
|---|---|---|
| id | uuid (PK) | |
| user_id | uuid (FK→profiles) | |
| match_id | uuid (FK→matches) | |
| pick | text | `team1` (home win) / `draw` / `team2` (away win) |
| points_awarded | int | points earned/lost at settlement; default 0, can be negative |
| stake | int (nullable) | legacy from the old staking model; unused, no longer read/written |
| payout | int | legacy/unused |
| outcome | text | `won` / `lost` / null (`refunded` no longer used) |
| placed_at | timestamptz | default now() |

Rule: a bet may only be inserted while the match is `scheduled` AND now() < kickoff_at.
Enforced in the DB by the `enforce_bet_window` trigger, not just the UI. There is no
balance/stake check anymore (the old `deduct_stake_on_bet` trigger has been dropped).
`UNIQUE (user_id, match_id)` keeps it to one prediction per player per match.

### accuracy — a VIEW, not a table
Derive from `bets` + `matches` so it can never drift:
- bets_placed = count of settled bets (outcome `won`/`lost`)
- correct = count where outcome = `won` (pick matched match.result — includes
  correctly-picked draws)
- wrong = bets_placed − correct (outcome = `lost`)
- win_rate = correct / bets_placed
- streak = current run of consecutive correct (compute in the query/app)

## Scoring rules (the points model)
There is no pool, no stake, and no seed/top-up. Each bet earns or loses a fixed number
of points at settlement, based only on whether the prediction was right and how the crowd
bet:

- **Correct pick: +10 points.**
- **Underdog bonus: +5** if the player's picked outcome received **fewer than 33%** of all
  bets placed on that match (a correct underdog pick = **15** total).
- **Wrong pick: −5 points.**

Points balances may go negative — that's intended. The "underdog" determination is
crowd-based: with three outcomes, an outcome that few people backed but that wins rewards
the predictors who went against the grain.

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
  load match (FOR UPDATE)
  if match.status = 'settled': return        # idempotent guard — never double-award
  assert result is set and kickoff_at < now() - 3h

  total        = count of all bets on the match (across team1/draw/team2)
  result_count = count of bets where pick == result
  # the result outcome is an "underdog" if it drew fewer than 33% of the bets
  underdog = total > 0 and (result_count / total) < 0.33

  for b in bets:
      if b.pick == result:
          b.points_awarded = 15 if underdog else 10
          b.outcome = 'won'
      else:
          b.points_awarded = -5
          b.outcome = 'lost'
      profiles[b.user_id].points_balance += b.points_awarded

  match.status = 'settled'; match.settled_at = now()
```

Only correct picks can earn the underdog bonus, and a correct pick's outcome is by
definition the result — so the whole match shares one underdog determination (based on the
result outcome's share of bets). A match with zero bets is just flipped to `settled`.

## Daily login bonus — `claim_daily_bonus()` RPC (DISABLED 2026-06-16)

**Disabled.** This streak-based bonus inflated the prediction score under the
fixed-points model, so all app wiring was removed. The RPC and the
`profiles.last_bonus_date` / `streak_count` columns remain in the DB but
dormant — nothing calls `claim_daily_bonus()` anymore.

For reference, it originally worked like this: called once per app load
(client-side, via a Server Action) for the logged-in user; atomically
checked/updated `last_bonus_date` and `streak_count`; awarded
`100 + (streak - 1) * 50` capped at 400 (day 7+), added to `points_balance`.
To re-enable, restore the toast/action wiring and reconcile the bonus with the
points model.

## Draw handling (a first-class outcome)
Draw is a real, pickable outcome — one of the three picks (`team1` / `draw` / `team2`).
It can be picked, it can win, and it counts toward the bet-distribution math for the
underdog bonus. A correctly-predicted draw scores exactly like any other correct pick
(+10, or +15 if the draw was an underdog). There is no push / refund-on-draw logic
anymore.

## RLS (Supabase)
- `profiles`: a user reads all (leaderboard) but updates none directly — balance only
  changes via the settlement RPC (`settle_match`). The daily-bonus RPC could once change
  it too, but its EXECUTE grant was revoked on 2026-06-17, so `settle_match` is now the
  only path that touches a balance.
- `bets`: a user inserts only their own (and only on a bettable match); reads all
  (so the crowd split is visible). The `enforce_bet_window` trigger
  (`check_bet_bettable()`) also rejects `ft_winner = true` unless the match's stage is
  a WC knockout stage (r32/r16/qf/sf/third_place/final) — an allow-list since
  2026-09-18, so Liiga's `regular` stage is rejected too.
- `competitions`: read for all; writes only by service role.
- `matches`: read for all; writes only by the sync job / admin (service role).
- Settlement runs as a `security definer` RPC so normal users can't touch balances.
- Views: `accuracy` and `match_bet_counts` are `security_invoker` views (since
  2026-09-18, `20260918000000_views_security_invoker.sql`) — they run with the
  *caller's* grants + RLS, not the view owner's. They stay publicly readable because
  their underlying tables (`bets`, `profiles`) are. Any future view must be created
  `WITH (security_invoker = on)`.

Implementation note: RLS policies alone aren't sufficient — Postgres also requires
baseline table GRANTs for `anon`/`authenticated`/`service_role` (a separate permission
layer checked *before* RLS; `service_role`'s BYPASSRLS doesn't skip it). See
`supabase/migrations/20260610120000_grants.sql`.
