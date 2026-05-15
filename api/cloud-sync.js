// Unified dual-write endpoint for Phase 2. Handles every "also save to the
// cloud" operation the app needs — media, overlays, effects, requests,
// comments, manual players, field overrides, AI usage.
//
// SCHEMA NOTE — `generate_log.posted` (added v4.2.0):
//   The team-page "posted?" toggle requires a boolean column. Run this
//   one-time SQL in Supabase before relying on the toggle:
//     ALTER TABLE generate_log
//       ADD COLUMN IF NOT EXISTS posted BOOLEAN NOT NULL DEFAULT TRUE;
//   Without it, the PATCH endpoint will 500 on update and the team
//   carousel will treat every post as "posted" (the default the UI
//   assumes when the field is absent).
//
// SCHEMA NOTE — `requests` makeover (added v4.4.0):
//   The new request types (content / bug / profile-update / template /
//   feature / integration), athlete role-gating, and email
//   notifications need extra columns. Run this once in Supabase:
//     ALTER TABLE requests
//       ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'content',
//       ADD COLUMN IF NOT EXISTS title TEXT,
//       ADD COLUMN IF NOT EXISTS need_by DATE,
//       ADD COLUMN IF NOT EXISTS requester_email TEXT,
//       ADD COLUMN IF NOT EXISTS requester_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
//       ADD COLUMN IF NOT EXISTS player_last_name TEXT,
//       ADD COLUMN IF NOT EXISTS player_first_initial TEXT,
//       ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
//     CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(requester_user_id);
//     CREATE INDEX IF NOT EXISTS idx_requests_type ON requests(type);
//   Without it, request upserts containing the new fields will 400 on
//   the unknown columns. The UI assumes default 'content' type for old
//   rows so existing requests continue to render.
//
// SCHEMA NOTE — `manual_players.athlete_voice` (added v4.4.0):
//   Athletes can now self-author a free-form "About me" block that
//   feeds the AI ideas prompt. Stored as JSON for flexibility:
//     ALTER TABLE manual_players
//       ADD COLUMN IF NOT EXISTS athlete_voice JSONB DEFAULT '{}'::jsonb;
//
// SCHEMA NOTE — `manual_players.user_id` (added v4.4.1):
//   Strict 1:1 link between a player record and an athlete's profile,
//   so an athlete can ONLY edit their own About-me block (not every
//   teammate on their roster). Master admin owns the linkage from the
//   AthleteVoiceCard's "Linked to" picker. NULL means "no athlete
//   account is bound to this player yet."
//     ALTER TABLE manual_players
//       ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
//     CREATE INDEX IF NOT EXISTS idx_manual_players_user
//       ON manual_players(user_id);
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

import { getServiceClient, missingConfigResponse, requireUser } from './_supabase.js';

// Phase 5c: kinds that athletes are allowed to write, keyed by the column
// that stores the team abbreviation. If a kind isn't listed, athletes can't
// create/update it at all. Admins/content/master_admin can write anything.
// v4.7.10: 'manual-player' added — athletes can upsert their OWN
// player record (nickname, vitals, jersey, position, voice). The
// "OWN" gate is enforced below as an extra check on user_id alongside
// the team check, so an athlete can\'t patch a teammate\'s row even
// though both share their team_id.
const ATHLETE_WRITABLE = {
  'media':          'team',
  'request':        'team',
  'generate-log':   'team',
  'manual-player':  'team',
};
// Kinds athletes are allowed to DELETE. Athletes can only delete their own
// generate-log records (their own generation history). They cannot delete
// media, overlays, requests, etc.
const ATHLETE_DELETABLE = new Set(['generate-log']);

