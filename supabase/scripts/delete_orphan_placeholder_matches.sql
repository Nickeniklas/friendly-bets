-- =============================================================================
-- One-off data fix (2026-07-18): delete the two orphaned placeholder matches.
--
-- NOT a migration — this is a data cleanup, so it lives in supabase/scripts/
-- and is pasted into the Supabase SQL editor by hand (`supabase db push` only
-- runs migrations/).
--
-- WHAT WENT WRONG
-- ---------------
-- buildExternalRef() (src/lib/openfootball.ts) keys a match two different ways:
--   * knockout match WITH a `num` field  -> 'wc2026-m{num}'
--   * match WITHOUT a `num` field        -> '{date}-{team1}-{team2}' (slugified)
--
-- Early in the tournament openfootball listed the third-place and final matches
-- WITHOUT a `num`, using bracket placeholders for the team names ("L101"/"L102"
-- = losers of match 101/102, "W101"/"W102" = the winners). Those synced in under
-- the name-based key:
--     2026-07-18-l101-l102   (third place)
--     2026-07-19-w101-w102   (final)
--
-- openfootball later added `num: 103` / `num: 104` and the resolved team names.
-- The next sync therefore took the *num* branch and inserted NEW rows
-- (wc2026-m103 = France vs England, wc2026-m104 = Spain vs Argentina), leaving
-- the two placeholder rows orphaned: nothing in the feed matches their
-- external_ref any more, so they are never updated, never get a result, and
-- never settle. They just sit in /matches' Upcoming tab as bettable cards with
-- meaningless team names.
--
-- Only these two fixtures hit this — every R32/R16/QF/SF row is cleanly keyed
-- 'wc2026-m##', because those already had a `num` the first time they synced.
--
-- WHAT THIS DELETES
-- -----------------
-- The two orphan rows, and (via bets.match_id's ON DELETE CASCADE) the single
-- prediction that had been placed on the ghost third-place card. That bet had
-- outcome = NULL / points_awarded = 0 and could never settle, so removing it
-- does not change anyone's points: the `accuracy` view and /stats both filter to
-- outcome IN ('won','lost'), which excluded it already. It *was* counted by the
-- match_bet_counts view (that view counts every pick regardless of outcome),
-- which is what drove the crowd-split % on the ghost card — that disappears
-- along with the card.
--
-- The affected player already has a normal prediction on the real
-- France vs England row, so nothing they intended to bet on is lost.
--
-- Deliberately matched on the two exact external_refs rather than a LIKE
-- pattern, so this can never sweep up a real fixture.
-- =============================================================================

BEGIN;

-- Show what is about to be removed (both the rows and the cascading bets), so
-- the SQL editor output is a record of what this actually did.
SELECT m.external_ref,
       m.team1,
       m.team2,
       m.stage,
       m.status,
       COUNT(b.id) AS bets_that_will_cascade
  FROM public.matches AS m
  LEFT JOIN public.bets AS b ON b.match_id = m.id
 WHERE m.external_ref IN ('2026-07-18-l101-l102', '2026-07-19-w101-w102')
 GROUP BY m.external_ref, m.team1, m.team2, m.stage, m.status;

DELETE FROM public.matches
 WHERE external_ref IN ('2026-07-18-l101-l102', '2026-07-19-w101-w102');

-- Expected: 2 rows deleted, and 0 rows returned by this final check.
SELECT external_ref
  FROM public.matches
 WHERE external_ref IN ('2026-07-18-l101-l102', '2026-07-19-w101-w102');

COMMIT;
