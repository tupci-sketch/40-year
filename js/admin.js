/* ============================================================
   The 40Yr Virgil — Housekeeping v2 (Cloudflare backend)
   ------------------------------------------------------------
   Routed sub-pages instead of one giant scroll — built mobile
   -first / iOS-Safari-capable: dynamic-viewport safe areas, 16px
   inputs (no zoom-on-focus), big tap targets, a sticky save bar.
     L5+ : matches, fixtures, squad, gaffers, news, banner
     L7+ : player-card uploads
     L9  : delete matches, seasons, baselines, users, titles,
           identities, DM reports, settings
   The server re-checks every level on every write; this file only
   decides what to draw.
   ============================================================ */
(function () {
  "use strict";

  var U = null, NET = null, root = null, helpers = {};
  var currentTab = "matches";
  var cache = {}; // last-loaded lists, for cross-references (fixtures for settle picker, etc.)

  // Housekeeping is a real admin panel: a grouped sidebar of sub-menus + a
  // content pane, not a side-to-side wheel of buttons. [key, label, icon,
  // minLevel, blurb].
  var GROUPS = [
    { name: "Matchday", items: [
      ["matches", "Matches", "⚽", 5, "Results, teamsheets & MOTM"],
      ["fixtures", "Fixtures", "📅", 5, "Upcoming games & sessions"],
      ["gaffers", "Gaffers", "🎩", 5, "Manage the dugout"]
    ] },
    { name: "The Club", items: [
      ["squad", "Squad & Cards", "👕", 5, "Players, positions & card uploads"],
      ["seasons", "Seasons", "🗓️", 9, "Labels, current & archived"],
      ["news", "News", "📰", 5, "Publish to the Gazette"]
    ] },
    { name: "Community", items: [
      ["users", "Users", "👥", 5, "Levels, bans & player links"],
      ["points", "Points", "🪙", 9, "Add, remove or set balances"],
      ["titles", "Titles", "🏷️", 9, "Create & assign titles"],
      ["moderation", "Moderation", "🛡️", 9, "Reported content"]
    ] },
    { name: "System", items: [
      ["settings", "Settings", "⚙️", 9, "Banner, league & socials"]
    ] }
  ];
  function tabMeta(key) {
    for (var g = 0; g < GROUPS.length; g++) { for (var i = 0; i < GROUPS[g].items.length; i++) { if (GROUPS[g].items[i][0] === key) return GROUPS[g].items[i]; } }
    return null;
  }

  function field(label, inner, hint) {
    return '<label class="field"><span class="field-label">' + label + "</span>" + inner + (hint ? '<span class="field-hint">' + hint + "</span>" : "") + "</label>";
  }
  function esc(s) { return U.esc(s); }

  /* ---------- entry ---------- */
  function enter(container, h) {
    U = window.UI; NET = window.NET; helpers = h || helpers;
    root = container;
    if (!NET.isMod()) { root.innerHTML = '<div class="panel admin-gate"><p>Checking access…</p></div>'; return; }
    var lvl = NET.isAdmin() ? 9 : 5;

    // Grouped sidebar of sub-menus.
    var navHtml = GROUPS.map(function (grp) {
      var items = grp.items.filter(function (t) { return t[3] <= lvl; });
      if (!items.length) return "";
      return '<div class="admin-nav-group"><span class="admin-nav-glabel">' + esc(grp.name) + "</span>" +
        items.map(function (t) {
          return '<button class="admin-nav-item' + (t[0] === currentTab ? " active" : "") + '" data-tab="' + t[0] + '">' +
            '<span class="admin-nav-ic">' + t[2] + '</span><span class="admin-nav-text"><span class="admin-nav-name">' + esc(t[1]) +
            '</span><span class="admin-nav-blurb">' + esc(t[4]) + "</span></span></button>";
        }).join("") + "</div>";
    }).join("");

    root.innerHTML = '<div class="admin-panel">' +
      '<aside class="admin-nav" id="admin-nav"><div class="admin-nav-head">🗝 Housekeeping</div>' + navHtml + "</aside>" +
      '<section class="admin-content" id="admin-content">' +
        '<div class="admin-content-head"><button class="btn btn-ghost btn-small admin-back" id="admin-back">☰ Menu</button>' +
          '<h2 class="admin-content-title" id="admin-content-title"></h2></div>' +
        '<div id="admin-body" class="admin-body"></div>' +
      "</section>" +
    "</div>";

    U.$$(".admin-nav-item", root).forEach(function (b) {
      b.addEventListener("click", function () { selectTab(b.getAttribute("data-tab")); });
    });
    U.$("#admin-back", root).addEventListener("click", function () {
      root.querySelector(".admin-panel").setAttribute("data-view", "menu");
    });
    // Prep the current section, but land on the menu first (matters on mobile;
    // desktop shows the sidebar + content side by side regardless).
    selectTab(currentTab, true);
    root.querySelector(".admin-panel").setAttribute("data-view", "menu");
  }

  /* Switch section without a full re-render: update the active nav item, the
     content title, and the body. On narrow screens, slide from menu to content. */
  function selectTab(tab, initial) {
    currentTab = tab;
    var meta = tabMeta(tab) || ["", tab, "", 5, ""];
    U.$$(".admin-nav-item", root).forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === tab); });
    var titleEl = U.$("#admin-content-title", root);
    if (titleEl) titleEl.innerHTML = '<span class="admin-title-ic">' + meta[2] + "</span> " + esc(meta[1]);
    root.querySelector(".admin-panel").setAttribute("data-view", "content");
    if (!initial) { var c = U.$("#admin-content", root); if (c && c.scrollIntoView) c.scrollIntoView({ block: "start", behavior: "smooth" }); }
    renderTab(tab);
  }

  function renderTab(tab) {
    var body = U.$("#admin-body", root);
    body.innerHTML = U.emptyState("Loading…", "", "🗝");
    var fn = { matches: renderMatches, fixtures: renderFixtures, squad: renderSquad, gaffers: renderGaffers,
      news: renderNews, seasons: renderSeasons, users: renderUsers, points: renderPoints, titles: renderTitles,
      moderation: renderModeration, settings: renderSettings }[tab];
    if (fn) fn(body);
  }

  function saveBar(id, label) {
    return '<div class="admin-savebar"><button class="btn btn-primary btn-small" id="' + id + '">' + label + '</button><span class="admin-inline-note" id="' + id + '-msg"></span></div>';
  }

  /* ============================================================
     MATCHES
     ============================================================ */
  function renderMatches(body) {
    NET.matches({ limit: 30 }).then(function (res) {
      var matches = (res && res.matches) || [];
      body.innerHTML =
        '<div class="admin-actions"><button class="btn btn-gold btn-small" id="adm-match-new">+ Log a new match</button></div>' +
        '<div id="adm-match-editor"></div>' +
        '<div class="admin-sublist">' + matches.map(function (m) {
          return '<div class="admin-row"><span class="admin-row-main">' + U.pill(m.result) + " " + esc(m.opponent) + " " + m.our_score + "–" + m.their_score +
            '</span><button class="btn btn-ghost btn-small adm-match-edit" data-id="' + m.id + '">Edit</button></div>';
        }).join("");
      U.$("#adm-match-new", body).addEventListener("click", function () { openMatchEditor(null); });
      U.$$(".adm-match-edit", body).forEach(function (btn) {
        btn.addEventListener("click", function () {
          NET.match(btn.getAttribute("data-id")).then(function (r) { if (r && r.ok) openMatchEditor(r); });
        });
      });
      var jump = null;
      try { jump = sessionStorage.getItem("v40.editseq"); sessionStorage.removeItem("v40.editseq"); } catch (e) {}
      if (jump) NET.match(jump).then(function (r) { if (r && r.ok) openMatchEditor(r); });
    });
  }

  function formationOptions(sel) {
    return Object.keys(window.FORMATIONS).map(function (k) { return '<option value="' + k + '"' + (k === sel ? " selected" : "") + ">" + k + "</option>"; }).join("");
  }
  function playerOptions(sel) {
    return '<option value="">—</option>' + (window.SQUAD || []).slice().sort(function (a, b) { return a.number - b.number; }).map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === sel ? " selected" : "") + ">#" + p.number + " " + esc(p.name) + "</option>";
    }).join("");
  }

  function openMatchEditor(existing) {
    var box = U.$("#adm-match-editor", root);
    var isNew = !existing;
    var m = (existing && existing.match) || { id: 0, stage: "league", date_iso: "", opponent: "", our_score: 0, their_score: 0, result: "" };
    var stats = (existing && existing.stats) || [];
    var scorers = (existing && existing.scorers) || [];
    var lineup = (existing && existing.lineup) || null;
    var gaffers = (existing && existing.gaffers) || [];
    var STAGES = ["league", "playoff", "cup", "friendly", "international", "other"];

    NET.gaffers().then(function (gr) {
      var gafferList = (gr && gr.gaffers) || [];
      box.innerHTML =
        '<div class="match-editor" id="me-box">' +
          '<div class="me-head">' + (isNew ? "New match" : "Editing Match " + m.id) + "</div>" +
          '<div class="field-row">' +
            field("Opponent", '<input type="text" id="me-opp" maxlength="60" value="' + esc(m.opponent || "") + '">') +
            field("Type", '<select id="me-stage">' + STAGES.map(function (s) { return '<option value="' + s + '"' + (m.stage === s ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select>") +
            field("Date", '<input type="date" id="me-date" value="' + esc(m.date_iso || "") + '">') +
          "</div>" +
          '<div class="field-row">' +
            field("Comp name", '<input type="text" id="me-compname" maxlength="50" value="' + esc(m.comp_name || "") + '">') +
          "</div>" +
          '<div class="field-row">' +
            field("Our score", '<input type="number" id="me-our" min="0" max="99" value="' + (m.our_score != null ? m.our_score : 0) + '">') +
            field("Their score", '<input type="number" id="me-their" min="0" max="99" value="' + (m.their_score != null ? m.their_score : 0) + '">') +
            field("Result", '<select id="me-result"><option value="">Auto</option>' + ["W", "D", "L"].map(function (r) { return '<option value="' + r + '"' + (m.result === r ? " selected" : "") + ">" + r + "</option>"; }).join("") + "</select>") +
          "</div>" +
          '<div class="section-label">Teamsheet</div>' +
          '<div class="field-row">' +
            field("Formation", '<select id="me-formation">' + formationOptions((lineup && lineup.formation) || window.DEFAULT_FORMATION) + "</select>") +
            field("Venue", '<select id="me-venue"><option value="">—</option><option value="H"' + (m.venue === "H" ? " selected" : "") + ">Home</option><option value=\"A\"" + (m.venue === "A" ? " selected" : "") + ">Away</option><option value=\"N\"" + (m.venue === "N" ? " selected" : "") + ">Neutral</option></select>") +
          "</div>" +
          '<div class="me-teamsheet" id="me-xi"></div>' +
          '<div class="admin-actions"><button class="btn btn-ghost btn-small" id="me-xi-auto" type="button">Auto-pick XI</button></div>' +
          '<div class="field-row">' +
            field("Captain", '<select id="me-captain">' + playerOptions(m.captain_player_id || (lineup && lineup.captain_player_id)) + "</select>") +
            field("Man of the Match", '<select id="me-motm">' + playerOptions(m.motm_player_id) + "</select>") +
          "</div>" +
          '<div class="section-label">Gaffer(s) <span class="admin-inline-note">who managed this game</span></div>' +
          '<div class="field-row">' +
            field("Gaffer", '<select id="me-gaffer"><option value="">—</option>' + gafferList.map(function (g) { return '<option value="' + g.id + '"' + (gaffers[0] && gaffers[0].gaffer_id === g.id ? " selected" : "") + ">" + esc(g.name) + "</option>"; }).join("") +
              '<option value="__new">+ New gaffer…</option></select>') +
            field("Or new gaffer name", '<input type="text" id="me-gaffer-new" maxlength="60" placeholder="e.g. The Hairdryer">') +
          "</div>" +
          '<div class="section-label">Players <span class="admin-inline-note">one line per player involved</span></div>' +
          '<div id="me-players"></div>' +
          '<button class="btn btn-ghost btn-small" id="me-player-add" type="button">+ Add player</button>' +
          field("Match note", '<input type="text" id="me-note" maxlength="200" value="' + esc(m.note || "") + '">') +
          settleField() +
          '<div class="admin-actions">' +
            '<button class="btn btn-primary btn-small" id="me-save">' + (isNew ? "Add to the ledger" : "Save changes") + "</button>" +
            '<button class="btn btn-ghost btn-small" id="me-cancel" type="button">Cancel</button>' +
            (!isNew && NET.isAdmin() ? '<button class="btn btn-ghost btn-small" id="me-delete" type="button">Delete (admin)</button>' : "") +
            '<span class="admin-inline-note" id="me-msg"></span>' +
          "</div>" +
        "</div>";

      var seedPlayers = stats.map(function (s) { return { id: s.player_id, goals: s.goals, assists: s.assists, rating: s.rating, shots: s.shots, tackles: s.tackles, passesMade: s.passes_made, passAttempts: s.pass_attempts, redCards: s.red_cards, saves: s.saves, conceded: s.conceded }; });
      var haveIds = {}; seedPlayers.forEach(function (p) { haveIds[p.id] = 1; });
      scorers.forEach(function (s) { if (!haveIds[s.player_id]) { seedPlayers.push({ id: s.player_id, goals: s.goals }); haveIds[s.player_id] = 1; } });
      seedPlayers.forEach(addPlayerRow);

      U.$("#me-player-add", box).addEventListener("click", function () { addPlayerRow(null); });
      U.$("#me-cancel", box).addEventListener("click", function () { box.innerHTML = ""; });

      function renderXI(fkey, seedXi) {
        var f = window.FORMATIONS[fkey];
        if (!f) return;
        var byIdx = {};
        (seedXi || []).forEach(function (x, i) { byIdx[i] = x.id; });
        U.$("#me-xi", box).innerHTML = f.slots.map(function (s, i) {
          return '<label class="field me-xi-field"><span class="field-label">' + s.pos + '</span><select class="me-xi-sel" data-pos="' + s.pos + '">' + playerOptions(byIdx[i] || "") + "</select></label>";
        }).join("");
      }
      renderXI(U.$("#me-formation", box).value, (lineup && lineup.players && lineup.players.filter(function (p) { return !p.is_sub; })) || []);
      U.$("#me-formation", box).addEventListener("change", function () { renderXI(this.value, []); });
      U.$("#me-xi-auto", box).addEventListener("click", function () {
        var fkey = U.$("#me-formation", box).value;
        renderXI(fkey, autoXI(fkey).map(function (id) { return { id: id }; }));
      });

      U.$("#me-save", box).addEventListener("click", function () {
        var btn = this;
        var players = U.$$(".me-player", box).map(function (row) {
          var g = function (cls) { return row.querySelector("." + cls).value; };
          return { id: row.querySelector("select").value, goals: g("mp-g"), assists: g("mp-a"), rating: g("mp-r"),
            shots: g("mp-sh"), tackles: g("mp-tk"), passesMade: g("mp-pm"), passAttempts: g("mp-pa"), redCards: g("mp-rc"),
            saves: g("mp-sv"), conceded: g("mp-cn") };
        }).filter(function (p) { return p.id; });
        var xi = U.$$(".me-xi-sel", box).map(function (sel) { return { id: sel.value, pos: sel.getAttribute("data-pos") }; }).filter(function (x) { return x.id; });
        var inXi = {}; xi.forEach(function (x) { inXi[x.id] = 1; });
        var subs = players.map(function (p) { return p.id; }).filter(function (id) { return !inXi[id]; });

        var gafferSel = U.$("#me-gaffer", box).value;
        var gafferNewName = U.$("#me-gaffer-new", box).value.trim();
        var gafferPayload = [];
        if (gafferSel === "__new" && gafferNewName) gafferPayload.push({ name: gafferNewName, primary: true });
        else if (gafferSel) gafferPayload.push({ id: parseInt(gafferSel, 10), primary: true });

        var settleSel = U.$("#me-settle", box);
        var payload = {
          id: isNew ? 0 : m.id, stage: U.$("#me-stage", box).value, compName: U.$("#me-compname", box).value.trim(),
          dateISO: U.$("#me-date", box).value, opponent: U.$("#me-opp", box).value.trim(),
          ourScore: U.$("#me-our", box).value, theirScore: U.$("#me-their", box).value, result: U.$("#me-result", box).value,
          note: U.$("#me-note", box).value, players: players,
          lineup: { formation: U.$("#me-formation", box).value, xi: xi, subs: subs, captain: U.$("#me-captain", box).value },
          motm: U.$("#me-motm", box).value, venue: U.$("#me-venue", box).value, gaffers: gafferPayload,
          settleFixtureId: settleSel && settleSel.value ? settleSel.value : undefined
        };
        var msg = U.$("#me-msg", box);
        if (!payload.opponent) { msg.textContent = "Opponent needed."; return; }
        btn.disabled = true; msg.textContent = "Writing to the ledger…";
        NET.adminMatchSave(payload).then(function (r) {
          btn.disabled = false;
          if (r && r.ok) { U.toast(isNew ? "Match " + r.id + " is in the books." : "Match " + r.id + " updated."); box.innerHTML = ""; renderTab("matches"); }
          else msg.textContent = "✗ " + ((r && r.code) || "Couldn't save.");
        });
      });

      var delBtn = U.$("#me-delete", box);
      if (delBtn) delBtn.addEventListener("click", function () {
        if (!confirm("Delete match " + m.id + "? This cannot be undone.")) return;
        NET.adminMatchDelete(m.id).then(function (r) { if (r && r.ok) { U.toast("Match deleted."); box.innerHTML = ""; renderTab("matches"); } });
      });

      box.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    function addPlayerRow(p) {
      p = p || {};
      var mountP = U.$("#me-players", box);
      var row = document.createElement("div");
      row.className = "me-player";
      function n(v) { return v == null || v === "" ? "" : v; }
      function mini(label, cls, val, step) {
        return '<label class="me-mini"><span>' + label + '</span><input class="' + cls + '" type="number" min="0" inputmode="decimal" ' +
          (step ? 'step="' + step + '" max="10"' : 'max="999"') + ' value="' + (val === "" ? "" : val) + '" placeholder="0"></label>';
      }
      row.innerHTML =
        '<div class="field-row"><label class="field"><span class="field-label">Player</span><select>' + playerOptions(p.id) + "</select></label>" +
          '<button class="btn btn-ghost btn-small me-row-del" type="button">✕</button></div>' +
        '<div class="me-statgrid">' +
          mini("G", "mp-g", n(p.goals)) + mini("A", "mp-a", n(p.assists)) + mini("Rating", "mp-r", n(p.rating), "0.1") +
          mini("Shots", "mp-sh", n(p.shots)) + mini("Tackles", "mp-tk", n(p.tackles)) + mini("Passes", "mp-pm", n(p.passesMade)) +
          mini("Attempts", "mp-pa", n(p.passAttempts)) + mini("Reds", "mp-rc", n(p.redCards)) +
          mini("Saves", "mp-sv gk-stat", n(p.saves)) + mini("Conceded", "mp-cn gk-stat", n(p.conceded)) +
        "</div>";
      row.querySelector(".me-row-del").addEventListener("click", function () { row.remove(); });
      mountP.appendChild(row);
    }
  }

  function settleField() {
    var fx = (cache.fixtures || []).filter(function (f) { return f.kind !== "session"; });
    var opts = '<option value="">— none —</option>' + fx.map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.opponent || "TBC") + "</option>"; }).join("");
    return field("Settle predictions for", '<select id="me-settle">' + opts + "</select>", "scores that fixture's Matchday predictions, then clears it");
  }

  function autoXI(fkey) {
    var f = window.FORMATIONS[fkey];
    var players = (window.SQUAD || []).filter(function (p) { return !p.permaBench; });
    var byId = {}; players.forEach(function (p) { byId[p.id] = p; });
    var out = f.slots.map(function () { return ""; });
    var used = {};
    var camIdx = -1;
    f.slots.forEach(function (s, i) { if (camIdx === -1 && U.canonPos(s.pos) === "CAM") camIdx = i; });
    if (camIdx !== -1 && byId.tupci) { out[camIdx] = "tupci"; used.tupci = 1; }
    var ids = players.map(function (p) { return p.id; });
    ["exact", "group"].forEach(function (level) {
      f.slots.forEach(function (s, i) { if (out[i]) return; for (var k = 0; k < ids.length; k++) { var id = ids[k]; if (!used[id] && U.posFit(byId[id], s.pos) === level) { out[i] = id; used[id] = 1; break; } } });
    });
    f.slots.forEach(function (s, i) { if (out[i]) return; for (var k = 0; k < ids.length; k++) { var id = ids[k]; if (!used[id]) { out[i] = id; used[id] = 1; break; } } });
    return out;
  }

  /* ============================================================
     FIXTURES
     ============================================================ */
  function renderFixtures(body) {
    NET.fixtures().then(function (res) {
      var fx = (res && res.fixtures) || [];
      cache.fixtures = fx;
      body.innerHTML =
        '<div class="panel">' +
          '<div class="field-row">' +
            field("Kind", '<select id="fx-kind"><option value="match">Match</option><option value="session">Session</option></select>') +
            field("Opponent", '<input type="text" id="fx-opp" maxlength="60">') +
          "</div>" +
          '<div class="field-row">' +
            field("Type", '<select id="fx-stage"><option value="league">League</option><option value="playoff">Playoff</option><option value="cup">Cup</option><option value="friendly">Friendly</option></select>') +
            field("Date", '<input type="date" id="fx-date">') +
          "</div>" +
          field("Note", '<input type="text" id="fx-note" maxlength="140">') +
          '<div class="admin-actions"><button class="btn btn-gold btn-small" id="fx-add">+ Add fixture</button><span class="admin-inline-note" id="fx-msg"></span></div>' +
        "</div>" +
        '<div class="admin-sublist">' + fx.map(function (f) {
          return '<div class="admin-row"><span class="admin-row-main">' + esc(f.opponent || "Session") + " · " + (f.date_iso || "TBC") + '</span><button class="btn btn-ghost btn-small fx-del" data-id="' + esc(f.id) + '">Delete</button></div>';
        }).join("");
      U.$("#fx-add", body).addEventListener("click", function () {
        var opp = U.$("#fx-opp", body).value.trim();
        NET.adminFixtureAdd({ kind: U.$("#fx-kind", body).value, opponent: opp, stage: U.$("#fx-stage", body).value, dateISO: U.$("#fx-date", body).value, note: U.$("#fx-note", body).value.trim() })
          .then(function (r) { if (r && r.ok) { U.toast("Fixture added."); renderTab("fixtures"); } else U.$("#fx-msg", body).textContent = "✗ couldn't add"; });
      });
      U.$$(".fx-del", body).forEach(function (btn) {
        btn.addEventListener("click", function () { NET.adminFixtureDel(btn.getAttribute("data-id")).then(function () { renderTab("fixtures"); }); });
      });
    });
  }

  /* ============================================================
     SQUAD & PLAYER CARDS
     ============================================================ */
  function renderSquad(body) {
    NET.squad().then(function (res) {
      var squad = (res && res.squad) || [];
      window.SQUAD = squad;
      body.innerHTML =
        '<div class="panel">' +
          '<div class="section-label">Add / edit a player</div>' +
          '<div class="field-row">' + field("ID", '<input type="text" id="sq-id" maxlength="24" placeholder="e.g. amy">') + field("Name", '<input type="text" id="sq-name" maxlength="40">') + field("Number", '<input type="number" id="sq-number" min="0" max="99">') + "</div>" +
          '<div class="field-row">' + field("Controlled by", '<select id="sq-control"><option value="bot">Bot</option><option value="human">Human</option></select>') +
            field("Positions (up to 3)", '<input type="text" id="sq-positions" placeholder="ST,CAM,CM">') + "</div>" +
          field("Flavour", '<textarea id="sq-flavour" rows="2" maxlength="400"></textarea>') +
          '<div class="admin-actions"><button class="btn btn-gold btn-small" id="sq-save">Save player</button><span class="admin-inline-note" id="sq-msg"></span></div>' +
        "</div>" +
        '<div class="section-label">Squad</div>' +
        '<div class="admin-sublist">' + squad.map(function (p) {
          return '<div class="admin-row"><span class="admin-row-main">#' + p.number + " " + esc(p.name) + " · " + (p.positions || []).join("/") + '</span>' +
            '<button class="btn btn-ghost btn-small sq-edit" data-id="' + p.id + '">Edit</button>' +
            (NET.isUploader() ? '<button class="btn btn-ghost btn-small sq-card" data-id="' + p.id + '">Card</button>' : "") +
            (NET.isAdmin() ? '<button class="btn btn-ghost btn-small sq-del" data-id="' + p.id + '">Deactivate</button>' : "") +
          "</div>";
        }).join("") + '<div id="sq-card-box"></div>';
      U.$("#sq-save", body).addEventListener("click", function () {
        var positions = U.$("#sq-positions", body).value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        var payload = { id: U.$("#sq-id", body).value.trim(), name: U.$("#sq-name", body).value.trim(), number: U.$("#sq-number", body).value,
          controlledBy: U.$("#sq-control", body).value, positions: positions, flavour: U.$("#sq-flavour", body).value.trim() };
        if (!payload.name) { U.$("#sq-msg", body).textContent = "Name needed."; return; }
        NET.adminPlayerSave(payload).then(function (r) { if (r && r.ok) { U.toast("Player saved."); renderTab("squad"); } else U.$("#sq-msg", body).textContent = "✗ couldn't save"; });
      });
      U.$$(".sq-edit", body).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var p = squad.filter(function (x) { return x.id === btn.getAttribute("data-id"); })[0];
          if (!p) return;
          U.$("#sq-id", body).value = p.id; U.$("#sq-name", body).value = p.name; U.$("#sq-number", body).value = p.number;
          U.$("#sq-control", body).value = p.controlledBy; U.$("#sq-positions", body).value = (p.positions || []).join(",");
          U.$("#sq-flavour", body).value = p.flavour || "";
          body.scrollIntoView({ behavior: "smooth" });
        });
      });
      U.$$(".sq-del", body).forEach(function (btn) {
        btn.addEventListener("click", function () { if (confirm("Deactivate this player?")) NET.adminPlayerDeactivate(btn.getAttribute("data-id")).then(function () { renderTab("squad"); }); });
      });
      U.$$(".sq-card", body).forEach(function (btn) {
        btn.addEventListener("click", function () { openCardUpload(btn.getAttribute("data-id")); });
      });
    });
  }

  function openCardUpload(playerId) {
    var box = U.$("#sq-card-box", root);
    box.innerHTML =
      '<div class="panel">' +
        '<div class="section-label">Upload a card — ' + esc(playerId) + "</div>" +
        field("Label", '<input type="text" id="card-label" maxlength="40" placeholder="e.g. Home kit">') +
        field("Image (WebP/PNG/JPEG, max 3MB)", '<input type="file" id="card-file" accept="image/webp,image/png,image/jpeg">') +
        '<div class="admin-actions"><button class="btn btn-gold btn-small" id="card-upload">Upload</button><span class="admin-inline-note" id="card-msg"></span></div>' +
        '<div id="card-history"></div>' +
      "</div>";
    U.$("#card-upload", box).addEventListener("click", function () {
      var f = U.$("#card-file", box).files[0];
      var label = U.$("#card-label", box).value.trim() || "card";
      if (!f) { U.$("#card-msg", box).textContent = "Choose a file."; return; }
      f.arrayBuffer().then(function (buf) {
        NET.cardUpload(playerId, label, buf, f.name).then(function (r) {
          if (r && r.ok) { U.toast("Card uploaded."); renderCardHistory(playerId, box); }
          else U.$("#card-msg", box).textContent = "✗ " + ((r && r.code) || "upload failed");
        });
      });
    });
    renderCardHistory(playerId, box);
  }

  function renderCardHistory(playerId, box) {
    NET.cardHistory(playerId).then(function (res) {
      var cards = (res && res.cards) || [];
      var host = U.$("#card-history", box);
      host.innerHTML = '<div class="section-label">History</div>' + cards.map(function (c) {
        return '<div class="admin-row"><span class="admin-row-main">v' + c.version + " · " + c.status + '</span>' +
          (NET.isAdmin() && c.status !== "active" ? '<button class="btn btn-ghost btn-small card-rb" data-id="' + c.id + '">Rollback</button>' : "") +
          (NET.isAdmin() && c.status !== "deleted" ? '<button class="btn btn-ghost btn-small card-del" data-id="' + c.id + '">Delete</button>' : "") +
        "</div>";
      }).join("");
      U.$$(".card-rb", host).forEach(function (b) { b.addEventListener("click", function () { NET.cardModerate(b.getAttribute("data-id"), "rollback").then(function () { renderCardHistory(playerId, box); }); }); });
      U.$$(".card-del", host).forEach(function (b) { b.addEventListener("click", function () { NET.cardModerate(b.getAttribute("data-id"), "delete").then(function () { renderCardHistory(playerId, box); }); }); });
    });
  }

  /* ============================================================
     GAFFERS
     ============================================================ */
  function renderGaffers(body) {
    NET.gaffers().then(function (res) {
      var list = (res && res.gaffers) || [];
      body.innerHTML =
        '<div class="panel">' + field("New gaffer name", '<input type="text" id="gf-name" maxlength="60">') +
          '<div class="admin-actions"><button class="btn btn-gold btn-small" id="gf-add">Add</button><span class="admin-inline-note" id="gf-msg"></span></div></div>' +
        '<div class="admin-sublist">' + list.map(function (g) {
          return '<div class="admin-row"><span class="admin-row-main">' + esc(g.name) + '</span>' +
            (NET.isAdmin() ? '<button class="btn btn-ghost btn-small gf-retire" data-id="' + g.id + '">Retire</button>' : "") + "</div>";
        }).join("");
      U.$("#gf-add", body).addEventListener("click", function () {
        var name = U.$("#gf-name", body).value.trim();
        if (!name) return;
        NET.adminGafferAdd(name).then(function (r) { if (r && r.ok) { U.toast("Gaffer added."); renderTab("gaffers"); } });
      });
      U.$$(".gf-retire", body).forEach(function (btn) {
        btn.addEventListener("click", function () { NET.adminGafferPatch(btn.getAttribute("data-id"), { active: false }).then(function () { renderTab("gaffers"); }); });
      });
    });
  }

  /* ============================================================
     NEWS
     ============================================================ */
  function renderNews(body) {
    NET.news().then(function (res) {
      var list = (res && res.news) || [];
      body.innerHTML =
        '<div class="panel">' +
          '<div class="field-row">' + field("Tag", '<input type="text" id="nw-tag" maxlength="24" value="CLUB">') + field("Date", '<input type="date" id="nw-date">') + "</div>" +
          field("Title", '<input type="text" id="nw-title" maxlength="120">') +
          field("Body", '<textarea id="nw-body" rows="4" maxlength="4000"></textarea>') +
          '<label class="pers-toggle"><input type="checkbox" id="nw-pinned"><span class="pers-toggle-track"><span class="pers-toggle-dot"></span></span><span class="pers-toggle-label">Pinned</span></label>' +
          '<div class="admin-actions"><button class="btn btn-gold btn-small" id="nw-add">Post</button><span class="admin-inline-note" id="nw-msg"></span></div>' +
        "</div>" +
        '<div class="admin-sublist">' + list.map(function (n) {
          return '<div class="admin-row"><span class="admin-row-main">' + esc(n.title) + '</span><button class="btn btn-ghost btn-small nw-del" data-id="' + n.id + '">Delete</button></div>';
        }).join("");
      U.$("#nw-add", body).addEventListener("click", function () {
        var title = U.$("#nw-title", body).value.trim(), b = U.$("#nw-body", body).value.trim();
        if (!title || !b) { U.$("#nw-msg", body).textContent = "Title + body needed."; return; }
        NET.adminNewsAdd({ tag: U.$("#nw-tag", body).value.trim(), dateISO: U.$("#nw-date", body).value, title: title, body: b, pinned: U.$("#nw-pinned", body).checked })
          .then(function (r) { if (r && r.ok) { U.toast("Posted."); renderTab("news"); } });
      });
      U.$$(".nw-del", body).forEach(function (btn) { btn.addEventListener("click", function () { NET.adminNewsDel(btn.getAttribute("data-id")).then(function () { renderTab("news"); }); }); });
    });
  }

  /* ============================================================
     SEASONS (L9)
     ============================================================ */
  function renderSeasons(body) {
    NET.seasons().then(function (res) {
      var seasons = (res && res.seasons) || [], current = res && res.currentSeason;
      body.innerHTML =
        '<div class="panel">' +
          '<div class="field-row">' + field("ID", '<input type="text" id="se-id" maxlength="24" placeholder="fc26s3">') + field("Label", '<input type="text" id="se-label" maxlength="60" placeholder="Season 3 · FC26">') + "</div>" +
          '<label class="pers-toggle"><input type="checkbox" id="se-current"><span class="pers-toggle-track"><span class="pers-toggle-dot"></span></span><span class="pers-toggle-label">Make current</span></label>' +
          '<div class="admin-actions"><button class="btn btn-gold btn-small" id="se-add">Create season</button><span class="admin-inline-note" id="se-msg"></span></div>' +
        "</div>" +
        '<div class="section-label">Move a range of matches into a season</div>' +
        '<div class="panel">' +
          '<div class="field-row">' + field("Season", '<select id="se-range-season">' + seasons.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.label) + "</option>"; }).join("") + "</select>") + "</div>" +
          '<div class="field-row">' + field("From match #", '<input type="number" id="se-from">') + field("To match #", '<input type="number" id="se-to">') + "</div>" +
          '<div class="admin-actions"><button class="btn btn-primary btn-small" id="se-assign">Assign range</button><span class="admin-inline-note" id="se-assign-msg"></span></div>' +
        "</div>" +
        '<div class="admin-sublist">' + seasons.map(function (s) {
          return '<div class="admin-row"><span class="admin-row-main">' + esc(s.label) + (s.id === current ? ' <span class="pill pill-win">current</span>' : "") + (s.archived ? " (archived)" : "") + "</span></div>";
        }).join("");
      U.$("#se-add", body).addEventListener("click", function () {
        NET.adminSeasonAdd({ id: U.$("#se-id", body).value.trim(), label: U.$("#se-label", body).value.trim(), makeCurrent: U.$("#se-current", body).checked })
          .then(function (r) { if (r && r.ok) { U.toast("Season created."); renderTab("seasons"); } else U.$("#se-msg", body).textContent = "✗ " + ((r && r.code) || "failed"); });
      });
      U.$("#se-assign", body).addEventListener("click", function () {
        NET.adminSeasonAssignRange(U.$("#se-range-season", body).value, U.$("#se-from", body).value, U.$("#se-to", body).value)
          .then(function (r) { if (r && r.ok) U.toast(r.changed + " matches reassigned."); else U.$("#se-assign-msg", body).textContent = "✗ failed"; });
      });
    });
  }

  /* ============================================================
     USERS
     ============================================================ */
  function renderUsers(body) {
    body.innerHTML = U.emptyState("Loading…", "", "⏱");
    // Squad is needed for the account↔player link picker; make sure it's loaded.
    var need = (window.SQUAD && window.SQUAD.length) ? Promise.resolve() : NET.squad().then(function (r) { if (r && r.ok) window.SQUAD = r.squad; });
    Promise.all([NET.adminUsers(), need]).then(function (results) {
      var res = results[0];
      var list = (res && res.users) || [];
      var admin9 = NET.isAdmin();
      body.innerHTML = '<div class="admin-sublist">' + list.map(function (u) {
        return '<div class="admin-row admin-row-stack">' +
          '<div class="admin-row-top"><span class="admin-row-main">' + esc(u.display) + " · L" + u.level + (u.banned ? " · BANNED" : "") +
            (u.linked_player_name ? ' <span class="admin-inline-note">↔ ' + esc(u.linked_player_name) + "</span>" : "") + "</span>" +
          (admin9 ? '<input type="number" class="us-level" data-id="' + u.id + '" min="1" max="9" value="' + u.level + '" style="width:52px">' +
            '<button class="btn btn-ghost btn-small us-setlevel" data-id="' + u.id + '">Set</button>' +
            '<button class="btn btn-ghost btn-small us-ban" data-id="' + u.id + '" data-banned="' + (u.banned ? "0" : "1") + '">' + (u.banned ? "Unban" : "Ban") + "</button>" : "") +
          "</div>" +
          (admin9 ? '<div class="admin-row-link">' +
            '<label class="field field-inline"><span class="field-label">Linked player</span>' +
            '<select class="us-player" data-id="' + u.id + '">' + playerOptions(u.linked_player_id || "") + "</select></label>" +
            '<button class="btn btn-ghost btn-small us-link" data-id="' + u.id + '">Save link</button></div>' : "") +
        "</div>";
      }).join("") + "</div>";
      U.$$(".us-setlevel", body).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var lvl = body.querySelector('.us-level[data-id="' + btn.getAttribute("data-id") + '"]').value;
          NET.adminUserLevel(btn.getAttribute("data-id"), lvl).then(function (r) { if (r && r.ok) { U.toast("Level updated."); renderTab("users"); } });
        });
      });
      U.$$(".us-ban", body).forEach(function (btn) {
        btn.addEventListener("click", function () { NET.adminUserBan(btn.getAttribute("data-id"), btn.getAttribute("data-banned") === "1").then(function () { renderTab("users"); }); });
      });
      U.$$(".us-link", body).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var pid = body.querySelector('.us-player[data-id="' + btn.getAttribute("data-id") + '"]').value;
          NET.adminProfileRole(btn.getAttribute("data-id"), { linkedPlayerId: pid }).then(function (r) {
            if (r && r.ok) { U.toast(pid ? "Account linked to player." : "Link cleared."); renderTab("users"); }
            else U.toast("✗ link failed");
          });
        });
      });
    });
  }

  /* ============================================================
     POINTS (L9): add / remove / set a member's Virgil Points
     ============================================================ */
  function renderPoints(body) {
    body.innerHTML = U.emptyState("Loading…", "", "🪙");
    NET.adminUsers().then(function (res) {
      var list = (res && res.users) || [];
      body.innerHTML = '<p class="admin-inline-note">Add a positive or negative amount, or set an exact balance. Every change is logged.</p>' +
        '<div class="admin-sublist">' + list.map(function (u) {
          return '<div class="admin-row admin-row-stack"><div class="admin-row-top">' +
            '<span class="admin-row-main">' + esc(u.display) + " · L" + u.level + '</span>' +
            '<span class="pts-bal" data-id="' + u.id + '">🪙 ' + (u.points != null ? u.points : 0) + "</span></div>" +
            '<div class="admin-row-link"><input type="number" class="pts-amt" data-id="' + u.id + '" placeholder="e.g. 50 or -20" style="flex:1;min-width:120px">' +
              '<button class="btn btn-ghost btn-small pts-add" data-id="' + u.id + '">Apply</button>' +
              '<button class="btn btn-ghost btn-small pts-set" data-id="' + u.id + '">Set to</button></div></div>';
        }).join("") + "</div>";
      function refresh(id, bal) { var el = body.querySelector('.pts-bal[data-id="' + id + '"]'); if (el) el.textContent = "🪙 " + bal; }
      U.$$(".pts-add", body).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-id");
          var v = parseInt(body.querySelector('.pts-amt[data-id="' + id + '"]').value, 10);
          if (!v) return;
          NET.adminUserPoints(id, { delta: v, reason: "admin adjustment" }).then(function (r) {
            if (r && r.ok) { U.toast((v > 0 ? "+" : "") + v + " points."); refresh(id, r.balance); } else U.toast("✗ failed");
          });
        });
      });
      U.$$(".pts-set", body).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-id");
          var v = parseInt(body.querySelector('.pts-amt[data-id="' + id + '"]').value, 10);
          if (isNaN(v)) return;
          NET.adminUserPoints(id, { mode: "set", amount: v, reason: "admin set" }).then(function (r) {
            if (r && r.ok) { U.toast("Balance set to " + r.balance + "."); refresh(id, r.balance); } else U.toast("✗ failed");
          });
        });
      });
    });
  }

  /* ============================================================
     TITLES (L9)
     ============================================================ */
  function renderTitles(body) {
    NET.titles().then(function (res) {
      var list = (res && res.titles) || [];
      body.innerHTML =
        '<div class="panel">' +
          '<div class="field-row">' + field("Name", '<input type="text" id="tt-name" maxlength="40">') + field("Icon", '<input type="text" id="tt-icon" maxlength="8">') + "</div>" +
          field("Description", '<input type="text" id="tt-desc" maxlength="200">') +
          '<div class="admin-actions"><button class="btn btn-gold btn-small" id="tt-add">Create title</button><span class="admin-inline-note" id="tt-msg"></span></div>' +
        "</div>" +
        '<div class="admin-sublist">' + list.map(function (t) {
          return '<div class="admin-row"><span class="admin-row-main">' + esc(t.icon || "") + " " + esc(t.name) + '</span><button class="btn btn-ghost btn-small tt-retire" data-id="' + t.id + '">Retire</button></div>';
        }).join("");
      U.$("#tt-add", body).addEventListener("click", function () {
        NET.adminTitleAdd({ name: U.$("#tt-name", body).value.trim(), icon: U.$("#tt-icon", body).value.trim(), description: U.$("#tt-desc", body).value.trim() })
          .then(function (r) { if (r && r.ok) { U.toast("Title created."); renderTab("titles"); } });
      });
      U.$$(".tt-retire", body).forEach(function (btn) { btn.addEventListener("click", function () { NET.adminTitlePatch(btn.getAttribute("data-id"), { active: false }).then(function () { renderTab("titles"); }); }); });
    });
  }

  /* ============================================================
     MODERATION (DM reports, L9)
     ============================================================ */
  function renderModeration(body) {
    NET.adminDmReports().then(function (res) {
      var list = (res && res.reports) || [];
      body.innerHTML = '<p class="screen-intro">Reported private-message content only — this is not a general inbox browser.</p>' +
        '<div class="admin-sublist">' + (list.length ? list.map(function (r) {
          return '<div class="admin-row"><span class="admin-row-main">' + esc(r.body) + '<br><span class="admin-inline-note">reason: ' + esc(r.reason || "—") + "</span></span>" +
            '<button class="btn btn-ghost btn-small mod-dismiss" data-id="' + r.id + '">Dismiss</button>' +
            '<button class="btn btn-ghost btn-small mod-action" data-id="' + r.id + '">Actioned</button></div>';
        }).join("") : U.emptyState("No open reports", "", "✅")) + "</div>";
      U.$$(".mod-dismiss", body).forEach(function (btn) { btn.addEventListener("click", function () { NET.adminDmReportPatch(btn.getAttribute("data-id"), "dismissed").then(function () { renderTab("moderation"); }); }); });
      U.$$(".mod-action", body).forEach(function (btn) { btn.addEventListener("click", function () { NET.adminDmReportPatch(btn.getAttribute("data-id"), "actioned").then(function () { renderTab("moderation"); }); }); });
    });
  }

  /* ============================================================
     SETTINGS (L9): banner + generic key/value
     ============================================================ */
  function renderSettings(body) {
    body.innerHTML =
      '<div class="panel">' +
        '<div class="section-label">Site banner</div>' +
        field("Text", '<input type="text" id="st-banner-text" maxlength="200">') +
        '<label class="pers-toggle"><input type="checkbox" id="st-banner-active"><span class="pers-toggle-track"><span class="pers-toggle-dot"></span></span><span class="pers-toggle-label">Active</span></label>' +
        '<div class="admin-actions"><button class="btn btn-gold btn-small" id="st-banner-save">Save banner</button><span class="admin-inline-note" id="st-msg"></span></div>' +
      "</div>" +
      '<div class="panel">' +
        '<div class="section-label">League standing</div>' +
        field("Division", '<input type="text" id="st-league-division" maxlength="60" placeholder="e.g. Division 2">') +
        field("Position", '<input type="text" id="st-league-position" maxlength="60" placeholder="e.g. 1 Chance Rem">') +
        field("Points", '<input type="text" id="st-league-points" maxlength="30" placeholder="e.g. 12/16">') +
        '<div class="admin-actions"><button class="btn btn-gold btn-small" id="st-league-save">Save league standing</button><span class="admin-inline-note" id="st-league-msg"></span></div>' +
      "</div>" +
      '<div class="panel">' +
        '<div class="section-label">Social links</div>' +
        field("TikTok handle", '<input type="text" id="st-tiktok" maxlength="60" placeholder="danwhizzy">') +
        field("Twitch channel", '<input type="text" id="st-twitch" maxlength="60" placeholder="40yrvirgil">') +
        field("YouTube", '<input type="text" id="st-youtube" maxlength="120" placeholder="@handle or full channel/video link">') +
        '<div class="admin-actions"><button class="btn btn-gold btn-small" id="st-socials-save">Save socials</button><span class="admin-inline-note" id="st-socials-msg"></span></div>' +
      "</div>";
    U.$("#st-banner-save", body).addEventListener("click", function () {
      NET.adminBanner(U.$("#st-banner-text", body).value.trim(), U.$("#st-banner-active", body).checked)
        .then(function (r) { if (r && r.ok) U.toast("Banner saved."); else U.$("#st-msg", body).textContent = "✗ failed"; });
    });
    NET.home().then(function (res) {
      var ls = res && res.leagueStatus || {};
      U.$("#st-league-division", body).value = ls.division || "";
      U.$("#st-league-position", body).value = ls.position || "";
      U.$("#st-league-points", body).value = ls.points || "";
    });
    U.$("#st-league-save", body).addEventListener("click", function () {
      NET.adminLeagueStatus(
        U.$("#st-league-division", body).value.trim(),
        U.$("#st-league-position", body).value.trim(),
        U.$("#st-league-points", body).value.trim()
      ).then(function (r) { if (r && r.ok) U.toast("League standing saved."); else U.$("#st-league-msg", body).textContent = "✗ failed"; });
    });
    NET.socials().then(function (res) {
      var s = (res && res.socials) || {};
      U.$("#st-tiktok", body).value = s.tiktok || "";
      U.$("#st-twitch", body).value = s.twitch || "";
      U.$("#st-youtube", body).value = s.youtube || "";
    });
    U.$("#st-socials-save", body).addEventListener("click", function () {
      var val = JSON.stringify({
        tiktok: U.$("#st-tiktok", body).value.trim().replace(/^@/, ""),
        twitch: U.$("#st-twitch", body).value.trim(),
        youtube: U.$("#st-youtube", body).value.trim()
      });
      NET.adminSettings("socials", val).then(function (r) {
        if (r && r.ok) U.toast("Socials saved."); else U.$("#st-socials-msg", body).textContent = "✗ failed";
      });
    });
  }

  window.ADMIN = { enter: enter };
})();
