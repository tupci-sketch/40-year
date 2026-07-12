/* ============================================================
   The 40Yr Virgil — tactics board (the centrepiece)
   ------------------------------------------------------------
   Three formations · drag-and-drop with snap-to-slot · bench
   rail with Rizzy Dave pinned at the end of it, forever.
   Native pointer events only. Each formation remembers its own
   shuffle until Reset XI.
   House rules enforced here:
     · Rizzy Dave never leaves the bench. (The joke.)
     · Move Tupci off CAM and the board has opinions.
   ============================================================ */
(function () {
  "use strict";

  var U = null; // UI helpers, bound on mount

  var state = {
    mounted: false,
    current: window.DEFAULT_FORMATION,
    arrangements: {} // fkey -> { slots:[playerId], bench:[playerId] }
  };

  function defaults(fkey) {
    var f = window.FORMATIONS[fkey];
    return {
      slots: f.slots.map(function (s) { return s.player; }),
      bench: f.bench.slice()
    };
  }

  function arr() {
    if (!state.arrangements[state.current]) state.arrangements[state.current] = defaults(state.current);
    return state.arrangements[state.current];
  }

  function pinRizzy(bench) {
    var i = bench.indexOf("rizzydave");
    if (i !== -1) { bench.splice(i, 1); bench.push("rizzydave"); }
    return bench;
  }

  function shuffleT(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* The wheel picks a chaotic-but-legal XI. House rules survive it:
     a keeper goes in goal, the captain keeps CAM, Rizzy stays benched. */
  function randomEleven(fkey) {
    var f = window.FORMATIONS[fkey];
    var squad = (window.SQUAD || []).filter(function (p) { return !p.disabled; });
    var byGroup = function (g) { return squad.filter(function (p) { return U.posGroup(p) === g; }).map(function (p) { return p.id; }); };
    var gks = shuffleT(byGroup("GK"));
    var outfield = shuffleT(squad.filter(function (p) {
      return U.posGroup(p) !== "GK" && p.id !== "rizzydave";
    }).map(function (p) { return p.id; }));

    var slots = f.slots.map(function () { return null; });
    var used = {};
    function take(id) { used[id] = 1; return id; }

    // keepers first
    f.slots.forEach(function (s, i) {
      if (s.pos === "GK" && gks.length) slots[i] = take(gks.shift());
    });
    // captain's clause: Tupci owns CAM if the shape has one
    var camIdx = -1;
    f.slots.forEach(function (s, i) { if (camIdx === -1 && s.pos === "CAM") camIdx = i; });
    var hasTupci = squad.some(function (p) { return p.id === "tupci"; });
    if (camIdx !== -1 && hasTupci && !used["tupci"]) slots[camIdx] = take("tupci");
    // fill the rest
    var pool = outfield.filter(function (id) { return !used[id]; });
    f.slots.forEach(function (s, i) {
      if (!slots[i] && pool.length) slots[i] = take(pool.shift());
    });
    // anyone spare sits down; Rizzy anchors the bench
    var bench = squad.map(function (p) { return p.id; }).filter(function (id) { return !used[id]; });
    return { slots: slots, bench: pinRizzy(bench) };
  }

  /* ------------------------------------------------ render */
  var root, pitchEl, benchEl;

  function mount(container) {
    U = window.UI;
    root = container;
    root.innerHTML =
      '<div class="tactics-head">' +
        '<div class="formation-tabs" role="tablist" aria-label="Formation">' +
          Object.keys(window.FORMATIONS).map(function (k) {
            return '<button class="formation-tab" role="tab" data-f="' + k + '">' + k + '</button>';
          }).join("") +
        '</div>' +
        '<div class="tactics-actions">' +
          '<button class="btn btn-gold btn-small" id="tactics-random" title="Let the wheel pick the XI">🎲 Gaffer’s XI</button>' +
          '<button class="btn btn-ghost btn-small" id="tactics-reset">Reset XI</button>' +
        '</div>' +
      '</div>' +
      '<p class="tactics-note" id="tactics-note"></p>' +
      '<div class="pitch-wrap">' +
        '<div class="pitch" id="pitch" aria-label="Tactics pitch">' +
          '<div class="pitch-lines">' +
            '<div class="pl-halfway"></div><div class="pl-centre"></div><div class="pl-spot"></div>' +
            '<div class="pl-box pl-box-ours"></div><div class="pl-six pl-six-ours"></div>' +
            '<div class="pl-box pl-box-theirs"></div><div class="pl-six pl-six-theirs"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="bench-rail-wrap">' +
        '<span class="bench-label">Bench</span>' +
        '<div class="bench-rail" id="bench-rail"></div>' +
      '</div>' +
      '<p class="tactics-hint">Drag a shirt onto another to swap. Tap a shirt for the mini card.</p>' +
      '<div class="minicard" id="minicard" hidden></div>';

    pitchEl = U.$("#pitch", root);
    benchEl = U.$("#bench-rail", root);

    U.$$(".formation-tab", root).forEach(function (b) {
      b.addEventListener("click", function () { setFormation(b.getAttribute("data-f")); });
    });
    U.$("#tactics-reset", root).addEventListener("click", function () {
      state.arrangements[state.current] = defaults(state.current);
      render();
      U.toast("Back to the gaffer's whiteboard.");
    });
    U.$("#tactics-random", root).addEventListener("click", function () {
      state.arrangements[state.current] = randomEleven(state.current);
      render();
      U.toast("The wheel has spoken. Rizzy Dave remains, as ever, seated.");
    });

    document.addEventListener("click", function (e) {
      var mc = U.$("#minicard", root);
      if (mc && !mc.hidden && !mc.contains(e.target) && !e.target.closest(".token, .bench-chip")) hideMini();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") hideMini(); });

    state.mounted = true;
    render();
  }

  function setFormation(fkey) {
    if (!window.FORMATIONS[fkey]) return;
    state.current = fkey;
    hideMini();
    render();
  }

  function render() {
    var f = window.FORMATIONS[state.current];
    var a = arr();
    pinRizzy(a.bench);

    U.$$(".formation-tab", root).forEach(function (b) {
      var on = b.getAttribute("data-f") === state.current;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    U.$("#tactics-note", root).textContent = f.note;

    // clear old tokens + slot ghosts
    U.$$(".token, .slot-ghost", pitchEl).forEach(function (n) { n.remove(); });

    f.slots.forEach(function (slot, i) {
      var ghost = U.el("div", { "class": "slot-ghost", "data-slot": String(i) });
      ghost.style.left = slot.x + "%";
      ghost.style.bottom = slot.y + "%";
      ghost.innerHTML = '<span>' + slot.pos + '</span>';
      pitchEl.appendChild(ghost);

      var p = U.playerById(a.slots[i]);
      var tok = U.el("div", {
        "class": "token" + (p.controlledBy === "human" ? " token-human" : ""),
        "data-slot": String(i), "data-id": p.id,
        tabindex: "0", role: "button",
        "aria-label": p.name + ", number " + p.number + ", " + slot.pos
      });
      tok.style.left = slot.x + "%";
      tok.style.bottom = slot.y + "%";
      tok.innerHTML =
        '<span class="token-shirt">' + p.number +
          (p.isCaptain ? '<span class="token-armband" title="Captain">C</span>' : "") +
        '</span>' +
        '<span class="token-name">' + U.esc(U.surname(p)) + '</span>';
      bindDrag(tok, { type: "slot", index: i });
      pitchEl.appendChild(tok);
    });

    benchEl.innerHTML = "";
    a.bench.forEach(function (id, bi) {
      var p = U.playerById(id);
      var pinned = p.permaBench;
      var chip = U.el("div", {
        "class": "bench-chip" + (pinned ? " bench-chip-pinned" : "") + (p.controlledBy === "human" ? " token-human" : ""),
        "data-bench": String(bi), "data-id": p.id,
        tabindex: "0", role: "button",
        "aria-label": p.name + ", number " + p.number + ", bench" + (pinned ? ", permanently" : "")
      });
      chip.innerHTML =
        '<span class="token-shirt">' + p.number + '</span>' +
        '<span class="token-name">' + U.esc(U.surname(p)) + '</span>' +
        (pinned ? '<span class="bench-pin" title="Perma-bench">📌</span>' : "");
      bindDrag(chip, { type: "bench", index: bi });
      benchEl.appendChild(chip);
    });
  }

  /* ------------------------------------------------ drag engine */
  var drag = null; // { src:{type,index}, id, ghost, startX, startY, moved }

  function bindDrag(node, src) {
    node.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      var id = node.getAttribute("data-id");
      drag = { src: src, id: id, node: node, startX: e.clientX, startY: e.clientY, moved: false, ghost: null };
      node.setPointerCapture(e.pointerId);
    });

    node.addEventListener("pointermove", function (e) {
      if (!drag || drag.node !== node) return;
      var dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;

      if (!drag.moved) {
        drag.moved = true;
        if (drag.id === "rizzydave") {
          // The joke, enforced.
          node.classList.add("wobble");
          setTimeout(function () { node.classList.remove("wobble"); }, 500);
          U.toast("Not starting. Still dangerous.");
          drag = null;
          return;
        }
        drag.ghost = makeGhost(node);
        node.classList.add("drag-src");
      }
      moveGhost(drag.ghost, e.clientX, e.clientY);
    });

    function finish(e) {
      if (!drag || drag.node !== node) return;
      var d = drag; drag = null;
      if (d.ghost) { d.ghost.remove(); }
      node.classList.remove("drag-src");

      if (!d.moved) { showMini(node, d.src); return; }
      handleDrop(d, e.clientX, e.clientY);
    }
    node.addEventListener("pointerup", finish);
    node.addEventListener("pointercancel", function () {
      if (drag && drag.node === node) {
        if (drag.ghost) drag.ghost.remove();
        node.classList.remove("drag-src");
        drag = null;
      }
    });

    node.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showMini(node, src); }
    });
  }

  function makeGhost(node) {
    var g = node.cloneNode(true);
    g.classList.add("token-ghost");
    g.style.width = node.offsetWidth + "px";
    document.body.appendChild(g);
    return g;
  }
  function moveGhost(g, x, y) {
    if (!g) return;
    g.style.left = x + "px";
    g.style.top = y + "px";
  }

  function nearestSlot(clientX, clientY) {
    var r = pitchEl.getBoundingClientRect();
    if (clientX < r.left - 20 || clientX > r.right + 20 || clientY < r.top - 20 || clientY > r.bottom + 20) return -1;
    var xPct = ((clientX - r.left) / r.width) * 100;
    var yPct = ((r.bottom - clientY) / r.height) * 100;
    var slots = window.FORMATIONS[state.current].slots;
    var best = -1, bestD = 1e9;
    slots.forEach(function (s, i) {
      var d = Math.hypot(s.x - xPct, (s.y - yPct) * (r.height / r.width)); // weight y by aspect
      if (d < bestD) { bestD = d; best = i; }
    });
    return bestD <= 16 ? best : -1;
  }

  function chipUnder(clientX, clientY) {
    var elAt = document.elementFromPoint(clientX, clientY);
    if (!elAt) return null;
    var chip = elAt.closest && elAt.closest(".bench-chip");
    if (chip) return { type: "chip", index: Number(chip.getAttribute("data-bench")), id: chip.getAttribute("data-id") };
    var rail = elAt.closest && elAt.closest(".bench-rail-wrap");
    return rail ? { type: "rail" } : null;
  }

  function handleDrop(d, x, y) {
    var a = arr();
    var slotI = nearestSlot(x, y);

    if (slotI !== -1) {
      if (d.src.type === "slot") {
        if (slotI !== d.src.index) {
          var tmp = a.slots[slotI];
          a.slots[slotI] = a.slots[d.src.index];
          a.slots[d.src.index] = tmp;
          afterSwap(a, [a.slots[slotI], a.slots[d.src.index]]);
        }
      } else {
        // bench → pitch swap
        var out = a.slots[slotI];
        a.slots[slotI] = d.id;
        a.bench[d.src.index] = out;
        afterSwap(a, [d.id, out]);
      }
      render();
      return;
    }

    var bench = chipUnder(x, y);
    if (bench && d.src.type === "slot") {
      if (bench.type === "chip") {
        if (bench.id === "rizzydave") {
          U.toast("The bench is his kingdom. Pick another swap.");
          render();
          return;
        }
        var incoming = a.bench[bench.index];
        a.bench[bench.index] = d.id;
        a.slots[d.src.index] = incoming;
        afterSwap(a, [d.id, incoming]);
        render();
        return;
      }
      U.toast("Drop onto a bench player to swap.");
      render();
      return;
    }

    if (bench && d.src.type === "bench" && bench.type === "chip" && bench.index !== d.src.index) {
      if (bench.id === "rizzydave" || d.id === "rizzydave") { render(); return; }
      var t2 = a.bench[bench.index];
      a.bench[bench.index] = a.bench[d.src.index];
      a.bench[d.src.index] = t2;
      render();
      return;
    }

    render(); // snap back
  }

  function afterSwap(a, movedIds) {
    pinRizzy(a.bench);
    // Captain's clause
    if (movedIds.indexOf("tupci") !== -1) {
      var f = window.FORMATIONS[state.current];
      var idx = a.slots.indexOf("tupci");
      var pos = idx === -1 ? "BENCH" : f.slots[idx].pos;
      if (pos !== "CAM") U.toast("Noted. He'll drift back to CAM anyway.");
    }
  }

  /* ------------------------------------------------ mini card */
  function showMini(node, src) {
    var id = node.getAttribute("data-id");
    var p = U.playerById(id);
    var posLabel;
    if (src.type === "slot") posLabel = window.FORMATIONS[state.current].slots[src.index].pos;
    else posLabel = "Bench";

    var mc = U.$("#minicard", root);
    mc.innerHTML =
      '<button class="minicard-close" aria-label="Close">×</button>' +
      '<img src="assets/img/' + p.card + '" alt="" loading="lazy">' +
      '<div class="minicard-body">' +
        '<span class="minicard-num">#' + p.number + '</span>' +
        '<span class="minicard-name">' + U.esc(p.name) + '</span>' +
        '<span class="minicard-meta">' + U.esc(posLabel) + ' · ' + U.chips(p) + '</span>' +
        '<a class="btn btn-primary btn-small" href="#player/' + p.id + '">Full profile →</a>' +
      '</div>';
    mc.hidden = false;

    var r = node.getBoundingClientRect();
    var rootR = root.getBoundingClientRect();
    var left = r.left - rootR.left + r.width / 2;
    mc.style.left = Math.max(8, Math.min(left - 130, rootR.width - 268)) + "px";
    mc.style.top = (r.top - rootR.top + r.height + 10) + "px";

    U.$(".minicard-close", mc).addEventListener("click", hideMini);
  }

  function hideMini() {
    var mc = root && U && U.$("#minicard", root);
    if (mc) mc.hidden = true;
  }

  /* ------------------------------------------------ public */
  window.TACTICS = {
    enter: function (container) {
      if (!state.mounted || root !== container) mount(container);
      else hideMini();
    }
  };
})();
