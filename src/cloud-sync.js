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
    const res = await fetch('/api/cloud-sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn('[cloud-sync] non-OK', body.kind, body.action, res.status, detail.slice(0, 200));
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    console.warn('[cloud-sync] network', body.kind, body.action, err?.message);
    return { ok: false, error: err?.message };
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
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const cloud = {
  // Media — needs both the blob and the metadata.
  async syncMedia(record) {
    if (!record?.id) return;
    const base64 = await blobToBase64(record.blob);
    fireAndForget({
      kind: 'media', action: 'upsert',
      record: mapMediaToRow(record),
      blob: base64 ? { base64, mime: record.blob?.type || 'application/octet-stream' } : null,
    });
  },
  deleteMedia(id) {
    if (!id) return;
    fireAndForget({ kind: 'media', action: 'delete', id });
  },

  // Overlays
  async syncOverlay(record) {
    if (!record?.id) return;
    const base64 = await blobToBase64(record.imageBlob);
    fireAndForget({
      kind: 'overlay', action: 'upsert',
      record: mapOverlayToRow(record),
      blob: base64 ? { base64, mime: record.imageBlob?.type || 'image/png' } : null,
    });
  },
  deleteOverlay(id) {
    if (!id) return;
    fireAndForget({ kind: 'overlay', action: 'delete', id });
  },

  // Effects
  async syncEffect(record) {
    if (!record?.id) return;
    const base64 = await blobToBase64(record.imageBlob);
    fireAndForget({
      kind: 'effect', action: 'upsert',
      record: mapEffectToRow(record),
      blob: base64 ? { base64, mime: record.imageBlob?.type || 'image/png' } : null,
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
};

// Awaitable versions — Phase 3's migration tool uses these so it can count
// successes and surface progress.
export const cloudAwait = {
  async syncMedia(record) {
    if (!supabaseConfigured || !record?.id) return { skipped: true };
    const base64 = await blobToBase64(record.blob);
    return postSync({
      kind: 'media', action: 'upsert',
      record: mapMediaToRow(record),
      blob: base64 ? { base64, mime: record.blob?.type || 'application/octet-stream' } : null,
    });
  },
  async syncOverlay(record) {
    if (!supabaseConfigured || !record?.id) return { skipped: true };
    const base64 = await blobToBase64(record.imageBlob);
    return postSync({
      kind: 'overlay', action: 'upsert',
      record: mapOverlayToRow(record),
      blob: base64 ? { base64, mime: record.imageBlob?.type || 'image/png' } : null,
    });
  },
  async syncEffect(record) {
    if (!supabaseConfigured || !record?.id) return { skipped: true };
    const base64 = await blobToBase64(record.imageBlob);
    return postSync({
      kind: 'effect', action: 'upsert',
      record: mapEffectToRow(record),
      blob: base64 ? { base64, mime: record.imageBlob?.type || 'image/png' } : null,
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
