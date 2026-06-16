// Client helpers for media usage analytics (v4.20.0).
//
// recordMediaUsage(mediaId, kind) — fire-and-forget POST when a library file
//   is downloaded ('download') or used as the background of an exported
//   Studio post ('studio'). Never blocks the user action; soft-fails silently.
//
// fetchTopMedia() / fetchMediaUploaders() — master-only reads for the Settings
//   "Most-used media" card and the Files who/when overlay.

import { authedJson } from './authed-fetch';

export function recordMediaUsage(mediaId, kind) {
  if (!mediaId || (kind !== 'download' && kind !== 'studio')) return;
  try {
    authedJson('/api/media-usage', { method: 'POST', body: { mediaId, kind } }).catch(() => {});
  } catch { /* no session / offline — analytics are best-effort */ }
}

export async function fetchTopMedia(limit = 30) {
  try {
    const r = await authedJson(`/api/media-usage?action=top&limit=${limit}`);
    return r?.rows || [];
  } catch { return []; }
}

export async function fetchMediaUploaders() {
  try {
    const r = await authedJson('/api/media-usage?action=uploaders');
    return r?.uploaders || {};
  } catch { return {}; }
}
