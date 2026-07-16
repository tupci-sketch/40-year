/* Admin route tests: squad/player CRUD, baselines, seasons, season
   correction tools. */
import app from "../src/index.js";
import { makeEnv, ok, done, post, get } from "./harness.mjs";

const env = makeEnv();
const DB = env.DB;
const H = (t) => ({ Authorization: "Bearer " + t });
const patch = (path, t, body) => app.request(path, { method: "PATCH", headers: { ...H(t), "Content-Type": "application/json" }, body: JSON.stringify(body) }, env).then(async (r) => ({ status: r.status, json: await r.json() }));

async function register(name) { return (await post(app, env, "/api/auth/register", { name, pass: "secret123" })).json.token; }
const modTok = await register("Mod5");
const adminTok = await register("Admin9");
await DB.prepare("UPDATE users SET level=5 WHERE username='mod5'").run();
await DB.prepare("UPDATE users SET level=9 WHERE username='admin9'").run();

// ---- player create/update (L5) ----
const p1 = await post(app, env, "/api/admin/players", {
  id: "amy", name: "Amy Whimsy", number: 8, controlledBy: "human", positions: ["st", "cam", "bogus"], linkedTo: "donovan"
}, H(modTok));
ok(p1.json.ok && p1.json.id === "amy", "player created");
const squadCheck = await get(app, env, "/api/squad");
const amy = squadCheck.json.squad.find((x) => x.id === "amy");
ok(amy && amy.isHuman === true && amy.positions.join(",") === "ST,CAM" && amy.linkedTo === "donovan", "positions cleaned + human + lore link (not merged)");

// update same player (upsert)
await post(app, env, "/api/admin/players", { id: "amy", name: "Amy Whimsy", number: 8, controlledBy: "human", positions: ["st"] }, H(modTok));
const after = (await get(app, env, "/api/squad")).json.squad.find((x) => x.id === "amy");
ok(after.positions.length === 1, "player update replaces positions");

// permission check
ok((await post(app, env, "/api/admin/players", { id: "x", name: "X" })).status === 401, "player create needs auth");

// deactivate (L9 only)
ok((await app.request("/api/admin/players/amy", { method: "DELETE", headers: H(modTok) }, env)).status === 403, "L5 cannot deactivate player");
ok((await app.request("/api/admin/players/amy", { method: "DELETE", headers: H(adminTok) }, env)).status === 200, "L9 deactivates player");
ok((await get(app, env, "/api/squad")).json.squad.length === 0, "deactivated player hidden from squad");

// ---- career baseline (L9) ----
await post(app, env, "/api/admin/players", { id: "tupci", name: "Tupci", number: 7, controlledBy: "human", positions: ["cam"] }, H(modTok));
const bl = await post(app, env, "/api/admin/players/tupci/baseline", { asOfSeq: 37, apps: 392, goals: 351, assists: 435, avgRating: 7.4, source: "EA career" }, H(adminTok));
ok(bl.json.ok, "baseline set (L9)");
ok((await post(app, env, "/api/admin/players/tupci/baseline", { apps: 1 }, H(modTok))).status === 403, "L5 cannot set baseline");
const pd = await get(app, env, "/api/players/tupci");
ok(pd.json.baseline.goals === 351 && pd.json.baseline.as_of_seq === 37, "player detail reflects new baseline");

// season baseline — must reference a real season
ok((await post(app, env, "/api/admin/players/tupci/season-baseline", { seasonId: "no-such-season", apps: 10 }, H(adminTok))).json.code === "season_not_found", "season baseline rejects unknown season");
await post(app, env, "/api/admin/seasons", { id: "fc26", label: "Season 3 · FC26", makeCurrent: true }, H(adminTok));
const sb = await post(app, env, "/api/admin/players/tupci/season-baseline", { seasonId: "fc26", apps: 10, goals: 5 }, H(adminTok));
ok(sb.json.ok, "season baseline set");

