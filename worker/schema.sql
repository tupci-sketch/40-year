-- ============================================================
--  The 40Yr Virgil — D1 schema (SQLite)
--  Paste this whole file into: Cloudflare dashboard → D1 → virgil
--  → Console → run. Safe to re-run (IF NOT EXISTS / INSERT OR IGNORE).
--  Timestamps are ISO TEXT. Booleans are INTEGER 0/1.
-- ============================================================
PRAGMA foreign_keys = ON;

-- ---------- Identity / auth / profiles ----------
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY,
  username     TEXT NOT NULL UNIQUE,          -- normalised key (lowercase)
  display      TEXT NOT NULL,
  level        INTEGER NOT NULL DEFAULT 1,
  banned       INTEGER NOT NULL DEFAULT 0,
  pw_hash      TEXT NOT NULL,
  pw_salt      TEXT NOT NULL,
  pw_algo      TEXT NOT NULL DEFAULT 'sha256',-- 'sha256' (legacy) | 'pbkdf2'; upgraded on login
  created_iso  TEXT NOT NULL,
  last_iso     TEXT,
  totp_secret  TEXT,                            -- base32 authenticator secret (set at 2FA setup)
  totp_enabled INTEGER NOT NULL DEFAULT 0        -- 1 once the user confirms a code
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS user_sessions (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  token_hash   TEXT NOT NULL UNIQUE,          -- sha256 of the bearer token
  created_iso  TEXT NOT NULL,
  expires_iso  TEXT NOT NULL,
  revoked      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id),
  prefs_json   TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS user_privacy (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id),
  dm_policy      TEXT NOT NULL DEFAULT 'established', -- any|established|staff|off
  profile_public INTEGER NOT NULL DEFAULT 1,
  show_join      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_identity_types (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  active  INTEGER NOT NULL DEFAULT 1,
  sort    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id),
  bio                TEXT,
  primary_identity_id INTEGER REFERENCES user_identity_types(id),
  linked_player_id   TEXT REFERENCES players(id),
  show_linked        INTEGER NOT NULL DEFAULT 0,
  flair              TEXT,   -- equipped emoji cosmetic (must be owned)
  accent             TEXT    -- equipped name-colour token (must be owned)
);

CREATE TABLE IF NOT EXISTS user_titles (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  color_token TEXT,
  icon        TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  visibility  TEXT NOT NULL DEFAULT 'public'
);

CREATE TABLE IF NOT EXISTS user_title_assignments (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  title_id   INTEGER NOT NULL REFERENCES user_titles(id),
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, title_id)
);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id  INTEGER NOT NULL REFERENCES users(id),
  blocked_id  INTEGER NOT NULL REFERENCES users(id),
  created_iso TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  detail_json TEXT,
  created_iso TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_iso);

CREATE TABLE IF NOT EXISTS moderation_reports (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,                  -- forum|chat|profile|dm
  target_id   TEXT NOT NULL,
  reporter_id INTEGER REFERENCES users(id),
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'open',   -- open|actioned|dismissed
  created_iso TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_modreports_status ON moderation_reports(status);

-- ---------- Private messaging ----------
CREATE TABLE IF NOT EXISTS dm_conversations (
  id           INTEGER PRIMARY KEY,
  created_iso  TEXT NOT NULL,
  last_msg_iso TEXT
);

CREATE TABLE IF NOT EXISTS dm_members (
  conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id),
  user_id         INTEGER NOT NULL REFERENCES users(id),
  last_read_iso   TEXT,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_dmmembers_user ON dm_members(user_id);

CREATE TABLE IF NOT EXISTS dm_messages (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id),
  sender_id       INTEGER NOT NULL REFERENCES users(id),
  body            TEXT NOT NULL,
  created_iso     TEXT NOT NULL,
  deleted_iso     TEXT
);
CREATE INDEX IF NOT EXISTS idx_dmmsgs_conv ON dm_messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS dm_message_reports (
  id          INTEGER PRIMARY KEY,
  message_id  INTEGER NOT NULL REFERENCES dm_messages(id),
  reporter_id INTEGER REFERENCES users(id),
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_iso TEXT NOT NULL
);

