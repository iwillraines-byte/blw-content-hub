// ─── IndexedDB Store for Media Files (Photos/Assets) ────────────────────────
// Shared between Files page and Generate page for player-media matching

const DB_NAME = 'blw-content-hub';
const DB_VERSION = 3; // Must match overlay-store.js
const STORE_NAME = 'media';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('overlays')) {
        db.createObjectStore('overlays', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('effects')) {
        db.createObjectStore('effects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('players')) {
        db.createObjectStore('players', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMedia({ name, blob, width, height }) {
  const db = await openDB();
  const id = crypto.randomUUID();

  // Parse naming convention: {TEAM}_{JERSEY#}_{LASTNAME}_{ASSET_TYPE}.{ext}
  const parts = name.replace(/\.[^.]+$/, '').split('_');
  const team = parts[0] || '';
  const num = parts[1] || '';
  const player = parts[2] || '';
  const assetType = parts[3] || 'FILE';

  const record = {
    id, name, blob, width, height,
    team: team.toUpperCase(),
    num,
    player: player.toUpperCase(),
    assetType: assetType.toUpperCase(),
    createdAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllMedia() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function updateMedia(id, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) { reject(new Error('Not found')); return; }
      const updated = { ...existing, ...updates };
      // Re-parse naming convention from new name
      if (updates.name) {
        const parts = updates.name.replace(/\.[^.]+$/, '').split('_');
        updated.team = (parts[0] || '').toUpperCase();
        updated.num = parts[1] || '';
        updated.player = (parts[2] || '').toUpperCase();
        updated.assetType = (parts[3] || 'FILE').toUpperCase();
      }
      store.put(updated);
      tx.oncomplete = () => resolve(updated);
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteMedia(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Player-Media Matching ──────────────────────────────────────────────────
// Primary match is TEAM + LASTNAME. Jersey number is optional and secondary,
// since numbers are being added manually over time.

export async function findPlayerMedia(team, lastName, jerseyNum = null) {
  const all = await getAllMedia();
  const T = team.toUpperCase();
  const LN = lastName.toUpperCase();

  // Match TEAM_anything_LASTNAME_anything
  let matches = all.filter(f => {
    const name = f.name.toUpperCase();
    const parts = name.replace(/\.[^.]+$/, '').split('_');
    if (parts[0] !== T) return false;
    // Last name can be in position 2 (TEAM_##_LASTNAME) or position 1 (TEAM_LASTNAME if no jersey)
    return parts.includes(LN) || f.player === LN;
  });

  // Optional jersey filter
  if (jerseyNum != null && jerseyNum !== '') {
    const padded = String(jerseyNum).padStart(2, '0');
    matches = matches.filter(f => f.num === padded || f.num === String(jerseyNum));
  }

  return matches;
}

// All media for a team (any player), sorted by most recent first
export async function findTeamMedia(team) {
  const all = await getAllMedia();
  const T = team.toUpperCase();
  return all
    .filter(f => f.team === T)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function blobToObjectURL(blob) {
  return URL.createObjectURL(blob);
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