// club record baseline
const cr = await post(app, env, "/api/admin/club-record", { values: { played: 392, wins: 171, draws: 41, losses: 180 } }, H(adminTok));
ok(cr.json.ok, "club record baseline set");
const recCheck = await get(app, env, "/api/club-record");
ok(recCheck.json.baseline.played === "392" && recCheck.json.baseline.wins === "171", "club-record baseline visible");

// ---- seasons ----
const s1 = await post(app, env, "/api/admin/seasons", { id: "fc26s2", label: "Season 2 · FC26", makeCurrent: false }, H(adminTok));
ok(s1.json.ok, "season created (previous)");
const s2 = await post(app, env, "/api/admin/seasons", { id: "fc26s3", label: "Season 3 · FC26", makeCurrent: true }, H(adminTok));
ok(s2.json.ok, "season created (current)");
ok((await get(app, env, "/api/seasons")).json.currentSeason === "fc26s3", "current season updated");
ok((await post(app, env, "/api/admin/seasons", { id: "fc26s3", label: "dup" }, H(adminTok))).status === 409, "duplicate season id rejected");
ok((await patch("/api/admin/seasons/fc26s2", adminTok, { archived: true })).json.ok, "season archived");
ok((await get(app, env, "/api/seasons")).json.seasons.find((s) => s.id === "fc26s2").archived === 1, "archived flag visible");

// ---- new matches auto-default to the current season (no seasonId sent) ----
await post(app, env, "/api/admin/matches", { opponent: "Old Foe", ourScore: 1, theirScore: 0, players: [] }, H(modTok)); // id=1
await post(app, env, "/api/admin/matches", { opponent: "New Foe", ourScore: 2, theirScore: 0, players: [] }, H(modTok)); // id=2
ok((await get(app, env, "/api/matches/1")).json.match.season_id === "fc26s3", "new match with no seasonId auto-defaults to the current season");
ok((await get(app, env, "/api/matches/2")).json.match.season_id === "fc26s3", "second new match also auto-defaults to current season");

// ---- editing a match WITHOUT resending seasonId preserves it (doesn't null it out) ----
await post(app, env, "/api/admin/matches/1/season", { seasonId: "fc26s2" }, H(adminTok)); // move match 1 to fc26s2 via the dedicated endpoint
await post(app, env, "/api/admin/matches", { id: 1, opponent: "Old Foe (edited)", ourScore: 1, theirScore: 1, players: [] }, H(modTok)); // edit stats only, no seasonId sent
ok((await get(app, env, "/api/matches/1")).json.match.season_id === "fc26s2", "editing a match without seasonId does NOT wipe its existing season");
ok((await get(app, env, "/api/matches/1")).json.match.opponent === "Old Foe (edited)", "the edit itself still applied");

// ---- editing a match WITH an explicit seasonId still moves it via the general save route ----
await post(app, env, "/api/admin/matches", { id: 1, opponent: "Old Foe (edited)", ourScore: 1, theirScore: 1, seasonId: "fc26s3", players: [] }, H(modTok));
ok((await get(app, env, "/api/matches/1")).json.match.season_id === "fc26s3", "explicit seasonId on save still moves the match");

// ---- match season correction ----
ok((await post(app, env, "/api/admin/matches/1/season", { seasonId: "fc26s2" }, H(modTok))).status === 403, "L5 cannot reseason a match");
ok((await post(app, env, "/api/admin/matches/1/season", { seasonId: "fc26s2" }, H(adminTok))).json.ok, "L9 moves match to a season");
ok((await get(app, env, "/api/matches/1")).json.match.season_id === "fc26s2", "match season_id updated");

// bulk range assignment (final import tool)
const rangeRes = await post(app, env, "/api/admin/seasons/fc26s3/assign-range", { fromSeq: 2, toSeq: 999 }, H(adminTok));
ok(rangeRes.json.ok && rangeRes.json.changed === 1, "bulk range assignment reports changed count");
ok((await get(app, env, "/api/matches/2")).json.match.season_id === "fc26s3", "match 2 now in current season via bulk assign");

done();
