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
  // Latest active uploaded card (R2) so dossiers show it, same as the squad grid.
  const cardRow = await c.env.DB.prepare(
    "SELECT public_url FROM player_card_assets WHERE player_id=? AND status='active' ORDER BY version DESC LIMIT 1"
  ).bind(id).first();
  const base = await c.env.DB.prepare("SELECT * FROM player_career_baselines WHERE player_id=?").bind(id).first();
  // "Recorded" = every game this club has a stat line for (the same set the
  // match-by-match log lists). The verified baseline is the complete career
  // total on its own, so recorded totals must NOT be sliced by the baseline
  // seq — otherwise a baseline captured "as of the latest match" leaves the
  // recorded tab reading 0 while the log clearly shows dozens of games.
  const rec = await c.env.DB.prepare(
    `SELECT COUNT(*) apps, COALESCE(SUM(goals),0) goals, COALESCE(SUM(assists),0) assists,
            AVG(rating) avg_rating, COALESCE(SUM(tackles),0) tackles, COALESCE(SUM(passes_made),0) passes,
            COALESCE(SUM(saves),0) saves, COALESCE(SUM(conceded),0) conceded
     FROM match_player_stats mps JOIN matches m ON m.id=mps.match_id
     WHERE mps.player_id=?`
  ).bind(id).first();
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
      positions: parsePositions(p.positions_json), flavour: p.flavour, card: cardRow ? cardRow.public_url : null },
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
    `SELECT m.id,m.season_id,m.stage,m.date_iso,m.opponent,m.our_score,m.their_score,m.result,m.comp_name,m.venue,m.note,m.motm_player_id
     FROM matches m ${where} ORDER BY m.id DESC LIMIT ?`
  ).bind(...args, limit + 1).all());
  const hasMore = list.length > limit;
  const page = list.slice(0, limit);

  // Attach scorers + per-player stat lines for the page in two batched
  // queries, so the archive can render the old rich rows (scorers inline +
  // an expandable per-match stats panel) without an N+1 fan-out.
  if (page.length) {
    const ids = page.map((m) => m.id);
    const ph = ids.map(() => "?").join(",");
    const sc = rows(await c.env.DB.prepare(
      `SELECT match_id, player_id, goals, ord FROM match_scorers WHERE match_id IN (${ph}) ORDER BY ord ASC`
    ).bind(...ids).all());
    const st = rows(await c.env.DB.prepare(
      `SELECT match_id, player_id, goals, assists, rating, shots, tackles, passes_made, pass_attempts, red_cards, saves, conceded
       FROM match_player_stats WHERE match_id IN (${ph})`
    ).bind(...ids).all());
    const scByMatch = {}, stByMatch = {};
    for (const r of sc) (scByMatch[r.match_id] = scByMatch[r.match_id] || []).push({ id: r.player_id, goals: r.goals });
    for (const r of st) (stByMatch[r.match_id] = stByMatch[r.match_id] || []).push(r);
    for (const m of page) { m.scorers = scByMatch[m.id] || []; m.players = stByMatch[m.id] || []; }
  }
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

