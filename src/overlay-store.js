// ─── IndexedDB Store for Overlay Template PNGs + Effect PNGs ───────────────

import { cloud } from './cloud-sync';

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

export async function saveOverlay({ name, type, team, platform, imageBlob, width, height }) {
  const db = await openDB();
  const id = crypto.randomUUID();
  const record = { id, name, type, team, platform, imageBlob, width, height, createdAt: Date.now() };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => { cloud.syncOverlay(record); resolve(record); };
    tx.onerror = () => reject(tx.error);
  });
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

export async function saveEffect({ name, imageBlob, width, height }) {
  const db = await openDB();
  const id = crypto.randomUUID();
  const record = { id, name, imageBlob, width, height, createdAt: Date.now() };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EFFECTS_STORE, 'readwrite');
    tx.objectStore(EFFECTS_STORE).put(record);
    tx.oncomplete = () => { cloud.syncEffect(record); resolve(record); };
    tx.onerror = () => reject(tx.error);
  });
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
