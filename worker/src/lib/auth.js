/* ============================================================
   Auth/session helpers over D1.
   Bearer token model: client sends `Authorization: Bearer <token>`,
   we store only sha256(token) in user_sessions.
   ============================================================ */
import { sha256Hex, randomHex } from "./crypto.js";

const SESSION_DAYS = 60;

export function normName(name) {
  return String(name || "").trim().toLowerCase();
}

/* Same rule as the legacy backend: 2–20 chars, starts alnum. */
export function validName(name) {
  return /^[a-z0-9][a-z0-9 _.\-]{1,19}$/i.test(String(name || "").trim());
}

export async function findUserByName(env, name) {
  return await env.DB.prepare(
    "SELECT * FROM users WHERE username = ?"
  ).bind(normName(name)).first();
}

export async function findUserById(env, id) {
  return await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
}

export function nowISO() { return new Date().toISOString(); }

export function plusDaysISO(days) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

/* Create a session, return the raw token to hand to the client. */
export async function createSession(env, userId) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare(
    "INSERT INTO user_sessions (user_id, token_hash, created_iso, expires_iso, revoked) VALUES (?,?,?,?,0)"
  ).bind(userId, tokenHash, nowISO(), plusDaysISO(SESSION_DAYS)).run();
  return token;
}

export async function revokeToken(env, token) {
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare("UPDATE user_sessions SET revoked = 1 WHERE token_hash = ?").bind(tokenHash).run();
}

/* Read the bearer token from a Hono context. */
export function bearer(c) {
  const h = c.req.header("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

/* Resolve the signed-in user from the request, or null.
   Also enforces not-expired, not-revoked, not-banned. */
export async function currentUser(c) {
  const token = bearer(c);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT u.* FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked = 0 AND s.expires_iso > ?`
  ).bind(tokenHash, nowISO()).first();
  if (!row) return null;
  if (Number(row.banned) === 1) return null;
  return row;
}

/* Guard: resolve the user and enforce a minimum level.
   Returns { user } on success, or { err, status } to return. */
export async function requireLevel(c, n) {
  const u = await currentUser(c);
  if (!u) return { err: "auth", status: 401 };
  if (Number(u.level) < n) return { err: "denied", status: 403 };
  return { user: u };
}

/* Public shape of a user (never leak hashes). */
export function publicUser(u) {
  return u ? { name: u.display, username: u.username, level: Number(u.level) || 1, twoFactor: Number(u.totp_enabled) === 1 } : null;
}
