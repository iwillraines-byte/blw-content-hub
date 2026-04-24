// ─── IndexedDB Store for Manually-Added Players ────────────────────────────
// For players signed to teams but not yet appearing in the Grand Slam Systems
// API (e.g., preseason signings, practice squad). Persisted in the browser.

import { cloud } from './cloud-sync';

const DB_NAME = 'blw-content-hub';
const DB_VERSION = 3; // Bumped from 2 to add players store
const STORE_NAME = 'players';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('overlays')) {
        db.createObjectStore('overlays', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('media')) {
        db.createObjectStore('media', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('effects')) {
        db.createObjectStore('effects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePlayer({ name, firstName, lastName, team, num, position, notes }) {
  const db = await openDB();
  const id = crypto.randomUUID();
  const record = {
    id,
    name: name || `${firstName} ${lastName}`.trim(),
    firstName: firstName || '',
    lastName,
    team,
    num: num || '',
    position: position || '',
    notes: notes || '',
    manual: true,
    createdAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => { cloud.syncManualPlayer(record); resolve(record); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllManualPlayers() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getManualPlayersByTeam(teamId) {
  const all = await getAllManualPlayers();
  return all.filter(p => p.team === teamId);
}

// Upsert a manual_players row from a "team + lastName (+ firstInitial)"
// key — used by admin tools that want to attach a setting to a player
// who may only exist in API data (batting/pitching) and therefore has
// no manual row yet. Returns the merged record after save.
//
// Matching rule: case-insensitive lastName on the team, optionally
// narrowed by firstInitial. If no row matches, a new one is created.
export async function upsertManualPlayer({ team, lastName, firstInitial, firstName, num, updates = {} }) {
  if (!team || !lastName) throw new Error('team + lastName required');
  const all = await getAllManualPlayers();
  const lnNorm = String(lastName).toLowerCase();
  const finNorm = firstInitial ? String(firstInitial).toUpperCase() : null;
  const match = all.find(p => {
    if (p.team !== team) return false;
    const pLn = String(p.lastName || '').toLowerCase();
    if (pLn !== lnNorm) return false;
    if (!finNorm) return true;
    const pFn = String(p.firstName || p.name || '').trim();
    return pFn.charAt(0).toUpperCase() === finNorm;
  });

  const db = await openDB();
  if (match) {
    // Update existing
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const merged = { ...match, ...updates };
      if (updates.firstName || updates.lastName) {
        merged.name = `${merged.firstName || ''} ${merged.lastName || ''}`.trim();
      }
      store.put(merged);
      tx.oncomplete = () => { cloud.syncManualPlayer(merged); resolve(merged); };
      tx.onerror = () => reject(tx.error);
    });
  }
  // Create new stub row so the setting has somewhere to live.
  const id = crypto.randomUUID();
  const fn = firstName || '';
  const record = {
    id,
    name: `${fn} ${lastName}`.trim(),
    firstName: fn,
    lastName,
    team,
    num: num || '',
    position: '',
    notes: '',
    manual: true,
    createdAt: Date.now(),
    ...updates,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => { cloud.syncManualPlayer(record); resolve(record); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function updatePlayer(id, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) { reject(new Error('Not found')); return; }
      const merged = { ...existing, ...updates };
      if (updates.firstName || updates.lastName) {
        merged.name = `${merged.firstName} ${merged.lastName}`.trim();
      }
      store.put(merged);
      tx.oncomplete = () => { cloud.syncManualPlayer(merged); resolve(merged); };
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function deletePlayer(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => { cloud.deleteManualPlayer(id); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}
