/* ============================================================
   Mod/admin write routes. Mounted at /api/admin (+ a couple of
   public gaffer reads at /api). Every route re-checks the level.
     L5+ : matches, fixtures, news, banner, gaffers (add/assign)
     L9  : match delete, users, gaffer rename/retire, settings
   ============================================================ */
import { Hono } from "hono";
import { requireLevel, nowISO } from "../lib/auth.js";

const admin = new Hono();
function rows(r) { return (r && r.results) || []; }
function clean(s, max) { return String(s == null ? "" : s).trim().slice(0, max); }
function intOr(v, d) { const n = parseInt(v, 10); return isFinite(n) ? n : d; }
function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, intOr(v, 0))); }
function pid(x) { return String(x == null ? "" : x).toLowerCase().replace(/[^a-z0-9_\-]/g, "").slice(0, 24); }
async function audit(env, actorId, action, targetType, targetId, detail) {
  await env.DB.prepare(
    "INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, created_iso) VALUES (?,?,?,?,?,?)"
  ).bind(actorId, action, targetType || null, String(targetId ?? ""), detail ? JSON.stringify(detail) : null, nowISO()).run();
}

/* Score a fixture's predictions against a real result, bank points, clear it. */
async function settlePredictions(env, fixtureId, our, their) {
  const preds = rows(await env.DB.prepare("SELECT user_id, our, their FROM predictions WHERE fixture_id=?").bind(fixtureId).all());
  const actual = our > their ? "W" : our < their ? "L" : "D";
  for (const p of preds) {
    let pts = 0;
    if (Number(p.our) === our && Number(p.their) === their) pts = 3;
    else { const pr = p.our > p.their ? "W" : p.our < p.their ? "L" : "D"; if (pr === actual) pts = 1; }
    await env.DB.prepare(
      `INSERT INTO prediction_scores (user_id,points,exact,correct,played) VALUES (?,?,?,?,1)
       ON CONFLICT(user_id) DO UPDATE SET points=points+?, exact=exact+?, correct=correct+?, played=played+1`
    ).bind(p.user_id, pts, pts === 3 ? 1 : 0, pts === 1 ? 1 : 0, pts, pts === 3 ? 1 : 0, pts === 1 ? 1 : 0).run();
  }
  await env.DB.prepare("DELETE FROM predictions WHERE fixture_id=?").bind(fixtureId).run();
  await env.DB.prepare("DELETE FROM availability WHERE fixture_id=?").bind(fixtureId).run();
  await env.DB.prepare("UPDATE fixtures SET settled=1 WHERE id=?").bind(fixtureId).run();
}

