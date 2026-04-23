// Unified dual-write endpoint for Phase 2. Handles every "also save to the
// cloud" operation the app needs — media, overlays, effects, requests,
// comments, manual players, field overrides, AI usage.
//
// Request shape (POST, JSON):
// {
//   kind:    'media' | 'overlay' | 'effect' | 'request' | 'request-comment'
//          | 'manual-player' | 'field-override' | 'ai-usage',
//   action:  'upsert' | 'delete',
//   record:  { ... },          // for upsert (matches the table shape)
//   blob:    { base64, mime }  // for media/overlay/effect upserts only
//   id:      '...'             // for delete (not needed for composite-PK kinds)
// }
//
// For kinds with binary payloads (media/overlay/effect), we upload the blob
// to the corresponding Storage bucket FIRST, then insert the DB row with
// `storage_path` set. If the DB insert fails afterwards we don't orphan-clean
// in this pass — Phase 3's migration tool handles reconciliation.

import { getServiceClient, missingConfigResponse } from './_supabase.js';

const BLOB_KINDS = new Set(['media', 'overlay', 'effect']);
const BUCKET_FOR = { media: 'media', overlay: 'overlays', effect: 'effects' };
const TABLE_FOR = {
  media: 'media',
  overlay: 'overlays',
  effect: 'effects',
  request: 'requests',
  'request-comment': 'request_comments',
  'manual-player': 'manual_players',
  'field-override': 'field_overrides',
  'ai-usage': 'ai_usage',
};

// Kinds with a composite primary key — delete targets look different.
const COMPOSITE_PK = {
  'field-override': ['template_type', 'platform', 'field_key'],
  'ai-usage': ['day', 'kind'],
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST required' });
    return;
  }

  const sb = getServiceClient();
  if (!sb) return missingConfigResponse(res);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { kind, action, record, blob, id } = body || {};

  const table = TABLE_FOR[kind];
  if (!table) {
    res.status(400).json({ error: `Unknown kind: ${kind}` });
    return;
  }
  if (action !== 'upsert' && action !== 'delete') {
    res.status(400).json({ error: `Unknown action: ${action}` });
    return;
  }

  try {
    // ── DELETE ──────────────────────────────────────────────────────────────
    if (action === 'delete') {
      if (COMPOSITE_PK[kind]) {
        // record/id carries the composite key; require each column.
        const key = record || {};
        let q = sb.from(table).delete();
        for (const col of COMPOSITE_PK[kind]) {
          if (key[col] == null) {
            res.status(400).json({ error: `Composite-PK delete for ${kind} needs ${col}` });
            return;
          }
          q = q.eq(col, key[col]);
        }
        const { error } = await q;
        if (error) throw error;
      } else {
        if (!id) {
          res.status(400).json({ error: 'delete requires id' });
          return;
        }
        // For media/overlay/effect, also delete the storage object.
        if (BLOB_KINDS.has(kind)) {
          const { data: existing } = await sb.from(table).select('storage_path').eq('id', id).maybeSingle();
          if (existing?.storage_path) {
            await sb.storage.from(BUCKET_FOR[kind]).remove([existing.storage_path]);
          }
        }
        const { error } = await sb.from(table).delete().eq('id', id);
        if (error) throw error;
      }
      res.status(200).json({ ok: true });
      return;
    }

    // ── UPSERT ──────────────────────────────────────────────────────────────
    if (!record) {
      res.status(400).json({ error: 'upsert requires record' });
      return;
    }
    const payload = { ...record };

    // Upload blob first if this kind carries one.
    if (BLOB_KINDS.has(kind) && blob?.base64) {
      const bucket = BUCKET_FOR[kind];
      const mime = blob.mime || 'application/octet-stream';
      const ext = extForMime(mime);
      // storage_path pattern: <id>.<ext> — id is stable across stores so this
      // naturally overwrites when the record is updated.
      const storagePath = `${payload.id}.${ext}`;
      const buf = Buffer.from(blob.base64, 'base64');
      const { error: upErr } = await sb.storage
        .from(bucket)
        .upload(storagePath, buf, {
          contentType: mime,
          upsert: true,
        });
      if (upErr) throw upErr;
      payload.storage_path = storagePath;
      payload.mime_type = payload.mime_type || mime;
      payload.size_bytes = payload.size_bytes ?? buf.length;
    }

    // Figure out the onConflict target for upsert. Most tables have id PK;
    // composite-PK tables use their compound key.
    const conflictCols = COMPOSITE_PK[kind]?.join(',') || 'id';

    const { error } = await sb.from(table).upsert(payload, { onConflict: conflictCols });
    if (error) throw error;

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[cloud-sync]', kind, action, err);
    res.status(500).json({ error: 'cloud-sync failed', detail: err.message });
  }
}

function extForMime(mime) {
  if (!mime) return 'bin';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('quicktime')) return 'mov';
  return 'bin';
}

// Vercel serverless body size limit — raise for media uploads.
export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};
