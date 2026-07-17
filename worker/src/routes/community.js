/* ============================================================
   Community write/read routes (members): chat, forum,
   availability, predictions, reactions. Mounted at /api.
   Every write re-checks the session server-side.
   ============================================================ */
import { Hono } from "hono";
import { currentUser, nowISO } from "../lib/auth.js";
import { awardPoints, awardOnce, cosmeticsFor } from "../lib/points.js";

const com = new Hono();

function rows(r) { return (r && r.results) || []; }
function clampLimit(v, def = 30, max = 100) { v = parseInt(v, 10); return (!isFinite(v) || v <= 0) ? def : Math.min(v, max); }
function clean(s, max) { return String(s == null ? "" : s).trim().slice(0, max); }
async function requireUser(c) { return await currentUser(c); }
function deny(c, code, status) { return c.json({ ok: false, error: code, code }, status); }

/* ---------------- CHAT (members) ---------------- */
com.get("/chat", async (c) => {
  const u = await requireUser(c); if (!u) return deny(c, "auth", 401);
  const limit = clampLimit(c.req.query("limit"), 40, 100);
  const cursor = parseInt(c.req.query("cursor"), 10);
  const where = isFinite(cursor) ? "AND id < ?" : "";
  const args = isFinite(cursor) ? [cursor, limit + 1] : [limit + 1];
  const list = rows(await c.env.DB.prepare(
    `SELECT id, user_id, display, level, body, created_iso FROM chat_messages
     WHERE deleted_iso IS NULL ${where} ORDER BY id DESC LIMIT ?`
  ).bind(...args).all());
  const hasMore = list.length > limit;
  const page = list.slice(0, limit);
  const cos = await cosmeticsFor(c.env, page.map((m) => m.user_id));
  for (const m of page) { const cm = cos[m.user_id] || {}; m.flair = cm.flair || null; m.accent = cm.accent || null; }
  return c.json({ ok: true, messages: page, nextCursor: hasMore ? page[page.length - 1].id : null });
});

com.post("/chat", async (c) => {
  const u = await requireUser(c); if (!u) return deny(c, "auth", 401);
  const body = await c.req.json().catch(() => ({}));
  const text = clean(body.text, 500);
  if (!text) return deny(c, "empty", 400);
  const res = await c.env.DB.prepare(
    "INSERT INTO chat_messages (user_id, display, level, body, created_iso) VALUES (?,?,?,?,?)"
  ).bind(u.id, u.display, Number(u.level) || 1, text, nowISO()).run();
  await awardPoints(c.env, u.id, 1, "chat message");
  return c.json({ ok: true, id: res.meta.last_row_id });
});

com.delete("/chat/:id", async (c) => {
  const u = await requireUser(c); if (!u) return deny(c, "auth", 401);
  if (Number(u.level) < 5) return deny(c, "denied", 403);
  await c.env.DB.prepare("UPDATE chat_messages SET deleted_iso=? WHERE id=?").bind(nowISO(), parseInt(c.req.param("id"), 10)).run();
  return c.json({ ok: true });
});

/* ---------------- FORUM ---------------- */
com.get("/forum/categories", async (c) => {
  const list = rows(await c.env.DB.prepare("SELECT id,key,name,sort FROM forum_categories ORDER BY sort ASC").all());
  return c.json({ ok: true, categories: list });
});

com.get("/forum/threads", async (c) => {
  const limit = clampLimit(c.req.query("limit"), 20, 50);
  const cursorTs = c.req.query("cursor");
  const conds = ["t.deleted_iso IS NULL"], args = [];
  const cat = c.req.query("category");
  if (cat) { conds.push("c.key = ?"); args.push(cat); }
  if (cursorTs) { conds.push("t.last_iso < ?"); args.push(cursorTs); }
  const list = rows(await c.env.DB.prepare(
    `SELECT t.id,t.title,t.user_id,t.created_iso,t.last_iso,t.replies,t.pinned,c.key AS category, c.name AS category_name
     FROM forum_threads t JOIN forum_categories c ON c.id=t.category_id
     WHERE ${conds.join(" AND ")}
     ORDER BY t.pinned DESC, t.last_iso DESC LIMIT ?`
  ).bind(...args, limit + 1).all());
  const hasMore = list.length > limit;
  const page = list.slice(0, limit);
  return c.json({ ok: true, threads: page, nextCursor: hasMore ? page[page.length - 1].last_iso : null });
});

