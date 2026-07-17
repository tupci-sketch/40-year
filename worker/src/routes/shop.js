/* ============================================================
   Virgil Points wallet, the club shop, and matchday tickets.
   Members earn points around the site (chat, forum, RSVPs,
   predictions) and spend them here on cosmetics + tickets.
   Mounted at /api.
   ============================================================ */
import { Hono } from "hono";
import { currentUser, nowISO } from "../lib/auth.js";
import { awardPoints, getBalance } from "../lib/points.js";

const shop = new Hono();
function rows(r) { return (r && r.results) || []; }
// Guarded query: returns [] if the engagement tables aren't migrated in yet,
// so the wallet/shop/tickets endpoints degrade to empty instead of 500ing.
async function tryRows(env, sql, args) { try { return rows(await env.DB.prepare(sql).bind(...(args || [])).all()); } catch (e) { return []; } }
function deny(c, code, status) { return c.json({ ok: false, error: code, code }, status); }
async function requireUser(c) { return await currentUser(c); }

/* ---- wallet: balance, recent ledger, owned inventory ---- */
shop.get("/me/points", async (c) => {
  const u = await requireUser(c); if (!u) return deny(c, "auth", 401);
  const bal = await getBalance(c.env, u.id);
  const events = await tryRows(c.env, "SELECT delta, reason, created_iso FROM point_events WHERE user_id=? ORDER BY id DESC LIMIT 20", [u.id]);
  const inventory = await tryRows(c.env, "SELECT id, sku, kind, payload, fixture_id, cost, created_iso FROM user_purchases WHERE user_id=? ORDER BY id DESC", [u.id]);
  return c.json({ ok: true, balance: bal.balance, lifetime: bal.lifetime, events, inventory });
});

/* ---- shop catalogue (cosmetics only; tickets are bought per-fixture) ---- */
shop.get("/shop", async (c) => {
  const items = await tryRows(c.env, "SELECT id, sku, name, description, kind, payload, cost, sort FROM shop_items WHERE active=1 ORDER BY sort ASC, cost ASC");
  let owned = [];
  const u = await requireUser(c);
  if (u) owned = (await tryRows(c.env, "SELECT DISTINCT sku FROM user_purchases WHERE user_id=?", [u.id])).map((r) => r.sku);
  return c.json({ ok: true, items, owned });
});

/* ---- buy a cosmetic by sku ---- */
shop.post("/shop/buy", async (c) => {
  const u = await requireUser(c); if (!u) return deny(c, "auth", 401);
  const b = await c.req.json().catch(() => ({}));
  const sku = String(b.sku || "").slice(0, 40);
  const item = await c.env.DB.prepare("SELECT * FROM shop_items WHERE sku=? AND active=1").bind(sku).first();
  if (!item) return deny(c, "no_item", 404);
  if (item.kind === "ticket") return deny(c, "use_ticket_route", 400);
  const already = await c.env.DB.prepare("SELECT id FROM user_purchases WHERE user_id=? AND sku=?").bind(u.id, sku).first();
  if (already) return deny(c, "owned", 400);
  const bal = await getBalance(c.env, u.id);
  if (bal.balance < item.cost) return deny(c, "insufficient", 400);
  await awardPoints(c.env, u.id, -item.cost, "bought " + item.name);
  await c.env.DB.prepare(
    "INSERT INTO user_purchases (user_id, item_id, sku, kind, payload, cost, created_iso) VALUES (?,?,?,?,?,?,?)"
  ).bind(u.id, item.id, item.sku, item.kind, item.payload, item.cost, nowISO()).run();
  const nb = await getBalance(c.env, u.id);
  return c.json({ ok: true, balance: nb.balance });
});

/* ---- claim a matchday ticket for a fixture (fixed price in points) ---- */
const TICKET_COST = 25;
shop.post("/tickets/claim", async (c) => {
  const u = await requireUser(c); if (!u) return deny(c, "auth", 401);
  const b = await c.req.json().catch(() => ({}));
  const fid = String(b.fixtureId || "").slice(0, 40);
  const fx = await c.env.DB.prepare("SELECT id, opponent, date_iso, kind FROM fixtures WHERE id=?").bind(fid).first();
  if (!fx) return deny(c, "no_fixture", 404);
  const held = await c.env.DB.prepare("SELECT id FROM user_purchases WHERE user_id=? AND kind='ticket' AND fixture_id=?").bind(u.id, fid).first();
  if (held) return deny(c, "already_have", 400);
  const bal = await getBalance(c.env, u.id);
  if (bal.balance < TICKET_COST) return deny(c, "insufficient", 400);
  await awardPoints(c.env, u.id, -TICKET_COST, "ticket: " + (fx.opponent || "session"));
  await c.env.DB.prepare(
    "INSERT INTO user_purchases (user_id, sku, kind, payload, fixture_id, cost, created_iso) VALUES (?,?,?,?,?,?,?)"
  ).bind(u.id, "ticket", "ticket", fx.opponent || "Club session", fid, TICKET_COST, nowISO()).run();
  const nb = await getBalance(c.env, u.id);
  return c.json({ ok: true, balance: nb.balance, cost: TICKET_COST });
});

/* ---- my tickets (upcoming, joined to fixtures) ---- */
shop.get("/tickets", async (c) => {
  const u = await requireUser(c); if (!u) return deny(c, "auth", 401);
  const list = await tryRows(c.env,
    `SELECT p.id, p.fixture_id, p.created_iso, f.opponent, f.date_iso, f.kind, f.stage
     FROM user_purchases p LEFT JOIN fixtures f ON f.id=p.fixture_id
     WHERE p.user_id=? AND p.kind='ticket' ORDER BY p.id DESC`, [u.id]);
  return c.json({ ok: true, tickets: list, cost: TICKET_COST });
});

export default shop;
export { TICKET_COST };
