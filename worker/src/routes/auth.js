/* ============================================================
   Auth routes: register / login / session / logout.
   Mounted at /api/auth.
   ============================================================ */
import { Hono } from "hono";
import { makePassword, verifyPassword } from "../lib/crypto.js";
import {
  normName, validName, findUserByName, createSession, revokeToken,
  currentUser, publicUser, bearer, nowISO
} from "../lib/auth.js";
import { verifyTurnstile } from "../lib/turnstile.js";
import { randomBase32, totpVerify, otpauthURI } from "../lib/totp.js";

const auth = new Hono();

function clientIP(c) { return c.req.header("CF-Connecting-IP") || ""; }
function twoFactorOn(u) { return u && Number(u.totp_enabled) === 1 && u.totp_secret; }

auth.post("/register", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const pass = String(body.pass || "");
  if (!validName(name)) return c.json({ ok: false, error: "name", code: "bad_name" }, 400);
  if (pass.length < 6) return c.json({ ok: false, error: "pass", code: "bad_pass" }, 400);
  if (!(await verifyTurnstile(c.env, body.turnstile, clientIP(c)))) {
    return c.json({ ok: false, error: "turnstile", code: "turnstile" }, 400);
  }
  const existing = await findUserByName(c.env, name);
  if (existing) return c.json({ ok: false, error: "taken", code: "name_taken" }, 409);

  const pw = await makePassword(pass, c.env.PEPPER);
  const res = await c.env.DB.prepare(
    `INSERT INTO users (username, display, level, banned, pw_hash, pw_salt, pw_algo, created_iso, last_iso)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(normName(name), name, 1, 0, pw.pw_hash, pw.pw_salt, pw.pw_algo, nowISO(), nowISO()).run();

  const userId = res.meta.last_row_id;
  const token = await createSession(c.env, userId);
  return c.json({ ok: true, token, name: name, username: normName(name), level: 1 });
});

auth.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const pass = String(body.pass || "");
  if (!(await verifyTurnstile(c.env, body.turnstile, clientIP(c)))) {
    return c.json({ ok: false, error: "turnstile", code: "turnstile" }, 400);
  }
  const user = await findUserByName(c.env, name);
  if (!user) return c.json({ ok: false, error: "auth", code: "bad_login" }, 401);
  if (Number(user.banned) === 1) return c.json({ ok: false, error: "banned", code: "banned" }, 403);

  const v = await verifyPassword(user, pass, c.env.PEPPER);
  if (!v.ok) return c.json({ ok: false, error: "auth", code: "bad_login" }, 401);

  // Optional TOTP 2FA gate: password was right, now demand a valid code.
  if (twoFactorOn(user)) {
    const code = String(body.code || "").trim();
    if (!code) return c.json({ ok: false, error: "2fa", code: "2fa_required" }, 401);
    if (!(await totpVerify(user.totp_secret, code))) return c.json({ ok: false, error: "2fa", code: "2fa_bad" }, 401);
  }

  // Transparent upgrade: legacy SHA verified → re-store as PBKDF2.
  if (v.needsUpgrade) {
    const pw = await makePassword(pass, c.env.PEPPER);
    await c.env.DB.prepare(
      "UPDATE users SET pw_hash=?, pw_salt=?, pw_algo=? WHERE id=?"
    ).bind(pw.pw_hash, pw.pw_salt, pw.pw_algo, user.id).run();
  }
  await c.env.DB.prepare("UPDATE users SET last_iso=? WHERE id=?").bind(nowISO(), user.id).run();

  const token = await createSession(c.env, user.id);
  return c.json({ ok: true, token, name: user.display, username: user.username, level: Number(user.level) || 1 });
});

auth.get("/session", async (c) => {
  const u = await currentUser(c);
  if (!u) return c.json({ ok: false, error: "session", code: "no_session" }, 401);
  return c.json({ ok: true, ...publicUser(u) });
});

auth.post("/logout", async (c) => {
  await revokeToken(c.env, bearer(c));
  return c.json({ ok: true });
});

/* ---- change my password (must know the current one) ---- */
auth.post("/change-password", async (c) => {
  const u = await currentUser(c); if (!u) return c.json({ ok: false, error: "auth", code: 401 }, 401);
  const b = await c.req.json().catch(() => ({}));
  const next = String(b.next || "");
  if (next.length < 6) return c.json({ ok: false, error: "bad_pass", code: "bad_pass" }, 400);
  const v = await verifyPassword(u, String(b.current || ""), c.env.PEPPER);
  if (!v.ok) return c.json({ ok: false, error: "bad_current", code: "bad_current" }, 400);
  const pw = await makePassword(next, c.env.PEPPER);
  await c.env.DB.prepare("UPDATE users SET pw_hash=?, pw_salt=?, pw_algo=? WHERE id=?")
    .bind(pw.pw_hash, pw.pw_salt, pw.pw_algo, u.id).run();
  return c.json({ ok: true });
});

/* ---- 2FA status ---- */
auth.get("/2fa/status", async (c) => {
  const u = await currentUser(c); if (!u) return c.json({ ok: false, error: "auth", code: 401 }, 401);
  return c.json({ ok: true, enabled: Number(u.totp_enabled) === 1 });
});

/* ---- 2FA setup: mint a secret (pending) + otpauth URI to add to the app ---- */
auth.post("/2fa/setup", async (c) => {
  const u = await currentUser(c); if (!u) return c.json({ ok: false, error: "auth", code: 401 }, 401);
  const secret = randomBase32(32);
  // Store as pending (enabled stays 0 until a code is confirmed).
  await c.env.DB.prepare("UPDATE users SET totp_secret=?, totp_enabled=0 WHERE id=?").bind(secret, u.id).run();
  const issuer = "The 40Yr Virgil";
  return c.json({ ok: true, secret, otpauth: otpauthURI(secret, u.username, issuer) });
});

/* ---- 2FA enable: confirm a code against the pending secret ---- */
auth.post("/2fa/enable", async (c) => {
  const u = await currentUser(c); if (!u) return c.json({ ok: false, error: "auth", code: 401 }, 401);
  if (!u.totp_secret) return c.json({ ok: false, error: "no_setup", code: "no_setup" }, 400);
  const b = await c.req.json().catch(() => ({}));
  if (!(await totpVerify(u.totp_secret, String(b.code || "")))) return c.json({ ok: false, error: "bad_code", code: "bad_code" }, 400);
  await c.env.DB.prepare("UPDATE users SET totp_enabled=1 WHERE id=?").bind(u.id).run();
  return c.json({ ok: true });
});

/* ---- 2FA disable: needs a current code (or password) ---- */
auth.post("/2fa/disable", async (c) => {
  const u = await currentUser(c); if (!u) return c.json({ ok: false, error: "auth", code: 401 }, 401);
  const b = await c.req.json().catch(() => ({}));
  let allowed = false;
  if (b.code && u.totp_secret && await totpVerify(u.totp_secret, String(b.code))) allowed = true;
  else if (b.password && (await verifyPassword(u, String(b.password), c.env.PEPPER)).ok) allowed = true;
  if (!allowed) return c.json({ ok: false, error: "verify", code: "verify" }, 400);
  await c.env.DB.prepare("UPDATE users SET totp_secret=NULL, totp_enabled=0 WHERE id=?").bind(u.id).run();
  return c.json({ ok: true });
});

export default auth;
