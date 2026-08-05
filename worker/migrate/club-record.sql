-- Club record, reconciled to EA's official Overall Record for The 40Yr Virgil.
-- The public all-time record = these baseline figures PLUS every match logged
-- after baseline_seq, so it always adds up (played = W+D+L) and grows per match
-- without touching individual player stats. baseline_seq is stamped to the last
-- logged match at reconcile time. Re-run to re-sync, or edit in Housekeeping →
-- League → Club Record. (EA excludes a couple of the club's friendlies, so the
-- site total can sit a game or two above EA by design.)
INSERT INTO club_record_baselines (key,value) VALUES ('wins','305')        ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO club_record_baselines (key,value) VALUES ('draws','87')        ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO club_record_baselines (key,value) VALUES ('losses','293')      ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO club_record_baselines (key,value) VALUES ('goalsFor','1932')   ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO club_record_baselines (key,value) VALUES ('goalsAgainst','1861') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO club_record_baselines (key,value) VALUES ('leagueApps','638')  ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO club_record_baselines (key,value) VALUES ('playoffApps','47')  ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO club_record_baselines (key,value)
  VALUES ('baseline_seq', (SELECT COALESCE(MAX(id),0) FROM matches))
  ON CONFLICT(key) DO UPDATE SET value=excluded.value;
-- Retire the stale 'played' key (played is now derived = W+D+L).
DELETE FROM club_record_baselines WHERE key='played';
