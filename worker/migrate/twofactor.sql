-- ============================================================
--  Migration: optional TOTP two-factor auth columns on users.
--  Run ONCE in the Cloudflare D1 console (D1 → virgil → Console).
--  The two ALTER lines error "duplicate column" if already run — harmless.
-- ============================================================
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
