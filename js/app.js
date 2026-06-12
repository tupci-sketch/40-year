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
  var STATE = { config: null, matches: null, career: null, record: null };
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
    matches: function (f) { return load("matches", function () { return NET.matches(); }, f); },
    career:  function (f) { return load("career",  function () { return NET.career();  }, f); },
    record:  function (f) { return load("record",  function () { return NET.record();  }, f); },
    bust: function () {
      Object.keys(STATE).forEach(function (k) { STATE[k] = null; });
    }
  };
  window.DATA = DATA; // admin.js refreshes through this after edits

  function liveBlock(res, kind) {
    /* Returns null when data is usable, else the right empty-state HTML. */
    if (res && res.ok) return null;
    if (res && res.error === "offline" && NET.hasBackend()) return U.offlineState();
    return U.waitingState(kind);
  }

  /* ========================================================
     ARCHIVE MATHS — shared club/career calculators
     ======================================================== */
  function goalsByPlayer(matches) {
    var map = {};
    (matches || []).forEach(function (m) {
      (m.scorers || []).forEach(function (s) {
        map[s.id] = (map[s.id] || 0) + (Number(s.goals) || 0);
      });
    });
    return map;
  }

  function hatTricks(matches) {
    var out = [];
    (matches || []).forEach(function (m) {
      (m.scorers || []).forEach(function (s) {
        if (Number(s.goals) >= 3) out.push({ id: s.id, goals: Number(s.goals), opponent: m.opponent, seq: m.seq, result: m.result });
      });
    });
    return out;
  }

  /* Club totals = stored baseline + every match after the baseline seq. */
  function computeRecord(record, matches, baselineSeq) {
    var r = {
      badge: record.badge || "",
      wins: Number(record.wins) || 0,
      draws: Number(record.draws) || 0,
      losses: Number(record.losses) || 0,
      played: Number(record.played) || 0,
      goalsFor: Number(record.goalsFor) || 0,
      goalsAgainst: Number(record.goalsAgainst) || 0
    };
    (matches || []).forEach(function (m) {
      if (Number(m.seq) <= baselineSeq) return;
      r.played++;
      if (m.result === "W") r.wins++;
      else if (m.result === "D") r.draws++;
      else if (m.result === "L") r.losses++;
      r.goalsFor += Number(m.ourScore) || 0;
      r.goalsAgainst += Number(m.theirScore) || 0;
    });
    return r;
  }

  /* Career = baseline snapshot + honest deltas from post-baseline matches:
     goals from scorer lists always; apps/assists only when a detailed
     stat row exists for the player in that match. */
  function computeCareer(careerRows, matches, baselineSeq) {
    var byId = {};
    (careerRows || []).forEach(function (c) {
      byId[c.id] = {
        id: c.id, persona: c.persona, position: c.position, ovr: c.ovr,
        games: Number(c.games) || 0, goals: Number(c.goals) || 0,
        assists: Number(c.assists) || 0, passesMade: Number(c.passesMade) || 0,
        passPct: c.passPct, tackles: Number(c.tackles) || 0, tacklePct: c.tacklePct,
        cleanSheets: Number(c.cleanSheets) || 0, winPct: c.winPct
      };
    });
    (matches || []).forEach(function (m) {
      if (Number(m.seq) <= baselineSeq) return;
      var detailed = {};
      (m.players || []).forEach(function (p) { detailed[p.id] = p; });
      var counted = {};
      (m.players || []).forEach(function (p) {
        var c = byId[p.id];
        if (!c) return;
        c.games++; counted[p.id] = 1;
        c.goals += Number(p.goals) || 0;
        c.assists += Number(p.assists) || 0;
        c.passesMade += Number(p.passesMade) || 0;
        c.tackles += Number(p.tackles) || 0;
      });
      (m.scorers || []).forEach(function (s) {
        if (detailed[s.id]) return; // already counted exactly
        var c = byId[s.id];
        if (c) c.goals += Number(s.goals) || 0;
      });
    });
    return byId;
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
      live.innerHTML = '<div class="tile-row">' + U.statTile("All-time record", null, { sub: "opening the books…" }) + "</div>";

      Promise.all([DATA.record(), DATA.matches()]).then(function (rs) {
        var recRes = rs[0], mRes = rs[1];
        var block = liveBlock(recRes, "the club record") || liveBlock(mRes, "the match archive");
        if (block) { live.innerHTML = block; return; }

        var rec = computeRecord(recRes.record || {}, mRes.matches, mRes.baselineSeq || 0);
        var winPct = rec.played ? Math.round((rec.wins / rec.played) * 100) : null;
        var gd = rec.goalsFor - rec.goalsAgainst;

        var last5 = (mRes.matches || []).slice(0, 5);
        var form = last5.length
          ? '<div class="form-strip"><span class="form-label">Form</span>' +
              last5.map(function (m) {
                return '<span class="pill pill-' + (m.result === "W" ? "win" : m.result === "D" ? "draw" : "loss") +
                  ' pill-small" title="' + U.esc(m.opponent) + " " + m.ourScore + "–" + m.theirScore + '">' + m.result + "</span>";
              }).join("") +
              '<span class="form-hint">latest first</span></div>'
          : "";

        live.innerHTML =
          '<div class="tile-row">' +
            U.statTile("Played", rec.played, { accent: "electric" }) +
            U.statTile("Won", rec.wins, { accent: "win" }) +
            U.statTile("Drawn", rec.draws, { accent: "draw" }) +
            U.statTile("Lost", rec.losses, { accent: "loss" }) +
            U.statTile("Goals for", rec.goalsFor, { accent: "gold" }) +
            U.statTile("Goal diff", (gd > 0 ? "+" : "") + gd) +
            U.statTile("Win %", winPct != null ? winPct + "%" : null) +
          "</div>" +
          form +
          '<p class="sync-note">The club\u2019s own books — every game on record, kept by the club.</p>';
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
            '<div class="section-label">The record <span class="live-dot" title="From the club archive"></span></div>' +
            '<div id="player-stats">' + '<div class="tile-row">' + U.statTile("Apps", null) + U.statTile("Goals", null) + U.statTile("Assists", null) + "</div>" + "</div>" +
            '<a class="btn btn-ghost btn-small" href="#squad">← Back to squad</a>' +
          "</div>" +
        "</div>";

      Promise.all([DATA.career(), DATA.matches()]).then(function (rs) {
        var cRes = rs[0], mRes = rs[1];
        var mount = U.$("#player-stats");
        if (!mount) return;
        var block = liveBlock(cRes, "player records") || liveBlock(mRes, "the match archive");
        if (block) { mount.innerHTML = block; return; }

        var matches = mRes.matches || [];
        var careers = computeCareer(cRes.career || [], matches, mRes.baselineSeq || 0);
        var c = careers[p.id] || null;

        /* recorded-game numbers from the match log, for everyone */
        var logGoals = goalsByPlayer(matches)[p.id] || 0;
        var logApps = 0, logAssists = 0, ratings = [];
        matches.forEach(function (m) {
          (m.players || []).forEach(function (pl) {
            if (pl.id !== p.id) return;
            logApps++;
            logAssists += Number(pl.assists) || 0;
            if (pl.rating !== "" && pl.rating != null) ratings.push(Number(pl.rating));
          });
        });
        var avgRating = ratings.length
          ? (ratings.reduce(function (a, b) { return a + b; }, 0) / ratings.length).toFixed(2)
          : null;
        var tricks = hatTricks(matches).filter(function (h) { return h.id === p.id; });

        var html = "";
        if (c) {
          html +=
            '<div class="tile-row">' +
              U.statTile("OVR", c.ovr, { accent: "gold" }) +
              U.statTile("Games", c.games) +
              U.statTile("Goals", c.goals, { accent: p.goldenBoot ? "gold" : "" }) +
              U.statTile("Assists", c.assists) +
              U.statTile("Win %", c.winPct, { suffix: "%" }) +
              U.statTile("Tackles", c.tackles) +
            "</div>" +
            '<p class="sync-note">Career record · EA persona: ' + U.esc(c.persona) + "</p>";
        } else if (logGoals || logApps) {
          html +=
            '<div class="tile-row">' +
              U.statTile("Goals (recorded)", logGoals, { accent: "gold" }) +
              (logApps ? U.statTile("Detailed apps", logApps) : "") +
            "</div>" +
            '<p class="sync-note">From the club\u2019s match log. The algorithm scores; the archive remembers.</p>';
        } else {
          html += U.emptyState(
            "No recorded involvements yet",
            p.controlledBy === "human" ? "Career numbers can be set in Housekeeping." : "Plays its part in silence. For now.",
            "—"
          );
        }

        if (avgRating || logAssists || tricks.length) {
          html += '<div class="section-label">From the match log</div><div class="tile-row">' +
            (avgRating ? U.statTile("Avg rating", avgRating, { accent: "electric", sub: ratings.length + " detailed games" }) : "") +
            (logGoals ? U.statTile("Logged goals", logGoals) : "") +
            (logAssists ? U.statTile("Logged assists", logAssists) : "") +
            (tricks.length ? U.statTile("Hat-tricks", tricks.length, { accent: "gold", sub: tricks.map(function (t) { return "vs " + t.opponent; }).join(" · ") }) : "") +
          "</div>";
        }

        mount.innerHTML = html;
        U.runCountUps(mount);

        if (p.permaBench) {
          var fill = U.$("#bench-meter-fill");
          if (fill) {
            fill.style.width = (c && c.games ? Math.min(100, c.games) : 0) + "%";
            var note = mount.parentElement ? mount.parentElement.querySelector(".bench-meter-note") : null;
            if (note && !(c && c.games)) note.textContent = "Still zero. Still ready. The meter is patient.";
          }
        }
      });
    }
  };

  /* ------------------------------------------------ RESULTS */
  PAGES.results = {
    enter: function () {
      var mount = U.$("#results-list");
      mount.innerHTML = U.emptyState("Opening the books…", "", "⏱");

      DATA.matches().then(function (res) {
        var block = liveBlock(res, "the match archive");
        if (block) { mount.innerHTML = block; return; }
        var list = res.matches || [];
        if (!list.length) { mount.innerHTML = U.waitingState("matches"); return; }
        var canEdit = NET.isMod();

        mount.innerHTML = list.map(function (m, i) {
          var stage = m.stage === "playoff" ? "Playoff" : m.stage === "friendly" ? "Friendly" : "League";
          var scorers = U.scorersLine((m.scorers || []).map(function (s) {
            var p = U.playerById(s.id);
            return { name: p ? p.name : s.id, goals: s.goals };
          }));
          var detailed = (m.players || []).slice().sort(function (a, b) { return (Number(b.rating) || 0) - (Number(a.rating) || 0); });

          var statsPanel = detailed.length
            ? '<details class="opp-panel">' +
                "<summary>Player stats · " + detailed.length + " on record</summary>" +
                '<table class="opp-table opp-table-wide"><thead><tr><th>Player</th><th>G</th><th>A</th><th>R</th><th>Sh</th><th>Tk</th><th>Pass</th></tr></thead><tbody>' +
                detailed.map(function (t) {
                  var p = U.playerById(t.id);
                  var nm = p ? '<a href="#player/' + p.id + '">' + U.esc(p.name) + "</a>" : U.esc(t.id);
                  return "<tr><td>" + nm + "</td><td>" + (t.goals !== "" ? t.goals : "—") + "</td><td>" +
                    (t.assists !== "" ? t.assists : "—") + "</td><td>" + (t.rating !== "" ? Number(t.rating).toFixed(1) : "—") + "</td><td>" +
                    (t.shots !== "" ? t.shots : "—") + "</td><td>" + (t.tackles !== "" ? t.tackles : "—") + "</td><td>" +
                    (t.passesMade !== "" ? t.passesMade + "/" + t.passAttempts : "—") + "</td></tr>";
                }).join("") + "</tbody></table>" +
                (m.note ? '<p class="result-note">📝 ' + U.esc(m.note) + "</p>" : "") +
              "</details>"
            : (m.note ? '<p class="result-note">📝 ' + U.esc(m.note) + "</p>" : "");

          var editBtn = canEdit
            ? '<button class="result-edit" data-seq="' + m.seq + '" title="Edit this match in Housekeeping">✎</button>'
            : "";

          return '<article class="result-row" style="animation-delay:' + Math.min(i * 40, 400) + 'ms">' +
            '<div class="result-main">' +
              U.pill(m.result) +
              '<div class="result-mid">' +
                '<span class="result-line"><strong>The 40Yr Virgil</strong> <span class="result-score">' +
                  (m.ourScore !== "" ? m.ourScore : "–") + " — " + (m.theirScore !== "" ? m.theirScore : "–") +
                "</span> " + U.esc(m.opponent || "Unknown") + "</span>" +
                (scorers ? '<span class="result-scorers">⚽ ' + scorers + "</span>" : "") +
              "</div>" +
              '<div class="result-side"><span class="result-date">Match ' + m.seq + (m.dateISO ? " · " + U.fmtDate(m.dateISO) : "") + "</span>" +
                '<span class="result-tag">' + stage + "</span>" + editBtn +
              "</div>" +
            "</div>" + statsPanel +
          "</article>";
        }).join("");

        if (canEdit) {
          U.$$(".result-edit", mount).forEach(function (b) {
            b.addEventListener("click", function () {
              try { sessionStorage.setItem("v40.editseq", b.getAttribute("data-seq")); } catch (e) { /* fine */ }
              location.hash = "#admin";
            });
          });
        }
      });
    }
  };

  /* ------------------------------------------------ STATS */
  function lb(title, rows, fmt) {
    if (!rows || !rows.length) return "";
    return '<div class="panel lb-panel"><div class="section-label">' + title + "</div><ol class='lb'>" +
      rows.map(function (r) {
        var p = U.playerById(r.id);
        var who = p
          ? '<a href="#player/' + p.id + '">' + U.esc(p.name) + "</a> " + U.controlBadge(p)
          : U.esc(r.id);
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

      Promise.all([DATA.record(), DATA.matches(), DATA.career()]).then(function (rs) {
        var recRes = rs[0], mRes = rs[1], cRes = rs[2];
        var block = liveBlock(recRes, "the club record") || liveBlock(mRes, "the match archive");
        if (block) { clubMt.innerHTML = block; return; }

        var matches = mRes.matches || [];
        var baseline = mRes.baselineSeq || 0;
        var rec = computeRecord(recRes.record || {}, matches, baseline);

        /* ---- club tiles: all-time + the recorded slice ---- */
        var logW = 0, logD = 0, logL = 0, logGF = 0, logGA = 0;
        matches.forEach(function (m) {
          if (m.result === "W") logW++; else if (m.result === "D") logD++; else if (m.result === "L") logL++;
          logGF += Number(m.ourScore) || 0;
          logGA += Number(m.theirScore) || 0;
        });

        clubMt.innerHTML =
          '<div class="tile-row">' +
            U.statTile("Played", rec.played, { accent: "electric" }) +
            U.statTile("Wins", rec.wins, { accent: "win" }) +
            U.statTile("Draws", rec.draws, { accent: "draw" }) +
            U.statTile("Losses", rec.losses, { accent: "loss" }) +
            U.statTile("Goals for", rec.goalsFor, { accent: "gold" }) +
            U.statTile("Goals against", rec.goalsAgainst) +
            U.statTile("Win %", U.winPct(rec.wins, rec.played), { suffix: "%" }) +
            (rec.badge ? U.statTile("Badge", rec.badge, { accent: "gold" }) : "") +
          "</div>" +
          '<div class="section-label">The recorded games · ' + matches.length + " on file</div>" +
          '<div class="tile-row">' +
            U.statTile("Record", logW + " – " + logD + " – " + logL) +
            U.statTile("Scored", logGF, { accent: "gold" }) +
            U.statTile("Conceded", logGA) +
          "</div>" +
          '<p class="sync-note">All-time totals = the EA-era baseline plus every match logged since. The recorded games are the slice with full match-by-match detail.</p>';
        U.runCountUps(clubMt);

        /* ---- leaderboards ---- */
        var careers = computeCareer((cRes && cRes.career) || [], matches, baseline);
        var careerList = Object.keys(careers).map(function (k) { return careers[k]; });

        var logGoals = goalsByPlayer(matches);
        var bootRows = Object.keys(logGoals).map(function (id) { return { id: id, val: logGoals[id] }; })
          .sort(function (a, b) { return b.val - a.val; });

        var logA = {}, ratingsBy = {};
        matches.forEach(function (m) {
          (m.players || []).forEach(function (p) {
            logA[p.id] = (logA[p.id] || 0) + (Number(p.assists) || 0);
            if (p.rating !== "" && p.rating != null) (ratingsBy[p.id] = ratingsBy[p.id] || []).push(Number(p.rating));
          });
        });
        var assistRows = Object.keys(logA).filter(function (id) { return logA[id] > 0; })
          .map(function (id) { return { id: id, val: logA[id] }; })
          .sort(function (a, b) { return b.val - a.val; });
        var ratingRows = Object.keys(ratingsBy).map(function (id) {
          var arr = ratingsBy[id];
          return { id: id, val: arr.reduce(function (a, b) { return a + b; }, 0) / arr.length, n: arr.length };
        }).sort(function (a, b) { return b.val - a.val; });
        var trickMap = {};
        hatTricks(matches).forEach(function (h) { trickMap[h.id] = (trickMap[h.id] || 0) + 1; });
        var trickRows = Object.keys(trickMap).map(function (id) { return { id: id, val: trickMap[id] }; })
          .sort(function (a, b) { return b.val - a.val; });

        lbMt.innerHTML =
          '<div class="lb-grid">' +
            lb("Golden Boot · recorded games", bootRows, function (r) { return r.val; }) +
            lb("Career goals · all-time", careerList.filter(function (c) { return c.goals > 0; }).sort(function (a, b) { return b.goals - a.goals; }).map(function (c) { return { id: c.id, val: c.goals }; }), function (r) { return r.val; }) +
            lb("Assists · detailed games", assistRows, function (r) { return r.val; }) +
            lb("Career assists · all-time", careerList.filter(function (c) { return c.assists > 0; }).sort(function (a, b) { return b.assists - a.assists; }).map(function (c) { return { id: c.id, val: c.assists }; }), function (r) { return r.val; }) +
            lb("Average rating · detailed games", ratingRows, function (r) { return r.val.toFixed(2); }) +
            lb("Hat-tricks", trickRows, function (r) { return r.val; }) +
          "</div>" +
          '<p class="sync-note">Recorded-game boards count everyone — including the algorithms. Donovan and Pereira are on the scoresheet and the archive will never let them forget it.</p>';

        /* ---- career table for the humans ---- */
        var humans = careerList.filter(function (c) { return c.persona; })
          .sort(function (a, b) { return b.goals - a.goals; });
        var careerHtml = humans.length
          ? '<div class="section-label">Career records · the humans</div>' +
            '<div class="panel">' +
              '<table class="opp-table opp-table-wide career-table"><thead><tr><th>Player</th><th>OVR</th><th>Games</th><th>G</th><th>A</th><th>Pass %</th><th>Tkl</th><th>Win %</th></tr></thead><tbody>' +
              humans.map(function (c) {
                var p = U.playerById(c.id);
                var nm = p ? '<a href="#player/' + p.id + '">' + U.esc(p.name) + "</a>" : U.esc(c.id);
                return "<tr><td>" + nm + ' <span class="lb-club">' + U.esc(c.persona) + "</span></td><td>" + (c.ovr || "—") + "</td><td>" + c.games + "</td><td>" + c.goals + "</td><td>" + c.assists + "</td><td>" + (c.passPct || "—") + "</td><td>" + c.tackles + "</td><td>" + (c.winPct || "—") + "</td></tr>";
              }).join("") + "</tbody></table>" +
            "</div>"
          : "";

        /* ---- opposition table from the match log ---- */
        var byOpp = {};
        matches.forEach(function (m) {
          var k = (m.opponent || "Unknown").trim();
          byOpp[k] = byOpp[k] || { name: k, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
          var o = byOpp[k];
          o.p++;
          if (m.result === "W") o.w++; else if (m.result === "D") o.d++; else if (m.result === "L") o.l++;
          o.gf += Number(m.ourScore) || 0;
          o.ga += Number(m.theirScore) || 0;
        });
        var opps = Object.keys(byOpp).map(function (k) { return byOpp[k]; })
          .sort(function (a, b) { return b.p - a.p || a.name.localeCompare(b.name); });

        oppMt.innerHTML =
          careerHtml +
          '<div class="section-label">Opposition · head to head</div>' +
          '<div class="panel">' +
            '<table class="opp-table opp-table-wide"><thead><tr><th>Opponent</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th></tr></thead><tbody>' +
            opps.map(function (o) {
              return "<tr><td>" + U.esc(o.name) + "</td><td>" + o.p + "</td><td>" + o.w + "</td><td>" + o.d + "</td><td>" + o.l + "</td><td>" + o.gf + "</td><td>" + o.ga + "</td></tr>";
            }).join("") +
            "</tbody></table>" +
          "</div>";
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

      Promise.all([DATA.matches(), DATA.config()]).then(function (out) {
        var mRes = out[0];
        var items = [{
          ts: "2024-01-01T00:00:00Z",
          dateLabel: "2024",
          title: "Club founded",
          sub: "Fifteen names on a sheet, one badge, zero doubts. Est. 2024."
        }];

        var block = liveBlock(mRes, "the match archive");
        if (block) {
          cab.innerHTML = block;
        } else {
          var matches = mRes.matches || [];
          var bestWin = null, worstLoss = null, cleanSheets = 0, goalFests = 0;
          matches.forEach(function (m) {
            var our = Number(m.ourScore) || 0, their = Number(m.theirScore) || 0;
            if (m.result === "W") {
              var margin = our - their;
              if (!bestWin || margin > bestWin.margin || (margin === bestWin.margin && our > bestWin.our)) {
                bestWin = { margin: margin, our: our, their: their, opp: m.opponent };
              }
            }
            if (m.result === "L") {
              var def = their - our;
              if (!worstLoss || def > worstLoss.margin || (def === worstLoss.margin && their > worstLoss.their)) {
                worstLoss = { margin: def, our: our, their: their, opp: m.opponent };
              }
            }
            if (their === 0 && m.ourScore !== "") cleanSheets++;
            if (our + their >= 9) goalFests++;
          });
          var tricks = hatTricks(matches);

          cab.innerHTML =
            '<div class="tile-row">' +
              (bestWin ? U.statTile("Biggest win", bestWin.our + "–" + bestWin.their, { accent: "win", sub: "vs " + bestWin.opp }) : "") +
              (worstLoss ? U.statTile("Heaviest defeat", worstLoss.our + "–" + worstLoss.their, { accent: "loss", sub: "vs " + worstLoss.opp + " · character building" }) : "") +
              U.statTile("Clean sheets", cleanSheets, { accent: "electric", sub: "recorded games" }) +
              U.statTile("Hat-tricks", tricks.length, { accent: "gold", sub: "and counting" }) +
              (goalFests ? U.statTile("9+ goal thrillers", goalFests, { sub: "defending optional" }) : "") +
            "</div>";
          U.runCountUps(cab);
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
            ? '<p class="sync-note">Milestones can be added from Housekeeping.</p>'
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
