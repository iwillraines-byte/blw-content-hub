// ─── IndexedDB Store for Media Files (Photos/Assets) ────────────────────────
// Shared between Files page and Generate page for player-media matching

const DB_NAME = 'blw-content-hub';
const DB_VERSION = 1;
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
// Searches uploaded media for files matching a player's naming convention prefix

export async function findPlayerMedia(team, jerseyNum, lastName) {
  const all = await getAllMedia();
  const prefix = `${team}_${String(jerseyNum).padStart(2, '0')}_${lastName.toUpperCase()}`;
  return all.filter(f => f.name.toUpperCase().startsWith(prefix));
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
