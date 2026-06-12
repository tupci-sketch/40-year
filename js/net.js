/* ============================================================
   The 40Yr Virgil — G.NET client wrapper
   ------------------------------------------------------------
   Mirrors the proven 650 transport:
   · ONE Apps Script /exec URL (window.APP_URL, set in config.js)
   · POST with Content-Type: text/plain  → a "simple" request,
     no CORS preflight, plays nicely with Apps Script.
   · Every payload carries  game:"v40"  and a `kind`.
   · EVERY call fails soft → {ok:false, error:"offline"}.
   Session token + name live in localStorage; the server alone
   decides levels — the client never claims one.
   ============================================================ */
(function () {
  "use strict";

  var KEY = "v40.session";

  var NET = {
    me: null,          // { name, level } once a session is verified
    _name: null,
    _token: null,

    /* ---------- boot ---------- */
    init: function () {
      try {
        var s = JSON.parse(localStorage.getItem(KEY) || "null");
        if (s && s.token && s.name) {
          this._token = s.token;
          this._name = s.name;
        }
      } catch (e) { /* ignore corrupt storage */ }
    },

    _store: function () {
      try {
        if (this._token && this._name) {
          localStorage.setItem(KEY, JSON.stringify({ name: this._name, token: this._token }));
        } else {
          localStorage.removeItem(KEY);
        }
      } catch (e) { /* private mode etc. */ }
    },

    hasBackend: function () {
      return !!(window.APP_URL && String(window.APP_URL).indexOf("http") === 0);
    },

    /* ---------- transport ---------- */
    _call: function (kind, payload) {
      if (!this.hasBackend()) {
        return Promise.resolve({ ok: false, error: "offline" });
      }
      var body = JSON.stringify(Object.assign({ game: "v40", kind: kind }, payload || {}));
      return fetch(window.APP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: body
      })
        .then(function (r) { return r.json(); })
        .catch(function () { return { ok: false, error: "offline" }; });
    },

    _auth: function (kind, payload) {
      var p = Object.assign({}, payload || {}, { name: this._name, token: this._token });
      return this._call(kind, p);
    },

    /* ---------- identity ---------- */
    isMod: function ()   { return !!(this.me && Number(this.me.level) >= 5); },
    isAdmin: function () { return !!(this.me && Number(this.me.level) >= 9); },

    _adopt: function (res) {
      if (res && res.ok && res.token) {
        this._token = res.token;
        this._name = res.name;
        this.me = { name: res.name, level: Number(res.level) || 1 };
        this._store();
      }
      return res;
    },

    register: function (name, pass) {
      var self = this;
      return this._call("register", { name: name, pass: pass }).then(function (r) { return self._adopt(r); });
    },

    login: function (name, pass) {
      var self = this;
      return this._call("login", { name: name, pass: pass }).then(function (r) { return self._adopt(r); });
    },

    session: function () {
      var self = this;
      if (!this._token || !this._name) return Promise.resolve({ ok: false, error: "session" });
      return this._auth("session").then(function (r) {
        if (r && r.ok) {
          self.me = { name: r.name, level: Number(r.level) || 1 };
        } else if (r && r.error !== "offline") {
          self.me = null; self._token = null; self._name = null; self._store();
        }
        return r;
      });
    },

    logout: function () {
      var self = this;
      var p = this._auth("logout");
      this.me = null; this._token = null; this._name = null; this._store();
      return p;
    },

    savePrefs: function (prefs) {
      return this._auth("save", { prefs: JSON.stringify(prefs || {}) });
    },

    /* ---------- public reads (the saved EA archive) ---------- */
    club:    function ()      { return this._call("club"); },
    members: function ()      { return this._call("members"); },
    matches: function (limit) { return this._call("matches", limit ? { limit: limit } : {}); },
    results: function (limit) { return this._call("results", limit ? { limit: limit } : {}); },
    config:  function ()      { return this._call("config"); },

    /* ---------- chat ---------- */
    chatFetch:  function ()      { return this._call("chat_fetch"); },
    chatPost:   function (text)  { return this._auth("chat_post", { text: text }); },
    chatDelete: function (id)    { return this._auth("chat_delete", { id: id }); },

    /* ---------- housekeeping (server re-checks every level) ---------- */
    adminUsers:     function ()            { return this._auth("admin_users"); },
    adminSetLevel:  function (user, level) { return this._auth("admin_setlevel", { user: user, level: level }); },
    adminBan:       function (user)        { return this._auth("admin_ban", { user: user }); },
    adminUnban:     function (user)        { return this._auth("admin_unban", { user: user }); },
    adminBanner:    function (text, active){ return this._auth("admin_banner", { text: text, active: !!active }); },
    adminLore:      function (text)        { return this._auth("admin_lore", { text: text }); },
    adminAddResult: function (r)           { return this._auth("admin_addresult", r); },
    adminDelResult: function (id)          { return this._auth("admin_delresult", { id: id }); },
    adminPullNow:   function ()            { return this._auth("admin_pullnow"); },
    adminFlavour:   function (id, text)    { return this._auth("admin_flavour", { id: id, text: text }); },
    adminMilestone: function (payload)     { return this._auth("admin_milestone", payload); }
  };

  window.G = window.G || {};
  window.G.NET = NET;
  window.NET = NET; // convenience alias
})();
