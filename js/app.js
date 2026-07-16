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
        mt.innerHTML =
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
      fbox.innerHTML =
        '<div class="field-row">' +
          '<label class="field"><span class="field-label">Result</span><select id="af-result"><option value="">Any</option><option value="W">Win</option><option value="D">Draw</option><option value="L">Loss</option></select></label>' +
          '<label class="field"><span class="field-label">Stage</span><select id="af-stage"><option value="">Any</option><option value="league">League</option><option value="playoff">Playoff</option><option value="cup">Cup</option><option value="friendly">Friendly</option></select></label>' +
        "</div>";
      ["af-result", "af-stage"].forEach(function (id) {
        U.$("#" + id).addEventListener("change", function () {
          archiveState.filters.result = U.$("#af-result").value;
          archiveState.filters.stage = U.$("#af-stage").value;
          archiveState.cursor = null;
          renderList(true);
        });
      });
      renderList(true);
    }
  };

  function renderList(reset) {
    var list = U.$("#archive-list");
    if (reset) list.innerHTML = "";
    var q = { limit: 20, cursor: archiveState.cursor, result: archiveState.filters.result, stage: archiveState.filters.stage };
    var loading = document.createElement("div");
    loading.innerHTML = U.emptyState("Loading…", "", "⏱");
    list.appendChild(loading);
    NET.matches(q).then(function (res) {
      loading.remove();
      var block = liveBlock(res, "the archive");
      if (block) { if (reset) list.innerHTML = block; return; }
      if (reset && !res.matches.length) { list.innerHTML = U.emptyState("No matches yet", "", "📋"); return; }
      res.matches.forEach(function (m) {
        var row = document.createElement("a");
        row.className = "result-row";
        row.href = "#match/" + m.id;
        row.innerHTML = U.pill(m.result) +
          '<span class="result-opp">' + U.esc(m.opponent) + "</span>" +
          '<span class="result-score">' + (m.our_score != null ? m.our_score : "–") + "–" + (m.their_score != null ? m.their_score : "–") + "</span>" +
          '<span class="result-meta">' + U.esc(STAGE_LABEL[m.stage] || "Match") + (m.date_iso ? " · " + U.fmtDate(m.date_iso) : "") + "</span>";
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
        var p = res.player, base = res.baseline, rec = res.recorded || {};
        var pos = (p.positions || []).join(" / ") || "—";
        mt.innerHTML =
          '<div class="player-dossier">' +
            '<img class="player-portrait" src="' + U.esc(U.cardSrc(p)) + '" alt="' + U.esc(p.name) + '">' +
            "<h2>" + U.esc(p.name) + " <span class=\"player-num\">#" + p.number + "</span></h2>" +
            '<p class="player-meta">' + U.esc(pos) + " · " + U.chips(p) + "</p>" +
            (p.flavour ? '<p class="player-flavour">' + U.esc(p.flavour) + "</p>" : "") +
            (base ?
              '<div class="section-label">Career (verified)</div>' +
              '<div class="tile-row">' + U.statTile("Apps", U.num(base.apps)) + U.statTile("Goals", U.num(base.goals)) + U.statTile("Assists", U.num(base.assists)) +
                U.statTile("Avg rating", base.avg_rating != null ? Number(base.avg_rating).toFixed(1) : "—") + "</div>" +
              '<p class="screen-intro">Verified club totals' + (base.source ? " (" + U.esc(base.source) + ")" : "") + '. Detailed match data below is shown where recorded' +
              (base.as_of_seq ? " since match " + base.as_of_seq : "") + ".</p>"
              : '<p class="screen-intro">Local archive record — recording began at this club\'s first tracked match. No external baseline has been set for ' + U.esc(p.name) + " yet.</p>") +
            '<div class="section-label">Recorded contributions</div>' +
            '<div class="tile-row">' + U.statTile("Apps", U.num(rec.apps) || 0) + U.statTile("Goals", U.num(rec.goals) || 0) + U.statTile("Assists", U.num(rec.assists) || 0) +
              U.statTile("Avg rating", rec.avg_rating != null ? Number(rec.avg_rating).toFixed(1) : "—") +
              (rec.saves > 0 || rec.conceded > 0 ? U.statTile("Saves", U.num(rec.saves) || 0) + U.statTile("Conceded", U.num(rec.conceded) || 0) : "") + "</div>" +
            '<a class="back-link" href="#squad">← Squad</a>' +
          "</div>";
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

  function renderForumList() {
    var mt = U.$("#clubhouse-view");
    mt.innerHTML = U.emptyState("Loading…", "", "⏱");
    Promise.all([NET.forumCategories(), NET.forumThreads({ limit: 30 })]).then(function (rs) {
      var cats = (rs[0] && rs[0].categories) || [];
      var res = rs[1];
      var block = liveBlock(res, "the forum");
      if (block) { mt.innerHTML = block; return; }
      var newBox = NET.me ? '<div class="panel"><div class="field-row">' +
        '<label class="field"><span class="field-label">Category</span><select id="fc-cat">' + cats.map(function (c) { return '<option value="' + U.esc(c.key) + '">' + U.esc(c.name) + "</option>"; }).join("") + "</select></label>" +
        '<label class="field"><span class="field-label">Title</span><input type="text" id="fc-title" maxlength="120"></label></div>' +
        '<textarea id="fc-body" rows="3" placeholder="Say your piece…" maxlength="4000"></textarea>' +
        '<div class="admin-actions"><button class="btn btn-primary btn-small" id="fc-post">Post thread</button><span class="admin-inline-note" id="fc-msg"></span></div></div>' : "";
      mt.innerHTML = newBox + (res.threads || []).map(function (t) {
        return '<a class="result-row forum-thread-row" href="#thread/' + t.id + '">' +
          (t.pinned ? '<span class="news-pin">📌</span>' : "") +
          '<span class="result-opp">' + U.esc(t.title) + "</span>" +
          '<span class="result-meta">' + U.esc(t.category_name) + " · " + t.replies + " replies · " + U.fmtDate(t.last_iso) + "</span></a>";
      }).join("");
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

  function renderChat() {
    var mt = U.$("#clubhouse-view");
    if (!NET.me) { mt.innerHTML = U.emptyState("Members only", "Sign in to read and post in club chat.", "🔒"); return; }
    mt.innerHTML = U.emptyState("Loading chat…", "", "💬");
    NET.chatFetch({ limit: 40 }).then(function (res) {
      var block = liveBlock(res, "chat");
      if (block) { mt.innerHTML = block; return; }
      var msgs = (res.messages || []).slice().reverse();
      mt.innerHTML = '<div class="chat-list">' + msgs.map(function (m) {
        return '<div class="chat-msg"><strong>' + U.esc(m.display) + ":</strong> " + U.esc(m.body) + '<span class="admin-inline-note"> · ' + U.fmtDateTime(m.created_iso) + "</span></div>";
      }).join("") + "</div>" +
      '<div class="field-row"><input type="text" id="ch-input" maxlength="500" placeholder="Say it like you mean it…"><button class="btn btn-primary btn-small" id="ch-send">Send</button></div>';
      var send = U.$("#ch-send");
      send.addEventListener("click", function () {
        var v = U.$("#ch-input").value.trim();
        if (!v) return;
        send.disabled = true;
        NET.chatPost(v).then(function (r) { send.disabled = false; if (r && r.ok) renderChat(); });
      });
    });
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

  PAGES.gaffer = {
    enter: function () {
      var box = U.$("#gaffer-box");
      var fun = window.FUN_DEFAULTS.gaffer;
      var name = fun.pinned || (fun.names[Math.floor(Math.random() * fun.names.length)]);
      var quote = fun.quotes[Math.floor(Math.random() * fun.quotes.length)];
      box.innerHTML = '<div class="panel gaffer-card"><h2>' + U.esc(name) + "</h2><p>" + U.esc(quote) + '</p><button class="btn btn-gold" id="gaffer-spin">🎲 Spin again</button></div>';
      U.$("#gaffer-spin").addEventListener("click", function () { PAGES.gaffer.enter(); });
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
      mt.innerHTML = '<p class="screen-intro">Find the club on socials.</p>' +
        '<div class="twitch-card twitch-card-slim"><span class="twitch-card-handle">40yrvirgil</span><a class="btn btn-primary btn-small" target="_blank" rel="noopener" href="https://www.twitch.tv/40yrvirgil">Open on Twitch →</a></div>';
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
  PAGES.funhouse = { enter: function () { U.$("#funhouse-view").innerHTML = U.emptyState("The Funhouse", "The gaffer wheel, chants and lore live in Housekeeping → Fun & Games once configured.", "🎡"); } };
  PAGES.book = { enter: function () {} };

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
