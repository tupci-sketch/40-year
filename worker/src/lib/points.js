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
  await env.DB.prepare(
    `INSERT INTO user_points (user_id, balance, lifetime, updated_iso) VALUES (?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?, lifetime = lifetime + ?, updated_iso = ?`
  ).bind(userId, delta, credit, iso, delta, credit, iso).run();
  await env.DB.prepare(
    "INSERT INTO point_events (user_id, delta, reason, created_iso) VALUES (?,?,?,?)"
  ).bind(userId, delta, String(reason || "").slice(0, 60), iso).run();
}

/* Award once per (user, reason-key) — used for "first RSVP to this fixture"
   style credits so members can't farm points by toggling. Returns true if a
   credit was actually made. */
export async function awardOnce(env, userId, delta, reasonKey) {
  const existing = await env.DB.prepare(
    "SELECT id FROM point_events WHERE user_id=? AND reason=? LIMIT 1"
  ).bind(userId, reasonKey).first();
  if (existing) return false;
  await awardPoints(env, userId, delta, reasonKey);
  return true;
}

export async function getBalance(env, userId) {
  const row = await env.DB.prepare("SELECT balance, lifetime FROM user_points WHERE user_id=?").bind(userId).first();
  return { balance: row ? row.balance : 0, lifetime: row ? row.lifetime : 0 };
}
