/* ============================================================
   Public read API. Focused, indexed queries; cursor pagination
   for growing lists. Mounted at /api.
   ============================================================ */
import { Hono } from "hono";

const pub = new Hono();

function clampLimit(v, def = 20, max = 50) {
  v = parseInt(v, 10);
  if (!isFinite(v) || v <= 0) return def;
  return Math.min(v, max);
}
function rows(r) { return (r && r.results) || []; }
function parsePositions(p) { try { return p ? JSON.parse(p) : []; } catch (e) { return []; } }

/* ---- seasons ---- */
pub.get("/seasons", async (c) => {
  const list = rows(await c.env.DB.prepare(
    "SELECT id,label,game,started_iso,ended_iso,archived,sort FROM seasons ORDER BY sort DESC, id DESC"
  ).all());
  const cur = await c.env.DB.prepare("SELECT value FROM site_settings WHERE key='current_season'").first();
  return c.json({ ok: true, seasons: list, currentSeason: cur ? cur.value : "" });
});

/* ---- squad (with latest R2 card per player) ---- */
pub.get("/squad", async (c) => {
  const players = rows(await c.env.DB.prepare(
    `SELECT id,number,name,slug,controlled_by,is_human,perma_bench,retired_ai,linked_to,positions_json,flavour
     FROM players WHERE active=1 ORDER BY number ASC`
  ).all());
  const cards = rows(await c.env.DB.prepare(
    "SELECT player_id, public_url FROM player_card_assets WHERE status='active' ORDER BY player_id, version DESC"
  ).all());
  const cardBy = {};
  for (const cd of cards) if (!(cd.player_id in cardBy)) cardBy[cd.player_id] = cd.public_url;
  const squad = players.map((p) => ({
    id: p.id, number: p.number, name: p.name, slug: p.slug,
    controlledBy: p.controlled_by, isHuman: !!p.is_human, permaBench: !!p.perma_bench,
    retiredAI: !!p.retired_ai, linkedTo: p.linked_to || null,
    positions: parsePositions(p.positions_json), flavour: p.flavour, card: cardBy[p.id] || null
  }));
  return c.json({ ok: true, squad });
});

/* ---- player detail: identity + verified baseline + recorded contributions ---- */
pub.get("/players/:id", async (c) => {
  const id = c.req.param("id");
  const p = await c.env.DB.prepare("SELECT * FROM players WHERE id=?").bind(id).first();
  if (!p) return c.json({ ok: false, error: "not_found", code: 404 }, 404);
  const base = await c.env.DB.prepare("SELECT * FROM player_career_baselines WHERE player_id=?").bind(id).first();
  const asOf = base ? Number(base.as_of_seq) : 0;
  const rec = await c.env.DB.prepare(
    `SELECT COUNT(*) apps, COALESCE(SUM(goals),0) goals, COALESCE(SUM(assists),0) assists,
            AVG(rating) avg_rating, COALESCE(SUM(tackles),0) tackles, COALESCE(SUM(passes_made),0) passes,
            COALESCE(SUM(saves),0) saves, COALESCE(SUM(conceded),0) conceded
     FROM match_player_stats mps JOIN matches m ON m.id=mps.match_id
     WHERE mps.player_id=? AND m.id > ?`
  ).bind(id, asOf).first();
  // Per-game log: every recorded appearance with that game's own stat line,
  // so a player's individual match-by-match record is visible, newest first.
  const games = rows(await c.env.DB.prepare(
    `SELECT m.id, m.season_id, m.opponent, m.our_score, m.their_score, m.result, m.date_iso, m.stage,
            mps.goals, mps.assists, mps.rating, mps.shots, mps.tackles, mps.passes_made, mps.pass_attempts,
            mps.red_cards, mps.saves, mps.conceded
     FROM match_player_stats mps JOIN matches m ON m.id=mps.match_id
     WHERE mps.player_id=? ORDER BY m.id DESC`
  ).bind(id).all());
  return c.json({
    ok: true,
    player: { id: p.id, number: p.number, name: p.name, slug: p.slug, controlledBy: p.controlled_by,
      isHuman: !!p.is_human, retiredAI: !!p.retired_ai, linkedTo: p.linked_to || null,
      positions: parsePositions(p.positions_json), flavour: p.flavour },
    baseline: base || null,
    recorded: rec,
    games: games
  });
});

