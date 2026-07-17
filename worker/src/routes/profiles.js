/* ============================================================
   Profiles, identities & titles.
     Public   : GET /api/profiles/:username
     Member   : GET/PATCH /api/me/profile, GET/PATCH /api/me/privacy
     L9 admin : identity/title assignment, title CRUD, account<->player link
   Mounted at /api (profiles/me) and /api/admin (identity/title admin).
   ============================================================ */
import { Hono } from "hono";
import { currentUser, requireLevel, nowISO } from "../lib/auth.js";

const pro = new Hono();
function rows(r) { return (r && r.results) || []; }
function clean(s, max) { return String(s == null ? "" : s).trim().slice(0, max); }
function deny(c, code, status) { return c.json({ ok: false, error: code, code }, status); }

/* Assemble the public-safe shape of a profile: never email/hashes/session/
   IP/private prefs/DMs. Linked player only shown when the user opted in. */
async function buildPublicProfile(env, user) {
  const prof = await env.DB.prepare(
    "SELECT bio, primary_identity_id, linked_player_id, show_linked FROM user_profiles WHERE user_id=?"
  ).bind(user.id).first();
  const priv = await env.DB.prepare("SELECT profile_public, show_join FROM user_privacy WHERE user_id=?").bind(user.id).first();
  if (priv && Number(priv.profile_public) === 0) return null;

  let identity = null;
  if (prof && prof.primary_identity_id) {
    identity = await env.DB.prepare("SELECT id,name FROM user_identity_types WHERE id=?").bind(prof.primary_identity_id).first();
  }
  const titles = rows(await env.DB.prepare(
    `SELECT t.id,t.name,t.description,t.color_token,t.icon,ta.is_primary
     FROM user_title_assignments ta JOIN user_titles t ON t.id=ta.title_id
     WHERE ta.user_id=? AND t.active=1 ORDER BY ta.is_primary DESC, t.sort ASC`
  ).bind(user.id).all());

  let linkedPlayer = null;
  if (prof && prof.linked_player_id && Number(prof.show_linked) === 1) {
    linkedPlayer = await env.DB.prepare("SELECT id,name,number FROM players WHERE id=?").bind(prof.linked_player_id).first();
  }

  return {
    username: user.username,
    display: user.display,
    joinDate: (!priv || Number(priv.show_join) !== 0) ? user.created_iso : null,
    bio: prof ? prof.bio : null,
    identity: identity,
    titles: titles,
    linkedPlayer: linkedPlayer
  };
}

/* ---- public profile ---- */
pro.get("/profiles/:username", async (c) => {
  const uname = clean(c.req.param("username"), 20).toLowerCase();
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE username=?").bind(uname).first();
  if (!user || Number(user.banned) === 1) return deny(c, "not_found", 404);
  const profile = await buildPublicProfile(c.env, user);
  if (!profile) return deny(c, "private", 403);
  return c.json({ ok: true, profile });
});

/* ---- member directory ---- */
pro.get("/members", async (c) => {
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit"), 10) || 30));
  const cursor = parseInt(c.req.query("cursor"), 10);
  const identity = c.req.query("identity");
  const conds = ["u.banned=0", "(pv.profile_public IS NULL OR pv.profile_public=1)"];
  const args = [];
  if (identity) { conds.push("up.primary_identity_id = (SELECT id FROM user_identity_types WHERE name=?)"); args.push(identity); }
  if (isFinite(cursor)) { conds.push("u.id > ?"); args.push(cursor); }
  const list = rows(await c.env.DB.prepare(
    `SELECT u.id, u.username, u.display, u.created_iso, up.primary_identity_id
     FROM users u LEFT JOIN user_profiles up ON up.user_id=u.id LEFT JOIN user_privacy pv ON pv.user_id=u.id
     WHERE ${conds.join(" AND ")} ORDER BY u.id ASC LIMIT ?`
  ).bind(...args, limit + 1).all());
  const hasMore = list.length > limit;
  const page = list.slice(0, limit);
  return c.json({ ok: true, members: page, nextCursor: hasMore ? page[page.length - 1].id : null });
});

