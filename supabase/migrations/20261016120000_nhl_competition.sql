-- =============================================================================
-- NHL 2026–27 regular season as a new competition.
--
-- Data only — no schema change. NHL games are synced by src/lib/nhl.ts
-- (external_ref = 'nhl-{id}') and inherit every hockey feature through
-- competitions.sport = 'hockey', never through the id:
--   * check_bet_bettable (enforce_bet_window) allows ft_winner ("Win in 60′")
--     when the match's competition has sport = 'hockey'
--     (20261016000000_hockey_ft_winner.sql) — so NHL needs no trigger change;
--   * settle_match is unchanged (result = final winner, result_ft = 60-min).
--
-- sort_order 0 puts NHL before Liiga (1) and the World Cup (2), so it is the
-- first active competition = the default for anyone without the
-- fb-competition cookie (getSelectedCompetition() in src/lib/competitions.ts),
-- and the first entry in the header dropdown.
-- =============================================================================

INSERT INTO public.competitions (id, name, sport, is_active, sort_order) VALUES
  ('nhl-2027', 'NHL 2026–27', 'hockey', true, 0)
ON CONFLICT (id) DO NOTHING;
