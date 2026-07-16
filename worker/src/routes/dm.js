/* ============================================================
   Private messages (1:1, polling). Mounted at /api/dm.
   Launch scope: text only, no groups/attachments. Blocks + reports
   are enforced server-side; L5 cannot browse DMs — only reported
   content is reviewable by L9, and that access is always audited.
   ============================================================ */
import { Hono } from "hono";
import { currentUser, requireLevel, nowISO } from "../lib/auth.js";

const dm = new Hono();
function rows(r) { return (r && r.results) || []; }
function clean(s, max) { return String(s == null ? "" : s).trim().slice(0, max); }
function deny(c, code, status) { return c.json({ ok: false, error: code, code }, status); }

async function isBlocked(env, a, b) {
  const row = await env.DB.prepare(
    "SELECT 1 FROM user_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)"
  ).bind(a, b, b, a).first();
  return !!row;
}

/* Can `sender` DM `recipient`, per the recipient's privacy policy? */
async function canMessage(env, senderId, recipient) {
  if (await isBlocked(env, senderId, recipient.id)) return false;
  const priv = await env.DB.prepare("SELECT dm_policy FROM user_privacy WHERE user_id=?").bind(recipient.id).first();
  const policy = priv ? priv.dm_policy : "established";
  if (policy === "off") return false;
  if (policy === "any") return true;
  if (policy === "staff") {
    const sender = await env.DB.prepare("SELECT level FROM users WHERE id=?").bind(senderId).first();
    return sender && Number(sender.level) >= 5;
  }
  // "established": account must be at least 3 days old (a light anti-spam bar)
  const sender = await env.DB.prepare("SELECT created_iso FROM users WHERE id=?").bind(senderId).first();
  if (!sender) return false;
  const ageMs = Date.now() - new Date(sender.created_iso).getTime();
  return ageMs >= 3 * 86400000;
}

/* ---- inbox: recent conversations with unread counts ---- */
dm.get("/conversations", async (c) => {
  const u = await currentUser(c); if (!u) return deny(c, "auth", 401);
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit"), 10) || 20));
  const list = rows(await c.env.DB.prepare(
    `SELECT dc.id, dc.last_msg_iso, dm2.last_read_iso,
            (SELECT u2.id FROM dm_members m2 JOIN users u2 ON u2.id=m2.user_id WHERE m2.conversation_id=dc.id AND m2.user_id != ?) AS other_id,
            (SELECT u2.display FROM dm_members m2 JOIN users u2 ON u2.id=m2.user_id WHERE m2.conversation_id=dc.id AND m2.user_id != ?) AS other_display,
            (SELECT body FROM dm_messages WHERE conversation_id=dc.id AND deleted_iso IS NULL ORDER BY id DESC LIMIT 1) AS preview,
            (SELECT COUNT(*) FROM dm_messages WHERE conversation_id=dc.id AND deleted_iso IS NULL AND created_iso > COALESCE(dm2.last_read_iso, '')) AS unread
     FROM dm_conversations dc JOIN dm_members dm2 ON dm2.conversation_id=dc.id AND dm2.user_id=?
     ORDER BY dc.last_msg_iso DESC LIMIT ?`
  ).bind(u.id, u.id, u.id, limit).all());
  return c.json({ ok: true, conversations: list });
});

