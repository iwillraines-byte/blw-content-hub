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

// Upsert a manual_players row from a "team + lastName (+ firstInitial / num /
// firstName)" key — used by admin tools that want to attach a setting to a
// player who may only exist in API data (batting/pitching) and therefore has
// no manual row yet. Returns the merged record after save.
//
// v4.5.1: Tightened matching rules to prevent the Logan/Luke Rose collision.
// The OLD logic matched on (team, lastName, firstInitial) which collapsed
// every Rose with initial "L" into a single record — editing Logan's
// About-me overwrote Luke's. The Marshall pair on AZS and any future
// twins-with-same-initial hit the same trap.
//
// New matching priority (most specific wins):
//   1. (team, lastName, firstName)   — exact identity, used by canonical
//                                      roster + every UI form that knows
//                                      both names
//   2. (team, lastName, num)         — when caller has jersey but not full
//                                      first name (rare, but the AI
//                                      tagging path used to do this)
//   3. (team, lastName, firstInitial) — only when there is EXACTLY ONE
//                                      record on this team with that
//                                      (lastName, initial). If multiple,
//                                      we refuse to merge — see below.
//   4. (team, lastName)              — only when EXACTLY ONE record on
//                                      this team has that lastName.
//
// If the matching rule is ambiguous (rule 3 or 4 matches multiple records),
// we create a NEW record instead of overwriting one of them — losing data
// is worse than having a duplicate that an admin can clean up.
export async function upsertManualPlayer({ team, lastName, firstInitial, firstName, num, updates = {} }) {
  if (!team || !lastName) throw new Error('team + lastName required');
  const all = await getAllManualPlayers();
  const lnNorm = String(lastName).toLowerCase();
  const fnNorm = firstName ? String(firstName).trim().toLowerCase() : null;
  const finNorm = firstInitial ? String(firstInitial).toUpperCase().slice(0, 1) : null;
  const numNorm = num ? String(num).replace(/^0+/, '') : null;

  const sameTeamLast = all.filter(p =>
    p.team === team && String(p.lastName || '').toLowerCase() === lnNorm
  );

  // Rule 1: exact firstName + lastName + team
  let match = null;
  if (fnNorm) {
    match = sameTeamLast.find(p => {
      const pFn = String(p.firstName || '').trim().toLowerCase();
      return pFn && pFn === fnNorm;
    });
  }
  // Rule 2: jersey + lastName + team
  if (!match && numNorm) {
    match = sameTeamLast.find(p => {
      const pNum = String(p.num || '').replace(/^0+/, '');
      return pNum && pNum === numNorm;
    });
  }
  // Rule 3: firstInitial + lastName + team — but ONLY if unique on team
  if (!match && finNorm) {
    const candidates = sameTeamLast.filter(p => {
      const pFn = String(p.firstName || p.name || '').trim();
      return pFn.charAt(0).toUpperCase() === finNorm;
    });
    if (candidates.length === 1) match = candidates[0];
  }
  // Rule 4: lastName + team — but ONLY if unique on team
  if (!match && !fnNorm && !numNorm && !finNorm && sameTeamLast.length === 1) {
    match = sameTeamLast[0];
  }

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
