/* Admin/mod write route tests: match save (stats/scorers/lineup/gaffers),
   settle predictions, delete, fixtures, news, banner, users, gaffers. */
import app from "../src/index.js";
import { makeEnv, ok, done, post, get } from "./harness.mjs";

const env = makeEnv();
const DB = env.DB;
const H = (t) => ({ Authorization: "Bearer " + t });
const del = (path, t) => app.request(path, { method: "DELETE", headers: H(t) }, env);
const patch = (path, t, body) => app.request(path, { method: "PATCH", headers: { ...H(t), "Content-Type": "application/json" }, body: JSON.stringify(body) }, env).then(async (r) => ({ status: r.status, json: await r.json() }));

async function register(name) { return (await post(app, env, "/api/auth/register", { name, pass: "secret123" })).json.token; }

const memberTok = await register("Member1");
const modTok = await register("Mod5");
const adminTok = await register("Admin9");
await DB.prepare("UPDATE users SET level=5 WHERE username='mod5'").run();
await DB.prepare("UPDATE users SET level=9 WHERE username='admin9'").run();

// players for stats/lineup
for (const [id, n, num] of [["tupci", "Tupci", 7], ["danwhizzy", "Danwhizzy", 17], ["amy", "Amy Whimsy", 8], ["yeyu", "Ye Yu", 1]]) {
  await DB.prepare("INSERT INTO players (id,number,name,controlled_by,is_human,active) VALUES (?,?,?,?,?,1)").bind(id, num, n, id === "yeyu" ? "bot" : "human", id === "yeyu" ? 0 : 1).run();
}

// ---- permission gating ----
ok((await post(app, env, "/api/admin/matches", { opponent: "X" }, H(memberTok))).status === 403, "L1 cannot save match");
ok((await post(app, env, "/api/admin/matches", { opponent: "X" })).status === 401, "no auth cannot save match");

// ---- match save (new) with stats, scorers derived, lineup, gaffer ----
const save = await post(app, env, "/api/admin/matches", {
  opponent: "Rivals FC", ourScore: 3, theirScore: 1, stage: "league", dateISO: "2026-02-01",
  players: [
    { id: "danwhizzy", goals: 2, assists: 0, rating: 8.6 },
    { id: "tupci", goals: 1, assists: 2, rating: 9.0 },
    { id: "yeyu", saves: 5, conceded: 1, rating: 7.2 }
  ],
  lineup: { formation: "4-2-1-3", captain: "tupci", xi: [{ id: "yeyu", pos: "GK" }, { id: "tupci", pos: "CAM" }, { id: "danwhizzy", pos: "ST" }], subs: ["amy"] },
  gaffers: [{ name: "Don Tactico", primary: true }]
}, H(modTok));
ok(save.json.ok && save.json.id === 1 && !save.json.updated, "match saved (new, id=1)");

const md = await get(app, env, "/api/matches/1");
ok(md.json.match.result === "W" && md.json.match.formation === "4-2-1-3" && md.json.match.captain_player_id === "tupci", "match: result auto + formation + captain");
ok(md.json.stats.length === 3, "match: 3 stat lines");
const gk = md.json.stats.find((s) => s.player_id === "yeyu");
ok(gk.saves === 5 && gk.conceded === 1, "match: GK saves/conceded saved");
ok(md.json.scorers.length === 2 && md.json.scorers.reduce((a, s) => a + s.goals, 0) === 3, "match: scorers derived from goals");
ok(md.json.lineup && md.json.lineup.players.length === 4 && md.json.gaffers[0].name_snapshot === "Don Tactico", "match: lineup + gaffer snapshot");

// gaffer auto-created and listed
ok((await get(app, env, "/api/gaffers")).json.gaffers.some((x) => x.name === "Don Tactico"), "gaffer auto-created + public list");

