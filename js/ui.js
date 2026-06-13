/* ============================================================
   The 40Yr Virgil — shared UI helpers
   Cards, pills, tiles, badges, empty states, count-ups, and the
   squad ↔ EA-persona matcher. Pure render logic; no fetching.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- tiny DOM kit ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ---------- formatting ---------- */
  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function pick(obj /*, keys... */) {
    if (!obj) return null;
    for (var i = 1; i < arguments.length; i++) {
      var k = arguments[i];
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
    }
    return null;
  }

  function divisionLabel(d) {
    var n = num(d);
    return n == null ? null : "Division " + n;
  }

  function winPct(wins, games) {
    var w = num(wins), g = num(games);
    if (w == null || !g) return null;
    return Math.round((w / g) * 100);
  }

  /* ---------- squad lookups ---------- */
  function playerById(id) {
    for (var i = 0; i < window.SQUAD.length; i++) if (window.SQUAD[i].id === id) return window.SQUAD[i];
    return null;
  }

  var GROUPS = { GK: "GK", RB: "DEF", LB: "DEF", CB: "DEF", CM: "MID", CDM: "MID", CAM: "MID", RM: "MID", LM: "MID", ST: "ATT", "Sub ST": "ATT", RW: "ATT", LW: "ATT", LST: "ATT", RST: "ATT" };
  function posGroup(p) { return GROUPS[p.position] || "MID"; }

  function surname(p) {
    var bits = p.name.trim().split(/\s+/);
    return bits[bits.length - 1];
  }

  /* ---------- EA persona ↔ squad matcher ---------- */
  function normName(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  /* Find the saved EA member record for a squad player.
     Priority: explicit eaPersona → exact normalised match →
     containment either way (min 4 chars to avoid noise). */
  function findMemberFor(player, members) {
    if (!members || !members.length) return null;
    var want = normName(player.eaPersona) || null;
    var pid = normName(player.id);
    var pname = normName(player.name);
    var i, m, mn;

    if (want) {
      for (i = 0; i < members.length; i++) {
        if (normName(members[i].persona) === want) return members[i];
      }
    }
    for (i = 0; i < members.length; i++) {
      mn = normName(members[i].persona);
      if (mn && (mn === pid || mn === pname)) return members[i];
    }
    for (i = 0; i < members.length; i++) {
      m = members[i]; mn = normName(m.persona);
      if (mn.length >= 4 && (mn.indexOf(pid) !== -1 || pid.indexOf(mn) !== -1 ||
          mn.indexOf(pname) !== -1 || pname.indexOf(mn) !== -1)) return m;
    }
    return null;
  }

  /* Which squad player does an EA persona belong to (for leaderboards)? */
  function squadFor(persona) {
    for (var i = 0; i < window.SQUAD.length; i++) {
      var hit = findMemberFor(window.SQUAD[i], [{ persona: persona }]);
      if (hit) return window.SQUAD[i];
    }
    return null;
  }

  /* ---------- badges & pills ---------- */
  function controlBadge(p) {
    return p.controlledBy === "human"
      ? '<span class="badge badge-human" title="Human-controlled">HUMAN</span>'
      : '<span class="badge badge-ai" title="AI-controlled">AI</span>';
  }

  function captainBadge(p) {
    return p.isCaptain ? '<span class="badge badge-captain" title="Club captain">C</span>' : "";
  }

  function chips(p) {
    var out = controlBadge(p) + captainBadge(p);
    if (p.goldenBoot) out += '<span class="badge badge-gold" title="Top scorer — tally is live">GOLDEN BOOT</span>';
    if (p.permaBench) out += '<span class="badge badge-bench" title="Perma-bench">SUB</span>';
    return out;
  }

  function pill(result) {
    var r = String(result || "").toUpperCase().charAt(0);
    if (r === "W") return '<span class="pill pill-win">W</span>';
    if (r === "D") return '<span class="pill pill-draw">D</span>';
    if (r === "L") return '<span class="pill pill-loss">L</span>';
    return '<span class="pill">·</span>';
  }

  /* ---------- components ---------- */
  function cardTile(p) {
    return '<a class="card-tile" href="#player/' + p.id + '" data-id="' + p.id + '">' +
      '<img src="assets/img/' + p.card + '" alt="' + esc(p.name) + ' — #' + p.number + ' — ' + esc(p.position) + ' player card" loading="lazy" decoding="async">' +
      '<span class="card-tile-overlay">' +
        '<span class="card-tile-num">#' + p.number + '</span>' +
        '<span class="card-tile-name">' + esc(p.name) + '</span>' +
        '<span class="card-tile-meta"><span class="card-tile-pos">' + esc(p.position) + '</span>' + controlBadge(p) + captainBadge(p) + '</span>' +
      '</span>' +
    '</a>';
  }

  function statTile(label, value, opts) {
    opts = opts || {};
    var v = (value == null || value === "") ? "—" : value;
    var cls = "stat-tile" + (opts.accent ? " stat-tile-" + opts.accent : "");
    var countable = typeof value === "number";
    return '<div class="' + cls + '">' +
      '<span class="stat-tile-value' + (countable ? ' js-countup' : '') + '"' +
        (countable ? ' data-count="' + value + '"' : '') +
        (opts.suffix ? ' data-suffix="' + esc(opts.suffix) + '"' : '') + '>' +
        (countable ? "0" : esc(String(v))) + (countable && opts.suffix ? esc(opts.suffix) : "") +
      '</span>' +
      '<span class="stat-tile-label">' + esc(label) + '</span>' +
      (opts.sub ? '<span class="stat-tile-sub">' + esc(opts.sub) + '</span>' : "") +
    '</div>';
  }

  /* Animate every .js-countup inside `root` once. */
  function runCountUps(root) {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    $$(".js-countup", root).forEach(function (n) {
      var target = Number(n.getAttribute("data-count")) || 0;
      var suffix = n.getAttribute("data-suffix") || "";
      if (reduce || target === 0) { n.textContent = target + suffix; return; }
      var t0 = null, dur = Math.min(1100, 400 + Math.abs(target) * 12);
      function step(t) {
        if (!t0) t0 = t;
        var k = Math.min(1, (t - t0) / dur);
        k = 1 - Math.pow(1 - k, 3); // ease-out cubic
        n.textContent = Math.round(target * k) + suffix;
        if (k < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  function emptyState(title, sub, icon) {
    return '<div class="empty-state">' +
      '<span class="empty-state-icon">' + (icon || "◍") + '</span>' +
      '<span class="empty-state-title">' + esc(title) + '</span>' +
      (sub ? '<span class="empty-state-sub">' + esc(sub) + '</span>' : "") +
    '</div>';
  }

  /* Standard waiting / offline copy for live-data areas. */
  function waitingState(kind) {
    if (!window.NET.hasBackend()) {
      return emptyState(
        "Backend not connected",
        "Deploy backend.gs and set APP_URL in js/config.js — " + (kind || "live data") + " appears after the first sync.",
        "⛓"
      );
    }
    return emptyState(
      "The ledger is warming up",
      "No " + (kind || "data") + " has loaded yet. The backend seeds the full archive on its first request — give it a few seconds and refresh.",
      "⏱"
    );
  }

  function offlineState() {
    return emptyState("Can't reach the clubhouse", "The backend didn't answer. Give it a minute and try again.", "⚠");
  }

  function scorersLine(scorers) {
    if (!scorers || !scorers.length) return "";
    return scorers.map(function (s) {
      return esc(s.name) + (Number(s.goals) > 1 ? " ×" + Number(s.goals) : "");
    }).join(" · ");
  }

  /* ---------- toast ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  window.UI = {
    $: $, $$: $$, el: el, esc: esc,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime,
    num: num, pick: pick, divisionLabel: divisionLabel, winPct: winPct,
    playerById: playerById, posGroup: posGroup, surname: surname,
    normName: normName, findMemberFor: findMemberFor, squadFor: squadFor,
    controlBadge: controlBadge, captainBadge: captainBadge, chips: chips,
    pill: pill, cardTile: cardTile, statTile: statTile, runCountUps: runCountUps,
    emptyState: emptyState, waitingState: waitingState, offlineState: offlineState,
    scorersLine: scorersLine, toast: toast
  };
})();
