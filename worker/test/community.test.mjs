/* Community write/read route tests: chat, forum, availability,
   predictions, reactions — incl. permission checks. */
import app from "../src/index.js";
import { makeEnv, ok, done, post, get } from "./harness.mjs";

const env = makeEnv();
const DB = env.DB;
const H = (t) => ({ Authorization: "Bearer " + t });

async function register(name) {
  const r = await post(app, env, "/api/auth/register", { name, pass: "secret123" });
  return r.json.token;
}

const tokA = await register("Alice");
const tokB = await register("Bobmod");
// promote Bob to L5 (mod)
await DB.prepare("UPDATE users SET level=5 WHERE username='bobmod'").run();

// ---- auth required ----
ok((await post(app, env, "/api/chat", { text: "hi" })).status === 401, "chat post needs auth");
ok((await get(app, env, "/api/chat")).status === 401, "chat read needs auth");

// ---- chat ----
const cp = await post(app, env, "/api/chat", { text: "Up the Virgils" }, H(tokA));
ok(cp.json.ok && cp.json.id, "chat post ok");
ok((await post(app, env, "/api/chat", { text: "" }, H(tokA))).status === 400, "empty chat rejected");
const cf = await get(app, env, "/api/chat", H(tokA));
ok(cf.json.messages.length === 1 && cf.json.messages[0].body === "Up the Virgils", "chat fetch");
ok((await app.request("/api/chat/" + cp.json.id, { method: "DELETE", headers: H(tokA) }, env)).status === 403, "L1 cannot delete chat");
ok((await app.request("/api/chat/" + cp.json.id, { method: "DELETE", headers: H(tokB) }, env)).status === 200, "L5 can delete chat");
ok((await get(app, env, "/api/chat", H(tokA))).json.messages.length === 0, "deleted chat hidden");

// ---- forum ----
const cats = await get(app, env, "/api/forum/categories");
ok(cats.json.categories.length >= 4, "forum categories seeded");
const th = await post(app, env, "/api/forum/threads", { category: "banter", title: "Fish", body: "smelly" }, H(tokA));
ok(th.json.ok && th.json.id, "create thread");
ok((await post(app, env, "/api/forum/threads", { category: "nope", title: "x", body: "y" }, H(tokA))).status === 400, "bad category rejected");
const rep = await post(app, env, "/api/forum/threads/" + th.json.id + "/posts", { text: "agreed" }, H(tokB));
ok(rep.json.ok, "reply to thread");
const tv = await get(app, env, "/api/forum/threads/" + th.json.id);
ok(tv.json.thread.title === "Fish" && tv.json.thread.replies === 1 && tv.json.posts.length === 1, "thread view + reply count");
const list = await get(app, env, "/api/forum/threads?category=banter");
ok(list.json.threads.length === 1 && list.json.threads[0].category === "banter", "thread list by category");
ok((await app.request("/api/forum/posts/" + rep.json.id, { method: "DELETE", headers: H(tokA) }, env)).status === 403, "L1 cannot delete post");
ok((await app.request("/api/forum/posts/" + rep.json.id, { method: "DELETE", headers: H(tokB) }, env)).status === 200, "L5 deletes post");

// ---- availability + predictions ----
await DB.prepare("INSERT INTO fixtures (id,kind,stage,date_iso,opponent) VALUES ('fxm','match','league','2099-01-01','Rivals')").run();
await DB.prepare("INSERT INTO fixtures (id,kind,stage,date_iso,opponent) VALUES ('fxs','session','friendly','2099-02-01','Club night')").run();
const av = await post(app, env, "/api/fixtures/fxm/availability", { status: "yes" }, H(tokA));
ok(av.json.ok && av.json.counts.find((x) => x.status === "yes").n === 1, "availability set + counted");
const av2 = await post(app, env, "/api/fixtures/fxm/availability", { status: "no" }, H(tokA));
ok(av2.json.counts.find((x) => x.status === "no").n === 1 && !av2.json.counts.find((x) => x.status === "yes"), "availability updates (no double)");
ok((await post(app, env, "/api/fixtures/nope/availability", { status: "yes" }, H(tokA))).status === 404, "availability unknown fixture 404");

const pr = await post(app, env, "/api/fixtures/fxm/predictions", { our: 3, their: 1 }, H(tokA));
ok(pr.json.ok, "prediction on match fixture");
ok((await post(app, env, "/api/fixtures/fxs/predictions", { our: 3, their: 1 }, H(tokA))).status === 400, "no predictions on session fixture");

// ---- reactions (toggle) ----
const r1 = await post(app, env, "/api/reactions", { target_type: "news", target_id: "1", emoji: "🔥" }, H(tokA));
ok(r1.json.reacted === true && r1.json.counts[0].n === 1, "reaction added");
const r2 = await post(app, env, "/api/reactions", { target_type: "news", target_id: "1", emoji: "🔥" }, H(tokA));
ok(r2.json.reacted === false && r2.json.counts.length === 0, "reaction toggled off");

done();
