/* Password change/reset + optional TOTP 2FA. */
import app from "../src/index.js";
import { makeEnv, ok, done, post, get } from "./harness.mjs";
import { totpCode } from "../src/lib/totp.js";

const env = makeEnv();
const DB = env.DB;
const H = (t) => ({ Authorization: "Bearer " + t });

const tok = (await post(app, env, "/api/auth/register", { name: "Secure", pass: "secret123" })).json.token;

// ---- change password ----
ok((await post(app, env, "/api/auth/change-password", { current: "wrong", next: "newpass1" }, H(tok))).status === 400, "wrong current password rejected");
ok((await post(app, env, "/api/auth/change-password", { current: "secret123", next: "x" }, H(tok))).json.ok !== true, "too-short new password rejected");
ok((await post(app, env, "/api/auth/change-password", { current: "secret123", next: "newpass1" }, H(tok))).json.ok, "password changed");
ok((await post(app, env, "/api/auth/login", { name: "Secure", pass: "secret123" })).status === 401, "old password no longer works");
ok((await post(app, env, "/api/auth/login", { name: "Secure", pass: "newpass1" })).json.ok, "new password logs in");

// ---- TOTP 2FA ----
const setup = await post(app, env, "/api/auth/2fa/setup", {}, H(tok));
ok(setup.json.ok && setup.json.secret && setup.json.otpauth.indexOf("otpauth://totp/") === 0, "2fa setup returns secret + otpauth uri");
const secret = setup.json.secret;
ok((await post(app, env, "/api/auth/2fa/enable", { code: "000000" }, H(tok))).status === 400, "wrong code can't enable 2fa");
const goodCode = await totpCode(secret);
ok((await post(app, env, "/api/auth/2fa/enable", { code: goodCode }, H(tok))).json.ok, "valid code enables 2fa");
ok((await get(app, env, "/api/auth/2fa/status", H(tok))).json.enabled === true, "2fa reported enabled");

// login now needs a code
ok((await post(app, env, "/api/auth/login", { name: "Secure", pass: "newpass1" })).json.code === "2fa_required", "login without code → 2fa_required");
ok((await post(app, env, "/api/auth/login", { name: "Secure", pass: "newpass1", code: "111111" })).json.code === "2fa_bad", "login with bad code rejected");
const codeNow = await totpCode(secret);
ok((await post(app, env, "/api/auth/login", { name: "Secure", pass: "newpass1", code: codeNow })).json.ok, "login with valid code succeeds");

// disable with a code
const codeDis = await totpCode(secret);
ok((await post(app, env, "/api/auth/2fa/disable", { code: codeDis }, H(tok))).json.ok, "2fa disabled with a valid code");
ok((await post(app, env, "/api/auth/login", { name: "Secure", pass: "newpass1" })).json.ok, "login no longer needs a code once disabled");

// ---- L9 admin password reset ----
const adminTok = (await post(app, env, "/api/auth/register", { name: "Chief", pass: "secret123" })).json.token;
await DB.prepare("UPDATE users SET level=9 WHERE username='chief'").run();
const targetId = (await DB.prepare("SELECT id FROM users WHERE username='secure'").first()).id;
ok((await post(app, env, "/api/admin/users/" + targetId + "/password", { newPassword: "resetpass1" }, H(tok))).status === 403, "L1 cannot reset passwords");
ok((await post(app, env, "/api/admin/users/" + targetId + "/password", { newPassword: "resetpass1" }, H(adminTok))).json.ok, "L9 resets a member's password");
ok((await post(app, env, "/api/auth/login", { name: "Secure", pass: "resetpass1" })).json.ok, "member logs in with the reset password");

done();
