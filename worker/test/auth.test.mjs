/* Auth route tests: register → login → session → logout, plus the
   legacy SHA-256 → PBKDF2 transparent upgrade on login. */
import app from "../src/index.js";
import { makeEnv, ok, done, post, get } from "./harness.mjs";
import { sha256Hex } from "../src/lib/crypto.js";

const env = makeEnv();

// ---- register ----
const reg = await post(app, env, "/api/auth/register", { name: "Tester42", pass: "secret123" });
ok(reg.status === 200 && reg.json.ok && reg.json.token, "register ok + token");
ok(reg.json.level === 1 && reg.json.name === "Tester42" && reg.json.username === "tester42", "register returns display + normalised username + level 1");

// duplicate name rejected
const dup = await post(app, env, "/api/auth/register", { name: "tester42", pass: "secret123" });
ok(dup.status === 409 && dup.json.code === "name_taken", "duplicate name rejected");

// bad inputs
ok((await post(app, env, "/api/auth/register", { name: "x", pass: "secret123" })).json.code === "bad_name", "short name rejected");
ok((await post(app, env, "/api/auth/register", { name: "okname", pass: "123" })).json.code === "bad_pass", "short pass rejected");

// ---- session with the register token ----
const sess = await get(app, env, "/api/auth/session", { Authorization: "Bearer " + reg.json.token });
ok(sess.status === 200 && sess.json.ok && sess.json.name === "Tester42", "session resolves from token");
ok((await get(app, env, "/api/auth/session")).status === 401, "no token → 401");
ok((await get(app, env, "/api/auth/session", { Authorization: "Bearer nope" })).status === 401, "bad token → 401");

// ---- login (pbkdf2 path) ----
const login = await post(app, env, "/api/auth/login", { name: "TESTER42", pass: "secret123" });
ok(login.status === 200 && login.json.ok && login.json.token, "login ok (case-insensitive name)");
ok((await post(app, env, "/api/auth/login", { name: "tester42", pass: "wrong" })).status === 401, "wrong password → 401");
ok((await post(app, env, "/api/auth/login", { name: "ghost", pass: "secret123" })).status === 401, "unknown user → 401");

// ---- logout revokes the session ----
const lo = await post(app, env, "/api/auth/logout", {}, { Authorization: "Bearer " + reg.json.token });
ok(lo.json.ok, "logout ok");
ok((await get(app, env, "/api/auth/session", { Authorization: "Bearer " + reg.json.token })).status === 401, "revoked token no longer valid");

// ---- legacy SHA-256 → PBKDF2 upgrade ----
// Insert a user the way the OLD backend did: pw_hash = sha256(salt + pass + pepper).
const salt = "legacysalt";
const legacyHash = await sha256Hex(salt + "oldpass1" + env.PEPPER);
await env.DB.prepare(
  "INSERT INTO users (username, display, level, banned, pw_hash, pw_salt, pw_algo, created_iso, last_iso) VALUES (?,?,?,?,?,?,?,?,?)"
).bind("danwhizzy", "DanWhizzy", 8, 0, legacyHash, salt, "sha256", "2026-01-01", "2026-01-01").run();

const legLogin = await post(app, env, "/api/auth/login", { name: "danwhizzy", pass: "oldpass1" });
ok(legLogin.status === 200 && legLogin.json.ok && legLogin.json.level === 8, "legacy login verifies + keeps level 8");

// the row should now be pbkdf2
const upgraded = await env.DB.prepare("SELECT pw_algo FROM users WHERE username=?").bind("danwhizzy").first();
ok(upgraded.pw_algo === "pbkdf2", "legacy hash upgraded to pbkdf2 on login");

// and the old password still logs in via the new hash
const legLogin2 = await post(app, env, "/api/auth/login", { name: "danwhizzy", pass: "oldpass1" });
ok(legLogin2.status === 200 && legLogin2.json.ok, "re-login works after upgrade");
ok((await post(app, env, "/api/auth/login", { name: "danwhizzy", pass: "oldpass1WRONG" })).status === 401, "wrong pass still rejected after upgrade");

done();
