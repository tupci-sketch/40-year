/* Public read-API tests against seeded sample data (empty-until-migration
   in production, but the shapes must be right now). */
import app from "../src/index.js";
import { makeEnv, ok, done, get } from "./harness.mjs";

const env = makeEnv();
const DB = env.DB;

async function run(sql, ...args) { await DB.prepare(sql).bind(...args).run(); }

// seasons
await run("INSERT INTO seasons (id,label,game,started_iso,archived,sort) VALUES ('fc26','Season 3 · FC26','EA FC 26','2025-09-01',0,20)");

// players
await run("INSERT INTO players (id,number,name,slug,controlled_by,is_human,positions_json,active) VALUES ('tupci',7,'Tupci','tupci','human',1,'[\"CAM\"]',1)");
await run("INSERT INTO players (id,number,name,slug,controlled_by,is_human,positions_json,active) VALUES ('danwhizzy',17,'Danwhizzy','danwhizzy','human',1,'[\"ST\"]',1)");
await run("INSERT INTO players (id,number,name,slug,controlled_by,is_human,linked_to,positions_json,active) VALUES ('amy',8,'Amy Whimsy','amy-whimsy','human',1,'donovan','[\"ST\",\"CAM\"]',1)");
await run("INSERT INTO players (id,number,name,slug,controlled_by,is_human,positions_json,active) VALUES ('yeyu',1,'Ye Yu II','ye-yu','bot',0,'[\"GK\"]',1)");

// tupci verified baseline (as-of seq 0 → all recorded matches count on top)
await run("INSERT INTO player_career_baselines (player_id,as_of_seq,apps,goals,assists,avg_rating,source) VALUES ('tupci',0,392,351,435,7.4,'EA career')");

// a card for tupci
await run("INSERT INTO player_card_assets (player_id,object_key,public_url,version,status) VALUES ('tupci','tupci-v1.webp','https://cards/tupci-v1.webp',1,'active')");

// matches (ids 1..3), all fc26
await run("INSERT INTO matches (id,season_id,stage,date_iso,opponent,our_score,their_score,result) VALUES (1,'fc26','league','2026-01-01','Alpha FC',1,0,'W')");
await run("INSERT INTO matches (id,season_id,stage,date_iso,opponent,our_score,their_score,result) VALUES (2,'fc26','league','2026-01-08','Beta AFC',2,2,'D')");
await run("INSERT INTO matches (id,season_id,stage,date_iso,opponent,our_score,their_score,result) VALUES (3,'fc26','playoff','2026-01-15','Gamma United',3,1,'W')");

// stats + scorers for match 3
await run("INSERT INTO match_player_stats (match_id,player_id,goals,assists,rating) VALUES (3,'tupci',1,2,9.0)");
await run("INSERT INTO match_player_stats (match_id,player_id,goals,assists,rating) VALUES (3,'danwhizzy',2,0,8.6)");
await run("INSERT INTO match_player_stats (match_id,player_id,goals,assists,rating,saves,conceded) VALUES (3,'yeyu',0,0,7.2,5,1)");
await run("INSERT INTO match_scorers (match_id,player_id,goals,ord) VALUES (3,'danwhizzy',2,0)");
await run("INSERT INTO match_scorers (match_id,player_id,goals,ord) VALUES (3,'tupci',1,1)");
// also give tupci a goal in match 1 & 2 so leaderboard/baseline math has data
await run("INSERT INTO match_player_stats (match_id,player_id,goals,assists,rating) VALUES (1,'tupci',1,0,8.0)");
await run("INSERT INTO match_player_stats (match_id,player_id,goals,assists,rating) VALUES (2,'tupci',0,1,7.0)");

// gaffers
await run("INSERT INTO gaffers (id,name,active,created_iso) VALUES (1,'Don Tactico',1,'2026-01-01')");
await run("INSERT INTO match_gaffers (match_id,gaffer_id,is_primary,name_snapshot) VALUES (3,1,1,'Don Tactico')");

// fixture (future) + news
await run("INSERT INTO fixtures (id,kind,season_id,stage,date_iso,opponent) VALUES ('fx1','match','fc26','league','2099-01-01','Delta City')");
await run("INSERT INTO news_posts (id,tag,date_iso,title,body,pinned,status) VALUES (1,'CLUB','2026-01-16','We go again','Body',1,'published')");

// ---------- assertions ----------
const seasons = await get(app, env, "/api/seasons");
ok(seasons.json.ok && seasons.json.currentSeason === "fc26" && seasons.json.seasons.length === 1, "seasons + currentSeason");

