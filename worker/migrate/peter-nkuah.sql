-- Retire Peter Nkuah (id 'lewban', GK) and credit his recorded games evenly
-- between Pancake the Octopus ('pmqdr0yan') and Ye Yu II ('yeyu'), never putting
-- two of them in the same game. Peter played 7: 261,262,263,269,276,277,278.
-- Ye Yu already appears in 261, so 261 goes to Pancake; the rest split evenly.
--   Pancake: 261, 263, 276, 278
--   Ye Yu  : 262, 269, 277
-- Peter has no goals, so there are no scorer rows to move. Paste into the D1
-- console. Safe to run once.

-- 1) Reassign the per-match stat lines (saves/conceded/rating move with the row).
UPDATE match_player_stats SET player_id='pmqdr0yan' WHERE player_id='lewban' AND match_id IN (261,263,276,278);
UPDATE match_player_stats SET player_id='yeyu'      WHERE player_id='lewban' AND match_id IN (262,269,277);

-- 2) Reassign any scorer rows (Peter has none, but be safe; skip on conflict).
UPDATE OR IGNORE match_scorers SET player_id='pmqdr0yan' WHERE player_id='lewban' AND match_id IN (261,263,276,278);
UPDATE OR IGNORE match_scorers SET player_id='yeyu'      WHERE player_id='lewban' AND match_id IN (262,269,277);

-- 3) Reassign any lineup slots (skip if the target already holds a slot there).
UPDATE OR IGNORE match_lineup_players SET player_id='pmqdr0yan' WHERE player_id='lewban' AND match_id IN (261,263,276,278);
UPDATE OR IGNORE match_lineup_players SET player_id='yeyu'      WHERE player_id='lewban' AND match_id IN (262,269,277);

-- 4) Reassign match-level MOTM / captain references, per match.
UPDATE matches SET motm_player_id='pmqdr0yan'    WHERE motm_player_id='lewban'    AND id IN (261,263,276,278);
UPDATE matches SET motm_player_id='yeyu'         WHERE motm_player_id='lewban'    AND id IN (262,269,277);
UPDATE matches SET captain_player_id='pmqdr0yan' WHERE captain_player_id='lewban' AND id IN (261,263,276,278);
UPDATE matches SET captain_player_id='yeyu'      WHERE captain_player_id='lewban' AND id IN (262,269,277);
UPDATE match_lineups SET captain_player_id='pmqdr0yan' WHERE captain_player_id='lewban' AND match_id IN (261,263,276,278);
UPDATE match_lineups SET captain_player_id='yeyu'      WHERE captain_player_id='lewban' AND match_id IN (262,269,277);

-- 5) Drop any residual references to Peter (e.g. a slot skipped above), unlink
--    any account, remove his card, then delete the player.
DELETE FROM match_player_stats   WHERE player_id='lewban';
DELETE FROM match_scorers        WHERE player_id='lewban';
DELETE FROM match_lineup_players WHERE player_id='lewban';
UPDATE matches       SET motm_player_id=NULL    WHERE motm_player_id='lewban';
UPDATE matches       SET captain_player_id=NULL WHERE captain_player_id='lewban';
UPDATE match_lineups SET captain_player_id=NULL WHERE captain_player_id='lewban';
UPDATE user_profiles SET linked_player_id=NULL  WHERE linked_player_id='lewban';
DELETE FROM player_card_assets   WHERE player_id='lewban';
DELETE FROM players              WHERE id='lewban';
