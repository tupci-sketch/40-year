/* ============================================================
   Minimal image sniffing — no dependencies (Workers has no native
   image decoding). Confirms the real file type from its magic
   bytes (never trust a client-supplied MIME string) and reads
   width/height where easy. Dimensions are metadata only — a miss
   never blocks an otherwise-valid upload.
   ============================================================ */
export function sniffType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

function dv(b) { return new DataView(b.buffer, b.byteOffset, b.byteLength); }

function pngSize(b) {
  try { const d = dv(b); return { width: d.getUint32(16), height: d.getUint32(20) }; } catch (e) { return {}; }
}

function jpegSize(b) {
  try {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const d = dv(b);
        const height = d.getUint16(i + 5);
        const width = d.getUint16(i + 7);
        return { width, height };
      }
      i += 2 + len;
    }
  } catch (e) { /* fall through */ }
  return {};
}

function webpSize(b) {
  try {
    const d = dv(b);
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fourcc === "VP8 ") { return { width: d.getUint16(26, true) & 0x3fff, height: d.getUint16(28, true) & 0x3fff }; }
    if (fourcc === "VP8L") {
      const bits = d.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (fourcc === "VP8X") { return { width: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, height: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1 }; }
  } catch (e) { /* fall through */ }
  return {};
}

/* Returns { type, width, height } or { type: null } if not a recognised
   image. `type` is the sniffed MIME — use this, never the client's. */
export function sniffImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const type = sniffType(b);
  if (!type) return { type: null };
  const dims = type === "image/png" ? pngSize(b) : type === "image/jpeg" ? jpegSize(b) : webpSize(b);
  return { type, width: dims.width || null, height: dims.height || null };
}
