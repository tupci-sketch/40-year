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
  // Reaction tallies per message + what the caller reacted to.
  if (page.length) {
    const ids = page.map((m) => String(m.id));
    const ph = ids.map(() => "?").join(",");
    const rx = rows(await c.env.DB.prepare(
      `SELECT target_id, emoji, COUNT(*) n FROM reactions WHERE target_type='chat' AND target_id IN (${ph}) GROUP BY target_id, emoji`
    ).bind(...ids).all());
    const mx = rows(await c.env.DB.prepare(
      `SELECT target_id, emoji FROM reactions WHERE target_type='chat' AND user_id=? AND target_id IN (${ph})`
    ).bind(u.id, ...ids).all());
    const rmap = {}, mine = {};
    for (const r of rx) (rmap[r.target_id] = rmap[r.target_id] || []).push({ emoji: r.emoji, n: r.n });
    for (const r of mx) (mine[r.target_id] = mine[r.target_id] || []).push(r.emoji);
    for (const m of page) { m.reactions = rmap[String(m.id)] || []; m.myReactions = mine[String(m.id)] || []; }
  }
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
  const list = rows(await c.env.DB.prepare(
    `SELECT c.id, c.key, c.name, c.sort, COUNT(t.id) AS threads
     FROM forum_categories c LEFT JOIN forum_threads t ON t.category_id=c.id AND t.deleted_iso IS NULL
     GROUP BY c.id ORDER BY c.sort ASC`
  ).all());
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
    `SELECT t.id,t.title,t.user_id,t.created_iso,t.last_iso,t.replies,t.pinned,c.key AS category, c.name AS category_name,
            u.display AS author, u.level AS author_level
     FROM forum_threads t JOIN forum_categories c ON c.id=t.category_id
     LEFT JOIN users u ON u.id=t.user_id
     WHERE ${conds.join(" AND ")}
     ORDER BY t.pinned DESC, t.last_iso DESC LIMIT ?`
  ).bind(...args, limit + 1).all());
  const hasMore = list.length > limit;
  const page = list.slice(0, limit);
  const cos = await cosmeticsFor(c.env, page.map((t) => t.user_id));
  for (const t of page) { const cm = cos[t.user_id] || {}; t.flair = cm.flair || null; t.accent = cm.accent || null; }
  return c.json({ ok: true, threads: page, nextCursor: hasMore ? page[page.length - 1].last_iso : null });
});

com.get("/forum/threads/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const t = await c.env.DB.prepare(
    `SELECT t.*, c.key AS category, c.name AS category_name, u.display AS author, u.level AS author_level
     FROM forum_threads t JOIN forum_categories c ON c.id=t.category_id
     LEFT JOIN users u ON u.id=t.user_id WHERE t.id=? AND t.deleted_iso IS NULL`
  ).bind(id).first();
  if (!t) return deny(c, "not_found", 404);
  const limit = clampLimit(c.req.query("limit"), 30, 100);
  const cursor = parseInt(c.req.query("cursor"), 10);
  const where = isFinite(cursor) ? "AND p.id > ?" : "";
  const args = isFinite(cursor) ? [id, cursor, limit + 1] : [id, limit + 1];
  const posts = rows(await c.env.DB.prepare(
    `SELECT p.id, p.user_id, p.body, p.created_iso, u.display AS author, u.level AS author_level
     FROM forum_posts p LEFT JOIN users u ON u.id=p.user_id
     WHERE p.thread_id=? AND p.deleted_iso IS NULL ${where} ORDER BY p.id ASC LIMIT ?`
  ).bind(...args).all());
  const hasMore = posts.length > limit;
  const page = posts.slice(0, limit);

  // Author cosmetics for the OP + everyone on the page.
  const cos = await cosmeticsFor(c.env, [t.user_id].concat(page.map((p) => p.user_id)));
  const oc = cos[t.user_id] || {}; t.flair = oc.flair || null; t.accent = oc.accent || null;
  for (const p of page) { const cm = cos[p.user_id] || {}; p.flair = cm.flair || null; p.accent = cm.accent || null; }

  // Reaction tallies for the OP (thread) + each post, plus what the caller reacted to.
  const me = await currentUser(c);
  const targets = [["thread", String(id)]].concat(page.map((p) => ["post", String(p.id)]));
  const rmap = {}, mine = {};
  if (targets.length) {
    const tph = targets.map(() => "(?,?)").join(",");
    const flat = [];
    for (const [tt, ti] of targets) { flat.push(tt, ti); }
    const rx = rows(await c.env.DB.prepare(
      `SELECT target_type, target_id, emoji, COUNT(*) n FROM reactions
       WHERE (target_type, target_id) IN (${tph}) GROUP BY target_type, target_id, emoji`
    ).bind(...flat).all());
    for (const r of rx) (rmap[r.target_type + ":" + r.target_id] = rmap[r.target_type + ":" + r.target_id] || []).push({ emoji: r.emoji, n: r.n });
    if (me) {
      const mx = rows(await c.env.DB.prepare(
        `SELECT target_type, target_id, emoji FROM reactions WHERE user_id=? AND (target_type, target_id) IN (${tph})`
      ).bind(me.id, ...flat).all());
      for (const r of mx) mine[r.target_type + ":" + r.target_id + ":" + r.emoji] = 1;
    }
  }
  t.reactions = rmap["thread:" + id] || [];
  t.myReactions = Object.keys(mine).filter((k) => k.indexOf("thread:" + id + ":") === 0).map((k) => k.split(":")[2]);
  for (const p of page) {
    p.reactions = rmap["post:" + p.id] || [];
    p.myReactions = Object.keys(mine).filter((k) => k.indexOf("post:" + p.id + ":") === 0).map((k) => k.split(":")[2]);
  }
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

