// ─── Google Drive API (public-folder browser) ──────────────────────────────
// Uses a browser-side API key to list files in publicly-shared Drive folders.
// File downloads go through /api/drive (Vercel proxy) to bypass CORS.
//
// Setup: user creates a Drive API key in Google Cloud Console, pastes it in
// Settings. Folders must be shared as "Anyone with the link can view".
//
// v4.5.10: API key + folder list are now CLOUD-SYNCED via the
// /api/app-settings endpoint so every admin who signs in inherits the
// master's Drive config without having to paste credentials themselves.
// localStorage stays as a cache for offline use; cloud is source of
// truth. hydrateFromCloud() is called on auth-ready in App.jsx.

import { authedFetch } from './authed-fetch';

const LS_API_KEY = 'blw_drive_api_key';
const LS_FOLDERS = 'blw_drive_folders';
const LS_HYDRATED_AT = 'blw_drive_hydrated_at';

// ─── API key persistence ────────────────────────────────────────────────────
export function getApiKey() {
  try { return localStorage.getItem(LS_API_KEY) || ''; }
  catch { return ''; }
}

export function setApiKey(key) {
  try { localStorage.setItem(LS_API_KEY, (key || '').trim()); }
  catch {}
}

export function clearApiKey() {
  try { localStorage.removeItem(LS_API_KEY); }
  catch {}
}

// ─── Cloud sync (v4.5.10) ──────────────────────────────────────────────────
// Pull the master-saved Drive config (key + folders) from Supabase into
// localStorage. Called once on auth-ready so every admin gets the shared
// config without manual setup. Silent-no-op when not configured or
// unauthenticated.
export async function hydrateDriveFromCloud() {
  try {
    const res = await authedFetch('/api/app-settings?key=drive');
    if (!res.ok) return { hydrated: false, status: res.status };
    const json = await res.json();
    const cloudValue = json?.value;
    if (!cloudValue) return { hydrated: false, reason: 'empty' };

    let updated = false;
    if (cloudValue.apiKey && cloudValue.apiKey !== getApiKey()) {
      setApiKey(cloudValue.apiKey);
      updated = true;
    }
    if (Array.isArray(cloudValue.folders)) {
      const localFolders = getSavedFolders();
      // Merge cloud folders with local — cloud wins on id collision.
      const byId = new Map(localFolders.map(f => [f.folderId, f]));
      for (const f of cloudValue.folders) {
        if (!f?.folderId) continue;
        byId.set(f.folderId, f);
      }
      const merged = Array.from(byId.values());
      try {
        localStorage.setItem(LS_FOLDERS, JSON.stringify(merged));
      } catch {}
      if (merged.length !== localFolders.length) updated = true;
    }
    try { localStorage.setItem(LS_HYDRATED_AT, String(Date.now())); } catch {}
    return { hydrated: true, updated };
  } catch (err) {
    console.warn('[drive-api] cloud hydrate failed', err?.message);
    return { hydrated: false, error: err?.message };
  }
}

// Push the current key + folder list to Supabase. Master-admin only —
// the server enforces the role gate, this just fires the request.
export async function pushDriveToCloud() {
  try {
    const value = {
      apiKey: getApiKey(),
      folders: getSavedFolders(),
    };
    const res = await authedFetch('/api/app-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'drive', value }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, detail: text.slice(0, 200) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

// ─── Folder URL parsing ─────────────────────────────────────────────────────
// Handles all common Drive folder URL shapes:
//   https://drive.google.com/drive/folders/FOLDER_ID
//   https://drive.google.com/drive/folders/FOLDER_ID?usp=sharing
//   https://drive.google.com/drive/u/0/folders/FOLDER_ID
//   FOLDER_ID (raw ID pasted directly)
export function extractFolderId(input) {
  if (!input) return null;
  const s = input.trim();
  // Raw-looking ID (25+ alphanumeric chars, no slashes)
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  const m = s.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  const m2 = s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (m2) return m2[1];
  return null;
}

// ─── Saved folders (localStorage) ───────────────────────────────────────────
export function getSavedFolders() {
  try {
    const raw = localStorage.getItem(LS_FOLDERS);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveFolder({ folderId, name, url }) {
  const existing = getSavedFolders();
  if (existing.find(f => f.folderId === folderId)) return existing;
  const next = [...existing, { folderId, name: name || 'Drive Folder', url, addedAt: Date.now() }];
  try { localStorage.setItem(LS_FOLDERS, JSON.stringify(next)); } catch {}
  return next;
}

export function renameFolder(folderId, newName) {
  const next = getSavedFolders().map(f => f.folderId === folderId ? { ...f, name: newName } : f);
  try { localStorage.setItem(LS_FOLDERS, JSON.stringify(next)); } catch {}
  return next;
}

export function removeFolder(folderId) {
  const next = getSavedFolders().filter(f => f.folderId !== folderId);
  try { localStorage.setItem(LS_FOLDERS, JSON.stringify(next)); } catch {}
  return next;
}

// ─── List folder contents via Drive API ─────────────────────────────────────
// Returns an array of { id, name, mimeType, size, thumbnailLink, webViewLink, iconLink }
// Only includes image/* and video/* files (filter out subfolders, docs, etc.)
//
// Drive API v3 supports browser CORS on this endpoint with API key auth.
export async function listFolderFiles(folderId, { apiKey, includeAll = false, pageSize = 200 } = {}) {
  const key = apiKey || getApiKey();
  if (!key) throw new Error('No Drive API key set. Add one in Settings.');
  if (!folderId) throw new Error('No folder ID provided.');

  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'nextPageToken,files(id,name,mimeType,size,thumbnailLink,webViewLink,iconLink,imageMediaMetadata,videoMediaMetadata,modifiedTime)',
    pageSize: String(pageSize),
    key,
    // Required for shared/public folders to be readable without auth
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const allFiles = [];
  let pageToken = null;
  let pageCount = 0;
  const MAX_PAGES = 10; // hard safety cap

  do {
    if (pageToken) params.set('pageToken', pageToken);
    else params.delete('pageToken');

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 403) {
        throw new Error(`Drive API rejected the request (403). Check that your API key allows Drive API, your referrer restriction includes this domain, and the folder is shared "Anyone with the link".\n\n${body.slice(0, 300)}`);
      }
      if (res.status === 404) {
        throw new Error(`Folder not found (404). Double-check the folder ID and that the folder is shared publicly.`);
      }
      throw new Error(`Drive API HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    allFiles.push(...(data.files || []));
    pageToken = data.nextPageToken;
    pageCount++;
  } while (pageToken && pageCount < MAX_PAGES);

  if (includeAll) return allFiles;

  // Default: only images and videos
  return allFiles.filter(f =>
    (f.mimeType || '').startsWith('image/') ||
    (f.mimeType || '').startsWith('video/')
  );
}

// ─── Download a file as a Blob via Vercel proxy ─────────────────────────────
export async function downloadFileAsBlob(fileId, { apiKey } = {}) {
  const key = apiKey || getApiKey();
  const qs = new URLSearchParams({ fileId });
  if (key) qs.set('apiKey', key);
  const res = await fetch(`/api/drive?${qs.toString()}`);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Download failed (HTTP ${res.status}): ${errText.slice(0, 200)}`);
  }
  return await res.blob();
}
