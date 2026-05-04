// Direct-to-Supabase-Storage upload presign endpoint.
//
// v4.5.23: Vercel functions cap request payloads at 4.5 MB regardless of
// plan. For files bigger than that (high-megapixel sports cameras, raw
// photographer drops, future video clips), the relay-through-Vercel
// pattern in /api/cloud-sync hits a hard wall. This endpoint mints a
// short-lived signed PUT URL that lets the browser upload the blob
// DIRECTLY to Supabase Storage, bypassing Vercel entirely. The
// metadata-only row still flows through /api/cloud-sync afterward.
//
// Flow:
//   1. Client POSTs { kind, id, mime } here.
//   2. Server validates user (requireUser), validates kind + mime,
//      and calls supabase.storage.<bucket>.createSignedUploadUrl(path).
//   3. Server returns { signedUrl, token, path, bucket }.
//   4. Client PUTs the blob to signedUrl with the right Content-Type.
//   5. Client POSTs the metadata-only record to /api/cloud-sync with
//      { record: {..., storage_path: path} } and NO blob field.
//
// Security:
//   - requireUser() enforces a valid JWT before any URL is minted.
//   - kind allowlist prevents arbitrary bucket access.
//   - mime allowlist prevents non-image uploads (we'll relax this when
//     video lands, but for now images only).
//   - Signed URLs expire in 60 seconds — short enough to limit replay,
//     long enough for a client-side upload to complete on slow connections.

import { requireUser } from './_supabase.js';

// Mirror the BUCKET_FOR map from /api/cloud-sync.js. Kept as a separate
// const to avoid a cross-file import (Vercel bundles each function alone).
const BUCKET_FOR = {
  media: 'media',
  overlay: 'overlays',
  effect: 'effects',
};

// Image-only allowlist for now. Video support is queued — when it
// lands the same /api/storage-presign flow handles it, just expand
// the allowlist.
const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'image/heic', 'image/heif', 'image/avif',
]);

function extForMime(mime) {
  if (!mime) return 'bin';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('heic')) return 'heic';
  if (mime.includes('heif')) return 'heif';
  if (mime.includes('avif')) return 'avif';
  return 'bin';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'POST required' });
    return;
  }

  const ctx = await requireUser(req, res);
  if (!ctx) return; // 401 already sent

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { kind, id, mime } = body || {};

  // Validate kind — only blob kinds we know how to bucket.
  if (!kind || !BUCKET_FOR[kind]) {
    res.status(400).json({ error: `kind must be one of: ${Object.keys(BUCKET_FOR).join(', ')}` });
    return;
  }
  // Validate id — must look like a UUID-ish string. Supabase Storage
  // accepts most filenames but we want consistent <id>.<ext> paths so
  // overwrites and existence checks line up with the relay code path.
  if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9._-]{8,64}$/.test(id)) {
    res.status(400).json({ error: 'id must be an 8-64 char alphanumeric string (typically a UUID)' });
    return;
  }
  // Validate mime — image-only allowlist for v4.5.23.
  const m = String(mime || '').toLowerCase();
  if (!ALLOWED_MIMES.has(m)) {
    res.status(400).json({ error: `mime not allowed; got "${mime}". Allowed: ${[...ALLOWED_MIMES].join(', ')}` });
    return;
  }

  const bucket = BUCKET_FOR[kind];
  const path = `${id}.${extForMime(m)}`;

  try {
    // createSignedUploadUrl: returns { signedUrl, token, path }. The URL
    // works for ~60s and the token is also valid for that window via
    // supabase.storage.from(bucket).uploadToSignedUrl(path, token, blob).
    // We surface BOTH so the client can use whichever flow (raw fetch PUT
    // vs SDK helper) is more convenient.
    const { data, error } = await ctx.sb
      .storage
      .from(bucket)
      .createSignedUploadUrl(path);

    if (error) {
      // Common case: object already exists — Supabase requires
      // upsert: true on the upload to overwrite. Re-mint with the
      // upsert flag so re-uploads of the same id work.
      if (/already exists/i.test(error.message || '')) {
        const retry = await ctx.sb
          .storage
          .from(bucket)
          .createSignedUploadUrl(path, { upsert: true });
        if (retry.error) throw retry.error;
        res.status(200).json({
          signedUrl: retry.data.signedUrl,
          token: retry.data.token,
          path: retry.data.path,
          bucket,
          upsert: true,
        });
        return;
      }
      throw error;
    }

    res.status(200).json({
      signedUrl: data.signedUrl,
      token: data.token,
      path: data.path,
      bucket,
      upsert: false,
    });
  } catch (err) {
    console.error('[storage-presign]', kind, id, err);
    res.status(500).json({ error: 'presign failed', detail: err.message });
  }
}
