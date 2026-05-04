// Auto-compresses images on upload so the league media archive doesn't
// blow through Supabase storage with print-resolution originals when
// every consumer (web, mobile, social posts) only needs ≤1920 px.
//
// What it does:
//   - For images:
//     - Decodes via createImageBitmap (faster than <img> + <canvas>)
//     - Resamples to the smaller of original-size and `maxDimension`
//     - Re-encodes via canvas.toBlob with `quality` (default 0.85)
//     - Picks the lower of original-bytes and re-encoded-bytes (so we
//       never ENLARGE a file that was already smaller than the target)
//     - Returns the original blob untouched if it's already small
//   - For non-images (video/PDF/etc): pass-through, no compression.
//   - For SVG: pass-through (raster compression would lose vectors).
//   - For GIF: pass-through (canvas can't preserve animation).
//
// Caller gets back { blob, width, height, originalBytes, finalBytes,
//   skippedReason } so the UI can show savings and explain pass-throughs.

const DEFAULT_MAX_DIMENSION = 1920;
const DEFAULT_QUALITY = 0.85;
// Bytes below which compression is a waste — encoding overhead can
// actually grow tiny files.
const SKIP_BELOW_BYTES = 200 * 1024; // 200 KB

const PASSTHROUGH_TYPES = new Set([
  'image/svg+xml', // vectors
  'image/gif',     // animation
  'image/x-icon',
]);

function isImage(blob) {
  return blob && typeof blob.type === 'string' && blob.type.startsWith('image/');
}

// Decode → returns { bitmap, width, height }. Falls back to <img> when
// createImageBitmap isn't available (Safari < 15ish).
async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('decode failed'));
      i.src = url;
    });
    return { bitmap: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    // Revoking too early would invalidate the still-referenced <img> in
    // the fallback path. Punt cleanup to a microtask.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

// Choose output mime: keep PNG if the input was PNG (lossless), otherwise
// JPEG. WebP would be smaller but breaks compatibility with older tools
// that consume our exports — JPEG is the safest universal default.
function outputMimeFor(blob) {
  if (blob.type === 'image/png') return 'image/png';
  return 'image/jpeg';
}

export async function compressImageBlob(blob, opts = {}) {
  const {
    maxDimension = DEFAULT_MAX_DIMENSION,
    quality = DEFAULT_QUALITY,
    skipBelow = SKIP_BELOW_BYTES,
  } = opts;

  if (!isImage(blob)) {
    return { blob, width: 0, height: 0, originalBytes: blob?.size || 0, finalBytes: blob?.size || 0, skippedReason: 'not-image' };
  }
  if (PASSTHROUGH_TYPES.has(blob.type)) {
    return { blob, width: 0, height: 0, originalBytes: blob.size, finalBytes: blob.size, skippedReason: blob.type === 'image/gif' ? 'gif-animation' : 'vector' };
  }
  if (blob.size <= skipBelow) {
    // Decode anyway so we can record real dimensions on the record.
    try {
      const { width, height } = await decode(blob);
      return { blob, width, height, originalBytes: blob.size, finalBytes: blob.size, skippedReason: 'already-small' };
    } catch {
      return { blob, width: 0, height: 0, originalBytes: blob.size, finalBytes: blob.size, skippedReason: 'already-small' };
    }
  }

  let bitmap, width, height;
  try {
    ({ bitmap, width, height } = await decode(blob));
  } catch {
    // Decode failure (corrupt header, format we can't parse) — return
    // the original so upload still succeeds.
    return { blob, width: 0, height: 0, originalBytes: blob.size, finalBytes: blob.size, skippedReason: 'decode-failed' };
  }

  const longest = Math.max(width, height);
  const scale = longest > maxDimension ? maxDimension / longest : 1;
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  // Use OffscreenCanvas if available — keeps the main thread idle for
  // large bulk imports. Fall back to a regular canvas otherwise.
  let canvas, ctx;
  if (typeof OffscreenCanvas === 'function') {
    canvas = new OffscreenCanvas(targetW, targetH);
    ctx = canvas.getContext('2d');
  } else {
    canvas = document.createElement('canvas');
    canvas.width = targetW; canvas.height = targetH;
    ctx = canvas.getContext('2d');
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  if (bitmap.close) bitmap.close(); // release ImageBitmap

  const mime = outputMimeFor(blob);
  let encoded;
  if (typeof canvas.convertToBlob === 'function') {
    encoded = await canvas.convertToBlob({ type: mime, quality });
  } else {
    encoded = await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode failed')), mime, quality);
    });
  }

  // Never enlarge: if re-encoding made the file bigger (rare, but
  // happens when the original was already aggressively compressed),
  // keep the original.
  if (encoded.size >= blob.size) {
    return { blob, width: targetW, height: targetH, originalBytes: blob.size, finalBytes: blob.size, skippedReason: 'no-savings' };
  }

  return {
    blob: encoded,
    width: targetW,
    height: targetH,
    originalBytes: blob.size,
    finalBytes: encoded.size,
    skippedReason: null,
  };
}