const squad = await get(app, env, "/api/squad");
ok(squad.json.squad.length === 4, "squad returns 4 players");
const tupciCard = squad.json.squad.find((p) => p.id === "tupci");
ok(tupciCard && tupciCard.card === "https://cards/tupci-v1.webp" && tupciCard.positions[0] === "CAM", "squad: card url + positions parsed");
const amy = squad.json.squad.find((p) => p.id === "amy");
ok(amy && amy.isHuman === true && amy.linkedTo === "donovan", "squad: Amy human + lore link to donovan (not merged)");

const player = await get(app, env, "/api/players/tupci");
ok(player.json.baseline && player.json.baseline.goals === 351, "player: verified baseline present");
ok(player.json.recorded.goals === 2 && player.json.recorded.apps === 3, "player: recorded contributions computed (baseline seq 0)");

const matches = await get(app, env, "/api/matches?limit=2");
ok(matches.json.matches.length === 2 && matches.json.matches[0].id === 3, "matches: newest first + limit");
ok(matches.json.nextCursor === 2, "matches: cursor points to next page");
const page2 = await get(app, env, "/api/matches?limit=2&cursor=" + matches.json.nextCursor);
ok(page2.json.matches[0].id === 1 && page2.json.matches.length === 1 && page2.json.nextCursor === null, "matches: cursor pagination continues (no overlap, ends)");
const filtered = await get(app, env, "/api/matches?result=W");
ok(filtered.json.matches.length === 2, "matches: result filter (2 wins)");

const md = await get(app, env, "/api/matches/3");
ok(md.json.match.opponent === "Gamma United" && md.json.stats.length === 3, "match detail: stats");
ok(md.json.scorers.length === 2 && md.json.gaffers[0].name_snapshot === "Don Tactico", "match detail: scorers + gaffer snapshot");
ok((await get(app, env, "/api/matches/999")).status === 404, "match detail: missing → 404");

const rec = await get(app, env, "/api/club-record");
ok(rec.json.derived.played === 3 && rec.json.derived.wins === 2 && rec.json.derived.draws === 1, "club-record derived from archive");

const lb = await get(app, env, "/api/leaderboards?metric=goals");
ok(lb.json.leaderboard[0].player_id === "danwhizzy" && lb.json.leaderboard[0].goals === 2, "leaderboard: top scorer");

const home = await get(app, env, "/api/home");
ok(home.json.latestResult.id === 3 && home.json.form.join("") === "WDW", "home: latest result + form");
ok(home.json.nextFixture && home.json.nextFixture.opponent === "Delta City", "home: next fixture");
ok(home.json.news.length === 1, "home: news");
ok(home.json.recordAll && home.json.recordAll.played === 395 && home.json.recordAll.wins === 2, "home: all-time played = top apps (392, as-of seq 0) + 3 matches logged since = 395");

// socials: defaults, then editable via admin settings
const soc0 = await get(app, env, "/api/socials");
ok(soc0.json.socials.tiktok === "danwhizzy" && soc0.json.socials.twitch === "40yrvirgil" && soc0.json.socials.youtube === "", "socials: sensible defaults");
await run("INSERT INTO site_settings (key,value) VALUES ('socials', ?)", JSON.stringify({ tiktok: "virgiltv", twitch: "thevirgil", youtube: "@40yrvirgil" }));
const soc1 = await get(app, env, "/api/socials");
ok(soc1.json.socials.tiktok === "virgiltv" && soc1.json.socials.youtube === "@40yrvirgil", "socials: reads stored handles");

ok((await get(app, env, "/api/fixtures")).json.fixtures.length === 1, "fixtures upcoming");
ok((await get(app, env, "/api/news")).json.news[0].title === "We go again", "news published");

// stats centre: club all-time + recorded slice + streaks + boards
const stats = await get(app, env, "/api/stats");
ok(stats.json.ok && stats.json.recorded.count === 3, "stats: recorded count");
ok(stats.json.recorded.wins === 2 && stats.json.recorded.draws === 1 && stats.json.recorded.losses === 0, "stats: recorded W/D/L");
ok(stats.json.recorded.goalsFor === 6 && stats.json.recorded.goalsAgainst === 3, "stats: recorded GF/GA");
ok(stats.json.recorded.winStreak === 1 && stats.json.recorded.unbeaten === 3, "stats: streaks (win run 1, unbeaten 3)");
const careerGoals = stats.json.boards.careerGoals;
ok(careerGoals[0].player_id === "tupci" && careerGoals[0].val === 353, "stats: career goals = baseline 351 + 2 recorded-after");
ok(stats.json.players.tupci.careerAssists === 438 && stats.json.players.tupci.careerGames === 395, "stats: tupci career assists/games folded");
ok(stats.json.opposition.length === 3 && stats.json.opposition.every((o) => o.p === 1), "stats: opposition head-to-head (3 opponents)");
ok(stats.json.boards.goldenBoot.length >= 2 && stats.json.boards.goldenBoot[0].val === 2, "stats: golden boot (recorded)");

done();