/* ---- my profile (member) ---- */
pro.get("/me/profile", async (c) => {
  const u = await currentUser(c); if (!u) return deny(c, "auth", 401);
  const prof = await c.env.DB.prepare("SELECT * FROM user_profiles WHERE user_id=?").bind(u.id).first();
  const priv = await c.env.DB.prepare("SELECT * FROM user_privacy WHERE user_id=?").bind(u.id).first();
  return c.json({ ok: true, profile: prof || {}, privacy: priv || { dm_policy: "established", profile_public: 1, show_join: 1 } });
});

pro.patch("/me/profile", async (c) => {
  const u = await currentUser(c); if (!u) return deny(c, "auth", 401);
  const b = await c.req.json().catch(() => ({}));
  const bio = clean(b.bio, 280);
  const showLinked = b.showLinked ? 1 : 0;
  await c.env.DB.prepare(
    `INSERT INTO user_profiles (user_id,bio,show_linked) VALUES (?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET bio=excluded.bio, show_linked=excluded.show_linked`
  ).bind(u.id, bio, showLinked).run();
  return c.json({ ok: true });
});

pro.patch("/me/privacy", async (c) => {
  const u = await currentUser(c); if (!u) return deny(c, "auth", 401);
  const b = await c.req.json().catch(() => ({}));
  const dmPolicy = ["any", "established", "staff", "off"].includes(b.dmPolicy) ? b.dmPolicy : "established";
  await c.env.DB.prepare(
    `INSERT INTO user_privacy (user_id,dm_policy,profile_public,show_join) VALUES (?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET dm_policy=excluded.dm_policy, profile_public=excluded.profile_public, show_join=excluded.show_join`
  ).bind(u.id, dmPolicy, b.profilePublic === false ? 0 : 1, b.showJoin === false ? 0 : 1).run();
  return c.json({ ok: true });
});

/* ---- public identity/title lists ---- */
pro.get("/identity-types", async (c) => {
  const list = rows(await c.env.DB.prepare("SELECT id,name FROM user_identity_types WHERE active=1 ORDER BY sort ASC").all());
  return c.json({ ok: true, identityTypes: list });
});
pro.get("/titles", async (c) => {
  const list = rows(await c.env.DB.prepare("SELECT id,name,description,color_token,icon FROM user_titles WHERE active=1 ORDER BY sort ASC").all());
  return c.json({ ok: true, titles: list });
});

/* ============================================================
   L9 admin: identity assignment, account<->player link, titles CRUD.
   Exported separately and mounted at /api/admin by index.js.
   ============================================================ */
const proAdmin = new Hono();

proAdmin.patch("/users/:id/profile-role", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return deny(c, g.err, g.status);
  const userId = parseInt(c.req.param("id"), 10);
  const b = await c.req.json().catch(() => ({}));
  const user = await c.env.DB.prepare("SELECT id FROM users WHERE id=?").bind(userId).first();
  if (!user) return deny(c, "not_found", 404);
  const existing = await c.env.DB.prepare("SELECT primary_identity_id, linked_player_id FROM user_profiles WHERE user_id=?").bind(userId).first();

  // Partial update: only touch a field the caller actually sent, so linking a
  // player doesn't wipe the identity (and vice-versa). Empty string = clear.
  let linkedPlayerId = existing ? existing.linked_player_id : null;
  if ("linkedPlayerId" in b) {
    if (b.linkedPlayerId) {
      const p = await c.env.DB.prepare("SELECT id FROM players WHERE id=?").bind(clean(b.linkedPlayerId, 24)).first();
      if (!p) return deny(c, "player_not_found", 400);
      linkedPlayerId = p.id;
    } else linkedPlayerId = null;
  }
  let identityId = existing ? existing.primary_identity_id : null;
  if ("identityId" in b) {
    if (b.identityId) {
      const idt = await c.env.DB.prepare("SELECT id FROM user_identity_types WHERE id=?").bind(parseInt(b.identityId, 10)).first();
      if (!idt) return deny(c, "identity_not_found", 400);
      identityId = idt.id;
    } else identityId = null;
  }
  await c.env.DB.prepare(
    `INSERT INTO user_profiles (user_id, primary_identity_id, linked_player_id) VALUES (?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET primary_identity_id=excluded.primary_identity_id, linked_player_id=excluded.linked_player_id`
  ).bind(userId, identityId, linkedPlayerId).run();
  await c.env.DB.prepare(
    "INSERT INTO audit_log (actor_id,action,target_type,target_id,detail_json,created_iso) VALUES (?,?,?,?,?,?)"
  ).bind(g.user.id, "profile_role_update", "user", userId, JSON.stringify(b), nowISO()).run();
  return c.json({ ok: true });
});

