-- ============================================================
--  Migration: Virgil Points + club shop + tickets + name cosmetics
--  Run ONCE in the Cloudflare D1 console (dashboard → D1 → virgil
--  → Console). Safe to re-run: tables use IF NOT EXISTS and the
--  seed uses OR IGNORE. The two ALTER TABLE lines will error
--  "duplicate column name" if you run them a second time — that's
--  harmless, it just means the column is already there.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_points (
  user_id     INTEGER PRIMARY KEY,
  balance     INTEGER NOT NULL DEFAULT 0,
  lifetime    INTEGER NOT NULL DEFAULT 0,
  updated_iso TEXT
);

CREATE TABLE IF NOT EXISTS point_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  delta       INTEGER NOT NULL,
  reason      TEXT,
  created_iso TEXT
);
CREATE INDEX IF NOT EXISTS idx_pointevents_user ON point_events(user_id, id DESC);

CREATE TABLE IF NOT EXISTS shop_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sku         TEXT UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  kind        TEXT,
  payload     TEXT,
  cost        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER DEFAULT 0
);

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

-- Name cosmetics live on the profile row (run each once):
ALTER TABLE user_profiles ADD COLUMN flair TEXT;
ALTER TABLE user_profiles ADD COLUMN accent TEXT;

INSERT OR IGNORE INTO shop_items (sku, name, description, kind, payload, cost, sort) VALUES
  ('flair_ball','Match Ball flair','A ⚽ next to your name across the club.','flair','⚽',50,10),
  ('flair_fire','On Fire flair','You are 🔥. Everyone can see it.','flair','🔥',80,20),
  ('flair_crown','Crown flair','A 👑 for the big-time charlie.','flair','👑',150,30),
  ('flair_goat','GOAT flair','Settle the debate with a 🐐.','flair','🐐',150,40),
  ('flair_purple','Purple Heart flair','💜 up the Virgil.','flair','💜',60,50),
  ('accent_gold','Gold name','Your name shines gold club-wide.','accent','gold',120,60),
  ('accent_electric','Electric name','Your name in Virgil purple.','accent','electric',120,70),
  ('accent_win','Green name','Your name in winner''s green.','accent','win',100,80);