/* ---- fixtures (upcoming) + their RSVP lists so Matchday can show who's in ---- */
pub.get("/fixtures", async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const list = rows(await c.env.DB.prepare(
    "SELECT id,kind,season_id,stage,date_iso,opponent,comp_name,note,settled FROM fixtures WHERE date_iso IS NULL OR date_iso >= ? ORDER BY date_iso ASC"
  ).bind(today).all());
  if (list.length) {
    const ids = list.map((f) => f.id);
    const ph = ids.map(() => "?").join(",");
    const av = rows(await c.env.DB.prepare(
      `SELECT a.fixture_id, a.status, u.id AS user_id, u.display
       FROM availability a JOIN users u ON u.id=a.user_id
       WHERE a.fixture_id IN (${ph})`
    ).bind(...ids).all());
    const byFx = {};
    for (const r of av) (byFx[r.fixture_id] = byFx[r.fixture_id] || []).push({ user_id: r.user_id, display: r.display, status: r.status });
    for (const f of list) f.availability = byFx[f.id] || [];
  }
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

/* ---- stats centre: club record + recorded slice + streaks + all boards ----
   Everything the old Stats page needed, computed server-side in a handful of
   grouped queries so the client just renders. "Career/all-time" boards fold
   each player's verified baseline into their recorded contributions after the
   baseline seq (same honest model as the player page); "recorded" boards use
   only the games with a full stat line on file. */
pub.get("/stats", async (c) => {
  // Club record: verified baseline (k/v) with the archive-derived totals as fallback.
  const baseRows = rows(await c.env.DB.prepare("SELECT key,value FROM club_record_baselines").all());
  const baseline = {}; for (const r of baseRows) baseline[r.key] = r.value;
  const derived = await c.env.DB.prepare(
    `SELECT COUNT(*) played, COALESCE(SUM(result='W'),0) wins, COALESCE(SUM(result='D'),0) draws, COALESCE(SUM(result='L'),0) losses,
            COALESCE(SUM(our_score),0) goalsFor, COALESCE(SUM(their_score),0) goalsAgainst FROM matches`
  ).first();

  // Chronological result stream for streaks + opposition head-to-head.
  const matches = rows(await c.env.DB.prepare(
    "SELECT id, opponent, our_score, their_score, result FROM matches ORDER BY id ASC"
  ).all());
  let win = 0, winBest = 0, unb = 0, unbBest = 0, logW = 0, logD = 0, logL = 0, logGF = 0, logGA = 0;
  let bestWin = null, worstLoss = null, cleanSheets = 0, goalFests = 0;
  const byOpp = {};
  for (const m of matches) {
    const our = Number(m.our_score) || 0, their = Number(m.their_score) || 0;
    if (m.result === "W") { win++; unb++; logW++; } else if (m.result === "D") { win = 0; unb++; logD++; } else { win = 0; unb = 0; logL++; }
    if (win > winBest) winBest = win;
    if (unb > unbBest) unbBest = unb;
    logGF += our; logGA += their;
    if (m.result === "W" && (!bestWin || (our - their) > bestWin.margin || ((our - their) === bestWin.margin && our > bestWin.our)))
      bestWin = { margin: our - their, our, their, opp: m.opponent };
    if (m.result === "L" && (!worstLoss || (their - our) > worstLoss.margin || ((their - our) === worstLoss.margin && their > worstLoss.their)))
      worstLoss = { margin: their - our, our, their, opp: m.opponent };
    if (their === 0) cleanSheets++;
    if (our + their >= 9) goalFests++;
    const k = (m.opponent || "Unknown").trim();
    const o = byOpp[k] || (byOpp[k] = { name: k, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
    o.p++;
    if (m.result === "W") o.w++; else if (m.result === "D") o.d++; else if (m.result === "L") o.l++;
    o.gf += our; o.ga += their;
  }
  const opposition = Object.keys(byOpp).map((k) => byOpp[k]).sort((a, b) => b.p - a.p || a.name.localeCompare(b.name));

  // Per-player recorded aggregates (joined to matches for win% + a stat line = an appearance).
  const rec = rows(await c.env.DB.prepare(
    `SELECT mps.player_id,
            COUNT(*) apps,
            COALESCE(SUM(mps.goals),0) goals,
            COALESCE(SUM(mps.assists),0) assists,
            AVG(mps.rating) avg_rating,
            SUM(CASE WHEN mps.rating IS NOT NULL THEN 1 ELSE 0 END) rated,
            COALESCE(SUM(mps.red_cards),0) reds,
            COALESCE(SUM(mps.tackles),0) tackles,
            COALESCE(SUM(mps.passes_made),0) passes_made,
            COALESCE(SUM(mps.pass_attempts),0) pass_attempts,
            COALESCE(SUM(CASE WHEN m.result='W' THEN 1 ELSE 0 END),0) wins
     FROM match_player_stats mps JOIN matches m ON m.id=mps.match_id
     GROUP BY mps.player_id`
  ).all());
  // Recorded contributions AFTER each player's baseline seq (for all-time = baseline + these).
  const after = rows(await c.env.DB.prepare(
    `SELECT mps.player_id, COUNT(*) apps, COALESCE(SUM(mps.goals),0) goals, COALESCE(SUM(mps.assists),0) assists
     FROM match_player_stats mps JOIN player_career_baselines b ON b.player_id=mps.player_id
     WHERE mps.match_id > b.as_of_seq GROUP BY mps.player_id`
  ).all());
  const hats = rows(await c.env.DB.prepare(
    "SELECT player_id, COUNT(*) n FROM match_player_stats WHERE goals >= 3 GROUP BY player_id"
  ).all());
  const motm = rows(await c.env.DB.prepare(
    "SELECT motm_player_id id, COUNT(*) n FROM matches WHERE motm_player_id IS NOT NULL AND motm_player_id <> '' GROUP BY motm_player_id"
  ).all());
  const bases = rows(await c.env.DB.prepare(
    "SELECT player_id, apps, goals, assists, avg_rating, as_of_seq, win_pct FROM player_career_baselines"
  ).all());

  const recBy = {}; for (const r of rec) recBy[r.player_id] = r;
  const afterBy = {}; for (const r of after) afterBy[r.player_id] = r;
  const baseBy = {}; for (const b of bases) baseBy[b.player_id] = b;

  // Build the union of every player id we know a total for.
  const ids = {}; for (const r of rec) ids[r.player_id] = 1; for (const b of bases) ids[b.player_id] = 1;

  // Career all-time per player = baseline + recorded-after-baseline; if no baseline, all recorded.
  const career = {};
  for (const id of Object.keys(ids)) {
    const b = baseBy[id], a = afterBy[id], r = recBy[id];
    if (b) {
      career[id] = {
        games: (Number(b.apps) || 0) + (a ? Number(a.apps) : 0),
        goals: (Number(b.goals) || 0) + (a ? Number(a.goals) : 0),
        assists: (Number(b.assists) || 0) + (a ? Number(a.assists) : 0),
        avg_rating: b.avg_rating != null ? Number(b.avg_rating) : (r && r.avg_rating != null ? Number(r.avg_rating) : null),
        win_pct: b.win_pct != null ? Number(b.win_pct) : null,
        hasBaseline: true
      };
    } else if (r) {
      career[id] = {
        games: Number(r.apps) || 0, goals: Number(r.goals) || 0, assists: Number(r.assists) || 0,
        avg_rating: r.avg_rating != null ? Number(r.avg_rating) : null,
        win_pct: r.apps ? Math.round((r.wins / r.apps) * 100) : null, hasBaseline: false
      };
    }
  }

  const sortDesc = (arr) => arr.sort((a, b) => b.val - a.val);
  const boards = {
    goldenBoot: sortDesc(rec.filter((r) => r.goals > 0).map((r) => ({ player_id: r.player_id, val: Number(r.goals) }))),
    assists: sortDesc(rec.filter((r) => r.assists > 0).map((r) => ({ player_id: r.player_id, val: Number(r.assists) }))),
    rating: rec.filter((r) => r.rated > 0).map((r) => ({ player_id: r.player_id, val: Number(r.avg_rating), n: Number(r.rated) })).sort((a, b) => b.val - a.val),
    motm: sortDesc(motm.map((r) => ({ player_id: r.id, val: Number(r.n) }))),
    hatTricks: sortDesc(hats.map((r) => ({ player_id: r.player_id, val: Number(r.n) }))),
    reds: sortDesc(rec.filter((r) => r.reds > 0).map((r) => ({ player_id: r.player_id, val: Number(r.reds) }))),
    careerGoals: sortDesc(Object.keys(career).filter((id) => career[id].goals > 0).map((id) => ({ player_id: id, val: career[id].goals }))),
    careerAssists: sortDesc(Object.keys(career).filter((id) => career[id].assists > 0).map((id) => ({ player_id: id, val: career[id].assists })))
  };
  // Biggest contributors: career goals+assists per game, reasonable sample.
  boards.contributors = Object.keys(career).map((id) => {
    const c2 = career[id], g = c2.goals, a = c2.assists, n = c2.games || 1;
    return { player_id: id, g, a, games: c2.games, per: (g + a) / n };
  }).filter((r) => r.games >= 20).sort((a, b) => b.per - a.per);

  // Per-player table payload (recorded pass% + career headline) keyed by id.
  const players = {};
  for (const id of Object.keys(ids)) {
    const r = recBy[id], cr = career[id] || {};
    players[id] = {
      recApps: r ? Number(r.apps) : 0, recGoals: r ? Number(r.goals) : 0, recAssists: r ? Number(r.assists) : 0,
      recAvg: r && r.avg_rating != null ? Number(r.avg_rating) : null,
      recTackles: r ? Number(r.tackles) : 0,
      passPct: r && r.pass_attempts ? Math.round((r.passes_made / r.pass_attempts) * 100) : null,
      recWinPct: r && r.apps ? Math.round((r.wins / r.apps) * 100) : null,
      careerGames: cr.games || 0, careerGoals: cr.goals || 0, careerAssists: cr.assists || 0,
      careerAvg: cr.avg_rating != null ? cr.avg_rating : null, careerWinPct: cr.win_pct != null ? cr.win_pct : null,
      hasBaseline: !!cr.hasBaseline
    };
  }

  return c.json({
    ok: true,
    clubRecord: {
      // Games played = most-capped player's verified apps + matches logged since
      // that total (auto-grows per new match); stored record is only the W/D/L.
      played: Math.max(Number(baseline.played) || derived.played, (() => {
        const top = bases.slice().sort((a, b) => (Number(b.apps) || 0) - (Number(a.apps) || 0))[0];
        if (!top) return 0;
        const since = matches.filter((m) => Number(m.id) > (Number(top.as_of_seq) || 0)).length;
        return (Number(top.apps) || 0) + since;
      })()),
      wins: Number(baseline.wins) || derived.wins,
      draws: Number(baseline.draws) || derived.draws, losses: Number(baseline.losses) || derived.losses,
      goalsFor: Number(baseline.goalsFor) || derived.goalsFor, goalsAgainst: Number(baseline.goalsAgainst) || derived.goalsAgainst,
      badge: baseline.badge || ""
    },
    recorded: { count: matches.length, wins: logW, draws: logD, losses: logL, goalsFor: logGF, goalsAgainst: logGA, winStreak: winBest, unbeaten: unbBest },
    extremes: { bestWin, worstLoss, cleanSheets, goalFests, hatTricks: hats.reduce((a, h) => a + Number(h.n), 0) },
    boards, players, opposition
  });
});

/* ---- socials (editable handles for the Social page) ---- */
pub.get("/socials", async (c) => {
  const row = await c.env.DB.prepare("SELECT value FROM site_settings WHERE key='socials'").first();
  let socials = {}; try { socials = row ? JSON.parse(row.value || "{}") : {}; } catch (e) {}
  return c.json({
    ok: true,
    socials: {
      tiktok: socials.tiktok || "danwhizzy",
      twitch: socials.twitch || "40yrvirgil",
      youtube: socials.youtube || ""
    }
  });
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

  // Complete all-time record: the owner-verified baseline (the full 500+ era)
  // with the archive-derived totals as a fallback. Lets the home card show the
  // whole story by default, with the current-season slice a toggle away.
  const baseRows = rows(await c.env.DB.prepare("SELECT key,value FROM club_record_baselines").all());
  const bl = {}; for (const r of baseRows) bl[r.key] = r.value;
  const derivedAll = await c.env.DB.prepare(
    `SELECT COUNT(*) played, COALESCE(SUM(result='W'),0) wins, COALESCE(SUM(result='D'),0) draws, COALESCE(SUM(result='L'),0) losses,
            COALESCE(SUM(our_score),0) goalsFor, COALESCE(SUM(their_score),0) goalsAgainst FROM matches`
  ).first();
  // Total games the club has EVER played = the most-capped ever-present
  // player's verified apps (Tüpci, ever-present) PLUS any matches logged since
  // that verified total — so the figure ticks up automatically the moment a new
  // match is recorded, without re-verifying player totals. The stored club
  // record (392) is only the competitive W/D/L record, not games-played.
  const topBase = await c.env.DB.prepare("SELECT apps, as_of_seq FROM player_career_baselines ORDER BY apps DESC LIMIT 1").first();
  const maxApps = topBase ? Number(topBase.apps) : 0;
  const sinceRow = await c.env.DB.prepare("SELECT COUNT(*) n FROM matches WHERE id > ?").bind(topBase ? Number(topBase.as_of_seq) : 0).first();
  const totalGames = maxApps + (sinceRow ? Number(sinceRow.n) : 0);
  const recordAll = {
    played: Math.max(Number(bl.played) || derivedAll.played, totalGames),
    wins: Number(bl.wins) || derivedAll.wins,
    draws: Number(bl.draws) || derivedAll.draws, losses: Number(bl.losses) || derivedAll.losses,
    goalsFor: Number(bl.goalsFor) || derivedAll.goalsFor, goalsAgainst: Number(bl.goalsAgainst) || derivedAll.goalsAgainst
  };

  const leagueRow = await c.env.DB.prepare("SELECT value FROM site_settings WHERE key='league_status'").first();
  let leagueStatus = null; try { leagueStatus = leagueRow ? JSON.parse(leagueRow.value || "null") : null; } catch (e) {}

  const news = rows(await c.env.DB.prepare(
    "SELECT id,tag,date_iso,title FROM news_posts WHERE status='published' ORDER BY pinned DESC, date_iso DESC LIMIT 3"
  ).all());
  const bannerRow = await c.env.DB.prepare("SELECT value FROM site_settings WHERE key='banner'").first();
  let banner = null; try { banner = bannerRow ? JSON.parse(bannerRow.value || "null") : null; } catch (e) {}
  return c.json({ ok: true, latestResult: latest, nextFixture, form, record, recordAll, leagueStatus, news, banner });
});

export default pub;
