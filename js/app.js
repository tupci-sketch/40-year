/* ============================================================
   The 40Yr Virgil — application core
   Hash-routed SPA: router, cached data loaders over G.NET,
   account bar + auth modal, announcement banner, and every
   public screen. Housekeeping lives in admin.js, the board in
   tactics.js. Everything numeric on these screens is live.
   ============================================================ */
(function () {
  "use strict";

  var U = null, NET = null;
  var currentPage = null;
  var sessionChecked = false; // true once the initial session check has resolved

  /* ========================================================
     DATA — memoised loaders over the backend
     ======================================================== */
  var STATE = { config: null, club: null, members: null, matches: null, results: null };
  var INFLIGHT = {};

  function load(key, fn, force) {
    if (!force && STATE[key]) return Promise.resolve(STATE[key]);
    if (!force && INFLIGHT[key]) return INFLIGHT[key];
    INFLIGHT[key] = fn().then(function (r) {
      INFLIGHT[key] = null;
      if (r && r.ok) STATE[key] = r;
      return r;
    });
    return INFLIGHT[key];
  }

  var DATA = {
    config:  function (f) { return load("config",  function () { return NET.config();  }, f); },
    club:    function (f) { return load("club",    function () { return NET.club();    }, f); },
    members: function (f) { return load("members", function () { return NET.members(); }, f); },
    results: function (f) { return load("results", function () { return NET.results(); }, f); },
    matches: function (f) { return load("matches", function () { return NET.matches(); }, f); },
    bust: function () {
      Object.keys(STATE).forEach(function (k) { STATE[k] = null; });
    }
  };
  window.DATA = DATA; // admin.js refreshes through this after pulls/edits

  function liveBlock(res, kind) {
    /* Returns null when data is usable, else the right empty-state HTML. */
    if (res && res.ok) return null;
    if (res && res.error === "offline" && NET.hasBackend()) return U.offlineState();
    return U.waitingState(kind);
  }

  /* ========================================================
     ROUTER
     ======================================================== */
  var ROUTES = ["home", "squad", "tactics", "player", "results", "stats", "honours", "gaffer", "about", "chat", "admin"];

  function parseHash() {
    var h = (location.hash || "#home").replace(/^#/, "");
    var parts = h.split("/");
    return { name: parts[0] || "home", arg: parts.slice(1).join("/") || null };
  }

  function route() {
    var r = parseHash();
    if (ROUTES.indexOf(r.name) === -1) { location.replace("#home"); return; }

    // Housekeeping is staff-only and never presented to the public. Bounce
    // anyone who isn't a known mod — but give a signed-in admin a grace window
    // while their session is still being verified (e.g. on a hard reload),
    // so we don't kick them out before we know who they are.
    if (r.name === "admin" && !NET.isMod()) {
      var pending = NET.hasBackend() && NET.hasStoredSession() && !sessionChecked;
      if (!pending) { location.replace("#home"); return; }
    }

    if (currentPage && PAGES[currentPage] && PAGES[currentPage].leave) PAGES[currentPage].leave();
    currentPage = r.name;

    U.$$(".screen").forEach(function (s) { s.classList.remove("active"); });
    var scr = U.$("#screen-" + r.name);
    void scr.offsetWidth; // restart the entry animation
    scr.classList.add("active");

    U.$$(".nav-link").forEach(function (a) {
      var on = a.getAttribute("data-route") === r.name;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });

    document.body.classList.remove("nav-open");
    window.scrollTo(0, 0);
    PAGES[r.name].enter(r.arg);
  }

  /* ========================================================
     ACCOUNT BAR · AUTH MODAL · BANNER
     ======================================================== */
  function renderAccount() {
    var bar = U.$("#account-bar");
    if (NET.me) {
      var chip = NET.isAdmin() ? '<span class="level-chip level-admin">ADMIN</span>'
               : NET.isMod()   ? '<span class="level-chip level-mod">MOD</span>' : "";
      bar.innerHTML =
        '<span class="account-name">' + U.esc(NET.me.name) + '</span>' + chip +
        '<button class="btn btn-ghost btn-small" id="btn-signout">Sign out</button>';
      U.$("#btn-signout").addEventListener("click", function () {
        NET.logout().then(function () {
          renderAccount();
          U.toast("Signed out. The badge remembers you.");
          if (parseHash().name === "admin") location.hash = "#home"; else route();
        });
      });
    } else if (!NET.hasBackend()) {
      bar.innerHTML = '<span class="account-muted">Offline build · set APP_URL</span>';
    } else {
      bar.innerHTML =
        '<span class="account-muted">Not signed in</span>' +
        '<button class="btn btn-ghost btn-small" id="btn-open-auth">Sign in · Register</button>';
      U.$("#btn-open-auth").addEventListener("click", function () { openAuth("login"); });
    }
    U.$("#nav-admin").hidden = !NET.isMod();
  }

  var AUTH_ERR = {
    offline: "Clubhouse unreachable. Try again in a moment.",
    exists: "That name is already on the team sheet.",
    auth: "Wrong name or password.",
    name: "Names: 2–20 letters, numbers, spaces, _ . -",
    pass: "Password needs at least 6 characters.",
    language: "That name won't get past the stewards.",
    banned: "This account is banned.",
    session: "Session expired — sign in again."
  };

  function openAuth(tab) {
    var m = U.$("#auth-modal");
    m.hidden = false;
    setAuthTab(tab || "login");
    setTimeout(function () { var f = U.$("#auth-name"); if (f) f.focus(); }, 50);
  }
  function closeAuth() {
    U.$("#auth-modal").hidden = true;
    U.$("#auth-error").textContent = "";
    U.$("#auth-form").reset();
  }
  function setAuthTab(tab) {
    U.$$(".auth-tab").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === tab); });
    U.$("#auth-modal").setAttribute("data-mode", tab);
    U.$("#auth-confirm-row").hidden = tab !== "register";
    U.$("#auth-submit").textContent = tab === "register" ? "Register" : "Sign in";
    U.$("#auth-error").textContent = "";
  }

  function bindAuth() {
    U.$$(".auth-tab").forEach(function (b) {
      b.addEventListener("click", function () { setAuthTab(b.getAttribute("data-tab")); });
    });
    U.$("#auth-close").addEventListener("click", closeAuth);
    U.$("#auth-modal").addEventListener("click", function (e) { if (e.target.id === "auth-modal") closeAuth(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !U.$("#auth-modal").hidden) closeAuth();
    });

    U.$("#auth-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var mode = U.$("#auth-modal").getAttribute("data-mode");
      var name = U.$("#auth-name").value.trim();
      var pass = U.$("#auth-pass").value;
      var err = U.$("#auth-error");
      err.textContent = "";

      if (mode === "register") {
        if (pass !== U.$("#auth-confirm").value) { err.textContent = "Passwords don't match."; return; }
        if (pass.length < 6) { err.textContent = AUTH_ERR.pass; return; }
      }
      var btn = U.$("#auth-submit");
      btn.disabled = true;
      var p = mode === "register" ? NET.register(name, pass) : NET.login(name, pass);
      p.then(function (r) {
        btn.disabled = false;
        if (r && r.ok) {
          closeAuth();
          renderAccount();
          U.toast(mode === "register"
            ? "Signed, sealed, registered. Welcome, " + r.name + "."
            : "Welcome back, " + r.name + ".");
          route(); // refresh anything gated
        } else {
          var code = r && r.error;
          if (code && !AUTH_ERR[code]) console.error("[auth] backend returned:", code, r);
          err.textContent = AUTH_ERR[code] || ("Something went wrong" + (code ? " (" + code + ")" : "") + ". Try again.");
        }
      });
    });
  }

  function applyConfig(res) {
    if (!res || !res.ok || !res.config) return;
    var c = res.config;
    var bn = U.$("#site-banner");
    if (c.banner && c.banner.active && c.banner.text) {
      bn.hidden = false;
      U.$("#site-banner-text").textContent = c.banner.text;
    } else {
      bn.hidden = true;
    }
  }

  function cfg() { return (STATE.config && STATE.config.config) || {}; }

  function flavourOf(p) {
    var fl = cfg().flavour || {};
    return fl[p.id] || p.flavour;
  }

  /* ========================================================
     PAGES
     ======================================================== */
  var PAGES = {};

  /* ------------------------------------------------ HOME */
  PAGES.home = {
    enter: function () {
      var live = U.$("#home-live");
      live.innerHTML = '<div class="tile-row">' + U.statTile("League position", null, { sub: "syncing…" }) + "</div>";

      DATA.club().then(function (res) {
        var block = liveBlock(res, "league data");
        if (block) { live.innerHTML = block; return; }
        var latest = res.latest || {};
        var s = latest.seasonal || {};
        var o = latest.overall || {};
        var division = U.pick(s, "currentDivision", "division", "bestDivision");
        var points = U.num(U.pick(s, "points", "seasonPoints"));
        var rec = [U.pick(s, "wins") != null ? s : o].map(function (src) {
          var w = U.num(U.pick(src, "wins")), d = U.num(U.pick(src, "ties", "draws")), l = U.num(U.pick(src, "losses"));
          return (w == null) ? null : (w + " – " + (d == null ? 0 : d) + " – " + (l == null ? 0 : l));
        })[0];
        var played = U.num(U.pick(s, "gamesPlayed")) != null ? U.num(s.gamesPlayed) : U.num(U.pick(o, "gamesPlayed"));

        live.innerHTML =
          '<div class="tile-row">' +
            U.statTile("Division", division != null ? String(division) : null, { accent: "gold" }) +
            U.statTile("Points", points, { accent: "electric" }) +
            U.statTile("Played", played) +
            U.statTile("Record W–D–L", rec) +
          "</div>" +
          '<p class="sync-note">Live from the archive · synced ' + U.fmtDateTime(latest.pulledISO) + "</p>";
        U.runCountUps(live);
      });
    }
  };

  /* ------------------------------------------------ SQUAD */
  var squadFilter = { group: "ALL", control: "ALL" };

  PAGES.squad = {
    enter: function () {
      var bar = U.$("#squad-filters");
      bar.innerHTML =
        '<div class="filter-group" role="group" aria-label="Filter by position">' +
          ["ALL", "GK", "DEF", "MID", "ATT"].map(function (g) {
            return '<button class="filter-btn' + (squadFilter.group === g ? " active" : "") + '" data-g="' + g + '">' + g + "</button>";
          }).join("") +
        "</div>" +
        '<div class="filter-group" role="group" aria-label="Filter by controller">' +
          ["ALL", "HUMAN", "AI"].map(function (c) {
            return '<button class="filter-btn' + (squadFilter.control === c ? " active" : "") + '" data-c="' + c + '">' + c + "</button>";
          }).join("") +
        "</div>";

      U.$$(".filter-btn", bar).forEach(function (b) {
        b.addEventListener("click", function () {
          if (b.hasAttribute("data-g")) squadFilter.group = b.getAttribute("data-g");
          else squadFilter.control = b.getAttribute("data-c");
          PAGES.squad.enter();
        });
      });

      var list = window.SQUAD.slice().sort(function (a, b) { return a.number - b.number; })
        .filter(function (p) {
          if (squadFilter.group !== "ALL" && U.posGroup(p) !== squadFilter.group) return false;
          if (squadFilter.control === "HUMAN" && p.controlledBy !== "human") return false;
          if (squadFilter.control === "AI" && p.controlledBy !== "bot") return false;
          return true;
        });

      U.$("#squad-grid").innerHTML = list.length
        ? list.map(U.cardTile).join("")
        : U.emptyState("Nobody fits that filter", "Even Rizzy Dave is somewhere.", "🔍");
    }
  };

  /* ------------------------------------------------ PLAYER */
  /* ------------------------------------------------ PLAYER */
  var POS_LABEL = {
    GK: "Goalkeeper", RB: "Right back", LB: "Left back", CB: "Centre back",
    DM: "Defensive mid", CM: "Centre mid", LM: "Left mid", RM: "Right mid",
    CAM: "Attacking mid", LW: "Left wing", RW: "Right wing",
    ST: "Striker", LST: "Striker (L)", RST: "Striker (R)"
  };

  function rolesBlock(p) {
    var rows = Object.keys(window.FORMATIONS).map(function (fkey) {
      var role = (p.roles && p.roles[fkey]) || {};
      var cell;
      if (role.start) {
        var pos = role.pos || p.position;
        var label = POS_LABEL[pos] || pos;
        cell = '<span class="role-pos">' + U.esc(pos) + '</span><span class="role-label">' + U.esc(label) + "</span>";
      } else {
        cell = '<span class="role-bench">Bench</span>';
      }
      return '<div class="role-row">' +
        '<span class="role-formation">' + U.esc(fkey) + "</span>" + cell +
      "</div>";
    }).join("");

    var foot = p.permaBench ? "Every formation. Same seat. He's made it his."
      : p.isCaptain ? "Three shapes, one position. That's the deal."
      : "How the gaffer lines him up, shape by shape.";

    return '<div class="section-label">Where he plays</div>' +
      '<div class="roles-block">' + rows + '<p class="roles-foot">' + foot + "</p></div>";
  }

  PAGES.player = {
    enter: function (id) {
      var p = U.playerById(id);
      if (!p) { location.replace("#squad"); return; }
      var box = U.$("#player-view");

      var benchGag = p.permaBench
        ? '<div class="bench-meter-block">' +
            '<div class="bench-meter-head"><span>Appearances</span><span class="bench-meter-live">LIVE</span></div>' +
            '<div class="bench-meter"><div class="bench-meter-fill" id="bench-meter-fill"></div></div>' +
            '<p class="bench-meter-note">The meter is connected. The meter is patient.</p>' +
          "</div>"
        : "";

      box.innerHTML =
        '<div class="profile">' +
          '<div class="profile-hero">' +
            '<img src="assets/img/' + p.card + '" alt="' + U.esc(p.name) + " — official Season 2 player card" + '" decoding="async">' +
          "</div>" +
          '<div class="profile-info">' +
            '<span class="profile-num">#' + p.number + "</span>" +
            '<h1 class="profile-name">' + U.esc(p.name) + "</h1>" +
            '<div class="profile-meta"><span class="profile-pos">' + U.esc(p.position) + "</span>" + U.chips(p) + "</div>" +
            '<p class="profile-flavour">' + U.esc(flavourOf(p)) + "</p>" +
            (p.isCaptain ? '<p class="profile-line profile-captain-line">Wears the armband. Picks the formation. Plays CAM in all of them.</p>' : "") +
            benchGag +
            rolesBlock(p) +
            '<div class="section-label">Season record <span class="live-dot" title="Live from the EA archive"></span></div>' +
            '<div id="player-stats">' + '<div class="tile-row">' + U.statTile("Apps", null) + U.statTile("Goals", null) + U.statTile("Assists", null) + "</div>" + "</div>" +
            '<a class="btn btn-ghost btn-small" href="#squad">← Back to squad</a>' +
          "</div>" +
        "</div>";

      DATA.members().then(function (res) {
        var mount = U.$("#player-stats");
        var block = liveBlock(res, "player stats");
        if (block) { mount.innerHTML = block; return; }
        var m = U.findMemberFor(p, res.members || []);
        if (!m) {
          mount.innerHTML = U.emptyState(
            p.controlledBy === "human" ? "No EA record matched yet" : "Club AI — no member record",
            p.controlledBy === "human"
              ? "Set this player's eaPersona in js/data.js after the first pull, or check Housekeeping."
              : "EA only tracks club-member personas. The slot-fillers play in silence.",
            "—"
          );
          return;
        }
        var apps = U.num(m.games);
        var winp = m.raw && m.raw.winRate != null ? U.num(m.raw.winRate) : U.winPct(m.wins, m.games);
        var rating = m.ratingAve !== "" && m.ratingAve != null ? Number(m.ratingAve).toFixed(1) : null;

        mount.innerHTML =
          '<div class="tile-row">' +
            U.statTile("Apps", apps) +
            U.statTile("Goals", U.num(m.goals), { accent: p.goldenBoot ? "gold" : "" }) +
            U.statTile("Assists", U.num(m.assists)) +
            U.statTile("Avg rating", rating) +
            U.statTile("MOTM", U.num(m.motm)) +
            U.statTile("Win %", winp, { suffix: "%" }) +
          "</div>" +
          '<p class="sync-note">EA persona: ' + U.esc(m.persona) + "</p>";
        U.runCountUps(mount);

        if (p.permaBench) {
          var most = 0;
          (res.members || []).forEach(function (x) { most = Math.max(most, U.num(x.games) || 0); });
          var fill = U.$("#bench-meter-fill");
          if (fill) fill.style.width = (most ? Math.min(100, ((apps || 0) / most) * 100) : 0) + "%";
        }
      });
    }
  };

  /* ------------------------------------------------ RESULTS */
  PAGES.results = {
    enter: function () {
      var mount = U.$("#results-list");
      mount.innerHTML = U.emptyState("Pulling the record…", "", "⏱");

      DATA.results().then(function (res) {
        var block = liveBlock(res, "results");
        if (block) { mount.innerHTML = block; return; }
        var list = res.results || [];
        if (!list.length) { mount.innerHTML = U.waitingState("matches"); return; }

        mount.innerHTML = list.map(function (r, i) {
          var typeTag = r.source === "manual"
            ? '<span class="result-tag result-tag-manual" title="Entered by the club — the API never caught this one">Manual</span>'
            : '<span class="result-tag">' + (r.type === "playoffMatch" ? "Playoff" : "League") + "</span>";
          var scorers = U.scorersLine(r.scorers);
          var theirs = (r.theirPlayers || []).slice().sort(function (a, b) { return (Number(b.rating) || 0) - (Number(a.rating) || 0); });

          var oppPanel =
            '<details class="opp-panel">' +
              "<summary>Opposition · " + U.esc(r.opponent || "Unknown") + "</summary>" +
              (theirs.length
                ? '<table class="opp-table"><thead><tr><th>Player</th><th>G</th><th>A</th><th>Rating</th></tr></thead><tbody>' +
                  theirs.map(function (t) {
                    return "<tr><td>" + U.esc(t.name) + "</td><td>" + (t.goals != null ? t.goals : "—") + "</td><td>" +
                      (t.assists != null ? t.assists : "—") + "</td><td>" + (t.rating != null ? Number(t.rating).toFixed(1) : "—") + "</td></tr>";
                  }).join("") + "</tbody></table>"
                : '<p class="opp-empty">' + (r.source === "manual" ? "Manual entry — no opposition data was captured." : "No opponent player stats came back for this one.") + "</p>") +
              (r.note ? '<p class="result-note">📝 ' + U.esc(r.note) + "</p>" : "") +
            "</details>";

          return '<article class="result-row" style="animation-delay:' + Math.min(i * 40, 400) + 'ms">' +
            '<div class="result-main">' +
              U.pill(r.result) +
              '<div class="result-mid">' +
                '<span class="result-line"><strong>The 40Yr Virgil</strong> <span class="result-score">' +
                  (r.ourGoals != null ? r.ourGoals : "–") + " — " + (r.theirGoals != null ? r.theirGoals : "–") +
                "</span> " + U.esc(r.opponent || "Unknown") + "</span>" +
                (scorers ? '<span class="result-scorers">⚽ ' + scorers + "</span>" : "") +
              "</div>" +
              '<div class="result-side"><span class="result-date">' + U.fmtDate(r.ts) + "</span>" + typeTag + "</div>" +
            "</div>" + oppPanel +
          "</article>";
        }).join("");
      });
    }
  };

  /* ------------------------------------------------ STATS */
  function lb(title, rows, fmt) {
    if (!rows.length) return "";
    return '<div class="panel lb-panel"><div class="section-label">' + title + "</div><ol class='lb'>" +
      rows.map(function (r) {
        var p = U.squadFor(r.persona);
        var who = p
          ? '<a href="#player/' + p.id + '">' + U.esc(p.name) + "</a> " + U.controlBadge(p)
          : U.esc(r.persona);
        return "<li><span class='lb-name'>" + who + "</span><span class='lb-val'>" + fmt(r) + "</span></li>";
      }).join("") + "</ol></div>";
  }

  PAGES.stats = {
    enter: function () {
      var clubMt = U.$("#stats-club");
      var lbMt = U.$("#stats-leaders");
      var oppMt = U.$("#stats-opposition");
      clubMt.innerHTML = U.emptyState("Counting…", "", "⏱");
      lbMt.innerHTML = "";
      oppMt.innerHTML = "";

      DATA.club().then(function (res) {
        var block = liveBlock(res, "club stats");
        if (block) { clubMt.innerHTML = block; return; }
        var o = (res.latest && res.latest.overall) || {};
        var s = (res.latest && res.latest.seasonal) || {};
        var gf = U.num(U.pick(o, "goals")), ga = U.num(U.pick(o, "goalsAgainst"));
        clubMt.innerHTML =
          '<div class="tile-row">' +
            U.statTile("Division", U.pick(s, "currentDivision", "division") != null ? String(U.pick(s, "currentDivision", "division")) : null, { accent: "gold" }) +
            U.statTile("Points", U.num(U.pick(s, "points"))) +
            U.statTile("Played", U.num(U.pick(o, "gamesPlayed"))) +
            U.statTile("Wins", U.num(U.pick(o, "wins")), { accent: "win" }) +
            U.statTile("Draws", U.num(U.pick(o, "ties", "draws")), { accent: "draw" }) +
            U.statTile("Losses", U.num(U.pick(o, "losses")), { accent: "loss" }) +
            U.statTile("Goals for", gf) +
            U.statTile("Goals against", ga) +
            U.statTile("Win %", U.winPct(U.pick(o, "wins"), U.pick(o, "gamesPlayed")), { suffix: "%" }) +
          "</div>" +
          '<p class="sync-note">Synced ' + U.fmtDateTime(res.latest && res.latest.pulledISO) + "</p>";
        U.runCountUps(clubMt);
      });

      DATA.members().then(function (res) {
        var block = liveBlock(res, "leaderboards");
        if (block) { lbMt.innerHTML = block; return; }
        var ms = (res.members || []).slice();
        if (!ms.length) { lbMt.innerHTML = U.waitingState("member stats"); return; }
        function by(k) { return ms.slice().sort(function (a, b) { return (U.num(b[k]) || 0) - (U.num(a[k]) || 0); }).filter(function (m) { return (U.num(m[k]) || 0) > 0 || k === "games"; }); }
        var rated = ms.filter(function (m) { return (U.num(m.games) || 0) > 0 && m.ratingAve !== "" && m.ratingAve != null; })
          .sort(function (a, b) { return Number(b.ratingAve) - Number(a.ratingAve); });

        lbMt.innerHTML =
          '<div class="lb-grid">' +
            lb("Golden Boot race", by("goals"), function (m) { return m.goals; }) +
            lb("Assists", by("assists"), function (m) { return m.assists; }) +
            lb("Appearances", by("games"), function (m) { return m.games; }) +
            lb("Average rating", rated, function (m) { return Number(m.ratingAve).toFixed(1); }) +
            lb("Man of the Match", by("motm"), function (m) { return m.motm; }) +
          "</div>" +
          '<p class="sync-note">Humans and member-bots both count. The badge doesn\u2019t discriminate.</p>';
      });

      DATA.results().then(function (res) {
        if (!res || !res.ok) { oppMt.innerHTML = ""; return; }
        var list = res.results || [];
        if (!list.length) { oppMt.innerHTML = ""; return; }

        var byOpp = {};
        var oppScorers = {};
        list.forEach(function (r) {
          var k = (r.opponent || "Unknown").trim();
          byOpp[k] = byOpp[k] || { name: k, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
          var rec = byOpp[k];
          rec.p++;
          if (r.result === "W") rec.w++; else if (r.result === "D") rec.d++; else if (r.result === "L") rec.l++;
          rec.gf += U.num(r.ourGoals) || 0;
          rec.ga += U.num(r.theirGoals) || 0;
          (r.theirPlayers || []).forEach(function (t) {
            var g = U.num(t.goals) || 0;
            if (!g) return;
            var key = t.name + "|" + k;
            oppScorers[key] = oppScorers[key] || { name: t.name, club: k, goals: 0 };
            oppScorers[key].goals += g;
          });
        });

        var opps = Object.keys(byOpp).map(function (k) { return byOpp[k]; })
          .sort(function (a, b) { return b.p - a.p || a.name.localeCompare(b.name); });
        var villains = Object.keys(oppScorers).map(function (k) { return oppScorers[k]; })
          .sort(function (a, b) { return b.goals - a.goals; }).slice(0, 6);

        oppMt.innerHTML =
          '<div class="section-label">Opposition</div>' +
          '<div class="panel">' +
            '<table class="opp-table opp-table-wide"><thead><tr><th>Opponent</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th></tr></thead><tbody>' +
            opps.map(function (o) {
              return "<tr><td>" + U.esc(o.name) + "</td><td>" + o.p + "</td><td>" + o.w + "</td><td>" + o.d + "</td><td>" + o.l + "</td><td>" + o.gf + "</td><td>" + o.ga + "</td></tr>";
            }).join("") +
            "</tbody></table>" +
          "</div>" +
          (villains.length
            ? '<div class="panel"><div class="section-label">Scored against us</div><ol class="lb">' +
              villains.map(function (v) {
                return "<li><span class='lb-name'>" + U.esc(v.name) + ' <span class="lb-club">' + U.esc(v.club) + "</span></span><span class='lb-val'>" + v.goals + "</span></li>";
              }).join("") + "</ol></div>"
            : "");
      });
    }
  };

  /* ------------------------------------------------ HONOURS */
  PAGES.honours = {
    enter: function () {
      var cab = U.$("#honours-cabinet");
      var tl = U.$("#honours-timeline");
      cab.innerHTML = U.emptyState("Opening the cabinet…", "", "⏱");
      tl.innerHTML = "";

      Promise.all([DATA.club(), DATA.config()]).then(function (out) {
        var club = out[0];
        var items = [{
          ts: "2024-01-01T00:00:00Z",
          dateLabel: "2024",
          title: "Club founded",
          sub: "Fifteen names on a sheet, one badge, zero doubts. Est. 2024."
        }];

        if (club && club.ok) {
          var o = (club.latest && club.latest.overall) || {};
          var tiles = [];
          var best = U.pick(o, "bestDivision");
          var promos = U.num(U.pick(o, "promotions"));
          var titles = U.num(U.pick(o, "titlesWon", "leagueWins", "titles"));
          if (best != null)  tiles.push(U.statTile("Best division", String(best), { accent: "gold" }));
          if (titles != null) tiles.push(U.statTile("Titles", titles, { accent: "electric" }));
          if (promos != null) tiles.push(U.statTile("Promotions", promos, { accent: "win" }));
          var releg = U.num(U.pick(o, "relegations"));
          if (releg != null) tiles.push(U.statTile("Relegations", releg, { accent: "loss", sub: "character building" }));
          cab.innerHTML = tiles.length
            ? '<div class="tile-row">' + tiles.join("") + "</div>"
            : U.waitingState("honours");
          U.runCountUps(cab);

          // Division movements from the saved time series
          var hist = club.history || [];
          var prev = null;
          hist.forEach(function (h) {
            var d = U.num(h.division);
            if (d == null) return;
            if (prev != null && d !== prev) {
              items.push({
                ts: h.t,
                dateLabel: U.fmtDate(h.t),
                title: d < prev ? "Promoted to Division " + d : "Relegated to Division " + d,
                sub: d < prev ? "The climb is real. The archive saw it happen." : "A tactical regroup. Officially.",
                tone: d < prev ? "up" : "down"
              });
            }
            prev = d;
          });
        } else {
          cab.innerHTML = liveBlock(club, "honours");
        }

        var ms = (cfg().milestones || []);
        ms.forEach(function (m) {
          items.push({ ts: m.dateISO, dateLabel: U.fmtDate(m.dateISO), title: m.text, sub: "", tone: "note" });
        });

        items.sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });

        tl.innerHTML =
          '<div class="section-label">The story so far</div>' +
          '<div class="timeline">' +
            items.map(function (it) {
              return '<div class="timeline-item' + (it.tone ? " timeline-" + it.tone : "") + '">' +
                '<span class="timeline-dot"></span>' +
                '<span class="timeline-date">' + U.esc(it.dateLabel) + "</span>" +
                '<span class="timeline-title">' + U.esc(it.title) + "</span>" +
                (it.sub ? '<span class="timeline-sub">' + U.esc(it.sub) + "</span>" : "") +
              "</div>";
            }).join("") +
          "</div>" +
          (items.length <= 1
            ? '<p class="sync-note">Division movements appear here automatically as the archive grows. Milestones can be added from Housekeeping.</p>'
            : "");
      });
    }
  };

  /* ------------------------------------------------ GAFFER */
  var gafferPick = null;

  PAGES.gaffer = {
    enter: function () {
      var mount = U.$("#gaffer-box");
      var pinned = cfg().gaffer;

      function pool() {
        return window.GAFFER_NAMES.concat(window.SQUAD.map(function (p) { return p.name; }));
      }
      function quote() {
        return window.GAFFER_QUOTES[Math.floor(Math.random() * window.GAFFER_QUOTES.length)];
      }

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
          nameEl.textContent = names[Math.floor(Math.random() * names.length)];
          nameEl.classList.add("spinning");
          t += delay;
          delay *= 1.13;
          if (t < 1700) setTimeout(tick, delay);
          else {
            gafferPick = names[Math.floor(Math.random() * names.length)];
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
    }
  };

  /* ------------------------------------------------ ABOUT */
  PAGES.about = {
    enter: function () {
      DATA.config().then(function () {
        var loreMt = U.$("#about-lore");
        var lore = (cfg().lore || "").trim();
        if (lore) {
          loreMt.hidden = false;
          loreMt.innerHTML =
            '<div class="section-label">The lore</div>' +
            '<div class="panel lore-panel"><p>' + U.esc(lore).replace(/\n/g, "</p><p>") + "</p></div>";
        } else {
          loreMt.hidden = true;
          loreMt.innerHTML = "";
        }
      });
    }
  };

  /* ------------------------------------------------ CHAT */
  var chatTimer = null;
  var chatLoadedOnce = false;

  function renderChatGate() {
    var gate = U.$("#chat-gate");
    var input = U.$("#chat-input");
    var send = U.$("#chat-send");
    if (NET.me) {
      gate.hidden = true;
      input.disabled = false;
      send.disabled = false;
      input.placeholder = "Say it like you mean it…";
    } else {
      gate.hidden = false;
      input.disabled = true;
      send.disabled = true;
      input.placeholder = "Sign in to join the chat";
      U.$("#chat-gate-btn").onclick = function () {
        if (!NET.hasBackend()) { U.toast("Connect the backend first (js/config.js)."); return; }
        openAuth("login");
      };
    }
  }

  function fetchChat() {
    var list = U.$("#chat-list");
    NET.chatFetch().then(function (res) {
      if (!res || !res.ok) {
        if (!chatLoadedOnce) list.innerHTML = liveBlock(res, "chat") || "";
        return;
      }
      chatLoadedOnce = true;
      var msgs = res.messages || [];
      var stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;
      list.innerHTML = msgs.length
        ? msgs.map(function (m) {
            var lvl = Number(m.level) >= 9 ? '<span class="level-chip level-admin">ADMIN</span>'
                    : Number(m.level) >= 5 ? '<span class="level-chip level-mod">MOD</span>' : "";
            var del = NET.isMod()
              ? '<button class="chat-del" data-id="' + U.esc(m.id) + '" title="Remove message">×</button>' : "";
            var mine = NET.me && m.name === NET.me.name;
            return '<div class="chat-msg' + (mine ? " chat-mine" : "") + '">' +
              '<div class="chat-meta"><span class="chat-name">' + U.esc(m.name) + "</span>" + lvl +
              '<span class="chat-ts">' + U.fmtDateTime(m.ts) + "</span>" + del + "</div>" +
              '<div class="chat-text">' + U.esc(m.text) + "</div>" +
            "</div>";
          }).join("")
        : U.emptyState("Quiet in here", "First word wins the moral high ground.", "💬");

      U.$$(".chat-del", list).forEach(function (b) {
        b.addEventListener("click", function () {
          NET.chatDelete(b.getAttribute("data-id")).then(function (r) {
            if (r && r.ok) { U.toast("Message removed."); fetchChat(); }
            else U.toast("Couldn't remove that.");
          });
        });
      });
      if (stick) list.scrollTop = list.scrollHeight;
    });
  }

  PAGES.chat = {
    enter: function () {
      renderChatGate();
      var input = U.$("#chat-input");
      var counter = U.$("#chat-count");
      input.oninput = function () { counter.textContent = (280 - input.value.length) + ""; };
      counter.textContent = (280 - input.value.length) + "";

      U.$("#chat-form").onsubmit = function (e) {
        e.preventDefault();
        var text = input.value.trim();
        if (!text) return;
        if (text.length > 280) { U.toast("280 characters. Broadcast discipline."); return; }
        U.$("#chat-send").disabled = true;
        NET.chatPost(text).then(function (r) {
          U.$("#chat-send").disabled = false;
          if (r && r.ok) { input.value = ""; counter.textContent = "280"; fetchChat(); }
          else if (r && r.error === "language") U.toast("Mind the language — the stewards are watching.");
          else if (r && r.error === "banned") U.toast("This account is banned from the chat.");
          else if (r && (r.error === "auth" || r.error === "session")) { U.toast("Session expired — sign in again."); NET.me = null; renderAccount(); renderChatGate(); }
          else U.toast("Couldn't send. Try again.");
        });
      };

      fetchChat();
      clearInterval(chatTimer);
      if (NET.hasBackend()) chatTimer = setInterval(fetchChat, 15000);
    },
    leave: function () {
      clearInterval(chatTimer);
      chatTimer = null;
    }
  };

  /* ------------------------------------------------ ADMIN (delegates) */
  PAGES.admin = {
    enter: function () { window.ADMIN.enter(U.$("#admin-view"), { renderAccount: renderAccount, applyConfig: applyConfig }); }
  };

  /* ------------------------------------------------ TACTICS (delegates) */
  PAGES.tactics = {
    enter: function () { window.TACTICS.enter(U.$("#tactics-view")); }
  };

  /* ========================================================
     BOOT
     ======================================================== */
  function bindNav() {
    U.$("#nav-toggle").addEventListener("click", function () {
      document.body.classList.toggle("nav-open");
    });
    U.$$(".nav-link").forEach(function (a) {
      a.addEventListener("click", function () { document.body.classList.remove("nav-open"); });
    });
  }

  function boot() {
    U = window.UI;
    NET = window.NET;
    NET.init();
    bindNav();
    bindAuth();
    renderAccount();
    window.addEventListener("hashchange", route);
    route();

    DATA.config().then(function (res) {
      applyConfig(res);
      if (parseHash().name === "about") PAGES.about.enter();
    });

    if (NET.hasBackend()) {
      NET.session().then(function () {
        sessionChecked = true;
        renderAccount();
        var page = parseHash().name;
        if (page === "chat" || page === "admin") route();
      });
    } else {
      sessionChecked = true;
      if (parseHash().name === "admin") route(); // bounce — no backend, no staff area
    }
  }

  window.APP = { openAuth: openAuth };

  document.addEventListener("DOMContentLoaded", boot);
})();
