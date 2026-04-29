// ─── Browser-side wrapper for the /api/auto-tag Vercel function ────────────
// Handles:
//   - Client-side image resizing (reduces bandwidth 5-10x, no quality loss for vision AI)
//   - Two input modes: local blob or Drive fileId
//   - Gathering teams + roster context to send as system prompt

import { TEAMS, getAllPlayersDirectory } from './data';
import { getApiKey as getDriveApiKey } from './drive-api';

const MAX_EDGE = 1024; // Claude downscales to ~1568 internally; 1024 is more than enough
const JPEG_QUALITY = 0.82;

// ─── Resize blob to a reasonable size for vision API ────────────────────────
// Returns { base64, mediaType } ready to POST to /api/auto-tag
export async function resizeBlobForVision(blob) {
  // Videos — grab the first frame
  if (blob.type.startsWith('video/')) {
    return await extractVideoFrame(blob);
  }

  const img = await blobToImage(blob);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  return await new Promise((resolve, reject) => {
    canvas.toBlob(async (out) => {
      if (!out) { reject(new Error('Canvas toBlob failed')); return; }
      const b64 = await blobToBase64(out);
      resolve({ base64: b64, mediaType: 'image/jpeg' });
    }, 'image/jpeg', JPEG_QUALITY);
  });
}

async function extractVideoFrame(blob) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';

  await new Promise((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('Video load failed'));
  });
  // Seek 1 second in to avoid a black frame at 0
  await new Promise((resolve) => {
    video.onseeked = () => resolve();
    video.currentTime = Math.min(1, (video.duration || 2) * 0.1);
  });

  const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);
  URL.revokeObjectURL(url);

  return await new Promise((resolve, reject) => {
    canvas.toBlob(async (out) => {
      if (!out) { reject(new Error('Video frame capture failed')); return; }
      const b64 = await blobToBase64(out);
      resolve({ base64: b64, mediaType: 'image/jpeg' });
    }, 'image/jpeg', JPEG_QUALITY);
  });
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result; // data:image/jpeg;base64,XXXX
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ─── Build the context payload (teams + roster) ─────────────────────────────
// Cached in-memory so bulk runs don't re-fetch the directory per call
let _rosterCache = null;
let _rosterCacheAt = 0;
const ROSTER_CACHE_TTL = 2 * 60 * 1000;

async function getContextPayload() {
  const now = Date.now();
  if (!_rosterCache || now - _rosterCacheAt > ROSTER_CACHE_TTL) {
    const all = await getAllPlayersDirectory();
    // Send firstInitial + firstName too — without these the vision API
    // can't disambiguate cousin pairs (Logan/Luke Rose, Paul/Will
    // Marshall) and never returns a firstInitial in its response. We
    // keep the payload tight by sending the initial as a single char
    // and only the first 12 chars of firstName (more than enough for
    // visual disambiguation hints).
    _rosterCache = all.map(p => ({
      team: p.team,
      lastName: p.lastName,
      num: p.num || '',
      firstInitial: p.firstInitial || (p.firstName || '').charAt(0).toUpperCase() || '',
      firstName: (p.firstName || '').slice(0, 12),
    }));
    _rosterCacheAt = now;
  }
  return {
    teams: TEAMS.map(t => ({
      id: t.id, name: t.name, color: t.color, accent: t.accent,
    })),
    roster: _rosterCache,
  };
}

// ─── Main exports ───────────────────────────────────────────────────────────

// Tag a local blob (from drag-drop or already-imported file in IndexedDB)
export async function autoTagBlob(blob) {
  const { base64, mediaType } = await resizeBlobForVision(blob);
  const ctx = await getContextPayload();
  return postAutoTag({
    image: { base64, mediaType },
    ...ctx,
  });
}

// Tag a Drive file directly without downloading it first (server fetches)
export async function autoTagDriveFile(driveFileId) {
  const driveApiKey = getDriveApiKey();
  const ctx = await getContextPayload();
  return postAutoTag({
    image: { driveFileId, driveApiKey: driveApiKey || undefined },
    ...ctx,
  });
}

async function postAutoTag(body) {
  const res = await fetch('/api/auto-tag', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 300) }; }
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.detail = data.detail;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ─── Helper: build a tagged filename from auto-tag results ──────────────────
// Preserves the original extension. Emits the F.LASTNAME form when a
// firstInitial is provided; falls back to legacy LASTNAME-only otherwise.
export function buildFilenameFromTags({ team, num, firstInitial, lastName, assetType }, originalFilename) {
  const ext = (originalFilename || '').split('.').pop() || 'jpg';
  const FI = (firstInitial || '').toUpperCase().slice(0, 1);
  const LN = (lastName || 'UNKNOWN').toUpperCase();
  const nameSegment = FI ? `${FI}.${LN}` : LN;
  const parts = [
    (team || 'UNK').toUpperCase(),
    (num || '00').toString().padStart(2, '0'),
    nameSegment,
    (assetType || 'FILE').toUpperCase(),
  ];
  return `${parts.join('_')}.${ext}`;
}