com.get("/forum/threads/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const t = await c.env.DB.prepare(
    `SELECT t.*, c.key AS category, c.name AS category_name FROM forum_threads t
     JOIN forum_categories c ON c.id=t.category_id WHERE t.id=? AND t.deleted_iso IS NULL`
  ).bind(id).first();
  if (!t) return deny(c, "not_found", 404);
  const limit = clampLimit(c.req.query("limit"), 30, 100);
  const cursor = parseInt(c.req.query("cursor"), 10);
  const where = isFinite(cursor) ? "AND id > ?" : "";
  const args = isFinite(cursor) ? [id, cursor, limit + 1] : [id, limit + 1];
  const posts = rows(await c.env.DB.prepare(
    `SELECT id,user_id,body,created_iso FROM forum_posts WHERE thread_id=? AND deleted_iso IS NULL ${where} ORDER BY id ASC LIMIT ?`
  ).bind(...args).all());
  const hasMore = posts.length > limit;
  const page = posts.slice(0, limit);
  return c.json({ ok: true, thread: t, posts: page, nextCursor: hasMore ? page[page.length - 1].id : null });
});

com.post("/forum/threads", async (c) => {
  const u = await requireUser(c); if (!u) return deny(c, "auth", 401);
  const body = await c.req.json().catch(() => ({}));
  const title = clean(body.title, 120), text = clean(body.body, 4000);
  if (!title || !text) return deny(c, "empty", 400);
  const cat = await c.env.DB.prepare("SELECT id FROM forum_categories WHERE key=?").bind(clean(body.category, 40)).first();
  if (!cat) return deny(c, "category", 400);
  const ts = nowISO();
  const res = await c.env.DB.prepare(
    `INSERT INTO forum_threads (category_id,user_id,title,body,created_iso,last_iso,replies,pinned)
     VALUES (?,?,?,?,?,?,0,0)`
  ).bind(cat.id, u.id, title, text, ts, ts).run();
  await awardPoints(c.env, u.id, 5, "started a thread");
  return c.json({ ok: true, id: res.meta.last_row_id });
});

com.post("/forum/threads/:id/posts", async (c) => {
  const u = await requireUser(c); if (!u) return deny(c, "auth", 401);
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json().catch(() => ({}));
  const text = clean(body.text, 4000);
  if (!text) return deny(c, "empty", 400);
  const t = await c.env.DB.prepare("SELECT id FROM forum_threads WHERE id=? AND deleted_iso IS NULL").bind(id).first();
  if (!t) return deny(c, "not_found", 404);
  const ts = nowISO();
  const res = await c.env.DB.prepare(
    "INSERT INTO forum_posts (thread_id,user_id,body,created_iso) VALUES (?,?,?,?)"
  ).bind(id, u.id, text, ts).run();
  await c.env.DB.prepare("UPDATE forum_threads SET replies=replies+1, last_iso=? WHERE id=?").bind(ts, id).run();
  await awardPoints(c.env, u.id, 2, "forum reply");
  return c.json({ ok: true, id: res.meta.last_row_id });
});

com.delete("/forum/:kind/:id", async (c) => {
  const u = await requireUser(c); if (!u) return deny(c, "auth", 401);
  if (Number(u.level) < 5) return deny(c, "denied", 403);
  const kind = c.req.param("kind"), id = parseInt(c.req.param("id"), 10);
  const table = kind === "posts" ? "forum_posts" : kind === "threads" ? "forum_threads" : null;
  if (!table) return deny(c, "bad_kind", 400);
  await c.env.DB.prepare(`UPDATE ${table} SET deleted_iso=? WHERE id=?`).bind(nowISO(), id).run();
  return c.json({ ok: true });
});

