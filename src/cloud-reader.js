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
    mimeType: r.mime_type || null,
    sizeBytes: r.size_bytes || null,
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
  };
}

function rowToEffect(r) {
  return {
    id: r.id,
    name: r.name,
    width: r.width || 0,
    height: r.height || 0,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}

function rowToPlayer(r) {
  return {
    id: r.id,
    name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    firstName: r.first_name || '',
    lastName: r.last_name || '',
    team: r.team || '',
    num: r.num || '',
    position: r.position || '',
    notes: r.notes || '',
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
    team: r.team,
    template: r.template || '',
    status: r.status || 'pending',
    priority: r.priority || 'medium',
    requester: r.requester || '',
    note: r.note || '',
    date: r.created_at
      ? new Date(r.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric' })
      : '',
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
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
  };
}

// ─── Main hydrate ────────────────────────────────────────────────────────────

const LS_HYDRATED_AT = 'blw_cloud_hydrated_at_v1';
const HYDRATE_MIN_INTERVAL_MS = 10 * 60 * 1000; // once per 10 minutes by default

export function lastHydratedAt() {
  try {
    const raw = localStorage.getItem(LS_HYDRATED_AT);
    return raw ? parseInt(raw, 10) : 0;
  } catch { return 0; }
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
  if (!supabaseConfigured) return { skipped: 'not-configured' };
  if (!force) {
    const since = Date.now() - lastHydratedAt();
    if (since < HYDRATE_MIN_INTERVAL_MS) return { skipped: 'recent', sinceMs: since };
  }

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
  async function hydrateBlobKind({ kind, store, mapper }) {
    try {
      const rows = await fetchKind(kind);
      report[kind === 'manual-player' ? 'manualPlayers' : (kind === 'overlay' ? 'overlays' : kind === 'effect' ? 'effects' : 'media')].fetched = rows.length;
      for (const r of rows) {
        const mapped = mapper(r);
        const existing = await idbGet(store, r.id).catch(() => null);
        const needBlob = !existing?.blob && !existing?.imageBlob;
        if (needBlob && r.signedUrl) {
          try {
            const blob = await blobFromSignedUrl(r.signedUrl);
            if (store === 'media') mapped.blob = blob;
            else mapped.imageBlob = blob;
            const key = kind === 'overlay' ? 'overlays' : kind === 'effect' ? 'effects' : 'media';
            report[key].newBlobs++;
          } catch (err) {
            const key = kind === 'overlay' ? 'overlays' : kind === 'effect' ? 'effects' : 'media';
            report[key].errors.push({ id: r.id, error: err.message });
            continue; // skip IDB write without a blob
          }
        } else if (existing) {
          // Preserve existing blob, merge metadata from cloud.
          if (store === 'media') mapped.blob = existing.blob;
          else mapped.imageBlob = existing.imageBlob;
        } else {
          // No blob available anywhere — still mirror metadata so the UI
          // knows about the record. Pages handle blob-less records gracefully.
        }
        await idbPut(store, mapped).catch(err => {
          const key = kind === 'overlay' ? 'overlays' : kind === 'effect' ? 'effects' : 'media';
          report[key].errors.push({ id: r.id, error: err.message });
        });
      }
    } catch (err) {
      const key = kind === 'overlay' ? 'overlays' : kind === 'effect' ? 'effects' : 'media';
      report[key].errors.push({ error: err.message });
    }
  }

  await hydrateBlobKind({ kind: 'media',   store: 'media',    mapper: rowToMedia });
  await hydrateBlobKind({ kind: 'overlay', store: 'overlays', mapper: rowToOverlay });
  await hydrateBlobKind({ kind: 'effect',  store: 'effects',  mapper: rowToEffect });

  // Manual players — no blob, simple IDB upsert into 'players' store.
  try {
    const rows = await fetchKind('manual-player');
    report.manualPlayers.fetched = rows.length;
    for (const r of rows) {
      await idbPut('players', rowToPlayer(r)).catch(err =>
        report.manualPlayers.errors.push({ id: r.id, error: err.message })
      );
    }
  } catch (err) {
    report.manualPlayers.errors.push({ error: err.message });
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
  return report;
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
