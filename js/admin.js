/* ============================================================
   The 40Yr Virgil — Housekeeping console  v2 "The Ledger"
   ------------------------------------------------------------
   The archive is managed here, game by game.
     L5+ (mods)  · matches (add/edit), fixtures, squad identity,
                   socials, flavour, milestones, banner, Fun & Games
     L9 (admin)  · delete matches, career baselines, club record,
                   lore, users, personal data, season archive
   The server re-checks every level on every action; this file
   only decides what to draw.
   ============================================================ */
(function () {
  "use strict";

  var U = null, NET = null, DATA = null, helpers = {};
  var root = null;

  /* ========================================================
     SHARED SCAFFOLD
     ======================================================== */
  function block(title, bodyHtml, levelNote) {
    return '<div class="panel admin-block">' +
      '<div class="section-label">' + title +
        (levelNote ? ' <span class="admin-lvl">' + levelNote + "</span>" : "") +
      "</div>" + bodyHtml +
    "</div>";
  }

  function refreshConfig() {
    DATA.bust();
    return DATA.config().then(function (res) {
      if (helpers.applyConfig) helpers.applyConfig(res);
      return res;
    });
  }

  function cfgFrom(res) { return (res && res.config) || {}; }

  function field(label, inner, hint) {
    return '<label class="field"><span class="field-label">' + label + "</span>" + inner +
      (hint ? '<span class="field-hint">' + hint + "</span>" : "") + "</label>";
  }

  function playerOptions(selected) {
    return window.SQUAD.slice().sort(function (a, b) { return a.number - b.number; })
      .filter(function (p) { return !p.disabled; })
      .map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === selected ? " selected" : "") + ">#" + p.number + " " + U.esc(p.name) + "</option>";
      }).join("");
  }

  function posOptions(sel, allowEmpty) {
    return (allowEmpty ? '<option value="">—</option>' : "") +
      (window.POSITIONS || []).map(function (P) {
        return '<option value="' + P + '"' + (P === sel ? " selected" : "") + ">" + P + "</option>";
      }).join("");
  }
  function posSelects(p) {
    var ps = (p.positions && p.positions.length) ? p.positions : (p.position ? [p.position] : []);
    return '<div class="sq-pos-row">' +
      '<select class="sq-pos1">' + posOptions(ps[0] || "", false) + "</select>" +
      '<select class="sq-pos2">' + posOptions(ps[1] || "", true) + "</select>" +
      '<select class="sq-pos3">' + posOptions(ps[2] || "", true) + "</select>" +
    "</div>";
  }

  /* ---------- teamsheet helpers ---------- */
  function formationOptions(sel) {
    return Object.keys(window.FORMATIONS || {}).map(function (k) {
      return '<option value="' + k + '"' + (k === sel ? " selected" : "") + ">" + k + "</option>";
    }).join("");
  }
  function venueOptions(sel) {
    var opts = [["", "—"], ["H", "Home"], ["A", "Away"], ["N", "Neutral"]];
    return opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === sel ? " selected" : "") + ">" + o[1] + "</option>"; }).join("");
  }
  /* Position-aware auto XI for a formation → array of player ids per slot. */
  function autoXI(fkey) {
    var f = window.FORMATIONS[fkey];
    var players = (window.SQUAD || []).filter(function (p) { return !p.disabled && !p.permaBench; });
    var byId = {}; players.forEach(function (p) { byId[p.id] = p; });
    var out = f.slots.map(function () { return ""; });
    var used = {};
    var camIdx = -1;
    f.slots.forEach(function (s, i) { if (camIdx === -1 && U.canonPos(s.pos) === "CAM") camIdx = i; });
    if (camIdx !== -1 && byId.tupci) { out[camIdx] = "tupci"; used.tupci = 1; }
    var ids = players.map(function (p) { return p.id; });
    ["exact", "group"].forEach(function (level) {
      f.slots.forEach(function (s, i) {
        if (out[i]) return;
        for (var k = 0; k < ids.length; k++) { var id = ids[k]; if (!used[id] && U.posFit(byId[id], s.pos) === level) { out[i] = id; used[id] = 1; break; } }
      });
    });
    f.slots.forEach(function (s, i) {
      if (out[i]) return;
      for (var k = 0; k < ids.length; k++) { var id = ids[k]; if (!used[id]) { out[i] = id; used[id] = 1; break; } }
    });
    return out;
  }

  /* ========================================================
     ENTRY
     ======================================================== */
  function enter(container, h) {
    U = window.UI; NET = window.NET; DATA = window.DATA; helpers = h || helpers || {};
    root = container;

    // The router bounces non-mods; this neutral card only covers the
    // grace window while a real staff session is still verifying.
    if (!NET.isMod()) {
      root.innerHTML = '<div class="panel admin-gate"><p class="admin-gate-line">Checking access…</p></div>';
      return;
    }

    root.innerHTML = '<div class="admin-grid" id="admin-grid">' + U.emptyState("Opening the office…", "", "🗝") + "</div>";

    Promise.all([DATA.config(), DATA.matches(), DATA.career(), DATA.record()]).then(function (rs) {
      var grid = U.$("#admin-grid", root);
      if (!grid) return;
      var c = cfgFrom(rs[0]);
      var matches = (rs[1] && rs[1].matches) || [];
      var baselineSeq = (rs[1] && rs[1].baselineSeq) || 0;
      var career = (rs[2] && rs[2].career) || [];
      var record = (rs[3] && rs[3].record) || {};
      var admin = NET.isAdmin();

      grid.innerHTML =
        blockMatchManager(matches) +
        blockFixtures(c) +
        blockSquad() +
        blockSocials(c) +
        blockFun(c) +
        blockNews(c) +
        blockLeague(c) +
        blockFlavour(c) +
        blockMilestones(c) +
        blockBanner(c) +
        blockUsers(admin) +
        (admin ? blockRecord(record) : "") +
        (admin ? blockCareer(career, baselineSeq) : "") +
        (admin ? blockLore(c) : "") +
        (admin ? blockPersonal() : "") +
        (admin ? blockSeason(c) : "") +
        blockForumNote() +
        blockChatNote();

      bind(matches, career, record, baselineSeq, admin);
      renderSquadEditor();
      if (admin) renderPersonal();

      // A pencil on the Results page may have sent us here with a target.
      var jump = null;
      try { jump = sessionStorage.getItem("v40.editseq"); sessionStorage.removeItem("v40.editseq"); } catch (e) { /* fine */ }
      if (jump) {
        var m = matches.filter(function (x) { return String(x.seq) === String(jump); })[0];
        if (m) openEditor(m, matches);
      }
    });
  }

  /* ========================================================
     1 · MATCH MANAGER  (L5+)
     ======================================================== */
  function blockMatchManager(matches) {
    return block("The ledger · matches",
      '<p class="admin-note">Every game on record, newest first. Mods add and edit; only the admin can strike one from the books.</p>' +
      '<div class="admin-actions">' +
        '<button class="btn btn-gold btn-small" id="adm-match-new">+ Log a new match</button>' +
        '<span class="admin-inline-note">' + matches.length + " matches on file</span>" +
      "</div>" +
      '<div id="adm-match-editor"></div>' +
      '<div class="admin-sublist admin-matchlist" id="adm-match-list">' + matchListHtml(matches) + "</div>",
      "L5+");
  }

  function matchListHtml(matches) {
    if (!matches.length) return '<p class="admin-inline-note">The ledger is empty. Historic.</p>';
    return matches.map(function (m) {
      return '<div class="admin-row">' +
        '<span class="admin-row-main">' +
          '<span class="pill pill-' + (m.result === "W" ? "win" : m.result === "D" ? "draw" : "loss") + ' pill-small">' + m.result + "</span> " +
          "<strong>Match " + m.seq + "</strong> · " + (m.ourScore !== "" ? m.ourScore : "–") + "–" + (m.theirScore !== "" ? m.theirScore : "–") +
          " vs " + U.esc(m.opponent) +
          (m.players && m.players.length ? ' <span class="admin-detail-dot" title="Per-player stats on file">●</span>' : "") +
        "</span>" +
        '<span class="admin-row-side">' +
          '<button class="btn btn-ghost btn-small adm-match-edit" data-seq="' + m.seq + '">Edit</button>' +
          (NET.isAdmin() ? '<button class="btn btn-ghost btn-small adm-match-del" data-seq="' + m.seq + '">✕</button>' : "") +
        "</span>" +
      "</div>";
    }).join("");
  }

  /* ---------- the editor itself ---------- */
  function openEditor(m, matches) {
    var box = U.$("#adm-match-editor", root);
    if (!box) return;
    var isNew = !m;
    m = m || { seq: 0, stage: "league", dateISO: "", opponent: "", ourScore: 0, theirScore: 0, result: "", scorers: [], note: "", players: [], compName: "" };

    var STAGES = ["league", "playoff", "cup", "friendly", "international", "other"];
    box.innerHTML =
      '<div class="match-editor" id="me-box">' +
        '<div class="me-head">' + (isNew ? "New match — Match " + (maxSeq(matches) + 1) : "Editing Match " + m.seq) + "</div>" +
        '<div class="field-row">' +
          field("Opponent", '<input type="text" id="me-opp" maxlength="60" value="' + U.esc(m.opponent) + '">') +
          field("Type",
            '<select id="me-stage">' +
              STAGES.map(function (s) {
                return '<option value="' + s + '"' + (m.stage === s ? " selected" : "") + ">" + s.charAt(0).toUpperCase() + s.slice(1) + "</option>";
              }).join("") +
            "</select>") +
          field("Date", '<input type="date" id="me-date" value="' + U.esc(m.dateISO || "") + '">', "optional") +
        "</div>" +
        '<div class="field-row">' +
          field("Competition name", '<input type="text" id="me-compname" maxlength="50" value="' + U.esc(m.compName || "") + '">', "optional — e.g. England v Germany, FA Cup R1") +
        "</div>" +
        '<div class="field-row">' +
          field("Our score", '<input type="number" id="me-our" min="0" max="99" value="' + (m.ourScore === "" ? 0 : m.ourScore) + '">') +
          field("Their score", '<input type="number" id="me-their" min="0" max="99" value="' + (m.theirScore === "" ? 0 : m.theirScore) + '">') +
          field("Result",
            '<select id="me-result">' +
              '<option value="">Auto from score</option>' +
              ["W", "D", "L"].map(function (r) {
                return '<option value="' + r + '"' + (m.result === r ? " selected" : "") + ">" + r + "</option>";
              }).join("") +
            "</select>", "override for forfeits etc.") +
        "</div>" +
        '<div class="section-label">Teamsheet <span class="admin-inline-note">the XI that played — powers the match report &amp; mini-pitch</span></div>' +
        '<div class="field-row">' +
          field("Formation", '<select id="me-formation">' + formationOptions((m.lineup && m.lineup.formation) || window.DEFAULT_FORMATION) + "</select>") +
          field("Venue", '<select id="me-venue">' + venueOptions(m.venue || "") + "</select>", "optional") +
        "</div>" +
        '<div class="me-teamsheet" id="me-xi"></div>' +
        '<div class="admin-actions">' +
          '<button class="btn btn-ghost btn-small" id="me-xi-auto" type="button">Auto-pick XI</button>' +
          '<button class="btn btn-ghost btn-small" id="me-xi-seed" type="button">Seed player stats from XI</button>' +
        "</div>" +
        '<div class="field-row">' +
          field("Captain", '<select id="me-captain">' + '<option value="">—</option>' + playerOptions((m.lineup && m.lineup.captain) || "") + "</select>") +
          field("Man of the Match", '<select id="me-motm"><option value="">Auto (top rating)</option>' + playerOptions(m.motm || "") + "</select>") +
        "</div>" +
        '<div class="section-label">Players <span class="admin-inline-note">one line per player involved — the Goals here fill the scoresheet automatically</span></div>' +
        '<div id="me-players"></div>' +
        '<button class="btn btn-ghost btn-small" id="me-player-add" type="button">+ Add player</button>' +
        field("Match note", '<input type="text" id="me-note" maxlength="200" value="' + U.esc(m.note || "") + '">', "one line for the books") +
        '<div class="admin-actions">' +
          '<button class="btn btn-primary btn-small" id="me-save">' + (isNew ? "Add to the ledger" : "Save changes") + "</button>" +
          '<button class="btn btn-ghost btn-small" id="me-cancel" type="button">Cancel</button>' +
          '<span class="admin-inline-note" id="me-msg"></span>' +
        "</div>" +
      "</div>";

    // One unified player list. Legacy matches stored goals only in the
    // scorer list — fold those in (goals pre-filled) so nothing is lost.
    var seedPlayers = (m.players || []).slice();
    var haveIds = {};
    seedPlayers.forEach(function (p) { if (p && p.id) haveIds[p.id] = 1; });
    (m.scorers || []).forEach(function (s) {
      if (s && s.id && !haveIds[s.id]) { seedPlayers.push({ id: s.id, goals: s.goals }); haveIds[s.id] = 1; }
    });
    seedPlayers.forEach(function (p) { addPlayerRow(p); });

    U.$("#me-player-add", box).addEventListener("click", function () { addPlayerRow(null); });
    U.$("#me-cancel", box).addEventListener("click", function () { box.innerHTML = ""; });

    // ---- Teamsheet ----
    function renderXI(fkey, seedXi) {
      var f = window.FORMATIONS[fkey];
      if (!f) return;
      var byIdx = {};
      (seedXi || []).forEach(function (x, idx) { byIdx[idx] = x.id; });
      U.$("#me-xi", box).innerHTML = f.slots.map(function (s, i) {
        return '<label class="me-xi-row"><span class="me-xi-pos">' + s.pos + "</span>" +
          '<select class="me-xi-sel" data-pos="' + s.pos + '"><option value="">—</option>' + playerOptions(byIdx[i] || "") + "</select></label>";
      }).join("");
    }
    renderXI(U.$("#me-formation", box).value, (m.lineup && m.lineup.xi) || null);
    U.$("#me-formation", box).addEventListener("change", function () { renderXI(this.value, null); });
    U.$("#me-xi-auto", box).addEventListener("click", function () {
      var fkey = U.$("#me-formation", box).value;
      renderXI(fkey, autoXI(fkey).map(function (id) { return { id: id }; }));
    });
    U.$("#me-xi-seed", box).addEventListener("click", function () {
      var have = {}; U.$$(".me-player", box).forEach(function (row) { have[row.querySelector("select").value] = 1; });
      U.$$(".me-xi-sel", box).forEach(function (sel) { if (sel.value && !have[sel.value]) { addPlayerRow({ id: sel.value }); have[sel.value] = 1; } });
      U.toast("Stat lines seeded from the XI.");
    });

    U.$("#me-save", box).addEventListener("click", function () {
      var btn = this;
      var players = U.$$(".me-player", box).map(function (row) {
        var g = function (cls) { return row.querySelector("." + cls).value; };
        return {
          id: row.querySelector("select").value,
          goals: g("mp-g"), assists: g("mp-a"), rating: g("mp-r"),
          shots: g("mp-sh"), tackles: g("mp-tk"),
          passesMade: g("mp-pm"), passAttempts: g("mp-pa"), redCards: g("mp-rc")
        };
      }).filter(function (p) { return p.id; });
      // Scorers are DERIVED from the player lines — enter stats once, only.
      var scorers = players.filter(function (p) { return Number(p.goals) > 0; })
        .map(function (p) { return { id: p.id, goals: p.goals }; });
      // Teamsheet: the XI (in slot order) + subs = stat-line players not in the XI.
      var xi = U.$$(".me-xi-sel", box).map(function (sel) { return { id: sel.value, pos: sel.getAttribute("data-pos") }; })
        .filter(function (x) { return x.id; });
      var inXi = {}; xi.forEach(function (x) { inXi[x.id] = 1; });
      var subs = players.map(function (p) { return p.id; }).filter(function (id) { return !inXi[id]; });
      var payload = {
        seq: isNew ? 0 : m.seq,
        stage: U.$("#me-stage", box).value,
        compName: U.$("#me-compname", box).value.trim(),
        dateISO: U.$("#me-date", box).value,
        opponent: U.$("#me-opp", box).value.trim(),
        ourScore: U.$("#me-our", box).value,
        theirScore: U.$("#me-their", box).value,
        result: U.$("#me-result", box).value,
        note: U.$("#me-note", box).value,
        scorers: scorers,
        players: players,
        lineup: { formation: U.$("#me-formation", box).value, xi: xi, subs: subs, captain: U.$("#me-captain", box).value },
        motm: U.$("#me-motm", box).value,
        venue: U.$("#me-venue", box).value
      };
      var msg = U.$("#me-msg", box);
      if (!payload.opponent) { msg.textContent = "Opponent needed."; return; }
      btn.disabled = true;
      msg.textContent = "Writing to the ledger…";
      NET.matchSave(payload).then(function (r) {
        btn.disabled = false;
        if (r && r.ok) {
          U.toast(isNew ? "Match " + r.seq + " is in the books." : "Match " + r.seq + " updated.");
          box.innerHTML = "";
          reloadMatches();
        } else {
          msg.textContent = "✗ " + ((r && r.error) || "Couldn't save.");
        }
      });
    });

    box.scrollIntoView({ behavior: "smooth", block: "start" });

    function addPlayerRow(p) {
      p = p || {};
      var mountP = U.$("#me-players", box);
      var row = document.createElement("div");
      row.className = "me-player";
      function n(v) { return v === "" || v == null ? "" : v; }
      row.innerHTML =
        '<div class="field-row">' +
          '<label class="field"><span class="field-label">Player</span><select>' + playerOptions(p.id) + "</select></label>" +
          '<button class="btn btn-ghost btn-small me-row-del" type="button">✕</button>' +
        "</div>" +
        '<div class="me-statgrid">' +
          mini("G", "mp-g", n(p.goals)) + mini("A", "mp-a", n(p.assists)) +
          mini("Rating", "mp-r", n(p.rating), "0.1") + mini("Shots", "mp-sh", n(p.shots)) +
          mini("Tackles", "mp-tk", n(p.tackles)) + mini("Passes", "mp-pm", n(p.passesMade)) +
          mini("Attempts", "mp-pa", n(p.passAttempts)) + mini("Reds", "mp-rc", n(p.redCards)) +
        "</div>";
      row.querySelector(".me-row-del").addEventListener("click", function () { row.remove(); });
      mountP.appendChild(row);

      function mini(label, cls, val, step) {
        return '<label class="me-mini"><span>' + label + '</span><input class="' + cls + '" type="number" min="0" ' +
          (step ? 'step="' + step + '" max="10"' : 'max="999"') + ' value="' + (val === "" ? "" : val) + '" placeholder="0"></label>';
      }
    }
  }

  function maxSeq(matches) {
    var mx = 0;
    matches.forEach(function (m) { if (Number(m.seq) > mx) mx = Number(m.seq); });
    return mx;
  }

  function reloadMatches() {
    DATA.bust();
    DATA.matches().then(function (res) {
      var list = U.$("#adm-match-list", root);
      if (list) list.innerHTML = matchListHtml((res && res.matches) || []);
      bindMatchRows((res && res.matches) || []);
    });
  }

  function bindMatchRows(matches) {
    U.$$(".adm-match-edit", root).forEach(function (b) {
      b.addEventListener("click", function () {
        var m = matches.filter(function (x) { return String(x.seq) === b.getAttribute("data-seq"); })[0];
        if (m) openEditor(m, matches);
      });
    });
    U.$$(".adm-match-del", root).forEach(function (b) {
      b.addEventListener("click", function () {
        var seq = b.getAttribute("data-seq");
        if (b.getAttribute("data-armed") !== "1") {
          b.setAttribute("data-armed", "1");
          b.textContent = "Sure?";
          setTimeout(function () { b.setAttribute("data-armed", ""); b.textContent = "✕"; }, 2500);
          return;
        }
        b.disabled = true;
        NET.matchDelete(Number(seq)).then(function (r) {
          if (r && r.ok) { U.toast("Match " + seq + " struck from the books."); reloadMatches(); }
          else { b.disabled = false; U.toast("Couldn't delete that."); }
        });
      });
    });
  }

  /* ========================================================
     2 · CLUB RECORD BASELINE  (L9)
     ======================================================== */
  function blockRecord(rec) {
    function inp(id, val) { return '<input type="number" id="' + id + '" min="0" value="' + (val || 0) + '">'; }
    return block("Club record · baseline",
      '<p class="admin-note">The all-time totals as of the baseline match. Every match logged after the baseline adds on top automatically — only touch these to correct history.</p>' +
      '<div class="field-row">' +
        field("Wins", inp("rec-w", rec.wins)) + field("Draws", inp("rec-d", rec.draws)) + field("Losses", inp("rec-l", rec.losses)) +
      "</div>" +
      '<div class="field-row">' +
        field("Played", inp("rec-p", rec.played)) + field("Goals for", inp("rec-gf", rec.goalsFor)) + field("Goals against", inp("rec-ga", rec.goalsAgainst)) +
      "</div>" +
      '<div class="field-row">' +
        field("League apps", inp("rec-la", rec.leagueApps)) + field("Playoff apps", inp("rec-pa", rec.playoffApps)) +
        field("Badge", '<input type="text" id="rec-badge" maxlength="40" value="' + U.esc(rec.badge || "") + '">') +
      "</div>" +
      '<div class="admin-actions"><button class="btn btn-primary btn-small" id="rec-save">Save baseline</button></div>',
      "L9");
  }

  /* ========================================================
     3 · CAREER BASELINES  (L9)
     ======================================================== */
  function blockCareer(career, baselineSeq) {
    var rows = career.map(function (c, i) {
      return '<div class="admin-career-row" data-id="' + U.esc(c.id) + '">' +
        '<div class="field-row">' +
          field("Player id", '<input type="text" class="cr-id" value="' + U.esc(c.id) + '" readonly>') +
          field("Persona", '<input type="text" class="cr-persona" maxlength="40" value="' + U.esc(c.persona || "") + '">') +
          field("OVR", '<input type="number" class="cr-ovr" min="0" max="99" value="' + (c.ovr || "") + '">') +
        "</div>" +
        '<div class="me-statgrid">' +
          cmini("Games", "cr-games", c.games) + cmini("Goals", "cr-goals", c.goals) +
          cmini("Assists", "cr-assists", c.assists) + cmini("Passes", "cr-passes", c.passesMade) +
          cmini("Pass %", "cr-passpct", c.passPct) + cmini("Tackles", "cr-tackles", c.tackles) +
          cmini("Tkl %", "cr-tklpct", c.tacklePct) + cmini("Win %", "cr-winpct", c.winPct) +
        "</div>" +
      "</div>";
    }).join("");

    return block("Career baselines · the humans",
      '<p class="admin-note">The EA-era career snapshot. Matches logged after the baseline top these up automatically (goals from scorer lists; apps and assists from detailed stat lines).</p>' +
      rows +
      '<div class="field-row">' +
        field("Baseline through match #", '<input type="number" id="cr-baseline" min="0" value="' + baselineSeq + '">',
          "matches after this number count on top of the snapshot") +
      "</div>" +
      '<div class="admin-actions"><button class="btn btn-primary btn-small" id="cr-save">Save careers</button></div>',
      "L9");

    function cmini(label, cls, val) {
      return '<label class="me-mini"><span>' + label + '</span><input class="' + cls + '" type="number" min="0" max="99999" value="' + (val === "" || val == null ? "" : val) + '"></label>';
    }
  }

  /* ========================================================
     4 · BANNER / LORE / USERS / FLAVOUR / MILESTONES / CHAT
     ======================================================== */
  function blockBanner(c) {
    var b = c.banner || { text: "", active: false };
    return block("Announcement banner",
      field("Banner text", '<input type="text" id="adm-banner-text" maxlength="160" value="' + U.esc(b.text || "") + '">') +
      '<label class="field field-check"><input type="checkbox" id="adm-banner-active"' + (b.active ? " checked" : "") + "> Banner is live</label>" +
      '<div class="admin-actions"><button class="btn btn-primary btn-small" id="adm-banner-save">Save banner</button></div>',
      "L5+");
  }

  function blockLore(c) {
    return block("The lore",
      '<p class="admin-note">Why \u201CThe 40Yr Virgil\u201D? When this box is filled, the story appears on the About page. Until then the mystery does the heavy lifting.</p>' +
      '<textarea id="adm-lore" rows="5" placeholder="The truth, when the founders are ready…">' + U.esc(c.lore || "") + "</textarea>" +
      '<div class="admin-actions">' +
        '<button class="btn btn-primary btn-small" id="adm-lore-save">Publish lore</button>' +
        '<button class="btn btn-ghost btn-small" id="adm-lore-clear">Re-seal the vault</button>' +
      "</div>",
      "L9");
  }

  function blockUsers(admin) {
    return block("The register",
      '<p class="admin-note">' + (admin ? "Levels: 1 fan · 5+ steward (mod) · 9 the keys. You can't edit yourself — separation of powers." : "View only at your level. Stewards keep the chat tidy.") + "</p>" +
      '<div id="adm-users">' + U.emptyState("Fetching the register…", "", "⏱") + "</div>",
      admin ? "L9 manage" : "L5 view");
  }

  function blockFlavour(c) {
    var fl = c.flavour || {};
    var current = Object.keys(fl).map(function (id) {
      var p = U.playerById(id);
      return '<div class="admin-row"><span class="admin-row-main"><strong>' + U.esc(p ? p.name : id) + "</strong> — " + U.esc(fl[id]) + '</span>' +
        '<button class="btn btn-ghost btn-small adm-flavour-clear" data-id="' + U.esc(id) + '">✕</button></div>';
    }).join("");
    return block("Player flavour overrides",
      '<div class="field-row">' +
        field("Player", '<select id="adm-flavour-id">' + playerOptions("") + "</select>") +
        field("New flavour line", '<input type="text" id="adm-flavour-text" maxlength="140" placeholder="Leave empty to clear">') +
      "</div>" +
      '<div class="admin-actions"><button class="btn btn-primary btn-small" id="adm-flavour-save">Set flavour</button></div>' +
      (current ? '<div class="admin-sublist">' + current + "</div>" : ""),
      "L5+");
  }

  function blockMilestones(c) {
    var ms = (c.milestones || []).slice().sort(function (a, b) { return new Date(a.dateISO) - new Date(b.dateISO); });
    var list = ms.map(function (m) {
      return '<div class="admin-row"><span class="admin-row-main"><strong>' + U.esc(U.fmtDate(m.dateISO)) + "</strong> — " + U.esc(m.text) + "</span>" +
        '<button class="btn btn-ghost btn-small adm-ms-del" data-id="' + U.esc(m.id) + '">✕</button></div>';
    }).join("");
    return block("Honours timeline · milestones",
      '<div class="field-row">' +
        field("Date", '<input type="date" id="adm-ms-date">') +
        field("Milestone", '<input type="text" id="adm-ms-text" maxlength="120" placeholder="e.g. Promoted to Division 5">') +
      "</div>" +
      '<div class="admin-actions"><button class="btn btn-primary btn-small" id="adm-ms-add">Add milestone</button></div>' +
      (list ? '<div class="admin-sublist">' + list + "</div>" : '<p class="admin-inline-note">No milestones yet. Make some history first.</p>'),
      "L5+");
  }

  function blockChatNote() {
    return block("Chat moderation",
      '<p class="admin-note">Stewards see a ✕ on every message in <a href="#chat">the chat</a>. The server filters the worst words on its own.</p>',
      "L5+");
  }

  function blockForumNote() {
    return block("The dressing room · forum",
      '<p class="admin-note">Moderation lives in the forum itself — open any thread or reply and use the × to take it down. Members post; mods and the admin can remove.</p>' +
      '<div class="admin-actions"><a class="btn btn-ghost btn-small" href="#forum">Open the forum →</a></div>',
      "L5+");
  }

  function fixtureListHtml(fx) {
    if (!fx || !fx.length) return '<p class="admin-inline-note">No fixtures scheduled.</p>';
    return fx.map(function (f) {
      return '<div class="admin-row"><span class="admin-row-main"><strong>' + U.esc(f.opponent || "TBC") + "</strong> · " +
        U.esc((f.stage || "friendly")) + (f.compName ? " · " + U.esc(f.compName) : "") +
        (f.dateISO ? " · " + U.esc(f.dateISO) : " · date TBC") + "</span>" +
        '<button class="btn btn-ghost btn-small fx-del" data-id="' + U.esc(f.id) + '">✕</button></div>';
    }).join("");
  }

  function blockFixtures(c) {
    var stages = ["friendly", "league", "playoff", "cup", "international", "other"];
    return block("Fixtures · what's coming up",
      '<p class="admin-note">Shown in an Upcoming block at the top of Results. Past-dated fixtures drop off on their own.</p>' +
      '<div class="field-row">' +
        field("Opponent", '<input type="text" id="fx-opp" maxlength="60">') +
        field("Type", '<select id="fx-stage">' + stages.map(function (s) { return '<option value="' + s + '">' + s.charAt(0).toUpperCase() + s.slice(1) + "</option>"; }).join("") + "</select>") +
        field("Date", '<input type="date" id="fx-date">', "optional") +
      "</div>" +
      '<div class="field-row">' +
        field("Competition name", '<input type="text" id="fx-compname" maxlength="50">', "optional — e.g. England v Germany") +
        field("Note", '<input type="text" id="fx-note" maxlength="140">', "optional") +
      "</div>" +
      '<div class="admin-actions"><button class="btn btn-gold btn-small" id="fx-add">+ Add fixture</button><span class="admin-inline-note" id="fx-msg"></span></div>' +
      '<div class="admin-sublist" id="fx-list">' + fixtureListHtml(c.fixtures || []) + "</div>",
      "L5+");
  }

  function blockSocials(c) {
    return block("Socials · TikTok &amp; Twitch",
      '<p class="admin-note">Which accounts show on the <a href="#social">Socials</a> page. No @ needed. TikTok self-updates with new uploads; Twitch links to the channel.</p>' +
      '<div class="field-row">' +
        field("TikTok handle", '<input type="text" id="tt-handle" maxlength="30" value="' + U.esc(c.tiktok || "danwhizzy") + '">') +
        field("Twitch handle", '<input type="text" id="tw-handle" maxlength="30" value="' + U.esc(c.twitch || "40yrvirgil") + '">') +
      "</div>" +
      '<div class="admin-actions">' +
        '<button class="btn btn-primary btn-small" id="soc-save">Save socials</button>' +
        '<button class="btn btn-ghost btn-small" id="soc-test" type="button">Test Twitch connection</button>' +
        '<span class="admin-inline-note" id="soc-msg"></span>' +
      "</div>" +
      '<p class="admin-note">The LIVE badge only appears while the channel is actually streaming, and needs the Twitch app keys set as Script Properties (see README). Use Test to see exactly what Twitch reports.</p>' +
      '<div class="admin-sublist" id="soc-test-out"></div>',
      "L5+");
  }

  /* ---------- Fun & Games (L5+) ---------- */
  function funList(c, key) {
    var f = (c.fun || {})[key];
    var d = (window.FUN_DEFAULTS || {})[key] || [];
    return (f && f.length) ? f : d;
  }
  function funArea(id, label, lines, hint) {
    return '<label class="field"><span class="field-label">' + label +
      (hint ? ' <span class="admin-inline-note">' + hint + "</span>" : "") + "</span>" +
      '<textarea class="fun-edit" id="' + id + '" rows="4">' + U.esc((lines || []).join("\n")) + "</textarea></label>";
  }
  function blockFun(c) {
    var g = (c.fun && c.fun.gaffer) || {};
    var dg = (window.FUN_DEFAULTS || {}).gaffer || {};
    var names = (g.names && g.names.length) ? g.names : (dg.names || []);
    var quotes = (g.quotes && g.quotes.length) ? g.quotes : (dg.quotes || []);
    return block("Fun &amp; Games · the Funhouse",
      '<p class="admin-note">Every list behind the <a href="#funhouse">Funhouse</a> toys and the <a href="#gaffer">Gaffer</a> wheel — one entry per line. Chants &amp; rumours accept placeholders: <code>{name}</code> a random surname, <code>{full}</code> a full name, <code>{opp}</code> a mystery club.</p>' +
      funArea("fun-gaffer-names", "Manager wheel · names", names) +
      funArea("fun-gaffer-quotes", "Manager wheel · quotes", quotes) +
      '<div class="field-row">' +
        field("Pinned gaffer", '<input type="text" id="fun-gaffer-pinned" maxlength="40" value="' + U.esc(g.pinned || "") + '">', "blank = the wheel spins freely") +
      "</div>" +
      funArea("fun-chants", "Chant machine", funList(c, "chants")) +
      funArea("fun-superlatives", "Squad superlatives (awards)", funList(c, "superlatives")) +
      funArea("fun-oracle", "The Oracle (answers)", funList(c, "oracle")) +
      funArea("fun-rumours", "Transfer rumours", funList(c, "rumours")) +
      funArea("fun-rumourClubs", "Rumour clubs (for {opp})", funList(c, "rumourClubs")) +
      '<div class="admin-actions"><button class="btn btn-primary btn-small" id="fun-save">Save Fun &amp; Games</button><span class="admin-inline-note" id="fun-msg"></span></div>',
      "L5+");
  }

  /* ---------- Season archive (L9) ---------- */
  function blockSeason(c) {
    var seasons = c.seasons || [];
    var current = c.currentSeason || "";
    var list = seasons.length
      ? '<div class="admin-sublist">' + seasons.map(function (s) {
          return '<div class="admin-row"><span class="admin-row-main"><strong>' + U.esc(s.label || s.id) + "</strong>" +
            (s.id === current ? ' <span class="level-chip level-mod">current</span>' : "") +
            (s.archived ? ' <span class="admin-inline-note">archived ' + U.esc((s.endedISO || "").slice(0, 10)) + "</span>" : "") +
          "</span></div>";
        }).join("") + "</div>"
      : '<p class="admin-inline-note">Season tracking initialises on the next backend deploy.</p>';
    return block("Seasons · archive &amp; roll over",
      '<p class="admin-note">When a season ends (FC26 → FC27), archive it: the current record and careers are snapshotted read-only and a fresh season starts under the same club. Accounts, chat, forum and squad carry over. This cannot be undone — use it once, in September.</p>' +
      list +
      '<div class="field-row">' +
        field("New season id", '<input type="text" id="season-id" maxlength="12" placeholder="fc27">', "short, lowercase") +
        field("New season label", '<input type="text" id="season-label" maxlength="40" placeholder="Season 3 · FC27">') +
      "</div>" +
      '<div class="admin-actions"><button class="btn btn-ghost btn-small" id="season-archive">Archive season &amp; start new</button><span class="admin-inline-note" id="season-msg"></span></div>',
      "L9");
  }

  function toggleRow(id, label, on) {
    return '<label class="pers-toggle"><input type="checkbox" id="' + id + '"' + (on ? " checked" : "") + '>' +
      '<span class="pers-toggle-track"><span class="pers-toggle-dot"></span></span>' +
      '<span class="pers-toggle-label">' + label + "</span></label>";
  }

  function blockPersonal() {
    return block("Personal · birthdays & better halves",
      '<p class="admin-note">Private by default. None of this reaches the site until you switch it on below — the data is held server-side and only sent to browsers when a toggle is green.</p>' +
      '<div id="pers-view">' + U.emptyState("Loading…", "", "🔒") + "</div>",
      "L9");
  }

  function renderPersonal() {
    var mt = U.$("#pers-view", root);
    if (!mt) return;
    NET.adminPersonal({ action: "get" }).then(function (res) {
      if (!res || !res.ok) { mt.innerHTML = '<p class="admin-inline-note">Couldn\u2019t load personal data.</p>'; return; }
      var people = res.people || [];
      mt.innerHTML =
        '<div class="pers-toggles">' +
          toggleRow("pers-bdays", "Show birthdays on the site", res.showBirthdays) +
          toggleRow("pers-partners", "Show partner cameos on the site", res.showPartners) +
        "</div>" +
        '<div class="pers-people">' +
          people.map(function (p) {
            var who = window.SQUAD.filter(function (s) { return s.id === p.id; })[0];
            var nm = who ? who.name : p.id;
            return '<div class="pers-person" data-id="' + U.esc(p.id) + '">' +
              '<div class="pers-person-head">' + U.esc(nm) + ' <span class="admin-inline-note">' + U.esc(p.id) + "</span></div>" +
              '<div class="field-row">' +
                field("Real name", '<input type="text" class="pers-real" maxlength="30" value="' + U.esc(p.real || "") + '">') +
                field("Birthday", '<input type="text" class="pers-bday" maxlength="5" placeholder="MM-DD" value="' + U.esc(p.bday || "") + '">') +
              "</div>" +
              '<div class="field-row">' +
                field("Hometown", '<input type="text" class="pers-home" maxlength="40" value="' + U.esc(p.hometown || "") + '">') +
                field("Partner name", '<input type="text" class="pers-pname" maxlength="30" value="' + U.esc((p.partner && p.partner.name) || "") + '">') +
                field("Partner club", '<input type="text" class="pers-pclub" maxlength="30" value="' + U.esc((p.partner && p.partner.club) || "") + '">') +
              "</div>" +
            "</div>";
          }).join("") +
        "</div>" +
        '<div class="admin-actions"><button class="btn btn-primary btn-small" id="pers-save">Save personal data</button><span class="admin-inline-note" id="pers-msg"></span></div>';

      function wireToggle(id, key) {
        var el = U.$("#" + id, root);
        if (!el) return;
        el.addEventListener("change", function () {
          var patch = {}; patch[key] = el.checked;
          NET.adminPersonal(patch).then(function (r) {
            if (r && r.ok) { U.toast(el.checked ? "Now showing on the site." : "Hidden again."); refreshConfig(); }
            else { el.checked = !el.checked; U.toast("Couldn't change that."); }
          });
        });
      }
      wireToggle("pers-bdays", "showBirthdays");
      wireToggle("pers-partners", "showPartners");

      var sv = U.$("#pers-save", mt);
      if (sv) sv.addEventListener("click", function () {
        var btn = this, msg = U.$("#pers-msg", mt);
        var list = U.$$(".pers-person", mt).map(function (row) {
          return {
            id: row.getAttribute("data-id"),
            real: row.querySelector(".pers-real").value.trim(),
            bday: row.querySelector(".pers-bday").value.trim(),
            hometown: row.querySelector(".pers-home").value.trim(),
            partner: { name: row.querySelector(".pers-pname").value.trim(), club: row.querySelector(".pers-pclub").value.trim() }
          };
        });
        btn.disabled = true; msg.textContent = "Saving…";
        NET.adminPersonal({ people: list }).then(function (r) {
          btn.disabled = false;
          msg.textContent = (r && r.ok) ? "✓ Saved" : "✗ " + ((r && r.error) || "failed");
          if (r && r.ok) refreshConfig();
        });
      });
    });
  }

  /* ========================================================
     WIRING
     ======================================================== */
  function newsRow(a) {
    a = a || {};
    return '<details class="news-edit-row"' + (a._new ? " open" : "") + ">" +
      "<summary>" + U.esc(a.tag || "CLUB") + " · " + U.esc(a.title || "(untitled)") + (a.pinned ? " 📌" : "") + "</summary>" +
      '<div class="field-row">' +
        field("Tag", '<input type="text" class="nw-tag" maxlength="20" value="' + U.esc(a.tag || "CLUB") + '">') +
        field("Date", '<input type="date" class="nw-date" value="' + U.esc(a.dateISO || a.date || "") + '">') +
      "</div>" +
      field("Title", '<input type="text" class="nw-title" maxlength="120" value="' + U.esc(a.title || "") + '">') +
      '<label class="field"><span class="field-label">Body</span><textarea class="nw-body" rows="4" maxlength="4000">' + U.esc(a.body || "") + "</textarea></label>" +
      '<div class="admin-actions"><label class="sq-check"><input type="checkbox" class="nw-pin"' + (a.pinned ? " checked" : "") + "> Pinned</label>" +
        '<button class="btn btn-ghost btn-small nw-del" type="button">✕ Remove</button></div>' +
    "</details>";
  }
  function blockNews(c) {
    var arts = (c.news && c.news.length) ? c.news : [];
    return block("The Gazette · club news",
      '<p class="admin-note">Post and edit club news, shown on the <a href="#news">News</a> page (pinned + newest first). Leave the list empty to fall back to the built-in stories.</p>' +
      '<div id="nw-list">' + arts.map(newsRow).join("") + "</div>" +
      '<div class="admin-actions"><button class="btn btn-gold btn-small" id="nw-add" type="button">+ New article</button>' +
        '<button class="btn btn-primary btn-small" id="nw-save">Save news</button>' +
        '<span class="admin-inline-note" id="nw-msg"></span></div>',
      "L5+");
  }
  function blockLeague(c) {
    var L = c.league || {};
    function f(id, lab, val, hint) { return field(lab, '<input type="text" id="' + id + '" maxlength="40" value="' + U.esc(val || "") + '">', hint); }
    return block("League &amp; division",
      '<p class="admin-note">The club’s current standing — shown on the Hub and atop Results. Form is letters, e.g. <code>W W D L W</code>.</p>' +
      '<div class="field-row">' + f("lg-div", "Division", L.division) + f("lg-rank", "Position", L.rank) + f("lg-pts", "Points", L.points) + f("lg-pld", "Played", L.played) + "</div>" +
      '<div class="field-row">' + f("lg-form", "Form", L.form, "e.g. W W D L W") + f("lg-status", "Status", L.status, "e.g. Promotion push") + "</div>" +
      f("lg-note", "Note", L.note) +
      '<div class="admin-actions"><button class="btn btn-primary btn-small" id="lg-save">Save league</button><span class="admin-inline-note" id="lg-msg"></span></div>',
      "L5+");
  }

  function blockSquad() {
    return block("Squad · players",
      '<p class="admin-note">Edit any player\u2019s identity, add a new one, or hide one who\u2019s left. Stats and match history are never touched \u2014 this is identity only. New players sit on the bench until their formation roles are set in the code.</p>' +
      '<div id="sq-view">' + U.emptyState("Loading the squad\u2026", "", "\uD83D\uDC65") + "</div>",
      "L5+");
  }

  function squadRow(p) {
    // `_justAdded` = added in this editing session (keep the box open once).
    // `isNew` = a config-only player (not in the base squad) — must persist so
    // the board materialises it, but that must NOT force the box open on reload.
    var justAdded = !!p._justAdded;
    var persistNew = !!(p.isNew || justAdded);
    var tags = (justAdded ? ' <span class="admin-inline-note">new</span>' : "") +
      (p.disabled ? ' <span class="level-chip level-mod">hidden</span>' : "") +
      (p.isCaptain ? ' <span class="level-chip level-admin">C</span>' : "");
    return '<details class="sq-row" data-id="' + U.esc(p.id) + '" data-new="' + (persistNew ? "1" : "") + '"' + (justAdded ? " open" : "") + ">" +
      "<summary>#" + (p.number || 0) + " " + U.esc(p.name) + " · " + U.esc(p.position || "") + tags + "</summary>" +
      '<div class="field-row">' +
        field("Name", '<input type="text" class="sq-name" maxlength="30" value="' + U.esc(p.name) + '">') +
        field("Number", '<input type="number" class="sq-number" min="0" max="99" value="' + (p.number || 0) + '">') +
        field("Positions", posSelects(p), "up to 3 — primary first; drives the tactics board") +
      "</div>" +
      '<div class="field-row">' +
        field("Controlled by", '<select class="sq-control"><option value="human"' + (p.controlledBy === "human" ? " selected" : "") + ">Human</option><option value=\"bot\"" + (p.controlledBy !== "human" ? " selected" : "") + ">Bot (AI)</option></select>") +
        field("Pronouns", '<input type="text" class="sq-pron" maxlength="12" value="' + U.esc(p.pronouns || "he/him") + '">') +
        field("Card image", '<input type="text" class="sq-card" maxlength="60" value="' + U.esc(p.card || "") + '">', "filename in assets/img") +
      "</div>" +
      '<label class="field"><span class="field-label">Flavour</span><textarea class="sq-flavour" rows="2" maxlength="400">' + U.esc(p.flavour || "") + "</textarea></label>" +
      '<div class="admin-actions sq-flags">' +
        '<label class="sq-check"><input type="checkbox" class="sq-captain"' + (p.isCaptain ? " checked" : "") + "> Captain</label>" +
        '<label class="sq-check"><input type="checkbox" class="sq-bench"' + (p.permaBench ? " checked" : "") + "> Permanent bench</label>" +
        '<label class="sq-check"><input type="checkbox" class="sq-disabled"' + (p.disabled ? " checked" : "") + "> Hidden from squad</label>" +
        '<label class="sq-check"><input type="checkbox" class="sq-retired"' + (p.retiredAI ? " checked" : "") + "> Retired · AI</label>" +
        (persistNew ? '<button class="btn btn-ghost btn-small sq-del" type="button">✕ Remove</button>' : "") +
      "</div>" +
    "</details>";
  }

  function renderSquadEditor() {
    var mt = U.$("#sq-view", root);
    if (!mt) return;
    var players = (window.SQUAD || []).slice().sort(function (a, b) { return (a.number || 0) - (b.number || 0); });
    mt.innerHTML =
      '<div id="sq-list">' + players.map(squadRow).join("") + "</div>" +
      '<div class="admin-actions">' +
        '<button class="btn btn-gold btn-small" id="sq-add" type="button">+ Add player</button>' +
        '<button class="btn btn-primary btn-small" id="sq-save">Save squad</button>' +
        '<span class="admin-inline-note" id="sq-msg"></span>' +
      "</div>";

    function wireDel(node) {
      var del = node.querySelector(".sq-del");
      if (del) del.addEventListener("click", function () { node.parentNode.removeChild(node); });
    }
    U.$$(".sq-row", mt).forEach(wireDel);

    U.$("#sq-add", mt).addEventListener("click", function () {
      var id = "p" + Date.now().toString(36);
      var tmp = document.createElement("div");
      tmp.innerHTML = squadRow({ id: id, name: "New Player", number: 0, positions: ["CM"], position: "CM", controlledBy: "bot", pronouns: "he/him", card: "", flavour: "", isNew: true, _justAdded: true });
      var node = tmp.firstElementChild;
      U.$("#sq-list", mt).appendChild(node);
      wireDel(node);
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    U.$("#sq-save", mt).addEventListener("click", function () {
      var btn = this, msg = U.$("#sq-msg", mt);
      var list = U.$$(".sq-row", mt).map(function (row) {
        function g(cls) { var el = row.querySelector("." + cls); return el ? el.value : ""; }
        function ck(cls) { var el = row.querySelector("." + cls); return el ? el.checked : false; }
        var id0 = row.getAttribute("data-id");
        var orig0 = (window.SQUAD || []).filter(function (pp) { return pp.id === id0; })[0] || {};
        var positions = [g("sq-pos1"), g("sq-pos2"), g("sq-pos3")].filter(function (x) { return !!x; });
        return {
          id: id0,
          name: g("sq-name"), number: g("sq-number"),
          positions: positions, position: positions[0] || "SUB",
          controlledBy: g("sq-control"), pronouns: g("sq-pron"), card: g("sq-card"),
          flavour: g("sq-flavour"),
          isCaptain: ck("sq-captain"), permaBench: ck("sq-bench"), disabled: ck("sq-disabled"),
          retiredAI: ck("sq-retired"), linkedTo: orig0.linkedTo || "",
          isNew: row.getAttribute("data-new") === "1"
        };
      });
      btn.disabled = true; msg.textContent = "Saving…";
      NET.adminSquad({ squad: list }).then(function (r) {
        btn.disabled = false;
        msg.textContent = (r && r.ok) ? "✓ Saved" : "✗ " + ((r && r.error) || "failed");
        if (r && r.ok) {
          U.toast("Squad updated.");
          refreshConfig().then(function () { renderSquadEditor(); });
        }
      });
    });
  }

  function bind(matches, career, record, baselineSeq, admin) {
    var b;

    /* match manager */
    b = U.$("#adm-match-new", root);
    if (b) b.addEventListener("click", function () { openEditor(null, matches); });
    bindMatchRows(matches);

    /* club record */
    b = U.$("#rec-save", root);
    if (b) b.addEventListener("click", function () {
      b.disabled = true;
      NET.recordSave({
        wins: U.$("#rec-w", root).value, draws: U.$("#rec-d", root).value, losses: U.$("#rec-l", root).value,
        played: U.$("#rec-p", root).value, goalsFor: U.$("#rec-gf", root).value, goalsAgainst: U.$("#rec-ga", root).value,
        leagueApps: U.$("#rec-la", root).value, playoffApps: U.$("#rec-pa", root).value,
        badge: U.$("#rec-badge", root).value
      }).then(function (r) {
        b.disabled = false;
        U.toast(r && r.ok ? "Baseline saved. History corrected." : "Couldn't save the record.");
        if (r && r.ok) DATA.bust();
      });
    });

    /* careers */
    b = U.$("#cr-save", root);
    if (b) b.addEventListener("click", function () {
      b.disabled = true;
      var rows = U.$$(".admin-career-row", root).map(function (row) {
        function v(cls) { return row.querySelector("." + cls).value; }
        return {
          id: row.getAttribute("data-id"),
          persona: v("cr-persona"), ovr: v("cr-ovr"),
          games: v("cr-games"), goals: v("cr-goals"), assists: v("cr-assists"),
          passesMade: v("cr-passes"), passPct: v("cr-passpct"),
          tackles: v("cr-tackles"), tacklePct: v("cr-tklpct"), winPct: v("cr-winpct")
        };
      });
      NET.careerSave(rows, U.$("#cr-baseline", root).value).then(function (r) {
        b.disabled = false;
        U.toast(r && r.ok ? "Careers saved." : "Couldn't save careers.");
        if (r && r.ok) DATA.bust();
      });
    });

    /* banner */
    b = U.$("#adm-banner-save", root);
    if (b) b.addEventListener("click", function () {
      b.disabled = true;
      NET.adminBanner(U.$("#adm-banner-text", root).value, U.$("#adm-banner-active", root).checked).then(function (r) {
        b.disabled = false;
        U.toast(r && r.ok ? "Banner saved." : "Couldn't save the banner.");
        if (r && r.ok) refreshConfig();
      });
    });

    /* lore */
    b = U.$("#adm-lore-save", root);
    if (b) b.addEventListener("click", function () {
      b.disabled = true;
      NET.adminLore(U.$("#adm-lore", root).value).then(function (r) {
        b.disabled = false;
        U.toast(r && r.ok ? "The lore is live." : "Couldn't publish.");
        if (r && r.ok) refreshConfig();
      });
    });
    b = U.$("#adm-lore-clear", root);
    if (b) b.addEventListener("click", function () {
      NET.adminLore("").then(function (r) {
        U.toast(r && r.ok ? "Vault re-sealed." : "Couldn't clear.");
        if (r && r.ok) { U.$("#adm-lore", root).value = ""; refreshConfig(); }
      });
    });

    /* users */
    renderUsers(admin);

    /* flavour */
    b = U.$("#adm-flavour-save", root);
    if (b) b.addEventListener("click", function () {
      b.disabled = true;
      NET.adminFlavour(U.$("#adm-flavour-id", root).value, U.$("#adm-flavour-text", root).value).then(function (r) {
        b.disabled = false;
        U.toast(r && r.ok ? "Flavour set." : "Couldn't set flavour.");
        if (r && r.ok) refreshConfig().then(function () { enter(root, helpers); });
      });
    });
    U.$$(".adm-flavour-clear", root).forEach(function (btn) {
      btn.addEventListener("click", function () {
        NET.adminFlavour(btn.getAttribute("data-id"), "").then(function (r) {
          if (r && r.ok) { U.toast("Flavour cleared."); refreshConfig().then(function () { enter(root, helpers); }); }
        });
      });
    });

    /* milestones */
    b = U.$("#adm-ms-add", root);
    if (b) b.addEventListener("click", function () {
      var d = U.$("#adm-ms-date", root).value;
      var t = U.$("#adm-ms-text", root).value.trim();
      if (!d || !t) { U.toast("Date and text, both."); return; }
      b.disabled = true;
      NET.adminMilestone({ action: "add", dateISO: d, text: t }).then(function (r) {
        b.disabled = false;
        U.toast(r && r.ok ? "Milestone carved in." : "Couldn't add it.");
        if (r && r.ok) refreshConfig().then(function () { enter(root, helpers); });
      });
    });
    U.$$(".adm-ms-del", root).forEach(function (btn) {
      btn.addEventListener("click", function () {
        NET.adminMilestone({ action: "del", id: btn.getAttribute("data-id") }).then(function (r) {
          if (r && r.ok) { U.toast("Milestone removed."); refreshConfig().then(function () { enter(root, helpers); }); }
        });
      });
    });

    /* fixtures */
    b = U.$("#fx-add", root);
    if (b) b.addEventListener("click", function () {
      var opp = U.$("#fx-opp", root).value.trim();
      var msg = U.$("#fx-msg", root);
      if (!opp) { msg.textContent = "Opponent needed."; return; }
      b.disabled = true; msg.textContent = "Adding…";
      NET.adminFixtures({
        action: "add", opponent: opp,
        stage: U.$("#fx-stage", root).value,
        dateISO: U.$("#fx-date", root).value,
        compName: U.$("#fx-compname", root).value.trim(),
        note: U.$("#fx-note", root).value.trim()
      }).then(function (r) {
        b.disabled = false; msg.textContent = "";
        if (r && r.ok) {
          U.toast("Fixture added.");
          U.$("#fx-opp", root).value = ""; U.$("#fx-compname", root).value = ""; U.$("#fx-note", root).value = "";
          reloadFixtures();
        } else msg.textContent = "✗ couldn't add";
      });
    });
    bindFixtureDels();

    /* socials (tiktok + twitch) */
    b = U.$("#soc-save", root);
    if (b) b.addEventListener("click", function () {
      b.disabled = true;
      var msg = U.$("#soc-msg", root);
      NET.adminSocials({ tiktok: U.$("#tt-handle", root).value, twitch: U.$("#tw-handle", root).value }).then(function (r) {
        b.disabled = false;
        msg.textContent = (r && r.ok) ? "✓ saved" : "✗ failed";
        if (r && r.ok) { U.toast("Socials saved."); refreshConfig(); }
      });
    });

    /* test twitch connection */
    b = U.$("#soc-test", root);
    if (b) b.addEventListener("click", function () {
      var out = U.$("#soc-test-out", root);
      b.disabled = true;
      out.innerHTML = '<p class="admin-inline-note">Asking Twitch…</p>';
      NET.twitchStatus().then(function (r) {
        b.disabled = false;
        function row(l) { return '<div class="admin-row"><span class="admin-row-main">' + U.esc(l) + "</span></div>"; }
        if (!r || (r.ok === false && r.error === "offline")) { out.innerHTML = row("Backend offline — try again in a moment."); return; }
        if (r.ok === false && r.error === "kind") { out.innerHTML = row("✗ This backend has no twitch_status endpoint yet — deploy the latest backend.gs."); return; }
        var lines = [
          "Channel checked: " + (r.handle || "—"),
          "Credentials set: " + (r.configured ? "yes ✓" : "NO — add TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET in Apps Script → Script Properties"),
          "Live right now: " + (r.live ? "YES ✓ — badge should show" : "no")
        ];
        if (r.reason) lines.push("Reason: " + r.reason);
        if (r.title) lines.push("Stream title: " + r.title);
        if (r.live && r.viewers != null) lines.push("Viewers: " + r.viewers);
        if (r.error) lines.push("Detail: " + r.error);
        out.innerHTML = lines.map(row).join("");
      });
    });

    /* fun & games */
    b = U.$("#fun-save", root);
    if (b) b.addEventListener("click", function () {
      b.disabled = true;
      var msg = U.$("#fun-msg", root);
      function lines(id) {
        return (U.$("#" + id, root).value || "").split("\n").map(function (s) { return s.trim(); }).filter(function (s) { return !!s; });
      }
      var fun = {
        gaffer: {
          names: lines("fun-gaffer-names"),
          quotes: lines("fun-gaffer-quotes"),
          pinned: (U.$("#fun-gaffer-pinned", root).value || "").trim()
        },
        chants: lines("fun-chants"),
        superlatives: lines("fun-superlatives"),
        oracle: lines("fun-oracle"),
        rumours: lines("fun-rumours"),
        rumourClubs: lines("fun-rumourClubs")
      };
      NET.adminFun({ action: "set", fun: fun }).then(function (r) {
        b.disabled = false;
        msg.textContent = (r && r.ok) ? "✓ saved" : "✗ " + ((r && r.error) || "failed");
        if (r && r.ok) { U.toast("Fun & Games saved."); refreshConfig(); }
      });
    });

    /* news (The Gazette) */
    function wireNewsDels() {
      U.$$(".nw-del", root).forEach(function (btn) {
        if (btn.getAttribute("data-wired")) return;
        btn.setAttribute("data-wired", "1");
        btn.addEventListener("click", function () {
          var d = btn.closest(".news-edit-row");
          if (d) d.parentNode.removeChild(d);
        });
      });
    }
    wireNewsDels();
    b = U.$("#nw-add", root);
    if (b) b.addEventListener("click", function () {
      var tmp = document.createElement("div");
      tmp.innerHTML = newsRow({ tag: "CLUB", dateISO: new Date().toISOString().slice(0, 10), _new: true });
      U.$("#nw-list", root).appendChild(tmp.firstElementChild);
      wireNewsDels();
    });
    b = U.$("#nw-save", root);
    if (b) b.addEventListener("click", function () {
      var btn = this, msg = U.$("#nw-msg", root);
      var list = U.$$(".news-edit-row", root).map(function (row) {
        function g(cls) { var el = row.querySelector("." + cls); return el ? el.value : ""; }
        return { tag: g("nw-tag"), dateISO: g("nw-date"), title: g("nw-title"), body: g("nw-body"), pinned: row.querySelector(".nw-pin").checked };
      }).filter(function (a) { return a.title || a.body; });
      btn.disabled = true; msg.textContent = "Saving…";
      NET.adminNews({ news: list }).then(function (r) {
        btn.disabled = false;
        msg.textContent = (r && r.ok) ? "✓ Saved" : "✗ " + ((r && r.error) || "failed");
        if (r && r.ok) { U.toast("News updated."); refreshConfig(); }
      });
    });

    /* league / division */
    b = U.$("#lg-save", root);
    if (b) b.addEventListener("click", function () {
      var btn = this;
      btn.disabled = true;
      NET.adminLeague({ league: {
        division: U.$("#lg-div", root).value, rank: U.$("#lg-rank", root).value, points: U.$("#lg-pts", root).value,
        played: U.$("#lg-pld", root).value, form: U.$("#lg-form", root).value, status: U.$("#lg-status", root).value, note: U.$("#lg-note", root).value
      } }).then(function (r) {
        btn.disabled = false;
        U.$("#lg-msg", root).textContent = (r && r.ok) ? "✓ saved" : "✗ failed";
        if (r && r.ok) { U.toast("League updated."); refreshConfig(); }
      });
    });

    /* season archive (L9) */
    b = U.$("#season-archive", root);
    if (b) b.addEventListener("click", function () {
      var btn = this, msg = U.$("#season-msg", root);
      var id = (U.$("#season-id", root).value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      var label = (U.$("#season-label", root).value || "").trim();
      if (!id) { msg.textContent = "New season id needed."; return; }
      if (btn.getAttribute("data-armed") !== "1") {
        btn.setAttribute("data-armed", "1");
        btn.textContent = "Sure? This archives the season";
        setTimeout(function () { btn.setAttribute("data-armed", ""); btn.textContent = "Archive season & start new"; }, 3500);
        return;
      }
      btn.disabled = true; msg.textContent = "Archiving…";
      NET.adminSeason({ action: "archive", newId: id, newLabel: label }).then(function (r) {
        btn.disabled = false; btn.setAttribute("data-armed", "");
        btn.textContent = "Archive season & start new";
        msg.textContent = (r && r.ok) ? "✓ archived" : "✗ " + ((r && r.error) || "failed");
        if (r && r.ok) { U.toast("Season archived. New season begins."); refreshConfig().then(function () { enter(root, helpers); }); }
      });
    });
  }

  function reloadFixtures() {
    refreshConfig().then(function (res) {
      var list = U.$("#fx-list", root);
      if (list) { list.innerHTML = fixtureListHtml((cfgFrom(res).fixtures) || []); bindFixtureDels(); }
    });
  }
  function bindFixtureDels() {
    U.$$(".fx-del", root).forEach(function (btn) {
      btn.addEventListener("click", function () {
        NET.adminFixtures({ action: "del", id: btn.getAttribute("data-id") }).then(function (r) {
          if (r && r.ok) { U.toast("Fixture removed."); reloadFixtures(); }
        });
      });
    });
  }

  function renderUsers(admin) {
    var mount = U.$("#adm-users", root);
    if (!mount) return;
    NET.adminUsers().then(function (res) {
      if (!mount.isConnected) return;
      if (!res || !res.ok) { mount.innerHTML = '<p class="admin-inline-note">Couldn\u2019t fetch the register.</p>'; return; }
      var users = res.users || [];
      mount.innerHTML =
        '<table class="opp-table admin-users-table"><thead><tr><th>Name</th><th>Level</th><th>Status</th>' + (admin ? "<th></th>" : "") + "</tr></thead><tbody>" +
        users.map(function (u) {
          var isMe = NET.me && u.name.toLowerCase() === NET.me.name.toLowerCase();
          var levelCell = admin && !isMe
            ? '<select class="adm-user-level" data-user="' + U.esc(u.name) + '">' +
                [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (l) {
                  return '<option value="' + l + '"' + (l === u.level ? " selected" : "") + ">" + l + (l >= 9 ? " · admin" : l >= 5 ? " · mod" : "") + "</option>";
                }).join("") + "</select>"
            : String(u.level) + (u.level >= 9 ? " · admin" : u.level >= 5 ? " · mod" : "");
          var status = u.banned ? '<span class="admin-banned">banned</span>' : "active";
          var actions = admin && !isMe
            ? (u.banned
                ? '<button class="btn btn-ghost btn-small adm-user-unban" data-user="' + U.esc(u.name) + '">Unban</button>'
                : '<button class="btn btn-ghost btn-small adm-user-ban" data-user="' + U.esc(u.name) + '">Ban</button>')
            : (isMe ? '<span class="admin-inline-note">you</span>' : "");
          return "<tr><td>" + U.esc(u.name) + "</td><td>" + levelCell + "</td><td>" + status + "</td>" + (admin ? "<td>" + actions + "</td>" : "") + "</tr>";
        }).join("") + "</tbody></table>";

      U.$$(".adm-user-level", mount).forEach(function (sel) {
        sel.addEventListener("change", function () {
          NET.adminSetLevel(sel.getAttribute("data-user"), Number(sel.value)).then(function (r) {
            U.toast(r && r.ok ? "Level updated." : "Couldn't change that.");
            if (!(r && r.ok)) renderUsers(admin);
          });
        });
      });
      U.$$(".adm-user-ban", mount).forEach(function (btn) {
        btn.addEventListener("click", function () {
          NET.adminBan(btn.getAttribute("data-user")).then(function (r) {
            U.toast(r && r.ok ? "Banned. The door is shut." : "Couldn't ban.");
            renderUsers(admin);
          });
        });
      });
      U.$$(".adm-user-unban", mount).forEach(function (btn) {
        btn.addEventListener("click", function () {
          NET.adminUnban(btn.getAttribute("data-user")).then(function (r) {
            U.toast(r && r.ok ? "Unbanned. Welcome back." : "Couldn't unban.");
            renderUsers(admin);
          });
        });
      });
    });
  }

  window.ADMIN = { enter: enter };
})();
