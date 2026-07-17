-- ============================================================
--  Migration: polls, the Clubhouse Floor room, and GOAT exclusivity
--  Run ONCE in the Cloudflare D1 console (D1 → virgil → Console).
--  Safe to re-run (IF NOT EXISTS / OR IGNORE).
-- ============================================================

CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL, created_by INTEGER, created_iso TEXT, closed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT, poll_id INTEGER NOT NULL, label TEXT NOT NULL, sort INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_polloptions_poll ON poll_options(poll_id);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id INTEGER NOT NULL, option_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_iso TEXT,
  PRIMARY KEY (poll_id, user_id)
);

CREATE TABLE IF NOT EXISTS room_presence (
  user_id INTEGER PRIMARY KEY, x INTEGER NOT NULL DEFAULT 6, y INTEGER NOT NULL DEFAULT 6,
  emote TEXT, updated_iso TEXT
);
CREATE INDEX IF NOT EXISTS idx_roompresence_updated ON room_presence(updated_iso);

-- GOAT is the captain's alone: pull it from the shop, grant it to tupci.
UPDATE shop_items SET active = 0 WHERE sku = 'flair_goat';
INSERT INTO user_purchases (user_id, sku, kind, payload, cost, created_iso)
SELECT id, 'flair_goat', 'flair', '🐐', 0, '2026-07-17T00:00:00Z' FROM users WHERE username = 'tupci'
  AND NOT EXISTS (SELECT 1 FROM user_purchases up WHERE up.user_id = users.id AND up.payload = '🐐' AND up.kind = 'flair');
