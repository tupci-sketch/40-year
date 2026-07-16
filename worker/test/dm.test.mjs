/* Private messaging tests: conversation start/reuse, send/fetch + unread,
   privacy policies (any/established/staff/off), blocks, reports, and the
   L9 report-only moderation surface (never a "browse all DMs" screen). */
import app from "../src/index.js";
import { makeEnv, ok, done, post, get, patchReq } from "./harness.mjs";

const env = makeEnv();
const DB = env.DB;
const H = (t) => ({ Authorization: "Bearer " + t });
const del = (path, t) => app.request(path, { method: "DELETE", headers: H(t) }, env);

async function register(name) {
  const r = await post(app, env, "/api/auth/register", { name, pass: "secret123" });
  return { token: r.json.token, username: r.json.username };
}

const alice = await register("Alice");
const bob = await register("Bob");
const admin = await register("Admin9");
await DB.prepare("UPDATE users SET level=9 WHERE username='admin9'").run();
// Backdate Alice + Bob's account creation so the default "established" policy allows them to DM immediately.
await DB.prepare("UPDATE users SET created_iso=? WHERE username IN ('alice','bob')").bind("2020-01-01T00:00:00.000Z").run();

// brand-new account (created "now") should be blocked by the established-only default
const newbie = await register("Newbie");

// ---- auth required ----
ok((await post(app, env, "/api/dm/conversations", { username: "bob" })).status === 401, "start conversation needs auth");

// ---- start conversation (established policy, both aged) ----
const start = await post(app, env, "/api/dm/conversations", { username: "bob" }, H(alice.token));
ok(start.json.ok && start.json.id && start.json.existed === false, "conversation created");
const reuse = await post(app, env, "/api/dm/conversations", { username: "bob" }, H(alice.token));
ok(reuse.json.id === start.json.id && reuse.json.existed === true, "starting again reuses the same 1:1 conversation");
ok((await post(app, env, "/api/dm/conversations", { username: "alice" }, H(alice.token))).status === 400, "cannot DM yourself");
ok((await post(app, env, "/api/dm/conversations", { username: "ghost" }, H(alice.token))).status === 404, "unknown user 404s");

// brand-new account blocked by default "established" policy
const newbieAttempt = await post(app, env, "/api/dm/conversations", { username: "bob" }, H(newbie.token));
ok(newbieAttempt.status === 403 && newbieAttempt.json.code === "not_allowed", "brand-new account blocked by established-only default");

// ---- send + fetch + unread ----
const send1 = await post(app, env, "/api/dm/conversations/" + start.json.id + "/messages", { text: "Up the Virgils" }, H(alice.token));
ok(send1.json.ok && send1.json.id, "message sent");
ok((await post(app, env, "/api/dm/conversations/" + start.json.id + "/messages", { text: "" }, H(alice.token))).status === 400, "empty message rejected");
ok((await post(app, env, "/api/dm/conversations/999/messages", { text: "hi" }, H(alice.token))).status === 404, "posting to unknown conversation 404s");
ok((await post(app, env, "/api/dm/conversations/" + start.json.id + "/messages", { text: "hi" }, H(admin.token))).status === 404, "non-member cannot post (404, not leaked)");

const inboxBob = await get(app, env, "/api/dm/conversations", H(bob.token));
ok(inboxBob.json.conversations.length === 1 && inboxBob.json.conversations[0].unread === 1 && inboxBob.json.conversations[0].preview === "Up the Virgils", "bob's inbox shows unread + preview");

const msgsBob = await get(app, env, "/api/dm/conversations/" + start.json.id + "/messages", H(bob.token));
ok(msgsBob.json.messages.length === 1 && msgsBob.json.messages[0].body === "Up the Virgils", "bob reads the message");

// reading marks it read — unread should drop to 0
const inboxBob2 = await get(app, env, "/api/dm/conversations", H(bob.token));
ok(inboxBob2.json.conversations[0].unread === 0, "reading marks conversation read (unread resets)");

