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

const auth = new Hono();

function clientIP(c) { return c.req.header("CF-Connecting-IP") || ""; }

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

export default auth;