/* ---- start (or reuse) a 1:1 conversation ---- */
dm.post("/conversations", async (c) => {
  const u = await currentUser(c); if (!u) return deny(c, "auth", 401);
  const b = await c.req.json().catch(() => ({}));
  const targetName = clean(b.username, 20).toLowerCase();
  if (!targetName) return deny(c, "target", 400);
  const target = await c.env.DB.prepare("SELECT * FROM users WHERE username=?").bind(targetName).first();
  if (!target) return deny(c, "not_found", 404);
  if (target.id === u.id) return deny(c, "self", 400);
  if (Number(target.banned) === 1) return deny(c, "not_found", 404);
  if (!(await canMessage(c.env, u.id, target))) return deny(c, "not_allowed", 403);

  // reuse an existing 1:1 conversation between these two users if one exists
  const existing = await c.env.DB.prepare(
    `SELECT dc.id FROM dm_conversations dc
     JOIN dm_members m1 ON m1.conversation_id=dc.id AND m1.user_id=?
     JOIN dm_members m2 ON m2.conversation_id=dc.id AND m2.user_id=?
     LIMIT 1`
  ).bind(u.id, target.id).first();
  if (existing) return c.json({ ok: true, id: existing.id, existed: true });

  const ts = nowISO();
  const res = await c.env.DB.prepare("INSERT INTO dm_conversations (created_iso, last_msg_iso) VALUES (?,?)").bind(ts, ts).run();
  const convId = res.meta.last_row_id;
  await c.env.DB.prepare("INSERT INTO dm_members (conversation_id,user_id,last_read_iso) VALUES (?,?,?)").bind(convId, u.id, ts).run();
  await c.env.DB.prepare("INSERT INTO dm_members (conversation_id,user_id,last_read_iso) VALUES (?,?,NULL)").bind(convId, target.id).run();
  return c.json({ ok: true, id: convId, existed: false });
});

async function requireMember(c, convId, userId) {
  return await c.env.DB.prepare("SELECT 1 FROM dm_members WHERE conversation_id=? AND user_id=?").bind(convId, userId).first();
}

/* ---- fetch messages (paginated) + mark read ---- */
dm.get("/conversations/:id/messages", async (c) => {
  const u = await currentUser(c); if (!u) return deny(c, "auth", 401);
  const convId = parseInt(c.req.param("id"), 10);
  if (!(await requireMember(c, convId, u.id))) return deny(c, "not_found", 404);

  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit"), 10) || 40));
  const cursor = parseInt(c.req.query("cursor"), 10);
  const where = isFinite(cursor) ? "AND id < ?" : "";
  const args = isFinite(cursor) ? [convId, cursor, limit + 1] : [convId, limit + 1];
  const list = rows(await c.env.DB.prepare(
    `SELECT id, sender_id, body, created_iso FROM dm_messages WHERE conversation_id=? AND deleted_iso IS NULL ${where} ORDER BY id DESC LIMIT ?`
  ).bind(...args).all());
  const hasMore = list.length > limit;
  const page = list.slice(0, limit);

  await c.env.DB.prepare("UPDATE dm_members SET last_read_iso=? WHERE conversation_id=? AND user_id=?").bind(nowISO(), convId, u.id).run();
  return c.json({ ok: true, messages: page, nextCursor: hasMore ? page[page.length - 1].id : null });
});

/* ---- send a message ---- */
dm.post("/conversations/:id/messages", async (c) => {
  const u = await currentUser(c); if (!u) return deny(c, "auth", 401);
  const convId = parseInt(c.req.param("id"), 10);
  if (!(await requireMember(c, convId, u.id))) return deny(c, "not_found", 404);

  const other = await c.env.DB.prepare("SELECT user_id FROM dm_members WHERE conversation_id=? AND user_id != ?").bind(convId, u.id).first();
  if (other && (await isBlocked(c.env, u.id, other.user_id))) return deny(c, "blocked", 403);

  const b = await c.req.json().catch(() => ({}));
  const body = clean(b.text, 1000);
  if (!body) return deny(c, "empty", 400);

  const ts = nowISO();
  const res = await c.env.DB.prepare(
    "INSERT INTO dm_messages (conversation_id,sender_id,body,created_iso) VALUES (?,?,?,?)"
  ).bind(convId, u.id, body, ts).run();
  await c.env.DB.prepare("UPDATE dm_conversations SET last_msg_iso=? WHERE id=?").bind(ts, convId).run();
  await c.env.DB.prepare("UPDATE dm_members SET last_read_iso=? WHERE conversation_id=? AND user_id=?").bind(ts, convId, u.id).run();
  return c.json({ ok: true, id: res.meta.last_row_id });
});

