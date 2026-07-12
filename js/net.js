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

    hasStoredSession: function () {
      return !!(this._token && this._name);
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

    register: function (name, pass, turnstile) {
      var self = this;
      return this._call("register", { name: name, pass: pass, turnstile: turnstile || "" }).then(function (r) { return self._adopt(r); });
    },

    login: function (name, pass, turnstile) {
      var self = this;
      return this._call("login", { name: name, pass: pass, turnstile: turnstile || "" }).then(function (r) { return self._adopt(r); });
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

    /* ---------- public reads (the club's own archive) ---------- */
    matches: function () { return this._call("matches"); },
    career:  function () { return this._call("career"); },
    record:  function () { return this._call("record"); },
    config:  function () { return this._call("config"); },
    twitchStatus: function () { return this._call("twitch_status"); },

    /* ---------- archive writes (server re-checks every level) ---------- */
    matchSave:   function (match) { return this._auth("match_save", { match: match }); },   // L5+
    matchDelete: function (seq)   { return this._auth("match_delete", { seq: seq }); },     // L9
    careerSave:  function (career, baselineSeq) {
      var p = { career: career };
      if (baselineSeq !== undefined) p.baselineSeq = baselineSeq;
      return this._auth("career_save", p);                                                  // L9
    },
    recordSave:  function (record) { return this._auth("record_save", { record: record }); }, // L9

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
    adminFlavour:   function (id, text)    { return this._auth("admin_flavour", { id: id, text: text }); },
    adminMilestone: function (payload)     { return this._auth("admin_milestone", payload); },

    /* ---------- forum (members) ---------- */
    forumThreads: function (category) { return this._auth("forum_threads", { category: category || "" }); },
    forumThread:  function (id)       { return this._auth("forum_thread", { id: id }); },
    forumNew:     function (category, title, body) { return this._auth("forum_new", { category: category, title: title, body: body }); },
    forumReply:   function (threadId, text)        { return this._auth("forum_reply", { threadId: threadId, text: text }); },
    forumDelete:  function (payload)  { return this._auth("forum_delete", payload || {}); }, // L5+

    /* ---------- fixtures · socials · squad · fun (L5+) · personal · season (L9) ---------- */
    adminFixtures: function (payload)  { return this._auth("admin_fixtures", payload || {}); },
    adminTiktok:   function (handle)   { return this._auth("admin_socials", { tiktok: handle }); }, // legacy shim
    adminSocials:  function (payload)  { return this._auth("admin_socials", payload || {}); },       // { tiktok, twitch }
    adminSquad:    function (payload)  { return this._auth("admin_squad", payload || {}); },
    adminFun:      function (payload)  { return this._auth("admin_fun", payload || {}); },            // { action:"set", fun:{…} }
    adminPersonal: function (payload)  { return this._auth("admin_personal", payload || {}); },
    adminSeason:   function (payload)  { return this._auth("admin_season", payload || {}); }           // { action:"archive"|"get", … }
  };

  window.G = window.G || {};
  window.G.NET = NET;
  window.NET = NET; // convenience alias
})();
