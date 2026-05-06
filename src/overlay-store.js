// ─── IndexedDB Store for Overlay Template PNGs + Effect PNGs ───────────────

import { cloud, cloudAwait } from './cloud-sync';

const DB_NAME = 'blw-content-hub';
const DB_VERSION = 3; // Bumped for players store addition
const STORE_NAME = 'overlays';
const EFFECTS_STORE = 'effects';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('media')) {
        db.createObjectStore('media', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(EFFECTS_STORE)) {
        db.createObjectStore(EFFECTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('players')) {
        db.createObjectStore('players', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Overlays ───────────────────────────────────────────────────────────────

// v4.5.46: saveOverlay now AWAITS the cloud sync and stamps
// `cloudSyncedAt` on the record when it succeeds. Pre-fix this was
// fire-and-forget — a transient 500, network blip, or 413 silently
// swallowed the sync, leaving the overlay in the master's IndexedDB
// but never reaching other admins. Now the picker can show a per-tile
// "local-only / synced" indicator (see syncOverlayToCloud below for
// the manual retry path) and the upload toast can report a precise
// success count.
//
// Contract: returns the record. Inspect `record.cloudSyncedAt` —
// truthy = in the cloud and visible to other admins; null = stuck
// locally, needs retry. `record.cloudSyncError` carries the error
// detail when sync failed (for the picker tooltip).
export async function saveOverlay({ name, type, team, platform, imageBlob, width, height }) {
  const db = await openDB();
  const id = crypto.randomUUID();
  const record = {
    id, name, type, team, platform, imageBlob, width, height,
    createdAt: Date.now(),
    cloudSyncedAt: null,
    cloudSyncError: null,
  };

  // 1) Stash to IndexedDB first so the master always has the local
  //    copy even if the cloud sync fails.
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // 2) Push to cloud, then update the record + DB with the result.
  await syncOverlayRecordToCloud(record);
  return record;
}

// Internal helper — pushes a single overlay record to the cloud,
// mutates the record in place with the outcome, and persists the
// updated record back to IndexedDB. Used by saveOverlay (initial
// upload) and resyncOverlay (manual retry from the picker).
async function syncOverlayRecordToCloud(record) {
  let result;
  try {
    result = await cloudAwait.syncOverlay(record);
  } catch (err) {
    result = { ok: false, error: err?.message || 'sync threw' };
  }
  if (result?.ok) {
    record.cloudSyncedAt = Date.now();
    record.cloudSyncError = null;
  } else {
    record.cloudSyncedAt = null;
    record.cloudSyncError = result?.error || result?.detail || `sync failed (status ${result?.status || '?'})`;
  }
  // Persist the updated record so the indicator survives a refresh.
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* the record stays in memory at minimum */ }
  return result;
}

// v4.5.46: manual retry. Caller passes the overlay id (e.g., from a
// picker tile that's showing the amber "local-only" dot); we look it
// up locally, push to cloud, and return the updated record. Callers
// should refresh their `overlays` state from the returned record.
export async function resyncOverlay(id) {
  const db = await openDB();
  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!record) return null;
  await syncOverlayRecordToCloud(record);
  return record;
}

// v4.5.46: bulk recovery. Walks every locally-stored overlay and
// re-syncs anything missing `cloudSyncedAt`. Returns a summary the
// caller can surface in a toast: { total, synced, failed, errors }.
// Sequential by design — a flaky connection that drops one overlay
// doesn't take down the rest, and we don't slam the API.
export async function resyncAllLocalOnlyOverlays() {
  const all = await getOverlays();
  const localOnly = all.filter(o => !o.cloudSyncedAt);
  let synced = 0, failed = 0;
  const errors = [];
  for (const record of localOnly) {
    const result = await syncOverlayRecordToCloud(record);
    if (result?.ok) synced++;
    else { failed++; errors.push({ id: record.id, name: record.name, error: record.cloudSyncError }); }
  }
  return { total: localOnly.length, synced, failed, errors };
}

export async function getOverlays() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getOverlayById(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteOverlay(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => { cloud.deleteOverlay(id); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Effects (custom uploaded effect PNGs) ──────────────────────────────────

// v4.5.46: same awaitable cloud-sync pattern as saveOverlay above.
export async function saveEffect({ name, imageBlob, width, height }) {
  const db = await openDB();
  const id = crypto.randomUUID();
  const record = {
    id, name, imageBlob, width, height,
    createdAt: Date.now(),
    cloudSyncedAt: null,
    cloudSyncError: null,
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(EFFECTS_STORE, 'readwrite');
    tx.objectStore(EFFECTS_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await syncEffectRecordToCloud(record);
  return record;
}

async function syncEffectRecordToCloud(record) {
  let result;
  try {
    result = await cloudAwait.syncEffect(record);
  } catch (err) {
    result = { ok: false, error: err?.message || 'sync threw' };
  }
  if (result?.ok) {
    record.cloudSyncedAt = Date.now();
    record.cloudSyncError = null;
  } else {
    record.cloudSyncedAt = null;
    record.cloudSyncError = result?.error || result?.detail || `sync failed (status ${result?.status || '?'})`;
  }
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(EFFECTS_STORE, 'readwrite');
      tx.objectStore(EFFECTS_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* in-memory at minimum */ }
  return result;
}

export async function resyncEffect(id) {
  const db = await openDB();
  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction(EFFECTS_STORE, 'readonly');
    const req = tx.objectStore(EFFECTS_STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!record) return null;
  await syncEffectRecordToCloud(record);
  return record;
}

export async function resyncAllLocalOnlyEffects() {
  const all = await getEffects();
  const localOnly = all.filter(e => !e.cloudSyncedAt);
  let synced = 0, failed = 0;
  const errors = [];
  for (const record of localOnly) {
    const result = await syncEffectRecordToCloud(record);
    if (result?.ok) synced++;
    else { failed++; errors.push({ id: record.id, name: record.name, error: record.cloudSyncError }); }
  }
  return { total: localOnly.length, synced, failed, errors };
}

export async function getEffects() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EFFECTS_STORE, 'readonly');
    const req = tx.objectStore(EFFECTS_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteEffect(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EFFECTS_STORE, 'readwrite');
    tx.objectStore(EFFECTS_STORE).delete(id);
    tx.oncomplete = () => { cloud.deleteEffect(id); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}
