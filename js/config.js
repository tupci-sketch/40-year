/* ============================================================
   The 40Yr Virgil — site configuration
   ============================================================
   ONE setting lives here. After you deploy your own copy of
   backend.gs as a Google Apps Script Web App (Execute as: Me,
   Access: Anyone), paste the /exec URL between the quotes.

   Example:
   window.APP_URL = "https://script.google.com/macros/s/AKfycb.../exec";

   Until it is set, the site runs in offline mode: identity,
   squad and the tactics board all work; live stats, results,
   accounts and chat show their waiting states.
   ============================================================ */

window.APP_URL = "https://script.google.com/macros/s/AKfycbx0QNSt17VHVlxX-cpSTQZZlwjeYpf5czvlJd8QM1d4GIf4qm2iQsF_KnBpylqeMUrM1Q/exec";

/* Cloudflare Turnstile public site key — safe to live here in the page.
   The matching SECRET key goes in your Apps Script Script Properties as
   TURNSTILE_SECRET. If the secret is unset, the bot check is skipped and
   the site keeps working. Leave this blank to hide the widget entirely. */
window.TURNSTILE_SITEKEY = "0x4AAAAAADjpdJp9aDobcinD";