// ---- match update (same id) ----
const upd = await post(app, env, "/api/admin/matches", { id: 1, opponent: "Rivals FC", ourScore: 0, theirScore: 0, players: [] }, H(modTok));
ok(upd.json.ok && upd.json.updated, "match update by id");
ok((await get(app, env, "/api/matches/1")).json.match.result === "D" && (await get(app, env, "/api/matches/1")).json.stats.length === 0, "update replaced stats + recomputed result");

// ---- settle predictions ----
await DB.prepare("INSERT INTO fixtures (id,kind,stage,date_iso,opponent) VALUES ('fxp','match','league','2099-01-01','Predict FC')").run();
await post(app, env, "/api/fixtures/fxp/predictions", { our: 2, their: 1 }, H(memberTok)); // will be exact
const settle = await post(app, env, "/api/admin/matches", { opponent: "Predict FC", ourScore: 2, theirScore: 1, players: [], settleFixtureId: "fxp" }, H(modTok));
ok(settle.json.ok, "settle match saved");
const ps = await DB.prepare("SELECT points, exact, played FROM prediction_scores LIMIT 1").first();
ok(ps && ps.points === 3 && ps.exact === 1 && ps.played === 1, "exact prediction scored 3");
ok((await DB.prepare("SELECT settled FROM fixtures WHERE id='fxp'").first()).settled === 1, "fixture marked settled");

// ---- match delete (L9 only) ----
ok((await del("/api/admin/matches/1", modTok)).status === 403, "L5 cannot delete match");
ok((await del("/api/admin/matches/1", adminTok)).status === 200, "L9 deletes match");
ok((await get(app, env, "/api/matches/1")).status === 404, "deleted match gone");

// ---- fixtures ----
const fx = await post(app, env, "/api/admin/fixtures", { kind: "match", opponent: "New Op", dateISO: "2099-05-01", stage: "league" }, H(modTok));
ok(fx.json.ok && fx.json.id, "fixture created");
ok((await del("/api/admin/fixtures/" + fx.json.id, modTok)).status === 200, "fixture deleted");

// ---- news ----
const nw = await post(app, env, "/api/admin/news", { title: "Hello", body: "World", tag: "CLUB", pinned: true }, H(modTok));
ok(nw.json.ok, "news created");
ok((await get(app, env, "/api/news")).json.news[0].title === "Hello", "news visible");
ok((await patch("/api/admin/news/" + nw.json.id, modTok, { title: "Updated" })).json.ok, "news patched");
ok((await del("/api/admin/news/" + nw.json.id, modTok)).status === 200, "news deleted");

// ---- banner ----
ok((await post(app, env, "/api/admin/banner", { text: "We're live", active: true }, H(modTok))).json.ok, "banner set");
ok((await get(app, env, "/api/home")).json.banner.text === "We're live", "banner shows on home");

// ---- users (L9) ----
ok((await get(app, env, "/api/admin/users", H(modTok))).json.users.length === 3, "L5 can view users");
const memberId = (await DB.prepare("SELECT id FROM users WHERE username='member1'").first()).id;
ok((await post(app, env, "/api/admin/users/" + memberId + "/level", { level: 7 }, H(modTok))).status === 403, "L5 cannot set level");
ok((await post(app, env, "/api/admin/users/" + memberId + "/level", { level: 7 }, H(adminTok))).json.ok, "L9 sets level");
ok((await DB.prepare("SELECT level FROM users WHERE id=?").bind(memberId).first()).level === 7, "level updated to 7");
ok((await post(app, env, "/api/admin/users/" + memberId + "/ban", { banned: true }, H(adminTok))).json.ok, "L9 bans user");

// ---- gaffer rename (L9) ----
const gid = (await get(app, env, "/api/gaffers")).json.gaffers.find((x) => x.name === "Don Tactico").id;
ok((await patch("/api/admin/gaffers/" + gid, modTok, { name: "New Name" })).status === 403, "L5 cannot rename gaffer");
ok((await patch("/api/admin/gaffers/" + gid, adminTok, { name: "The Hairdryer" })).json.ok, "L9 renames gaffer");

done();