proAdmin.post("/titles", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return deny(c, g.err, g.status);
  const b = await c.req.json().catch(() => ({}));
  const name = clean(b.name, 40);
  if (!name) return deny(c, "name", 400);
  const r = await c.env.DB.prepare(
    "INSERT INTO user_titles (name,description,color_token,icon,active,sort,visibility) VALUES (?,?,?,?,1,?,?)"
  ).bind(name, clean(b.description, 200), clean(b.colorToken, 20), clean(b.icon, 8),
    parseInt(b.sort, 10) || 0, clean(b.visibility, 20) || "public").run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

proAdmin.patch("/titles/:id", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return deny(c, g.err, g.status);
  const id = parseInt(c.req.param("id"), 10);
  const b = await c.req.json().catch(() => ({}));
  const map = { name: "name", description: "description", colorToken: "color_token", icon: "icon", visibility: "visibility" };
  const sets = [], args = [];
  for (const k in map) if (b[k] != null) { sets.push(map[k] + "=?"); args.push(clean(b[k], 200)); }
  if (b.active != null) { sets.push("active=?"); args.push(b.active ? 1 : 0); }
  if (b.sort != null) { sets.push("sort=?"); args.push(parseInt(b.sort, 10) || 0); }
  if (!sets.length) return deny(c, "nothing", 400);
  await c.env.DB.prepare(`UPDATE user_titles SET ${sets.join(", ")} WHERE id=?`).bind(...args, id).run();
  return c.json({ ok: true });
});

proAdmin.post("/users/:id/titles", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return deny(c, g.err, g.status);
  const userId = parseInt(c.req.param("id"), 10);
  const b = await c.req.json().catch(() => ({}));
  const titleId = parseInt(b.titleId, 10);
  const title = await c.env.DB.prepare("SELECT id FROM user_titles WHERE id=?").bind(titleId).first();
  if (!title) return deny(c, "title_not_found", 400);
  if (b.isPrimary) await c.env.DB.prepare("UPDATE user_title_assignments SET is_primary=0 WHERE user_id=?").bind(userId).run();
  await c.env.DB.prepare(
    `INSERT INTO user_title_assignments (user_id,title_id,is_primary) VALUES (?,?,?)
     ON CONFLICT(user_id,title_id) DO UPDATE SET is_primary=excluded.is_primary`
  ).bind(userId, titleId, b.isPrimary ? 1 : 0).run();
  return c.json({ ok: true });
});

proAdmin.delete("/users/:id/titles/:titleId", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return deny(c, g.err, g.status);
  const userId = parseInt(c.req.param("id"), 10), titleId = parseInt(c.req.param("titleId"), 10);
  await c.env.DB.prepare("DELETE FROM user_title_assignments WHERE user_id=? AND title_id=?").bind(userId, titleId).run();
  return c.json({ ok: true });
});

export default pro;
export { proAdmin };
