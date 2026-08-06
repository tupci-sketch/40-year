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

// ---- unknown player id fails cleanly (not a raw FK 500) ----
const badPlayer = await post(app, env, "/api/admin/matches", { opponent: "Ghost FC", ourScore: 1, theirScore: 0, players: [{ id: "no-such-player", goals: 1 }] }, H(modTok));
ok(badPlayer.status === 400 && badPlayer.json.code === "unknown_player" && badPlayer.json.players.includes("no-such-player"), "unknown player id in stats rejected cleanly");
const badMotm = await post(app, env, "/api/admin/matches", { opponent: "Ghost FC", ourScore: 1, theirScore: 0, players: [], motm: "no-such-player" }, H(modTok));
ok(badMotm.status === 400 && badMotm.json.code === "unknown_player", "unknown MOTM id rejected cleanly");

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

// ---- league status (manual: division/position/points; NOT derived from matches) ----
ok((await get(app, env, "/api/home")).json.leagueStatus === null, "no league status set yet → null");
ok((await post(app, env, "/api/admin/league-status", { divisionId: "elite", points: 1, target: 0, chances: 3, division: "Elite", position: "3 Chances Remaining" }, H(modTok))).json.ok, "league status set (L5, structured)");
const homeLs = (await get(app, env, "/api/home")).json;
ok(homeLs.leagueStatus.divisionId === "elite" && homeLs.leagueStatus.points === 1 && homeLs.leagueStatus.chances === 3, "home: structured league status round-trips");
ok(homeLs.leagueStatus.division === "Elite", "home: legacy league fields kept for fallback");
// campaign tracker (L5)
ok((await post(app, env, "/api/admin/campaign", { kind: "playoffs", divisionId: "elite", target: 8, progress: 2, wins: 1, draws: 0, losses: 1 }, H(modTok))).json.ok, "campaign saved (L5)");
const homeCamp = (await get(app, env, "/api/home")).json.campaign;
ok(homeCamp && homeCamp.kind === "playoffs" && homeCamp.target === 8 && homeCamp.progress === 2, "home: campaign round-trips");
ok((await post(app, env, "/api/admin/campaign", { kind: "" }, H(modTok))).json.ok && (await get(app, env, "/api/home")).json.campaign === null, "campaign cleared with empty kind");
// custom trophies / honours (L5)
ok((await post(app, env, "/api/admin/honours", { honours: [{ icon: "🏆", title: "Division 2 Champions", year: "FC26", sub: "Promoted unbeaten" }, { title: "" }] }, H(modTok))).json.honours.length === 1, "honours saved, blank titles dropped (L5)");
const hon = (await get(app, env, "/api/honours")).json;
ok(hon.honours.length === 1 && hon.honours[0].title === "Division 2 Champions" && hon.honours[0].icon === "🏆", "honours round-trip on public read");
// Club record editor: sync from EA (L5, so Dan can). No matches in this DB, so
// the record reconciles to exactly the baseline and adds up.
ok((await post(app, env, "/api/admin/club-record", { wins: 305, draws: 87, losses: 293, goalsFor: 1932, goalsAgainst: 1861, leagueApps: 638, playoffApps: 47 }, H(modTok))).json.ok, "club record synced (L5)");
const stCr = (await get(app, env, "/api/stats")).json;
ok(stCr.clubRecord && stCr.clubRecord.played === 685 && stCr.clubRecord.wins === 305, "stats: club record = baseline (685) and adds up");
ok(stCr.clubRecord.played === stCr.clubRecord.wins + stCr.clubRecord.draws + stCr.clubRecord.losses, "stats: club record adds up (played = W+D+L)");
// Tracked games stay live: a new logged league win + a friendly loss grow the
// record on top of the synced baseline (baseline + tracked model).
await DB.prepare("INSERT INTO matches (id,stage,opponent,our_score,their_score,result) VALUES (5001,'league','New Op',3,0,'W')").run();
await DB.prepare("INSERT INTO matches (id,stage,opponent,our_score,their_score,result) VALUES (5002,'friendly','Germany',1,2,'L')").run();
const stCr2 = (await get(app, env, "/api/stats")).json;
ok(stCr2.clubRecord.wins === 306 && stCr2.clubRecord.losses === 294 && stCr2.clubRecord.played === 687, "stats: tracked games (+ friendly) grow the record live to 687");
ok(stCr2.eaRecord && stCr2.eaRecord.wins === 305 && stCr2.eaRecord.losses === 293, "stats: entered EA figures round-trip for the editor");

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

// ---- one-off: retire Peter Nkuah, split his games to Pancake + Ye Yu ----
// (yeyu already seeded above; add Peter + Pancake)
await DB.prepare("INSERT INTO players (id,number,name,controlled_by,is_human,active) VALUES ('lewban',12,'Peter Nkuah','human',1,1),('pmqdr0yan',84,'Pancake','bot',0,1)").run();
for (const m of [261, 262, 263, 269, 276, 277, 278]) {
  await DB.prepare("INSERT INTO matches (id,stage,opponent,our_score,their_score,result) VALUES (?,'league','Opp',1,1,'D')").bind(m).run();
  await DB.prepare("INSERT INTO match_player_stats (match_id,player_id,saves,conceded) VALUES (?, 'lewban', 2, 1)").bind(m).run();
}
await DB.prepare("INSERT INTO match_player_stats (match_id,player_id,goals) VALUES (261,'yeyu',0)").run(); // Ye Yu already in 261
ok((await post(app, env, "/api/admin/reassign-peter", {}, H(modTok))).status === 403, "L5 cannot reassign Peter");
ok((await post(app, env, "/api/admin/reassign-peter", {}, H(adminTok))).json.done === true, "L9 retires Peter + reassigns");
const gone = await DB.prepare("SELECT id FROM players WHERE id='lewban'").first();
ok(!gone, "Peter removed");
const pan = (await DB.prepare("SELECT match_id FROM match_player_stats WHERE player_id='pmqdr0yan' ORDER BY match_id").all()).results.map((r) => r.match_id);
const yey = (await DB.prepare("SELECT match_id FROM match_player_stats WHERE player_id='yeyu' ORDER BY match_id").all()).results.map((r) => r.match_id);
ok(pan.join(",") === "261,263,276,278", "Pancake got 261,263,276,278");
ok(yey.join(",") === "261,262,269,277", "Ye Yu kept 261 + gained 262,269,277");
ok((await post(app, env, "/api/admin/reassign-peter", {}, H(adminTok))).json.alreadyDone === true, "reassign is idempotent");

done();
