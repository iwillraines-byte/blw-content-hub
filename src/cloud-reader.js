// Phase 4 — "Cloud is the source of truth" via a read-through cache.
//
// Strategy: on app mount, pull every kind from Supabase and upsert into the
// local store (IndexedDB for blobs, localStorage for scalars). Existing read
// paths continue unchanged — they still read from IDB/localStorage. The
// cloud hydrate runs once per session by default and can be re-triggered via
// `refreshFromCloud({ force: true })`.
//
// Blobs: for media/overlay/effect the GET response includes signed URLs;
// we fetch those to Blob, then IDB-put them. If the local blob already has
// the same id, we skip re-downloading to save bandwidth.
//
// Failures: if the cloud call 503s (missing config) or 5xxs, we log and
// move on — the existing IDB cache keeps working, offline behaviour is
// preserved.

import { supabaseConfigured, supabase } from './supabase-client';
import { authedFetch } from './authed-fetch';
import { canonicalTeamId } from './data';

const DB_NAME = 'blw-content-hub';
const DB_VERSION = 3;

// ─── IndexedDB helpers (lightweight — existing stores also use IDB directly) ─

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // Mirror the schema from the existing stores — IF NOT EXISTS behaviour
      // via objectStoreNames.contains guard. Never destroy existing stores.
      if (!db.objectStoreNames.contains('overlays')) db.createObjectStore('overlays', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('effects')) db.createObjectStore('effects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('players')) db.createObjectStore('players', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(storeName, id) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function idbPut(storeName, record) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function idbGetAll(storeName) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

function idbDelete(storeName, id) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

// ─── Cloud → local mappers (inverse of cloud-sync.js mappers) ───────────────

function rowToMedia(r) {
  return {
    id: r.id,
    name: r.name,
    width: r.width || 0,
    height: r.height || 0,
    team: r.team || '',
    num: r.num || '',
    firstInitial: r.first_initial || '',
    player: r.player || '',
    assetType: r.asset_type || '',
    variant: r.variant || '',
    scope: r.scope || 'player',
    driveFileId: r.drive_file_id || null,
    source: r.source || 'cloud',
    tags: r.tags || {},
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    // v4.20.0: uploader attribution (master-only "who added this" on Files).
    ownerId: r.owner_id || null,
    mimeType: r.mime_type || null,
    sizeBytes: r.size_bytes || null,
    // v4.5.53: anything pulled from the cloud is — by definition —
    // already in the cloud. Same pattern as v4.5.46 overlay/effect.
    cloudSyncedAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    cloudSyncError: null,
    // blob filled in by fetchBlobFromSignedUrl
  };
}

function rowToOverlay(r) {
  return {
    id: r.id,
    name: r.name,
    type: r.type || '',
    team: r.team || '',
    platform: r.platform || '',
    width: r.width || 0,
    height: r.height || 0,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    // v4.5.46: anything pulled from the cloud is — by definition —
    // already in the cloud. Stamp the sync indicator so the picker
    // doesn't render an "unsynced" dot on records that other admins
    // shipped fine.
    cloudSyncedAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    cloudSyncError: null,
  };
}

function rowToEffect(r) {
  return {
    id: r.id,
    name: r.name,
    width: r.width || 0,
    height: r.height || 0,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    cloudSyncedAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    cloudSyncError: null,
  };
}

function rowToPlayer(r) {
  return {
    id: r.id,
    name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    firstName: r.first_name || '',
    lastName: r.last_name || '',
    team: canonicalTeamId(r.team) || '', // v4.17.0: legacy 'SDO' rows → 'ATL'
    num: r.num || '',
    position: r.position || '',
    notes: r.notes || '',
    // v4.4.0 — athlete self-authored vibe block. JSON shape, defaults
    // to {} when the column is absent. Read by PlayerPage's About-me
    // card + fed into /api/ideas as additional player context.
    athleteVoice: r.athlete_voice || {},
    // v4.4.1 — strict 1:1 binding to a profiles.id. Drives athlete
    // edit gating on the AthleteVoiceCard so they can only edit THEIR
    // OWN player's About-me, not every teammate's.
    userId: r.user_id || null,
    // Vitals (db/004) — without these, the bio importer's data wouldn't
    // survive a round-trip from Supabase back into local IDB cache,
    // making the PlayerPage show "—" for everything imported.
    height_in:   r.height_in ?? null,
    weight_lbs:  r.weight_lbs ?? null,
    birthdate:   r.birthdate ?? null,
    bats:        r.bats ?? null,
    throws:      r.throws ?? null,
    birthplace:  r.birthplace ?? null,
    status:      r.status ?? null,
    nickname:    r.nickname ?? null,
    // Profile-pic override (db/005)
    profile_media_id: r.profile_media_id ?? null,
    // Profile-pic pan/zoom positioning (db/009)
    profile_offset_x: r.profile_offset_x ?? null,
    profile_offset_y: r.profile_offset_y ?? null,
    profile_zoom:     r.profile_zoom ?? null,
    // Player-facing extras (db/006)
    instagram_handle: r.instagram_handle ?? null,
    fun_facts:        r.fun_facts ?? null,
    is_rookie:        Boolean(r.is_rookie ?? false),
    manual: true,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}

function rowToRequest(r) {
  return {
    id: r.id,
    team: canonicalTeamId(r.team), // v4.17.0: legacy 'SDO' rows → 'ATL'
    template: r.template || '',
    status: r.status || 'pending',
    priority: r.priority || 'medium',
    requester: r.requester || '',
    note: r.note || '',
    date: r.created_at
      ? new Date(r.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric' })
      : '',
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    // v4.4.0 fields. Type flows in from the new RequestModal type
    // picker; older rows lacking it default to 'content' so the rest
    // of the UI doesn't have to special-case missing values.
    type: r.type || 'content',
    title: r.title || '',
    needBy: r.need_by || null,
    requesterEmail: r.requester_email || '',
    requesterUserId: r.requester_user_id || null,
    playerLastName: r.player_last_name || '',
    playerFirstInitial: r.player_first_initial || '',
    notifiedAt: r.notified_at || null,
    declineReason: r.decline_reason || '',
  };
}

function rowToComment(r) {
  return {
    id: r.id,
    requestId: r.request_id,
    author: r.author || '',
    role: r.role || '',
    text: r.text,
    time: r.created_at
      ? new Date(r.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '',
    // v4.15.0: raw epoch for unread comparisons + thread ordering, plus
    // thread metadata (kind: comment|status|decline, authorUserId).
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    kind: r.kind || 'comment',
    authorUserId: r.author_user_id || null,
  };
}

// ─── Main hydrate ────────────────────────────────────────────────────────────

const LS_HYDRATED_AT = 'blw_cloud_hydrated_at_v1';
// Lowered from 10 min → 60 sec in v4.5.0 to fix cross-device overlay sync on
// mobile. Admin uploads on desktop, the next admin opens mobile within seconds
// — the old 10-minute throttle made them wait or hard-refresh. 60 sec is the
// minimum that still prevents re-pulling on every router transition.
const HYDRATE_MIN_INTERVAL_MS = 60 * 1000;

export function lastHydratedAt() {
  try {
    const raw = localStorage.getItem(LS_HYDRATED_AT);
    return raw ? parseInt(raw, 10) : 0;
  } catch { return 0; }
}

// ─── Hydration-complete signal (v5.2.0) ──────────────────────────────────────
// A fresh device renders pages before the login hydrate finishes (it's
// fire-and-forget in App.jsx), so an avatar can resolve blank because its media
// blob hasn't been downloaded yet. Rather than block first paint on the whole
// blob pull, consumers observe this signal and RE-DERIVE once media has landed:
//   hydrationState() → 'idle' | 'running' | 'done'
//   whenFirstHydrated() → promise that resolves after the first hydrate settles
//   onHydrated(cb) → subscribe to every hydrate completion; returns unsubscribe
let _hydrationState = 'idle';
let _firstHydrateResolve;
const _firstHydratePromise = new Promise((res) => { _firstHydrateResolve = res; });
const _hydrateListeners = new Set();

export function hydrationState() { return _hydrationState; }
export function whenFirstHydrated() { return _firstHydratePromise; }
export function onHydrated(cb) {
  if (typeof cb !== 'function') return () => {};
  _hydrateListeners.add(cb);
  return () => _hydrateListeners.delete(cb);
}
function settleFirstHydrate() { try { _firstHydrateResolve?.(); } catch { /* noop */ } }
function markHydrationDone() {
  _hydrationState = 'done';
  settleFirstHydrate();
  for (const cb of _hydrateListeners) { try { cb(); } catch { /* noop */ } }
}

async function fetchKind(kind) {
  // Phase 5c: cloud-sync now requires a JWT. authedFetch attaches it from
  // the active session; if there's no session we'll get a 401 which the
  // caller treats as "not yet authenticated".
  const res = await authedFetch(`/api/cloud-sync?kind=${kind}`);
  if (!res.ok) throw new Error(`GET ${kind} → HTTP ${res.status}`);
  const data = await res.json();
  return data.records || [];
}

async function blobFromSignedUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`blob HTTP ${res.status}`);
  return res.blob();
}

// Pulls every kind from the cloud and mirrors into local stores. Returns a
// summary report — counts of records hydrated per kind, plus any errors.
export async function refreshFromCloud({ force = false } = {}) {
  // Never leave a first-hydrate waiter hanging: a skip means there's nothing
  // new to wait for (no cloud, or a hydrate already ran within the window).
  if (!supabaseConfigured) { settleFirstHydrate(); return { skipped: 'not-configured' }; }
  if (!force) {
    const since = Date.now() - lastHydratedAt();
    if (since < HYDRATE_MIN_INTERVAL_MS) { settleFirstHydrate(); return { skipped: 'recent', sinceMs: since }; }
  }
  _hydrationState = 'running';

  const report = {
    media: { fetched: 0, newBlobs: 0, errors: [] },
    overlays: { fetched: 0, newBlobs: 0, errors: [] },
    effects: { fetched: 0, newBlobs: 0, errors: [] },
    requests: { fetched: 0, errors: [] },
    comments: { fetched: 0, errors: [] },
    manualPlayers: { fetched: 0, errors: [] },
    fieldOverrides: { fetched: 0, errors: [] },
    aiUsage: { fetched: 0, errors: [] },
  };

  // Binary kinds — fetch metadata, then download any blobs we don't already
  // have (keyed by id) so we don't re-pull images on every page load.
  //
  // v4.5.49: two correctness fixes + one perf fix.
  //   1. NEVER skip the IDB metadata write on blob-download failure.
  //      Pre-fix: a failed fetch did `continue` and the entire record
  //      was dropped — cloud row existed but local IDB had nothing,
  //      so getAllMedia() under-reported by however many blobs the
  //      hydrate-time fetch couldn't reach. Now the metadata always
  //      lands in IDB with `cloudBlobMissing: true` so the UI knows
  //      it exists and can offer a retry. Counts now reconcile.
  //   2. Surface the missing-blob count in the report so the Files
  //      page can show "256/340 hydrated, 84 blobs failed — retry".
  //   3. Blob downloads run in parallel batches of 8 instead of
  //      sequentially. A 340-blob hydrate at sequential 200ms each
  //      took ~70s — long enough for users to navigate away. Eight
  //      concurrent gets it under 10s on a normal connection.
  async function hydrateBlobKind({ kind, store, mapper }) {
    const reportKey = kind === 'manual-player' ? 'manualPlayers'
      : kind === 'overlay' ? 'overlays'
      : kind === 'effect' ? 'effects'
      : 'media';
    try {
      const rows = await fetchKind(kind);
      report[reportKey].fetched = rows.length;
      report[reportKey].blobsMissing = 0;

      // Step 1 — synchronously stage every record into IDB with
      // metadata + (for existing rows) the existing blob. This guarantees
      // that even if blob downloads fail later, the metadata count is
      // correct. Records without blobs get cloudBlobMissing: true so
      // the UI can flag them.
      const needsBlob = []; // [{ row, mapped }]
      for (const r of rows) {
        const mapped = mapper(r);
        const existing = await idbGet(store, r.id).catch(() => null);
        const hasExistingBlob = !!(existing?.blob || existing?.imageBlob);
        if (hasExistingBlob) {
          if (store === 'media') mapped.blob = existing.blob;
          else mapped.imageBlob = existing.imageBlob;
          mapped.cloudBlobMissing = false;
          await idbPut(store, mapped).catch(err => report[reportKey].errors.push({ id: r.id, error: err.message }));
        } else if (r.signedUrl) {
          // Stage metadata-only record now; blob downloads in step 2.
          mapped.cloudBlobMissing = true;
          await idbPut(store, mapped).catch(err => report[reportKey].errors.push({ id: r.id, error: err.message }));
          needsBlob.push({ r, mapped });
        } else {
          // No signed URL — can't fetch the blob. Write metadata anyway.
          mapped.cloudBlobMissing = true;
          await idbPut(store, mapped).catch(err => report[reportKey].errors.push({ id: r.id, error: err.message }));
          report[reportKey].blobsMissing++;
        }
      }

      // Step 2 — parallel-batched blob download. Concurrency 8: low
      // enough not to thrash the connection, high enough that a 340-
      // blob hydrate finishes in seconds. Each successful download
      // re-puts the record with the blob attached + cloudBlobMissing
      // cleared.
      const CONCURRENCY = 8;
      let cursor = 0;
      async function worker() {
        while (cursor < needsBlob.length) {
          const idx = cursor++;
          const { r, mapped } = needsBlob[idx];
          try {
            const blob = await blobFromSignedUrl(r.signedUrl);
            if (store === 'media') mapped.blob = blob;
            else mapped.imageBlob = blob;
            mapped.cloudBlobMissing = false;
            await idbPut(store, mapped).catch(err => report[reportKey].errors.push({ id: r.id, error: err.message }));
            report[reportKey].newBlobs++;
          } catch (err) {
            // Metadata is already in IDB with cloudBlobMissing: true.
            // Just log the error so the report can surface it.
            report[reportKey].errors.push({ id: r.id, error: err.message });
            report[reportKey].blobsMissing++;
          }
        }
      }
      const workers = Array.from({ length: Math.min(CONCURRENCY, needsBlob.length) }, () => worker());
      await Promise.all(workers);
    } catch (err) {
      report[reportKey].errors.push({ error: err.message });
    }
  }

  await hydrateBlobKind({ kind: 'media',   store: 'media',    mapper: rowToMedia });
  await hydrateBlobKind({ kind: 'overlay', store: 'overlays', mapper: rowToOverlay });
  await hydrateBlobKind({ kind: 'effect',  store: 'effects',  mapper: rowToEffect });

  // Manual players — no blob; upsert + reconcile via the shared helper.
  {
    const mp = await hydrateManualPlayers();
    report.manualPlayers.fetched = mp.fetched;
    report.manualPlayers.errors.push(...mp.errors);
  }

  // Requests + comments — localStorage. Merge by id preserving any local-only
  // changes that haven't synced yet (unlikely but defensive).
  try {
    const rows = await fetchKind('request');
    const mapped = rows.map(rowToRequest);
    try {
      const localRaw = localStorage.getItem('blw_requests_v1');
      const local = localRaw ? JSON.parse(localRaw) : [];
      const merged = mergeByIdPreferNewer(local, mapped);
      localStorage.setItem('blw_requests_v1', JSON.stringify(merged));
    } catch {}
    report.requests.fetched = mapped.length;
  } catch (err) {
    report.requests.errors.push({ error: err.message });
  }

  try {
    const rows = await fetchKind('request-comment');
    const mapped = rows.map(rowToComment);
    try {
      const localRaw = localStorage.getItem('blw_request_comments_v1');
      const local = localRaw ? JSON.parse(localRaw) : [];
      const merged = mergeByIdPreferNewer(local, mapped);
      localStorage.setItem('blw_request_comments_v1', JSON.stringify(merged));
    } catch {}
    report.comments.fetched = mapped.length;
  } catch (err) {
    report.comments.errors.push({ error: err.message });
  }

  // Field overrides — composite key, nested shape in localStorage.
  try {
    const rows = await fetchKind('field-override');
    const nested = {};
    for (const r of rows) {
      const combo = `${r.template_type}:${r.platform}`;
      if (!nested[combo]) nested[combo] = {};
      nested[combo][r.field_key] = {
        x: r.x, y: r.y, fontSize: r.font_size, font: r.font, color: r.color,
      };
    }
    // Overwrite the local mirror — the cloud is authoritative for Phase 4.
    localStorage.setItem('blw_field_overrides_v1', JSON.stringify(nested));
    report.fieldOverrides.fetched = rows.length;
  } catch (err) {
    report.fieldOverrides.errors.push({ error: err.message });
  }

  // AI usage — nested by day.
  try {
    const rows = await fetchKind('ai-usage');
    const nested = {};
    for (const r of rows) {
      if (!nested[r.day]) nested[r.day] = {};
      nested[r.day][r.kind] = r.count;
    }
    localStorage.setItem('blw_ai_usage_v1', JSON.stringify(nested));
    report.aiUsage.fetched = rows.length;
  } catch (err) {
    report.aiUsage.errors.push({ error: err.message });
  }

  try { localStorage.setItem(LS_HYDRATED_AT, String(Date.now())); } catch {}
  markHydrationDone();
  return report;
}

// Shared manual-players hydrate: upsert every cloud row into the local
// 'players' IDB store, then RECONCILE — delete local rows whose id no longer
// exists in the cloud (e.g. a duplicate manual_players row merged/deleted by
// an admin would otherwise haunt every device's cache forever, since idbPut
// never removes anything). Two safety guards:
//   1. Deletion only runs when the cloud fetch itself succeeded — a partial
//      or failed fetch must never be interpreted as "everything was deleted".
//   2. Local rows created in the last 10 minutes are spared — an offline-
//      created row that hasn't synced up yet isn't in the cloud set, and
//      deleting it here would eat the user's brand-new player.
async function hydrateManualPlayers() {
  const summary = { fetched: 0, deleted: 0, errors: [] };
  try {
    const rows = await fetchKind('manual-player');
    summary.fetched = rows.length;
    const cloudIds = new Set();
    for (const r of rows) {
      cloudIds.add(r.id);
      await idbPut('players', rowToPlayer(r)).catch(err =>
        summary.errors.push({ id: r.id, error: err.message })
      );
    }
    // Reconcile — guarded by the successful fetch above.
    const FRESH_MS = 10 * 60 * 1000;
    const local = await idbGetAll('players').catch(() => []);
    for (const p of local) {
      if (cloudIds.has(p.id)) continue;
      if (p.createdAt && Date.now() - p.createdAt < FRESH_MS) continue;
      await idbDelete('players', p.id).then(() => { summary.deleted++; })
        .catch(err => summary.errors.push({ id: p.id, error: err.message }));
    }
  } catch (err) {
    summary.errors.push({ error: err.message });
  }
  return summary;
}

// Focused manual-players refresh — used by PlayerPage on mount so a profile
// photo (or any roster edit) made on another device shows up immediately,
// without waiting out the global hydrate throttle. One round trip, no blobs.
export async function refreshManualPlayersFromCloud() {
  if (!supabaseConfigured) return { skipped: 'not-configured', fetched: 0 };
  return hydrateManualPlayers();
}

// Focused requests + comments refresh (v4.15.0). The thread UI is two-way
// communication between DIFFERENT users — the other party's messages are
// never in this device's localStorage, so reads must come from the cloud.
// Fetches both kinds fresh (no throttle), merges into the localStorage
// stores the requests page already reads, and returns the merged lists.
// Soft-fails per-kind: a failed fetch leaves that store untouched.
// opts.commentsOnly: the 30s thread poll only pulls comments — re-merging
// requests mid-edit could momentarily stomp a local status flip whose
// fire-and-forget sync hasn't landed yet.
export async function refreshRequestsFromCloud({ commentsOnly = false } = {}) {
  if (!supabaseConfigured) return { skipped: 'not-configured', requests: null, comments: null };
  const out = { requests: null, comments: null };
  if (!commentsOnly) try {
    const rows = await fetchKind('request');
    const mapped = rows.map(rowToRequest);
    const localRaw = localStorage.getItem('blw_requests_v1');
    const local = localRaw ? JSON.parse(localRaw) : [];
    const merged = mergeByIdPreferNewer(local, mapped);
    localStorage.setItem('blw_requests_v1', JSON.stringify(merged));
    out.requests = merged;
  } catch { /* keep local */ }
  try {
    const rows = await fetchKind('request-comment');
    const mapped = rows.map(rowToComment);
    const localRaw = localStorage.getItem('blw_request_comments_v1');
    const local = localRaw ? JSON.parse(localRaw) : [];
    const merged = mergeByIdPreferNewer(local, mapped);
    localStorage.setItem('blw_request_comments_v1', JSON.stringify(merged));
    out.comments = merged;
  } catch { /* keep local */ }
  return out;
}

// Focused overlay refresh — used by Generate when the user picks a team
// (or hits the manual "↻" button next to the overlay panel) so a fresh
// overlay uploaded by another user appears WITHOUT waiting for the
// global 10-minute hydrate throttle. Pulls only the `overlay` kind,
// downloads any new blobs into IDB, and returns a count summary the
// caller can toast on.
//
// Cheap: one round trip + N blob downloads (N = new overlays since
// last sync). Skips when Supabase isn't configured. Always force-fresh,
// no throttle — the user explicitly asked for this.
export async function refreshOverlaysFromCloud() {
  if (!supabaseConfigured) return { skipped: 'not-configured', fetched: 0, newBlobs: 0 };
  const summary = { fetched: 0, newBlobs: 0, errors: [] };
  try {
    const rows = await fetchKind('overlay');
    summary.fetched = rows.length;
    for (const r of rows) {
      const mapped = rowToOverlay(r);
      const existing = await idbGet('overlays', r.id).catch(() => null);
      const needBlob = !existing?.imageBlob;
      if (needBlob && r.signedUrl) {
        try {
          const blob = await blobFromSignedUrl(r.signedUrl);
          mapped.imageBlob = blob;
          summary.newBlobs++;
        } catch (err) {
          summary.errors.push({ id: r.id, error: err.message });
          continue;
        }
      } else if (existing) {
        mapped.imageBlob = existing.imageBlob;
      }
      await idbPut('overlays', mapped).catch(err => summary.errors.push({ id: r.id, error: err.message }));
    }
  } catch (err) {
    summary.errors.push({ error: err.message });
  }
  return summary;
}

// Merge two arrays by id, preferring whichever record looks newer based on
// status/priority/note change. For now, simply prefer the cloud record if
// present — conflict resolution gets smarter when auth lands in Phase 5.
function mergeByIdPreferNewer(local, cloud) {
  const byId = new Map(local.map(r => [r.id, r]));
  for (const r of cloud) byId.set(r.id, r);
  // Keep in cloud order (which is newest-first from Supabase defaults)
  // but preserve the original local array's shape when fields match.
  const seen = new Set();
  const out = [];
  for (const r of cloud) { if (!seen.has(r.id)) { out.push(byId.get(r.id)); seen.add(r.id); } }
  for (const r of local) { if (!seen.has(r.id)) { out.push(r); seen.add(r.id); } }
  return out;
}
