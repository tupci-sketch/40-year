/* Profile/identity/title tests: public profile shape (never leaks private
   fields), privacy toggle, member directory, L9 identity/title admin. */
import app from "../src/index.js";
import { makeEnv, ok, done, post, get, patchReq } from "./harness.mjs";

const env = makeEnv();
const DB = env.DB;
const H = (t) => ({ Authorization: "Bearer " + t });

async function register(name) { return (await post(app, env, "/api/auth/register", { name, pass: "secret123" })).json.token; }
const amyTok = await register("Amy");
const adminTok = await register("Admin9");
await DB.prepare("UPDATE users SET level=9 WHERE username='admin9'").run();

await DB.prepare("INSERT INTO players (id,number,name,controlled_by,is_human,active) VALUES ('amy',8,'Amy Whimsy','human',1,1)").run();

// ---- identity types + titles seeded/public ----
const idt = await get(app, env, "/api/identity-types");
ok(idt.json.identityTypes.some((x) => x.name === "Squad Player"), "identity types seeded + public");

// ---- my profile defaults ----
const mine = await get(app, env, "/api/me/profile", H(amyTok));
ok(mine.json.ok && mine.json.privacy.dm_policy === "established", "default privacy: established");
ok((await get(app, env, "/api/me/profile")).status === 401, "me/profile needs auth");

// ---- set bio ----
const patchBio = await app.request("/api/me/profile", { method: "PATCH", headers: { ...H(amyTok), "Content-Type": "application/json" }, body: JSON.stringify({ bio: "Wears the 8." }) }, env);
ok(patchBio.status === 200, "profile bio patch ok");

// ---- public profile: hides linked player until opted in, no private fields ----
const pub1 = await get(app, env, "/api/profiles/amy");
ok(pub1.json.profile.bio === "Wears the 8." && pub1.json.profile.linkedPlayer === null, "public profile shows bio, hides unlinked player");
ok(!("email" in pub1.json.profile) && !("pw_hash" in pub1.json.profile), "public profile never exposes private fields");

// admin links Amy's account to the 'amy' player + assigns identity
const idSquad = idt.json.identityTypes.find((x) => x.name === "Squad Player").id;
const userId = (await DB.prepare("SELECT id FROM users WHERE username='amy'").first()).id;
ok((await patchReq(app, env, "/api/admin/users/" + userId + "/profile-role", { linkedPlayerId: "amy", identityId: idSquad }, H(amyTok))).status === 403, "L1 cannot self-assign identity");
const link = await patchReq(app, env, "/api/admin/users/" + userId + "/profile-role", { linkedPlayerId: "amy", identityId: idSquad }, H(adminTok));
ok(link.json.ok, "L9 links account to player + sets identity");

// still hidden until the user opts in to show_linked
const pub2 = await get(app, env, "/api/profiles/amy");
ok(pub2.json.profile.linkedPlayer === null && pub2.json.profile.identity.name === "Squad Player", "identity shows, linked player still hidden (not opted in)");

await app.request("/api/me/profile", { method: "PATCH", headers: { ...H(amyTok), "Content-Type": "application/json" }, body: JSON.stringify({ showLinked: true }) }, env);
const pub3 = await get(app, env, "/api/profiles/amy");
ok(pub3.json.profile.linkedPlayer && pub3.json.profile.linkedPlayer.id === "amy", "linked player now shown after opt-in");

// bad link target rejected
ok((await patchReq(app, env, "/api/admin/users/" + userId + "/profile-role", { linkedPlayerId: "ghost" }, H(adminTok))).status === 400, "linking unknown player rejected");

// partial update: sending only the player link must NOT wipe the identity
await patchReq(app, env, "/api/admin/users/" + userId + "/profile-role", { linkedPlayerId: "" }, H(adminTok));
const rowAfterClear = await DB.prepare("SELECT primary_identity_id, linked_player_id FROM user_profiles WHERE user_id=?").bind(userId).first();
ok(rowAfterClear.linked_player_id === null && rowAfterClear.primary_identity_id === idSquad, "partial update: clearing link keeps identity");
await patchReq(app, env, "/api/admin/users/" + userId + "/profile-role", { linkedPlayerId: "amy" }, H(adminTok));
const rowAfterRelink = await DB.prepare("SELECT primary_identity_id, linked_player_id FROM user_profiles WHERE user_id=?").bind(userId).first();
ok(rowAfterRelink.linked_player_id === "amy" && rowAfterRelink.primary_identity_id === idSquad, "partial update: re-linking keeps identity");

// ---- privacy: profile_public off hides the whole profile ----
await app.request("/api/me/privacy", { method: "PATCH", headers: { ...H(amyTok), "Content-Type": "application/json" }, body: JSON.stringify({ profilePublic: false }) }, env);
ok((await get(app, env, "/api/profiles/amy")).status === 403, "private profile hidden from public view");

// re-enable for directory test
await app.request("/api/me/privacy", { method: "PATCH", headers: { ...H(amyTok), "Content-Type": "application/json" }, body: JSON.stringify({ profilePublic: true }) }, env);

// ---- member directory ----
const dir = await get(app, env, "/api/members");
ok(dir.json.members.length === 2, "member directory lists registered users");
const dirFiltered = await get(app, env, "/api/members?identity=Squad Player");
ok(dirFiltered.json.members.length === 1 && dirFiltered.json.members[0].username === "amy", "directory filters by identity");

// ---- titles (L9 CRUD + assignment) ----
const t1 = await post(app, env, "/api/admin/titles", { name: "Archive Keeper", description: "Keeps the archive honest", colorToken: "gold", icon: "📜" }, H(adminTok));
ok(t1.json.ok, "title created");
ok((await post(app, env, "/api/admin/titles", { name: "x" }, H(amyTok))).status === 403, "L1 cannot create titles");
const titlesPublic = await get(app, env, "/api/titles");
ok(titlesPublic.json.titles.some((x) => x.name === "Archive Keeper"), "title visible publicly once active");

const assign = await post(app, env, "/api/admin/users/" + userId + "/titles", { titleId: t1.json.id, isPrimary: true }, H(adminTok));
ok(assign.json.ok, "title assigned to user");
const pub4 = await get(app, env, "/api/profiles/amy");
ok(pub4.json.profile.titles.length === 1 && pub4.json.profile.titles[0].name === "Archive Keeper" && pub4.json.profile.titles[0].is_primary === 1, "profile shows assigned primary title");

// retire the title — should disappear from public listing + profile
await patchReq(app, env, "/api/admin/titles/" + t1.json.id, { active: false }, H(adminTok));
ok((await get(app, env, "/api/titles")).json.titles.length === 0, "retired title removed from public list");
ok((await get(app, env, "/api/profiles/amy")).json.profile.titles.length === 0, "retired title no longer shown on profile");

// unassign
await patchReq(app, env, "/api/admin/titles/" + t1.json.id, { active: true }, H(adminTok)); // reactivate to test unassign cleanly
ok((await app.request("/api/admin/users/" + userId + "/titles/" + t1.json.id, { method: "DELETE", headers: H(adminTok) }, env)).status === 200, "title unassigned");
ok((await get(app, env, "/api/profiles/amy")).json.profile.titles.length === 0, "unassigned title gone from profile");

done();
