/* ============================================================
   The 40Yr Virgil — Housekeeping console  v2 "The Ledger"
   ------------------------------------------------------------
   The archive is managed here, game by game.
     L5+ (mods)  · add matches, edit any match + per-player stats
     L9 (admin)  · delete matches, career baselines, club record,
                   banner, lore, users, flavour, milestones
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
      .map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === selected ? " selected" : "") + ">#" + p.number + " " + U.esc(p.name) + "</option>";
      }).join("");
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
        (admin ? blockRecord(record) : "") +
        (admin ? blockCareer(career, baselineSeq) : "") +
        blockBanner(c, admin) +
        (admin ? blockLore(c) : "") +
        blockUsers(admin) +
        (admin ? blockFlavour(c) : "") +
        (admin ? blockMilestones(c) : "") +
        blockChatNote();

      bind(matches, career, record, baselineSeq, admin);

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
    m = m || { seq: 0, stage: "league", dateISO: "", opponent: "", ourScore: 0, theirScore: 0, result: "", scorers: [], note: "", players: [] };

    box.innerHTML =
      '<div class="match-editor" id="me-box">' +
        '<div class="me-head">' + (isNew ? "New match — Match " + (maxSeq(matches) + 1) : "Editing Match " + m.seq) + "</div>" +
        '<div class="field-row">' +
          field("Opponent", '<input type="text" id="me-opp" maxlength="60" value="' + U.esc(m.opponent) + '">') +
          field("Stage",
            '<select id="me-stage">' +
              ["league", "playoff", "friendly"].map(function (s) {
                return '<option value="' + s + '"' + (m.stage === s ? " selected" : "") + ">" + s.charAt(0).toUpperCase() + s.slice(1) + "</option>";
              }).join("") +
            "</select>") +
          field("Date", '<input type="date" id="me-date" value="' + U.esc(m.dateISO || "") + '">', "optional") +
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
        '<div class="section-label">Scorers</div>' +
        '<div id="me-scorers"></div>' +
        '<button class="btn btn-ghost btn-small" id="me-scorer-add" type="button">+ Add scorer</button>' +
        '<div class="section-label">Per-player stats <span class="admin-inline-note">optional — these keep careers ticking</span></div>' +
        '<div id="me-players"></div>' +
        '<button class="btn btn-ghost btn-small" id="me-player-add" type="button">+ Add player line</button>' +
        field("Match note", '<input type="text" id="me-note" maxlength="200" value="' + U.esc(m.note || "") + '">', "one line for the books") +
        '<div class="admin-actions">' +
          '<button class="btn btn-primary btn-small" id="me-save">' + (isNew ? "Add to the ledger" : "Save changes") + "</button>" +
          '<button class="btn btn-ghost btn-small" id="me-cancel" type="button">Cancel</button>' +
          '<span class="admin-inline-note" id="me-msg"></span>' +
        "</div>" +
      "</div>";

    (m.scorers || []).forEach(function (s) { addScorerRow(s.id, s.goals); });
    (m.players || []).forEach(function (p) { addPlayerRow(p); });

    U.$("#me-scorer-add", box).addEventListener("click", function () { addScorerRow("", 1); });
    U.$("#me-player-add", box).addEventListener("click", function () { addPlayerRow(null); });
    U.$("#me-cancel", box).addEventListener("click", function () { box.innerHTML = ""; });

    U.$("#me-save", box).addEventListener("click", function () {
      var btn = this;
      var payload = {
        seq: isNew ? 0 : m.seq,
        stage: U.$("#me-stage", box).value,
        dateISO: U.$("#me-date", box).value,
        opponent: U.$("#me-opp", box).value.trim(),
        ourScore: U.$("#me-our", box).value,
        theirScore: U.$("#me-their", box).value,
        result: U.$("#me-result", box).value,
        note: U.$("#me-note", box).value,
        scorers: U.$$(".me-scorer", box).map(function (row) {
          return { id: row.querySelector("select").value, goals: row.querySelector("input").value };
        }).filter(function (s) { return s.id; }),
        players: U.$$(".me-player", box).map(function (row) {
          var g = function (cls) { return row.querySelector("." + cls).value; };
          return {
            id: row.querySelector("select").value,
            goals: g("mp-g"), assists: g("mp-a"), rating: g("mp-r"),
            shots: g("mp-sh"), tackles: g("mp-tk"),
            passesMade: g("mp-pm"), passAttempts: g("mp-pa"), redCards: g("mp-rc")
          };
        }).filter(function (p) { return p.id; })
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

    function addScorerRow(id, goals) {
      var mountS = U.$("#me-scorers", box);
      var row = document.createElement("div");
      row.className = "field-row me-scorer";
      row.innerHTML =
        '<label class="field"><span class="field-label">Player</span><select>' + playerOptions(id) + "</select></label>" +
        '<label class="field me-narrow"><span class="field-label">Goals</span><input type="number" min="1" max="20" value="' + (goals || 1) + '"></label>' +
        '<button class="btn btn-ghost btn-small me-row-del" type="button">✕</button>';
      row.querySelector(".me-row-del").addEventListener("click", function () { row.remove(); });
      mountS.appendChild(row);
    }

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
  function blockBanner(c, admin) {
    if (!admin) return "";
    var b = c.banner || { text: "", active: false };
    return block("Announcement banner",
      field("Banner text", '<input type="text" id="adm-banner-text" maxlength="160" value="' + U.esc(b.text || "") + '">') +
      '<label class="field field-check"><input type="checkbox" id="adm-banner-active"' + (b.active ? " checked" : "") + "> Banner is live</label>" +
      '<div class="admin-actions"><button class="btn btn-primary btn-small" id="adm-banner-save">Save banner</button></div>',
      "L9");
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
      "L9");
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
      "L9");
  }

  function blockChatNote() {
    return block("Chat moderation",
      '<p class="admin-note">Stewards see a ✕ on every message in <a href="#chat">the chat</a>. The server filters the worst words on its own.</p>',
      "L5+");
  }

  /* ========================================================
     WIRING
     ======================================================== */
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
