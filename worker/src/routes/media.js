/* ============================================================
   Player-card uploads (R2) — L7+ upload/replace, L9 moderate.
   The upload is proxied through the Worker (no AWS-SigV4 presign
   complexity): the browser PUTs raw image bytes here, the Worker
   validates and writes to R2 itself. Images are served back
   through /api/media/player-cards/file/:key so no public R2
   bucket domain is required. Mounted at /api/media/player-cards.
   ============================================================ */
import { Hono } from "hono";
import { requireLevel, nowISO } from "../lib/auth.js";
import { sha256HexBytes } from "../lib/crypto.js";
import { sniffImage } from "../lib/imagesniff.js";

const media = new Hono();
function rows(r) { return (r && r.results) || []; }
function clean(s, max) { return String(s == null ? "" : s).trim().slice(0, max); }
function slugify(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "card"; }

const MAX_BYTES = 3 * 1024 * 1024; // 3MB
const EXT = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };

async function audit(env, actorId, action, targetId, detail) {
  await env.DB.prepare(
    "INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, created_iso) VALUES (?,?,?,?,?,?)"
  ).bind(actorId, action, "player_card", String(targetId ?? ""), detail ? JSON.stringify(detail) : null, nowISO()).run();
}

/* ---- upload / replace (L7+) ----
   Client sends raw bytes as the request body, with:
     ?playerId=amy&label=Away+kit
   The Worker sniffs the real file type from magic bytes (never the
   client's Content-Type), validates size, and writes to R2 itself —
   trusted L7 uploads publish immediately; L9 can roll back after. */
media.put("/upload", async (c) => {
  const g = await requireLevel(c, 7); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);

  const playerId = clean(c.req.query("playerId"), 24).toLowerCase().replace(/[^a-z0-9_\-]/g, "");
  const label = clean(c.req.query("label"), 40) || "card";
  if (!playerId) return c.json({ ok: false, error: "player", code: "player" }, 400);
  const player = await c.env.DB.prepare("SELECT id FROM players WHERE id=?").bind(playerId).first();
  if (!player) return c.json({ ok: false, error: "player_not_found", code: "player_not_found" }, 404);

  const buf = await c.req.arrayBuffer();
  if (!buf || buf.byteLength === 0) return c.json({ ok: false, error: "empty", code: "empty" }, 400);
  if (buf.byteLength > MAX_BYTES) return c.json({ ok: false, error: "too_large", code: "too_large", max: MAX_BYTES }, 413);

  const bytes = new Uint8Array(buf);
  const sniff = sniffImage(bytes);
  if (!sniff.type || !EXT[sniff.type]) {
    return c.json({ ok: false, error: "bad_type", code: "bad_type", detail: "Only WebP, PNG or JPEG images are accepted." }, 400);
  }

  const checksum = await sha256HexBytes(buf);
  const verRow = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(version),0) mx FROM player_card_assets WHERE player_id=?"
  ).bind(playerId).first();
  const version = Number(verRow.mx) + 1;
  const slug = slugify(playerId), labelSlug = slugify(label);
  const objectKey = `cards/${slug}-${labelSlug}-v${version}.${EXT[sniff.type]}`;

  await c.env.CARDS.put(objectKey, buf, { httpMetadata: { contentType: sniff.type } });

  // demote the previous active card for this player+media_type
  const prevActive = await c.env.DB.prepare(
    "SELECT id FROM player_card_assets WHERE player_id=? AND media_type='card' AND status='active'"
  ).bind(playerId).first();

  const publicUrl = `/api/media/player-cards/file/${objectKey}`;
  const ins = await c.env.DB.prepare(
    `INSERT INTO player_card_assets
       (player_id, object_key, public_url, media_type, original_filename, mime_type, byte_size, width, height,
        checksum, version, status, uploaded_by, uploaded_iso, approved_by, approved_iso)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(playerId, objectKey, publicUrl, "card", clean(c.req.query("filename"), 120) || null, sniff.type,
    buf.byteLength, sniff.width, sniff.height, checksum, version, "active",
    g.user.id, nowISO(), g.user.id, nowISO()).run();
  const newId = ins.meta.last_row_id;

  if (prevActive) {
    await c.env.DB.prepare("UPDATE player_card_assets SET status='replaced', replaced_by=? WHERE id=?").bind(newId, prevActive.id).run();
  }

  await audit(c.env, g.user.id, "card_upload", newId, { playerId, version, objectKey });
  return c.json({ ok: true, id: newId, objectKey, publicUrl, version, width: sniff.width, height: sniff.height });
});

/* ---- serve the image (public, cache-friendly) ---- */
media.get("/file/*", async (c) => {
  const key = c.req.path.replace(/^.*\/file\//, "");
  const obj = await c.env.CARDS.get(key);
  if (!obj) return c.json({ ok: false, error: "not_found", code: 404 }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable"); // versioned key → safe to cache forever
  headers.set("ETag", obj.httpEtag);
  return new Response(obj.body, { headers });
});

/* ---- metadata (public: current card per player; admin: full history) ---- */
media.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const row = await c.env.DB.prepare("SELECT * FROM player_card_assets WHERE id=?").bind(id).first();
  if (!row) return c.json({ ok: false, error: "not_found", code: 404 }, 404);
  return c.json({ ok: true, card: row });
});

media.get("/player/:playerId/history", async (c) => {
  const g = await requireLevel(c, 7); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const playerId = clean(c.req.param("playerId"), 24);
  const list = rows(await c.env.DB.prepare(
    "SELECT * FROM player_card_assets WHERE player_id=? ORDER BY version DESC"
  ).bind(playerId).all());
  return c.json({ ok: true, cards: list });
});

/* ---- moderate: approve/reject/delete/restore/rollback (L9) ---- */
media.patch("/:id", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const id = parseInt(c.req.param("id"), 10);
  const b = await c.req.json().catch(() => ({}));
  const row = await c.env.DB.prepare("SELECT * FROM player_card_assets WHERE id=?").bind(id).first();
  if (!row) return c.json({ ok: false, error: "not_found", code: 404 }, 404);

  if (b.action === "delete") {
    await c.env.DB.prepare("UPDATE player_card_assets SET status='deleted', deleted_iso=? WHERE id=?").bind(nowISO(), id).run();
  } else if (b.action === "restore" || b.action === "rollback") {
    // make this version the active one; demote whatever is currently active
    const cur = await c.env.DB.prepare(
      "SELECT id FROM player_card_assets WHERE player_id=? AND media_type=? AND status='active'"
    ).bind(row.player_id, row.media_type).first();
    if (cur && cur.id !== id) await c.env.DB.prepare("UPDATE player_card_assets SET status='replaced', replaced_by=? WHERE id=?").bind(id, cur.id).run();
    await c.env.DB.prepare("UPDATE player_card_assets SET status='active', deleted_iso=NULL WHERE id=?").bind(id).run();
  } else {
    return c.json({ ok: false, error: "action", code: "action" }, 400);
  }
  await audit(c.env, g.user.id, "card_" + b.action, id, { playerId: row.player_id });
  return c.json({ ok: true });
});

export default media;
