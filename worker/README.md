# virgil-api — Cloudflare Worker (backend v3)

Replaces the Google Apps Script backend for **The 40Yr Virgil**. Deployed by
Cloudflare's GitHub integration (Workers Builds) from this `worker/` folder on
the `v3` branch — no laptop/CLI needed.

## Layout
- `src/index.js` — the Worker (Hono router). Currently: CORS + `/api/health` +
  `/api/db-check`. Full REST API is added route-by-route during the v3 build.
- `schema.sql` — the D1 database schema. Paste into the D1 console once.
- `wrangler.toml` — bindings: `DB` (D1 `virgil`), `CARDS` (R2 `virgil-cards`),
  and the `ALLOWED_ORIGIN` var.

## Secrets (set in the dashboard, never in git)
Worker → Settings → Variables and Secrets:
- `PEPPER` — same value as the old Apps Script Script Property (keeps logins working).
- `TURNSTILE_SECRET` — the Turnstile secret key.

## Verify it's alive
- `GET /api/health` → `{ ok: true, ... }`
- `GET /api/db-check` → row counts (proves D1 binding + schema).
