// Client-side helpers that fire dual-writes to the cloud. Each store (media,
// overlays, effects, requests, players, overrides, ai usage) calls into this
// file after it persists locally, so every change lands in Supabase too.
//
// Philosophy for Phase 2:
//   • Fire-and-forget — local save is the source of truth; the cloud call
//     runs in the background and logs failures to the console.
//   • Never block the UI. If the user's offline, the local save still works,
//     and Phase 3's backup button can reconcile later.
//   • Supabase-not-configured is a silent no-op. The app still works for
//     users who don't have cloud enabled.

import { supabaseConfigured } from './supabase-client';
import { authedFetch } from './authed-fetch';
import { compressToFitUploadLimit } from './image-compress';

// ─── Blob helpers ────────────────────────────────────────────────────────────

async function blobToBase64(blob) {
  if (!blob) return null;
  const buf = await blob.arrayBuffer();
  // Chunk the binary-to-string conversion so we don't blow the call stack on
  // large files (btoa's String.fromCharCode.apply would RangeError beyond ~65k).
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ─── Low-level POST ──────────────────────────────────────────────────────────

async function postSync(body) {
  if (!supabaseConfigured) return { skipped: true };
  try {
    // Phase 5c: include the user's JWT so the server can enforce role checks
    // and stamp owner_id from a trusted source. authedFetch silently does
    // nothing extra when there's no session (pre-login fire-and-forget
    // will just 401 — which is fine since we're logged in by then anyway).
    const res = await authedFetch('/api/cloud-sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn('[cloud-sync] non-OK', body.kind, body.action, res.status, detail.slice(0, 200));
      // v4.5.21: Surface the server's error message to the caller so the
      // backup runner's failure summary can show WHY it failed instead of
      // just "0/N". Try to parse JSON ({error,detail}) first; fall back to
      // the raw text. Bubble status alongside so the UI can hint at HTTP
      // class (401 → re-auth, 403 → role gate, 5xx → server bug).
      let errMsg = `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(detail);
        const parts = [parsed.error, parsed.detail].filter(Boolean);
        if (parts.length) errMsg = `${res.status}: ${parts.join(' — ')}`;
      } catch {
        if (detail) errMsg = `${res.status}: ${detail.slice(0, 200)}`;
      }
      return { ok: false, status: res.status, error: errMsg };
    }
    return { ok: true };
  } catch (err) {
    console.warn('[cloud-sync] network', body.kind, body.action, err?.message);
    return { ok: false, error: err?.message || 'network error' };
  }
}

// Fire in the background — never await this from a user action.
// Callers that want to know pass `await cloud.syncMedia(...)`.
function fireAndForget(body) {
  postSync(body).catch(() => {});
}

// ─── Records: shape the local records into their cloud equivalents ──────────
// Local field names mostly map directly. Only the ones that differ need an
// explicit mapper — keeps the rest trivial.

function mapMediaToRow(r) {
  return {
    id: r.id,
    name: r.name,
    mime_type: r.blob?.type || r.mimeType || null,
    width: r.width || null,
    height: r.height || null,
    size_bytes: r.blob?.size ?? r.sizeBytes ?? null,
    team: r.team || null,
    player: r.player || null,
    first_initial: r.firstInitial || null,
    num: r.num || null,
    asset_type: r.assetType || null,
    scope: r.scope || 'player',
    variant: r.variant || null,
    drive_file_id: r.driveFileId || null,
    source: r.source || 'upload',
    tags: r.tags || {},
  };
}

function mapOverlayToRow(r) {
  return {
    id: r.id,
    name: r.name,
    type: r.type || null,
    team: r.team || null,
    platform: r.platform || null,
    width: r.width || null,
    height: r.height || null,
  };
}

function mapEffectToRow(r) {
  return {
    id: r.id,
    name: r.name,
    width: r.width || null,
    height: r.height || null,
  };
}

function mapRequestToRow(r) {
  return {
    id: r.id,
    team: r.team,
    template: r.template || null,
    status: r.status || 'pending',
    priority: r.priority || 'medium',
    requester: r.requester || null,
    note: r.note || null,
    // v4.4.0 fields. Sent on every upsert; columns added via the
    // schema migration in /api/cloud-sync.js header. If the columns
    // are absent (pre-migration), Supabase upsert ignores unknown
    // keys silently — no breakage.
    type: r.type || 'content',
    title: r.title || null,
    need_by: r.needBy || null,
    requester_email: r.requesterEmail || null,
    requester_user_id: r.requesterUserId || null,
    player_last_name: r.playerLastName || null,
    player_first_initial: r.playerFirstInitial || null,
    notified_at: r.notifiedAt || null,
    // createdAt is a ms epoch on the local record — Supabase has its own
    // created_at default + updated_at, so we don't force it here.
  };
}

function mapCommentToRow(c) {
  return {
    id: c.id,
    request_id: c.requestId,
    author: c.author || null,
    role: c.role || null,
    text: c.text,
  };
}

function mapPlayerToRow(p) {
  return {
    id: p.id,
    first_name: p.firstName || null,
    last_name: p.lastName,
    team: p.team,
    num: p.num || null,
    position: p.position || null,
    notes: p.notes || null,
    // Vitals (migration 004). Send nullable values through as-is — if the
    // columns don't exist on the cloud yet the insert still succeeds
    // because Postgrest ignores unknown keys in updates.
    height_in:  p.heightIn  ?? p.height_in  ?? null,
    weight_lbs: p.weightLbs ?? p.weight_lbs ?? null,
    birthdate:  p.birthdate ?? null,
    bats:       p.bats || null,
    throws:     p.throws || null,
    birthplace: p.birthplace || null,
    status:     p.status || null,
    nickname:   p.nickname || null,
    // Profile-pic override (db/005). NULL keeps the default headshot
    // heuristic; a media.id points at a specific uploaded asset.
    profile_media_id: p.profileMediaId ?? p.profile_media_id ?? null,
    // Profile-pic pan/zoom positioning (db/009). NULLs mean "identity"
    // — the avatar renders as plain object-fit:cover, no scale.
    profile_offset_x: p.profileOffsetX ?? p.profile_offset_x ?? null,
    profile_offset_y: p.profileOffsetY ?? p.profile_offset_y ?? null,
    profile_zoom:     p.profileZoom    ?? p.profile_zoom    ?? null,
    // Player-facing extras (db/006). Surfaced as a dropdown badge + a
    // ROOKIE chip on the PlayerHero.
    instagram_handle: p.instagramHandle ?? p.instagram_handle ?? null,
    fun_facts:        p.funFacts ?? p.fun_facts ?? null,
    is_rookie:        p.isRookie ?? p.is_rookie ?? null,
    // Athlete self-authored "About me" — free-form vibe / references /
    // backstory the player wants the AI to know about them. Fed into
    // the /api/ideas prompt as a per-player context block. JSON so we
    // can structure it (vibes, references, walkup music, etc.) without
    // a schema change every time a new field gets added.
    athlete_voice:    p.athleteVoice ?? p.athlete_voice ?? null,
    // Strict 1:1 binding to a profiles.id. NULL means no athlete
    // account is linked to this player yet. Master admin manages the
    // linkage; athletes can edit their own About-me only when this
    // field equals their auth user.id.
    user_id:          p.userId ?? p.user_id ?? null,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const cloud = {
  // Media — needs both the blob and the metadata.
  // v4.5.22: re-compress oversized blobs to fit Vercel's 4.5 MB function
  // payload limit. The first-pass auto-compression at upload time is
  // 1920px / q=0.85, which is plenty for the canvas pipeline but can
  // still exceed the limit on high-megapixel sports cameras after the
  // base64 inflation (~33%). compressToFitUploadLimit progressively
  // walks down to 800px / q=0.65 until something fits.
  async syncMedia(record) {
    if (!record?.id) return;
    const fit = await compressToFitUploadLimit(record.blob);
    const base64 = await blobToBase64(fit.blob);
    fireAndForget({
      kind: 'media', action: 'upsert',
      record: mapMediaToRow(record),
      blob: base64 ? { base64, mime: fit.blob?.type || record.blob?.type || 'application/octet-stream' } : null,
    });
  },
  deleteMedia(id) {
    if (!id) return;
    fireAndForget({ kind: 'media', action: 'delete', id });
  },

  // Overlays
  async syncOverlay(record) {
    if (!record?.id) return;
    const fit = await compressToFitUploadLimit(record.imageBlob);
    const base64 = await blobToBase64(fit.blob);
    fireAndForget({
      kind: 'overlay', action: 'upsert',
      record: mapOverlayToRow(record),
      blob: base64 ? { base64, mime: fit.blob?.type || record.imageBlob?.type || 'image/png' } : null,
    });
  },
  deleteOverlay(id) {
    if (!id) return;
    fireAndForget({ kind: 'overlay', action: 'delete', id });
  },

  // Effects
  async syncEffect(record) {
    if (!record?.id) return;
    const fit = await compressToFitUploadLimit(record.imageBlob);
    const base64 = await blobToBase64(fit.blob);
    fireAndForget({
      kind: 'effect', action: 'upsert',
      record: mapEffectToRow(record),
      blob: base64 ? { base64, mime: fit.blob?.type || record.imageBlob?.type || 'image/png' } : null,
    });
  },
  deleteEffect(id) {
    if (!id) return;
    fireAndForget({ kind: 'effect', action: 'delete', id });
  },

  // Requests (text-only)
  syncRequest(record) {
    if (!record?.id) return;
    fireAndForget({ kind: 'request', action: 'upsert', record: mapRequestToRow(record) });
  },
  deleteRequest(id) {
    if (!id) return;
    fireAndForget({ kind: 'request', action: 'delete', id });
  },

  // Request comments
  syncRequestComment(record) {
    if (!record?.id) return;
    fireAndForget({ kind: 'request-comment', action: 'upsert', record: mapCommentToRow(record) });
  },
  deleteRequestComment(id) {
    if (!id) return;
    fireAndForget({ kind: 'request-comment', action: 'delete', id });
  },

  // Manual players
  syncManualPlayer(record) {
    if (!record?.id) return;
    fireAndForget({ kind: 'manual-player', action: 'upsert', record: mapPlayerToRow(record) });
  },
  deleteManualPlayer(id) {
    if (!id) return;
    fireAndForget({ kind: 'manual-player', action: 'delete', id });
  },

  // Field overrides (composite PK — upsert needs the full triple)
  syncFieldOverride(templateType, platform, fieldKey, fields) {
    if (!templateType || !platform || !fieldKey) return;
    fireAndForget({
      kind: 'field-override', action: 'upsert',
      record: {
        template_type: templateType, platform, field_key: fieldKey,
        x: fields.x ?? null, y: fields.y ?? null,
        font_size: fields.fontSize ?? null,
        font: fields.font ?? null,
        color: fields.color ?? null,
      },
    });
  },
  deleteFieldOverride(templateType, platform, fieldKey) {
    if (!templateType || !platform || !fieldKey) return;
    fireAndForget({
      kind: 'field-override', action: 'delete',
      record: { template_type: templateType, platform, field_key: fieldKey },
    });
  },

  // AI usage (composite PK — day + kind)
  syncAiUsage(day, kind, count) {
    if (!day || !kind) return;
    fireAndForget({
      kind: 'ai-usage', action: 'upsert',
      record: { day, kind, count: count || 0 },
    });
  },

  // Generate log — one entry per PNG download. Thumbnail is a small dataURL
  // produced from the preview canvas that we upload alongside the row so the
  // dashboard can show a gallery of recent posts.
  async logGenerate({ id, team, templateType, platform, settings, thumbnailDataUrl }) {
    if (!id) return;
    let blobPayload = null;
    if (thumbnailDataUrl && thumbnailDataUrl.startsWith('data:')) {
      // Extract base64 + mime from the data URL.
      const match = thumbnailDataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        blobPayload = { base64: match[2], mime: match[1] };
      }
    }
    fireAndForget({
      kind: 'generate-log', action: 'upsert',
      record: {
        id,
        team: team || null,
        template_type: templateType || null,
        platform: platform || null,
        settings: settings || {},
      },
      blob: blobPayload,
    });
  },
};

// ─── Reads (used by dashboard recent posts + settings history) ──────────────

export async function fetchRecentGenerates(limit = 10) {
  if (!supabaseConfigured) return [];
  try {
    // v4.5.20: cloud-sync requires an authed JWT. Plain `fetch()` was
    // 401-ing silently for every dashboard/team/player view, which is
    // why the recent-posts strips have been empty since the auth wall
    // landed. authedFetch attaches the bearer token from the active
    // Supabase session.
    const res = await authedFetch(`/api/cloud-sync?kind=generate-log&limit=${limit}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.records || []).map(r => ({
      id: r.id,
      team: r.team,
      templateType: r.template_type,
      platform: r.platform,
      settings: r.settings || {},
      thumbnailUrl: r.signedUrl || null,
      createdAt: r.created_at ? new Date(r.created_at) : null,
      // Same semantics as fetchTeamMonthlyPosts: null/undefined → true
      // (matches the column default + the UI's optimistic assumption
      // that anything generated was posted unless explicitly marked).
      posted: r.posted == null ? true : !!r.posted,
    }));
  } catch {
    return [];
  }
}

// Per-team monthly post count. Powers the content-calendar progress
// bar on each team page. Counts entries in `generate_log` for `team`
// since the first day of the current calendar month, filtered to
// posts that have been MARKED AS POSTED (posted=true). The master
// admin can toggle posts to "not posted" from the team carousel,
// which removes them from this count without deleting the entry.
// Auto-resets at month rollover via the dynamic since-date.
//
// Returns a number (0+). Soft-fails to 0 when Supabase isn't
// configured or the request errors — the bar just renders an empty
// state in that case, which is correct.
export async function fetchTeamMonthlyPostCount(team) {
  if (!supabaseConfigured || !team) return 0;
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const params = new URLSearchParams({
      kind: 'generate-log',
      team,
      since: monthStart,
      posted: 'true',
      fields: 'id,team,created_at',
      limit: '500',
    });
    const res = await authedFetch(`/api/cloud-sync?${params.toString()}`);
    if (!res.ok) return 0;
    const data = await res.json();
    return Array.isArray(data.records) ? data.records.length : 0;
  } catch {
    return 0;
  }
}