// ---- pagination ----
for (let i = 0; i < 5; i++) await post(app, env, "/api/dm/conversations/" + start.json.id + "/messages", { text: "msg" + i }, H(bob.token));
const page1 = await get(app, env, "/api/dm/conversations/" + start.json.id + "/messages?limit=3", H(alice.token));
ok(page1.json.messages.length === 3 && page1.json.nextCursor, "message pagination returns a cursor");
const page2 = await get(app, env, "/api/dm/conversations/" + start.json.id + "/messages?limit=3&cursor=" + page1.json.nextCursor, H(alice.token));
ok(page2.json.messages.length === 3, "cursor continues (6 total: 1 + 5)");

// ---- blocks ----
const bobId = (await DB.prepare("SELECT id FROM users WHERE username='bob'").first()).id;
const blockRes = await post(app, env, "/api/dm/users/" + bobId + "/block", {}, H(alice.token));
ok(blockRes.json.ok, "alice blocks bob");
ok((await post(app, env, "/api/dm/conversations/" + start.json.id + "/messages", { text: "still here?" }, H(bob.token))).status === 403, "blocked user cannot send");
ok((await post(app, env, "/api/dm/conversations", { username: "alice" }, H(bob.token))).status === 403, "blocked user cannot start a new conversation either");
await del("/api/dm/users/" + bobId + "/block", alice.token);
ok((await post(app, env, "/api/dm/conversations/" + start.json.id + "/messages", { text: "back" }, H(bob.token))).json.ok, "unblock restores messaging");

// ---- privacy policies ----
await patchReq(app, env, "/api/me/privacy", { dmPolicy: "off" }, H(bob.token));
ok((await post(app, env, "/api/dm/conversations", { username: "bob" }, H(alice.token))).status === 403, "dmPolicy=off blocks new conversations to bob");
// existing conversation: sending still goes through canMessage only on conversation START, not on each message,
// so existing threads remain usable — that's an intentional launch-scope simplification.
await patchReq(app, env, "/api/me/privacy", { dmPolicy: "staff" }, H(bob.token));
ok((await post(app, env, "/api/dm/conversations", { username: "bob" }, H(alice.token))).status === 403, "dmPolicy=staff blocks a regular member");
ok((await post(app, env, "/api/dm/conversations", { username: "bob" }, H(admin.token))).json.ok, "dmPolicy=staff allows a mod/admin (L9)");
await patchReq(app, env, "/api/me/privacy", { dmPolicy: "any" }, H(bob.token));
ok((await post(app, env, "/api/dm/conversations", { username: "bob" }, H(newbie.token))).json.ok, "dmPolicy=any allows even a brand-new account");

// ---- report + L9 moderation (report-only surface, not a general DM browser) ----
ok((await get(app, env, "/api/admin/dm-reports")).status === 401, "dm-reports needs auth");
ok((await get(app, env, "/api/admin/dm-reports", H(alice.token))).status === 403, "L1 cannot view dm-reports");
const rep = await post(app, env, "/api/dm/messages/" + send1.json.id + "/report", { reason: "spam" }, H(bob.token));
ok(rep.json.ok, "message reported");
const reportsList = await get(app, env, "/api/admin/dm-reports", H(admin.token));
ok(reportsList.json.reports.length === 1 && reportsList.json.reports[0].body === "Up the Virgils", "L9 sees the reported message content");
const reportId = reportsList.json.reports[0].id;
ok((await patchReq(app, env, "/api/admin/dm-reports/" + reportId, { status: "dismissed" }, H(alice.token))).status === 403, "L1 cannot action a report");
ok((await patchReq(app, env, "/api/admin/dm-reports/" + reportId, { status: "dismissed" }, H(admin.token))).json.ok, "L9 dismisses the report");
ok((await get(app, env, "/api/admin/dm-reports", H(admin.token))).json.reports.length === 0, "dismissed report no longer in the open queue");

// audit trail recorded the L9 view + action
const auditActions = (await DB.prepare("SELECT action FROM audit_log WHERE actor_id=?").bind((await DB.prepare("SELECT id FROM users WHERE username='admin9'").first()).id).all()).results.map((r) => r.action);
ok(auditActions.includes("dm_reports_view") && auditActions.includes("dm_report_action"), "L9 dm-report access is audited");

done();
