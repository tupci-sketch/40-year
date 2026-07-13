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
  var currentArg = null;
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

  /* Man of the Match: the explicitly-set one, else the top match rating. */
  function motmOf(m) {
    if (m.motm) return m.motm;
    var best = null;
    (m.players || []).forEach(function (p) {
      if (p.rating === "" || p.rating == null) return;
      if (!best || Number(p.rating) > Number(best.rating)) best = p;
    });
    return best ? best.id : "";
  }
  function motmCounts(matches) {
    var map = {};
    (matches || []).forEach(function (m) { var id = motmOf(m); if (id) map[id] = (map[id] || 0) + 1; });
    return map;
  }
  /* Longest win streak + longest unbeaten run (chronological). */
  function streaks(matches) {
    var chron = (matches || []).slice().sort(function (a, b) { return a.seq - b.seq; });
    var win = 0, winBest = 0, unb = 0, unbBest = 0;
    chron.forEach(function (m) {
      if (m.result === "W") { win++; unb++; }
      else if (m.result === "D") { win = 0; unb++; }
      else { win = 0; unb = 0; }
      if (win > winBest) winBest = win;
      if (unb > unbBest) unbBest = unb;
    });
    return { win: winBest, unbeaten: unbBest };
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
  var ROUTES = ["home", "squad", "tactics", "player", "results", "match", "opponent", "stats", "honours", "gaffer", "funhouse", "about", "news", "social", "forum", "tickets", "book", "chat", "admin"];

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
    currentArg = r.arg;

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
    U.$("#nav-chat").hidden = !NET.me;
    U.$("#nav-forum").hidden = !NET.me;
  }

  var AUTH_ERR = {
    offline: "Clubhouse unreachable. Try again in a moment.",
    exists: "That name is already on the team sheet.",
    auth: "Wrong name or password.",
    name: "Names: 2–20 letters, numbers, spaces, _ . -",
    pass: "Password needs at least 6 characters.",
    language: "That name won't get past the stewards.",
    banned: "This account is banned.",
    session: "Session expired — sign in again.",
    turnstile: "Couldn't confirm you're human — give it another go."
  };

  /* ---- Cloudflare Turnstile (bot check on the clubhouse door) ---- */
  var TS = { id: null };
  window.onTurnstileReady = function () { renderTurnstile(); };
  function turnstileOn() { return !!(window.turnstile && window.TURNSTILE_SITEKEY); }
  function renderTurnstile() {
    if (!turnstileOn()) return;
    var el = U.$("#cf-turnstile");
    if (!el) return;
    if (TS.id == null) {
      try { TS.id = window.turnstile.render(el, { sitekey: window.TURNSTILE_SITEKEY, theme: "dark", size: "flexible" }); }
      catch (e) { /* not ready yet */ }
    } else {
      try { window.turnstile.reset(TS.id); } catch (e) { /* fine */ }
    }
  }
  function turnstileToken() {
    if (turnstileOn() && TS.id != null) { try { return window.turnstile.getResponse(TS.id) || ""; } catch (e) {} }
    return "";
  }

  function openAuth(tab) {
    var m = U.$("#auth-modal");
    m.hidden = false;
    setAuthTab(tab || "login");
    renderTurnstile();
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
    var hint = U.$("#auth-match-hint");
    if (hint) hint.textContent = "";
  }

  function updateMatchHint() {
    var hint = U.$("#auth-match-hint");
    if (!hint) return;
    var pass = U.$("#auth-pass").value;
    var conf = U.$("#auth-confirm").value;
    if (!conf) { hint.textContent = ""; hint.className = "field-hint"; return; }
    if (pass === conf) { hint.textContent = "✓ Passwords match"; hint.className = "field-hint hint-ok"; }
    else { hint.textContent = "Passwords don't match yet"; hint.className = "field-hint hint-warn"; }
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
    U.$("#auth-pass").addEventListener("input", updateMatchHint);
    U.$("#auth-confirm").addEventListener("input", updateMatchHint);

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
      var tok = turnstileToken();
      var p = mode === "register" ? NET.register(name, pass, tok) : NET.login(name, pass, tok);
      p.then(function (r) {
        btn.disabled = false;
        renderTurnstile(); // tokens are single-use — get a fresh one
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
    refreshSquadViews();
  }

  function cfg() { return (STATE.config && STATE.config.config) || {}; }

  /* ---- squad overrides (level-9 edits live in backend config) ----
     Identity ships in data.js; the admin can edit/add/disable players
     from Housekeeping. We rebuild window.SQUAD = base + overrides each
     time config is available, so the tactics board (which reads base
     roles) is never broken — disabled players are simply benched. */
  var SQUAD_BASE = null;
  function applySquadOverrides() {
    if (!window.SQUAD) return;
    if (!SQUAD_BASE) SQUAD_BASE = JSON.parse(JSON.stringify(window.SQUAD));
    var overrides = cfg().squad || [];
    var byId = {};
    overrides.forEach(function (o) { if (o && o.id) byId[o.id] = o; });

    var merged = SQUAD_BASE.map(function (base) {
      var p = JSON.parse(JSON.stringify(base));
      var o = byId[p.id];
      if (o) {
        if (o.name) p.name = o.name;
        if (o.number != null && o.number !== "") p.number = o.number;
        if (o.positions && o.positions.length) p.positions = o.positions.slice(0, 3);
        if (o.position) p.position = o.position;
        if (o.controlledBy) p.controlledBy = o.controlledBy;
        p.isCaptain = !!o.isCaptain;
        p.permaBench = !!o.permaBench;
        if (o.pronouns) p.pronouns = o.pronouns;
        if (o.flavour) p.flavour = o.flavour;
        if (o.card) p.card = o.card;
        if (o.retiredAI != null) p.retiredAI = !!o.retiredAI;
        if (o.linkedTo) p.linkedTo = o.linkedTo;
        p.disabled = !!o.disabled;
      }
      normPositions(p);
      return p;
    });

    var have = {};
    merged.forEach(function (p) { have[p.id] = true; });
    overrides.forEach(function (o) {
      if (o && o.isNew && o.id && !have[o.id]) {
        var np = {
          id: o.id, name: o.name || o.id, number: o.number || 0,
          positions: (o.positions && o.positions.length) ? o.positions.slice(0, 3) : [o.position || "SUB"],
          position: o.position || "SUB", card: o.card || "crest.png",
          controlledBy: o.controlledBy === "human" ? "human" : "bot",
          isCaptain: !!o.isCaptain, permaBench: !!o.permaBench,
          pronouns: o.pronouns || "he/him", flavour: o.flavour || "",
          retiredAI: !!o.retiredAI, linkedTo: o.linkedTo || "",
          disabled: !!o.disabled, isNew: true
        };
        normPositions(np);
        merged.push(np);
      }
    });

    window.SQUAD = merged;
  }

  /* Ensure every player has a positions[] (≤3) with position = positions[0]. */
  function normPositions(p) {
    if (!p.positions || !p.positions.length) p.positions = p.position ? [p.position] : ["SUB"];
    p.positions = p.positions.filter(function (x) { return !!x; }).slice(0, 3);
    if (!p.positions.length) p.positions = ["SUB"];
    p.position = p.positions[0];
  }

  function refreshSquadViews() {
    applySquadOverrides();
    if (["squad", "player", "tactics"].indexOf(currentPage) !== -1 && PAGES[currentPage]) {
      PAGES[currentPage].enter(currentArg);
    }
  }

  function flavourOf(p) {
    var fl = cfg().flavour || {};
    return fl[p.id] || p.flavour;
  }

  /* ---- Funhouse config: live lists from backend cfg().fun, falling
     back to window.FUN_DEFAULTS so every toy works offline / pre-seed. ---- */
  function funCfg() {
    var d = window.FUN_DEFAULTS || {};
    var f = cfg().fun || {};
    function list(key) {
      var v = f[key];
      return (v && v.length) ? v : (d[key] || []);
    }
    var g = f.gaffer || {};
    var dg = d.gaffer || {};
    return {
      gaffer: {
        names: (g.names && g.names.length) ? g.names : (dg.names || []),
        quotes: (g.quotes && g.quotes.length) ? g.quotes : (dg.quotes || []),
        pinned: g.pinned || dg.pinned || ""
      },
      chants: list("chants"),
      superlatives: list("superlatives"),
      oracle: list("oracle"),
      rumours: list("rumours"),
      rumourClubs: list("rumourClubs")
    };
  }

  /* shared little helpers for the toys */
  function activeSquad() {
    return (window.SQUAD || []).filter(function (p) { return !p.disabled; });
  }
  function randOf(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : ""; }
  function fillChant(tpl, clubs) {
    var sq = activeSquad();
    return String(tpl || "")
      .replace(/\{full\}/g, function () { var p = randOf(sq); return p ? p.name : "the lads"; })
      .replace(/\{name\}/g, function () { var p = randOf(sq); return p ? U.surname(p) : "the lad"; })
      .replace(/\{opp\}/g, function () { return randOf(clubs && clubs.length ? clubs : ["a mystery club"]); });
  }

  /* ---- Twitch live status: a pulsing LIVE badge on the Social nav + page.
     Server-side check (backend holds the Twitch credentials); degrades to
     nothing if the backend or credentials aren't set. ---- */
  var twitchLive = null;
  function applyTwitchLive() {
    var nav = document.querySelector('.nav-link[data-route="social"]');
    if (nav) {
      var pip = nav.querySelector(".nav-live");
      if (twitchLive && twitchLive.live) {
        if (!pip) { pip = document.createElement("span"); pip.className = "nav-live"; pip.textContent = "LIVE"; nav.appendChild(pip); }
      } else if (pip) { pip.parentNode.removeChild(pip); }
    }
    if (currentPage === "social") { var b = U.$("#social-live"); if (b) renderTwitchBadge(b); }
  }
  function renderTwitchBadge(el) {
    if (twitchLive && twitchLive.live) {
      el.hidden = false;
      el.innerHTML =
        '<span class="social-live-dot"></span>' +
        '<span class="social-live-text">LIVE NOW</span>' +
        (twitchLive.title ? '<span class="social-live-title">' + U.esc(twitchLive.title) + "</span>" : "") +
        (twitchLive.viewers ? '<span class="social-live-viewers">' + twitchLive.viewers + " watching</span>" : "");
    } else { el.hidden = true; el.innerHTML = ""; }
  }
  function pollTwitchLive() {
    if (!NET.hasBackend()) return;
    NET.twitchStatus().then(function (r) {
      twitchLive = (r && r.ok) ? r : null;
      applyTwitchLive();
    });
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

      Promise.all([DATA.record(), DATA.matches(), DATA.config()]).then(function (rs) {
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
          leagueStrip() +
          '<div class="tile-row">' +
            U.statTile("Played", rec.played, { accent: "electric" }) +
            U.statTile("Won", rec.wins, { accent: "win" }) +
            U.statTile("Drawn", rec.draws, { accent: "draw" }) +
            U.statTile("Lost", rec.losses, { accent: "loss" }) +
            U.statTile("Goals for", rec.goalsFor, { accent: "gold" }) +
            U.statTile("Goals against", rec.goalsAgainst, { accent: "loss" }) +
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
      applySquadOverrides();
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
          if (p.disabled) return false;
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

  function pron(p) {
    var raw = ((p && p.pronouns) || "he/him").toLowerCase();
    var parts = raw.split("/");
    var subj = parts[0] || "he";
    var obj = parts[1] || "him";
    return {
      subj: subj, obj: obj,
      verb: subj === "they" ? "play" : "plays",
      ownsVerb: subj === "they" ? "own" : "owns",
      Subj: subj.charAt(0).toUpperCase() + subj.slice(1)
    };
  }

  /* Amy ↔ Donovan: two #8s, one person — one EA-AI, one human. */
  function linkNote(p) {
    var other = U.playerById(p.linkedTo);
    if (!other) return "";
    var link = '<a href="#player/' + other.id + '">' + U.esc(other.name) + "</a>";
    if (p.retiredAI) {
      return '<span class="link-badge">SAME #8</span> Retired now — the engine room the algorithm ran before the human took the shirt. That’s ' + link +
        " today. One was EA’s AI, one’s the real thing; their records stay their own.";
    }
    return '<span class="link-badge">SAME #8</span> Wears the 8 that ' + link +
      " — the EA-AI original — kept warm. Same person in spirit: one was the algorithm, this one’s got a pulse. The two tallies never merge.";
  }

  function rolesBlock(p) {
    var pr = pron(p);
    var positions = U.positionsOf(p);
    var chips = positions.map(function (pos) {
      return '<span class="pos-chip">' + U.esc(pos) + "</span>";
    }).join("");

    var rows = Object.keys(window.FORMATIONS).map(function (fkey) {
      var f = window.FORMATIONS[fkey];
      var best = null, bestLevel = null;
      f.slots.forEach(function (s) {
        var fit = U.posFit(p, s.pos);
        if (fit === "exact" && bestLevel !== "exact") { best = s.pos; bestLevel = "exact"; }
        else if (fit === "group" && !bestLevel) { best = s.pos; bestLevel = "group"; }
      });
      var cell;
      if (p.permaBench || !best) {
        cell = '<span class="role-bench">Bench</span>';
      } else {
        var label = (POS_LABEL[best] || best) + (bestLevel === "group" ? " (cover)" : "");
        cell = '<span class="role-pos' + (bestLevel === "group" ? " role-pos-alt" : "") + '">' + U.esc(best) + '</span>' +
          '<span class="role-label">' + U.esc(label) + "</span>";
      }
      return '<div class="role-row">' +
        '<span class="role-formation">' + U.esc(fkey) + "</span>" + cell +
      "</div>";
    }).join("");

    var foot = p.permaBench ? ("Every formation. Same seat. " + pr.Subj + " " + pr.ownsVerb + " it.")
      : p.isCaptain ? "Three shapes, one position. That's the deal."
      : ("Where the shapes tend to put " + pr.obj + ".");

    return (chips ? '<div class="section-label">Positions</div><div class="pos-chips">' + chips + "</div>" : "") +
      '<div class="section-label">Where ' + pr.subj + " " + pr.verb + "</div>" +
      '<div class="roles-block">' + rows + '<p class="roles-foot">' + foot + "</p>" +
      '<a class="btn btn-ghost btn-small" href="#tactics">See on the tactics board →</a></div>';
  }

  PAGES.player = {
    enter: function (id) {
      applySquadOverrides();
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
            (p.isSystem ? '<p class="profile-line profile-system-line"><span class="system-badge">THE SYSTEM</span> Everything we do runs through ' + pron(p).obj + '. In footballing terms, the whole side <em>is</em> the player.</p>' : "") +
            (p.linkedTo && U.playerById(p.linkedTo) ? '<p class="profile-line profile-link-line">' + linkNote(p) + "</p>" : "") +
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
        var motmCount = 0; matches.forEach(function (mm) { if (motmOf(mm) === p.id) motmCount++; });

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

        if (avgRating || logAssists || tricks.length || motmCount) {
          html += '<div class="section-label">From the match log</div><div class="tile-row">' +
            (avgRating ? U.statTile("Avg rating", avgRating, { accent: "electric", sub: ratings.length + " detailed games" }) : "") +
            (logGoals ? U.statTile("Logged goals", logGoals) : "") +
            (logAssists ? U.statTile("Logged assists", logAssists) : "") +
            (motmCount ? U.statTile("Man of the Match", motmCount, { accent: "gold" }) : "") +
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
  var STAGE_LABEL = { league: "League", playoff: "Playoff", cup: "Cup", friendly: "Friendly", international: "International", other: "Match" };

  function fixturesHtml() {
    var fx = (cfg().fixtures || []).filter(function (f) {
      if (!f.dateISO) return true;
      var d = new Date(f.dateISO + "T23:59:59");
      return d >= new Date(new Date().toDateString());
    });
    if (!fx.length) return "";
    return '<div class="section-label">Upcoming <span class="live-dot" title="Next on the calendar"></span></div>' +
      '<div class="fixtures-list">' +
      fx.map(function (f) {
        var stage = STAGE_LABEL[f.stage] || "Match";
        var tag = U.esc(stage) + (f.compName ? " · " + U.esc(f.compName) : "");
        var when = f.dateISO ? U.fmtDate(f.dateISO) : "Date TBC";
        return '<article class="fixture-row fixture-' + U.esc(f.stage || "friendly") + '">' +
          '<span class="fixture-badge">' + U.esc(stage) + "</span>" +
          '<div class="fixture-mid"><span class="fixture-line"><strong>The 40Yr Virgil</strong> <span class="fixture-vs">vs</span> ' + U.esc(f.opponent || "TBC") + "</span>" +
            (f.note ? '<span class="fixture-note">' + U.esc(f.note) + "</span>" : "") + "</div>" +
          '<div class="fixture-side"><span class="fixture-date">' + when + "</span><span class=\"fixture-tag\">" + tag + "</span></div>" +
        "</article>";
      }).join("") + "</div>" +
      '<div class="section-label">Results</div>';
  }

  function leagueStrip() {
    var L = cfg().league;
    if (!L || !(L.division || L.rank || L.points || L.status)) return "";
    var form = String(L.form || "").trim().split(/\s+/).filter(Boolean).map(function (r) {
      var c = r === "W" ? "win" : r === "D" ? "draw" : "loss";
      return '<span class="pill pill-' + c + ' pill-small">' + U.esc(r) + "</span>";
    }).join("");
    function cell(v, lab) { return v ? '<div class="league-cell"><span class="league-val">' + U.esc(v) + '</span><span class="league-lab">' + lab + "</span></div>" : ""; }
    return '<div class="league-strip panel">' +
      '<div class="league-row">' +
        cell(L.division, "Division") + cell(L.rank, "Position") + cell(L.points, "Points") + cell(L.played, "Played") +
        (form ? '<div class="league-cell league-form"><span class="league-form-pills">' + form + '</span><span class="league-lab">Form</span></div>' : "") +
      "</div>" +
      (L.status ? '<div class="league-status">' + U.esc(L.status) + "</div>" : "") +
      (L.note ? '<div class="league-note">' + U.esc(L.note) + "</div>" : "") +
    "</div>";
  }

  PAGES.results = {
    enter: function () {
      var mount = U.$("#results-list");
      mount.innerHTML = U.emptyState("Opening the books…", "", "⏱");

      Promise.all([DATA.matches(), DATA.config()]).then(function (rs) {
        var res = rs[0];
        var block = liveBlock(res, "the match archive");
        if (block) { mount.innerHTML = block; return; }
        var list = res.matches || [];
        if (!list.length) { mount.innerHTML = leagueStrip() + U.waitingState("matches"); return; }
        var canEdit = NET.isMod();

        mount.innerHTML = leagueStrip() + fixturesHtml() + list.map(function (m, i) {
          var stage = STAGE_LABEL[m.stage] || "League";
          var stageTag = U.esc(stage) + (m.compName ? " · " + U.esc(m.compName) : "");
          var scorers = U.scorersLine((m.scorers || []).map(function (s) {
            var p = U.playerById(s.id);
            return { name: p ? p.name : s.id, goals: s.goals };
          }));
          var detailed = (m.players || []).slice().sort(function (a, b) { return (Number(b.rating) || 0) - (Number(a.rating) || 0); });
          var motmId = motmOf(m), motmP = motmId ? U.playerById(motmId) : null;

          var statsPanel = detailed.length
            ? '<details class="opp-panel">' +
                "<summary>Player stats · " + detailed.length + " on record</summary>" +
                '<div class="table-scroll"><table class="opp-table opp-table-wide"><thead><tr><th>Player</th><th>G</th><th>A</th><th>R</th><th>Sh</th><th>Tk</th><th>Pass</th></tr></thead><tbody>' +
                detailed.map(function (t) {
                  var p = U.playerById(t.id);
                  var nm = p ? '<a href="#player/' + p.id + '">' + U.esc(p.name) + "</a>" : U.esc(t.id);
                  return "<tr><td>" + nm + "</td><td>" + (t.goals !== "" ? t.goals : "—") + "</td><td>" +
                    (t.assists !== "" ? t.assists : "—") + "</td><td>" + (t.rating !== "" ? Number(t.rating).toFixed(1) : "—") + "</td><td>" +
                    (t.shots !== "" ? t.shots : "—") + "</td><td>" + (t.tackles !== "" ? t.tackles : "—") + "</td><td>" +
                    (t.passesMade !== "" ? t.passesMade + "/" + t.passAttempts : "—") + "</td></tr>";
                }).join("") + "</tbody></table></div>" +
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
                '</span> <a class="result-opp" href="#opponent/' + encodeURIComponent(m.opponent || "") + '">' + U.esc(m.opponent || "Unknown") + "</a></span>" +
                (scorers ? '<span class="result-scorers">⚽ ' + scorers + "</span>" : "") +
                (motmP ? '<span class="result-motm">🌟 MOTM ' + U.esc(U.surname(motmP)) + "</span>" : "") +
              "</div>" +
              '<div class="result-side"><span class="result-date">Match ' + m.seq + (m.dateISO ? " · " + U.fmtDate(m.dateISO) : "") + "</span>" +
                '<span class="result-tag">' + stageTag + "</span>" +
                '<a class="result-report" href="#match/' + m.seq + '">Report →</a>' + editBtn +
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

  /* ------------------------------------------------ MATCH REPORT */
  function miniPitch(m) {
    var lu = m.lineup;
    if (!lu || !lu.xi || !lu.xi.length || !window.FORMATIONS[lu.formation]) {
      return '<p class="mr-nolineup">No teamsheet recorded for this game' + (NET.isMod() ? " — add one in Housekeeping." : ".") + "</p>";
    }
    var f = window.FORMATIONS[lu.formation];
    var tokens = lu.xi.map(function (x, i) {
      var slot = f.slots[i]; if (!slot) return "";
      var p = U.playerById(x.id);
      var num = p ? p.number : "?";
      var nm = p ? U.surname(p) : x.id;
      var cap = (lu.captain && lu.captain === x.id) ? '<span class="mr-arm">C</span>' : "";
      return '<div class="mr-token' + (p && p.controlledBy === "human" ? " token-human" : "") + '" style="left:' + slot.x + "%;bottom:" + slot.y + '%">' +
        '<span class="mr-shirt">' + num + cap + '</span><span class="mr-name">' + U.esc(nm) + "</span></div>";
    }).join("");
    var subs = (lu.subs || []).map(function (id) { var p = U.playerById(id); return p ? U.esc(U.surname(p)) : U.esc(id); }).join(", ");
    return '<div class="section-label">The XI · ' + U.esc(lu.formation) + "</div>" +
      '<div class="mr-pitch-wrap"><div class="mr-pitch"><div class="pitch-lines"><div class="pl-halfway"></div><div class="pl-centre"></div></div>' + tokens + "</div></div>" +
      (subs ? '<p class="mr-subs">Subs: ' + subs + "</p>" : "");
  }

  function statsTable(detailed) {
    return '<div class="section-label">Player stats</div>' +
      '<div class="table-scroll"><table class="opp-table opp-table-wide"><thead><tr><th>Player</th><th>G</th><th>A</th><th>R</th><th>Sh</th><th>Tk</th><th>Pass</th></tr></thead><tbody>' +
      detailed.map(function (t) {
        var p = U.playerById(t.id);
        var nm = p ? '<a href="#player/' + p.id + '">' + U.esc(p.name) + "</a>" : U.esc(t.id);
        return "<tr><td>" + nm + "</td><td>" + (t.goals !== "" ? t.goals : "—") + "</td><td>" + (t.assists !== "" ? t.assists : "—") +
          "</td><td>" + (t.rating !== "" ? Number(t.rating).toFixed(1) : "—") + "</td><td>" + (t.shots !== "" ? t.shots : "—") +
          "</td><td>" + (t.tackles !== "" ? t.tackles : "—") + "</td><td>" + (t.passesMade !== "" ? t.passesMade + "/" + t.passAttempts : "—") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  PAGES.match = {
    enter: function (arg) {
      var seq = Number(arg);
      var mt = U.$("#match-view");
      mt.innerHTML = U.emptyState("Opening the report…", "", "⏱");
      DATA.matches().then(function (res) {
        var block = liveBlock(res, "the match archive");
        if (block) { mt.innerHTML = block; return; }
        var m = (res.matches || []).filter(function (x) { return Number(x.seq) === seq; })[0];
        if (!m) { mt.innerHTML = U.emptyState("No such match", "It may have been struck from the books.", "—"); return; }
        applySquadOverrides();
        var stage = STAGE_LABEL[m.stage] || "Match";
        var venueLabel = m.venue === "H" ? "Home" : m.venue === "A" ? "Away" : m.venue === "N" ? "Neutral" : "";
        var scorers = U.scorersLine((m.scorers || []).map(function (s) { var p = U.playerById(s.id); return { name: p ? p.name : s.id, goals: s.goals }; }));
        var motmId = motmOf(m), motmP = motmId ? U.playerById(motmId) : null;
        var detailed = (m.players || []).slice().sort(function (a, b) { return (Number(b.rating) || 0) - (Number(a.rating) || 0); });

        mt.innerHTML =
          '<article class="match-report">' +
            '<div class="mr-head">' + U.pill(m.result) +
              '<div class="mr-score">' + (m.ourScore !== "" ? m.ourScore : "–") + " — " + (m.theirScore !== "" ? m.theirScore : "–") + "</div>" +
              '<div class="mr-teams"><strong>The 40Yr Virgil</strong> vs <a href="#opponent/' + encodeURIComponent(m.opponent || "") + '">' + U.esc(m.opponent || "Unknown") + "</a></div>" +
              '<div class="mr-meta">Match ' + m.seq + " · " + U.esc(stage) + (m.compName ? " · " + U.esc(m.compName) : "") + (venueLabel ? " · " + venueLabel : "") + (m.dateISO ? " · " + U.fmtDate(m.dateISO) : "") + "</div>" +
              (scorers ? '<div class="mr-scorers">⚽ ' + scorers + "</div>" : "") +
              (motmP ? '<div class="mr-motm">🌟 Man of the Match — <a href="#player/' + motmP.id + '">' + U.esc(motmP.name) + "</a></div>" : "") +
            "</div>" +
            miniPitch(m) +
            (detailed.length ? statsTable(detailed) : "") +
            (m.note ? '<p class="result-note">📝 ' + U.esc(m.note) + "</p>" : "") +
            (NET.isMod() ? '<div class="admin-actions"><button class="btn btn-ghost btn-small" id="mr-edit">Edit in Housekeeping →</button></div>' : "") +
            '<a class="back-link" href="#results">← All results</a>' +
          "</article>";
        var eb = U.$("#mr-edit", mt);
        if (eb) eb.addEventListener("click", function () { try { sessionStorage.setItem("v40.editseq", String(m.seq)); } catch (e) { /* fine */ } location.hash = "#admin"; });
        U.runCountUps(mt);
      });
    }
  };

  /* ------------------------------------------------ OPPONENT */
  PAGES.opponent = {
    enter: function (arg) {
      var name = decodeURIComponent(arg || "");
      var mt = U.$("#opponent-view");
      mt.innerHTML = U.emptyState("Opening the dossier…", "", "⏱");
      DATA.matches().then(function (res) {
        var block = liveBlock(res, "the match archive");
        if (block) { mt.innerHTML = block; return; }
        var games = (res.matches || []).filter(function (m) { return (m.opponent || "").trim().toLowerCase() === name.trim().toLowerCase(); });
        if (!games.length) { mt.innerHTML = U.emptyState("Never met " + name, "", "—") + '<a class="back-link" href="#stats">← Back to stats</a>'; return; }
        var w = 0, d = 0, l = 0, gf = 0, ga = 0;
        games.forEach(function (m) { if (m.result === "W") w++; else if (m.result === "D") d++; else l++; gf += Number(m.ourScore) || 0; ga += Number(m.theirScore) || 0; });
        mt.innerHTML =
          '<h1 class="mr-oppname">vs ' + U.esc(games[0].opponent) + "</h1>" +
          '<div class="tile-row">' +
            U.statTile("Played", games.length) + U.statTile("Won", w, { accent: "win" }) + U.statTile("Drawn", d, { accent: "draw" }) +
            U.statTile("Lost", l, { accent: "loss" }) + U.statTile("Goals for", gf, { accent: "gold" }) + U.statTile("Goals against", ga) +
          "</div>" +
          '<div class="section-label">Every meeting</div>' +
          games.map(function (m) {
            return '<a class="result-row result-link" href="#match/' + m.seq + '"><div class="result-main">' + U.pill(m.result) +
              '<div class="result-mid"><span class="result-line"><strong>The 40Yr Virgil</strong> <span class="result-score">' +
              (m.ourScore !== "" ? m.ourScore : "–") + " — " + (m.theirScore !== "" ? m.theirScore : "–") + "</span> " + U.esc(m.opponent) + "</span></div>" +
              '<div class="result-side"><span class="result-date">Match ' + m.seq + (m.dateISO ? " · " + U.fmtDate(m.dateISO) : "") + "</span></div></div></a>";
          }).join("") +
          '<a class="back-link" href="#stats">← Back to stats</a>';
        U.runCountUps(mt);
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
            U.statTile("Longest win run", streaks(matches).win, { accent: "win" }) +
            U.statTile("Longest unbeaten", streaks(matches).unbeaten, { accent: "electric" }) +
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

        var motmMap = motmCounts(matches);
        var motmRows = Object.keys(motmMap).map(function (id) { return { id: id, val: motmMap[id] }; }).sort(function (a, b) { return b.val - a.val; });
        var redMap = {};
        matches.forEach(function (m) { (m.players || []).forEach(function (p) { redMap[p.id] = (redMap[p.id] || 0) + (Number(p.redCards) || 0); }); });
        var redRows = Object.keys(redMap).filter(function (id) { return redMap[id] > 0; }).map(function (id) { return { id: id, val: redMap[id] }; }).sort(function (a, b) { return b.val - a.val; });

        /* ---- biggest contributor: goals + assists per game (career, decent sample) ---- */
        var contribRows = careerList.filter(function (c) { return Number(c.games) >= 20; })
          .map(function (c) {
            var g = Number(c.goals) || 0, a = Number(c.assists) || 0, n = Number(c.games) || 1;
            return { id: c.id, g: g, a: a, games: n, ga: g + a, per: (g + a) / n };
          })
          .sort(function (x, y) { return y.per - x.per; });
        var contribHtml = contribRows.length
          ? '<div class="section-label">Biggest contributors · goals + assists per game</div>' +
            '<div class="panel lb-panel"><ol class="lb lb-contrib">' +
            contribRows.map(function (r) {
              var p = U.playerById(r.id);
              var who = p ? '<a href="#player/' + p.id + '">' + U.esc(p.name) + "</a> " + U.controlBadge(p) : U.esc(r.id);
              return "<li><span class='lb-name'>" + who +
                "<span class='lb-sub'>" + r.g + "G + " + r.a + "A across " + r.games + " games</span></span>" +
                "<span class='lb-val'>" + r.per.toFixed(2) + "<span class='lb-unit'>/game</span></span></li>";
            }).join("") + "</ol>" +
            '<p class="sync-note">Career involvement per game. The whole side runs through the captain — Danwhizzy finishes what Tupci\u2019s assists start.</p>' +
            "</div>"
          : "";

        lbMt.innerHTML =
          contribHtml +
          '<div class="lb-grid">' +
            lb("Golden Boot · recorded games", bootRows, function (r) { return r.val; }) +
            lb("Career goals · all-time", careerList.filter(function (c) { return c.goals > 0; }).sort(function (a, b) { return b.goals - a.goals; }).map(function (c) { return { id: c.id, val: c.goals }; }), function (r) { return r.val; }) +
            lb("Assists · detailed games", assistRows, function (r) { return r.val; }) +
            lb("Career assists · all-time", careerList.filter(function (c) { return c.assists > 0; }).sort(function (a, b) { return b.assists - a.assists; }).map(function (c) { return { id: c.id, val: c.assists }; }), function (r) { return r.val; }) +
            lb("Average rating · detailed games", ratingRows, function (r) { return r.val.toFixed(2); }) +
            lb("Man of the Match", motmRows, function (r) { return r.val; }) +
            lb("Hat-tricks", trickRows, function (r) { return r.val; }) +
            lb("Discipline · red cards", redRows, function (r) { return r.val; }) +
          "</div>" +
          '<p class="sync-note">Recorded-game boards count everyone — including the algorithms. Donovan and Pereira are on the scoresheet and the archive will never let them forget it.</p>';

        /* ---- career table for the humans ---- */
        var humans = careerList.filter(function (c) { return c.persona; })
          .sort(function (a, b) { return b.goals - a.goals; });
        var careerHtml = humans.length
          ? '<div class="section-label">Career records · the humans</div>' +
            '<div class="panel">' +
              '<div class="table-scroll"><table class="opp-table opp-table-wide career-table"><thead><tr><th>Player</th><th>OVR</th><th>Games</th><th>G</th><th>A</th><th>Pass %</th><th>Tkl</th><th>Win %</th></tr></thead><tbody>' +
              humans.map(function (c) {
                var p = U.playerById(c.id);
                var nm = p ? '<a href="#player/' + p.id + '">' + U.esc(p.name) + "</a>" : U.esc(c.id);
                return "<tr><td>" + nm + ' <span class="lb-club">' + U.esc(c.persona) + "</span></td><td>" + (c.ovr || "—") + "</td><td>" + c.games + "</td><td>" + c.goals + "</td><td>" + c.assists + "</td><td>" + (c.passPct || "—") + "</td><td>" + c.tackles + "</td><td>" + (c.winPct || "—") + "</td></tr>";
              }).join("") + "</tbody></table></div>" +
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
            '<div class="table-scroll"><table class="opp-table opp-table-wide"><thead><tr><th>Opponent</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th></tr></thead><tbody>' +
            opps.map(function (o) {
              return '<tr><td><a href="#opponent/' + encodeURIComponent(o.name) + '">' + U.esc(o.name) + "</a></td><td>" + o.p + "</td><td>" + o.w + "</td><td>" + o.d + "</td><td>" + o.l + "</td><td>" + o.gf + "</td><td>" + o.ga + "</td></tr>";
            }).join("") +
            "</tbody></table></div>" +
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
      var gf = funCfg().gaffer;
      var pinned = gf.pinned || cfg().gaffer;

      function pool() {
        return gf.names.concat(activeSquad().map(function (p) { return p.name; }));
      }
      function quote() {
        return randOf(gf.quotes) || "“We go again.”";
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

  /* ------------------------------------------------ FUNHOUSE (club toys) */
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
      '<div class="fun-actions"><button class="btn btn-gold btn-small" id="fun-btn-' + id + '">' + U.esc(btnLabel) + "</button>" +
        '<button class="btn btn-ghost btn-small fun-copy" data-out="fun-out-' + id + '" hidden>Copy</button></div>' +
    "</div>";
  }

  PAGES.funhouse = {
    enter: function () {
      DATA.config().then(function () {
        applySquadOverrides();
        var mt = U.$("#funhouse-view");
        if (!mt) return;
        var fun = funCfg();

        mt.innerHTML =
          '<p class="screen-intro">The club’s toy box. Everything here spins, and every list is editable in Housekeeping → Fun &amp; Games. Contract length: one click.</p>' +
          '<div class="fun-grid">' +
            funCard("xi", "🎲", "The XI the Gaffer Picked", "One tap and the wheel throws out a starting eleven. Tactical merit not guaranteed.", "Pick the XI") +
            funCard("chant", "📣", "Matchday Chant Machine", "Terrace poetry, generated on demand. Best sung badly.", "Give us a song") +
            funCard("super", "🏅", "Squad Superlatives", "Hands out the club’s least official awards to random names.", "Hand out awards") +
            funCard("oracle", "🔮", "The Oracle", "Ask it anything. It answers in the club’s voice, which is to say: unreliably.", "Consult the Oracle") +
            funCard("rumour", "📰", "Transfer Rumour Mill", "Definitely-real gossip from sources definitely close to the sofa.", "Start a rumour") +
            funCard("motm", "⭐", "Player of the Matchday", "The wheel appoints a hero. No stats were consulted.", "Name the hero") +
          "</div>";

        function out(id) { return U.$("#fun-out-" + id, mt); }
        function showCopy(id) { var c = mt.querySelector('.fun-copy[data-out="fun-out-' + id + '"]'); if (c) c.hidden = false; }

        /* Random XI */
        U.$("#fun-btn-xi", mt).addEventListener("click", function () {
          var sq = activeSquad();
          var gks = sq.filter(function (p) { return U.posGroup(p) === "GK"; });
          var others = shuffle(sq.filter(function (p) { return U.posGroup(p) !== "GK" && p.id !== "rizzydave"; }));
          var xi = [];
          if (gks.length) xi.push(randOf(gks));
          xi = xi.concat(others.slice(0, 10));
          out("xi").innerHTML =
            '<ul class="fun-list">' + xi.map(function (p) {
              return "<li><span class='fun-num'>#" + p.number + "</span> " + U.esc(p.name) +
                (p.id === "tupci" ? " <span class='fun-tag'>CAM, obviously</span>" : "") + "</li>";
            }).join("") + "</ul>" +
            '<p class="fun-foot">Rizzy Dave, as ever, did not make the cut. The meter is patient.</p>';
          showCopy("xi");
        });

        /* Chant */
        U.$("#fun-btn-chant", mt).addEventListener("click", function () {
          out("chant").innerHTML = '<p class="fun-chant">“' + U.esc(fillChant(randOf(fun.chants), fun.rumourClubs)) + '”</p>';
          showCopy("chant");
        });

        /* Superlatives */
        U.$("#fun-btn-super", mt).addEventListener("click", function () {
          var awards = shuffle(fun.superlatives).slice(0, Math.min(5, fun.superlatives.length));
          var people = shuffle(activeSquad());
          out("super").innerHTML = '<ul class="fun-list">' + awards.map(function (a, i) {
            var who = people[i % people.length];
            return "<li><span class='fun-award'>" + U.esc(a) + "</span><span class='fun-winner'>" + U.esc(who ? who.name : "—") + "</span></li>";
          }).join("") + "</ul>";
          showCopy("super");
        });

        /* Oracle */
        out("oracle").innerHTML =
          '<input type="text" id="fun-oracle-q" class="fun-input" maxlength="80" placeholder="Ask the Oracle (optional)…">';
        U.$("#fun-btn-oracle", mt).addEventListener("click", function () {
          var q = (U.$("#fun-oracle-q", mt) || {}).value || "";
          out("oracle").innerHTML =
            '<input type="text" id="fun-oracle-q" class="fun-input" maxlength="80" value="' + U.esc(q) + '" placeholder="Ask the Oracle (optional)…">' +
            '<p class="fun-oracle-answer">🔮 ' + U.esc(randOf(fun.oracle)) + "</p>";
          showCopy("oracle");
        });

        /* Rumour */
        U.$("#fun-btn-rumour", mt).addEventListener("click", function () {
          out("rumour").innerHTML = '<p class="fun-rumour">' + U.esc(fillChant(randOf(fun.rumours), fun.rumourClubs)) + "</p>";
          showCopy("rumour");
        });

        /* Player of the Matchday */
        U.$("#fun-btn-motm", mt).addEventListener("click", function () {
          var who = randOf(activeSquad());
          var lines = [
            "carried the whole side and refused to make it weird.",
            "was everywhere. The router could not cope.",
            "did something the algorithm will study for years.",
            "gets the nod. The screenshot is already framed.",
            "ran the game from a position nobody asked them to play."
          ];
          out("motm").innerHTML = who
            ? '<div class="fun-motm"><span class="fun-num">#' + who.number + '</span> <strong>' + U.esc(who.name) + "</strong> — " + U.esc(randOf(lines)) + "</div>"
            : "";
          showCopy("motm");
        });

        /* copy buttons */
        U.$$(".fun-copy", mt).forEach(function (c) {
          c.addEventListener("click", function () {
            var el = U.$("#" + c.getAttribute("data-out"), mt);
            var txt = el ? (el.innerText || el.textContent || "").trim() : "";
            if (!txt) return;
            try {
              navigator.clipboard.writeText(txt).then(function () { U.toast("Copied. Go on, share it."); },
                function () { U.toast("Couldn’t copy — select and copy manually."); });
            } catch (e) { U.toast("Couldn’t copy — select and copy manually."); }
          });
        });
      });
    }
  };

  /* ------------------------------------------------ ABOUT */
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function bdayLabel(mmdd) {
    var parts = String(mmdd || "").split("-");
    if (parts.length !== 2) return "";
    var mi = Number(parts[0]) - 1, d = Number(parts[1]);
    if (mi < 0 || mi > 11 || !d) return "";
    var suf = (d % 10 === 1 && d !== 11) ? "st" : (d % 10 === 2 && d !== 12) ? "nd" : (d % 10 === 3 && d !== 13) ? "rd" : "th";
    return MONTHS[mi] + " " + d + suf;
  }

  function personalHtml() {
    var people = cfg().people || [];
    if (!people.length) return "";
    var out = "";

    if (cfg().showBirthdays) {
      var withB = people.filter(function (p) { return p.bday; });
      if (withB.length) {
        out += '<div class="section-label">Club birthdays</div>' +
          '<div class="panel about-block"><ul class="about-facts">' +
          withB.map(function (p) {
            var who = U.playerById(p.id);
            var nm = who ? who.name : (p.real || p.id);
            return "<li><strong>" + U.esc(nm) + (p.real && who ? " (" + U.esc(p.real) + ")" : "") + "</strong> — " + U.esc(bdayLabel(p.bday)) + "</li>";
          }).join("") + "</ul>" +
          '<p class="sync-note">Tupci and Danwhizzy share a birthday week — Dan never lets the captain forget he\u2019s the elder by three days.</p>' +
          "</div>";
      }
    }

    if (cfg().showPartners) {
      var withP = people.filter(function (p) { return p.partner && p.partner.name; });
      if (withP.length) {
        out += '<div class="section-label">The better halves</div>' +
          '<div class="panel about-block"><ul class="about-facts">' +
          withP.map(function (p) {
            var who = U.playerById(p.id);
            var nm = who ? who.name : (p.real || p.id);
            var club = p.partner.club ? " — a " + U.esc(p.partner.club) + " fan, which the group chat tolerates" : "";
            return "<li><strong>" + U.esc(nm) + "</strong> · " + U.esc(p.partner.name) + club + "</li>";
          }).join("") + "</ul>" +
          '<p class="sync-note">Not on the team sheet, but they keep the squad fed, watered and humble.</p>' +
          "</div>";
      }
    }
    return out;
  }

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
        var pmt = U.$("#about-personal");
        if (pmt) pmt.innerHTML = personalHtml();
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

  /* ------------------------------------------------ NEWS (club-side satire) */
  var NEWS = [
    { tag: "COMMERCIAL", date: "2026-06-11", title: "Welcome to the Betfred Arena",
      body: "We've done a deal \u2014 a big one. Our ground is now officially the Betfred Arena, and the shirt carries the name to match. Every elite club needs a stadium sponsor, and ours was sitting right there in the settings menu, so we took it. The kit, honestly, wears itself." },
    { tag: "OFFICIAL", date: "2026-06-12", title: "Club opens its own books as EA API goes dark",
      body: "Following the sudden silence of the EA data feed, The 40Yr Virgil has taken the historic step of becoming its own record keeper. \u201CThe numbers were ours all along,\u201D said a spokesperson who is also the captain, the manager, and the person who built this website. Every game now lives in the club archive. All 392 of them." },
    { tag: "TACTICS", date: "2026-06-10", title: "Captain to remain at CAM, sources confirm, again",
      body: "In news that has shocked nobody, Tupci will continue at attacking midfield in all three formations. \u201CHe is the system,\u201D explained the gaffer. \u201CYou don\u2019t move the system. The whole side runs through him.\u201D A reporter asked what would happen if he were rotated. The room went quiet. We do not speak of it." },
    { tag: "TRANSFERS", date: "2026-06-08", title: "Danwhizzy credits goal record to \u2018a lad who keeps passing it to me\u2019",
      body: "The club\u2019s record scorer has once again acknowledged the supply line. \u201CHonestly, I just stand there and it arrives,\u201D he said of his 472 career goals. The assist in question declined to comment, mainly because he was already setting up the next one. The debate over who carries whom continues into its third year." },
    { tag: "SQUAD", date: "2026-06-05", title: "Rizzy Dave enters fourth season of being \u2018not starting, still dangerous\u2019",
      body: "Super-sub Rizzy Dave remains on the bench across every formation, a position he has made entirely his own. \u201CThe meter is patient,\u201D he reportedly said, gesturing at his appearances counter. Club officials confirmed the meter is, in fact, connected." },
    { tag: "DRESSING ROOM", date: "2026-06-01", title: "Donovan scores, refuses to make it weird",
      body: "Central midfielder Donovan got on the scoresheet again and, true to form, simply jogged back to the halfway line. \u201CThe bot delivers,\u201D was the only statement issued. The archive will never let the moment be forgotten." }
  ];

  PAGES.news = {
    enter: function () {
      var mt = U.$("#news-view");
      mt.innerHTML = U.emptyState("Opening the Gazette…", "", "📰");
      DATA.config().then(function () {
        var arts = (cfg().news && cfg().news.length) ? cfg().news.slice() : NEWS;
        arts = arts.slice().sort(function (a, b) {
          var pa = a.pinned ? 1 : 0, pb = b.pinned ? 1 : 0;
          if (pa !== pb) return pb - pa;
          return String(b.dateISO || b.date || "").localeCompare(String(a.dateISO || a.date || ""));
        });
        mt.innerHTML = '<div class="news-grid">' +
          arts.map(function (a) {
            var date = a.dateISO || a.date || "";
            return '<article class="news-card' + (a.pinned ? " news-pinned" : "") + '">' +
              '<div class="news-card-head"><span class="news-tag">' + U.esc(a.tag) + "</span>" +
                (a.pinned ? '<span class="news-pin" title="Pinned">📌</span>' : "") +
                '<span class="news-date">' + U.esc(U.fmtDate(date)) + "</span></div>" +
              '<h2 class="news-title">' + U.esc(a.title) + "</h2>" +
              '<p class="news-body">' + U.esc(a.body).replace(/\n/g, "<br>") + "</p>" +
            "</article>";
          }).join("") + "</div>" +
          '<p class="sync-note">The Gazette. Satire, mostly. The 392 is real.</p>';
      });
    }
  };

  /* ------------------------------------------------ SOCIAL (TikTok creator embed) */
  PAGES.social = {
    enter: function () {
      DATA.config().then(function () {
        var mt = U.$("#social-view");
        if (!mt) return;
        var handle = String(cfg().tiktok || "danwhizzy").replace(/^@/, "").replace(/[^a-zA-Z0-9_.]/g, "") || "danwhizzy";
        var twitch = String(cfg().twitch || "40yrvirgil").replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "") || "40yrvirgil";
        // The Twitch player itself decides what to show: the live stream when
        // the channel is broadcasting, or its offline screen when it isn't.
        // `parent` must match the hosting domain, so read it live.
        var parent = location.hostname || "40yrvirgil.co.uk";
        var twitchSrc = "https://player.twitch.tv/?channel=" + encodeURIComponent(twitch) +
          "&parent=" + encodeURIComponent(parent) + "&muted=true&autoplay=true";
        var twitchCard =
          '<div class="section-label">' + twitch + " on Twitch</div>" +
          '<div id="social-live" class="social-live-badge" hidden></div>' +
          '<p class="screen-intro">When the club’s live, the stream plays right here. When it’s not, Twitch shows the offline screen — hit follow so you don’t miss kickoff.</p>' +
          '<div class="twitch-embed-wrap">' +
            '<iframe class="twitch-player" src="' + twitchSrc + '" title="' + twitch + ' on Twitch" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen scrolling="no" frameborder="0"></iframe>' +
          "</div>" +
          '<div class="twitch-card twitch-card-slim">' +
            '<span class="twitch-card-handle">' + twitch + "</span>" +
            '<span class="twitch-card-sub">Live from the Betfred Arena (the sofa).</span>' +
            '<a class="btn btn-primary btn-small" target="_blank" rel="noopener" href="https://www.twitch.tv/' + twitch + '">Open on Twitch →</a>' +
          "</div>";
        mt.innerHTML =
          '<div class="section-label">@' + handle + " on TikTok</div>" +
          '<p class="screen-intro">The golden boot moonlights as a content machine. Latest uploads, straight from the source \u2014 this updates itself every time he posts.</p>' +
          '<div class="social-embed">' +
            '<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@' + handle + '" data-unique-id="' + handle + '" data-embed-type="creator" style="max-width:780px;min-width:288px;">' +
              '<section class="tiktok-card">' +
                '<span class="tiktok-card-avatar">' + handle.charAt(0).toUpperCase() + "</span>" +
                '<span class="tiktok-card-handle">@' + handle + "</span>" +
                '<span class="tiktok-card-sub">The 40Yr Virgil on TikTok</span>' +
                '<a class="btn btn-primary btn-small" target="_blank" rel="noopener" href="https://www.tiktok.com/@' + handle + '?refer=creator_embed">Open profile \u2192</a>' +
              "</section>" +
            "</blockquote>" +
          "</div>" +
          '<p class="social-fallback">Feed not loading? TikTok\u2019s profile widget can be temperamental \u2014 <a href="https://www.tiktok.com/@' + handle + '" target="_blank" rel="noopener">open @' + handle + " on TikTok \u2192</a></p>" +
          twitchCard;
        var old = document.getElementById("tiktok-embed-script");
        if (old) old.parentNode.removeChild(old);
        var s = document.createElement("script");
        s.id = "tiktok-embed-script";
        s.async = true;
        s.src = "https://www.tiktok.com/embed.js";
        document.body.appendChild(s);

        var liveEl = U.$("#social-live");
        if (liveEl) renderTwitchBadge(liveEl);
        pollTwitchLive();
      });
    }
  };

  /* ------------------------------------------------ TICKETS (gag) */
  var TICKETS = [
    { name: "The Sofa", price: "Free", perk: "Premium seat. You already own it. BYO snacks.", cta: "Claim your spot" },
    { name: "Away End", price: "\u00A30", perk: "Stand in your kitchen and shout at the router. Authentic atmosphere guaranteed.", cta: "Travel (to the kitchen)" },
    { name: "Director's Box", price: "\u00A3\u221E", perk: "Sit next to the gaffer while he picks the formation. Spoiler: Tupci plays CAM.", cta: "Enquire" },
    { name: "Season Ticket", price: "Your loyalty", perk: "Every match, every formation, every Rizzy Dave non-appearance. Non-transferable. The group chat would notice.", cta: "Renew automatically" }
  ];

  PAGES.tickets = {
    enter: function () {
      var mt = U.$("#tickets-view");
      mt.innerHTML =
        '<p class="screen-intro">Matchday at the Betfred Arena is calling. Choose your tier. All sales are final, imaginary, and a bit of a laugh.</p>' +
        '<div class="ticket-grid">' +
          TICKETS.map(function (t) {
            return '<div class="ticket-card">' +
              '<div class="ticket-tier">' + U.esc(t.name) + "</div>" +
              '<div class="ticket-price">' + U.esc(t.price) + "</div>" +
              '<p class="ticket-perk">' + U.esc(t.perk) + "</p>" +
              '<button class="btn btn-gold btn-small ticket-buy">' + U.esc(t.cta) + "</button>" +
            "</div>";
          }).join("") + "</div>" +
        '<p class="sync-note">No real tickets were harmed. One club, one squad, one sofa.</p>';
      U.$$(".ticket-buy", mt).forEach(function (b) {
        b.addEventListener("click", function () {
          U.toast("\uD83C\uDF9F\uFE0F Ticket reserved on the sofa. Kick-off is whenever the lobby connects.");
        });
      });
    }
  };

  /* ------------------------------------------------ FORUM (members) */
  var FORUM_LABELS = { matchday: "Matchday", banter: "Banter", tactics: "Tactics", transfers: "Transfers & Squad", offtopic: "Off-topic" };
  var forumState = { view: "list", category: "", threadId: null, composing: false };

  function forumGate(mt) {
    mt.innerHTML =
      '<div class="panel"><p class="chat-gate-line">The dressing room is members only</p>' +
      '<p class="chat-gate-sub">Sign in to read the threads and have your say.</p>' +
      '<button class="btn btn-primary" id="forum-gate-btn">Sign in · Register</button></div>';
    var b = U.$("#forum-gate-btn", mt);
    if (b) b.addEventListener("click", function () {
      if (!NET.hasBackend()) { U.toast("Connect the backend first (js/config.js)."); return; }
      openAuth("login");
    });
  }

  function renderForum() {
    var mt = U.$("#forum-view");
    if (!mt) return;
    if (!NET.me) { forumGate(mt); return; }
    if (forumState.view === "thread" && forumState.threadId) { renderForumThread(mt); return; }
    renderForumList(mt);
  }

  function renderForumList(mt) {
    mt.innerHTML =
      '<div class="forum-cats" id="forum-cats">' +
        '<button class="filter-btn' + (forumState.category === "" ? " active" : "") + '" data-cat="">All</button>' +
        Object.keys(FORUM_LABELS).map(function (c) {
          return '<button class="filter-btn' + (forumState.category === c ? " active" : "") + '" data-cat="' + c + '">' + U.esc(FORUM_LABELS[c]) + "</button>";
        }).join("") +
      "</div>" +
      '<div class="admin-actions"><button class="btn btn-gold btn-small" id="forum-new-btn">+ New thread</button></div>' +
      '<div id="forum-compose"></div>' +
      '<div id="forum-threads">' + U.emptyState("Opening the room…", "", "💬") + "</div>";

    U.$$("#forum-cats .filter-btn", mt).forEach(function (b) {
      b.addEventListener("click", function () { forumState.category = b.getAttribute("data-cat"); renderForum(); });
    });
    U.$("#forum-new-btn", mt).addEventListener("click", function () { toggleCompose(); });

    NET.forumThreads(forumState.category).then(function (res) {
      var list = U.$("#forum-threads", mt);
      if (!list) return;
      if (!res || !res.ok) {
        if (res && (res.error === "auth" || res.error === "session")) { NET.me = null; renderAccount(); renderForum(); return; }
        list.innerHTML = liveBlock(res, "the forum") || U.emptyState("Couldn't open the room", "", "—");
        return;
      }
      var threads = res.threads || [];
      list.innerHTML = threads.length
        ? threads.map(function (t) {
            var lvl = t.level >= 9 ? '<span class="level-chip level-admin">ADMIN</span>' : t.level >= 5 ? '<span class="level-chip level-mod">MOD</span>' : "";
            return '<article class="forum-thread-row" data-id="' + U.esc(t.id) + '">' +
              (t.pinned ? '<span class="forum-pin">📌</span>' : "") +
              '<div class="forum-thread-main">' +
                '<span class="forum-cat-tag">' + U.esc(FORUM_LABELS[t.category] || t.category) + "</span>" +
                '<span class="forum-thread-title">' + U.esc(t.title) + "</span>" +
                '<span class="forum-thread-meta">' + U.esc(t.name) + " " + lvl + " · " + U.fmtDateTime(t.last) + "</span>" +
              "</div>" +
              '<span class="forum-thread-replies">' + t.replies + '<span class="forum-replies-label">repl' + (t.replies === 1 ? "y" : "ies") + "</span></span>" +
            "</article>";
          }).join("")
        : U.emptyState("No threads here yet", "Be the one who starts it.", "🗨");
      U.$$(".forum-thread-row", list).forEach(function (row) {
        row.addEventListener("click", function () {
          forumState.view = "thread"; forumState.threadId = row.getAttribute("data-id"); renderForum();
        });
      });
    });
  }

  function toggleCompose() {
    var box = U.$("#forum-compose");
    if (!box) return;
    if (box.innerHTML) { box.innerHTML = ""; return; }
    box.innerHTML =
      '<div class="panel forum-compose-box">' +
        '<label class="field"><span class="field-label">Category</span><select id="forum-c-cat">' +
          Object.keys(FORUM_LABELS).map(function (c) {
            return '<option value="' + c + '"' + (forumState.category === c ? " selected" : "") + ">" + U.esc(FORUM_LABELS[c]) + "</option>";
          }).join("") + "</select></label>" +
        '<label class="field"><span class="field-label">Title</span><input type="text" id="forum-c-title" maxlength="100" placeholder="What\'s the topic?"></label>' +
        '<label class="field"><span class="field-label">Opening post</span><textarea id="forum-c-body" rows="4" maxlength="4000" placeholder="Say your piece…"></textarea></label>' +
        '<div class="admin-actions"><button class="btn btn-primary btn-small" id="forum-c-post">Post thread</button>' +
        '<button class="btn btn-ghost btn-small" id="forum-c-cancel" type="button">Cancel</button>' +
        '<span class="admin-inline-note" id="forum-c-msg"></span></div>' +
      "</div>";
    U.$("#forum-c-cancel", box).addEventListener("click", function () { box.innerHTML = ""; });
    U.$("#forum-c-post", box).addEventListener("click", function () {
      var cat = U.$("#forum-c-cat", box).value;
      var title = U.$("#forum-c-title", box).value.trim();
      var body = U.$("#forum-c-body", box).value.trim();
      var msg = U.$("#forum-c-msg", box);
      if (!title || !body) { msg.textContent = "Title and post, both."; return; }
      this.disabled = true; msg.textContent = "Posting…";
      NET.forumNew(cat, title, body).then(function (r) {
        if (r && r.ok) { U.toast("Thread posted."); box.innerHTML = ""; forumState.view = "thread"; forumState.threadId = r.id; renderForum(); }
        else if (r && r.error === "language") msg.textContent = "Mind the language — the stewards are watching.";
        else { msg.textContent = "✗ " + ((r && r.error) || "Couldn't post."); }
      });
    });
  }

  function renderForumThread(mt) {
    mt.innerHTML = '<button class="btn btn-ghost btn-small" id="forum-back">← All threads</button>' +
      '<div id="forum-thread-body">' + U.emptyState("Opening…", "", "⏱") + "</div>";
    U.$("#forum-back", mt).addEventListener("click", function () { forumState.view = "list"; forumState.threadId = null; renderForum(); });

    NET.forumThread(forumState.threadId).then(function (res) {
      var box = U.$("#forum-thread-body", mt);
      if (!box) return;
      if (!res || !res.ok) {
        if (res && (res.error === "auth" || res.error === "session")) { NET.me = null; renderAccount(); renderForum(); return; }
        box.innerHTML = U.emptyState("Thread not found", "It may have been removed.", "—"); return;
      }
      var t = res.thread, posts = res.posts || [];
      function head(name, level, ts) {
        var lvl = level >= 9 ? '<span class="level-chip level-admin">ADMIN</span>' : level >= 5 ? '<span class="level-chip level-mod">MOD</span>' : "";
        return '<span class="forum-post-name">' + U.esc(name) + "</span>" + lvl + '<span class="forum-post-ts">' + U.fmtDateTime(ts) + "</span>";
      }
      var modDel = NET.isMod();
      box.innerHTML =
        '<div class="forum-cat-tag forum-cat-standalone">' + U.esc(FORUM_LABELS[t.category] || t.category) + "</div>" +
        '<h1 class="forum-view-title">' + U.esc(t.title) + "</h1>" +
        '<article class="forum-post forum-op">' +
          '<div class="forum-post-head">' + head(t.name, t.level, t.ts) +
            (modDel ? '<button class="forum-del" data-thread="' + U.esc(t.id) + '" title="Remove thread">×</button>' : "") + "</div>" +
          '<div class="forum-post-text">' + U.esc(t.body).replace(/\n/g, "<br>") + "</div>" +
        "</article>" +
        '<div class="section-label">' + posts.length + " repl" + (posts.length === 1 ? "y" : "ies") + "</div>" +
        '<div class="forum-posts">' +
          posts.map(function (p) {
            return '<article class="forum-post">' +
              '<div class="forum-post-head">' + head(p.name, p.level, p.ts) +
                (modDel ? '<button class="forum-del" data-post="' + U.esc(p.id) + '" title="Remove reply">×</button>' : "") + "</div>" +
              '<div class="forum-post-text">' + U.esc(p.text).replace(/\n/g, "<br>") + "</div>" +
            "</article>";
          }).join("") +
        "</div>" +
        '<div class="panel forum-reply-box">' +
          '<label class="field"><span class="field-label">Your reply</span><textarea id="forum-reply-text" rows="3" maxlength="2000" placeholder="Add to the conversation…"></textarea></label>' +
          '<div class="admin-actions"><button class="btn btn-primary btn-small" id="forum-reply-btn">Reply</button>' +
          '<span class="admin-inline-note" id="forum-reply-msg"></span></div>' +
        "</div>";

      U.$("#forum-reply-btn", box).addEventListener("click", function () {
        var text = U.$("#forum-reply-text", box).value.trim();
        var msg = U.$("#forum-reply-msg", box);
        if (!text) { msg.textContent = "Say something first."; return; }
        this.disabled = true; msg.textContent = "Posting…";
        NET.forumReply(forumState.threadId, text).then(function (r) {
          if (r && r.ok) { renderForum(); }
          else if (r && r.error === "language") { msg.textContent = "Mind the language."; }
          else { msg.textContent = "✗ " + ((r && r.error) || "Couldn't reply."); }
        });
      });
      U.$$(".forum-del", box).forEach(function (b) {
        b.addEventListener("click", function () {
          var payload = b.hasAttribute("data-post") ? { postId: b.getAttribute("data-post") } : { threadId: b.getAttribute("data-thread") };
          NET.forumDelete(payload).then(function (r) {
            if (r && r.ok) {
              U.toast("Removed.");
              if (payload.threadId) { forumState.view = "list"; forumState.threadId = null; }
              renderForum();
            } else U.toast("Couldn't remove that.");
          });
        });
      });
    });
  }

  PAGES.forum = { enter: function () { renderForum(); } };

  /* ------------------------------------------------ THE BOOK OF TÜPCI (hidden) */
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

  /* ------------------------------------------------ EASTER EGGS (ungated club fun) */
  function initEasterEggs() {
    var KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
    var kpos = 0;
    document.addEventListener("keydown", function (e) {
      var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      kpos = (k === KONAMI[kpos]) ? kpos + 1 : (k === KONAMI[0] ? 1 : 0);
      if (kpos === KONAMI.length) {
        kpos = 0;
        document.body.classList.add("konami");
        U.toast("⚽ CHEAT UNLOCKED: the system was the friends we made along the way. (It was Tupci. It's always Tupci.)");
        setTimeout(function () { document.body.classList.remove("konami"); }, 4000);
      }
    });

    var CREST_LINES = [
      "You'll Never Walk Alone. Especially in the group chat.",
      "Anfield South. Capacity: one sofa.",
      "Three lads from up and down the country, one badge.",
      "Black Country steel, Scouse heart, Luton patience.",
      "The whole side runs through the captain. He'll tell you himself.",
      "472 goals. 435 assists. One ongoing argument.",
      "The bot delivers. Donovan said so."
    ];
    // Bind to the big hub crest (a plain <img>, no wrapping link) so taps
    // count cleanly; the nav crest is an anchor to #home and fights the count.
    // touch-action:manipulation (in CSS) stops mobile double-tap zoom.
    var taps = 0, tapTimer = null, ci = 0;
    var crest = U.$(".hero-crest") || U.$(".nav-crest");
    if (crest) crest.addEventListener("click", function () {
      taps++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function () { taps = 0; }, 1200);
      if (taps === 5) {
        U.toast("🛡 " + CREST_LINES[ci % CREST_LINES.length]);
        ci++;
      } else if (taps >= 10) {
        taps = 0;
        U.toast("📖 The Book of Tüpci is open. Up the Virgil.");
        location.hash = "#book";
      }
    });
  }

  /* ------------------------------------------------ ADMIN (delegates) */
  PAGES.admin = {
    enter: function () { window.ADMIN.enter(U.$("#admin-view"), { renderAccount: renderAccount, applyConfig: applyConfig }); }
  };

  /* ------------------------------------------------ TACTICS (delegates) */
  PAGES.tactics = {
    enter: function () {
      applySquadOverrides();
      window.OFFICIAL_LINEUPS = cfg().lineups || {};
      window.TACTICS.enter(U.$("#tactics-view"));
    }
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
    initEasterEggs();
    window.addEventListener("hashchange", route);
    route();

    DATA.config().then(function (res) {
      applyConfig(res);
      if (parseHash().name === "about") PAGES.about.enter();
    });

    pollTwitchLive();
    if (NET.hasBackend()) setInterval(pollTwitchLive, 90000);

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
