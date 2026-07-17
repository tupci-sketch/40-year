/* ============================================================
   The Clubhouse Floor — a shared avatar room. Members walk a
   token around a grid; everyone present sees everyone else via
   short polling (no WebSockets needed at this scale). Presence
   is one upserted row per member; anyone quiet for 45s drops off.
   Mounted at /api.
   ============================================================ */
import { Hono } from "hono";
import { currentUser, nowISO } from "../lib/auth.js";
import { cosmeticsFor } from "../lib/points.js";

const room = new Hono();
function rows(r) { return (r && r.results) || []; }
function deny(c, code, status) { return c.json({ ok: false, error: code, code }, status); }
const GRID = 13;            // 0..12 floor tiles
const ALIVE_MS = 45000;     // presence window

function clampCoord(v) { v = parseInt(v, 10); if (!isFinite(v)) return 6; return Math.max(0, Math.min(GRID - 1, v)); }

/* Who's on the floor right now (+ the caller's own tile). */
room.get("/room", async (c) => {
  const me = await currentUser(c);
  const cutoff = new Date(Date.now() - ALIVE_MS).toISOString();
  let present = [];
  try {
    present = rows(await c.env.DB.prepare(
      `SELECT rp.user_id, rp.x, rp.y, rp.emote, u.display, u.level
       FROM room_presence rp JOIN users u ON u.id=rp.user_id
       WHERE rp.updated_iso >= ? AND u.banned=0 ORDER BY rp.updated_iso DESC LIMIT 40`
    ).bind(cutoff).all());
  } catch (e) { present = []; }
  const cos = await cosmeticsFor(c.env, present.map((p) => p.user_id));
  const occupants = present.map((p) => {
    const cm = cos[p.user_id] || {};
    return { userId: p.user_id, x: p.x, y: p.y, emote: p.emote || null, display: p.display, level: p.level,
      flair: cm.flair || null, accent: cm.accent || null, me: !!(me && me.id === p.user_id) };
  });
  return c.json({ ok: true, grid: GRID, occupants, signedIn: !!me });
});

/* Move / emote — upserts the caller's tile. */
room.post("/room/move", async (c) => {
  const u = await currentUser(c); if (!u) return deny(c, "auth", 401);
  const b = await c.req.json().catch(() => ({}));
  const x = clampCoord(b.x), y = clampCoord(b.y);
  const emote = b.emote ? String(b.emote).slice(0, 8) : null;
  try {
    await c.env.DB.prepare(
      `INSERT INTO room_presence (user_id,x,y,emote,updated_iso) VALUES (?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET x=excluded.x, y=excluded.y, emote=excluded.emote, updated_iso=excluded.updated_iso`
    ).bind(u.id, x, y, emote, nowISO()).run();
  } catch (e) { return c.json({ ok: false, error: "room_unavailable", code: 400 }, 400); }
  return c.json({ ok: true, x, y });
});

/* Leave the floor. */
room.post("/room/leave", async (c) => {
  const u = await currentUser(c); if (!u) return deny(c, "auth", 401);
  try { await c.env.DB.prepare("DELETE FROM room_presence WHERE user_id=?").bind(u.id).run(); } catch (e) {}
  return c.json({ ok: true });
});

export default room;
