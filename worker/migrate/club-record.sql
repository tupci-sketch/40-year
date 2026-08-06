-- Club record, reconciled to EA. Model: the on-site all-time record =
--   pre-tracking baseline  +  the live tracked archive (all recorded matches).
-- The baseline is the pre-tracking remainder = EA's overall MINUS the tracked
-- non-friendly games, stored with baseline_seq=0 so the whole archive (incl.
-- the 2 friendlies EA doesn't count) adds back on top:
--   record = baseline + archive = EA + friendlies = 687, and it stays live as
-- tracked games are added or edited. Individual player stats are untouched.
--
-- Easiest path is Housekeeping → League & Record → Club Record → Sync (one tap).
-- This SQL does the same thing; paste into the D1 console if you prefer.
INSERT INTO club_record_baselines (key,value) VALUES ('wins',         (SELECT max(0, 305  - COALESCE(SUM(result='W'),0))    FROM matches WHERE stage<>'friendly')) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO club_record_baselines (key,value) VALUES ('draws',        (SELECT max(0, 87   - COALESCE(SUM(result='D'),0))    FROM matches WHERE stage<>'friendly')) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO club_record_baselines (key,value) VALUES ('losses',       (SELECT max(0, 293  - COALESCE(SUM(result='L'),0))    FROM matches WHERE stage<>'friendly')) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO club_record_baselines (key,value) VALUES ('goalsFor',     (SELECT max(0, 1932 - COALESCE(SUM(our_score),0))     FROM matches WHERE stage<>'friendly')) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO club_record_baselines (key,value) VALUES ('goalsAgainst', (SELECT max(0, 1861 - COALESCE(SUM(their_score),0))   FROM matches WHERE stage<>'friendly')) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO club_record_baselines (key,value) VALUES ('leagueApps',   (SELECT max(0, 638  - COALESCE(SUM(stage='league'),0))  FROM matches WHERE stage<>'friendly')) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO club_record_baselines (key,value) VALUES ('playoffApps',  (SELECT max(0, 47   - COALESCE(SUM(stage='playoff'),0)) FROM matches WHERE stage<>'friendly')) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO club_record_baselines (key,value) VALUES ('baseline_seq', '0') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
DELETE FROM club_record_baselines WHERE key='played';
INSERT INTO site_settings (key,value) VALUES ('ea_record','{"wins":305,"draws":87,"losses":293,"goalsFor":1932,"goalsAgainst":1861,"leagueApps":638,"playoffApps":47}') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
