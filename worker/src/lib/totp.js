/* ============================================================
   TOTP (RFC 6238) — authenticator-app 2FA with Web Crypto only.
   Works with Microsoft Authenticator, Google Authenticator, etc.
   No SMS/email gateway required. SHA-1, 6 digits, 30s step.
   ============================================================ */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/* A fresh base32 secret (default 32 chars ≈ 160 bits). */
export function randomBase32(len = 32) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  let s = "";
  for (let i = 0; i < len; i++) s += B32[a[i] % 32];
  return s;
}

function base32Decode(str) {
  str = String(str || "").replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0, value = 0; const out = [];
  for (const ch of str) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

async function hmacSha1(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, msgBytes));
}

function counterBytes(counter) {
  const buf = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) { buf[i] = counter & 0xff; counter = Math.floor(counter / 256); }
  return buf;
}

export async function totpCode(secretB32, forTime = Date.now(), step = 30) {
  const counter = Math.floor(forTime / 1000 / step);
  const h = await hmacSha1(base32Decode(secretB32), counterBytes(counter));
  const offset = h[h.length - 1] & 0x0f;
  const bin = ((h[offset] & 0x7f) << 24) | ((h[offset + 1] & 0xff) << 16) | ((h[offset + 2] & 0xff) << 8) | (h[offset + 3] & 0xff);
  return String(bin % 1000000).padStart(6, "0");
}

/* Verify with a ±`window` step tolerance (clock drift). */
export async function totpVerify(secretB32, code, window = 1) {
  code = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return false;
  const now = Date.now();
  for (let w = -window; w <= window; w++) {
    if ((await totpCode(secretB32, now + w * 30000)) === code) return true;
  }
  return false;
}

export function otpauthURI(secretB32, label, issuer) {
  return "otpauth://totp/" + encodeURIComponent(issuer + ":" + label) +
    "?secret=" + secretB32 + "&issuer=" + encodeURIComponent(issuer) + "&algorithm=SHA1&digits=6&period=30";
}