// Compress a list of files in parallel, capping concurrency so the
// browser doesn't choke on a 200-file folder import. Returns the same
// shape as compressImageBlob, one per input.
export async function compressMany(files, opts = {}) {
  const { concurrency = 4, ...rest } = opts;
  const out = new Array(files.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= files.length) return;
      try {
        out[i] = await compressImageBlob(files[i], rest);
      } catch (e) {
        out[i] = { blob: files[i], width: 0, height: 0, originalBytes: files[i].size, finalBytes: files[i].size, skippedReason: 'error', error: String(e) };
      }
      if (opts.onProgress) opts.onProgress({ done: cursor, total: files.length });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return out;
}

// User preference: gate compression behind a localStorage flag so
// archivists can stash originals when they want. Default ON.
const PREF_KEY = 'blw.upload.compress';
export function getCompressPreference() {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw == null) return true; // default ON
    return raw === '1';
  } catch {
    return true;
  }
}
export function setCompressPreference(on) {
  try { localStorage.setItem(PREF_KEY, on ? '1' : '0'); } catch {}
}

// Vercel functions cap request payloads at 4.5 MB regardless of plan.
// Base64 encoding inflates by ~33%, so the binary blob has to come in
// under ~3.3 MB to fit safely. v4.5.22: this helper re-compresses an
// already-uploaded blob more aggressively until it fits, so files that
// passed the 1920 px / 0.85 quality first pass but still exceeded the
// limit (typical of high-megapixel sports cameras) don't 413 the
// backup runner. Returns the original blob if no compression is
// needed, or an aggressively re-encoded blob that fits.
//
// Strategy: try progressively smaller dimensions and lower quality
// until we cross under the threshold. Each pass is independent — we
// always start from the source blob, never from a previously
// re-encoded one (re-encoding a JPEG twice degrades quickly).
const VERCEL_PAYLOAD_LIMIT = 4 * 1024 * 1024; // 4 MB binary, leaves room for base64 + JSON wrapper
const FIT_PASSES = [
  { maxDimension: 1600, quality: 0.82 },
  { maxDimension: 1280, quality: 0.78 },
  { maxDimension: 1080, quality: 0.72 },
  { maxDimension: 800,  quality: 0.65 },
];

export async function compressToFitUploadLimit(blob, opts = {}) {
  const { limit = VERCEL_PAYLOAD_LIMIT } = opts;
  if (!blob) return { blob, width: 0, height: 0, fitted: true, attempts: 0 };
  // Already small enough — pass through. Saves a decode for the 95% case.
  if (blob.size <= limit) {
    return { blob, width: 0, height: 0, fitted: true, attempts: 0 };
  }
  // Non-image (video, PDF) — we can't compress here, the caller has to
  // chunk-upload or skip. Surface that explicitly.
  if (!isImage(blob) || PASSTHROUGH_TYPES.has(blob.type)) {
    return { blob, width: 0, height: 0, fitted: false, attempts: 0, reason: 'cannot-compress' };
  }
  // Try each progressively-smaller pass until something fits.
  let lastResult = null;
  for (let i = 0; i < FIT_PASSES.length; i++) {
    const pass = FIT_PASSES[i];
    try {
      const r = await compressImageBlob(blob, pass);
      lastResult = r;
      if (r.blob.size <= limit) {
        return { blob: r.blob, width: r.width, height: r.height, fitted: true, attempts: i + 1 };
      }
    } catch {
      // Next pass.
    }
  }
  // Couldn't get under the limit even at 800px / q=0.65 — return the
  // smallest version we managed and let the caller surface the failure.
  return {
    blob: lastResult?.blob || blob,
    width: lastResult?.width || 0,
    height: lastResult?.height || 0,
    fitted: false,
    attempts: FIT_PASSES.length,
    reason: 'too-large-after-recompress',
  };
}

// Format helper for UI — "1.8 MB → 412 KB (76% smaller)"
export function formatSavings({ originalBytes, finalBytes }) {
  const fmt = (n) => n < 1024 ? `${n} B`
    : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB`
    : `${(n / (1024 ** 2)).toFixed(2)} MB`;
  if (originalBytes === finalBytes) return fmt(originalBytes);
  const pct = Math.max(0, Math.round((1 - finalBytes / originalBytes) * 100));
  return `${fmt(originalBytes)} → ${fmt(finalBytes)} (${pct}% smaller)`;
}