/* ---- report a message ---- */
dm.post("/messages/:id/report", async (c) => {
  const u = await currentUser(c); if (!u) return deny(c, "auth", 401);
  const msgId = parseInt(c.req.param("id"), 10);
  const msg = await c.env.DB.prepare("SELECT conversation_id FROM dm_messages WHERE id=?").bind(msgId).first();
  if (!msg || !(await requireMember(c, msg.conversation_id, u.id))) return deny(c, "not_found", 404);
  const b = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare(
    "INSERT INTO dm_message_reports (message_id,reporter_id,reason,status,created_iso) VALUES (?,?,?,?,?)"
  ).bind(msgId, u.id, clean(b.reason, 300), "open", nowISO()).run();
  return c.json({ ok: true });
});

/* ---- block / unblock ---- */
dm.post("/users/:id/block", async (c) => {
  const u = await currentUser(c); if (!u) return deny(c, "auth", 401);
  const targetId = parseInt(c.req.param("id"), 10);
  if (targetId === u.id) return deny(c, "self", 400);
  await c.env.DB.prepare(
    "INSERT INTO user_blocks (blocker_id,blocked_id,created_iso) VALUES (?,?,?) ON CONFLICT(blocker_id,blocked_id) DO NOTHING"
  ).bind(u.id, targetId, nowISO()).run();
  return c.json({ ok: true });
});

dm.delete("/users/:id/block", async (c) => {
  const u = await currentUser(c); if (!u) return deny(c, "auth", 401);
  const targetId = parseInt(c.req.param("id"), 10);
  await c.env.DB.prepare("DELETE FROM user_blocks WHERE blocker_id=? AND blocked_id=?").bind(u.id, targetId).run();
  return c.json({ ok: true });
});

/* ============================================================
   L9 moderation: review reported DM content only — never a
   general "browse all conversations" surface. Every access is
   audited (who, what, why, when).
   ============================================================ */
const dmAdmin = new Hono();

dmAdmin.get("/dm-reports", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return deny(c, g.err, g.status);
  const list = rows(await c.env.DB.prepare(
    `SELECT r.id, r.message_id, r.reporter_id, r.reason, r.status, r.created_iso,
            m.conversation_id, m.sender_id, m.body, m.created_iso AS message_iso
     FROM dm_message_reports r JOIN dm_messages m ON m.id = r.message_id
     WHERE r.status='open' ORDER BY r.created_iso DESC`
  ).all());
  await c.env.DB.prepare(
    "INSERT INTO audit_log (actor_id,action,target_type,target_id,detail_json,created_iso) VALUES (?,?,?,?,?,?)"
  ).bind(g.user.id, "dm_reports_view", "dm_report", null, JSON.stringify({ count: list.length }), nowISO()).run();
  return c.json({ ok: true, reports: list });
});

dmAdmin.patch("/dm-reports/:id", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return deny(c, g.err, g.status);
  const id = parseInt(c.req.param("id"), 10);
  const b = await c.req.json().catch(() => ({}));
  const status = ["actioned", "dismissed"].includes(b.status) ? b.status : null;
  if (!status) return deny(c, "status", 400);
  await c.env.DB.prepare("UPDATE moderation_reports SET status=? WHERE id=?").bind(status, id).run();
  await c.env.DB.prepare("UPDATE dm_message_reports SET status=? WHERE id=?").bind(status, id).run();
  await c.env.DB.prepare(
    "INSERT INTO audit_log (actor_id,action,target_type,target_id,detail_json,created_iso) VALUES (?,?,?,?,?,?)"
  ).bind(g.user.id, "dm_report_action", "dm_report", id, JSON.stringify({ status }), nowISO()).run();
  return c.json({ ok: true });
});

export default dm;
export { dmAdmin };