/* ---- matches list (filters + cursor, newest first) ---- */
pub.get("/matches", async (c) => {
  const q = c.req.query();
  const limit = clampLimit(q.limit);
  const conds = [], args = [];
  if (q.season) { conds.push("m.season_id = ?"); args.push(q.season); }
  if (q.stage) { conds.push("m.stage = ?"); args.push(q.stage); }
  if (q.result) { conds.push("m.result = ?"); args.push(String(q.result).toUpperCase()); }
  if (q.opponent) { conds.push("m.opponent = ?"); args.push(q.opponent); }
  if (q.gaffer) { conds.push("EXISTS (SELECT 1 FROM match_gaffers mg WHERE mg.match_id=m.id AND mg.gaffer_id=?)"); args.push(parseInt(q.gaffer, 10) || 0); }
  if (q.cursor) { conds.push("m.id < ?"); args.push(parseInt(q.cursor, 10) || 0); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const list = rows(await c.env.DB.prepare(
    `SELECT m.id,m.season_id,m.stage,m.date_iso,m.opponent,m.our_score,m.their_score,m.result,m.comp_name,m.venue
     FROM matches m ${where} ORDER BY m.id DESC LIMIT ?`
  ).bind(...args, limit + 1).all());
  const hasMore = list.length > limit;
  const page = list.slice(0, limit);
  return c.json({ ok: true, matches: page, nextCursor: hasMore ? page[page.length - 1].id : null });
});

/* ---- match detail: stats, scorers, lineup, gaffers ---- */
pub.get("/matches/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const m = await c.env.DB.prepare("SELECT * FROM matches WHERE id=?").bind(id).first();
  if (!m) return c.json({ ok: false, error: "not_found", code: 404 }, 404);
  const stats = rows(await c.env.DB.prepare("SELECT * FROM match_player_stats WHERE match_id=?").bind(id).all());
  const scorers = rows(await c.env.DB.prepare("SELECT player_id,goals,ord FROM match_scorers WHERE match_id=? ORDER BY ord").bind(id).all());
  const lu = await c.env.DB.prepare("SELECT * FROM match_lineups WHERE match_id=?").bind(id).first();
  const luPlayers = rows(await c.env.DB.prepare("SELECT player_id,pos,slot_index,is_sub FROM match_lineup_players WHERE match_id=? ORDER BY slot_index").bind(id).all());
  const gaffers = rows(await c.env.DB.prepare("SELECT gaffer_id,is_primary,name_snapshot FROM match_gaffers WHERE match_id=? ORDER BY is_primary DESC").bind(id).all());
  return c.json({ ok: true, match: m, stats, scorers, lineup: lu ? { ...lu, players: luPlayers } : null, gaffers });
});

/* ---- club record: verified baseline + derived-from-archive ---- */
pub.get("/club-record", async (c) => {
  const baseRows = rows(await c.env.DB.prepare("SELECT key,value FROM club_record_baselines").all());
  const baseline = {}; for (const r of baseRows) baseline[r.key] = r.value;
  const derived = await c.env.DB.prepare(
    `SELECT COUNT(*) played, COALESCE(SUM(result='W'),0) wins, COALESCE(SUM(result='D'),0) draws, COALESCE(SUM(result='L'),0) losses,
            COALESCE(SUM(our_score),0) goalsFor, COALESCE(SUM(their_score),0) goalsAgainst FROM matches`
  ).first();
  return c.json({ ok: true, baseline, derived });
});

/* ---- fixtures (upcoming) ---- */
pub.get("/fixtures", async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const list = rows(await c.env.DB.prepare(
    "SELECT id,kind,season_id,stage,date_iso,opponent,comp_name,note,settled FROM fixtures WHERE date_iso IS NULL OR date_iso >= ? ORDER BY date_iso ASC"
  ).bind(today).all());
  return c.json({ ok: true, fixtures: list });
});