const BLOB_KINDS = new Set(['media', 'overlay', 'effect', 'generate-log']);
const BUCKET_FOR = {
  media: 'media', overlay: 'overlays', effect: 'effects',
  // generate-log uploads a small thumbnail PNG into its own bucket.
  'generate-log': 'generate-thumbs',
};
// generate-log stores its blob path in a different column than the other
// blob kinds — standard kinds use `storage_path`, generate-log uses
// `thumbnail_storage_path`. This map lets the upsert path pick the right one.
const STORAGE_PATH_COL = {
  media: 'storage_path', overlay: 'storage_path', effect: 'storage_path',
  'generate-log': 'thumbnail_storage_path',
};
const TABLE_FOR = {
  media: 'media',
  overlay: 'overlays',
  effect: 'effects',
  request: 'requests',
  'request-comment': 'request_comments',
  'manual-player': 'manual_players',
  'field-override': 'field_overrides',
  'ai-usage': 'ai_usage',
  'generate-log': 'generate_log',
};

// Kinds with a composite primary key — delete targets look different.
const COMPOSITE_PK = {
  'field-override': ['template_type', 'platform', 'field_key'],
  'ai-usage': ['day', 'kind'],
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Phase 5c: every cloud-sync call now requires a valid user session.
  // requireUser() returns null after writing a 401 if the token is missing
  // or invalid — so we just bail if it returned null.
  const ctx = await requireUser(req, res);
  if (!ctx) return;
  const { user, profile, sb } = ctx;
  const userRole = profile?.role || null;
  const userTeamId = profile?.team_id || null;
  const isAthlete = userRole === 'athlete';

  // ── GET: list records of a kind ─────────────────────────────────────────
  // Called by src/cloud-reader.js on app mount to hydrate the IndexedDB /
  // localStorage cache from whatever's in Supabase. For kinds with a blob
  // (media/overlay/effect) we include a short-lived signed URL so the
  // browser can download the binary without needing the service_role key.
  if (req.method === 'GET') {
    const kind = req.query.kind;
    const table = TABLE_FOR[kind];
    if (!table) {
      res.status(400).json({ error: `Unknown kind: ${kind}` });
      return;
    }
    try {
      // ?fields=id,storage_path — a lightweight projection used by the
      // backup runner to figure out which IDs are already fully uploaded.
      // Skips signed-URL generation entirely so a 10k-row library can be
      // checked in one fast query instead of N storage signing calls.
      const fieldsParam = (req.query.fields || '').trim();
      if (fieldsParam) {
        const allowed = new Set(['id', 'storage_path', 'thumbnail_storage_path']);
        const cols = fieldsParam.split(',').map(s => s.trim()).filter(c => allowed.has(c));
        if (cols.length === 0) {
          res.status(400).json({ error: 'fields must be one of: id, storage_path, thumbnail_storage_path' });
          return;
        }
        const { data, error } = await sb.from(table).select(cols.join(','));
        if (error) throw error;
        res.status(200).json({ records: data || [] });
        return;
      }

      // Generate-log reads default to newest-first, limited to 100 so the
      // dashboard doesn't over-fetch; extend via ?limit= if a caller needs
      // the full history.
      let q = sb.from(table).select('*');

      // Athletes only see their OWN requests. Server-side filter so a
      // crafted client can't bypass it. Staff (master/admin/content)
      // sees everything. We compare on requester_user_id when set,
      // and (legacy fallback) on requester_email so older rows authored
      // before the column existed still surface for the original sender.
      if (kind === 'request' && isAthlete) {
        q = q.or(
          `requester_user_id.eq.${user.id}` +
          (user.email ? `,requester_email.eq.${user.email}` : '')
        );
      }

      if (kind === 'generate-log') {
        // Optional team + since + posted filters drive the team-page
        // monthly progress bar + carousel without needing a separate
        // endpoint. All ignored when absent so existing dashboard /
        // settings reads behave the same as before.
        const teamFilter = (req.query.team || '').trim();
        const sinceParam = (req.query.since || '').trim();
        const postedParam = (req.query.posted || '').trim();
        // v4.5.37: includeHidden=1 lets master admin's history surface
        // see posts they previously hid. Default OFF — every public
        // surface (dashboard, team page carousel) calls without the
        // flag and gets a clean feed.
        const includeHidden = ['1', 'true'].includes((req.query.includeHidden || '').trim());
        // Lightweight projection — when the caller only needs counts
        // (the team progress bar) they pass `fields=id,team,created_at`
        // so the server skips the full record + signed-URL generation.
        const fieldsParam = (req.query.fields || '').trim();
        if (fieldsParam) {
          const allowed = new Set(['id', 'team', 'template_type', 'platform', 'created_at', 'posted', 'hidden', 'settings']);
          const cols = fieldsParam.split(',').map(s => s.trim()).filter(c => allowed.has(c));
          if (cols.length > 0) q = sb.from(table).select(cols.join(','));
        }
        if (teamFilter) q = q.eq('team', teamFilter);
        if (sinceParam) {
          const sinceDate = new Date(sinceParam);
          if (!isNaN(sinceDate.getTime())) q = q.gte('created_at', sinceDate.toISOString());
        }
        if (postedParam === 'true' || postedParam === '1') q = q.eq('posted', true);
        if (postedParam === 'false' || postedParam === '0') q = q.eq('posted', false);
        if (!includeHidden) q = q.or('hidden.is.null,hidden.eq.false');
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
        q = q.order('created_at', { ascending: false }).limit(limit);
      }
      let { data, error } = await q;
      // v4.5.37: tolerant to the `hidden` column not existing yet on
      // pre-db/011 schemas. Retry once without the hidden filter so
      // the read still works for owners who haven't run the migration.
      if (error && /column\s+(generate_log\.)?hidden/i.test(String(error.message || ''))) {
        // Build a fresh query without the hidden filter.
        let q2 = sb.from(table).select('*');
        if (kind === 'generate-log') {
          const teamFilter = (req.query.team || '').trim();
          const sinceParam = (req.query.since || '').trim();
          const postedParam = (req.query.posted || '').trim();
          const fieldsParam = (req.query.fields || '').trim();
          if (fieldsParam) {
            const allowed = new Set(['id', 'team', 'template_type', 'platform', 'created_at', 'posted', 'settings']);
            const cols = fieldsParam.split(',').map(s => s.trim()).filter(c => allowed.has(c));
            if (cols.length > 0) q2 = sb.from(table).select(cols.join(','));
          }
          if (teamFilter) q2 = q2.eq('team', teamFilter);
          if (sinceParam) {
            const sinceDate = new Date(sinceParam);
            if (!isNaN(sinceDate.getTime())) q2 = q2.gte('created_at', sinceDate.toISOString());
          }
          if (postedParam === 'true' || postedParam === '1') q2 = q2.eq('posted', true);
          if (postedParam === 'false' || postedParam === '0') q2 = q2.eq('posted', false);
          const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
          q2 = q2.order('created_at', { ascending: false }).limit(limit);
        }
        const r2 = await q2;
        data = r2.data;
        error = r2.error;
      }
      if (error) throw error;
      let records = data || [];

      // Skip signed-URL generation when the caller asked for a
      // light projection (fields=...) — they don't need the blob
      // and signing 100s of URLs slows the count query.
      const skipSign = !!(req.query.fields || '').trim();
      if (BLOB_KINDS.has(kind) && !skipSign) {
        const bucket = BUCKET_FOR[kind];
        const pathCol = STORAGE_PATH_COL[kind] || 'storage_path';
        const paths = records.map(r => r[pathCol]).filter(Boolean);
        if (paths.length > 0) {
          const { data: signed, error: signErr } = await sb
            .storage.from(bucket)
            .createSignedUrls(paths, 60 * 60);
          if (signErr) throw signErr;
          const byPath = new Map((signed || []).map(s => [s.path, s.signedUrl]));
          records = records.map(r => ({ ...r, signedUrl: byPath.get(r[pathCol]) || null }));
        }
      }

      res.status(200).json({ records });
      return;
    } catch (err) {
      console.error('[cloud-sync GET]', kind, err);
      res.status(500).json({ error: 'cloud read failed', detail: err.message });
      return;
    }
  }

  // ── PATCH: partial update of a single record ────────────────────────────
  // Used by the team-page "posted?" toggle on generate_log entries
  // and any future surgical metadata flips. Body: { kind, id, fields }.
  // Cheaper than re-upserting the whole record (no thumbnail re-upload,
  // no risk of accidentally clobbering server-managed columns like
  // created_at).
  //
  // Field allow-list per kind keeps this surface tight — callers can
  // only flip pre-approved columns. Athletes are blocked from
  // patching anything; staff (master/admin/content) can patch any
  // allowed field.
  if (req.method === 'PATCH') {
    if (isAthlete) {
      res.status(403).json({ error: 'Athletes cannot patch records' });
      return;
    }
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const { kind: pKind, id, fields } = body || {};
    const pTable = TABLE_FOR[pKind];
    if (!pTable) {
      res.status(400).json({ error: `Unknown kind: ${pKind}` });
      return;
    }
    if (!id) {
      res.status(400).json({ error: 'patch requires id' });
      return;
    }
    if (!fields || typeof fields !== 'object') {
      res.status(400).json({ error: 'patch requires fields object' });
      return;
    }
    const PATCHABLE = {
      // v4.5.37: `hidden` joins `posted`. Setting hidden=true removes the
      // post from the dashboard recent strip + every team/player page
      // grid. Tolerant of the column not yet existing on older
      // databases — see the catch block below for the fallback.
      'generate-log': new Set(['posted', 'hidden']),
      // Staff (master/admin/content) can patch a request's status,
      // priority, and the notified_at timestamp from the "Notify
      // requester" button. Athletes are blocked from PATCH entirely
      // by the early-return above.
      'request': new Set(['status', 'priority', 'notified_at']),
    };
    const allowed = PATCHABLE[pKind];
    if (!allowed) {
      res.status(403).json({ error: `Kind '${pKind}' is not patchable` });
      return;
    }
    const payload = {};
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.has(k)) payload[k] = v;
    }
    if (Object.keys(payload).length === 0) {
      res.status(400).json({ error: 'no patchable fields supplied' });
      return;
    }
    try {
      // v4.5.37: tolerant patch — strip columns the live schema doesn't
      // know about (e.g. `hidden` before db/011 has been applied) and
      // retry. Mirrors the upsert tolerance pattern used elsewhere in
      // this file. Caps at 4 retries so a malformed payload can't
      // hot-loop.
      //
      // v4.5.40: If the only requested patch column doesn't exist
      // (e.g. the user clicked "hide post" but the db/011 migration
      // was never applied), DON'T fall through to the generic 500 —
      // return a 412 Precondition Failed with a clear message naming
      // the missing column + migration file. The client maps this to
      // a help-text toast so the master admin sees exactly what to
      // run instead of "server rejected the change."
      let attempt = { ...payload };
      let lastErr = null;
      const stripped = [];
      for (let i = 0; i < 4; i++) {
        const { error } = await sb.from(pTable).update(attempt).eq('id', id);
        if (!error) {
          res.status(200).json({
            ok: true,
            patched: attempt,
            ...(stripped.length ? { strippedColumns: stripped } : {}),
          });
          return;
        }
        lastErr = error;
        const m = String(error.message || '').match(/Could not find the '([^']+)' column/i)
          || String(error.message || '').match(/column "([^"]+)" of relation/i);
        if (!m) break;
        const col = m[1];
        if (!(col in attempt)) break;
        stripped.push(col);
        delete attempt[col];
        if (Object.keys(attempt).length === 0) {
          // Every requested column is missing from the live schema.
          // Tell the user which migration to run rather than 500'ing.
          const MIGRATIONS_FOR_COLUMN = {
            hidden: 'db/011_generate_log_hidden.sql',
          };
          const guidance = stripped
            .map(c => MIGRATIONS_FOR_COLUMN[c]
              ? `${c} → run ${MIGRATIONS_FOR_COLUMN[c]} in the Supabase SQL editor`
              : `${c} → column missing on the live schema`)
            .join('; ');
          res.status(412).json({
            error: 'Schema migration required',
            detail: guidance || `Columns missing: ${stripped.join(', ')}`,
            missingColumns: stripped,
          });
          return;
        }
      }
      throw lastErr || new Error('patch failed');
    } catch (err) {
      console.error('[cloud-sync PATCH]', pKind, id, err);
      res.status(500).json({ error: 'patch failed', detail: err.message });
    }
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST, PATCH, or GET' });
    return;
  }

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

  // ── Role gating on writes ────────────────────────────────────────────────
  // Athletes are restricted — they can only write a small subset of kinds,
  // and only for records pinned to their team. Admins/content bypass this.
  if (isAthlete) {
    if (action === 'delete' && !ATHLETE_DELETABLE.has(kind)) {
      res.status(403).json({ error: `Athletes cannot delete ${kind} records` });
      return;
    }
    if (action === 'upsert') {
      const teamCol = ATHLETE_WRITABLE[kind];
      if (!teamCol) {
        res.status(403).json({ error: `Athletes cannot write ${kind} records` });
        return;
      }
      const recordTeam = record?.[teamCol];
      if (!userTeamId) {
        res.status(403).json({ error: 'Your profile has no team assigned — ask an admin.' });
        return;
      }
      if (recordTeam && recordTeam !== userTeamId) {
        res.status(403).json({ error: `Athletes can only write records for team ${userTeamId} (got ${recordTeam})` });
        return;
      }
      // v4.7.10: extra athlete guard for manual-player upserts. The
      // team check above lets them write any row on their team, but
      // a player record carries personal data — an athlete should
      // only be able to patch their OWN row (user_id === auth.uid()
      // or the unset case for a brand-new row they\'re claiming).
      // Server-side enforcement: fetch the target row by (team, last,
      // first/num) and require its user_id be NULL or === auth.uid().
      if (kind === 'manual-player') {
        const rec = record || {};
        const t = rec.team || rec.team_id;
        const ln = rec.lastName || rec.last_name;
        if (!t || !ln) {
          res.status(400).json({ error: 'Athlete manual-player upsert needs team + lastName' });
          return;
        }
        // Find candidate rows on this team with this lastname.
        let q = sb.from('manual_players').select('id, user_id, first_name, num').eq('team', t).ilike('last_name', ln);
        const { data: candidates, error: lookupErr } = await q;
        if (lookupErr) {
          res.status(500).json({ error: 'manual-player lookup failed', detail: lookupErr.message });
          return;
        }
        // Narrow by firstName / num where supplied so cousin pairs work.
        const fn = rec.firstName || rec.first_name;
        const num = rec.num != null ? String(rec.num) : null;
        const narrowed = (candidates || []).filter(c => {
          if (fn && c.first_name && String(c.first_name).toLowerCase() !== String(fn).toLowerCase()) return false;
          if (num && c.num != null && String(c.num) !== num) return false;
          return true;
        });
        const match = narrowed[0] || null;
        if (match && match.user_id && match.user_id !== user.id) {
          res.status(403).json({
            error: 'Athletes can only edit their own player record',
            detail: `Target row is owned by user ${match.user_id.slice(0, 8)}…, you are ${user.id.slice(0, 8)}…`,
          });
          return;
        }
        // If the row exists with user_id === null we allow the write and
        // also stamp user_id := auth.uid() so future writes are gated by
        // the ownership check.
        if (match && !match.user_id) {
          record.user_id = user.id;
        }
      }
    }
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

    // Stamp owner_id from the validated JWT so the client can't spoof it.
    // Tables without an owner_id column (field_overrides, ai_usage) will
    // silently ignore the extra field via Postgres strict-column behavior —
    // so we only set it where we know the column exists.
    const HAS_OWNER = new Set(['media', 'overlay', 'effect', 'request', 'request-comment', 'manual-player', 'generate-log']);
    if (HAS_OWNER.has(kind)) {
      payload.owner_id = user.id;
    }

    // Requests: ALWAYS overwrite requester_user_id + requester_email
    // for athletes (so they can't impersonate someone else's request).
    // For staff, fall back to the JWT identity when the client didn't
    // explicitly set it — avoids null email columns on master-created
    // requests AND keeps the "notify requester" mailto working from a
    // sensible default.
    if (kind === 'request') {
      if (isAthlete) {
        payload.requester_user_id = user.id;
        payload.requester_email = user.email || payload.requester_email || null;
      } else {
        payload.requester_user_id = payload.requester_user_id || user.id;
        payload.requester_email = payload.requester_email || user.email || null;
      }
    }

    // Upload blob first if this kind carries one.
    // v4.5.23: caller can ALSO supply storage_path directly when the
    // browser already PUT the blob to a presigned URL via
    // /api/storage-presign. In that case we skip the relay upload and
    // just stamp the path into the metadata row. Detect by checking
    // for an inline storage_path (or thumbnail_storage_path for
    // generate-log) on the record itself.
    const pathColForKind = STORAGE_PATH_COL[kind] || 'storage_path';
    const callerSuppliedPath = payload[pathColForKind] || record[pathColForKind];
    if (BLOB_KINDS.has(kind) && callerSuppliedPath && !blob?.base64) {
      // Direct-upload path — blob already in storage. Just keep the
      // path intact on the payload (it's already there from spread).
      payload[pathColForKind] = callerSuppliedPath;
      if (kind === 'media') {
        // Mime/size — caller can supply via the record; otherwise leave null.
        if (record.mime_type) payload.mime_type = record.mime_type;
        if (record.size_bytes != null) payload.size_bytes = record.size_bytes;
      }
    } else if (BLOB_KINDS.has(kind) && blob?.base64) {
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
      const pathCol = STORAGE_PATH_COL[kind] || 'storage_path';
      payload[pathCol] = storagePath;
      // v4.5.22: Only the `media` table is guaranteed to have mime_type +
      // size_bytes columns. The `overlays` and `effects` tables were
      // never migrated to add them, and the read path doesn't use them
      // either — so injecting was a no-op that broke writes. The
      // tolerant-upsert retry below will catch this either way, but
      // skipping the injection avoids a wasted round-trip per blob.
      if (kind === 'media') {
        payload.mime_type = payload.mime_type || mime;
        payload.size_bytes = payload.size_bytes ?? buf.length;
      }
    }

    // Figure out the onConflict target for upsert. Most tables have id PK;
    // composite-PK tables use their compound key.
    const conflictCols = COMPOSITE_PK[kind]?.join(',') || 'id';

    // v4.5.22: tolerant upsert. Postgrest rejects upserts when ANY key
    // in the payload references a column that doesn't exist in the
    // schema cache (e.g. `overlays.mime_type` or
    // `manual_players.profile_media_id` on databases that haven't run
    // the latest migration). Without recovery, one missing column
    // bricks the entire backup for that kind.
    //
    // Strategy: try the full payload first. If Postgrest comes back
    // with PGRST204 / PGRST116 ("Could not find the X column"), strip
    // the offending column and retry — up to 6 unknown columns. This
    // mirrors the v4.5.8 fix for `profiles.role_expires_at` on the
    // _supabase.js side. The end result is the row lands with whatever
    // columns the cloud DOES support, and a console warning surfaces
    // every dropped key so the operator knows which migration to run.
    let { error } = await sb.from(table).upsert(payload, { onConflict: conflictCols });
    let attempts = 0;
    const droppedCols = [];
    while (error && attempts < 6) {
      const msg = error.message || '';
      const m = /Could not find the '([^']+)' column/i.exec(msg);
      if (!m) break;
      const badCol = m[1];
      if (!(badCol in payload)) break;
      delete payload[badCol];
      droppedCols.push(badCol);
      attempts++;
      ({ error } = await sb.from(table).upsert(payload, { onConflict: conflictCols }));
    }
    if (error) throw error;
    if (droppedCols.length) {
      console.warn(`[cloud-sync] ${kind} ${payload.id || ''}: dropped unknown columns`, droppedCols);
    }

    res.status(200).json({ ok: true, droppedColumns: droppedCols.length ? droppedCols : undefined });
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
