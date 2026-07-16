/* Local test harness: a D1-shaped mock over node:sqlite, so Worker routes
   can be exercised with Hono's app.request() — no deploy needed. */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));

class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...a) { this.args = a; return this; }
  async first() { const r = this.db.prepare(this.sql).get(...this.args); return r === undefined ? null : r; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() {
    const info = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { last_row_id: Number(info.lastInsertRowid), changes: info.changes } };
  }
}

class D1Mock {
  constructor(db) { this.db = db; }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; }
}

export function makeEnv(extra = {}) {
  const db = new DatabaseSync(":memory:");
  const schema = readFileSync(join(__dir, "..", "schema.sql"), "utf8");
  db.exec(schema);
  return Object.assign({ DB: new D1Mock(db), PEPPER: "test-pepper", ALLOWED_ORIGIN: "https://40yrvirgil.co.uk" }, extra);
}

/* tiny assert */
let pass = 0, fail = 0;
export function ok(cond, msg) { if (cond) pass++; else { fail++; console.log("  ✗ FAIL:", msg); } }
export function done() {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

export async function post(app, env, path, body, headers = {}) {
  const res = await app.request(path, {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, headers),
    body: JSON.stringify(body || {})
  }, env);
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

export async function get(app, env, path, headers = {}) {
  const res = await app.request(path, { method: "GET", headers }, env);
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
