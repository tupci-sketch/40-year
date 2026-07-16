/* Player-card upload tests: permissions, real-type sniffing (never trust
   client MIME), size limits, versioning + rollback, public serving. */
import app from "../src/index.js";
import { makeEnv, ok, done, post, get, put, patchReq } from "./harness.mjs";

const env = makeEnv();
const DB = env.DB;
const H = (t) => ({ Authorization: "Bearer " + t });

async function register(name) { return (await post(app, env, "/api/auth/register", { name, pass: "secret123" })).json.token; }
const memberTok = await register("Member1");
const l7Tok = await register("Uploader7");
const adminTok = await register("Admin9");
await DB.prepare("UPDATE users SET level=7 WHERE username='uploader7'").run();
await DB.prepare("UPDATE users SET level=9 WHERE username='admin9'").run();

await DB.prepare("INSERT INTO players (id,number,name,controlled_by,is_human,active) VALUES ('amy',8,'Amy Whimsy','human',1,1)").run();

// a real minimal 1x1 PNG (valid magic bytes + IHDR width/height)
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
// a real minimal 1x1 JPEG
const JPEG_1x1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  "base64"
);

// ---- permission gating ----
ok((await put(app, env, "/api/media/player-cards/upload?playerId=amy&label=main", PNG_1x1, H(memberTok))).status === 403, "L1 cannot upload");
ok((await put(app, env, "/api/media/player-cards/upload?playerId=amy&label=main", PNG_1x1)).status === 401, "no auth cannot upload");

// ---- unknown player ----
ok((await put(app, env, "/api/media/player-cards/upload?playerId=ghost&label=main", PNG_1x1, H(l7Tok))).status === 404, "unknown player rejected");

// ---- real upload (PNG) ----
const up1 = await put(app, env, "/api/media/player-cards/upload?playerId=amy&label=main", PNG_1x1, H(l7Tok));
ok(up1.json.ok && up1.json.version === 1 && up1.json.objectKey.endsWith(".png"), "PNG upload ok, versioned, real extension");
ok(up1.json.width === 1 && up1.json.height === 1, "PNG dimensions sniffed from IHDR");

// squad shows the new card
const squad1 = await get(app, env, "/api/squad");
ok(squad1.json.squad.find((p) => p.id === "amy").card === up1.json.publicUrl, "squad reflects the active card");

// ---- serve the file back ----
const file1 = await app.request(up1.json.publicUrl, { method: "GET" }, env);
ok(file1.status === 200 && file1.headers.get("Content-Type") === "image/png", "uploaded image served back with correct content-type");
ok(file1.headers.get("Cache-Control").includes("immutable"), "immutable cache header on versioned asset");

// ---- client lies about MIME; server sniffs real bytes (fake .exe as image/png) ----
const fakeBytes = Buffer.from("MZ" + "not really a png".repeat(4));
const badType = await put(app, env, "/api/media/player-cards/upload?playerId=amy&label=fake", fakeBytes, H(l7Tok));
ok(badType.status === 400 && badType.json.code === "bad_type", "non-image bytes rejected regardless of query/claims");

// ---- size limit ----
const big = Buffer.concat([PNG_1x1, Buffer.alloc(3 * 1024 * 1024)]);
ok((await put(app, env, "/api/media/player-cards/upload?playerId=amy&label=big", big, H(l7Tok))).status === 413, "oversized upload rejected");

// ---- empty body ----
ok((await put(app, env, "/api/media/player-cards/upload?playerId=amy&label=empty", Buffer.alloc(0), H(l7Tok))).status === 400, "empty upload rejected");

// ---- second real upload (JPEG) replaces the active card, versions up ----
const up2 = await put(app, env, "/api/media/player-cards/upload?playerId=amy&label=away", JPEG_1x1, H(l7Tok));
ok(up2.json.ok && up2.json.version === 2 && up2.json.objectKey.endsWith(".jpg"), "second upload versions to 2, jpeg extension");
const meta1 = await get(app, env, "/api/media/player-cards/" + up1.json.id);
ok(meta1.json.card.status === "replaced" && meta1.json.card.replaced_by === up2.json.id, "previous version marked replaced, linked to new");
const squad2 = await get(app, env, "/api/squad");
ok(squad2.json.squad.find((p) => p.id === "amy").card === up2.json.publicUrl, "squad now shows the newest active card");

// ---- history (L7+) ----
const hist = await get(app, env, "/api/media/player-cards/player/amy/history", H(l7Tok));
ok(hist.json.cards.length === 2, "history lists both versions");
ok((await get(app, env, "/api/media/player-cards/player/amy/history", H(memberTok))).status === 403, "L1 cannot view history");

// ---- rollback (L9 only) ----
ok((await patchReq(app, env, "/api/media/player-cards/" + up1.json.id, { action: "rollback" }, H(l7Tok))).status === 403, "L7 cannot rollback");
const rb = await patchReq(app, env, "/api/media/player-cards/" + up1.json.id, { action: "rollback" }, H(adminTok));
ok(rb.json.ok, "L9 rolls back to version 1");
const squad3 = await get(app, env, "/api/squad");
ok(squad3.json.squad.find((p) => p.id === "amy").card === up1.json.publicUrl, "squad reflects rollback to v1");
const meta2 = await get(app, env, "/api/media/player-cards/" + up2.json.id);
ok(meta2.json.card.status === "replaced", "v2 demoted to replaced after rollback");

// ---- delete (L9) ----
const del = await patchReq(app, env, "/api/media/player-cards/" + up2.json.id, { action: "delete" }, H(adminTok));
ok(del.json.ok, "L9 deletes a card version");
ok((await get(app, env, "/api/media/player-cards/" + up2.json.id)).json.card.status === "deleted", "deleted status recorded");

done();
