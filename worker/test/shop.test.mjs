/* Virgil Points + shop + tickets flow. */
import app from "../src/index.js";
import { makeEnv, ok, done, post, get, patchReq } from "./harness.mjs";

const env = makeEnv();
const DB = env.DB;
const H = (t) => ({ Authorization: "Bearer " + t });

const tok = (await post(app, env, "/api/auth/register", { name: "Earner", pass: "secret123" })).json.token;
const uid = (await DB.prepare("SELECT id FROM users WHERE username='earner'").first()).id;

// posting in chat earns a point
await post(app, env, "/api/chat", { text: "up the virgil" }, H(tok));
let wallet = await get(app, env, "/api/me/points", H(tok));
ok(wallet.json.ok && wallet.json.balance === 1 && wallet.json.events[0].delta === 1, "chat message earns 1 point + ledger row");

// starting a thread earns 5
await post(app, env, "/api/forum/threads", { category: "banter", title: "Hello", body: "world" }, H(tok));
wallet = await get(app, env, "/api/me/points", H(tok));
ok(wallet.json.balance === 6, "thread earns 5 (total 6)");

// top the wallet up so we can shop (seed directly)
await DB.prepare("UPDATE user_points SET balance=300 WHERE user_id=?").bind(uid).run();

// shop lists items
const catalogue = await get(app, env, "/api/shop", H(tok));
ok(catalogue.json.items.length >= 5 && catalogue.json.items.find((i) => i.sku === "flair_crown"), "shop catalogue lists items");

// can't equip a cosmetic you don't own
ok((await patchReq(app, env, "/api/me/profile", { flair: "👑" }, H(tok))).status === 400, "cannot equip unowned flair");

// buy the crown flair, then equip it
const buy = await post(app, env, "/api/shop/buy", { sku: "flair_crown" }, H(tok));
ok(buy.json.ok && buy.json.balance === 150, "buy crown flair deducts cost (300 - 150)");
ok((await post(app, env, "/api/shop/buy", { sku: "flair_crown" }, H(tok))).status === 400, "cannot buy the same cosmetic twice");
const equip = await patchReq(app, env, "/api/me/profile", { flair: "👑" }, H(tok));
ok(equip.json.ok, "equip owned flair");

// buy an accent, equip it, and confirm the public profile shows both
await post(app, env, "/api/shop/buy", { sku: "accent_gold" }, H(tok));
await patchReq(app, env, "/api/me/profile", { accent: "gold" }, H(tok));
const prof = await get(app, env, "/api/profiles/earner");
ok(prof.json.profile.flair === "👑" && prof.json.profile.accent === "gold", "public profile carries equipped cosmetics");

// insufficient funds rejected
await DB.prepare("UPDATE user_points SET balance=5 WHERE user_id=?").bind(uid).run();
ok((await post(app, env, "/api/shop/buy", { sku: "flair_goat" }, H(tok))).status === 400, "insufficient balance rejected");

// tickets: claim one for a fixture
await DB.prepare("INSERT INTO fixtures (id,kind,stage,date_iso,opponent) VALUES ('fxt','match','league','2099-05-01','Rivals')").run();
await DB.prepare("UPDATE user_points SET balance=100 WHERE user_id=?").bind(uid).run();
const claim = await post(app, env, "/api/tickets/claim", { fixtureId: "fxt" }, H(tok));
ok(claim.json.ok && claim.json.balance === 75, "claim ticket deducts 25");
ok((await post(app, env, "/api/tickets/claim", { fixtureId: "fxt" }, H(tok))).status === 400, "cannot double-claim a ticket");
const tix = await get(app, env, "/api/tickets", H(tok));
ok(tix.json.tickets.length === 1 && tix.json.tickets[0].opponent === "Rivals", "my tickets lists the claimed ticket");

// ---- resilience: engagement tables not migrated in yet ----
// A fresh DB with the points tables dropped must NOT break core endpoints
// (chat, profile, members) that now touch cosmetics/points.
const env2 = makeEnv();
const DB2 = env2.DB;
for (const t of ["user_points", "point_events", "shop_items", "user_purchases"]) DB2.prepare("DROP TABLE IF EXISTS " + t).run();
const tok2 = (await post(app, env2, "/api/auth/register", { name: "Pre", pass: "secret123" })).json.token;
const H2 = (t) => ({ Authorization: "Bearer " + t });
ok((await post(app, env2, "/api/chat", { text: "hi" }, H2(tok2))).json.ok, "chat still posts with points tables absent");
ok((await patchReq(app, env2, "/api/me/profile", { bio: "hello" }, H2(tok2))).json.ok, "profile bio still saves with points tables absent");
ok((await get(app, env2, "/api/chat", H2(tok2))).json.ok, "chat still reads with points tables absent");
ok((await get(app, env2, "/api/profiles/pre")).json.ok, "public profile still loads with points tables absent");
const wallet2 = await get(app, env2, "/api/me/points", H2(tok2));
ok(wallet2.json.ok && wallet2.json.balance === 0 && wallet2.json.events.length === 0, "wallet degrades to zero when tables absent");

done();