// Per-team monthly post records (with thumbnails). Powers the team-page
// carousel rendered below the progress bar. Returns ALL posts for the
// team this month — both posted and unposted — so the carousel can
// render unposted ones in a greyed state. Caller filters / sorts as
// needed.
//
// Records carry: { id, team, templateType, platform, settings,
// thumbnailUrl, createdAt, posted }.
export async function fetchTeamMonthlyPosts(team) {
  if (!supabaseConfigured || !team) return [];
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const params = new URLSearchParams({
      kind: 'generate-log',
      team,
      since: monthStart,
      limit: '500',
    });
    const res = await authedFetch(`/api/cloud-sync?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.records || []).map(r => ({
      id: r.id,
      team: r.team,
      templateType: r.template_type,
      platform: r.platform,
      settings: r.settings || {},
      thumbnailUrl: r.signedUrl || null,
      createdAt: r.created_at ? new Date(r.created_at) : null,
      // Default to true when the column is absent (pre-migration). The
      // counter and the carousel both treat null/undefined as "posted"
      // so behavior is identical to the column's default.
      posted: r.posted == null ? true : !!r.posted,
    }));
  } catch {
    return [];
  }
}

// Toggle whether a generate-log entry is "posted." Authed PATCH against
// /api/cloud-sync. Returns true on success. Caller is responsible for
// the optimistic local update + counter recompute.
export async function setGenerateLogPosted(id, posted) {
  if (!supabaseConfigured || !id) return false;
  try {
    const res = await authedFetch('/api/cloud-sync', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'generate-log', id, fields: { posted: !!posted } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Lightweight cloud-side existence check. Returns a Set of IDs that
// already have a storage_path (i.e. the blob is fully uploaded). Used
// by the backup runner to skip media/overlays/effects that are already
// in the cloud, so re-running backup is incremental instead of redoing
// every record.
export async function fetchUploadedIds(kind) {
  if (!supabaseConfigured) return new Set();
  try {
    const pathCol = kind === 'generate-log' ? 'thumbnail_storage_path' : 'storage_path';
    const res = await authedFetch(`/api/cloud-sync?kind=${kind}&fields=id,${pathCol}`);
    if (!res.ok) return new Set();
    const data = await res.json();
    const ids = new Set();
    for (const r of (data.records || [])) {
      if (r && r.id && r[pathCol]) ids.add(r.id);
    }
    return ids;
  } catch {
    return new Set();
  }
}

// Awaitable versions — Phase 3's migration tool uses these so it can count
// successes and surface progress.
export const cloudAwait = {
  async syncMedia(record) {
    if (!supabaseConfigured || !record?.id) return { skipped: true };
    // v4.5.22: fit under Vercel's 4.5 MB function payload limit. Mirrors
    // the cloud.syncMedia path so backup runs and live uploads share a
    // single compression policy.
    const fit = await compressToFitUploadLimit(record.blob);
    if (!fit.fitted) {
      return { ok: false, status: 413, error: `413: blob did not fit under upload limit even after re-compression (${fit.reason || 'unknown'})` };
    }
    const base64 = await blobToBase64(fit.blob);
    return postSync({
      kind: 'media', action: 'upsert',
      record: mapMediaToRow(record),
      blob: base64 ? { base64, mime: fit.blob?.type || record.blob?.type || 'application/octet-stream' } : null,
    });
  },
  async syncOverlay(record) {
    if (!supabaseConfigured || !record?.id) return { skipped: true };
    const fit = await compressToFitUploadLimit(record.imageBlob);
    if (!fit.fitted) {
      return { ok: false, status: 413, error: `413: overlay did not fit under upload limit (${fit.reason || 'unknown'})` };
    }
    const base64 = await blobToBase64(fit.blob);
    return postSync({
      kind: 'overlay', action: 'upsert',
      record: mapOverlayToRow(record),
      blob: base64 ? { base64, mime: fit.blob?.type || record.imageBlob?.type || 'image/png' } : null,
    });
  },
  async syncEffect(record) {
    if (!supabaseConfigured || !record?.id) return { skipped: true };
    const fit = await compressToFitUploadLimit(record.imageBlob);
    if (!fit.fitted) {
      return { ok: false, status: 413, error: `413: effect did not fit under upload limit (${fit.reason || 'unknown'})` };
    }
    const base64 = await blobToBase64(fit.blob);
    return postSync({
      kind: 'effect', action: 'upsert',
      record: mapEffectToRow(record),
      blob: base64 ? { base64, mime: fit.blob?.type || record.imageBlob?.type || 'image/png' } : null,
    });
  },
  async syncRequest(record) {
    if (!supabaseConfigured || !record?.id) return { skipped: true };
    return postSync({ kind: 'request', action: 'upsert', record: mapRequestToRow(record) });
  },
  async syncRequestComment(record) {
    if (!supabaseConfigured || !record?.id) return { skipped: true };
    return postSync({ kind: 'request-comment', action: 'upsert', record: mapCommentToRow(record) });
  },
  async syncManualPlayer(record) {
    if (!supabaseConfigured || !record?.id) return { skipped: true };
    return postSync({ kind: 'manual-player', action: 'upsert', record: mapPlayerToRow(record) });
  },
  async syncFieldOverride(templateType, platform, fieldKey, fields) {
    if (!supabaseConfigured) return { skipped: true };
    return postSync({
      kind: 'field-override', action: 'upsert',
      record: {
        template_type: templateType, platform, field_key: fieldKey,
        x: fields.x ?? null, y: fields.y ?? null,
        font_size: fields.fontSize ?? null,
        font: fields.font ?? null,
        color: fields.color ?? null,
      },
    });
  },
  async syncAiUsage(day, kind, count) {
    if (!supabaseConfigured) return { skipped: true };
    return postSync({
      kind: 'ai-usage', action: 'upsert',
      record: { day, kind, count: count || 0 },
    });
  },
};
