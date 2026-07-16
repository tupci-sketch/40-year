/* ============================================================
   The 40Yr Virgil — API Worker (Cloudflare)
   ------------------------------------------------------------
   Replaces the Google Apps Script backend. Bindings (see
   wrangler.toml): DB = D1 database, CARDS = R2 bucket.
   Secrets (dashboard): PEPPER, TURNSTILE_SECRET.
   Var: ALLOWED_ORIGIN.

   This is the skeleton: CORS + health + a DB self-check so the
   whole chain (Pages → Worker → D1) can be proven from a phone.
   The full REST API is added route-by-route on the v3 branch.
   ============================================================ */
import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();

/* Strict CORS: only our site (and localhost for dev) may call authed routes. */
app.use("*", cors({
  origin: (origin, c) => {
    const allowed = [
      c.env.ALLOWED_ORIGIN || "https://40yrvirgil.co.uk",
      "http://localhost:8191",
      "http://localhost:8000"
    ];
    return allowed.includes(origin) ? origin : allowed[0];
  },
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400
}));

/* Friendly root + health check. */
app.get("/", (c) => c.json({ ok: true, service: "virgil-api" }));
app.get("/api/health", (c) => c.json({ ok: true, service: "virgil-api", build: "v3-skeleton-1", ts: new Date().toISOString() }));

/* Proves the D1 binding + schema are live. Returns the row counts of a
   few core tables — a green result here means the whole stack works. */
app.get("/api/db-check", async (c) => {
  try {
    const counts = {};
    for (const t of ["users", "players", "matches", "seasons"]) {
      const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first();
      counts[t] = row ? row.n : 0;
    }
    return c.json({ ok: true, counts });
  } catch (e) {
    return c.json({ ok: false, error: String(e && e.message || e) }, 500);
  }
});

/* Predictable JSON for anything unmatched. */
app.notFound((c) => c.json({ ok: false, error: "not_found", code: 404 }, 404));
app.onError((e, c) => c.json({ ok: false, error: String(e && e.message || e), code: 500 }, 500));

export default app;