/* ---------------- POLLS ---------------- */
com.get("/polls", async (c) => {
  const me = await currentUser(c);
  const polls = rows(await c.env.DB.prepare("SELECT id,question,created_by,created_iso,closed FROM polls ORDER BY id DESC LIMIT 30").all());
  if (!polls.length) return c.json({ ok: true, polls: [] });
  const ids = polls.map((p) => p.id); const ph = ids.map(() => "?").join(",");
  const opts = rows(await c.env.DB.prepare(`SELECT id,poll_id,label,sort FROM poll_options WHERE poll_id IN (${ph}) ORDER BY sort ASC, id ASC`).bind(...ids).all());
  const counts = rows(await c.env.DB.prepare(`SELECT poll_id, option_id, COUNT(*) n FROM poll_votes WHERE poll_id IN (${ph}) GROUP BY poll_id, option_id`).bind(...ids).all());
  const cmap = {}; for (const r of counts) cmap[r.poll_id + ":" + r.option_id] = r.n;
  let mine = {};
  if (me) { for (const r of rows(await c.env.DB.prepare(`SELECT poll_id, option_id FROM poll_votes WHERE user_id=? AND poll_id IN (${ph})`).bind(me.id, ...ids).all())) mine[r.poll_id] = r.option_id; }
  const optByPoll = {};
  for (const o of opts) (optByPoll[o.poll_id] = optByPoll[o.poll_id] || []).push({ id: o.id, label: o.label, votes: cmap[o.poll_id + ":" + o.id] || 0 });
  return c.json({ ok: true, polls: polls.map((p) => ({ id: p.id, question: p.question, closed: p.closed, created_iso: p.created_iso,
    options: optByPoll[p.id] || [], total: (optByPoll[p.id] || []).reduce((a, o) => a + o.votes, 0), myVote: me ? (mine[p.id] || null) : null })) });
});

com.post("/polls", async (c) => {
  const u = await requireUser(c); if (!u) return deny(c, "auth", 401);
  if (Number(u.level) < 5) return deny(c, "denied", 403); // L5+ run polls
  const b = await c.req.json().catch(() => ({}));
  const question = clean(b.question, 160);
  const options = (Array.isArray(b.options) ? b.options : []).map((o) => clean(o, 80)).filter(Boolean).slice(0, 8);
  if (!question || options.length < 2) return deny(c, "need_2", 400);
  const r = await c.env.DB.prepare("INSERT INTO polls (question,created_by,created_iso,closed) VALUES (?,?,?,0)").bind(question, u.id, nowISO()).run();
  const pid = r.meta.last_row_id;
  let sort = 0;
  for (const label of options) await c.env.DB.prepare("INSERT INTO poll_options (poll_id,label,sort) VALUES (?,?,?)").bind(pid, label, sort++).run();
  return c.json({ ok: true, id: pid });
});

com.post("/polls/:id/vote", async (c) => {
  const u = await requireUser(c); if (!u) return deny(c, "auth", 401);
  const pid = parseInt(c.req.param("id"), 10);
  const b = await c.req.json().catch(() => ({}));
  const optionId = parseInt(b.optionId, 10);
  const poll = await c.env.DB.prepare("SELECT id,closed FROM polls WHERE id=?").bind(pid).first();
  if (!poll) return deny(c, "not_found", 404);
  if (poll.closed) return deny(c, "closed", 400);
  const opt = await c.env.DB.prepare("SELECT id FROM poll_options WHERE id=? AND poll_id=?").bind(optionId, pid).first();
  if (!opt) return deny(c, "bad_option", 400);
  const first = !(await c.env.DB.prepare("SELECT 1 FROM poll_votes WHERE poll_id=? AND user_id=?").bind(pid, u.id).first());
  await c.env.DB.prepare(
    `INSERT INTO poll_votes (poll_id,option_id,user_id,created_iso) VALUES (?,?,?,?)
     ON CONFLICT(poll_id,user_id) DO UPDATE SET option_id=excluded.option_id, created_iso=excluded.created_iso`
  ).bind(pid, optionId, u.id, nowISO()).run();
  if (first) await awardPoints(c.env, u.id, 1, "voted in a poll");
  return c.json({ ok: true });
});

com.post("/polls/:id/close", async (c) => {
  const u = await requireUser(c); if (!u) return deny(c, "auth", 401);
  if (Number(u.level) < 5) return deny(c, "denied", 403);
  await c.env.DB.prepare("UPDATE polls SET closed=1 WHERE id=?").bind(parseInt(c.req.param("id"), 10)).run();
  return c.json({ ok: true });
});

export default com;
