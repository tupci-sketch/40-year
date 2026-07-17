/* ============================================================
   Virgil Points — the club's engagement currency.
   awardPoints credits a member and writes a ledger row; the
   balance table is upserted so a first-time earner is created
   on the fly. Debits (shop spend) go through the same path with
   a negative delta, guarded by a balance check at the call site.
   ============================================================ */
import { nowISO } from "./auth.js";

export async function awardPoints(env, userId, delta, reason) {
  if (!userId || !delta) return;
  const iso = nowISO();
  const credit = delta > 0 ? delta : 0;
  // Never let a points credit break the core action that triggered it: if the
  // engagement tables aren't migrated in yet, swallow the error and move on.
  try {
    await env.DB.prepare(
      `INSERT INTO user_points (user_id, balance, lifetime, updated_iso) VALUES (?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?, lifetime = lifetime + ?, updated_iso = ?`
    ).bind(userId, delta, credit, iso, delta, credit, iso).run();
    await env.DB.prepare(
      "INSERT INTO point_events (user_id, delta, reason, created_iso) VALUES (?,?,?,?)"
    ).bind(userId, delta, String(reason || "").slice(0, 60), iso).run();
  } catch (e) { /* points tables not present yet — ignore */ }
}

/* Award once per (user, reason-key) — used for "first RSVP to this fixture"
   style credits so members can't farm points by toggling. Returns true if a
   credit was actually made. */
export async function awardOnce(env, userId, delta, reasonKey) {
  try {
    const existing = await env.DB.prepare(
      "SELECT id FROM point_events WHERE user_id=? AND reason=? LIMIT 1"
    ).bind(userId, reasonKey).first();
    if (existing) return false;
  } catch (e) { return false; }
  await awardPoints(env, userId, delta, reasonKey);
  return true;
}

/* Equipped cosmetics for a set of user ids, as { [userId]: {flair, accent} }.
   Guarded: if the flair/accent columns aren't migrated in yet, returns {} so
   callers (profiles, members, chat) keep working unchanged. */
export async function cosmeticsFor(env, userIds) {
  const ids = (userIds || []).filter((x) => x != null);
  if (!ids.length) return {};
  try {
    const ph = ids.map(() => "?").join(",");
    const r = await env.DB.prepare(
      `SELECT user_id, flair, accent FROM user_profiles WHERE user_id IN (${ph})`
    ).bind(...ids).all();
    const out = {};
    for (const row of (r && r.results) || []) out[row.user_id] = { flair: row.flair || null, accent: row.accent || null };
    return out;
  } catch (e) { return {}; }
}

export async function getBalance(env, userId) {
  try {
    const row = await env.DB.prepare("SELECT balance, lifetime FROM user_points WHERE user_id=?").bind(userId).first();
    return { balance: row ? row.balance : 0, lifetime: row ? row.lifetime : 0 };
  } catch (e) { return { balance: 0, lifetime: 0 }; }
}
