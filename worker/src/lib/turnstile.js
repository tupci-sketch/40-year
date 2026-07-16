/* ============================================================
   Cloudflare Turnstile verification.
   If TURNSTILE_SECRET is unset (local dev), the check is skipped
   so the site still works. Enabled automatically in production.
   ============================================================ */
export async function verifyTurnstile(env, token, ip) {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) return true; // dev / not configured → skip
  if (!token) return false;
  try {
    const body = new FormData();
    body.append("secret", secret);
    body.append("response", token);
    if (ip) body.append("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const data = await r.json();
    return !!(data && data.success);
  } catch (e) {
    return false;
  }
}
