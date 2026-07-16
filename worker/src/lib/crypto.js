/* ============================================================
   Crypto helpers — Web Crypto (runs in Workers AND Node 22).
   Passwords: legacy scheme was SHA-256 hex of (salt + pass + pepper).
   New scheme: PBKDF2-SHA256 of (pass + pepper) with a per-user salt.
   Sessions: opaque random token; only its SHA-256 is stored.
   ============================================================ */
const enc = new TextEncoder();
const PBKDF2_ITER = 100000;

export function toHex(buf) {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

export function randomHex(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return toHex(a.buffer);
}

export async function sha256Hex(str) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(String(str)));
  return toHex(d);
}

export async function pbkdf2Hex(pass, salt, iterations = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(pass)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(String(salt)), iterations, hash: "SHA-256" },
    key, 256
  );
  return toHex(bits);
}

/* Constant-time-ish hex compare (lengths are fixed, so fine). */
export function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Make a new PBKDF2 password record. */
export async function makePassword(pass, pepper) {
  const salt = randomHex(16);
  const hash = await pbkdf2Hex(String(pass) + String(pepper || ""), salt);
  return { pw_hash: hash, pw_salt: salt, pw_algo: "pbkdf2" };
}

/* Verify a password against a user row. Returns { ok, needsUpgrade }.
   Legacy 'sha256' rows verify against the old scheme and are flagged for
   transparent upgrade to PBKDF2 on the next successful login. */
export async function verifyPassword(user, pass, pepper) {
  const algo = String(user.pw_algo || "sha256");
  if (algo === "pbkdf2") {
    const h = await pbkdf2Hex(String(pass) + String(pepper || ""), user.pw_salt);
    return { ok: safeEqual(h, user.pw_hash), needsUpgrade: false };
  }
  // legacy: sha_(salt + pass + pepper)
  const h = await sha256Hex(String(user.pw_salt) + String(pass) + String(pepper || ""));
  return { ok: safeEqual(h, user.pw_hash), needsUpgrade: true };
}
