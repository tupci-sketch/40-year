/* ============================================================
   The 40Yr Virgil — site configuration (v3: Cloudflare backend)
   ============================================================
   ONE setting to change environments. Production points at the
   live Worker; switch to a local `wrangler dev` URL or
   http://localhost:8787 for local API development.
   ============================================================ */

window.API_URL = "https://40-year.26z7trnd5z.workers.dev/api";

/* Cloudflare Turnstile public site key — safe to live here in the page.
   The matching SECRET key lives only as a Worker secret. If the site key
   is blank, the bot-check widget is skipped and the site keeps working. */
window.TURNSTILE_SITEKEY = "0x4AAAAAADjpdJp9aDobcinD";