/* ---------------- AVAILABILITY ---------------- */
com.post("/fixtures/:id/availability", async (c) => {
  const u = await requireUser(c); if (!u) return deny(c, "auth", 401);
  const fid = clean(c.req.param("id"), 40);
  const body = await c.req.json().catch(() => ({}));
  const status = ["yes", "maybe", "no"].indexOf(String(body.status)) !== -1 ? String(body.status) : "";
  const fx = await c.env.DB.prepare("SELECT id FROM fixtures WHERE id=?").bind(fid).first();
  if (!fx) return deny(c, "not_found", 404);
  if (status) {
    await c.env.DB.prepare(
      `INSERT INTO availability (fixture_id,user_id,status,updated_iso) VALUES (?,?,?,?)
       ON CONFLICT(fixture_id,user_id) DO UPDATE SET status=excluded.status, updated_iso=excluded.updated_iso`
    ).bind(fid, u.id, status, nowISO()).run();
    await awardOnce(c.env, u.id, 3, "rsvp:" + fid);
  } else {
    await c.env.DB.prepare("DELETE FROM availability WHERE fixture_id=? AND user_id=?").bind(fid, u.id).run();
  }
  const counts = rows(await c.env.DB.prepare(
    "SELECT status, COUNT(*) n FROM availability WHERE fixture_id=? GROUP BY status"
  ).bind(fid).all());
  return c.json({ ok: true, counts });
});

/* ---------------- PREDICTIONS ---------------- */
com.post("/fixtures/:id/predictions", async (c) => {
  const u = await requireUser(c); if (!u) return deny(c, "auth", 401);
  const fid = clean(c.req.param("id"), 40);
  const body = await c.req.json().catch(() => ({}));
  const our = Math.max(0, Math.min(30, parseInt(body.our, 10) || 0));
  const their = Math.max(0, Math.min(30, parseInt(body.their, 10) || 0));
  const fx = await c.env.DB.prepare("SELECT id, kind FROM fixtures WHERE id=?").bind(fid).first();
  if (!fx) return deny(c, "not_found", 404);
  if (fx.kind === "session") return deny(c, "no_predictions", 400); // sessions have no scoreline
  await c.env.DB.prepare(
    `INSERT INTO predictions (fixture_id,user_id,our,their,created_iso) VALUES (?,?,?,?,?)
     ON CONFLICT(fixture_id,user_id) DO UPDATE SET our=excluded.our, their=excluded.their, created_iso=excluded.created_iso`
  ).bind(fid, u.id, our, their, nowISO()).run();
  return c.json({ ok: true });
});

/* ---------------- REACTIONS (toggle) ---------------- */
com.post("/reactions", async (c) => {
  const u = await requireUser(c); if (!u) return deny(c, "auth", 401);
  const body = await c.req.json().catch(() => ({}));
  const ttype = clean(body.target_type, 24), tid = clean(body.target_id, 48), emoji = clean(body.emoji, 8);
  if (!ttype || !tid || !emoji) return deny(c, "bad_target", 400);
  const existing = await c.env.DB.prepare(
    "SELECT 1 FROM reactions WHERE target_type=? AND target_id=? AND emoji=? AND user_id=?"
  ).bind(ttype, tid, emoji, u.id).first();
  if (existing) {
    await c.env.DB.prepare("DELETE FROM reactions WHERE target_type=? AND target_id=? AND emoji=? AND user_id=?").bind(ttype, tid, emoji, u.id).run();
  } else {
    await c.env.DB.prepare("INSERT INTO reactions (target_type,target_id,emoji,user_id) VALUES (?,?,?,?)").bind(ttype, tid, emoji, u.id).run();
  }
  const counts = rows(await c.env.DB.prepare(
    "SELECT emoji, COUNT(*) n FROM reactions WHERE target_type=? AND target_id=? GROUP BY emoji"
  ).bind(ttype, tid).all());
  return c.json({ ok: true, reacted: !existing, counts });
});

export default com;