-- ---------- Club / squad / seasons ----------
CREATE TABLE IF NOT EXISTS players (
  id            TEXT PRIMARY KEY,             -- e.g. 'tupci', 'amy'
  number        INTEGER,
  name          TEXT NOT NULL,
  slug          TEXT,
  controlled_by TEXT NOT NULL DEFAULT 'bot',  -- human|bot
  is_human      INTEGER NOT NULL DEFAULT 0,
  perma_bench   INTEGER NOT NULL DEFAULT 0,
  retired_ai    INTEGER NOT NULL DEFAULT 0,
  linked_to     TEXT,                         -- lore link only (e.g. amy<->donovan); never merges stats
  positions_json TEXT,                        -- ["ST","CAM"]
  flavour       TEXT,
  active        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_players_slug ON players(slug);

CREATE TABLE IF NOT EXISTS seasons (
  id          TEXT PRIMARY KEY,               -- stable id, e.g. 'fc26'
  label       TEXT NOT NULL,                  -- display, e.g. 'Season 3 · FC26'
  game        TEXT,
  started_iso TEXT,
  ended_iso   TEXT,
  archived    INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS player_career_baselines (
  player_id     TEXT PRIMARY KEY REFERENCES players(id),
  as_of_seq     INTEGER NOT NULL DEFAULT 0,   -- recorded matches AFTER this seq add on top
  apps          INTEGER NOT NULL DEFAULT 0,
  goals         INTEGER NOT NULL DEFAULT 0,
  assists       INTEGER NOT NULL DEFAULT 0,
  avg_rating    REAL,
  passes        INTEGER NOT NULL DEFAULT 0,
  tackles       INTEGER NOT NULL DEFAULT 0,
  clean_sheets  INTEGER NOT NULL DEFAULT 0,
  win_pct       REAL,
  source        TEXT,
  note          TEXT,
  updated_by    INTEGER REFERENCES users(id),
  updated_iso   TEXT
);

CREATE TABLE IF NOT EXISTS player_season_baselines (
  player_id   TEXT NOT NULL REFERENCES players(id),
  season_id   TEXT NOT NULL REFERENCES seasons(id),
  apps        INTEGER NOT NULL DEFAULT 0,
  goals       INTEGER NOT NULL DEFAULT 0,
  assists     INTEGER NOT NULL DEFAULT 0,
  avg_rating  REAL,
  note        TEXT,
  PRIMARY KEY (player_id, season_id)
);

CREATE TABLE IF NOT EXISTS player_squad_status (
  id        INTEGER PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  status    TEXT NOT NULL,                    -- active|left|retired
  from_iso  TEXT,
  to_iso    TEXT
);

CREATE TABLE IF NOT EXISTS milestones (
  id       INTEGER PRIMARY KEY,
  date_iso TEXT,
  text     TEXT NOT NULL,
  sort     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS club_record_baselines (
  key   TEXT PRIMARY KEY,                     -- played|wins|draws|losses|goalsFor|...
  value TEXT NOT NULL,
  note  TEXT
);

CREATE TABLE IF NOT EXISTS site_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ---------- Archive / matchday ----------
CREATE TABLE IF NOT EXISTS matches (
  id                INTEGER PRIMARY KEY,       -- = seq, preserves order
  season_id         TEXT REFERENCES seasons(id),
  stage             TEXT NOT NULL DEFAULT 'league',
  date_iso          TEXT,
  opponent          TEXT NOT NULL,
  our_score         INTEGER,
  their_score       INTEGER,
  result            TEXT,                      -- W|D|L
  note              TEXT,
  comp_name         TEXT,
  venue             TEXT,                      -- H|A|N
  motm_player_id    TEXT REFERENCES players(id),
  captain_player_id TEXT REFERENCES players(id),
  formation         TEXT,
  updated_by        TEXT,
  updated_iso       TEXT
);
CREATE INDEX IF NOT EXISTS idx_matches_season ON matches(season_id);
CREATE INDEX IF NOT EXISTS idx_matches_opponent ON matches(opponent);
CREATE INDEX IF NOT EXISTS idx_matches_result ON matches(result);
CREATE INDEX IF NOT EXISTS idx_matches_stage ON matches(stage);

CREATE TABLE IF NOT EXISTS match_player_stats (
  match_id      INTEGER NOT NULL REFERENCES matches(id),
  player_id     TEXT NOT NULL REFERENCES players(id),
  goals         INTEGER NOT NULL DEFAULT 0,
  assists       INTEGER NOT NULL DEFAULT 0,
  rating        REAL,
  shots         INTEGER NOT NULL DEFAULT 0,
  tackles       INTEGER NOT NULL DEFAULT 0,
  passes_made   INTEGER NOT NULL DEFAULT 0,
  pass_attempts INTEGER NOT NULL DEFAULT 0,
  red_cards     INTEGER NOT NULL DEFAULT 0,
  saves         INTEGER NOT NULL DEFAULT 0,
  conceded      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_mps_player ON match_player_stats(player_id);

CREATE TABLE IF NOT EXISTS match_scorers (
  match_id  INTEGER NOT NULL REFERENCES matches(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  goals     INTEGER NOT NULL DEFAULT 1,
  ord       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_scorers_match ON match_scorers(match_id);

CREATE TABLE IF NOT EXISTS match_lineups (
  match_id          INTEGER PRIMARY KEY REFERENCES matches(id),
  formation         TEXT,
  captain_player_id TEXT REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS match_lineup_players (
  match_id   INTEGER NOT NULL REFERENCES matches(id),
  player_id  TEXT NOT NULL REFERENCES players(id),
  pos        TEXT,
  slot_index INTEGER,
  is_sub     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, player_id)
);

CREATE TABLE IF NOT EXISTS gaffers (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  retired_iso TEXT,
  created_iso TEXT
);

CREATE TABLE IF NOT EXISTS match_gaffers (
  match_id      INTEGER NOT NULL REFERENCES matches(id),
  gaffer_id     INTEGER NOT NULL REFERENCES gaffers(id),
  is_primary    INTEGER NOT NULL DEFAULT 0,
  name_snapshot TEXT NOT NULL,                -- frozen display at assignment time
  PRIMARY KEY (match_id, gaffer_id)
);
CREATE INDEX IF NOT EXISTS idx_matchgaffers_match ON match_gaffers(match_id);

CREATE TABLE IF NOT EXISTS fixtures (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'match',   -- match|session
  season_id  TEXT REFERENCES seasons(id),
  stage      TEXT,
  date_iso   TEXT,
  opponent   TEXT,
  comp_name  TEXT,
  note       TEXT,
  settled    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS availability (
  fixture_id  TEXT NOT NULL REFERENCES fixtures(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL,                  -- yes|maybe|no
  updated_iso TEXT,
  PRIMARY KEY (fixture_id, user_id)
);

CREATE TABLE IF NOT EXISTS predictions (
  fixture_id  TEXT NOT NULL REFERENCES fixtures(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  our         INTEGER NOT NULL,
  their       INTEGER NOT NULL,
  created_iso TEXT,
  PRIMARY KEY (fixture_id, user_id)
);

CREATE TABLE IF NOT EXISTS prediction_scores (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  points  INTEGER NOT NULL DEFAULT 0,
  exact   INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  played  INTEGER NOT NULL DEFAULT 0
);

-- ---------- Community / media ----------
CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  display     TEXT NOT NULL,
  level       INTEGER NOT NULL DEFAULT 1,
  body        TEXT NOT NULL,
  created_iso TEXT NOT NULL,
  deleted_iso TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_id ON chat_messages(id DESC);

CREATE TABLE IF NOT EXISTS forum_categories (
  id   INTEGER PRIMARY KEY,
  key  TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS forum_threads (
  id          INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES forum_categories(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_iso TEXT NOT NULL,
  last_iso    TEXT NOT NULL,
  replies     INTEGER NOT NULL DEFAULT 0,
  pinned      INTEGER NOT NULL DEFAULT 0,
  deleted_iso TEXT
);
CREATE INDEX IF NOT EXISTS idx_threads_cat ON forum_threads(category_id, last_iso);

CREATE TABLE IF NOT EXISTS forum_posts (
  id          INTEGER PRIMARY KEY,
  thread_id   INTEGER NOT NULL REFERENCES forum_threads(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_iso TEXT NOT NULL,
  deleted_iso TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_thread ON forum_posts(thread_id, id);

CREATE TABLE IF NOT EXISTS reactions (
  target_type TEXT NOT NULL,                  -- news|forum_post|chat|match
  target_id   TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (target_type, target_id, emoji, user_id)
);

CREATE TABLE IF NOT EXISTS news_posts (
  id            INTEGER PRIMARY KEY,
  tag           TEXT,
  date_iso      TEXT,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  pinned        INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'published', -- draft|published
  published_iso TEXT
);

CREATE TABLE IF NOT EXISTS player_card_assets (
  id                INTEGER PRIMARY KEY,
  player_id         TEXT NOT NULL REFERENCES players(id),
  object_key        TEXT NOT NULL,
  public_url        TEXT,
  media_type        TEXT NOT NULL DEFAULT 'card',
  original_filename TEXT,
  mime_type         TEXT,
  byte_size         INTEGER,
  width             INTEGER,
  height            INTEGER,
  checksum          TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'active', -- active|replaced|deleted
  uploaded_by       INTEGER REFERENCES users(id),
  uploaded_iso      TEXT,
  approved_by       INTEGER REFERENCES users(id),
  approved_iso      TEXT,
  replaced_by       INTEGER,
  deleted_iso       TEXT
);
CREATE INDEX IF NOT EXISTS idx_cards_player ON player_card_assets(player_id, version DESC);

-- ---------- Reference seed data ----------
INSERT OR IGNORE INTO user_identity_types (id, name, sort) VALUES
  (1,'Squad Player',10),(2,'Club Staff',20),(3,'Gaffer',30),(4,'Moderator',40),
  (5,'Supporter',50),(6,'Founder / Archive Keeper',60),(7,'Former Player',70),
  (8,'Guest',80),(9,'Honorary',90);

INSERT OR IGNORE INTO forum_categories (id, key, name, sort) VALUES
  (1,'banter','Banter',10),(2,'tactics','Tactics',20),
  (3,'matchday','Matchday',30),(4,'club','Club Notices',40);

INSERT OR IGNORE INTO site_settings (key, value) VALUES
  ('current_season','fc26'),
  ('schema_version','1');

-- ============================================================
--  Engagement: Virgil Points, the club shop, and match tickets
-- ============================================================

-- Running balance + lifetime earned per member.
CREATE TABLE IF NOT EXISTS user_points (
  user_id     INTEGER PRIMARY KEY,
  balance     INTEGER NOT NULL DEFAULT 0,
  lifetime    INTEGER NOT NULL DEFAULT 0,
  updated_iso TEXT
);

-- Every credit/debit, so the ledger is auditable and shown to the member.
CREATE TABLE IF NOT EXISTS point_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  delta       INTEGER NOT NULL,
  reason      TEXT,
  created_iso TEXT
);
CREATE INDEX IF NOT EXISTS idx_pointevents_user ON point_events(user_id, id DESC);

-- The club shop: cosmetics (flair emoji, name accent) + matchday tickets.
CREATE TABLE IF NOT EXISTS shop_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sku         TEXT UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  kind        TEXT,     -- 'flair' | 'accent' | 'ticket'
  payload     TEXT,     -- emoji, colour token, etc.
  cost        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER DEFAULT 0
);

-- Inventory / receipts. Cosmetics are owned once; tickets carry a fixture_id.
CREATE TABLE IF NOT EXISTS user_purchases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  item_id     INTEGER,
  sku         TEXT,
  kind        TEXT,
  payload     TEXT,
  fixture_id  TEXT,
  cost        INTEGER,
  created_iso TEXT
);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON user_purchases(user_id, id DESC);

-- The 🐐 GOAT flair is NOT sold — it's the captain's alone, granted, not bought.
INSERT OR IGNORE INTO shop_items (sku, name, description, kind, payload, cost, sort) VALUES
  ('flair_ball','Match Ball flair','A ⚽ next to your name across the club.','flair','⚽',50,10),
  ('flair_fire','On Fire flair','You are 🔥. Everyone can see it.','flair','🔥',80,20),
  ('flair_crown','Crown flair','A 👑 for the big-time charlie.','flair','👑',150,30),
  ('flair_purple','Purple Heart flair','💜 up the Virgil.','flair','💜',60,50),
  ('accent_gold','Gold name','Your name shines gold club-wide.','accent','gold',120,60),
  ('accent_electric','Electric name','Your name in Virgil purple.','accent','electric',120,70),
  ('accent_win','Green name','Your name in winner''s green.','accent','win',100,80);

-- ============================================================
--  Community polls + the shared Clubhouse Floor room
-- ============================================================
CREATE TABLE IF NOT EXISTS polls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question    TEXT NOT NULL,
  created_by  INTEGER,
  created_iso TEXT,
  closed      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS poll_options (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id  INTEGER NOT NULL,
  label    TEXT NOT NULL,
  sort     INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_polloptions_poll ON poll_options(poll_id);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id     INTEGER NOT NULL,
  option_id   INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  created_iso TEXT,
  PRIMARY KEY (poll_id, user_id)
);

-- Presence for the shared avatar room: one row per member, upserted on move.
CREATE TABLE IF NOT EXISTS room_presence (
  user_id     INTEGER PRIMARY KEY,
  x           INTEGER NOT NULL DEFAULT 6,
  y           INTEGER NOT NULL DEFAULT 6,
  emote       TEXT,
  updated_iso TEXT
);
CREATE INDEX IF NOT EXISTS idx_roompresence_updated ON room_presence(updated_iso);
