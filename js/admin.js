/* ============================================================
   The 40Yr Virgil — Housekeeping (admin console)
   ------------------------------------------------------------
   Renders into #admin-view. Every control here is a convenience
   wrapper: the SERVER re-checks the caller's level on every
   single call. Hiding a button is cosmetics, not security.
   Levels: 5+ = mod (view users, moderate chat) · 9 = admin.
   ============================================================ */
(function () {
  "use strict";

  var U, NET, DATA, helpers;
  var root = null;

  /* ---------- tiny form helpers ---------- */
  function field(label, inputHtml, hint) {
    return '<label class="field"><span class="field-label">' + label + "</span>" + inputHtml +
      (hint ? '<span class="field-hint">' + hint + "</span>" : "") + "</label>";
  }

  function block(title, bodyHtml, levelNote) {
    return '<section class="panel admin-block">' +
      '<div class="section-label">' + title +
        (levelNote ? ' <span class="admin-lvl">' + levelNote + "</span>" : "") + "</div>" +
      bodyHtml +
    "</section>";
  }

  function refreshConfig() {
    DATA.bust();
    return DATA.config().then(function (res) {
      helpers.applyConfig(res);
      return res;
    });
  }

  function cfgFrom(res) { return (res && res.config) || {}; }

  /* ========================================================
     RENDER
     ======================================================== */
  function enter(container, h) {
    U = window.UI; NET = window.NET; DATA = window.DATA; helpers = h || helpers || {};
    root = container;

    // The router already bounces anyone who isn't a signed-in mod, so the only
    // time a non-mod reaches here is the brief grace window while a real admin's
    // session is still verifying. Show a neutral placeholder — never describe
    // what this area does to someone who can't use it.
    if (!NET.isMod()) {
      root.innerHTML = '<div class="panel admin-gate"><p class="admin-gate-line">Checking access…</p></div>';
      return;
    }

    root.innerHTML = '<div class="admin-grid" id="admin-grid">' + U.emptyState("Opening the office…", "", "🗝") + "</div>";

    DATA.config().then(function (res) {
      var grid = U.$("#admin-grid", root);
      if (!grid) return;
      var c = cfgFrom(res);
      var admin = NET.isAdmin();
      var html = "";

      if (admin) html += blockBanner(c);
      if (admin) html += blockLore(c);
      if (admin) html += blockResults();
      if (admin) html += blockEA(c);
      html += blockUsers(admin);
      html += blockChatNote();
      if (admin) html += blockFlavour(c);
      if (admin) html += blockMilestones(c);
      if (!admin) {
        html += block("The rest of the console",
          '<p class="admin-note">Banner, lore, results and EA controls unlock at level 9. The admin holds that key.</p>');
      }

      grid.innerHTML = html;
      bindAll(c);
    });
  }

  /* ---------- 1 · Banner ---------- */
  function blockBanner(c) {
    var b = c.banner || {};
    return block("Announcement banner",
      field("Banner text", '<input type="text" id="adm-banner-text" maxlength="160" value="' + U.esc(b.text || "") + '" placeholder="e.g. Cup night Thursday — full squad expected">') +
      '<label class="field field-check"><input type="checkbox" id="adm-banner-active"' + (b.active ? " checked" : "") + '> <span>Banner is live on every screen</span></label>' +
      '<div class="admin-actions"><button class="btn btn-primary btn-small" id="adm-banner-save">Save banner</button></div>',
      "L9");
  }

  /* ---------- 2 · Lore ---------- */
  function blockLore(c) {
    return block("Lore — the name's origin",
      '<p class="admin-note">Shown on the About screen the moment it\u2019s non-empty. Blank line = new paragraph.</p>' +
      '<textarea id="adm-lore" rows="6" placeholder="The true story of The 40Yr Virgil…">' + U.esc(c.lore || "") + "</textarea>" +
      '<div class="admin-actions"><button class="btn btn-primary btn-small" id="adm-lore-save">Publish lore</button>' +
      '<button class="btn btn-ghost btn-small" id="adm-lore-clear">Clear</button></div>',
      "L9");
  }

  /* ---------- 3 · Manual results ---------- */
  function blockResults() {
    return block("Manual results",
      '<p class="admin-note">For matches the API never caught. Saved by season + matchday — re-saving the same pair updates it. If EA later reports the same fixture, the API version wins.</p>' +
      '<div class="field-row">' +
        field("Season", '<input type="number" id="adm-r-season" min="1" value="2">') +
        field("Matchday", '<input type="number" id="adm-r-md" min="1" value="1">') +
        field("Date", '<input type="date" id="adm-r-date">') +
      "</div>" +
      field("Opponent", '<input type="text" id="adm-r-opp" maxlength="60" placeholder="e.g. Bald FC">') +
      '<div class="field-row">' +
        field("Our goals", '<input type="number" id="adm-r-our" min="0" value="0">') +
        field("Their goals", '<input type="number" id="adm-r-their" min="0" value="0">') +
      "</div>" +
      field("Scorers", '<input type="text" id="adm-r-scorers" placeholder="Danwhizzy x2, Tupci">', "Comma-separated · use \u201Cx2\u201D for braces") +
      field("Note", '<input type="text" id="adm-r-note" maxlength="160" placeholder="Optional — e.g. server crashed at 80\u2019">') +
      '<div class="admin-actions"><button class="btn btn-primary btn-small" id="adm-r-save">Save result</button></div>' +
      '<div id="adm-r-list" class="admin-sublist"></div>',
      "L9");
  }

  function renderManualList() {
    var mt = U.$("#adm-r-list", root);
    if (!mt) return;
    mt.innerHTML = '<p class="admin-note">Loading saved manual results…</p>';
    DATA.results().then(function (res) {
      if (!res || !res.ok) { mt.innerHTML = ""; return; }
      var manual = (res.results || []).filter(function (r) { return r.source === "manual"; });
      if (!manual.length) { mt.innerHTML = '<p class="admin-note">No manual results saved yet.</p>'; return; }
      mt.innerHTML = manual.map(function (r) {
        return '<div class="admin-row">' +
          '<span class="admin-row-main">S' + U.esc(String(r.season)) + " MD" + U.esc(String(r.matchday)) + " · " +
            U.esc(r.opponent || "?") + " · " + r.ourGoals + "–" + r.theirGoals + " · " + U.fmtDate(r.ts) + "</span>" +
          '<button class="btn btn-ghost btn-small adm-r-del" data-id="' + U.esc(r.id) + '">Delete</button>' +
        "</div>";
      }).join("");
      U.$$(".adm-r-del", mt).forEach(function (b) {
        b.addEventListener("click", function () {
          b.disabled = true;
          NET.adminDelResult(b.getAttribute("data-id")).then(function (r2) {
            if (r2 && r2.ok) { U.toast("Manual result deleted."); DATA.bust(); renderManualList(); }
            else { b.disabled = false; U.toast("Couldn't delete that."); }
          });
        });
      });
    });
  }

  /* ---------- 4 · EA controls ---------- */
  function blockEA(c) {
    return block("EA sync",
      '<p class="admin-note">The backend pulls hourly on its own. This button asks it nicely to go now.</p>' +
      '<div class="admin-actions">' +
        '<button class="btn btn-gold btn-small" id="adm-pull">Pull from EA now</button>' +
        '<span class="admin-inline-note">Last pulled: <strong id="adm-lastpull">' + U.esc(c.ea_lastPulled ? U.fmtDateTime(c.ea_lastPulled) : "never") + "</strong></span>" +
      "</div>" +
      '<div id="adm-pull-out" class="admin-pull-out"></div>' +
      '<details class="admin-raw"><summary>Latest raw club snapshot</summary><pre id="adm-raw-club">loading…</pre></details>',
      "L9");
  }

  function renderRawSnapshot() {
    var pre = U.$("#adm-raw-club", root);
    if (!pre) return;
    DATA.club().then(function (res) {
      if (!pre.isConnected) return;
      if (!res || !res.ok || !res.latest) { pre.textContent = "No snapshot saved yet."; return; }
      try { pre.textContent = JSON.stringify(res.latest, null, 2); }
      catch (e) { pre.textContent = "Snapshot unreadable."; }
    });
  }

  /* ---------- 5 · Users ---------- */
  function blockUsers(admin) {
    return block("Users",
      '<p class="admin-note">' + (admin
        ? "Levels 1–9. Level 5+ moderates chat; level 9 runs the club. You can\u2019t edit yourself — checks and balances."
        : "View only at your level. Level 9 manages accounts.") + "</p>" +
      '<div id="adm-users">' + U.emptyState("Fetching the register…", "", "👥") + "</div>",
      admin ? "L9 manage" : "L5 view");
  }

  function renderUsers() {
    var mt = U.$("#adm-users", root);
    if (!mt) return;
    NET.adminUsers().then(function (res) {
      if (!mt.isConnected) return;
      if (!res || !res.ok) { mt.innerHTML = U.offlineState(); return; }
      var admin = NET.isAdmin();
      var rows = (res.users || []).map(function (u) {
        var self = NET.me && u.name === NET.me.name;
        var lvlCell;
        if (admin && !self) {
          var opts = "";
          for (var i = 1; i <= 9; i++) {
            opts += '<option value="' + i + '"' + (Number(u.level) === i ? " selected" : "") + ">" + i + "</option>";
          }
          lvlCell = '<select class="adm-u-level" data-user="' + U.esc(u.name) + '">' + opts + "</select>";
        } else {
          lvlCell = String(u.level) + (self ? " (you)" : "");
        }
        var status = String(u.banned) === "1" || u.banned === true
          ? '<span class="admin-banned">banned</span>' : "active";
        var actions = "";
        if (admin && !self) {
          actions = (String(u.banned) === "1" || u.banned === true)
            ? '<button class="btn btn-ghost btn-small adm-u-unban" data-user="' + U.esc(u.name) + '">Unban</button>'
            : '<button class="btn btn-ghost btn-small adm-u-ban" data-user="' + U.esc(u.name) + '">Ban</button>';
        }
        return "<tr><td>" + U.esc(u.name) + "</td><td>" + lvlCell + "</td><td>" + status + "</td>" +
          "<td>" + U.fmtDate(u.last || u.created) + "</td><td>" + actions + "</td></tr>";
      }).join("");

      mt.innerHTML =
        '<table class="opp-table opp-table-wide admin-users-table">' +
          "<thead><tr><th>Name</th><th>Level</th><th>Status</th><th>Seen</th><th></th></tr></thead>" +
          "<tbody>" + rows + "</tbody></table>";

      U.$$(".adm-u-level", mt).forEach(function (sel) {
        sel.addEventListener("change", function () {
          NET.adminSetLevel(sel.getAttribute("data-user"), Number(sel.value)).then(function (r) {
            if (r && r.ok) U.toast("Level updated.");
            else { U.toast("Couldn't change that level."); renderUsers(); }
          });
        });
      });
      U.$$(".adm-u-ban", mt).forEach(function (b) {
        b.addEventListener("click", function () {
          NET.adminBan(b.getAttribute("data-user")).then(function (r) {
            if (r && r.ok) { U.toast("Banned. The stewards thank you."); renderUsers(); }
            else U.toast("Couldn't ban that account.");
          });
        });
      });
      U.$$(".adm-u-unban", mt).forEach(function (b) {
        b.addEventListener("click", function () {
          NET.adminUnban(b.getAttribute("data-user")).then(function (r) {
            if (r && r.ok) { U.toast("Unbanned. Clean slate."); renderUsers(); }
            else U.toast("Couldn't unban that account.");
          });
        });
      });
    });
  }

  /* ---------- 6 · Chat moderation note ---------- */
  function blockChatNote() {
    return block("Chat moderation",
      '<p class="admin-note">Mods see a <strong>×</strong> on every message in the <a href="#chat">chat screen</a>. Deleting is soft — the archive keeps a copy, the room doesn\u2019t.</p>',
      "L5");
  }

  /* ---------- 7 · Flavour overrides ---------- */
  function blockFlavour(c) {
    var fl = c.flavour || {};
    var opts = window.SQUAD.map(function (p) {
      return '<option value="' + p.id + '">#' + p.number + " " + U.esc(p.name) + "</option>";
    }).join("");
    var current = Object.keys(fl).length
      ? Object.keys(fl).map(function (id) {
          var p = U.playerById(id);
          return '<div class="admin-row"><span class="admin-row-main"><strong>' +
            (p ? U.esc(p.name) : U.esc(id)) + ":</strong> " + U.esc(fl[id]) + "</span>" +
            '<button class="btn btn-ghost btn-small adm-fl-clear" data-id="' + U.esc(id) + '">Clear</button></div>';
        }).join("")
      : '<p class="admin-note">No overrides — everyone\u2019s on their factory-set one-liner.</p>';
    return block("Player flavour overrides",
      field("Player", '<select id="adm-fl-player">' + opts + "</select>") +
      field("New flavour line", '<input type="text" id="adm-fl-text" maxlength="140" placeholder="Words only — the numbers stay live">') +
      '<div class="admin-actions"><button class="btn btn-primary btn-small" id="adm-fl-save">Set flavour</button></div>' +
      '<div class="admin-sublist">' + current + "</div>",
      "L9");
  }

  /* ---------- 8 · Milestones ---------- */
  function blockMilestones(c) {
    var ms = c.milestones || [];
    var list = ms.length
      ? ms.map(function (m) {
          return '<div class="admin-row"><span class="admin-row-main">' + U.fmtDate(m.dateISO) + " · " + U.esc(m.text) + "</span>" +
            '<button class="btn btn-ghost btn-small adm-ms-del" data-id="' + U.esc(m.id) + '">Delete</button></div>';
        }).join("")
      : '<p class="admin-note">No custom milestones yet. Division moves chart themselves.</p>';
    return block("Honours milestones",
      '<div class="field-row">' +
        field("Date", '<input type="date" id="adm-ms-date">') +
        field("Milestone", '<input type="text" id="adm-ms-text" maxlength="120" placeholder="e.g. First clean sheet with all bots">') +
      "</div>" +
      '<div class="admin-actions"><button class="btn btn-primary btn-small" id="adm-ms-add">Add to the timeline</button></div>' +
      '<div class="admin-sublist">' + list + "</div>",
      "L9");
  }

  /* ========================================================
     BIND
     ======================================================== */
  function bindAll(c) {
    var b;

    /* banner */
    b = U.$("#adm-banner-save", root);
    if (b) b.addEventListener("click", function () {
      b.disabled = true;
      NET.adminBanner(U.$("#adm-banner-text", root).value.trim(), U.$("#adm-banner-active", root).checked)
        .then(function (r) {
          b.disabled = false;
          if (r && r.ok) { U.toast("Banner saved."); refreshConfig(); }
          else U.toast("Couldn't save the banner.");
        });
    });

    /* lore */
    b = U.$("#adm-lore-save", root);
    if (b) b.addEventListener("click", function () {
      b.disabled = true;
      NET.adminLore(U.$("#adm-lore", root).value).then(function (r) {
        b.disabled = false;
        if (r && r.ok) { U.toast("Lore published. The About page just got heavier."); refreshConfig(); }
        else U.toast("Couldn't publish.");
      });
    });
    b = U.$("#adm-lore-clear", root);
    if (b) b.addEventListener("click", function () {
      U.$("#adm-lore", root).value = "";
      NET.adminLore("").then(function (r) {
        if (r && r.ok) { U.toast("Lore cleared."); refreshConfig(); }
      });
    });

    /* manual results */
    b = U.$("#adm-r-save", root);
    if (b) {
      renderManualList();
      b.addEventListener("click", function () {
        var scorersRaw = U.$("#adm-r-scorers", root).value.trim();
        var scorers = scorersRaw
          ? scorersRaw.split(",").map(function (s) {
              var m = s.trim().match(/^(.*?)\s*[x×]\s*(\d+)$/i);
              return m ? { name: m[1].trim(), goals: Number(m[2]) } : { name: s.trim(), goals: 1 };
            }).filter(function (s) { return s.name; })
          : [];
        var payload = {
          season: Number(U.$("#adm-r-season", root).value) || 1,
          matchday: Number(U.$("#adm-r-md", root).value) || 1,
          dateISO: U.$("#adm-r-date", root).value || new Date().toISOString().slice(0, 10),
          opponent: U.$("#adm-r-opp", root).value.trim(),
          ourScore: Number(U.$("#adm-r-our", root).value) || 0,
          theirScore: Number(U.$("#adm-r-their", root).value) || 0,
          scorers: scorers,
          note: U.$("#adm-r-note", root).value.trim()
        };
        if (!payload.opponent) { U.toast("Who did we play? Opponent is required."); return; }
        b.disabled = true;
        NET.adminAddResult(payload).then(function (r) {
          b.disabled = false;
          if (r && r.ok) {
            U.toast("Result saved to the archive.");
            DATA.bust();
            renderManualList();
          } else U.toast("Couldn't save that result.");
        });
      });
    }

    /* EA pull */
    b = U.$("#adm-pull", root);
    if (b) {
      renderRawSnapshot();
      b.addEventListener("click", function () {
        b.disabled = true;
        b.textContent = "Pulling…";
        var out = U.$("#adm-pull-out", root);
        out.innerHTML = '<p class="admin-note">Knocking on EA\u2019s door…</p>';
        NET.adminPullNow().then(function (r) {
          b.disabled = false;
          b.textContent = "Pull from EA now";
          if (r && r.ok) {
            var bits = [];
            bits.push(r.club ? "club snapshot saved" : "club unchanged");
            bits.push((r.members || 0) + " member rows added");
            bits.push((r.matchesNew || 0) + " new matches, " + (r.matchesUpdated || 0) + " updated");
            if (r.errors && r.errors.length) bits.push("⚠ " + r.errors.join(" · "));
            out.innerHTML = '<p class="admin-note admin-pull-ok">✓ ' + U.esc(bits.join(" · ")) + "</p>";
            U.$("#adm-lastpull", root).textContent = U.fmtDateTime(new Date().toISOString());
            DATA.bust();
            renderRawSnapshot();
            renderManualList();
          } else {
            out.innerHTML = '<p class="admin-note">✗ Pull failed' + (r && r.error ? " — " + U.esc(r.error) : "") + ". EA might be sulking; try again shortly.</p>";
          }
        });
      });
    }

    /* users */
    if (U.$("#adm-users", root)) renderUsers();

    /* flavour */
    b = U.$("#adm-fl-save", root);
    if (b) b.addEventListener("click", function () {
      var id = U.$("#adm-fl-player", root).value;
      var text = U.$("#adm-fl-text", root).value.trim();
      b.disabled = true;
      NET.adminFlavour(id, text).then(function (r) {
        b.disabled = false;
        if (r && r.ok) {
          U.toast(text ? "Flavour set." : "Flavour cleared.");
          refreshConfig().then(function () { enter(root, helpers); });
        } else U.toast("Couldn't set that.");
      });
    });
    U.$$(".adm-fl-clear", root).forEach(function (btn) {
      btn.addEventListener("click", function () {
        NET.adminFlavour(btn.getAttribute("data-id"), "").then(function (r) {
          if (r && r.ok) {
            U.toast("Override cleared.");
            refreshConfig().then(function () { enter(root, helpers); });
          }
        });
      });
    });

    /* milestones */
    b = U.$("#adm-ms-add", root);
    if (b) b.addEventListener("click", function () {
      var dateISO = U.$("#adm-ms-date", root).value;
      var text = U.$("#adm-ms-text", root).value.trim();
      if (!dateISO || !text) { U.toast("A milestone needs a date and a line."); return; }
      b.disabled = true;
      NET.adminMilestone({ action: "add", dateISO: dateISO, text: text }).then(function (r) {
        b.disabled = false;
        if (r && r.ok) {
          U.toast("Milestone carved in.");
          refreshConfig().then(function () { enter(root, helpers); });
        } else U.toast("Couldn't add that.");
      });
    });
    U.$$(".adm-ms-del", root).forEach(function (btn) {
      btn.addEventListener("click", function () {
        NET.adminMilestone({ action: "del", id: btn.getAttribute("data-id") }).then(function (r) {
          if (r && r.ok) {
            U.toast("Milestone removed.");
            refreshConfig().then(function () { enter(root, helpers); });
          }
        });
      });
    });
  }

  window.ADMIN = { enter: enter };
})();
