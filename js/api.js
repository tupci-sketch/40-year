/* ============================================================
   The 40Yr Virgil — API client (Cloudflare Worker backend)
   ------------------------------------------------------------
   REST + bearer tokens, replacing the old Apps Script transport.
   Session token + display name live in localStorage; the server
   alone decides levels — the client never claims one.
   Every call fails soft → { ok:false, error:"offline" }.
   ============================================================ */
(function () {
  "use strict";

  var KEY = "v40.session";

  var NET = {
    me: null,          // { name, username, level } once a session is verified
    _token: null,

    init: function () {
      try {
        var s = JSON.parse(localStorage.getItem(KEY) || "null");
        if (s && s.token) this._token = s.token;
      } catch (e) { /* ignore corrupt storage */ }
    },

    _store: function () {
      try {
        if (this._token) localStorage.setItem(KEY, JSON.stringify({ token: this._token }));
        else localStorage.removeItem(KEY);
      } catch (e) { /* private mode etc. */ }
    },

    hasBackend: function () {
      return !!(window.API_URL && String(window.API_URL).indexOf("http") === 0);
    },
    hasStoredSession: function () { return !!this._token; },
    isMod: function ()   { return !!(this.me && Number(this.me.level) >= 5); },
    isUploader: function () { return !!(this.me && Number(this.me.level) >= 7); },
    isAdmin: function () { return !!(this.me && Number(this.me.level) >= 9); },

    /* ---------- transport ---------- */
    _url: function (path) { return window.API_URL.replace(/\/$/, "") + path; },

    _req: function (method, path, body, opts) {
      opts = opts || {};
      if (!this.hasBackend()) return Promise.resolve({ ok: false, error: "offline" });
      var headers = {};
      if (body !== undefined && !(body instanceof ArrayBuffer) && !(body instanceof Uint8Array)) headers["Content-Type"] = "application/json";
      if (this._token && !opts.noAuth) headers.Authorization = "Bearer " + this._token;
      var payload = body === undefined ? undefined :
        (body instanceof ArrayBuffer || body instanceof Uint8Array) ? body : JSON.stringify(body);
      return fetch(this._url(path), { method: method, headers: headers, body: payload })
        .then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); })
        .catch(function () { return { ok: false, error: "offline" }; });
    },
    get:   function (path) { return this._req("GET", path); },
    post:  function (path, body) { return this._req("POST", path, body === undefined ? {} : body); },
    patch: function (path, body) { return this._req("PATCH", path, body === undefined ? {} : body); },
    del:   function (path) { return this._req("DELETE", path); },
    putRaw: function (path, bytes) { return this._req("PUT", path, bytes); },

    _adopt: function (res) {
      if (res && res.ok && res.token) {
        this._token = res.token;
        this.me = { name: res.name, username: res.username, level: Number(res.level) || 1 };
        this._store();
      }
      return res;
    },

    /* ---------- auth ---------- */
    register: function (name, pass, turnstile) {
      var self = this;
      return this.post("/auth/register", { name: name, pass: pass, turnstile: turnstile || "" }).then(function (r) { return self._adopt(r); });
    },
    login: function (name, pass, turnstile) {
      var self = this;
      return this.post("/auth/login", { name: name, pass: pass, turnstile: turnstile || "" }).then(function (r) { return self._adopt(r); });
    },
    session: function () {
      var self = this;
      if (!this._token) return Promise.resolve({ ok: false, error: "session" });
      return this.get("/auth/session").then(function (r) {
        if (r && r.ok) self.me = { name: r.name, username: r.username, level: Number(r.level) || 1 };
        else if (r && r.error !== "offline") { self.me = null; self._token = null; self._store(); }
        return r;
      });
    },
    logout: function () {
      var self = this;
      var p = this.post("/auth/logout");
      this.me = null; this._token = null; this._store();
      return p;
    },

    /* ---------- public reads ---------- */
    home:          function () { return this.get("/home"); },
    clubRecord:    function () { return this.get("/club-record"); },
    squad:         function () { return this.get("/squad"); },
    seasons:       function () { return this.get("/seasons"); },
    matches:       function (q) { return this.get("/matches" + qs(q)); },
    match:         function (id) { return this.get("/matches/" + encodeURIComponent(id)); },
    player:        function (id) { return this.get("/players/" + encodeURIComponent(id)); },
    leaderboards:  function (q) { return this.get("/leaderboards" + qs(q)); },
    stats:         function () { return this.get("/stats"); },
    fixtures:      function () { return this.get("/fixtures"); },
    news:          function () { return this.get("/news"); },
    gaffers:       function () { return this.get("/gaffers"); },
    profile:       function (username) { return this.get("/profiles/" + encodeURIComponent(username)); },
    members:       function (q) { return this.get("/members" + qs(q)); },
    identityTypes: function () { return this.get("/identity-types"); },
    titles:        function () { return this.get("/titles"); },

    /* ---------- member (signed-in) ---------- */
    meProfile:      function () { return this.get("/me/profile"); },
    saveMeProfile:  function (b) { return this.patch("/me/profile", b); },
    mePoints:       function () { return this.get("/me/points"); },
    shop:           function () { return this.get("/shop"); },
    shopBuy:        function (sku) { return this.post("/shop/buy", { sku: sku }); },
    ticketClaim:    function (fixtureId) { return this.post("/tickets/claim", { fixtureId: fixtureId }); },
    tickets:        function () { return this.get("/tickets"); },
    savePrivacy:    function (b) { return this.patch("/me/privacy", b); },
    chatFetch:      function (q) { return this.get("/chat" + qs(q)); },
    chatPost:       function (text) { return this.post("/chat", { text: text }); },
    chatDelete:     function (id) { return this.del("/chat/" + id); },
    forumCategories: function () { return this.get("/forum/categories"); },
    forumThreads:   function (q) { return this.get("/forum/threads" + qs(q)); },
    forumThread:    function (id, q) { return this.get("/forum/threads/" + id + qs(q)); },
    forumNew:       function (category, title, body) { return this.post("/forum/threads", { category: category, title: title, body: body }); },
    forumReply:     function (threadId, text) { return this.post("/forum/threads/" + threadId + "/posts", { text: text }); },
    forumDeleteThread: function (id) { return this.del("/forum/threads/" + id); },
    forumDeletePost:   function (id) { return this.del("/forum/posts/" + id); },
    avail:    function (fixtureId, status) { return this.post("/fixtures/" + fixtureId + "/availability", { status: status }); },
    predict:  function (fixtureId, our, their) { return this.post("/fixtures/" + fixtureId + "/predictions", { our: our, their: their }); },
    react:    function (targetType, targetId, emoji) { return this.post("/reactions", { target_type: targetType, target_id: targetId, emoji: emoji }); },

    /* ---------- DM ---------- */
    dmConversations: function (q) { return this.get("/dm/conversations" + qs(q)); },
    dmStart:         function (username) { return this.post("/dm/conversations", { username: username }); },
    dmMessages:      function (id, q) { return this.get("/dm/conversations/" + id + "/messages" + qs(q)); },
    dmSend:          function (id, text) { return this.post("/dm/conversations/" + id + "/messages", { text: text }); },
    dmReport:        function (msgId, reason) { return this.post("/dm/messages/" + msgId + "/report", { reason: reason }); },
    dmBlock:         function (userId) { return this.post("/dm/users/" + userId + "/block"); },
    dmUnblock:       function (userId) { return this.del("/dm/users/" + userId + "/block"); },

    /* ---------- player-card media (L7+) ---------- */
    cardUpload: function (playerId, label, bytes, filename) {
      return this.putRaw("/media/player-cards/upload?playerId=" + encodeURIComponent(playerId) +
        "&label=" + encodeURIComponent(label) + (filename ? "&filename=" + encodeURIComponent(filename) : ""), bytes);
    },
    cardHistory: function (playerId) { return this.get("/media/player-cards/player/" + encodeURIComponent(playerId) + "/history"); },
    cardModerate: function (id, action) { return this.patch("/media/player-cards/" + id, { action: action }); },

    /* ---------- admin (mod/admin write) ---------- */
    adminMatchSave:   function (m) { return this.post("/admin/matches", m); },
    adminMatchDelete: function (id) { return this.del("/admin/matches/" + id); },
    adminMatchSeason: function (id, seasonId) { return this.post("/admin/matches/" + id + "/season", { seasonId: seasonId }); },
    adminFixtureAdd:  function (f) { return this.post("/admin/fixtures", f); },
    adminFixtureDel:  function (id) { return this.del("/admin/fixtures/" + id); },
    adminGafferAdd:   function (name) { return this.post("/admin/gaffers", { name: name }); },
    adminGafferPatch: function (id, b) { return this.patch("/admin/gaffers/" + id, b); },
    adminNewsAdd:     function (n) { return this.post("/admin/news", n); },
    adminNewsPatch:   function (id, b) { return this.patch("/admin/news/" + id, b); },
    adminNewsDel:     function (id) { return this.del("/admin/news/" + id); },
    adminBanner:      function (text, active) { return this.post("/admin/banner", { text: text, active: !!active }); },
    adminLeagueStatus: function (division, position, points) { return this.post("/admin/league-status", { division: division, position: position, points: points }); },
    adminSettings:    function (key, value) { return this.post("/admin/settings", { key: key, value: value }); },
    adminPlayerSave:  function (p) { return this.post("/admin/players", p); },
    adminPlayerDeactivate: function (id) { return this.del("/admin/players/" + id); },
    adminBaseline:       function (id, b) { return this.post("/admin/players/" + id + "/baseline", b); },
    adminSeasonBaseline: function (id, b) { return this.post("/admin/players/" + id + "/season-baseline", b); },
    adminClubRecord:  function (values, note) { return this.post("/admin/club-record", { values: values, note: note }); },
    adminSeasonAdd:   function (s) { return this.post("/admin/seasons", s); },
    adminSeasonPatch: function (id, b) { return this.patch("/admin/seasons/" + id, b); },
    adminSeasonAssignRange: function (id, fromSeq, toSeq) { return this.post("/admin/seasons/" + id + "/assign-range", { fromSeq: fromSeq, toSeq: toSeq }); },
    adminUsers:       function () { return this.get("/admin/users"); },
    adminUserLevel:   function (id, level) { return this.post("/admin/users/" + id + "/level", { level: level }); },
    adminUserBan:     function (id, banned) { return this.post("/admin/users/" + id + "/ban", { banned: !!banned }); },
    adminProfileRole: function (id, b) { return this.patch("/admin/users/" + id + "/profile-role", b); },
    adminTitleAdd:    function (t) { return this.post("/admin/titles", t); },
    adminTitlePatch:  function (id, b) { return this.patch("/admin/titles/" + id, b); },
    adminUserTitleAdd: function (userId, titleId, isPrimary) { return this.post("/admin/users/" + userId + "/titles", { titleId: titleId, isPrimary: !!isPrimary }); },
    adminUserTitleDel: function (userId, titleId) { return this.del("/admin/users/" + userId + "/titles/" + titleId); },
    adminDmReports:   function () { return this.get("/admin/dm-reports"); },
    adminDmReportPatch: function (id, status) { return this.patch("/admin/dm-reports/" + id, { status: status }); }
  };

  function qs(obj) {
    if (!obj) return "";
    var parts = [];
    Object.keys(obj).forEach(function (k) {
      if (obj[k] === undefined || obj[k] === null || obj[k] === "") return;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  window.G = window.G || {};
  window.G.NET = NET;
  window.NET = NET; // convenience alias
})();