/* ---------------- MATCHES ---------------- */
admin.post("/matches", async (c) => {
  const g = await requireLevel(c, 5); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const b = await c.req.json().catch(() => ({}));
  const opponent = clean(b.opponent, 60);
  if (!opponent) return c.json({ ok: false, error: "opponent", code: "opponent" }, 400);

  const our = clampInt(b.ourScore, 0, 99), their = clampInt(b.theirScore, 0, 99);
  let result = String(b.result || "").toUpperCase();
  if (!["W", "D", "L"].includes(result)) result = our > their ? "W" : our < their ? "L" : "D";
  let stage = String(b.stage || "league").toLowerCase();
  if (!["league", "playoff", "cup", "friendly", "international", "other"].includes(stage)) stage = "league";

  // id = seq; use provided (update) or next available (new)
  let id = intOr(b.id, 0);
  const isNew = !id;
  if (isNew) {
    const mx = await c.env.DB.prepare("SELECT COALESCE(MAX(id),0) mx FROM matches").first();
    id = Number(mx.mx) + 1;
  } else {
    const ex = await c.env.DB.prepare("SELECT id FROM matches WHERE id=?").bind(id).first();
    if (!ex) return c.json({ ok: false, error: "missing", code: "missing" }, 404);
  }

  let seasonId = b.seasonId ? clean(b.seasonId, 24) : null;
  if (seasonId) {
    const seasonExists = await c.env.DB.prepare("SELECT id FROM seasons WHERE id=?").bind(seasonId).first();
    if (!seasonExists) return c.json({ ok: false, error: "season_not_found", code: "season_not_found" }, 400);
  } else if (isNew) {
    // A brand-new match with no explicit season defaults to whatever's
    // current, so ongoing logging auto-tracks the running season without
    // the mod having to remember to set it every time. Only applies if
    // that season actually exists yet — e.g. a fresh site can have
    // current_season seeded before any season row is created.
    const cur = await c.env.DB.prepare("SELECT value FROM site_settings WHERE key='current_season'").first();
    if (cur && cur.value) {
      const curSeasonExists = await c.env.DB.prepare("SELECT id FROM seasons WHERE id=?").bind(cur.value).first();
      if (curSeasonExists) seasonId = cur.value;
    }
  }
  // On an EDIT with no season_id sent, COALESCE below preserves whatever
  // the match already had — editing stats never silently un-seasons it.
  const motm = b.motm ? pid(b.motm) : null;
  const captain = (b.lineup && b.lineup.captain) ? pid(b.lineup.captain) : (b.captain ? pid(b.captain) : null);
  const formation = clean((b.lineup && b.lineup.formation) || b.formation || "", 20).replace(/[^0-9\-]/g, "") || null;
  const venue = String(b.venue || "").toUpperCase().replace(/[^HAN]/g, "").slice(0, 1) || null;

  // Validate every referenced player id exists up front, so a typo in the
  // admin form fails cleanly (400) instead of a raw FK error mid-write.
  const refIds = new Set();
  if (motm) refIds.add(motm);
  if (captain) refIds.add(captain);
  for (const p of (Array.isArray(b.players) ? b.players : [])) { const i = pid(p && p.id); if (i) refIds.add(i); }
  for (const s of (Array.isArray(b.scorers) ? b.scorers : [])) { const i = pid(s && s.id); if (i) refIds.add(i); }
  if (b.lineup) {
    for (const x of (b.lineup.xi || [])) { const i = pid(x && x.id); if (i) refIds.add(i); }
    for (const s of (b.lineup.subs || [])) { const i = pid(s); if (i) refIds.add(i); }
  }
  if (refIds.size) {
    const found = rows(await c.env.DB.prepare(
      `SELECT id FROM players WHERE id IN (${[...refIds].map(() => "?").join(",")})`
    ).bind(...refIds).all());
    const foundSet = new Set(found.map((r) => r.id));
    const missing = [...refIds].filter((i) => !foundSet.has(i));
    if (missing.length) return c.json({ ok: false, error: "unknown_player", code: "unknown_player", players: missing }, 400);
  }

  const rec = {
    id, season_id: seasonId, stage, date_iso: clean(b.dateISO, 10), opponent,
    our_score: our, their_score: their, result, note: clean(b.note, 200),
    comp_name: clean(b.compName, 50), venue, motm_player_id: motm,
    captain_player_id: captain, formation, updated_iso: nowISO()
  };
  await c.env.DB.prepare(
    `INSERT INTO matches (id,season_id,stage,date_iso,opponent,our_score,their_score,result,note,comp_name,venue,motm_player_id,captain_player_id,formation,updated_by,updated_iso)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET season_id=COALESCE(excluded.season_id, matches.season_id), stage=excluded.stage, date_iso=excluded.date_iso,
       opponent=excluded.opponent, our_score=excluded.our_score, their_score=excluded.their_score, result=excluded.result,
       note=excluded.note, comp_name=excluded.comp_name, venue=excluded.venue, motm_player_id=excluded.motm_player_id,
       captain_player_id=excluded.captain_player_id, formation=excluded.formation, updated_by=excluded.updated_by, updated_iso=excluded.updated_iso`
  ).bind(id, rec.season_id, rec.stage, rec.date_iso, rec.opponent, rec.our_score, rec.their_score, rec.result,
    rec.note, rec.comp_name, rec.venue, rec.motm_player_id, rec.captain_player_id, rec.formation, g.user.display, rec.updated_iso).run();

  // --- player stats (replace) ---
  await c.env.DB.prepare("DELETE FROM match_player_stats WHERE match_id=?").bind(id).run();
  const seen = {};
  const players = (Array.isArray(b.players) ? b.players : []).filter((p) => {
    const i = pid(p && p.id); if (!i || seen[i]) return false; seen[i] = 1; p.id = i; return true;
  });
  for (const p of players) {
    await c.env.DB.prepare(
      `INSERT INTO match_player_stats (match_id,player_id,goals,assists,rating,shots,tackles,passes_made,pass_attempts,red_cards,saves,conceded)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(id, p.id, clampInt(p.goals, 0, 20), clampInt(p.assists, 0, 20),
      (p.rating === "" || p.rating == null) ? null : Math.max(0, Math.min(10, Number(p.rating))),
      clampInt(p.shots, 0, 99), clampInt(p.tackles, 0, 99), clampInt(p.passesMade, 0, 999),
      clampInt(p.passAttempts, 0, 999), clampInt(p.redCards, 0, 5), clampInt(p.saves, 0, 99), clampInt(p.conceded, 0, 99)).run();
  }

  // --- scorers (provided, else derived from goals) ---
  await c.env.DB.prepare("DELETE FROM match_scorers WHERE match_id=?").bind(id).run();
  let scorers = Array.isArray(b.scorers) && b.scorers.length
    ? b.scorers.map((s) => ({ id: pid(s.id), goals: Math.max(1, intOr(s.goals, 1)) })).filter((s) => s.id)
    : players.filter((p) => clampInt(p.goals, 0, 20) > 0).map((p) => ({ id: p.id, goals: clampInt(p.goals, 0, 20) }));
  let ord = 0;
  for (const s of scorers) {
    await c.env.DB.prepare("INSERT OR REPLACE INTO match_scorers (match_id,player_id,goals,ord) VALUES (?,?,?,?)").bind(id, s.id, s.goals, ord++).run();
  }

  // --- lineup (replace) ---
  await c.env.DB.prepare("DELETE FROM match_lineup_players WHERE match_id=?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM match_lineups WHERE match_id=?").bind(id).run();
  if (b.lineup && Array.isArray(b.lineup.xi) && b.lineup.xi.length) {
    await c.env.DB.prepare("INSERT INTO match_lineups (match_id,formation,captain_player_id) VALUES (?,?,?)").bind(id, formation, captain).run();
    let slot = 0;
    for (const x of b.lineup.xi.slice(0, 11)) {
      const xid = pid(x && x.id); if (!xid) continue;
      await c.env.DB.prepare("INSERT OR REPLACE INTO match_lineup_players (match_id,player_id,pos,slot_index,is_sub) VALUES (?,?,?,?,0)")
        .bind(id, xid, clean(x.pos, 4).toUpperCase(), slot++).run();
    }
    for (const s of (b.lineup.subs || []).slice(0, 12)) {
      const sid = pid(s); if (!sid) continue;
      await c.env.DB.prepare("INSERT OR REPLACE INTO match_lineup_players (match_id,player_id,pos,slot_index,is_sub) VALUES (?,?,?,?,1)").bind(id, sid, null, slot++).run();
    }
  }

  // --- gaffers (replace; resolve names→ids, snapshot display) ---
  await c.env.DB.prepare("DELETE FROM match_gaffers WHERE match_id=?").bind(id).run();
  for (const gf of (Array.isArray(b.gaffers) ? b.gaffers : [])) {
    let gid = intOr(gf.id, 0), name = clean(gf.name, 60);
    if (!gid && name) {
      const found = await c.env.DB.prepare("SELECT id,name FROM gaffers WHERE name=?").bind(name).first();
      if (found) { gid = found.id; name = found.name; }
      else { const r = await c.env.DB.prepare("INSERT INTO gaffers (name,active,created_iso) VALUES (?,?,?)").bind(name, 1, nowISO()).run(); gid = r.meta.last_row_id; }
    } else if (gid) {
      const found = await c.env.DB.prepare("SELECT name FROM gaffers WHERE id=?").bind(gid).first();
      if (found) name = found.name;
    }
    if (gid) await c.env.DB.prepare("INSERT OR REPLACE INTO match_gaffers (match_id,gaffer_id,is_primary,name_snapshot) VALUES (?,?,?,?)").bind(id, gid, gf.primary ? 1 : 0, name).run();
  }

  if (b.settleFixtureId) await settlePredictions(c.env, clean(b.settleFixtureId, 40), our, their);
  await audit(c.env, g.user.id, isNew ? "match_create" : "match_update", "match", id, { opponent });
  return c.json({ ok: true, id, updated: !isNew });
});

admin.delete("/matches/:id", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const id = intOr(c.req.param("id"), 0);
  for (const t of ["match_player_stats", "match_scorers", "match_lineup_players", "match_lineups", "match_gaffers"]) {
    await c.env.DB.prepare(`DELETE FROM ${t} WHERE match_id=?`).bind(id).run();
  }
  await c.env.DB.prepare("DELETE FROM matches WHERE id=?").bind(id).run();
  await audit(c.env, g.user.id, "match_delete", "match", id, null);
  return c.json({ ok: true });
});

/* ---------------- FIXTURES ---------------- */
admin.post("/fixtures", async (c) => {
  const g = await requireLevel(c, 5); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const b = await c.req.json().catch(() => ({}));
  const id = "fx-" + Math.random().toString(36).slice(2, 10);
  const kind = b.kind === "session" ? "session" : "match";
  let stage = String(b.stage || "friendly").toLowerCase();
  if (!["league", "playoff", "cup", "friendly", "international", "other"].includes(stage)) stage = "friendly";
  const seasonId = b.seasonId ? clean(b.seasonId, 24) : null;
  if (seasonId) {
    const seasonExists = await c.env.DB.prepare("SELECT id FROM seasons WHERE id=?").bind(seasonId).first();
    if (!seasonExists) return c.json({ ok: false, error: "season_not_found", code: "season_not_found" }, 400);
  }
  await c.env.DB.prepare(
    "INSERT INTO fixtures (id,kind,season_id,stage,date_iso,opponent,comp_name,note,settled) VALUES (?,?,?,?,?,?,?,?,0)"
  ).bind(id, kind, seasonId, stage, clean(b.dateISO, 10), clean(b.opponent, 60), clean(b.compName, 50), clean(b.note, 140)).run();
  await audit(c.env, g.user.id, "fixture_add", "fixture", id, null);
  return c.json({ ok: true, id });
});

admin.delete("/fixtures/:id", async (c) => {
  const g = await requireLevel(c, 5); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const id = clean(c.req.param("id"), 40);
  await c.env.DB.prepare("DELETE FROM availability WHERE fixture_id=?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM predictions WHERE fixture_id=?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM fixtures WHERE id=?").bind(id).run();
  await audit(c.env, g.user.id, "fixture_del", "fixture", id, null);
  return c.json({ ok: true });
});

/* ---------------- GAFFERS ---------------- */
admin.post("/gaffers", async (c) => {
  const g = await requireLevel(c, 5); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const b = await c.req.json().catch(() => ({}));
  const name = clean(b.name, 60);
  if (!name) return c.json({ ok: false, error: "name", code: "name" }, 400);
  const found = await c.env.DB.prepare("SELECT id FROM gaffers WHERE name=?").bind(name).first();
  if (found) return c.json({ ok: true, id: found.id, existed: true });
  const r = await c.env.DB.prepare("INSERT INTO gaffers (name,active,created_iso) VALUES (?,1,?)").bind(name, nowISO()).run();
  await audit(c.env, g.user.id, "gaffer_add", "gaffer", r.meta.last_row_id, { name });
  return c.json({ ok: true, id: r.meta.last_row_id });
});

admin.patch("/gaffers/:id", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const id = intOr(c.req.param("id"), 0);
  const b = await c.req.json().catch(() => ({}));
  const sets = [], args = [];
  if (b.name != null) { sets.push("name=?"); args.push(clean(b.name, 60)); }
  if (b.active != null) { sets.push("active=?"); args.push(b.active ? 1 : 0); if (!b.active) { sets.push("retired_iso=?"); args.push(nowISO()); } }
  if (!sets.length) return c.json({ ok: false, error: "nothing", code: "nothing" }, 400);
  await c.env.DB.prepare(`UPDATE gaffers SET ${sets.join(", ")} WHERE id=?`).bind(...args, id).run();
  await audit(c.env, g.user.id, "gaffer_update", "gaffer", id, b);
  return c.json({ ok: true });
});

/* ---------------- NEWS ---------------- */
admin.post("/news", async (c) => {
  const g = await requireLevel(c, 5); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const b = await c.req.json().catch(() => ({}));
  const title = clean(b.title, 120), body = clean(b.body, 4000);
  if (!title || !body) return c.json({ ok: false, error: "empty", code: "empty" }, 400);
  const status = b.status === "draft" ? "draft" : "published";
  const r = await c.env.DB.prepare(
    "INSERT INTO news_posts (tag,date_iso,title,body,pinned,status,published_iso) VALUES (?,?,?,?,?,?,?)"
  ).bind(clean(b.tag, 24) || "CLUB", clean(b.dateISO, 10) || nowISO().slice(0, 10), title, body, b.pinned ? 1 : 0, status, status === "published" ? nowISO() : null).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

admin.patch("/news/:id", async (c) => {
  const g = await requireLevel(c, 5); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const id = intOr(c.req.param("id"), 0);
  const b = await c.req.json().catch(() => ({}));
  const map = { tag: "tag", dateISO: "date_iso", title: "title", body: "body" };
  const sets = [], args = [];
  for (const k in map) if (b[k] != null) { sets.push(map[k] + "=?"); args.push(clean(b[k], k === "body" ? 4000 : 120)); }
  if (b.pinned != null) { sets.push("pinned=?"); args.push(b.pinned ? 1 : 0); }
  if (b.status != null) { sets.push("status=?"); args.push(b.status === "draft" ? "draft" : "published"); }
  if (!sets.length) return c.json({ ok: false, error: "nothing", code: "nothing" }, 400);
  await c.env.DB.prepare(`UPDATE news_posts SET ${sets.join(", ")} WHERE id=?`).bind(...args, id).run();
  return c.json({ ok: true });
});

admin.delete("/news/:id", async (c) => {
  const g = await requireLevel(c, 5); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  await c.env.DB.prepare("DELETE FROM news_posts WHERE id=?").bind(intOr(c.req.param("id"), 0)).run();
  return c.json({ ok: true });
});

/* ---------------- SQUAD / PLAYERS (L5 identity, L9 baselines) ---------------- */
const POS_WL = ["GK", "RB", "RWB", "CB", "LB", "LWB", "CDM", "CM", "CAM", "RM", "LM", "RW", "LW", "CF", "ST"];
function cleanPositions(arr) {
  const out = [];
  for (const x of (Array.isArray(arr) ? arr : [])) {
    const p = String(x == null ? "" : x).toUpperCase().replace(/[^A-Z]/g, "");
    if (POS_WL.includes(p) && !out.includes(p)) out.push(p);
  }
  return out.slice(0, 3);
}

admin.post("/players", async (c) => {
  const g = await requireLevel(c, 5); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const b = await c.req.json().catch(() => ({}));
  const id = pid(b.id || b.name);
  const name = clean(b.name, 40);
  if (!id || !name) return c.json({ ok: false, error: "name", code: "name" }, 400);
  const positions = cleanPositions(b.positions);
  const rec = {
    id, number: clampInt(b.number, 0, 99), name, slug: id,
    controlled_by: b.controlledBy === "human" ? "human" : "bot",
    is_human: b.controlledBy === "human" ? 1 : 0,
    perma_bench: b.permaBench ? 1 : 0, retired_ai: b.retiredAI ? 1 : 0,
    linked_to: b.linkedTo ? pid(b.linkedTo) : null,
    positions_json: JSON.stringify(positions), flavour: clean(b.flavour, 400), active: 1
  };
  await c.env.DB.prepare(
    `INSERT INTO players (id,number,name,slug,controlled_by,is_human,perma_bench,retired_ai,linked_to,positions_json,flavour,active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1)
     ON CONFLICT(id) DO UPDATE SET number=excluded.number, name=excluded.name, controlled_by=excluded.controlled_by,
       is_human=excluded.is_human, perma_bench=excluded.perma_bench, retired_ai=excluded.retired_ai,
       linked_to=excluded.linked_to, positions_json=excluded.positions_json, flavour=excluded.flavour`
  ).bind(rec.id, rec.number, rec.name, rec.slug, rec.controlled_by, rec.is_human, rec.perma_bench,
    rec.retired_ai, rec.linked_to, rec.positions_json, rec.flavour).run();
  await audit(c.env, g.user.id, "player_save", "player", id, { name });
  return c.json({ ok: true, id });
});

admin.delete("/players/:id", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const id = pid(c.req.param("id"));
  await c.env.DB.prepare("UPDATE players SET active=0 WHERE id=?").bind(id).run();
  await audit(c.env, g.user.id, "player_deactivate", "player", id, null);
  return c.json({ ok: true });
});

/* ---- career baseline (verified overall totals; L9 only) ---- */
admin.post("/players/:id/baseline", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const id = pid(c.req.param("id"));
  const player = await c.env.DB.prepare("SELECT id FROM players WHERE id=?").bind(id).first();
  if (!player) return c.json({ ok: false, error: "not_found", code: 404 }, 404);
  const b = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare(
    `INSERT INTO player_career_baselines (player_id,as_of_seq,apps,goals,assists,avg_rating,passes,tackles,clean_sheets,win_pct,source,note,updated_by,updated_iso)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(player_id) DO UPDATE SET as_of_seq=excluded.as_of_seq, apps=excluded.apps, goals=excluded.goals,
       assists=excluded.assists, avg_rating=excluded.avg_rating, passes=excluded.passes, tackles=excluded.tackles,
       clean_sheets=excluded.clean_sheets, win_pct=excluded.win_pct, source=excluded.source, note=excluded.note,
       updated_by=excluded.updated_by, updated_iso=excluded.updated_iso`
  ).bind(id, intOr(b.asOfSeq, 0), clampInt(b.apps, 0, 9999), clampInt(b.goals, 0, 9999), clampInt(b.assists, 0, 9999),
    (b.avgRating == null || b.avgRating === "") ? null : Number(b.avgRating), clampInt(b.passes, 0, 999999),
    clampInt(b.tackles, 0, 99999), clampInt(b.cleanSheets, 0, 9999), (b.winPct == null || b.winPct === "") ? null : Number(b.winPct),
    clean(b.source, 60), clean(b.note, 300), g.user.id, nowISO()).run();
  await audit(c.env, g.user.id, "baseline_update", "player", id, { source: b.source });
  return c.json({ ok: true });
});

admin.post("/players/:id/season-baseline", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const id = pid(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const seasonId = clean(b.seasonId, 24);
  if (!seasonId) return c.json({ ok: false, error: "season", code: "season" }, 400);
  const seasonExists = await c.env.DB.prepare("SELECT id FROM seasons WHERE id=?").bind(seasonId).first();
  if (!seasonExists) return c.json({ ok: false, error: "season_not_found", code: "season_not_found" }, 400);
  await c.env.DB.prepare(
    `INSERT INTO player_season_baselines (player_id,season_id,apps,goals,assists,avg_rating,note)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(player_id,season_id) DO UPDATE SET apps=excluded.apps, goals=excluded.goals, assists=excluded.assists,
       avg_rating=excluded.avg_rating, note=excluded.note`
  ).bind(id, seasonId, clampInt(b.apps, 0, 9999), clampInt(b.goals, 0, 9999), clampInt(b.assists, 0, 9999),
    (b.avgRating == null || b.avgRating === "") ? null : Number(b.avgRating), clean(b.note, 300)).run();
  await audit(c.env, g.user.id, "season_baseline_update", "player", id, { seasonId });
  return c.json({ ok: true });
});

/* ---- club record baselines (verified overall club totals; L9) ---- */
admin.post("/club-record", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const b = await c.req.json().catch(() => ({}));
  const entries = Object.entries(b.values || {});
  for (const [key, value] of entries) {
    await c.env.DB.prepare(
      "INSERT INTO club_record_baselines (key,value,note) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, note=excluded.note"
    ).bind(clean(key, 40), clean(String(value), 40), clean(b.note, 200)).run();
  }
  await audit(c.env, g.user.id, "club_record_update", "club_record", null, b.values);
  return c.json({ ok: true });
});

/* ---------------- SEASONS ---------------- */
admin.post("/seasons", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const b = await c.req.json().catch(() => ({}));
  const id = clean(b.id, 24).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!id) return c.json({ ok: false, error: "id", code: "id" }, 400);
  const existing = await c.env.DB.prepare("SELECT id FROM seasons WHERE id=?").bind(id).first();
  if (existing) return c.json({ ok: false, error: "exists", code: "exists" }, 409);
  await c.env.DB.prepare(
    "INSERT INTO seasons (id,label,game,started_iso,ended_iso,archived,sort) VALUES (?,?,?,?,?,0,?)"
  ).bind(id, clean(b.label, 60) || id, clean(b.game, 40), clean(b.startedISO, 10) || nowISO().slice(0, 10), null, intOr(b.sort, 0)).run();
  if (b.makeCurrent) {
    await c.env.DB.prepare("INSERT INTO site_settings (key,value) VALUES ('current_season',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(id).run();
  }
  await audit(c.env, g.user.id, "season_add", "season", id, { label: b.label });
  return c.json({ ok: true, id });
});

admin.patch("/seasons/:id", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const id = clean(c.req.param("id"), 24);
  const b = await c.req.json().catch(() => ({}));
  const sets = [], args = [];
  if (b.label != null) { sets.push("label=?"); args.push(clean(b.label, 60)); }
  if (b.archived != null) { sets.push("archived=?"); args.push(b.archived ? 1 : 0); if (b.archived) { sets.push("ended_iso=?"); args.push(nowISO()); } }
  if (b.sort != null) { sets.push("sort=?"); args.push(intOr(b.sort, 0)); }
  if (sets.length) await c.env.DB.prepare(`UPDATE seasons SET ${sets.join(", ")} WHERE id=?`).bind(...args, id).run();
  if (b.makeCurrent) {
    await c.env.DB.prepare("INSERT INTO site_settings (key,value) VALUES ('current_season',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(id).run();
  }
  await audit(c.env, g.user.id, "season_update", "season", id, b);
  return c.json({ ok: true });
});

/* Move a match to a different season (Housekeeping correction tool). */
admin.post("/matches/:id/season", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const matchId = intOr(c.req.param("id"), 0);
  const b = await c.req.json().catch(() => ({}));
  const seasonId = clean(b.seasonId, 24);
  const season = await c.env.DB.prepare("SELECT id FROM seasons WHERE id=?").bind(seasonId).first();
  if (!season) return c.json({ ok: false, error: "season", code: "season" }, 400);
  const match = await c.env.DB.prepare("SELECT id FROM matches WHERE id=?").bind(matchId).first();
  if (!match) return c.json({ ok: false, error: "not_found", code: 404 }, 404);
  await c.env.DB.prepare("UPDATE matches SET season_id=? WHERE id=?").bind(seasonId, matchId).run();
  await audit(c.env, g.user.id, "match_reseason", "match", matchId, { seasonId });
  return c.json({ ok: true });
});

/* Bulk-assign a range of match ids to a season — used once at the final
   data import to fix the "final X matches belong to the current season"
   allocation (owner-specified seq boundary). */
admin.post("/seasons/:id/assign-range", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const seasonId = clean(c.req.param("id"), 24);
  const season = await c.env.DB.prepare("SELECT id FROM seasons WHERE id=?").bind(seasonId).first();
  if (!season) return c.json({ ok: false, error: "season", code: "season" }, 400);
  const b = await c.req.json().catch(() => ({}));
  const fromSeq = intOr(b.fromSeq, 0), toSeq = intOr(b.toSeq, 999999);
  const res = await c.env.DB.prepare("UPDATE matches SET season_id=? WHERE id >= ? AND id <= ?").bind(seasonId, fromSeq, toSeq).run();
  await audit(c.env, g.user.id, "season_assign_range", "season", seasonId, { fromSeq, toSeq });
  return c.json({ ok: true, changed: res.meta.changes });
});

/* ---------------- BANNER / SETTINGS ---------------- */
admin.post("/banner", async (c) => {
  const g = await requireLevel(c, 5); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const b = await c.req.json().catch(() => ({}));
  const val = JSON.stringify({ text: clean(b.text, 200), active: !!b.active });
  await c.env.DB.prepare("INSERT INTO site_settings (key,value) VALUES ('banner',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(val).run();
  return c.json({ ok: true });
});

/* League standing (division/position/points) is owner-set and independent of
   recorded match results — it doesn't reset or step predictably from win/loss
   counts (promotion, playoff seeding, points deductions), unlike Played/Form
   on the home card, which the /home route derives from matches directly. */
admin.post("/league-status", async (c) => {
  const g = await requireLevel(c, 5); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const b = await c.req.json().catch(() => ({}));
  const val = JSON.stringify({
    division: clean(b.division, 60),
    position: clean(b.position, 60),
    points: clean(b.points, 30),
  });
  await c.env.DB.prepare("INSERT INTO site_settings (key,value) VALUES ('league_status',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(val).run();
  await audit(c.env, g.user.id, "league_status", "setting", "league_status", null);
  return c.json({ ok: true });
});

admin.post("/settings", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const b = await c.req.json().catch(() => ({}));
  const key = clean(b.key, 40);
  if (!key) return c.json({ ok: false, error: "key", code: "key" }, 400);
  await c.env.DB.prepare("INSERT INTO site_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, clean(b.value, 4000)).run();
  await audit(c.env, g.user.id, "settings", "setting", key, null);
  return c.json({ ok: true });
});

/* ---------------- USERS (L9) ---------------- */
admin.get("/users", async (c) => {
  const g = await requireLevel(c, 5); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const list = rows(await c.env.DB.prepare(
    `SELECT u.id, u.username, u.display, u.level, u.banned, u.created_iso, u.last_iso,
            up.linked_player_id, up.primary_identity_id,
            p.name AS linked_player_name
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN players p ON p.id = up.linked_player_id
     ORDER BY u.level DESC, u.username ASC`
  ).all());
  return c.json({ ok: true, users: list });
});

admin.post("/users/:id/level", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const id = intOr(c.req.param("id"), 0);
  const b = await c.req.json().catch(() => ({}));
  const level = clampInt(b.level, 1, 9);
  if (id === g.user.id) return c.json({ ok: false, error: "self", code: "self" }, 400);
  await c.env.DB.prepare("UPDATE users SET level=? WHERE id=?").bind(level, id).run();
  await audit(c.env, g.user.id, "user_level", "user", id, { level });
  return c.json({ ok: true });
});

admin.post("/users/:id/ban", async (c) => {
  const g = await requireLevel(c, 9); if (g.err) return c.json({ ok: false, error: g.err, code: g.err }, g.status);
  const id = intOr(c.req.param("id"), 0);
  const b = await c.req.json().catch(() => ({}));
  if (id === g.user.id) return c.json({ ok: false, error: "self", code: "self" }, 400);
  await c.env.DB.prepare("UPDATE users SET banned=? WHERE id=?").bind(b.banned ? 1 : 0, id).run();
  if (b.banned) await c.env.DB.prepare("UPDATE user_sessions SET revoked=1 WHERE user_id=?").bind(id).run();
  await audit(c.env, g.user.id, b.banned ? "user_ban" : "user_unban", "user", id, null);
  return c.json({ ok: true });
});

export default admin;