/* ---- news (published) ---- */
pub.get("/news", async (c) => {
  const list = rows(await c.env.DB.prepare(
    "SELECT id,tag,date_iso,title,body,pinned FROM news_posts WHERE status='published' ORDER BY pinned DESC, date_iso DESC LIMIT 50"
  ).all());
  return c.json({ ok: true, news: list });
});

/* ---- leaderboards (recorded contributions; optional season) ---- */
pub.get("/leaderboards", async (c) => {
  const metric = String(c.req.query("metric") || "goals");
  const orderCol = { goals: "goals", assists: "assists", apps: "apps", rating: "avg_rating" }[metric] || "goals";
  const season = c.req.query("season");
  const args = [];
  let seasonWhere = "";
  if (season) { seasonWhere = "AND m.season_id = ?"; args.push(season); }
  const list = rows(await c.env.DB.prepare(
    `SELECT mps.player_id, COUNT(*) apps, COALESCE(SUM(mps.goals),0) goals, COALESCE(SUM(mps.assists),0) assists,
            AVG(mps.rating) avg_rating
     FROM match_player_stats mps JOIN matches m ON m.id=mps.match_id
     WHERE 1=1 ${seasonWhere}
     GROUP BY mps.player_id ORDER BY ${orderCol} DESC LIMIT 25`
  ).bind(...args).all());
  return c.json({ ok: true, metric, leaderboard: list });
});

/* ---- gaffers (active) ---- */
pub.get("/gaffers", async (c) => {
  const list = rows(await c.env.DB.prepare("SELECT id,name,active FROM gaffers WHERE active=1 ORDER BY name ASC").all());
  return c.json({ ok: true, gaffers: list });
});

/* ---- home summary ---- */
pub.get("/home", async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const latest = await c.env.DB.prepare(
    "SELECT id,opponent,our_score,their_score,result,date_iso FROM matches ORDER BY id DESC LIMIT 1"
  ).first();
  const nextFixture = await c.env.DB.prepare(
    "SELECT id,kind,stage,date_iso,opponent,comp_name FROM fixtures WHERE date_iso IS NULL OR date_iso >= ? ORDER BY date_iso ASC LIMIT 1"
  ).bind(today).first();

  const curRow = await c.env.DB.prepare("SELECT value FROM site_settings WHERE key='current_season'").first();
  const curSeason = curRow ? curRow.value : null;
  const seasonWhere = curSeason ? "WHERE season_id=?" : "";
  const seasonArgs = curSeason ? [curSeason] : [];

  // "Played" and "Form" auto-track the running season's own recorded results —
  // Division/Position/Points don't follow from win/loss counts alone (promotion,
  // playoff seeding, points deductions etc.), so those stay a separate manual
  // setting below rather than being derived here.
  const form = rows(await c.env.DB.prepare(
    `SELECT result FROM matches ${seasonWhere} ORDER BY id DESC LIMIT 6`
  ).bind(...seasonArgs).all()).map((r) => r.result);
  const record = await c.env.DB.prepare(
    `SELECT COUNT(*) played, COALESCE(SUM(result='W'),0) wins, COALESCE(SUM(result='D'),0) draws, COALESCE(SUM(result='L'),0) losses FROM matches ${seasonWhere}`
  ).bind(...seasonArgs).first();

  const leagueRow = await c.env.DB.prepare("SELECT value FROM site_settings WHERE key='league_status'").first();
  let leagueStatus = null; try { leagueStatus = leagueRow ? JSON.parse(leagueRow.value || "null") : null; } catch (e) {}

  const news = rows(await c.env.DB.prepare(
    "SELECT id,tag,date_iso,title FROM news_posts WHERE status='published' ORDER BY pinned DESC, date_iso DESC LIMIT 3"
  ).all());
  const bannerRow = await c.env.DB.prepare("SELECT value FROM site_settings WHERE key='banner'").first();
  let banner = null; try { banner = bannerRow ? JSON.parse(bannerRow.value || "null") : null; } catch (e) {}
  return c.json({ ok: true, latestResult: latest, nextFixture, form, record, leagueStatus, news, banner });
});

export default pub;
