/* ============================================================
   The 40Yr Virgil — shared UI helpers
   Cards, pills, tiles, badges, empty states, count-ups. Pure
   render logic; no fetching.
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

  /* Position synonyms → a canonical set, so the board can match a
     player's positions against a formation slot regardless of label. */
  var POS_CANON = {
    DM: "CDM", CDM: "CDM", CF: "ST", ST: "ST", LST: "ST", RST: "ST",
    RWB: "RB", RB: "RB", LWB: "LB", LB: "LB", RCB: "CB", LCB: "CB", CB: "CB",
    GK: "GK", CM: "CM", CAM: "CAM", RM: "RM", LM: "LM", RW: "RW", LW: "LW"
  };
  var CGROUP = { GK: "GK", RB: "DEF", LB: "DEF", CB: "DEF", CDM: "MID", CM: "MID", CAM: "MID", RM: "MID", LM: "MID", RW: "ATT", LW: "ATT", ST: "ATT" };
  function canonPos(p) { p = String(p == null ? "" : p).toUpperCase().replace(/[^A-Z]/g, ""); return POS_CANON[p] || p; }
  function positionsOf(p) {
    if (p && p.positions && p.positions.length) return p.positions;
    return (p && p.position) ? [p.position] : [];
  }
  function posGroup(p) { return GROUPS[positionsOf(p)[0]] || CGROUP[canonPos(positionsOf(p)[0])] || "MID"; }
  /* "exact" (plays that position) | "group" (same area of the pitch) | "no". */
  function posFit(player, slotPos) {
    var slot = canonPos(slotPos);
    var mine = positionsOf(player).map(canonPos);
    if (mine.indexOf(slot) !== -1) return "exact";
    var g = CGROUP[slot];
    for (var i = 0; i < mine.length; i++) { if (CGROUP[mine[i]] === g) return "group"; }
    return "no";
  }

  function surname(p) {
    var bits = p.name.trim().split(/\s+/);
    return bits[bits.length - 1];
  }

  /* ---------- badges & pills ---------- */
  function controlBadge(p) {
    return p.controlledBy === "human"
      ? '<span class="badge badge-human" title="Human-controlled">HUMAN</span>'
      : '<span class="badge badge-ai" title="AI-controlled">AI</span>';
  }

  /* isCaptain is per-match (matches.captain_player_id), not a squad-wide
     flag — pass a truthy value in match-report contexts only. */
  function captainBadge(isCaptain) {
    return isCaptain ? '<span class="badge badge-captain" title="Captain">C</span>' : "";
  }

  function chips(p) {
    var out = controlBadge(p);
    if (p.retiredAI) out += '<span class="badge badge-retired" title="Retired EA-AI original">RETIRED · AI</span>';
    else if (p.permaBench) out += '<span class="badge badge-bench" title="Perma-bench">SUB</span>';
    return out;
  }

  function pill(result) {
    var r = String(result || "").toUpperCase().charAt(0);
    if (r === "W") return '<span class="pill pill-win">W</span>';
    if (r === "D") return '<span class="pill pill-draw">D</span>';
    if (r === "L") return '<span class="pill pill-loss">L</span>';
    return '<span class="pill">·</span>';
  }

  /* Card images are served from the Worker (R2), as an absolute path like
     "/api/media/player-cards/file/...". Resolve against the API's origin;
     no card on file yet → the club crest placeholder (shipped with Pages). */
  /* Shirt numbers that ship with a pre-uploaded squad photo in assets/img/.
     (12 is a .JPG — the server is case-sensitive, so keep the extension exact.) */
  var PHOTO_NUMS = { 1: "jpg", 2: "jpg", 3: "jpg", 4: "jpg", 5: "jpg", 6: "jpg",
    7: "jpg", 8: "jpg", 9: "jpg", 10: "jpg", 12: "JPG", 17: "jpg", 18: "jpg",
    19: "jpg", 27: "jpg", 31: "jpg", 32: "jpg", 43: "jpg", 69: "jpg" };
  function localPhoto(p) {
    var ext = PHOTO_NUMS[Number(p.number)];
    return ext ? "assets/img/" + Number(p.number) + "." + ext : "assets/img/crest.png";
  }
  /* Card image priority: an uploaded R2 card wins; otherwise the pre-uploaded
     squad photo for that shirt number; otherwise the club crest. */
  function cardSrc(p) {
    if (p.card) {
      var origin = String(window.API_URL || "").replace(/\/api\/?$/, "");
      return origin + p.card;
    }
    return localPhoto(p);
  }

  /* ---------- components ---------- */
  function cardTile(p) {
    var pos = (p.positions && p.positions[0]) || "—";
    return '<a class="card-tile" href="#player/' + p.id + '" data-id="' + p.id + '">' +
      '<img src="' + esc(cardSrc(p)) + '" alt="' + esc(p.name) + ' — #' + p.number + ' — ' + esc(pos) + ' player card" loading="lazy" decoding="async">' +
      '<span class="card-tile-overlay">' +
        '<span class="card-tile-num">#' + p.number + '</span>' +
        '<span class="card-tile-name">' + esc(p.name) + '</span>' +
        '<span class="card-tile-meta"><span class="card-tile-pos">' + esc(pos) + '</span>' + controlBadge(p) +
          (p.retiredAI ? '<span class="badge badge-retired">RETIRED</span>' : "") + '</span>' +
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
        "Set API_URL in js/config.js — " + (kind || "live data") + " appears once it's pointed at the Worker.",
        "⛓"
      );
    }
    return emptyState(
      "Nothing here yet",
      "No " + (kind || "data") + " has been recorded yet — check back once Housekeeping's added some.",
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
    canonPos: canonPos, positionsOf: positionsOf, posFit: posFit,
    controlBadge: controlBadge, captainBadge: captainBadge, chips: chips,
    pill: pill, cardTile: cardTile, cardSrc: cardSrc, statTile: statTile, runCountUps: runCountUps,
    emptyState: emptyState, waitingState: waitingState, offlineState: offlineState,
    scorersLine: scorersLine, toast: toast
  };
})();
