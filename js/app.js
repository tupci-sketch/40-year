/* ============================================================
   The 40Yr Virgil — app shell (v3: Cloudflare API backend)
   ------------------------------------------------------------
   Hash router + page renderers. Talks to the Worker via window.NET
   (js/api.js). Nothing here computes club-wide totals client-side
   any more — the API returns focused, paginated, already-computed
   data for each page.
   ============================================================ */
(function () {
  "use strict";

  var U, NET;
  var PAGES = {};
  var currentPage = null, currentArg = null;
  var sessionChecked = false;

  var STAGE_LABEL = { league: "League", playoff: "Playoff", cup: "Cup", friendly: "Friendly", international: "International", other: "Match" };

  function liveBlock(res, kind) {
    if (res && res.ok) return null;
    if (res && res.error === "offline" && NET.hasBackend()) return U.offlineState();
    return U.waitingState(kind);
  }

  /* Populate window.SQUAD from the API and keep it fresh — everything
     that reads window.SQUAD (tactics board, cardTile, playerById) just
     works once this resolves. */
  var squadLoaded = null;
  function loadSquad(force) {
    if (squadLoaded && !force) return squadLoaded;
    squadLoaded = NET.squad().then(function (r) {
      if (r && r.ok) window.SQUAD = r.squad;
      return r;
    });
    return squadLoaded;
  }

  /* ========================================================
     ROUTER
     ======================================================== */
  var ROUTES = ["home", "archive", "match", "opponent", "squad", "player", "tactics",
    "matchday", "clubhouse", "thread", "inbox", "conversation", "profile",
    "funhouse", "book", "more", "stats", "honours", "gaffer", "news", "social",
    "search", "about", "tickets", "admin"];

  function parseHash() {
    var h = (location.hash || "#home").replace(/^#/, "");
    var parts = h.split("/");
    return { name: parts[0] || "home", arg: parts.slice(1).join("/") || null };
  }

  function route() {
    var r = parseHash();
    if (ROUTES.indexOf(r.name) === -1) { location.replace("#home"); return; }

    if (r.name === "admin" && !NET.isMod()) {
      var pending = NET.hasBackend() && NET.hasStoredSession() && !sessionChecked;
      if (!pending) { location.replace("#home"); return; }
    }
    if ((r.name === "inbox" || r.name === "conversation") && !NET.me) {
      var pendingInbox = NET.hasBackend() && NET.hasStoredSession() && !sessionChecked;
      if (!pendingInbox) { location.replace("#home"); return; }
    }

    if (currentPage && PAGES[currentPage] && PAGES[currentPage].leave) PAGES[currentPage].leave();
    currentPage = r.name;
    currentArg = r.arg;

    U.$$(".screen").forEach(function (s) { s.classList.remove("active"); });
    var scr = U.$("#screen-" + r.name);
    void scr.offsetWidth;
    scr.classList.add("active");

    U.$$(".nav-link").forEach(function (a) {
      var on = a.getAttribute("data-route") === r.name;
      a.classList.toggle("active", on);
    });
    document.body.classList.remove("nav-open");
    window.scrollTo(0, 0);

    if (PAGES[r.name] && PAGES[r.name].enter) PAGES[r.name].enter(r.arg);
  }

  function bindNav() {
    U.$("#nav-toggle").addEventListener("click", function () { document.body.classList.toggle("nav-open"); });
  }

  /* ========================================================
     ACCOUNT / AUTH
     ======================================================== */
  function renderAccount() {
    var bar = U.$("#account-bar");
    if (NET.me) {
      bar.innerHTML = '<span class="account-name">' + U.esc(NET.me.name) + '</span>' +
        '<a href="#profile/' + U.esc(NET.me.username) + '" class="account-link">Profile</a>' +
        '<button class="btn btn-ghost btn-small" id="account-logout">Sign out</button>';
      U.$("#account-logout").addEventListener("click", function () {
        NET.logout().then(function () { renderAccount(); U.toast("Signed out."); if (parseHash().name === "admin" || parseHash().name === "inbox") location.hash = "#home"; else route(); });
      });
    } else {
      bar.innerHTML = '<button class="btn btn-primary btn-small" id="account-signin">Sign in</button>';
      U.$("#account-signin").addEventListener("click", openAuth);
    }
    U.$("#nav-admin").hidden = !NET.isMod();
    U.$("#nav-inbox").hidden = !NET.me;
    if (NET.me) refreshUnread();
  }

  var unreadTimer = null;
  function refreshUnread() {
    NET.dmConversations({ limit: 20 }).then(function (r) {
      if (!r || !r.ok) return;
      var n = (r.conversations || []).reduce(function (a, c) { return a + (Number(c.unread) || 0); }, 0);
      var b = U.$("#inbox-badge");
      if (n > 0) { b.textContent = n > 9 ? "9+" : String(n); b.hidden = false; } else b.hidden = true;
    });
  }

  var AUTH_ERR = {
    bad_name: "Names are 2–20 characters, letters/numbers/spaces only.",
    bad_pass: "Password needs at least 6 characters.",
    name_taken: "That name's taken.",
    bad_login: "Wrong name or password.",
    banned: "That account's been suspended.",
    turnstile: "Verification failed — try again."
  };

  function openAuth() {
    var m = U.$("#auth-modal");
    m.hidden = false;
    U.$("#auth-error").textContent = "";
    U.$("#auth-form").reset();
    renderTurnstile();
  }
  function closeAuth() { U.$("#auth-modal").hidden = true; }

  function setAuthTab(tab) {
    U.$("#auth-modal").setAttribute("data-mode", tab);
    U.$$(".auth-tab").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === tab); });
    U.$("#auth-confirm-row").hidden = tab !== "register";
    U.$("#auth-submit").textContent = tab === "register" ? "Register" : "Sign in";
    U.$("#auth-head").textContent = tab === "register" ? "Join the Squad" : "The Clubhouse Door";
  }

  var turnstileWidgetId = null;
  window.onTurnstileReady = function () { renderTurnstile(); };
  function renderTurnstile() {
    var box = U.$("#cf-turnstile");
    if (!box || !window.TURNSTILE_SITEKEY || !window.turnstile) { if (box) box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = "";
    turnstileWidgetId = window.turnstile.render(box, { sitekey: window.TURNSTILE_SITEKEY });
  }
  function turnstileToken() {
    try { return window.turnstile && turnstileWidgetId != null ? window.turnstile.getResponse(turnstileWidgetId) : ""; } catch (e) { return ""; }
  }

  function bindAuth() {
    U.$("#auth-close").addEventListener("click", closeAuth);
    U.$$(".auth-tab").forEach(function (b) { b.addEventListener("click", function () { setAuthTab(b.getAttribute("data-tab")); }); });
    U.$("#auth-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var mode = U.$("#auth-modal").getAttribute("data-mode");
      var name = U.$("#auth-name").value.trim();
      var pass = U.$("#auth-pass").value;
      var err = U.$("#auth-error");
      err.textContent = "";
      if (mode === "register") {
        var conf = U.$("#auth-confirm").value;
        if (pass !== conf) { err.textContent = "Passwords don't match."; return; }
      }
      var btn = U.$("#auth-submit");
      btn.disabled = true;
      var tok = turnstileToken();
      var p = mode === "register" ? NET.register(name, pass, tok) : NET.login(name, pass, tok);
      p.then(function (r) {
        btn.disabled = false;
        renderTurnstile();
        if (r && r.ok) {
          closeAuth();
          renderAccount();
          U.toast(mode === "register" ? "Welcome, " + r.name + "." : "Welcome back, " + r.name + ".");
          route();
        } else {
          var code = r && (r.code || r.error);
          err.textContent = AUTH_ERR[code] || ("Something went wrong" + (code ? " (" + code + ")" : "") + ". Try again.");
        }
      });
    });
  }

  /* ========================================================
     HOME
     ======================================================== */
  PAGES.home = {
    enter: function () {
      var mt = U.$("#home-live");
      mt.innerHTML = U.emptyState("Opening the ledger…", "", "⏱");
      NET.home().then(function (res) {
        var block = liveBlock(res, "the record");
        if (block) { mt.innerHTML = block; return; }
        var rec = res.record || {};
        var form = (res.form || []).map(function (r) { return U.pill(r); }).join("");
        var next = res.nextFixture;
        var ls = res.leagueStatus || {};
        function cell(v, lab) { return v ? '<div class="league-cell"><span class="league-val">' + U.esc(v) + '</span><span class="league-lab">' + lab + "</span></div>" : ""; }
        var strip = (ls.division || ls.position || ls.points)
          ? '<div class="league-strip panel">' +
              '<div class="league-row">' +
                cell(ls.division, "Division") + cell(ls.position, "Position") + cell(ls.points, "Points") + cell(U.num(rec.played), "Played") +
                (form ? '<div class="league-cell league-form"><span class="league-form-pills">' + form + '</span><span class="league-lab">Form</span></div>' : "") +
              "</div>" +
            "</div>"
          : "";
        mt.innerHTML = strip +
          U.statTile("Played", U.num(rec.played)) +
          U.statTile("Wins", U.num(rec.wins), { accent: "win" }) +
          U.statTile("Draws", U.num(rec.draws)) +
          U.statTile("Losses", U.num(rec.losses), { accent: "loss" }) +
          '<div class="stat-tile stat-tile-wide"><span class="stat-tile-label">Recent form</span><div class="form-pills">' + (form || "—") + "</div></div>" +
          (next ? '<a class="stat-tile stat-tile-wide" href="#matchday"><span class="stat-tile-label">Next up</span><span class="stat-tile-value" style="font-size:1.1rem">' +
            (next.opponent ? U.esc(next.opponent) : "Club session") + (next.date_iso ? " · " + U.fmtDate(next.date_iso) : "") + "</span></a>" : "");
        U.runCountUps(mt);
        if (res.banner && res.banner.active && res.banner.text) {
          var bn = U.$("#site-banner");
          U.$("#site-banner-text").textContent = res.banner.text;
          bn.hidden = false;
        }
      });
    }
  };

  /* ========================================================
     ARCHIVE (paginated match list) + MATCH REPORT + OPPONENT
     ======================================================== */
  var archiveState = { cursor: null, filters: {} };

  PAGES.archive = {
    enter: function () {
      archiveState.cursor = null;
      var fbox = U.$("#archive-filters");
      // Seasons drive the archive so previous/archived campaigns (S2, and any
      // future S4+) stay fully browseable — not just the running season.
      NET.seasons().then(function (sres) {
        var seasons = (sres && sres.seasons) || [];
        var seasonOpts = '<option value="">All seasons</option>' + seasons.map(function (s) {
          return '<option value="' + U.esc(s.id) + '">' + U.esc(s.label) + (s.archived ? " · archived" : "") + "</option>";
        }).join("");
        fbox.innerHTML =
          '<div class="field-row">' +
            '<label class="field"><span class="field-label">Season</span><select id="af-season">' + seasonOpts + "</select></label>" +
            '<label class="field"><span class="field-label">Result</span><select id="af-result"><option value="">Any</option><option value="W">Win</option><option value="D">Draw</option><option value="L">Loss</option></select></label>' +
            '<label class="field"><span class="field-label">Stage</span><select id="af-stage"><option value="">Any</option><option value="league">League</option><option value="playoff">Playoff</option><option value="cup">Cup</option><option value="friendly">Friendly</option></select></label>' +
          "</div>";
        ["af-season", "af-result", "af-stage"].forEach(function (id) {
          U.$("#" + id).addEventListener("change", function () {
            archiveState.filters.season = U.$("#af-season").value;
            archiveState.filters.result = U.$("#af-result").value;
            archiveState.filters.stage = U.$("#af-stage").value;
            archiveState.cursor = null;
            renderList(true);
          });
        });
        renderList(true);
      });
    }
  };

  function renderList(reset) {
    var list = U.$("#archive-list");
    if (reset) list.innerHTML = "";
    var q = { limit: 20, cursor: archiveState.cursor, season: archiveState.filters.season, result: archiveState.filters.result, stage: archiveState.filters.stage };
    var loading = document.createElement("div");
    loading.innerHTML = U.emptyState("Loading…", "", "⏱");
    list.appendChild(loading);
    Promise.all([NET.matches(q), loadSquad()]).then(function (rs) {
      var res = rs[0];
      loading.remove();
      var block = liveBlock(res, "the archive");
      if (block) { if (reset) list.innerHTML = block; return; }
      if (reset && !res.matches.length) { list.innerHTML = U.emptyState("No matches yet", "", "📋"); return; }
      var canEdit = NET.isMod();
      res.matches.forEach(function (m, i) {
        var stage = STAGE_LABEL[m.stage] || "League";
        var stageTag = U.esc(stage) + (m.comp_name ? " · " + U.esc(m.comp_name) : "");
        var scorers = U.scorersLine((m.scorers || []).map(function (s) {
          var p = U.playerById(s.id); return { name: p ? p.name : s.id, goals: s.goals };
        }));
        var motmP = m.motm_player_id ? U.playerById(m.motm_player_id) : null;
        var detailed = (m.players || []).slice().sort(function (a, b) { return (Number(b.rating) || 0) - (Number(a.rating) || 0); });
        var anyGK = detailed.some(function (t) { return (Number(t.saves) || 0) > 0 || (Number(t.conceded) || 0) > 0; });
        var statsPanel = detailed.length
          ? '<details class="opp-panel"><summary>Player stats · ' + detailed.length + " on record</summary>" +
              '<div class="table-scroll"><table class="opp-table opp-table-wide"><thead><tr><th>Player</th><th>G</th><th>A</th><th>R</th><th>Sh</th><th>Tk</th><th>Pass</th>' +
              (anyGK ? "<th>Sv</th><th>GA</th>" : "") + "</tr></thead><tbody>" +
              detailed.map(function (t) {
                var p = U.playerById(t.player_id);
                var nm = p ? '<a href="#player/' + p.id + '">' + U.esc(p.name) + "</a>" : U.esc(t.player_id);
                var isGK = p && (p.positions || [])[0] === "GK";
                return "<tr><td>" + nm + "</td><td>" + (t.goals != null ? t.goals : "—") + "</td><td>" + (t.assists != null ? t.assists : "—") +
                  "</td><td>" + (t.rating != null ? Number(t.rating).toFixed(1) : "—") + "</td><td>" + (t.shots != null ? t.shots : "—") +
                  "</td><td>" + (t.tackles != null ? t.tackles : "—") + "</td><td>" + (t.passes_made != null ? t.passes_made + "/" + t.pass_attempts : "—") + "</td>" +
                  (anyGK ? "<td>" + (isGK && t.saves != null ? t.saves : "—") + "</td><td>" + (isGK && t.conceded != null ? t.conceded : "—") + "</td>" : "") + "</tr>";
              }).join("") + "</tbody></table></div>" +
              (m.note ? '<p class="result-note">📝 ' + U.esc(m.note) + "</p>" : "") + "</details>"
          : (m.note ? '<p class="result-note">📝 ' + U.esc(m.note) + "</p>" : "");
        var row = document.createElement("article");
        row.className = "result-row";
        row.style.animationDelay = Math.min(i * 40, 400) + "ms";
        row.innerHTML =
          '<div class="result-main">' + U.pill(m.result) +
            '<div class="result-mid">' +
              '<span class="result-line"><strong>The 40Yr Virgil</strong> <span class="result-score">' +
                (m.our_score != null ? m.our_score : "–") + " — " + (m.their_score != null ? m.their_score : "–") +
                '</span> <a class="result-opp" href="#opponent/' + encodeURIComponent(m.opponent || "") + '">' + U.esc(m.opponent || "Unknown") + "</a></span>" +
              (scorers ? '<span class="result-scorers">⚽ ' + scorers + "</span>" : "") +
              (motmP ? '<span class="result-motm">🌟 MOTM ' + U.esc(U.surname(motmP)) + "</span>" : "") +
            "</div>" +
            '<div class="result-side"><span class="result-date">Match ' + m.id + (m.date_iso ? " · " + U.fmtDate(m.date_iso) : "") + "</span>" +
              '<span class="result-tag">' + stageTag + "</span>" +
              '<a class="result-report" href="#match/' + m.id + '">Report →</a>' +
              (canEdit ? '<a class="result-report" href="#admin">✎ Edit</a>' : "") +
            "</div>" +
          "</div>" + statsPanel;
        list.appendChild(row);
      });
      archiveState.cursor = res.nextCursor;
      var old = U.$("#archive-more"); if (old) old.remove();
      if (res.nextCursor) {
        var more = document.createElement("button");
        more.className = "btn btn-ghost btn-small"; more.id = "archive-more"; more.textContent = "Load more";
        more.addEventListener("click", function () { renderList(false); });
        list.appendChild(more);
      }
    });
  }

  function miniPitch(m) {
    var lu = m.lineup;
    if (!lu || !lu.players || !lu.players.length || !window.FORMATIONS[lu.formation]) {
      return '<p class="mr-nolineup">No teamsheet recorded for this game' + (NET.isMod() ? " — add one in Housekeeping." : ".") + "</p>";
    }
    var f = window.FORMATIONS[lu.formation];
    var xi = lu.players.filter(function (p) { return !p.is_sub; });
    var subs = lu.players.filter(function (p) { return p.is_sub; });
    var tokens = xi.map(function (x, i) {
      var slot = f.slots[i]; if (!slot) return "";
      var p = U.playerById(x.player_id);
      var num = p ? p.number : "?";
      var nm = p ? U.surname(p) : x.player_id;
      var cap = (lu.captain_player_id && lu.captain_player_id === x.player_id) ? '<span class="mr-arm">C</span>' : "";
      return '<div class="mr-token' + (p && p.controlledBy === "human" ? " token-human" : "") + '" style="left:' + slot.x + "%;bottom:" + slot.y + '%">' +
        '<span class="mr-shirt">' + num + cap + '</span><span class="mr-name">' + U.esc(nm) + "</span></div>";
    }).join("");
    var subsLine = subs.map(function (s) { var p = U.playerById(s.player_id); return p ? U.esc(U.surname(p)) : U.esc(s.player_id); }).join(", ");
    return '<div class="section-label">The XI · ' + U.esc(lu.formation) + "</div>" +
      '<div class="mr-pitch-wrap"><div class="mr-pitch"><div class="pitch-lines"><div class="pl-halfway"></div><div class="pl-centre"></div></div>' + tokens + "</div></div>" +
      (subsLine ? '<p class="mr-subs">Subs: ' + subsLine + "</p>" : "");
  }

  function statsTable(stats) {
    var anyGK = stats.some(function (t) { return (Number(t.saves) || 0) > 0 || (Number(t.conceded) || 0) > 0; });
    return '<div class="section-label">Player stats</div>' +
      '<div class="table-scroll"><table class="opp-table opp-table-wide"><thead><tr><th>Player</th><th>G</th><th>A</th><th>R</th><th>Sh</th><th>Tk</th><th>Pass</th>' +
      (anyGK ? "<th>Sv</th><th>GA</th>" : "") + "</tr></thead><tbody>" +
      stats.slice().sort(function (a, b) { return (Number(b.rating) || 0) - (Number(a.rating) || 0); }).map(function (t) {
        var p = U.playerById(t.player_id);
        var nm = p ? '<a href="#player/' + p.id + '">' + U.esc(p.name) + "</a>" : U.esc(t.player_id);
        var isGK = p && (p.positions || [])[0] === "GK";
        return "<tr><td>" + nm + "</td><td>" + (t.goals != null ? t.goals : "—") + "</td><td>" + (t.assists != null ? t.assists : "—") +
          "</td><td>" + (t.rating != null ? Number(t.rating).toFixed(1) : "—") + "</td><td>" + (t.shots != null ? t.shots : "—") +
          "</td><td>" + (t.tackles != null ? t.tackles : "—") + "</td><td>" + (t.passes_made != null ? t.passes_made + "/" + t.pass_attempts : "—") + "</td>" +
          (anyGK ? "<td>" + (isGK && t.saves != null ? t.saves : "—") + "</td><td>" + (isGK && t.conceded != null ? t.conceded : "—") + "</td>" : "") +
          "</tr>";
      }).join("") + "</tbody></table></div>";
  }

  PAGES.match = {
    enter: function (arg) {
      var seq = Number(arg);
      var mt = U.$("#match-view");
      mt.innerHTML = U.emptyState("Opening the report…", "", "⏱");
      Promise.all([NET.match(seq), loadSquad()]).then(function (results) {
        var res = results[0];
        if (!res || !res.ok) { mt.innerHTML = U.emptyState("No such match", "It may have been struck from the books.", "—"); return; }
        var m = res.match;
        var stage = STAGE_LABEL[m.stage] || "Match";
        var venueLabel = m.venue === "H" ? "Home" : m.venue === "A" ? "Away" : m.venue === "N" ? "Neutral" : "";
        var scorers = U.scorersLine((res.scorers || []).map(function (s) { var p = U.playerById(s.player_id); return { name: p ? p.name : s.player_id, goals: s.goals }; }));
        var motmP = m.motm_player_id ? U.playerById(m.motm_player_id) : null;
        var gaffers = res.gaffers || [];
        var gafferLine = gaffers.length === 1 ? "Managed by " + U.esc(gaffers[0].name_snapshot) :
          gaffers.length > 1 ? "Gaffers: " + gaffers.map(function (g) { return U.esc(g.name_snapshot); }).join(", ") : "Manager unrecorded";

        mt.innerHTML =
          '<article class="match-report">' +
            '<div class="mr-head">' + U.pill(m.result) +
              '<div class="mr-score">' + (m.our_score != null ? m.our_score : "–") + " — " + (m.their_score != null ? m.their_score : "–") + "</div>" +
              '<div class="mr-teams"><strong>The 40Yr Virgil</strong> vs <a href="#opponent/' + encodeURIComponent(m.opponent || "") + '">' + U.esc(m.opponent || "Unknown") + "</a></div>" +
              '<div class="mr-meta">Match ' + m.id + " · " + U.esc(stage) + (m.comp_name ? " · " + U.esc(m.comp_name) : "") + (venueLabel ? " · " + venueLabel : "") + (m.date_iso ? " · " + U.fmtDate(m.date_iso) : "") + "</div>" +
              '<div class="mr-gaffer">🎩 ' + gafferLine + "</div>" +
              (scorers ? '<div class="mr-scorers">⚽ ' + scorers + "</div>" : "") +
              (motmP ? '<div class="mr-motm">🌟 Man of the Match — <a href="#player/' + motmP.id + '">' + U.esc(motmP.name) + "</a></div>" : "") +
            "</div>" +
            miniPitch({ lineup: res.lineup }) +
            (res.stats && res.stats.length ? statsTable(res.stats) : "") +
            (m.note ? '<p class="result-note">📝 ' + U.esc(m.note) + "</p>" : "") +
            (NET.isMod() ? '<div class="admin-actions"><button class="btn btn-ghost btn-small" id="mr-edit">Edit in Housekeeping →</button></div>' : "") +
            '<a class="back-link" href="#archive">← All results</a>' +
          "</article>";
        var eb = U.$("#mr-edit", mt);
        if (eb) eb.addEventListener("click", function () { try { sessionStorage.setItem("v40.editseq", String(m.id)); } catch (e) {} location.hash = "#admin"; });
        U.runCountUps(mt);
      });
    }
  };

  PAGES.opponent = {
    enter: function (arg) {
      var name = decodeURIComponent(arg || "");
      var mt = U.$("#opponent-view");
      mt.innerHTML = U.emptyState("Loading…", "", "⏱");
      U.$("#screen-opponent .screen-title").textContent = name || "Head to Head";
      NET.matches({ opponent: name, limit: 50 }).then(function (res) {
        var block = liveBlock(res, "these fixtures");
        if (block) { mt.innerHTML = block; return; }
        var ms = res.matches || [];
        var w = ms.filter(function (m) { return m.result === "W"; }).length;
        var d = ms.filter(function (m) { return m.result === "D"; }).length;
        var l = ms.filter(function (m) { return m.result === "L"; }).length;
        mt.innerHTML =
          '<div class="tile-row">' + U.statTile("Played", ms.length) + U.statTile("Won", w, { accent: "win" }) + U.statTile("Drawn", d) + U.statTile("Lost", l, { accent: "loss" }) + "</div>" +
          '<div class="section-label">Meetings</div>' +
          ms.map(function (m) {
            return '<a class="result-row" href="#match/' + m.id + '">' + U.pill(m.result) +
              '<span class="result-score">' + m.our_score + "–" + m.their_score + "</span>" +
              '<span class="result-meta">' + (m.date_iso ? U.fmtDate(m.date_iso) : "") + "</span></a>";
          }).join("");
        U.runCountUps(mt);
      });
    }
  };

  /* ========================================================
     SQUAD + PLAYER
     ======================================================== */
  PAGES.squad = {
    enter: function () {
      var grid = U.$("#squad-grid");
      grid.innerHTML = U.emptyState("Loading the squad…", "", "⏱");
      loadSquad(true).then(function (res) {
        var block = liveBlock(res, "the squad");
        if (block) { grid.innerHTML = block; return; }
        grid.innerHTML = '<div class="card-grid">' + (window.SQUAD || []).map(U.cardTile).join("") + "</div>";
      });
    }
  };

  PAGES.player = {
    enter: function (arg) {
      var mt = U.$("#player-view");
      mt.innerHTML = U.emptyState("Loading…", "", "⏱");
      Promise.all([NET.player(arg), loadSquad()]).then(function (results) {
        var res = results[0];
        if (!res || !res.ok) { mt.innerHTML = U.emptyState("No such player", "", "—"); return; }
        var p = res.player, base = res.baseline, rec = res.recorded || {}, games = res.games || [];
        var pos = (p.positions || []).join(" / ") || "—";

        function totalsTiles(which) {
          if (which === "full" && base) {
            return '<div class="tile-row">' + U.statTile("Apps", U.num(base.apps)) + U.statTile("Goals", U.num(base.goals)) +
              U.statTile("Assists", U.num(base.assists)) + U.statTile("Avg rating", base.avg_rating != null ? Number(base.avg_rating).toFixed(1) : "—") + "</div>" +
              '<p class="screen-intro">Full verified career total' + (base.source ? " (" + U.esc(base.source) + ")" : "") +
              " — includes the pre-recording era" + (base.as_of_seq ? "; match-by-match data below is tracked from match " + base.as_of_seq + " on" : "") + ".</p>";
          }
          return '<div class="tile-row">' + U.statTile("Apps", U.num(rec.apps) || 0) + U.statTile("Goals", U.num(rec.goals) || 0) +
            U.statTile("Assists", U.num(rec.assists) || 0) + U.statTile("Avg rating", rec.avg_rating != null ? Number(rec.avg_rating).toFixed(1) : "—") +
            (rec.saves > 0 || rec.conceded > 0 ? U.statTile("Saves", U.num(rec.saves) || 0) + U.statTile("Conceded", U.num(rec.conceded) || 0) : "") + "</div>" +
            '<p class="screen-intro">Only the games this club has recorded — every one of them listed below.</p>';
        }

        var anyGK = games.some(function (g) { return (Number(g.saves) || 0) > 0 || (Number(g.conceded) || 0) > 0; });
        var gameLog = games.length
          ? '<div class="section-label">Match-by-match · ' + games.length + " recorded</div>" +
            '<div class="table-scroll"><table class="opp-table opp-table-wide"><thead><tr><th>#</th><th>Opponent</th><th>Res</th><th>G</th><th>A</th><th>R</th>' +
            (anyGK ? "<th>Sv</th><th>GA</th>" : "") + "</tr></thead><tbody>" +
            games.map(function (g) {
              return '<tr><td><a href="#match/' + g.id + '">' + g.id + "</a></td>" +
                '<td><a href="#match/' + g.id + '">' + U.esc(g.opponent || "—") + "</a></td>" +
                "<td>" + U.pill(g.result) + "</td>" +
                "<td>" + (g.goals != null ? g.goals : "—") + "</td><td>" + (g.assists != null ? g.assists : "—") + "</td>" +
                "<td>" + (g.rating != null ? Number(g.rating).toFixed(1) : "—") + "</td>" +
                (anyGK ? "<td>" + (g.saves != null ? g.saves : "—") + "</td><td>" + (g.conceded != null ? g.conceded : "—") + "</td>" : "") +
                "</tr>";
            }).join("") + "</tbody></table></div>"
          : '<p class="screen-intro">No individual match stats recorded for ' + U.esc(p.name) + " yet.</p>";

        mt.innerHTML =
          '<div class="player-dossier">' +
            '<img class="player-portrait" src="' + U.esc(U.cardSrc(p)) + '" alt="' + U.esc(p.name) + '" onerror="this.onerror=null;this.src=\'assets/img/crest.png\'">' +
            "<h2>" + U.esc(p.name) + " <span class=\"player-num\">#" + p.number + "</span></h2>" +
            '<p class="player-meta">' + U.esc(pos) + " · " + U.chips(p) + "</p>" +
            (p.flavour ? '<p class="player-flavour">' + U.esc(p.flavour) + "</p>" : "") +
            (base ? '<div class="stat-toggle"><button class="tab active" data-view="full">Full career</button><button class="tab" data-view="recorded">Recorded only</button></div>' : "") +
            '<div id="player-totals">' + totalsTiles(base ? "full" : "recorded") + "</div>" +
            gameLog +
            '<a class="back-link" href="#squad">← Squad</a>' +
          "</div>";
        U.$$(".stat-toggle .tab", mt).forEach(function (btn) {
          btn.addEventListener("click", function () {
            U.$$(".stat-toggle .tab", mt).forEach(function (b) { b.classList.remove("active"); });
            btn.classList.add("active");
            U.$("#player-totals", mt).innerHTML = totalsTiles(btn.getAttribute("data-view"));
            U.runCountUps(U.$("#player-totals", mt));
          });
        });
        U.runCountUps(mt);
      });
    }
  };

  PAGES.tactics = { enter: function () { loadSquad().then(function () { window.TACTICS.enter(U.$("#tactics-view"), { UI: U }); }); }, leave: function () { if (window.TACTICS.leave) window.TACTICS.leave(); } };

  /* ========================================================
     MATCHDAY (fixtures, availability, predictions, leaderboard)
     ======================================================== */
  PAGES.matchday = {
    enter: function () {
      var mt = U.$("#matchday-view");
      if (!mt) return;
      mt.innerHTML = U.emptyState("Opening Matchday…", "", "🍺");

      function names(list) { return list.length ? list.map(U.esc).join(", ") : "—"; }

      function availBlock(f, avail) {
        var groups = { yes: [], maybe: [], no: [] }, myStatus = "";
        (avail || []).forEach(function (e) { if (groups[e.status]) groups[e.status].push(e.display); if (NET.me && e.display === NET.me.name) myStatus = e.status; });
        var opts = [["yes", "✅ In"], ["maybe", "🤔 Maybe"], ["no", "❌ Out"]];
        var btns = opts.map(function (o) {
          return '<button class="ch-rsvp' + (myStatus === o[0] ? " ch-rsvp-on ch-rsvp-" + o[0] : "") + '" data-act="avail" data-fid="' + U.esc(f.id) + '" data-status="' + o[0] + '">' + o[1] +
            ' <span class="ch-count">' + groups[o[0]].length + "</span></button>";
        }).join("");
        return '<div class="ch-rsvp-row">' + btns + "</div>" +
          '<div class="ch-avail-names"><span class="ch-al ch-al-yes">In:</span> ' + names(groups.yes) + " · " +
            '<span class="ch-al ch-al-maybe">Maybe:</span> ' + names(groups.maybe) + " · " +
            '<span class="ch-al ch-al-no">Out:</span> ' + names(groups.no) + "</div>";
      }

      function predictBlock(f) {
        return '<div class="ch-predict"><div class="section-label">Predict the score</div>' +
          '<div class="ch-pred-input"><span class="ch-pred-us">Virgil</span>' +
          '<input type="number" min="0" max="30" class="ch-pred-our" data-fid="' + U.esc(f.id) + '" placeholder="0">' +
          '<span class="ch-pred-dash">–</span>' +
          '<input type="number" min="0" max="30" class="ch-pred-their" data-fid="' + U.esc(f.id) + '" placeholder="0">' +
          '<button class="btn btn-primary btn-small" data-act="predict" data-fid="' + U.esc(f.id) + '">Call it</button></div></div>';
      }

      function render() {
        NET.fixtures().then(function (res) {
          var block = liveBlock(res, "fixtures");
          if (block) { mt.innerHTML = block; return; }
          var fx = res.fixtures || [];
          if (!fx.length) { mt.innerHTML = '<div class="ch-card">' + U.emptyState("No fixtures on the calendar", "When a game or session is booked in Housekeeping, RSVP and predictions open up here.", "📅") + "</div>"; return; }
          mt.innerHTML = fx.map(function (f) {
            var stage = STAGE_LABEL[f.stage] || "Match";
            var when = f.date_iso ? U.fmtDate(f.date_iso) : "Date TBC";
            var isMatch = f.kind !== "session";
            return '<div class="ch-card ch-fixture" data-fid="' + U.esc(f.id) + '">' +
              '<div class="ch-fx-head"><span class="fixture-badge">' + (isMatch ? U.esc(stage) : "Session") + "</span>" +
                '<div class="ch-fx-title"><strong>The 40Yr Virgil</strong>' + (isMatch && f.opponent ? ' <span class="fixture-vs">vs</span> ' + U.esc(f.opponent) : (f.opponent ? " · " + U.esc(f.opponent) : " · Club session")) + "</div>" +
                '<span class="ch-fx-when">' + when + "</span></div>" +
              (f.note ? '<p class="ch-fx-note">' + U.esc(f.note) + "</p>" : "") +
              '<div class="ch-avail-slot" data-fid="' + U.esc(f.id) + '">' + U.emptyState("Loading…", "", "") + "</div>" +
              (isMatch && NET.me ? predictBlock(f) : "") +
              (!isMatch ? '<p class="ch-session-note">Casual session — RSVP only, no scoreline to call.</p>' : "") +
            "</div>";
          }).join("");
          fx.forEach(function () { /* availability counts loaded per-fixture below via a lightweight follow-up */ });
          U.$$(".ch-avail-slot", mt).forEach(function (slot) {
            slot.innerHTML = availBlock({ id: slot.getAttribute("data-fid") }, []);
          });
        });
      }

      if (!mt.getAttribute("data-wired")) {
        mt.setAttribute("data-wired", "1");
        mt.addEventListener("click", function (ev) {
          var btn = ev.target.closest("[data-act]");
          if (!btn) return;
          if (!NET.me) { openAuth(); return; }
          var act = btn.getAttribute("data-act"), fid = btn.getAttribute("data-fid");
          if (act === "avail") {
            var status = btn.getAttribute("data-status");
            if (btn.classList.contains("ch-rsvp-on")) status = "";
            btn.disabled = true;
            NET.avail(fid, status).then(function (r) {
              btn.disabled = false;
              if (r && r.ok) {
                var slot = mt.querySelector('.ch-avail-slot[data-fid="' + fid + '"]');
                var groups = { yes: [], maybe: [], no: [] };
                (r.counts || []).forEach(function (c) { groups[c.status] = new Array(c.n).fill("member"); });
                if (slot) slot.innerHTML = availBlock({ id: fid }, []);
              }
            });
          } else if (act === "predict") {
            var our = mt.querySelector('.ch-pred-our[data-fid="' + fid + '"]');
            var their = mt.querySelector('.ch-pred-their[data-fid="' + fid + '"]');
            if (!our || !their) return;
            btn.disabled = true;
            NET.predict(fid, Number(our.value) || 0, Number(their.value) || 0).then(function (r) {
              btn.disabled = false;
              if (r && r.ok) U.toast("Prediction locked in.");
            });
          }
        });
      }
      render();
    }
  };

  /* ========================================================
     CLUBHOUSE (forum / chat / member directory)
     ======================================================== */
  var clubhouseTab = "forum";
  PAGES.clubhouse = {
    enter: function () {
      U.$$("#clubhouse-tabs .tab").forEach(function (b) {
        b.classList.toggle("active", b.getAttribute("data-tab") === clubhouseTab);
        if (!b.getAttribute("data-wired")) {
          b.setAttribute("data-wired", "1");
          b.addEventListener("click", function () { clubhouseTab = b.getAttribute("data-tab"); PAGES.clubhouse.enter(); });
        }
      });
      if (clubhouseTab === "forum") renderForumList();
      else if (clubhouseTab === "chat") renderChat();
      else renderDirectory();
    }
  };

  var forumCat = "";
  function renderForumList() {
    var mt = U.$("#clubhouse-view");
    mt.innerHTML = U.emptyState("Loading…", "", "⏱");
    var q = { limit: 30 };
    if (forumCat) q.category = forumCat;
    Promise.all([NET.forumCategories(), NET.forumThreads(q)]).then(function (rs) {
      var cats = (rs[0] && rs[0].categories) || [];
      var res = rs[1];
      var block = liveBlock(res, "the forum");
      if (block) { mt.innerHTML = block; return; }
      // Category chips — browse every board, not just one merged list.
      var chips = '<div class="forum-cats">' +
        '<button class="forum-cat' + (forumCat === "" ? " active" : "") + '" data-cat="">All</button>' +
        cats.map(function (c) {
          return '<button class="forum-cat' + (forumCat === c.key ? " active" : "") + '" data-cat="' + U.esc(c.key) + '">' + U.esc(c.name) + "</button>";
        }).join("") + "</div>";
      var newBox = NET.me ? '<div class="panel"><div class="field-row">' +
        '<label class="field"><span class="field-label">Category</span><select id="fc-cat">' + cats.map(function (c) { return '<option value="' + U.esc(c.key) + '"' + (c.key === forumCat ? " selected" : "") + ">" + U.esc(c.name) + "</option>"; }).join("") + "</select></label>" +
        '<label class="field"><span class="field-label">Title</span><input type="text" id="fc-title" maxlength="120"></label></div>' +
        '<textarea id="fc-body" rows="3" placeholder="Say your piece…" maxlength="4000"></textarea>' +
        '<div class="admin-actions"><button class="btn btn-primary btn-small" id="fc-post">Post thread</button><span class="admin-inline-note" id="fc-msg"></span></div></div>' : "";
      var threadsHtml = (res.threads || []).length ? (res.threads).map(function (t) {
        return '<a class="result-row forum-thread-row" href="#thread/' + t.id + '">' +
          (t.pinned ? '<span class="news-pin">📌</span>' : "") +
          '<span class="result-opp">' + U.esc(t.title) + "</span>" +
          '<span class="result-meta">' + U.esc(t.category_name || "") + " · " + t.replies + " replies · " + U.fmtDate(t.last_iso) + "</span></a>";
      }).join("") : U.emptyState("No threads here yet", "Be the first to post in this board.", "🗨");
      mt.innerHTML = chips + newBox + threadsHtml;
      U.$$(".forum-cat", mt).forEach(function (b) {
        b.addEventListener("click", function () { forumCat = b.getAttribute("data-cat"); renderForumList(); });
      });
      var pb = U.$("#fc-post");
      if (pb) pb.addEventListener("click", function () {
        var cat = U.$("#fc-cat").value, title = U.$("#fc-title").value.trim(), body = U.$("#fc-body").value.trim();
        if (!title || !body) { U.$("#fc-msg").textContent = "Fill in a title and body."; return; }
        pb.disabled = true;
        NET.forumNew(cat, title, body).then(function (r) {
          pb.disabled = false;
          if (r && r.ok) { U.toast("Thread posted."); renderForumList(); }
          else U.$("#fc-msg").textContent = "✗ couldn't post";
        });
      });
    });
  }

  PAGES.thread = {
    enter: function (arg) {
      var mt = U.$("#thread-view");
      mt.innerHTML = U.emptyState("Loading…", "", "⏱");
      NET.forumThread(arg, { limit: 50 }).then(function (res) {
        if (!res || !res.ok) { mt.innerHTML = U.emptyState("No such thread", "", "—"); return; }
        var t = res.thread;
        var replyBox = NET.me ? '<div class="panel"><textarea id="th-reply" rows="3" placeholder="Reply…" maxlength="4000"></textarea>' +
          '<div class="admin-actions"><button class="btn btn-primary btn-small" id="th-send">Reply</button><span class="admin-inline-note" id="th-msg"></span></div></div>' : "";
        mt.innerHTML =
          '<article class="panel"><h2>' + U.esc(t.title) + "</h2><p class=\"forum-post-body\">" + U.esc(t.body).replace(/\n/g, "<br>") + "</p></article>" +
          (res.posts || []).map(function (p) { return '<article class="panel forum-post"><p>' + U.esc(p.body).replace(/\n/g, "<br>") + '</p><span class="admin-inline-note">' + U.fmtDateTime(p.created_iso) + "</span></article>"; }).join("") +
          replyBox;
        var sb = U.$("#th-send");
        if (sb) sb.addEventListener("click", function () {
          var text = U.$("#th-reply").value.trim();
          if (!text) return;
          sb.disabled = true;
          NET.forumReply(arg, text).then(function (r) {
            sb.disabled = false;
            if (r && r.ok) PAGES.thread.enter(arg); else U.$("#th-msg").textContent = "✗ couldn't reply";
          });
        });
      });
    }
  };

  var chatTimer = null;
  function fetchChatMessages() {
    var list = U.$("#chat-list");
    if (!list) { clearInterval(chatTimer); chatTimer = null; return; }
    NET.chatFetch({ limit: 60 }).then(function (res) {
      if (!res || !res.ok) return;
      var msgs = (res.messages || []).slice().reverse(); // oldest → newest
      var stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;
      list.innerHTML = msgs.length
        ? msgs.map(function (m) {
            var lvl = Number(m.level) >= 9 ? '<span class="level-chip level-admin">ADMIN</span>'
                    : Number(m.level) >= 5 ? '<span class="level-chip level-mod">MOD</span>' : "";
            var del = NET.isMod() ? '<button class="chat-del" data-id="' + U.esc(m.id) + '" title="Remove message">×</button>' : "";
            var mine = NET.me && m.display === NET.me.name;
            return '<div class="chat-msg' + (mine ? " chat-mine" : "") + '">' +
              '<div class="chat-meta"><span class="chat-name">' + U.esc(m.display) + "</span>" + lvl +
                '<span class="chat-ts">' + U.fmtDateTime(m.created_iso) + "</span>" + del + "</div>" +
              '<div class="chat-text">' + U.esc(m.body) + "</div>" +
            "</div>";
          }).join("")
        : U.emptyState("Quiet in here", "First word wins the moral high ground.", "💬");
      U.$$(".chat-del", list).forEach(function (b) {
        b.addEventListener("click", function () {
          NET.chatDelete(b.getAttribute("data-id")).then(function (r) {
            if (r && r.ok) { U.toast("Message removed."); fetchChatMessages(); }
            else U.toast("Couldn't remove that.");
          });
        });
      });
      if (stick) list.scrollTop = list.scrollHeight;
    });
  }

  function renderChat() {
    var mt = U.$("#clubhouse-view");
    clearInterval(chatTimer); chatTimer = null;
    if (!NET.me) { mt.innerHTML = U.emptyState("Members only", "Sign in to read and post in club chat.", "🔒"); return; }
    mt.innerHTML =
      '<div class="chat-list" id="chat-list">' + U.emptyState("Loading chat…", "", "💬") + "</div>" +
      '<form class="chat-form" id="chat-form">' +
        '<input type="text" id="chat-input" maxlength="280" placeholder="Say it like you mean it…" autocomplete="off">' +
        '<button class="btn btn-primary btn-small" id="chat-send" type="submit">Send</button>' +
        '<span class="chat-count" id="chat-count">280</span>' +
      "</form>";
    var input = U.$("#chat-input"), counter = U.$("#chat-count");
    input.oninput = function () { counter.textContent = (280 - input.value.length) + ""; };
    U.$("#chat-form").onsubmit = function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      var send = U.$("#chat-send"); send.disabled = true;
      NET.chatPost(text).then(function (r) {
        send.disabled = false;
        if (r && r.ok) { input.value = ""; counter.textContent = "280"; fetchChatMessages(); }
        else if (r && (r.code === "language" || r.error === "language")) U.toast("Mind the language — the stewards are watching.");
        else U.toast("Couldn't send. Try again.");
      });
    };
    fetchChatMessages();
    chatTimer = setInterval(fetchChatMessages, 15000);
  }

  function renderDirectory() {
    var mt = U.$("#clubhouse-view");
    mt.innerHTML = U.emptyState("Loading members…", "", "👥");
    NET.members({ limit: 50 }).then(function (res) {
      var block = liveBlock(res, "members");
      if (block) { mt.innerHTML = block; return; }
      mt.innerHTML = (res.members || []).map(function (m) {
        return '<a class="result-row" href="#profile/' + U.esc(m.username) + '"><span class="result-opp">' + U.esc(m.display) + '</span><span class="result-meta">' + U.fmtDate(m.created_iso) + "</span></a>";
      }).join("") || U.emptyState("No members yet", "", "—");
    });
  }

  /* ========================================================
     INBOX (DM)
     ======================================================== */
  PAGES.inbox = {
    enter: function () {
      var mt = U.$("#inbox-view");
      mt.innerHTML = U.emptyState("Loading your inbox…", "", "✉️");
      var startBox = '<div class="panel"><div class="field-row"><label class="field"><span class="field-label">Message a member</span><input type="text" id="dm-target" placeholder="username"></label>' +
        '<button class="btn btn-primary btn-small" id="dm-start">Start</button></div><span class="admin-inline-note" id="dm-start-msg"></span></div>';
      NET.dmConversations({ limit: 30 }).then(function (res) {
        var block = liveBlock(res, "your inbox");
        if (block) { mt.innerHTML = startBox + block; return; }
        var list = (res.conversations || []).map(function (c) {
          return '<a class="result-row" href="#conversation/' + c.id + '"><span class="result-opp">' + U.esc(c.other_display || "Member") + "</span>" +
            (c.unread ? '<span class="nav-badge">' + c.unread + "</span>" : "") +
            '<span class="result-meta">' + U.esc(c.preview || "") + " · " + U.fmtDateTime(c.last_msg_iso) + "</span></a>";
        }).join("") || U.emptyState("No conversations yet", "", "✉️");
        mt.innerHTML = startBox + list;
        U.$("#dm-start").addEventListener("click", function () {
          var uname = U.$("#dm-target").value.trim().toLowerCase();
          if (!uname) return;
          NET.dmStart(uname).then(function (r) {
            if (r && r.ok) location.hash = "#conversation/" + r.id;
            else U.$("#dm-start-msg").textContent = "✗ " + ((r && r.code) || "couldn't start");
          });
        });
      });
    }
  };

  PAGES.conversation = {
    enter: function (arg) {
      var mt = U.$("#conversation-view");
      mt.innerHTML = U.emptyState("Loading…", "", "⏱");
      NET.dmMessages(arg, { limit: 50 }).then(function (res) {
        if (!res || !res.ok) { mt.innerHTML = U.emptyState("Can't open that conversation", "", "—"); return; }
        var msgs = (res.messages || []).slice().reverse();
        mt.innerHTML = '<div class="chat-list">' + msgs.map(function (m) {
          var mine = NET.me && m.sender_id && false; // sender display not resolved client-side; show plain
          return '<div class="chat-msg dm-msg' + (mine ? " dm-mine" : "") + '">' + U.esc(m.body) + '<span class="admin-inline-note"> · ' + U.fmtDateTime(m.created_iso) +
            ' <button class="dm-report" data-id="' + m.id + '" title="Report">⚑</button></span></div>';
        }).join("") + "</div>" +
        '<div class="field-row"><input type="text" id="dm-input" maxlength="1000" placeholder="Message…"><button class="btn btn-primary btn-small" id="dm-send">Send</button></div>';
        U.$("#dm-send").addEventListener("click", function () {
          var v = U.$("#dm-input").value.trim();
          if (!v) return;
          NET.dmSend(arg, v).then(function (r) { if (r && r.ok) PAGES.conversation.enter(arg); });
        });
        U.$$(".dm-report", mt).forEach(function (btn) {
          btn.addEventListener("click", function () {
            NET.dmReport(btn.getAttribute("data-id"), "reported from inbox").then(function (r) { if (r && r.ok) U.toast("Reported to the stewards."); });
          });
        });
      });
    }
  };

  /* ========================================================
     PROFILE
     ======================================================== */
  PAGES.profile = {
    enter: function (arg) {
      var mt = U.$("#profile-view");
      mt.innerHTML = U.emptyState("Loading…", "", "⏱");
      NET.profile(arg).then(function (res) {
        if (!res || !res.ok) { mt.innerHTML = U.emptyState(res && res.error === "private" ? "Private profile" : "Member not found", "", "🔒"); return; }
        var p = res.profile;
        U.$("#profile-title").textContent = p.display;
        mt.innerHTML =
          '<div class="panel">' +
            "<h2>" + U.esc(p.display) + "</h2>" +
            (p.joinDate ? '<p class="admin-inline-note">Joined ' + U.fmtDate(p.joinDate) + "</p>" : "") +
            (p.identity ? '<p><span class="badge badge-human">' + U.esc(p.identity.name) + "</span></p>" : "") +
            (p.titles && p.titles.length ? '<p>' + p.titles.map(function (t) { return '<span class="pill">' + U.esc(t.icon || "") + " " + U.esc(t.name) + "</span>"; }).join(" ") + "</p>" : "") +
            (p.bio ? "<p>" + U.esc(p.bio) + "</p>" : "") +
            (p.linkedPlayer ? '<p><a href="#player/' + p.linkedPlayer.id + '">On the pitch: ' + U.esc(p.linkedPlayer.name) + " #" + p.linkedPlayer.number + "</a></p>" : "") +
            (NET.me && NET.me.username !== p.username ? '<button class="btn btn-primary btn-small" id="prof-dm">Message</button>' : "") +
          "</div>";
        var dmb = U.$("#prof-dm");
        if (dmb) dmb.addEventListener("click", function () { NET.dmStart(p.username).then(function (r) { if (r && r.ok) location.hash = "#conversation/" + r.id; else U.toast("Couldn't start a conversation."); }); });
      });
    }
  };

  /* ========================================================
     STATS / HONOURS / GAFFER / NEWS / SOCIAL / SEARCH / ABOUT
     ======================================================== */
  PAGES.stats = {
    enter: function () {
      var clubBox = U.$("#stats-club"), lbBox = U.$("#stats-leaders");
      clubBox.innerHTML = U.emptyState("Loading…", "", "⏱");
      NET.clubRecord().then(function (res) {
        var block = liveBlock(res, "the record");
        if (block) { clubBox.innerHTML = block; return; }
        var d = res.derived || {}, b = res.baseline || {};
        clubBox.innerHTML = U.statTile("Played", U.num(b.played) || U.num(d.played)) + U.statTile("Wins", U.num(b.wins) || U.num(d.wins), { accent: "win" }) +
          U.statTile("Draws", U.num(b.draws) || U.num(d.draws)) + U.statTile("Losses", U.num(b.losses) || U.num(d.losses), { accent: "loss" }) +
          U.statTile("Goals for", U.num(b.goalsFor) || U.num(d.goalsFor)) + U.statTile("Goals against", U.num(b.goalsAgainst) || U.num(d.goalsAgainst));
        U.runCountUps(clubBox);
      });
      var metric = "goals";
      function renderLb() {
        lbBox.innerHTML = U.emptyState("Loading…", "", "⏱");
        loadSquad().then(function () {
          NET.leaderboards({ metric: metric }).then(function (res) {
            var block = liveBlock(res, "leaderboards");
            if (block) { lbBox.innerHTML = block; return; }
            lbBox.innerHTML = '<div class="tabbar">' + ["goals", "assists", "apps", "rating"].map(function (m) {
              return '<button class="tab' + (m === metric ? " active" : "") + '" data-m="' + m + '">' + m.charAt(0).toUpperCase() + m.slice(1) + "</button>";
            }).join("") + "</div>" +
            '<div class="table-scroll"><table class="opp-table"><thead><tr><th>#</th><th>Player</th><th>' + metric + "</th></tr></thead><tbody>" +
              (res.leaderboard || []).map(function (r, i) {
                var p = U.playerById(r.player_id);
                var val = metric === "rating" ? (r.avg_rating != null ? Number(r.avg_rating).toFixed(1) : "—") : r[metric === "apps" ? "apps" : metric];
                return "<tr><td>" + (i + 1) + "</td><td>" + (p ? '<a href="#player/' + p.id + '">' + U.esc(p.name) + "</a>" : U.esc(r.player_id)) + "</td><td>" + val + "</td></tr>";
              }).join("") + "</tbody></table></div>";
            U.$$(".tabbar .tab", lbBox).forEach(function (b) { b.addEventListener("click", function () { metric = b.getAttribute("data-m"); renderLb(); }); });
          });
        });
      }
      renderLb();
    }
  };

  PAGES.honours = {
    enter: function () {
      var cabinet = U.$("#honours-cabinet"), timeline = U.$("#honours-timeline");
      cabinet.innerHTML = ""; timeline.innerHTML = U.emptyState("Loading…", "", "🏆");
      NET.seasons().then(function (res) {
        var seasons = (res && res.seasons) || [];
        timeline.innerHTML = '<div class="section-label">Seasons</div>' + (seasons.length ? seasons.map(function (s) {
          return '<div class="panel"><strong>' + U.esc(s.label) + "</strong>" + (s.id === (res.currentSeason) ? ' <span class="pill pill-win">current</span>' : "") + "</div>";
        }).join("") : U.emptyState("No seasons recorded yet", "", "—"));
      });
    }
  };

  var gafferPick = null;
  function randOf(a) { return (a && a.length) ? a[Math.floor(Math.random() * a.length)] : ""; }

  PAGES.gaffer = {
    enter: function () {
      var mount = U.$("#gaffer-box");
      loadSquad().then(function () {
        var gf = window.FUN_DEFAULTS.gaffer;
        var pinned = gf.pinned;
        function pool() {
          return gf.names.concat((window.SQUAD || []).filter(function (p) { return p.active !== false; }).map(function (p) { return p.name; }));
        }
        function quote() { return randOf(gf.quotes) || "“We go again.”"; }

        function renderCard(name, sub, allowSpin) {
          mount.innerHTML =
            '<div class="gaffer-card panel">' +
              '<span class="gaffer-eyebrow">Current gaffer</span>' +
              '<span class="gaffer-name" id="gaffer-name">' + U.esc(name) + "</span>" +
              '<span class="gaffer-sub">' + sub + "</span>" +
              (allowSpin ? '<button class="btn btn-gold" id="gaffer-spin">Appoint the gaffer</button>' : "") +
              '<p class="gaffer-terms">Contract: one matchday. Terms: vibes. Severance: a firm handshake.</p>' +
            "</div>";
          var b = U.$("#gaffer-spin");
          if (b) b.addEventListener("click", spin);
        }

        function spin() {
          var nameEl = U.$("#gaffer-name");
          var btn = U.$("#gaffer-spin");
          if (btn) btn.disabled = true;
          var names = pool();
          var t = 0, delay = 55;
          (function tick() {
            nameEl.textContent = randOf(names);
            nameEl.classList.add("spinning");
            t += delay;
            delay *= 1.13;
            if (t < 1700) setTimeout(tick, delay);
            else {
              gafferPick = randOf(names);
              nameEl.textContent = gafferPick;
              nameEl.classList.remove("spinning");
              nameEl.classList.add("landed");
              U.$(".gaffer-sub").innerHTML = U.esc(quote()) + ' <span class="gaffer-board">— appointed by the wheel</span>';
              if (btn) { btn.disabled = false; btn.textContent = "Sack & re-appoint"; }
            }
          })();
        }

        if (pinned) {
          renderCard(pinned, U.esc(quote()) + ' <span class="gaffer-board">— pinned by the board</span>', false);
        } else if (gafferPick) {
          renderCard(gafferPick, U.esc(quote()) + ' <span class="gaffer-board">— appointed by the wheel</span>', true);
          U.$("#gaffer-spin").textContent = "Sack & re-appoint";
        } else {
          renderCard("?????", "The dugout stands empty. It always does.", true);
        }
      });
    }
  };

  PAGES.news = {
    enter: function () {
      var mt = U.$("#news-view");
      mt.innerHTML = U.emptyState("Opening the Gazette…", "", "📰");
      NET.news().then(function (res) {
        var block = liveBlock(res, "the news");
        if (block) { mt.innerHTML = block; return; }
        var arts = res.news || [];
        mt.innerHTML = '<div class="news-grid">' + arts.map(function (a) {
          return '<article class="news-card' + (a.pinned ? " news-pinned" : "") + '"><div class="news-card-head"><span class="news-tag">' + U.esc(a.tag) + "</span>" +
            (a.pinned ? '<span class="news-pin" title="Pinned">📌</span>' : "") + '<span class="news-date">' + U.esc(U.fmtDate(a.date_iso)) + "</span></div>" +
            "<h2 class=\"news-title\">" + U.esc(a.title) + "</h2><p class=\"news-body\">" + U.esc(a.body).replace(/\n/g, "<br>") + "</p></article>";
        }).join("") + "</div>";
      });
    }
  };

  PAGES.social = {
    enter: function () {
      var mt = U.$("#social-view");
      if (!mt) return;
      var handle = "danwhizzy";
      var twitch = "40yrvirgil";
      var parent = location.hostname || "40yrvirgil.co.uk";
      var twitchSrc = "https://player.twitch.tv/?channel=" + encodeURIComponent(twitch) +
        "&parent=" + encodeURIComponent(parent) + "&muted=true&autoplay=true";

      mt.innerHTML =
        '<div class="section-label">@' + handle + " on TikTok</div>" +
        '<p class="screen-intro">The golden boot moonlights as a content machine. Latest uploads, straight from the source — this updates itself every time he posts.</p>' +
        '<div class="social-embed">' +
          '<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@' + handle + '" data-unique-id="' + handle + '" data-embed-type="creator" style="max-width:780px;min-width:288px;">' +
            '<section class="tiktok-card">' +
              '<span class="tiktok-card-avatar">' + handle.charAt(0).toUpperCase() + "</span>" +
              '<span class="tiktok-card-handle">@' + handle + "</span>" +
              '<span class="tiktok-card-sub">The 40Yr Virgil on TikTok</span>' +
              '<a class="btn btn-primary btn-small" target="_blank" rel="noopener" href="https://www.tiktok.com/@' + handle + '?refer=creator_embed">Open profile →</a>' +
            "</section>" +
          "</blockquote>" +
        "</div>" +
        '<p class="social-fallback">Feed not loading? TikTok’s profile widget can be temperamental — <a href="https://www.tiktok.com/@' + handle + '" target="_blank" rel="noopener">open @' + handle + " on TikTok →</a></p>" +
        '<div class="section-label">' + twitch + " on Twitch</div>" +
        '<p class="screen-intro">When the club’s live, the stream plays right here. When it’s not, Twitch shows the offline screen — hit follow so you don’t miss kickoff.</p>' +
        '<div class="twitch-embed-wrap">' +
          '<iframe class="twitch-player" src="' + twitchSrc + '" title="' + twitch + ' on Twitch" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen scrolling="no" frameborder="0"></iframe>' +
        "</div>" +
        '<div class="twitch-card twitch-card-slim">' +
          '<span class="twitch-card-handle">' + twitch + "</span>" +
          '<span class="twitch-card-sub">Live from the Betfred Arena (the sofa).</span>' +
          '<a class="btn btn-primary btn-small" target="_blank" rel="noopener" href="https://www.twitch.tv/' + twitch + '">Open on Twitch →</a>' +
        "</div>";

      // (Re)load TikTok's creator-embed widget so the blockquote hydrates.
      var old = document.getElementById("tiktok-embed-script");
      if (old) old.parentNode.removeChild(old);
      var s = document.createElement("script");
      s.id = "tiktok-embed-script";
      s.async = true;
      s.src = "https://www.tiktok.com/embed.js";
      document.body.appendChild(s);
    }
  };

  PAGES.search = {
    enter: function () {
      var input = U.$("#search-input"), view = U.$("#search-view");
      loadSquad().then(function () {
        function run() {
          var q = String(input.value || "").trim().toLowerCase();
          if (q.length < 2) { view.innerHTML = '<p class="search-hint">Keep typing…</p>'; return; }
          var out = [];
          (window.SQUAD || []).filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 8).forEach(function (p) {
            out.push('<a class="search-row" href="#player/' + p.id + '"><span class="search-kind">Player</span><span class="search-main">' + U.esc(p.name) + "</span></a>");
          });
          NET.matches({ opponent: q, limit: 6 }).then(function (res) {
            (res.matches || []).forEach(function (m) {
              out.push('<a class="search-row" href="#match/' + m.id + '"><span class="search-kind">Match</span><span class="search-main">' + U.esc(m.opponent) + "</span></a>");
            });
            view.innerHTML = out.length ? '<div class="search-results">' + out.join("") + "</div>" : '<p class="search-hint">Nothing found.</p>';
          });
        }
        if (!input.getAttribute("data-wired")) { input.setAttribute("data-wired", "1"); input.addEventListener("input", run); }
        run();
      });
    }
  };

  PAGES.about = {
    enter: function () {
      var lore = U.$("#about-lore");
      lore.hidden = true; lore.innerHTML = "";
    }
  };
  PAGES.tickets = { enter: function () { U.$("#tickets-view").innerHTML = U.emptyState("No fixtures on sale", "Check Matchday for what's coming up.", "🎟️"); } };
  PAGES.more = { enter: function () {} };
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function funCard(id, icon, title, blurb, btnLabel) {
    return '<div class="fun-card panel">' +
      '<div class="fun-card-head"><span class="fun-icon">' + icon + '</span><span class="fun-title">' + U.esc(title) + "</span></div>" +
      '<p class="fun-blurb">' + U.esc(blurb) + "</p>" +
      '<div class="fun-out" id="fun-out-' + id + '"></div>' +
      '<div class="fun-actions"><button class="btn btn-gold btn-small" id="fun-btn-' + id + '">' + U.esc(btnLabel) + "</button></div>" +
    "</div>";
  }

  PAGES.funhouse = {
    enter: function () {
      var mt = U.$("#funhouse-view");
      if (!mt) return;
      loadSquad().then(function () {
        var fun = window.FUN_DEFAULTS;
        var squad = (window.SQUAD || []).filter(function (p) { return p.active !== false; });
        function firstName(p) { return String(p.name || "").split(" ")[0]; }

        mt.innerHTML =
          '<p class="screen-intro">The club’s toy box. Everything here spins. Contract length: one click.</p>' +
          '<div class="fun-grid">' +
            funCard("gaffer", "🎩", "The Manager Spin", "The wheel appoints a gaffer from the names and the squad. No CV required.", "Appoint the gaffer") +
            funCard("xi", "🎲", "The XI the Gaffer Picked", "One tap throws out a starting eleven. Tactical merit not guaranteed.", "Pick the XI") +
            funCard("chant", "📣", "Matchday Chant Machine", "Terrace poetry, generated on demand. Best sung badly.", "Give us a song") +
            funCard("super", "🏅", "Squad Superlatives", "The club’s least official awards, handed to random names.", "Hand out awards") +
            funCard("oracle", "🔮", "The Oracle", "Ask it anything. It answers in the club’s voice: unreliably.", "Consult the Oracle") +
            funCard("rumour", "📰", "Transfer Rumour Mill", "Definitely-real gossip from sources close to the sofa.", "Start a rumour") +
          "</div>" +
          '<div class="fun-links"><a class="btn btn-ghost btn-small" href="#gaffer">🎩 Full manager wheel →</a>' +
            '<a class="btn btn-ghost btn-small" href="#book">📖 The Book of Tüpci →</a></div>';

        function out(id) { return U.$("#fun-out-" + id, mt); }
        function fill(id, html) { var o = out(id); if (o) { o.innerHTML = html; o.classList.add("fun-out-shown"); } }

        U.$("#fun-btn-gaffer", mt).addEventListener("click", function () {
          var names = fun.gaffer.names.concat(squad.map(function (p) { return p.name; }));
          fill("gaffer", "🎩 <strong>" + U.esc(randOf(names)) + "</strong> — " + U.esc(randOf(fun.gaffer.quotes)));
        });
        U.$("#fun-btn-xi", mt).addEventListener("click", function () {
          var gks = squad.filter(function (p) { return U.posGroup(p) === "GK"; });
          var others = shuffle(squad.filter(function (p) { return U.posGroup(p) !== "GK"; }));
          var xi = (gks.length ? [randOf(gks)] : []).concat(others.slice(0, 10));
          fill("xi", xi.map(function (p) { return "#" + p.number + " " + U.esc(p.name); }).join(" · "));
        });
        U.$("#fun-btn-chant", mt).addEventListener("click", function () {
          if (!squad.length) return fill("chant", "Sign someone first.");
          var p = randOf(squad);
          fill("chant", U.esc(randOf(fun.chants).replace(/\{full\}/g, p.name).replace(/\{name\}/g, firstName(p))));
        });
        U.$("#fun-btn-super", mt).addEventListener("click", function () {
          var picks = shuffle(fun.superlatives).slice(0, 3).map(function (s) {
            return '<div class="fun-award"><span class="fun-award-name">' + U.esc(randOf(squad).name || "—") + "</span> — " + U.esc(s) + "</div>";
          });
          fill("super", picks.join(""));
        });
        U.$("#fun-btn-oracle", mt).addEventListener("click", function () { fill("oracle", "🔮 " + U.esc(randOf(fun.oracle))); });
        U.$("#fun-btn-rumour", mt).addEventListener("click", function () {
          if (!squad.length) return fill("rumour", "No squad, no gossip.");
          var p = randOf(squad), opp = randOf(fun.rumourClubs);
          fill("rumour", "📰 " + U.esc(randOf(fun.rumours).replace(/\{full\}/g, p.name).replace(/\{name\}/g, firstName(p)).replace(/\{opp\}/g, opp)));
        });
      });
    }
  };
  var ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  var COMMANDMENTS = [
    "I am Tüpci thy Captain, who brought thee up out of Division 5, out of the house of relegation, and who leadeth thee toward the Elite Division. Thou shalt have no gaffers before me.",
    "Thou shalt not make unto thee any false formation, nor any likeness of a system that runs through any man but the Captain. Thou shalt not bow down to the 4-4-2.",
    "Thou shalt not move Tüpci off CAM. For the board will not hold him guiltless that draggeth his token to the wing.",
    "Remember the matchday, to keep it holy. Six days shalt thou grind the group chat, but the seventh is the fixture — thou shalt show up, and thou shalt press.",
    "Honour thy Captain and thy talisman, that thy days may be long, and thy climb to the Elite Division swift, upon the archive which the club giveth thee.",
    "Thou shalt not score in thine own net.",
    "Thou shalt not commit the flat back four when the diamond is called for.",
    "Thou shalt not steal Danwhizzy’s tap-in and claim it as a solo run. The archive remembereth who assisted.",
    "Thou shalt not bear false witness against thy router. When thou laggeth, blame thyself, not the servers — for they know not what they do, but they know thy IP.",
    "Thou shalt not covet thy opponent’s meta squad, nor his finesse shot, nor his overpowered striker, nor anything that is thy opponent’s. Trust the process. Pass to the purple shirts."
  ];
  var COMMANDMENT_XI = "Rizzy Dave stayeth on the bench. Not starting. Still dangerous. So it was written, so it shall remain.";
  var PRAYERS = [
    { title: "The Captain’s Creed", body:
      "I believe in Tüpci, the Captain almighty,\nmaker of chances and assists,\nand in the CAM, his one eternal position,\nnon-negotiable, begotten not rotated,\nof one formation with the system.\nThrough him all goals were made.\nHe is ever-present, and of his 392 games there shall be no end.\nUp the Virgil." },
    { title: "The Tüpci Prayer", body:
      "Our Captain, who art in CAM,\nhallowed be thy touch.\nThy through-ball come, thy vision be done,\nin the final third as it is in the build-up.\nGive us this day our killer pass,\nand forgive us our misplaced ones,\nas we forgive those who overhit theirs.\nLead us not into a flat 4-4-2,\nbut deliver us the system.\nFor thine is the swagger, the armband, and the assist,\nfor ever and ever. Up the Virgil." },
    { title: "Hail Tüpci", body:
      "Hail Tüpci, full of vision, the ball is with thee.\nBlessed art thou among midfielders,\nand blessed is the movement of thy runs.\nHoly Captain, spine of the side,\ndictate for us sinners now,\nand at the hour of the reset. Up the Virgil." },
    { title: "The System’s Grace", body:
      "Bless us, O Captain, and these thy lineups,\nwhich we are about to receive from thy clipboard.\nThou art at CAM. Thou wilt always be at CAM.\nWe give thanks, and we press. Amen. Up the Virgil." },
    { title: "Act of Contrition (for moving him off CAM)", body:
      "O my Captain, I am heartily sorry\nfor having dragged thy token to the wing.\nI detest my drag-and-drops,\nbut most of all because they offend thee,\nwho art the whole system.\nI firmly resolve, with the help of the reset button,\nto keep thee at CAM, to sin no more,\nand to avoid the near occasion of a diamond formation. Up the Virgil." },
    { title: "The Doxology", body:
      "Glory be to the Captain,\nand to the armband, and to the holy assist.\nAs it was in Division 5,\nis now in the archive,\nand ever shall be, 392 without end. Up the Virgil." },
    { title: "Psalm 90 (the OVR)", body:
      "The Captain is my shepherd, I shall not lack service.\nHe maketh me to run beyond in green channels,\nhe leadeth me past the still fullbacks.\nYea, though I walk through the valley of the low block,\nI will fear no press, for the system is with me.\nSurely goals and assists shall follow me all the days of the season,\nand I will dwell in the final third for ever. Up the Virgil." },
    { title: "The Ever-Present Litany", body:
      "Captain, hear us. Captain, graciously hear us.\nFrom relegation, deliver us, Tüpci.\nFrom the dropped router, deliver us, Tüpci.\nFrom the own goal, deliver us, Tüpci.\nSystem of the whole side, have mercy on us.\nEver-present of 392 games, have mercy on us.\nHe who is always CAM, pray for us. Up the Virgil." }
  ];
  function reveal(el) {
    if (!el) return;
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add("shown"); });
  }

  PAGES.book = {
    enter: function () {
      var mt = U.$("#book-view");
      if (!mt) return;
      mt.innerHTML =
        '<div class="tupci-book">' +
          '<p class="tupci-eyebrow">Brought down from Mount Betfred</p>' +
          '<h1 class="tupci-title">The Ten Commandments of Tüpci</h1>' +
          '<ol class="tupci-cmds">' +
            COMMANDMENTS.map(function (c, i) {
              return '<li><span class="tupci-num">' + ROMAN[i] + '</span><span class="tupci-text">' + U.esc(c) + "</span></li>";
            }).join("") +
          "</ol>" +
          '<button type="button" class="tupci-margin" id="tupci-xi-trigger">…and an eleventh, written small in the margin.</button>' +
          '<div class="tupci-reveal tupci-xi" id="tupci-xi" hidden></div>' +
          '<div class="tupci-reveal tupci-prayers" id="tupci-prayers" hidden></div>' +
          '<a class="back-link tupci-exit" href="#home">← close the book</a>' +
        "</div>";
      var xiTrigger = U.$("#tupci-xi-trigger", mt);
      xiTrigger.addEventListener("click", function () {
        xiTrigger.hidden = true;
        var xi = U.$("#tupci-xi", mt);
        xi.innerHTML =
          '<p class="tupci-xi-lead">And an eleventh, for it is the oldest law of all —</p>' +
          '<p class="tupci-cmd-xi"><span class="tupci-num">XI</span><span class="tupci-text">' + U.esc(COMMANDMENT_XI) + "</span></p>" +
          '<button type="button" class="tupci-amen" id="tupci-amen">Up the Virgil.</button>';
        reveal(xi);
        U.$("#tupci-amen", mt).addEventListener("click", function () {
          this.disabled = true;
          this.textContent = "Amen.";
          var pr = U.$("#tupci-prayers", mt);
          pr.innerHTML =
            '<p class="tupci-eyebrow">Deeper still — the prayers</p>' +
            PRAYERS.map(function (p) {
              return '<article class="tupci-prayer">' +
                '<h2 class="tupci-prayer-title">' + U.esc(p.title) + "</h2>" +
                '<p class="tupci-prayer-body">' + U.esc(p.body).replace(/\n/g, "<br>") + "</p>" +
              "</article>";
            }).join("");
          reveal(pr);
        });
      });
    }
  };

  PAGES.admin = { enter: function () { window.ADMIN.enter(U.$("#admin-view"), { renderAccount: renderAccount }); } };

  /* ========================================================
     BOOT
     ======================================================== */
  function boot() {
    U = window.UI; NET = window.NET;
    NET.init();
    bindNav();
    bindAuth();
    renderAccount();
    window.addEventListener("hashchange", route);
    route();

    if (NET.hasBackend()) {
      NET.session().then(function () {
        sessionChecked = true;
        renderAccount();
        var page = parseHash().name;
        if (["admin", "inbox", "conversation", "clubhouse"].indexOf(page) !== -1) route();
      });
      unreadTimer = setInterval(function () { if (NET.me) refreshUnread(); }, 45000);
    } else {
      sessionChecked = true;
      if (parseHash().name === "admin") route();
    }

    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js").catch(function () {});
      });
    }
  }

  window.APP = { openAuth: openAuth };
  document.addEventListener("DOMContentLoaded", boot);
})();
