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
    "search", "about", "tickets", "floor", "admin"];

  /* Per-route browser tab titles. The full site title is kept for Home;
     every other page names itself so bookmarks, history and shared browser
     links are distinguishable. Dynamic pages (player/match/opponent/profile/
     thread) show a placeholder here, then refine to the real name once their
     data loads. */
  var BASE_TITLE = document.title;
  var ROUTE_TITLES = {
    archive: "The Archive", match: "Match Report", opponent: "Head to Head",
    squad: "The Squad", player: "Player Dossier", tactics: "Tactics Board",
    matchday: "Matchday", clubhouse: "The Clubhouse", thread: "Thread",
    inbox: "Inbox", conversation: "Conversation", profile: "Member Profile",
    funhouse: "The Funhouse", book: "The Book of Tüpci", more: "More",
    stats: "Stats Centre", honours: "Honours", gaffer: "The Gaffer",
    news: "The Gazette", social: "Socials", search: "Search",
    about: "About the Club", tickets: "Tickets", floor: "Clubhouse Floor",
    admin: "Housekeeping"
  };
  function setDocTitle(part) {
    document.title = part ? part + " · The 40Yr Virgil" : BASE_TITLE;
  }

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
    setDocTitle(ROUTE_TITLES[r.name]);

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

  /* Skip-to-content: move focus (and scroll) to <main> without changing the
     hash — a bare "#main" would hit the router and bounce to Home. */
  function bindSkipLink() {
    var link = U.$("#skip-link"), main = U.$("#main");
    if (!link || !main) return;
    link.addEventListener("click", function (e) {
      e.preventDefault();
      main.focus();
      main.scrollIntoView();
    });
  }

  /* ========================================================
     ACCOUNT / AUTH
     ======================================================== */
  /* A member's name with their equipped cosmetics (accent colour + flair). */
  function decoName(display, flair, accent) {
    return '<span class="deco-name' + (accent ? " name-accent-" + accent : "") + '">' + U.esc(display) + "</span>" + (flair ? ' <span class="deco-flair">' + U.esc(flair) + "</span>" : "");
  }

  /* Relative "2h ago" timestamps for chat + forum. */
  function timeAgo(iso) {
    if (!iso) return "";
    var d = new Date(iso), s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (isNaN(s)) return U.fmtDate(iso);
    if (s < 45) return "just now";
    var m = Math.round(s / 60); if (m < 60) return m + "m ago";
    var h = Math.round(m / 60); if (h < 24) return h + "h ago";
    var days = Math.round(h / 24); if (days < 7) return days + "d ago";
    return U.fmtDate(iso);
  }
  function levelChip(level) {
    return Number(level) >= 9 ? '<span class="level-chip level-admin">ADMIN</span>'
         : Number(level) >= 5 ? '<span class="level-chip level-mod">MOD</span>' : "";
  }

  /* Share the current page: native share sheet on mobile, copy-to-clipboard
     fallback on desktop, URL toast as a last resort. */
  function shareLink(title) {
    var url = location.href;
    if (navigator.share) { navigator.share({ title: title, url: url }).catch(function () {}); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { U.toast("Link copied"); }, function () { U.toast(url); });
      return;
    }
    U.toast(url);
  }
  var SHARE_BTN = '<button class="btn btn-ghost btn-small share-btn" type="button">↗ Share</button>';
  function wireShare(container, title) {
    var b = U.$(".share-btn", container);
    if (b) { b.setAttribute("aria-label", "Share: " + title); b.addEventListener("click", function () { shareLink(title); }); }
  }
  function authorLine(display, level, flair, accent, iso) {
    return '<div class="post-meta"><span class="post-author">' + decoName(display || "Member", flair, accent) + "</span>" +
      levelChip(level) + '<span class="post-time">' + timeAgo(iso) + "</span></div>";
  }

  /* Reaction bar — a fixed emoji set with live counts; highlights the caller's. */
  var REACTS = ["👍", "❤️", "😂", "🔥", "😮"];
  function reactionBar(targetType, targetId, reactions, mine) {
    mine = mine || [];
    var counts = {}; (reactions || []).forEach(function (r) { counts[r.emoji] = r.n; });
    return '<div class="react-bar">' + REACTS.map(function (e) {
      var n = counts[e] || 0, on = mine.indexOf(e) !== -1;
      return '<button class="react-btn' + (on ? " react-on" : "") + '" type="button" data-tt="' + targetType + '" data-ti="' + U.esc(targetId) + '" data-emoji="' + e + '">' +
        e + (n ? ' <span class="react-n">' + n + "</span>" : "") + "</button>";
    }).join("") + "</div>";
  }
  /* Wire every reaction button under `container`; `after` re-renders on success. */
  function wireReactions(container, after) {
    U.$$(".react-btn", container).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        if (!NET.me) { openAuth(); return; }
        NET.react(b.getAttribute("data-tt"), b.getAttribute("data-ti"), b.getAttribute("data-emoji")).then(function (r) {
          if (r && r.ok && typeof after === "function") after();
        });
      });
    });
  }

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
    turnstile: "Verification failed — try again.",
    "2fa_required": "Enter the 6-digit code from your authenticator app.",
    "2fa_bad": "That code didn't match — try the current one."
  };

  function openAuth() {
    var m = U.$("#auth-modal");
    m.hidden = false;
    U.$("#auth-error").textContent = "";
    U.$("#auth-form").reset();
    var tf = U.$("#auth-2fa-row"); if (tf) tf.hidden = true;
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
      var twoFaRow = U.$("#auth-2fa-row");
      var code = (twoFaRow && !twoFaRow.hidden) ? U.$("#auth-2fa").value.trim() : "";
      var p = mode === "register" ? NET.register(name, pass, tok) : NET.login(name, pass, tok, code);
      p.then(function (r) {
        btn.disabled = false;
        renderTurnstile();
        if (r && r.ok) {
          if (twoFaRow) { twoFaRow.hidden = true; U.$("#auth-2fa").value = ""; }
          closeAuth();
          renderAccount();
          U.toast(mode === "register" ? "Welcome, " + r.name + "." : "Welcome back, " + r.name + ".");
          route();
        } else {
          var rc = r && (r.code || r.error);
          if (rc === "2fa_required" || rc === "2fa_bad") { if (twoFaRow) { twoFaRow.hidden = false; var f = U.$("#auth-2fa"); if (f) f.focus(); } }
          err.textContent = AUTH_ERR[rc] || ("Something went wrong" + (rc ? " (" + rc + ")" : "") + ". Try again.");
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
        var recAll = res.recordAll || {};
        var form = (res.form || []).map(function (r) { return U.pill(r); }).join("");
        var next = res.nextFixture;
        var ls = res.leagueStatus || {};
        function cell(v, lab) { return v ? '<div class="league-cell"><span class="league-val">' + U.esc(v) + '</span><span class="league-lab">' + lab + "</span></div>" : ""; }
        var strip = (ls.division || ls.position || ls.points)
          ? '<div class="league-strip panel">' +
              '<div class="league-row">' +
                cell(ls.division, "Division") + cell(ls.position, "Position") + cell(ls.points, "Points") +
              "</div>" +
            "</div>"
          : "";

        // The complete verified record is the default; a toggle drops to the
        // current-season slice. Goals for/against only shown for all-time
        // (the baseline carries them). Recent form is shown once, centred.
        var scope = "all";
        function recordTiles() {
          var r = scope === "all" ? recAll : rec;
          return '<div class="tile-row">' +
            U.statTile("Played", U.num(r.played)) +
            U.statTile("Wins", U.num(r.wins), { accent: "win" }) +
            U.statTile("Draws", U.num(r.draws)) +
            U.statTile("Losses", U.num(r.losses), { accent: "loss" }) +
            (scope === "all" && (r.goalsFor != null || r.goalsAgainst != null)
              ? U.statTile("Goals for", U.num(r.goalsFor), { accent: "gold" }) + U.statTile("Goals against", U.num(r.goalsAgainst))
              : "") +
          "</div>";
        }
        function renderHome() {
          mt.innerHTML = strip +
            '<div class="home-scope-head"><div class="section-label home-season-label">' + (scope === "all" ? "All-time record" : "This season") + "</div>" +
              '<div class="stat-toggle home-scope-toggle">' +
                '<button class="tab' + (scope === "all" ? " active" : "") + '" data-scope="all">All-time</button>' +
                '<button class="tab' + (scope === "season" ? " active" : "") + '" data-scope="season">This season</button>' +
              "</div></div>" +
            recordTiles() +
            '<div class="stat-tile stat-tile-wide home-form-tile"><span class="stat-tile-label">Recent form</span><div class="form-pills form-pills-center">' + (form || "—") + "</div></div>" +
            (next ? '<a class="stat-tile stat-tile-wide" href="#matchday"><span class="stat-tile-label">Next up</span><span class="stat-tile-value" style="font-size:1.1rem">' +
              (next.opponent ? U.esc(next.opponent) : "Club session") + (next.date_iso ? " · " + U.fmtDate(next.date_iso) : "") + "</span></a>" : "");
          U.$$(".home-scope-toggle .tab", mt).forEach(function (b) {
            b.addEventListener("click", function () { scope = b.getAttribute("data-scope"); renderHome(); });
          });
          U.runCountUps(mt);
        }
        renderHome();
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

  /* Build a probable XI for a match that has no saved teamsheet: place the
     players who actually have a stat line (the named side) by position fit,
     then bot-fill the rest to 11 using the preset formation. Never adds a human
     who wasn't named. Donovan sits when Amy (Whimsy) is on the sheet. */
  function reconstructLineup(m, stats) {
    var fkey = (m.formation && window.FORMATIONS[m.formation]) ? m.formation : window.DEFAULT_FORMATION;
    var f = window.FORMATIONS[fkey];
    if (!f) return null;
    var byId = {}; (window.SQUAD || []).forEach(function (p) { byId[p.id] = p; });
    var namedIds = (stats || []).map(function (s) { return s.player_id; }).filter(function (id) { return byId[id]; });
    var namedSet = {}; namedIds.forEach(function (id) { namedSet[id] = 1; });
    var amyActive = !!namedSet.amy;
    var named = namedIds.filter(function (id) { return !(amyActive && id === "donovan"); });
    var slots = f.slots.map(function () { return null; });
    var used = {};
    function place(i, id) { if (id && byId[id] && !used[id]) { slots[i] = id; used[id] = 1; return true; } return false; }
    // Named players first — by exact role, then position group, then anywhere.
    ["exact", "group", "any"].forEach(function (level) {
      f.slots.forEach(function (s, i) {
        if (slots[i]) return;
        for (var k = 0; k < named.length; k++) { var id = named[k]; if (used[id]) continue;
          if (level === "any" || U.posFit(byId[id], s.pos) === level) { place(i, id); break; } }
      });
    });
    // Bot-fill the rest to a full XI — only AI players, never an un-named human.
    var bots = (window.SQUAD || []).filter(function (p) {
      return !p.isHuman && !p.permaBench && !(amyActive && p.id === "donovan") && !used[p.id];
    }).map(function (p) { return p.id; });
    ["exact", "group", "any"].forEach(function (level) {
      f.slots.forEach(function (s, i) {
        if (slots[i]) return;
        for (var k = 0; k < bots.length; k++) { var id = bots[k]; if (used[id]) continue;
          if (level === "any" || U.posFit(byId[id], s.pos) === level) { place(i, id); break; } }
      });
    });
    var players = [];
    slots.forEach(function (id, i) { if (id) players.push({ player_id: id, is_sub: 0, slot_index: i }); });
    named.forEach(function (id) { if (!used[id]) players.push({ player_id: id, is_sub: 1 }); });
    if (!players.some(function (p) { return !p.is_sub; })) return null;
    return { formation: fkey, players: players, captain_player_id: m.captain_player_id, reconstructed: true };
  }

  function miniPitch(m) {
    var lu = m.lineup;
    if ((!lu || !lu.players || !lu.players.length) && m.reconstructFrom) lu = reconstructLineup(m.match || m, m.reconstructFrom);
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
    return '<div class="section-label">' + (lu.reconstructed ? "Likely XI" : "The XI") + " · " + U.esc(lu.formation) + "</div>" +
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
        setDocTitle("Match " + m.id + " vs " + (m.opponent || "Unknown"));
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
            miniPitch({ lineup: res.lineup, match: m, reconstructFrom: res.stats }) +
            (res.stats && res.stats.length ? statsTable(res.stats) : "") +
            (m.note ? '<p class="result-note">📝 ' + U.esc(m.note) + "</p>" : "") +
            (NET.isMod() ? '<div class="admin-actions"><button class="btn btn-ghost btn-small" id="mr-edit">Edit in Housekeeping →</button></div>' : "") +
            '<div style="margin:6px 0 2px">' + SHARE_BTN + "</div>" +
            '<a class="back-link" href="#archive">← All results</a>' +
          "</article>";
        var eb = U.$("#mr-edit", mt);
        if (eb) eb.addEventListener("click", function () { try { sessionStorage.setItem("v40.editseq", String(m.id)); } catch (e) {} location.hash = "#admin"; });
        wireShare(mt, "Match " + m.id + " vs " + (m.opponent || "Unknown") + " · The 40Yr Virgil");
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
      setDocTitle(name ? "vs " + name : "Head to Head");
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
            return '<a class="result-row" href="#match/' + m.id + '"><div class="result-main">' + U.pill(m.result) +
              '<div class="result-mid"><span class="result-line">Match ' + m.id + (m.stage && m.stage !== "league" ? " · " + U.esc(STAGE_LABEL[m.stage] || m.stage) : "") + "</span></div>" +
              '<span class="result-score">' + m.our_score + "–" + m.their_score + "</span>" +
              '<span class="result-meta">' + (m.date_iso ? U.fmtDate(m.date_iso) : "") + "</span></div></a>";
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
              U.statTile("Assists", U.num(base.assists)) + U.statTile("Avg rating", base.avg_rating != null ? Number(base.avg_rating).toFixed(1) : "—") + "</div>";
          }
          return '<div class="tile-row">' + U.statTile("Apps", U.num(rec.apps) || 0) + U.statTile("Goals", U.num(rec.goals) || 0) +
            U.statTile("Assists", U.num(rec.assists) || 0) + U.statTile("Avg rating", rec.avg_rating != null ? Number(rec.avg_rating).toFixed(1) : "—") +
            (rec.saves > 0 || rec.conceded > 0 ? U.statTile("Saves", U.num(rec.saves) || 0) + U.statTile("Conceded", U.num(rec.conceded) || 0) : "") + "</div>";
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

        var titleEl = U.$("#screen-player .screen-title");
        if (titleEl) titleEl.textContent = p.name;
        setDocTitle(p.name);
        mt.innerHTML =
          '<div class="player-dossier">' +
            '<div class="card-tile player-portrait-card"><img src="' + U.esc(U.cardSrc(p)) + '" alt="' + U.esc(p.name) + '" loading="eager" fetchpriority="high" decoding="async" onerror="this.onerror=null;this.src=\'assets/img/crest.png\'"></div>' +
            "<h2>" + U.esc(p.name) + " <span class=\"player-num\">#" + p.number + "</span></h2>" +
            '<p class="player-meta">' + U.esc(pos) + " · " + U.chips(p) + "</p>" +
            (p.flavour ? '<p class="player-flavour">' + U.esc(p.flavour) + "</p>" : "") +
            '<div style="margin:4px 0 14px">' + SHARE_BTN + "</div>" +
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
        wireShare(mt, p.name + " · The 40Yr Virgil");
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
              '<div class="ch-avail-slot" data-fid="' + U.esc(f.id) + '">' + availBlock(f, f.availability || []) + "</div>" +
              (isMatch && NET.me ? predictBlock(f) : "") +
            "</div>";
          }).join("");
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
            U.$$('.ch-rsvp[data-fid="' + fid + '"]', mt).forEach(function (b) { b.disabled = true; });
            NET.avail(fid, status).then(function (r) {
              if (r && r.ok) { U.toast(status ? "RSVP saved." : "RSVP cleared."); render(); }
              else { U.$$('.ch-rsvp[data-fid="' + fid + '"]', mt).forEach(function (b) { b.disabled = false; }); U.toast("✗ RSVP failed"); }
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
      else if (clubhouseTab === "polls") renderPolls();
      else if (clubhouseTab === "board") renderPointsBoard();
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
          return '<button class="forum-cat' + (forumCat === c.key ? " active" : "") + '" data-cat="' + U.esc(c.key) + '">' + U.esc(c.name) +
            (c.threads ? ' <span class="forum-cat-n">' + c.threads + "</span>" : "") + "</button>";
        }).join("") + "</div>";
      var newBox = NET.me ? '<div class="panel"><div class="field-row">' +
        '<label class="field"><span class="field-label">Category</span><select id="fc-cat">' + cats.map(function (c) { return '<option value="' + U.esc(c.key) + '"' + (c.key === forumCat ? " selected" : "") + ">" + U.esc(c.name) + "</option>"; }).join("") + "</select></label>" +
        '<label class="field"><span class="field-label">Title</span><input type="text" id="fc-title" maxlength="120"></label></div>' +
        '<textarea id="fc-body" rows="3" placeholder="Say your piece…" maxlength="4000"></textarea>' +
        '<div class="admin-actions"><button class="btn btn-primary btn-small" id="fc-post">Post thread</button><span class="admin-inline-note" id="fc-msg"></span></div></div>' : "";
      var threadsHtml = (res.threads || []).length ? (res.threads).map(function (t) {
        return '<a class="forum-thread" href="#thread/' + t.id + '">' +
          '<div class="forum-thread-main">' + (t.pinned ? '<span class="news-pin">📌</span> ' : "") +
            '<span class="forum-thread-title">' + U.esc(t.title) + "</span>" +
            '<span class="forum-thread-by">' + decoName(t.author, t.flair, t.accent) + " · " + U.esc(t.category_name || "") + "</span></div>" +
          '<div class="forum-thread-side"><span class="forum-thread-replies">' + t.replies + " 💬</span><span class=\"forum-thread-when\">" + timeAgo(t.last_iso) + "</span></div></a>";
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
        setDocTitle(t.title);
        var replyBox = NET.me ? '<div class="panel"><textarea id="th-reply" rows="3" placeholder="Reply…" maxlength="4000"></textarea>' +
          '<div class="admin-actions"><button class="btn btn-primary btn-small" id="th-send">Reply</button><span class="admin-inline-note" id="th-msg"></span></div></div>' : "";
        var posts = res.posts || [];
        mt.innerHTML =
          '<article class="panel forum-op">' +
            authorLine(t.author, t.author_level, t.flair, t.accent, t.created_iso) +
            "<h2>" + U.esc(t.title) + "</h2>" +
            '<p class="forum-post-body">' + U.esc(t.body).replace(/\n/g, "<br>") + "</p>" +
            reactionBar("thread", t.id, t.reactions, t.myReactions) +
          "</article>" +
          '<div class="section-label">' + posts.length + (posts.length === 1 ? " reply" : " replies") + "</div>" +
          (posts.length ? posts.map(function (p) {
            return '<article class="panel forum-post">' +
              (NET.isMod() ? '<button class="chat-del forum-del" data-id="' + U.esc(p.id) + '" title="Remove">×</button>' : "") +
              authorLine(p.author, p.author_level, p.flair, p.accent, p.created_iso) +
              "<p>" + U.esc(p.body).replace(/\n/g, "<br>") + "</p>" +
              reactionBar("post", p.id, p.reactions, p.myReactions) +
            "</article>";
          }).join("") : '<p class="screen-intro">No replies yet — get the conversation going.</p>') +
          replyBox;
        wireReactions(mt, function () { PAGES.thread.enter(arg); });
        U.$$(".forum-del", mt).forEach(function (b) {
          b.addEventListener("click", function () {
            NET.forumDeletePost(b.getAttribute("data-id")).then(function (r) { if (r && r.ok) { U.toast("Removed."); PAGES.thread.enter(arg); } });
          });
        });
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
              '<div class="chat-meta"><span class="chat-name' + (m.accent ? " name-accent-" + U.esc(m.accent) : "") + '">' + U.esc(m.display) + "</span>" +
                (m.flair ? ' <span class="deco-flair">' + U.esc(m.flair) + "</span>" : "") + lvl +
                '<span class="chat-ts">' + timeAgo(m.created_iso) + "</span>" + del + "</div>" +
              '<div class="chat-text">' + U.esc(m.body) + "</div>" +
              reactionBar("chat", m.id, m.reactions, m.myReactions) +
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
      wireReactions(list, fetchChatMessages);
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

  /* ---------------- POLLS ---------------- */
  function renderPolls() {
    var mt = U.$("#clubhouse-view");
    mt.innerHTML = U.emptyState("Loading polls…", "", "📊");
    NET.polls().then(function (res) {
      var block = liveBlock(res, "polls");
      if (block) { mt.innerHTML = block; return; }
      var polls = (res && res.polls) || [];
      var creator = NET.isMod() ?
        '<div class="panel poll-create"><div class="section-label">Run a poll</div>' +
          '<input type="text" id="poll-q" class="fun-input" maxlength="160" placeholder="Ask the club something…">' +
          '<div id="poll-opts"><input type="text" class="fun-input poll-opt" maxlength="80" placeholder="Option 1"><input type="text" class="fun-input poll-opt" maxlength="80" placeholder="Option 2"></div>' +
          '<div class="admin-actions"><button class="btn btn-ghost btn-small" id="poll-add-opt" type="button">+ Option</button>' +
          '<button class="btn btn-gold btn-small" id="poll-create">Post poll</button></div></div>' : "";
      mt.innerHTML = creator + (polls.length ? polls.map(pollCard).join("") : U.emptyState("No polls yet", NET.isMod() ? "Run one above." : "Check back when the staff put one up.", "📊"));

      if (NET.isMod()) {
        U.$("#poll-add-opt", mt).addEventListener("click", function () {
          var box = U.$("#poll-opts", mt);
          if (box.querySelectorAll(".poll-opt").length >= 8) return;
          var inp = document.createElement("input"); inp.type = "text"; inp.className = "fun-input poll-opt"; inp.maxLength = 80;
          inp.placeholder = "Option " + (box.querySelectorAll(".poll-opt").length + 1); box.appendChild(inp);
        });
        U.$("#poll-create", mt).addEventListener("click", function () {
          var q = U.$("#poll-q", mt).value.trim();
          var opts = U.$$(".poll-opt", mt).map(function (i) { return i.value.trim(); }).filter(Boolean);
          if (!q || opts.length < 2) { U.toast("Need a question and 2+ options."); return; }
          NET.pollCreate(q, opts).then(function (r) { if (r && r.ok) { U.toast("Poll posted."); renderPolls(); } else U.toast("✗ couldn't post"); });
        });
      }
      wirePolls(mt);
    });
  }
  function pollCard(p) {
    var voted = p.myVote != null || p.closed;
    return '<div class="panel poll-card" data-id="' + p.id + '">' +
      '<div class="poll-q">' + U.esc(p.question) + (p.closed ? ' <span class="pill">closed</span>' : "") + "</div>" +
      '<div class="poll-opts">' + (p.options || []).map(function (o) {
        var pct = p.total ? Math.round((o.votes / p.total) * 100) : 0;
        var mine = p.myVote === o.id;
        if (voted) {
          return '<div class="poll-result' + (mine ? " poll-mine" : "") + '"><div class="poll-bar" style="width:' + pct + '%"></div>' +
            '<span class="poll-label">' + U.esc(o.label) + (mine ? " ✓" : "") + '</span><span class="poll-pct">' + pct + "%</span></div>";
        }
        return '<button class="poll-vote" data-poll="' + p.id + '" data-opt="' + o.id + '">' + U.esc(o.label) + "</button>";
      }).join("") + "</div>" +
      '<div class="poll-foot">' + p.total + (p.total === 1 ? " vote" : " votes") +
        (NET.isMod() && !p.closed ? ' · <button class="poll-close" data-id="' + p.id + '">close</button>' : "") + "</div></div>";
  }
  function wirePolls(mt) {
    U.$$(".poll-vote", mt).forEach(function (b) {
      b.addEventListener("click", function () {
        if (!NET.me) { openAuth(); return; }
        NET.pollVote(b.getAttribute("data-poll"), b.getAttribute("data-opt")).then(function (r) { if (r && r.ok) renderPolls(); });
      });
    });
    U.$$(".poll-close", mt).forEach(function (b) {
      b.addEventListener("click", function () { NET.pollClose(b.getAttribute("data-id")).then(function (r) { if (r && r.ok) renderPolls(); }); });
    });
  }

  /* ---------------- VIRGIL POINTS LEADERBOARD ---------------- */
  function renderPointsBoard() {
    var mt = U.$("#clubhouse-view");
    mt.innerHTML = U.emptyState("Counting…", "", "🪙");
    NET.pointsBoard().then(function (res) {
      var block = liveBlock(res, "the leaderboard");
      if (block) { mt.innerHTML = block; return; }
      var list = (res && res.leaderboard) || [];
      if (!list.length) { mt.innerHTML = U.emptyState("No points earned yet", "Get chatting, posting and voting.", "🪙"); return; }
      mt.innerHTML = '<div class="panel lb-panel"><div class="lb-title">Virgil Points · top earners</div><ol class="lb">' +
        list.map(function (r) {
          return "<li><span class='lb-name'>" + decoName(r.display, r.flair, r.accent) + "</span>" +
            "<span class='lb-val'>" + U.num(r.lifetime) + "<span class='lb-unit'>pts</span></span></li>";
        }).join("") + "</ol></div>";
    });
  }

  function renderDirectory() {
    var mt = U.$("#clubhouse-view");
    mt.innerHTML = U.emptyState("Loading members…", "", "👥");
    NET.members({ limit: 50 }).then(function (res) {
      var block = liveBlock(res, "members");
      if (block) { mt.innerHTML = block; return; }
      mt.innerHTML = (res.members || []).map(function (m) {
        return '<a class="result-row forum-thread-row" href="#profile/' + U.esc(m.username) + '"><span class="result-opp">' + decoName(m.display, m.flair, m.accent) + '</span><span class="result-meta">' + U.fmtDate(m.created_iso) + "</span></a>";
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
        var mine = NET.me && NET.me.username === p.username;
        U.$("#profile-title").textContent = p.display;
        setDocTitle(p.display);
        mt.innerHTML =
          '<div class="panel profile-card">' +
            '<h2>' + decoName(p.display, p.flair, p.accent) + "</h2>" +
            (p.joinDate ? '<p class="admin-inline-note">Joined ' + U.fmtDate(p.joinDate) + "</p>" : "") +
            (p.identity ? '<p><span class="badge badge-human">' + U.esc(p.identity.name) + "</span></p>" : "") +
            (p.titles && p.titles.length ? '<p>' + p.titles.map(function (t) { return '<span class="pill">' + U.esc(t.icon || "") + " " + U.esc(t.name) + "</span>"; }).join(" ") + "</p>" : "") +
            (p.bio ? "<p>" + U.esc(p.bio) + "</p>" : "") +
            (p.linkedPlayer ? '<p><a href="#player/' + p.linkedPlayer.id + '">On the pitch: ' + U.esc(p.linkedPlayer.name) + " #" + p.linkedPlayer.number + "</a></p>" : "") +
            (NET.me && !mine ? '<button class="btn btn-primary btn-small" id="prof-dm">Message</button>' : "") +
          "</div>" +
          (mine ? '<div id="profile-clubhouse"></div><div id="profile-security"></div>' : "");
        var dmb = U.$("#prof-dm");
        if (dmb) dmb.addEventListener("click", function () { NET.dmStart(p.username).then(function (r) { if (r && r.ok) location.hash = "#conversation/" + r.id; else U.toast("Couldn't start a conversation."); }); });
        if (mine) { renderClubhousePanel(U.$("#profile-clubhouse", mt), p); renderSecurityPanel(U.$("#profile-security", mt)); }
      });
    }
  };

  /* The owner-only "My Clubhouse" block: Virgil Points wallet, the shop, and
     cosmetic customisation (equip only what you own). */
  function renderClubhousePanel(box, profile) {
    if (!box) return;
    box.innerHTML = U.emptyState("Counting your points…", "", "🪙");
    Promise.all([NET.mePoints(), NET.shop()]).then(function (r) {
      var w = r[0] || {}, s = r[1] || {};
      var bal = U.num(w.balance) || 0, owned = s.owned || [], items = s.items || [];
      var inv = w.inventory || [];
      var flairsOwned = inv.filter(function (i) { return i.kind === "flair"; });
      var accentsOwned = inv.filter(function (i) { return i.kind === "accent"; });
      var equippedFlair = profile.flair || "", equippedAccent = profile.accent || "";

      function chip(v, label, cls) { return '<button class="cos-chip' + (cls || "") + '">' + v + "</button>"; }

      box.innerHTML =
        '<div class="panel wallet-panel">' +
          '<div class="wallet-head"><span class="wallet-ic">🪙</span><span class="wallet-bal">' + bal + '</span><span class="wallet-lab">Virgil Points</span>' +
            '<a class="account-link" href="#tickets">🎟️ Tickets</a></div>' +
        "</div>" +
        // Customise: equip owned cosmetics
        '<div class="section-label">Customise your name</div>' +
        '<div class="panel">' +
          '<p class="cos-preview">Preview: ' + decoName(profile.display, equippedFlair, equippedAccent) + "</p>" +
          '<div class="cos-row"><span class="cos-lab">Flair</span><div class="cos-chips" id="cos-flairs">' +
            '<button class="cos-chip' + (!equippedFlair ? " cos-on" : "") + '" data-type="flair" data-val="">none</button>' +
            flairsOwned.map(function (i) { return '<button class="cos-chip' + (equippedFlair === i.payload ? " cos-on" : "") + '" data-type="flair" data-val="' + U.esc(i.payload) + '">' + U.esc(i.payload) + "</button>"; }).join("") +
          "</div></div>" +
          '<div class="cos-row"><span class="cos-lab">Name colour</span><div class="cos-chips" id="cos-accents">' +
            '<button class="cos-chip' + (!equippedAccent ? " cos-on" : "") + '" data-type="accent" data-val="">default</button>' +
            accentsOwned.map(function (i) { return '<button class="cos-chip name-accent-' + U.esc(i.payload) + (equippedAccent === i.payload ? " cos-on" : "") + '" data-type="accent" data-val="' + U.esc(i.payload) + '">' + U.esc(i.payload) + "</button>"; }).join("") +
          "</div></div>" +
          (flairsOwned.length || accentsOwned.length ? "" : '<p class="admin-inline-note">Nothing owned yet — grab something from the shop below.</p>') +
        "</div>" +
        // Shop
        '<div class="section-label">The club shop</div>' +
        '<div class="shop-grid">' + items.map(function (it) {
          var own = owned.indexOf(it.sku) !== -1;
          return '<div class="shop-item panel"><div class="shop-item-top"><span class="shop-item-pay">' +
            (it.kind === "accent" ? '<span class="shop-accent name-accent-' + U.esc(it.payload) + '">Aa</span>' : U.esc(it.payload)) + "</span>" +
            '<span class="shop-item-cost">' + it.cost + " pts</span></div>" +
            '<div class="shop-item-name">' + U.esc(it.name) + "</div>" +
            '<p class="shop-item-desc">' + U.esc(it.description || "") + "</p>" +
            (own ? '<span class="shop-owned">✓ Owned</span>'
                 : '<button class="btn btn-gold btn-small shop-buy" data-sku="' + U.esc(it.sku) + '" data-cost="' + it.cost + '"' + (bal < it.cost ? " disabled" : "") + ">Buy</button>") +
          "</div>";
        }).join("") + "</div>";

      // equip cosmetics
      U.$$(".cos-chip", box).forEach(function (btn) {
        if (!btn.getAttribute("data-type")) return;
        btn.addEventListener("click", function () {
          var body = {}; body[btn.getAttribute("data-type")] = btn.getAttribute("data-val");
          NET.saveMeProfile(body).then(function (rr) {
            if (rr && rr.ok) { U.toast("Look updated."); PAGES.profile.enter(profile.username); }
            else U.toast("✗ couldn't equip");
          });
        });
      });
      // buy
      U.$$(".shop-buy", box).forEach(function (btn) {
        btn.addEventListener("click", function () {
          btn.disabled = true;
          NET.shopBuy(btn.getAttribute("data-sku")).then(function (rr) {
            if (rr && rr.ok) { U.toast("Bought! Equip it above."); PAGES.profile.enter(profile.username); }
            else { btn.disabled = false; U.toast(rr && rr.error === "insufficient" ? "Not enough points yet." : "✗ purchase failed"); }
          });
        });
      });
    });
  }

  /* Owner-only Security: change password + optional authenticator 2FA. */
  function renderSecurityPanel(box) {
    if (!box) return;
    NET.twoFAStatus().then(function (st) {
      var on = st && st.enabled;
      box.innerHTML =
        '<div class="section-label">Security</div>' +
        '<div class="panel">' +
          '<div class="sec-sub">Change password</div>' +
          '<input type="password" id="sec-cur" class="fun-input" placeholder="Current password" autocomplete="current-password">' +
          '<input type="password" id="sec-new" class="fun-input" placeholder="New password (6+ chars)" autocomplete="new-password">' +
          '<div class="admin-actions"><button class="btn btn-gold btn-small" id="sec-pw-save">Update password</button></div>' +
        "</div>" +
        '<div class="panel">' +
          '<div class="sec-sub">Two-factor authentication ' + (on ? '<span class="pill pill-win">on</span>' : '<span class="pill">off</span>') + "</div>" +
          '<p class="admin-inline-note">Optional. Protect your account with an authenticator app (Microsoft Authenticator, Google Authenticator, etc.).</p>' +
          '<div id="sec-2fa"></div>' +
        "</div>";
      U.$("#sec-pw-save", box).addEventListener("click", function () {
        var cur = U.$("#sec-cur", box).value, next = U.$("#sec-new", box).value;
        if (next.length < 6) { U.toast("New password needs 6+ characters."); return; }
        NET.changePassword(cur, next).then(function (r) {
          if (r && r.ok) { U.toast("Password updated."); U.$("#sec-cur", box).value = ""; U.$("#sec-new", box).value = ""; }
          else U.toast(r && r.code === "bad_current" ? "Current password is wrong." : "✗ couldn't update");
        });
      });
      var twoBox = U.$("#sec-2fa", box);
      function renderOff() {
        twoBox.innerHTML = '<div class="admin-actions"><button class="btn btn-primary btn-small" id="sec-2fa-start">Set up 2FA</button></div>';
        U.$("#sec-2fa-start", twoBox).addEventListener("click", function () {
          NET.twoFASetup().then(function (r) {
            if (!r || !r.ok) { U.toast("✗ couldn't start"); return; }
            twoBox.innerHTML =
              '<p class="admin-inline-note">In your authenticator app, add an account and enter this key (or use the link on this device):</p>' +
              '<div class="sec-secret">' + U.esc(r.secret.replace(/(.{4})/g, "$1 ").trim()) + "</div>" +
              '<div class="admin-actions"><a class="btn btn-ghost btn-small" href="' + U.esc(r.otpauth) + '">Open in an app</a></div>' +
              '<input type="text" id="sec-2fa-code" class="fun-input" inputmode="numeric" maxlength="6" placeholder="6-digit code to confirm">' +
              '<div class="admin-actions"><button class="btn btn-gold btn-small" id="sec-2fa-confirm">Turn on 2FA</button></div>';
            U.$("#sec-2fa-confirm", twoBox).addEventListener("click", function () {
              NET.twoFAEnable(U.$("#sec-2fa-code", twoBox).value.trim()).then(function (rr) {
                if (rr && rr.ok) { U.toast("Two-factor is on."); if (NET.me) NET.me.twoFactor = true; renderOn(); }
                else U.toast("That code didn't match.");
              });
            });
          });
        });
      }
      function renderOn() {
        twoBox.innerHTML = '<p class="admin-inline-note">Two-factor is active. You\'ll enter a code from your app when you sign in.</p>' +
          '<input type="text" id="sec-2fa-off-code" class="fun-input" inputmode="numeric" maxlength="6" placeholder="Code to turn it off">' +
          '<div class="admin-actions"><button class="btn btn-ghost btn-small" id="sec-2fa-off">Turn off 2FA</button></div>';
        U.$("#sec-2fa-off", twoBox).addEventListener("click", function () {
          NET.twoFADisable({ code: U.$("#sec-2fa-off-code", twoBox).value.trim() }).then(function (rr) {
            if (rr && rr.ok) { U.toast("Two-factor turned off."); if (NET.me) NET.me.twoFactor = false; renderOff(); }
            else U.toast("Enter a current code to turn it off.");
          });
        });
      }
      if (on) renderOn(); else renderOff();
    });
  }

  /* ========================================================
     STATS / HONOURS / GAFFER / NEWS / SOCIAL / SEARCH / ABOUT
     ======================================================== */
  /* One leaderboard panel: [{player_id, val, n?}] + a value formatter. */
  function lbPanel(title, rows, fmt, unit) {
    if (!rows || !rows.length) return "";
    return '<div class="panel lb-panel"><div class="lb-title">' + U.esc(title) + "</div><ol class=\"lb\">" +
      rows.slice(0, 12).map(function (r) {
        var p = U.playerById(r.player_id);
        var who = p ? '<a href="#player/' + p.id + '">' + U.esc(p.name) + "</a> " + U.controlBadge(p) : U.esc(r.player_id);
        return "<li><span class='lb-name'>" + who + "</span><span class='lb-val'>" + fmt(r) +
          (unit ? "<span class='lb-unit'>" + unit + "</span>" : "") + "</span></li>";
      }).join("") + "</ol></div>";
  }

  PAGES.stats = {
    enter: function () {
      var clubBox = U.$("#stats-club"), lbBox = U.$("#stats-leaders"), oppBox = U.$("#stats-opposition");
      clubBox.innerHTML = U.emptyState("Counting…", "", "⏱"); lbBox.innerHTML = ""; oppBox.innerHTML = "";
      Promise.all([NET.stats(), loadSquad()]).then(function (results) {
        var res = results[0];
        var block = liveBlock(res, "the stats centre");
        if (block) { clubBox.innerHTML = block; return; }
        var cr = res.clubRecord || {}, rc = res.recorded || {}, b = res.boards || {}, players = res.players || {}, opp = res.opposition || [];

        /* ---- club tiles: all-time verified + the recorded slice + streaks ---- */
        clubBox.innerHTML =
          '<div class="tile-row">' +
            U.statTile("Played", U.num(cr.played), { accent: "electric" }) +
            U.statTile("Wins", U.num(cr.wins), { accent: "win" }) +
            U.statTile("Draws", U.num(cr.draws), { accent: "draw" }) +
            U.statTile("Losses", U.num(cr.losses), { accent: "loss" }) +
            U.statTile("Goals for", U.num(cr.goalsFor), { accent: "gold" }) +
            U.statTile("Goals against", U.num(cr.goalsAgainst)) +
            U.statTile("Win %", U.winPct(cr.wins, (Number(cr.wins) || 0) + (Number(cr.draws) || 0) + (Number(cr.losses) || 0)), { suffix: "%" }) +
            (cr.badge ? U.statTile("Badge", cr.badge, { accent: "gold" }) : "") +
          "</div>" +
          '<div class="section-label">The recorded games · ' + U.num(rc.count) + " on file</div>" +
          '<div class="tile-row">' +
            U.statTile("Record", (rc.wins || 0) + " – " + (rc.draws || 0) + " – " + (rc.losses || 0)) +
            U.statTile("Scored", U.num(rc.goalsFor), { accent: "gold" }) +
            U.statTile("Conceded", U.num(rc.goalsAgainst)) +
            U.statTile("Longest win run", U.num(rc.winStreak), { accent: "win" }) +
            U.statTile("Longest unbeaten", U.num(rc.unbeaten), { accent: "electric" }) +
          "</div>";
        U.runCountUps(clubBox);

        /* ---- leaderboards ---- */
        var f0 = function (r) { return r.val; };
        var contribHtml = (b.contributors && b.contributors.length)
          ? '<div class="section-label">Biggest contributors · goals + assists per game</div>' +
            '<div class="panel lb-panel"><ol class="lb lb-contrib">' +
            b.contributors.slice(0, 12).map(function (r) {
              var p = U.playerById(r.player_id);
              var who = p ? '<a href="#player/' + p.id + '">' + U.esc(p.name) + "</a> " + U.controlBadge(p) : U.esc(r.player_id);
              return "<li><span class='lb-name'>" + who +
                "<span class='lb-sub'>" + r.g + "G + " + r.a + "A across " + r.games + " games</span></span>" +
                "<span class='lb-val'>" + r.per.toFixed(2) + "<span class='lb-unit'>/game</span></span></li>";
            }).join("") + "</ol></div>"
          : "";

        lbBox.innerHTML =
          contribHtml +
          '<div class="lb-grid">' +
            lbPanel("Golden Boot · recorded games", b.goldenBoot, f0) +
            lbPanel("Career goals · all-time", b.careerGoals, f0) +
            lbPanel("Assists · recorded games", b.assists, f0) +
            lbPanel("Career assists · all-time", b.careerAssists, f0) +
            lbPanel("Average rating · recorded", b.rating, function (r) { return Number(r.val).toFixed(2); }) +
            lbPanel("Man of the Match", b.motm, f0) +
            lbPanel("Hat-tricks", b.hatTricks, f0) +
            lbPanel("Discipline · red cards", b.reds, f0) +
          "</div>";

        /* ---- career table for the humans ---- */
        // Every player carrying the "human" tag belongs here — Amy included —
        // whether or not they've got a verified baseline or recorded stats yet.
        var humanRows = (window.SQUAD || []).filter(function (p) { return p.isHuman; })
          .map(function (p) { return { id: p.id, d: players[p.id] || {} }; })
          .sort(function (a, b2) { return (b2.d.careerGoals || 0) - (a.d.careerGoals || 0); });
        var careerHtml = humanRows.length
          ? '<div class="section-label">Career records · the humans</div>' +
            '<div class="panel"><div class="table-scroll"><table class="opp-table opp-table-wide career-table">' +
            '<thead><tr><th>Player</th><th>Games</th><th>G</th><th>A</th><th>Avg R</th><th>Pass %</th><th>Tkl</th><th>Win %</th></tr></thead><tbody>' +
            humanRows.map(function (r) {
              var p = U.playerById(r.id), d = r.d;
              var nm = p ? '<a href="#player/' + p.id + '">' + U.esc(p.name) + "</a>" : U.esc(r.id);
              return "<tr><td>" + nm + "</td><td>" + (d.careerGames || 0) + "</td><td>" + (d.careerGoals || 0) + "</td><td>" + (d.careerAssists || 0) + "</td><td>" +
                (d.careerAvg != null ? Number(d.careerAvg).toFixed(1) : "—") + "</td><td>" + (d.passPct != null ? d.passPct + "%" : "—") + "</td><td>" +
                (d.recTackles || 0) + "</td><td>" + (d.careerWinPct != null ? d.careerWinPct + "%" : "—") + "</td></tr>";
            }).join("") + "</tbody></table></div></div>"
          : "";

        /* ---- opposition head-to-head ---- */
        oppBox.innerHTML =
          careerHtml +
          '<div class="section-label">Opposition · head to head</div>' +
          '<div class="panel"><div class="table-scroll"><table class="opp-table opp-table-wide">' +
          '<thead><tr><th>Opponent</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th></tr></thead><tbody>' +
          opp.map(function (o) {
            return '<tr><td><a href="#opponent/' + encodeURIComponent(o.name) + '">' + U.esc(o.name) + "</a></td><td>" +
              o.p + "</td><td>" + o.w + "</td><td>" + o.d + "</td><td>" + o.l + "</td><td>" + o.gf + "</td><td>" + o.ga + "</td></tr>";
          }).join("") + "</tbody></table></div></div>";
      });
    }
  };

  PAGES.honours = {
    enter: function () {
      var cabinet = U.$("#honours-cabinet"), timeline = U.$("#honours-timeline");
      cabinet.innerHTML = U.emptyState("Opening the cabinet…", "", "🏆"); timeline.innerHTML = "";
      Promise.all([NET.stats(), NET.seasons()]).then(function (results) {
        var st = results[0], seasonsRes = results[1];
        var block = liveBlock(st, "the trophy cabinet");
        if (block) { cabinet.innerHTML = block; }
        else {
          var x = st.extremes || {};
          cabinet.innerHTML = '<div class="tile-row">' +
            (x.bestWin ? U.statTile("Biggest win", x.bestWin.our + "–" + x.bestWin.their, { accent: "win", sub: "vs " + x.bestWin.opp }) : "") +
            (x.worstLoss ? U.statTile("Heaviest defeat", x.worstLoss.our + "–" + x.worstLoss.their, { accent: "loss", sub: "vs " + x.worstLoss.opp + " · character building" }) : "") +
            U.statTile("Clean sheets", U.num(x.cleanSheets), { accent: "electric", sub: "recorded games" }) +
            U.statTile("Hat-tricks", U.num(x.hatTricks), { accent: "gold", sub: "and counting" }) +
            (x.goalFests ? U.statTile("9+ goal thrillers", U.num(x.goalFests), { sub: "defending optional" }) : "") +
          "</div>";
          U.runCountUps(cabinet);
        }
        var seasons = (seasonsRes && seasonsRes.seasons) || [];
        var items = [{ dateLabel: "2024", title: "Club founded", sub: "Fifteen names on a sheet, one badge, zero doubts. Est. 2024.", tone: "note" }];
        seasons.slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); }).forEach(function (s) {
          items.push({ dateLabel: U.esc(s.label), title: s.label + (s.id === seasonsRes.currentSeason ? " · current" : (s.archived ? " · archived" : "")),
            sub: "", tone: s.id === seasonsRes.currentSeason ? "up" : "" });
        });
        timeline.innerHTML = '<div class="section-label">The story so far</div>' +
          '<div class="timeline">' + items.map(function (it) {
            return '<div class="timeline-item' + (it.tone ? " timeline-" + it.tone : "") + '">' +
              '<span class="timeline-dot"></span>' +
              '<span class="timeline-date">' + U.esc(it.dateLabel) + "</span>" +
              '<span class="timeline-title">' + U.esc(it.title) + "</span>" +
              (it.sub ? '<span class="timeline-sub">' + U.esc(it.sub) + "</span>" : "") +
            "</div>";
          }).join("") + "</div>";
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

  // Normalise a stored YouTube value (handle, channel URL, or video URL) into
  // a link + a friendly label + an optional embeddable video id.
  function youtubeInfo(raw) {
    var v = String(raw || "").trim();
    if (!v) return null;
    var vid = "";
    var mv = v.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_\-]{6,})/);
    if (mv) vid = mv[1];
    var url, label;
    if (/^https?:\/\//i.test(v)) { url = v; label = v.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""); }
    else if (v.charAt(0) === "@") { url = "https://www.youtube.com/" + v; label = v; }
    else { url = "https://www.youtube.com/@" + v; label = "@" + v; }
    return { url: url, label: label, videoId: vid };
  }

  PAGES.social = {
    enter: function () {
      var mt = U.$("#social-view");
      if (!mt) return;
      mt.innerHTML = U.emptyState("Loading the socials…", "", "📱");
      NET.socials().then(function (res) {
        var s = (res && res.socials) || {};
        var handle = s.tiktok || "danwhizzy";
        var twitch = s.twitch || "40yrvirgil";
        var yt = youtubeInfo(s.youtube);
        var parent = location.hostname || "40yrvirgil.co.uk";
        var twitchSrc = "https://player.twitch.tv/?channel=" + encodeURIComponent(twitch) +
          "&parent=" + encodeURIComponent(parent) + "&muted=true&autoplay=true";

        mt.innerHTML =
          '<div class="section-label">@' + U.esc(handle) + " on TikTok</div>" +
          '<div class="social-embed">' +
            '<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@' + U.esc(handle) + '" data-unique-id="' + U.esc(handle) + '" data-embed-type="creator" style="max-width:780px;min-width:288px;">' +
              '<section class="tiktok-card">' +
                '<span class="tiktok-card-avatar">' + U.esc(handle.charAt(0).toUpperCase()) + "</span>" +
                '<span class="tiktok-card-handle">@' + U.esc(handle) + "</span>" +
                '<span class="tiktok-card-sub">The 40Yr Virgil on TikTok</span>' +
                '<a class="btn btn-primary btn-small" target="_blank" rel="noopener" href="https://www.tiktok.com/@' + U.esc(handle) + '?refer=creator_embed">Open profile →</a>' +
              "</section>" +
            "</blockquote>" +
          "</div>" +
          (yt ?
            '<div class="section-label">The 40Yr Virgil on YouTube</div>' +
            (yt.videoId ?
              '<div class="twitch-embed-wrap"><iframe class="twitch-player" src="https://www.youtube.com/embed/' + U.esc(yt.videoId) + '" title="YouTube" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen frameborder="0"></iframe></div>' : "") +
            '<div class="twitch-card twitch-card-slim social-yt">' +
              '<span class="twitch-card-handle">▶ ' + U.esc(yt.label) + "</span>" +
              '<span class="twitch-card-sub">New from the sofa studio.</span>' +
              '<a class="btn btn-primary btn-small" target="_blank" rel="noopener" href="' + U.esc(yt.url) + '">Open on YouTube →</a>' +
            "</div>" : "") +
          '<div class="section-label">' + U.esc(twitch) + " on Twitch</div>" +
          '<div class="twitch-embed-wrap">' +
            '<iframe class="twitch-player" src="' + twitchSrc + '" title="' + U.esc(twitch) + ' on Twitch" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen scrolling="no" frameborder="0"></iframe>' +
          "</div>" +
          '<div class="twitch-card twitch-card-slim">' +
            '<span class="twitch-card-handle">' + U.esc(twitch) + "</span>" +
            '<span class="twitch-card-sub">Live from the Betfred Arena (the sofa).</span>' +
            '<a class="btn btn-primary btn-small" target="_blank" rel="noopener" href="https://www.twitch.tv/' + U.esc(twitch) + '">Open on Twitch →</a>' +
          "</div>";

        // (Re)load TikTok's creator-embed widget so the blockquote hydrates.
        var old = document.getElementById("tiktok-embed-script");
        if (old) old.parentNode.removeChild(old);
        var sc = document.createElement("script");
        sc.id = "tiktok-embed-script";
        sc.async = true;
        sc.src = "https://www.tiktok.com/embed.js";
        document.body.appendChild(sc);
      });
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
  PAGES.tickets = {
    enter: function () {
      var mt = U.$("#tickets-view");
      mt.innerHTML = U.emptyState("Opening the box office…", "", "🎟️");
      if (!NET.me) {
        mt.innerHTML = '<div class="ch-card">' + U.emptyState("Sign in for tickets", "Claim a matchday ticket with your Virgil Points — earn them by getting stuck in around the club.", "🎟️") + "</div>";
        return;
      }
      Promise.all([NET.fixtures(), NET.tickets(), NET.mePoints()]).then(function (r) {
        var fx = (r[0] && r[0].fixtures) || [], mine = (r[1] && r[1].tickets) || [], cost = (r[1] && r[1].cost) || 25, bal = U.num(r[2] && r[2].balance) || 0;
        var haveFor = {}; mine.forEach(function (t) { haveFor[t.fixture_id] = 1; });
        mt.innerHTML =
          '<div class="panel wallet-panel wallet-slim"><span class="wallet-ic">🪙</span><span class="wallet-bal">' + bal + '</span><span class="wallet-lab">Virgil Points</span></div>' +
          '<div class="section-label">Get your ticket · ' + cost + ' pts each</div>' +
          (fx.length ? fx.map(function (f) {
            var isMatch = f.kind !== "session", when = f.date_iso ? U.fmtDate(f.date_iso) : "Date TBC";
            var got = haveFor[f.id];
            return '<div class="ticket-row panel"><div class="ticket-info"><span class="fixture-badge">' + (isMatch ? U.esc(STAGE_LABEL[f.stage] || "Match") : "Session") + "</span>" +
              '<span class="ticket-opp">' + (isMatch && f.opponent ? "vs " + U.esc(f.opponent) : "Club session") + "</span>" +
              '<span class="ticket-when">' + when + "</span></div>" +
              (got ? '<span class="ticket-have">🎟️ Claimed</span>'
                   : '<button class="btn btn-gold btn-small ticket-claim" data-fid="' + U.esc(f.id) + '"' + (bal < cost ? " disabled" : "") + ">Claim (" + cost + ")</button>") +
            "</div>";
          }).join("") : U.emptyState("No fixtures on sale", "When a game or session is booked, tickets open up here.", "🎟️")) +
          (mine.length ? '<div class="section-label">Your tickets</div>' + mine.map(function (t) {
            return '<div class="ticket-stub"><span class="ticket-stub-ic">🎟️</span><span class="ticket-stub-main"><strong>' +
              (t.opponent ? "vs " + U.esc(t.opponent) : "Club session") + "</strong><span class=\"ticket-stub-when\">" + (t.date_iso ? U.fmtDate(t.date_iso) : "") + "</span></span>" +
              '<span class="ticket-stub-tag">ADMIT ONE</span></div>';
          }).join("") : "");
        U.$$(".ticket-claim", mt).forEach(function (btn) {
          btn.addEventListener("click", function () {
            btn.disabled = true;
            NET.ticketClaim(btn.getAttribute("data-fid")).then(function (rr) {
              if (rr && rr.ok) { U.toast("Ticket claimed. See you there."); PAGES.tickets.enter(); }
              else { btn.disabled = false; U.toast(rr && rr.error === "insufficient" ? "Not enough points yet." : "✗ couldn't claim"); }
            });
          });
        });
      });
    }
  };
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
        function fillTpl(t, p, opp) { return String(t).replace(/\{full\}/g, p ? p.name : "—").replace(/\{name\}/g, p ? firstName(p) : "—").replace(/\{opp\}/g, opp || ""); }

        // Each feature is its own thing with its own interaction — a full-page
        // wheel and a scripture, an ask-and-answer oracle, a copyable chant, an
        // awards ceremony, a running rumour feed, a hero pick — not six
        // identical spin buttons.
        mt.innerHTML =
          '<div class="fun-features">' +
            '<a class="fun-feature" href="#gaffer"><span class="fun-feature-ic">🎩</span><span class="fun-feature-t">The Gaffer Wheel</span><span class="fun-feature-s">Spin up a manager on the full stage — animation, quote and all.</span><span class="fun-feature-go">Open the dugout →</span></a>' +
            '<a class="fun-feature" href="#book"><span class="fun-feature-ic">📖</span><span class="fun-feature-t">The Book of Tüpci</span><span class="fun-feature-s">Ten commandments, the prayers, the scripture of the system.</span><span class="fun-feature-go">Read the scripture →</span></a>' +
            '<a class="fun-feature" href="#floor"><span class="fun-feature-ic">🕹️</span><span class="fun-feature-t">The Clubhouse Floor</span><span class="fun-feature-s">Walk an avatar round a shared room — see who else is about.</span><span class="fun-feature-go">Step inside →</span></a>' +
          "</div>" +
          '<div class="fun-grid">' +
            // Oracle — you ASK it something
            '<div class="fun-card panel fun-oracle-card"><div class="fun-card-head"><span class="fun-icon">🔮</span><span class="fun-title">The Oracle</span></div>' +
              '<p class="fun-blurb">Type a question. It answers in the club’s voice — which is to say, unreliably.</p>' +
              '<input type="text" id="fun-oracle-q" class="fun-input" maxlength="90" placeholder="Will we win on Saturday?">' +
              '<div class="fun-out" id="fun-out-oracle"></div>' +
              '<div class="fun-actions"><button class="btn btn-gold btn-small" id="fun-btn-oracle">Consult the Oracle</button></div></div>' +
            // Chant — you COPY it
            '<div class="fun-card panel"><div class="fun-card-head"><span class="fun-icon">📣</span><span class="fun-title">Chant Machine</span></div>' +
              '<p class="fun-blurb">Terrace poetry on demand. Best sung badly, at volume.</p>' +
              '<div class="fun-out" id="fun-out-chant"></div>' +
              '<div class="fun-actions"><button class="btn btn-gold btn-small" id="fun-btn-chant">Give us a song</button><button class="btn btn-ghost btn-small" id="fun-copy-chant" hidden>Copy</button></div></div>' +
            // Superlatives — a whole CEREMONY at once
            '<div class="fun-card panel"><div class="fun-card-head"><span class="fun-icon">🏅</span><span class="fun-title">The Awards Ceremony</span></div>' +
              '<p class="fun-blurb">Roll the red carpet — the club’s least official honours, all handed out at once.</p>' +
              '<div class="fun-out" id="fun-out-super"></div>' +
              '<div class="fun-actions"><button class="btn btn-gold btn-small" id="fun-btn-super">Hold the ceremony</button></div></div>' +
            // Rumour mill — an accumulating FEED
            '<div class="fun-card panel"><div class="fun-card-head"><span class="fun-icon">📰</span><span class="fun-title">Rumour Mill</span></div>' +
              '<p class="fun-blurb">Definitely-real gossip from sources close to the sofa. Keeps rolling.</p>' +
              '<div class="fun-feed" id="fun-out-rumour"></div>' +
              '<div class="fun-actions"><button class="btn btn-gold btn-small" id="fun-btn-rumour">Start a rumour</button></div></div>' +
            // Player of the matchday — a hero CARD
            '<div class="fun-card panel"><div class="fun-card-head"><span class="fun-icon">⭐</span><span class="fun-title">Player of the Matchday</span></div>' +
              '<p class="fun-blurb">The wheel appoints a hero. No stats were consulted.</p>' +
              '<div class="fun-out" id="fun-out-motm"></div>' +
              '<div class="fun-actions"><button class="btn btn-gold btn-small" id="fun-btn-motm">Name the hero</button></div></div>' +
          "</div>";

        function out(id) { return U.$("#fun-out-" + id, mt); }
        function fill(id, html) { var o = out(id); if (o) { o.innerHTML = html; o.classList.add("fun-out-shown"); } }

        // Oracle: echoes your question, then answers.
        U.$("#fun-btn-oracle", mt).addEventListener("click", function () {
          var q = (U.$("#fun-oracle-q", mt) || {}).value || "";
          fill("oracle", (q ? '<p class="fun-oracle-q">“' + U.esc(q.trim()) + '”</p>' : "") + '<p class="fun-oracle-a">🔮 ' + U.esc(randOf(fun.oracle)) + "</p>");
        });
        // Chant: generate + reveal copy button.
        var lastChant = "";
        U.$("#fun-btn-chant", mt).addEventListener("click", function () {
          if (!squad.length) return fill("chant", "Sign someone first.");
          lastChant = fillTpl(randOf(fun.chants), randOf(squad));
          fill("chant", '<p class="fun-chant">“' + U.esc(lastChant) + '”</p>');
          U.$("#fun-copy-chant", mt).hidden = false;
        });
        U.$("#fun-copy-chant", mt).addEventListener("click", function () {
          if (!lastChant) return;
          try { navigator.clipboard.writeText(lastChant).then(function () { U.toast("Copied. Go on, share it."); }, function () { U.toast("Couldn’t copy."); }); }
          catch (e) { U.toast("Couldn’t copy."); }
        });
        // Awards: hand out five at once, ceremony style.
        U.$("#fun-btn-super", mt).addEventListener("click", function () {
          var awards = shuffle(fun.superlatives).slice(0, 5), people = shuffle(squad);
          fill("super", '<ul class="fun-awards">' + awards.map(function (a, i) {
            var who = people[i % people.length];
            return '<li><span class="fun-award-title">🏅 ' + U.esc(a) + '</span><span class="fun-award-name">' + U.esc(who ? who.name : "—") + "</span></li>";
          }).join("") + "</ul>");
        });
        // Rumour: prepend to a running feed with a mock reliability %.
        U.$("#fun-btn-rumour", mt).addEventListener("click", function () {
          if (!squad.length) return;
          var txt = fillTpl(randOf(fun.rumours), randOf(squad), randOf(fun.rumourClubs));
          var rel = 40 + Math.floor(Math.random() * 60);
          var feed = out("rumour");
          var item = document.createElement("div");
          item.className = "fun-rumour-item";
          item.innerHTML = '<span class="fun-rumour-rel">' + rel + '% reliable</span><span class="fun-rumour-txt">' + U.esc(txt) + "</span>";
          feed.insertBefore(item, feed.firstChild);
          feed.classList.add("fun-out-shown");
        });
        // Player of the matchday: a little hero card.
        var heroLines = ["carried the whole side and refused to make it weird.", "was everywhere. The router could not cope.",
          "did something the algorithm will study for years.", "gets the nod. The screenshot is already framed.",
          "ran the game from a position nobody asked them to play."];
        U.$("#fun-btn-motm", mt).addEventListener("click", function () {
          var who = randOf(squad);
          fill("motm", who ? '<div class="fun-hero"><span class="fun-hero-num">#' + who.number + '</span><strong>' + U.esc(who.name) + "</strong><span class=\"fun-hero-line\">" + U.esc(randOf(heroLines)) + "</span></div>" : "");
        });
      });
    }
  };

  /* ========================================================
     THE CLUBHOUSE FLOOR — a shared avatar room (Habbo-lite).
     Walk a token round a grid, see who else is on the floor,
     throw an emote. Presence synced through the Worker by
     short polling — no realtime infra needed at club scale.
     ======================================================== */
  var FLOOR_GRID = 13, floorTimer = null, floorState = { x: 6, y: 6, occ: [], emote: "" };
  var FLOOR_EMOTES = ["👋", "🎉", "⚽", "😂", "🔥", "💜"];
  function floorAvatar(o, meX, meY) {
    var glyph = o.flair || (o.display ? o.display.charAt(0).toUpperCase() : "?");
    var x = o.me ? meX : o.x, y = o.me ? meY : o.y;
    var accent = o.accent ? " floor-accent-" + o.accent : "";
    return '<div class="floor-avatar' + (o.me ? " floor-me" : "") + accent + '" style="left:' + ((x + 0.5) / FLOOR_GRID * 100) + "%;top:" + ((y + 0.5) / FLOOR_GRID * 100) + '%">' +
      (o.emote ? '<span class="floor-emote">' + U.esc(o.emote) + "</span>" : "") +
      '<span class="floor-token">' + U.esc(glyph) + "</span>" +
      '<span class="floor-name">' + U.esc(o.display || "") + "</span></div>";
  }
  function paintFloor(mt) {
    var occ = floorState.occ.slice();
    if (!occ.some(function (o) { return o.me; }) && NET.me) occ.push({ me: true, x: floorState.x, y: floorState.y, display: NET.me.name, emote: floorState.emote });
    var avatars = occ.map(function (o) { return floorAvatar(o, floorState.x, floorState.y); }).join("");
    var floorEl = U.$("#floor-grid", mt);
    if (floorEl) floorEl.innerHTML = avatars;
    var count = U.$("#floor-count", mt);
    if (count) count.textContent = occ.length + (occ.length === 1 ? " on the floor" : " on the floor");
  }
  function pushMove(mt) {
    if (!NET.me) return;
    NET.roomMove(floorState.x, floorState.y, floorState.emote || "").then(function () {});
    paintFloor(mt);
  }
  function pollFloor(mt) {
    NET.room().then(function (res) {
      if (!res || !res.ok) return;
      floorState.occ = res.occupants || [];
      paintFloor(mt);
    });
  }
  PAGES.floor = {
    enter: function () {
      var mt = U.$("#floor-view");
      if (!mt) return;
      if (!NET.me) { mt.innerHTML = '<div class="ch-card">' + U.emptyState("Members only", "Sign in to step onto the Clubhouse Floor.", "🚪") + "</div>"; return; }
      floorState.emote = "";
      mt.innerHTML =
        '<p class="floor-hint"><span id="floor-count">…</span> · tap a tile to walk, or use the arrow keys</p>' +
        '<div class="floor" id="floor"><div class="floor-grid" id="floor-grid"></div></div>' +
        '<div class="floor-emotes">' + FLOOR_EMOTES.map(function (e) { return '<button class="floor-emote-btn" data-e="' + e + '">' + e + "</button>"; }).join("") + "</div>";
      var floor = U.$("#floor", mt);
      floor.addEventListener("click", function (ev) {
        var r = floor.getBoundingClientRect();
        floorState.x = Math.max(0, Math.min(FLOOR_GRID - 1, Math.floor((ev.clientX - r.left) / r.width * FLOOR_GRID)));
        floorState.y = Math.max(0, Math.min(FLOOR_GRID - 1, Math.floor((ev.clientY - r.top) / r.height * FLOOR_GRID)));
        floorState.emote = ""; pushMove(mt);
      });
      U.$$(".floor-emote-btn", mt).forEach(function (b) {
        b.addEventListener("click", function (ev) { ev.stopPropagation(); floorState.emote = b.getAttribute("data-e"); pushMove(mt);
          setTimeout(function () { if (floorState.emote === b.getAttribute("data-e")) { floorState.emote = ""; pushMove(mt); } }, 4000); });
      });
      this._keys = function (e) {
        var k = e.key, moved = true;
        if (k === "ArrowUp") floorState.y = Math.max(0, floorState.y - 1);
        else if (k === "ArrowDown") floorState.y = Math.min(FLOOR_GRID - 1, floorState.y + 1);
        else if (k === "ArrowLeft") floorState.x = Math.max(0, floorState.x - 1);
        else if (k === "ArrowRight") floorState.x = Math.min(FLOOR_GRID - 1, floorState.x + 1);
        else moved = false;
        if (moved) { e.preventDefault(); floorState.emote = ""; pushMove(mt); }
      };
      window.addEventListener("keydown", this._keys);
      pushMove(mt);       // register presence at my tile
      pollFloor(mt);
      clearInterval(floorTimer);
      floorTimer = setInterval(function () { pollFloor(mt); }, 2500);
    },
    leave: function () {
      clearInterval(floorTimer); floorTimer = null;
      if (this._keys) { window.removeEventListener("keydown", this._keys); this._keys = null; }
      if (NET.me) NET.roomLeave();
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
    bindSkipLink();
    renderAccount();
    window.addEventListener("hashchange", route);
    route();

    if (NET.hasBackend()) {
      NET.session().then(function () {
        sessionChecked = true;
        renderAccount();
        var page = parseHash().name;
        if (["admin", "inbox", "conversation", "clubhouse", "tickets", "profile", "matchday", "floor"].indexOf(page) !== -1) route();
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
