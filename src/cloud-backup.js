// One-shot library backup runner. Iterates every local store and uploads
// whatever's there to Supabase via the awaitable cloud-sync helpers. Used
// by the "Back up library to cloud" button on the Files page (Phase 3).
//
// Reports progress via a callback so the UI can show a progress bar + a
// running success/fail count. The caller passes:
//   onProgress({ stage, done, total, record, error? })
//
// stage is one of:
//   'starting', 'media', 'overlays', 'effects', 'requests', 'comments',
//   'manualPlayers', 'fieldOverrides', 'aiUsage', 'done'
//
// We keep going on failures — the caller decides whether to surface
// per-item errors or just show a final summary.

import { cloudAwait, fetchUploadedIds } from './cloud-sync';
import { getAllMedia } from './media-store';
import { getOverlays, getEffects } from './overlay-store';
import { getAllManualPlayers } from './player-store';
import { getRequests, getComments } from './requests-store';

// ─── Helpers ────────────────────────────────────────────────────────────────

// Reads every field-override combo out of localStorage.
function readAllFieldOverrides() {
  try {
    const raw = localStorage.getItem('blw_field_overrides_v1');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

// Reads daily AI usage counts from localStorage.
function readAllAiUsage() {
  try {
    const raw = localStorage.getItem('blw_ai_usage_v1');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

// ─── Main ───────────────────────────────────────────────────────────────────

// `skipExisting` (default true): for blob kinds (media/overlays/effects),
// fetch the cloud's already-uploaded ID set first and skip records that
// are already there. Set false to force a full re-upload.
export async function backupLibraryToCloud({ onProgress, skipExisting = true } = {}) {
  const report = (stage, extra = {}) => {
    try { onProgress?.({ stage, ...extra }); } catch {}
  };
  const results = {
    media: { ok: 0, fail: 0, skipped: 0, errors: [] },
    overlays: { ok: 0, fail: 0, skipped: 0, errors: [] },
    effects: { ok: 0, fail: 0, skipped: 0, errors: [] },
    requests: { ok: 0, fail: 0, errors: [] },
    comments: { ok: 0, fail: 0, errors: [] },
    manualPlayers: { ok: 0, fail: 0, errors: [] },
    fieldOverrides: { ok: 0, fail: 0, errors: [] },
    aiUsage: { ok: 0, fail: 0, errors: [] },
  };

  report('starting');

  // v5 (audit): a 200 carrying droppedColumns means the server's tolerant
  // upsert stripped a column missing from the live schema (an unrun
  // migration) — that's a PARTIAL write, not a success. Count it as a
  // failure and name the columns so the backup summary tells the operator
  // which migration to run instead of silently reporting "N/N ok".
  const tally = (bucket, res, ident) => {
    const dropped = res?.droppedColumns;
    if (res?.ok && !(dropped && dropped.length)) { bucket.ok++; return; }
    bucket.fail++;
    bucket.errors.push({
      ...ident,
      error: dropped && dropped.length
        ? `migration unrun — dropped: ${dropped.join(', ')}`
        : (res?.error || res?.status || 'failed'),
    });
  };

  // ── MEDIA ────────────────────────────────────────────────────────────────
  try {
    const media = await getAllMedia();
    // Incremental backup: fetch the cloud's uploaded-ID set once and skip
    // anything already there. The check costs ~1 round-trip + a small JSON
    // payload, but saves N base64-encoded multi-MB uploads on subsequent runs.
    const existing = skipExisting ? await fetchUploadedIds('media') : new Set();
    const pending = media.filter(r => !existing.has(r.id));
    results.media.skipped = media.length - pending.length;
    report('media', { done: 0, total: pending.length, skipped: results.media.skipped });
    for (let i = 0; i < pending.length; i++) {
      const r = pending[i];
      const res = await cloudAwait.syncMedia(r);
      tally(results.media, res, { name: r.name });
      report('media', { done: i + 1, total: pending.length, skipped: results.media.skipped, record: r.name });
    }
  } catch (err) {
    results.media.errors.push({ error: err.message });
  }

  // ── OVERLAYS ─────────────────────────────────────────────────────────────
  try {
    const overlays = await getOverlays();
    const existing = skipExisting ? await fetchUploadedIds('overlay') : new Set();
    const pending = overlays.filter(r => !existing.has(r.id));
    results.overlays.skipped = overlays.length - pending.length;
    report('overlays', { done: 0, total: pending.length, skipped: results.overlays.skipped });
    for (let i = 0; i < pending.length; i++) {
      const r = pending[i];
      const res = await cloudAwait.syncOverlay(r);
      tally(results.overlays, res, { name: r.name });
      report('overlays', { done: i + 1, total: pending.length, skipped: results.overlays.skipped, record: r.name });
    }
  } catch (err) {
    results.overlays.errors.push({ error: err.message });
  }

  // ── EFFECTS ──────────────────────────────────────────────────────────────
  try {
    const effects = await getEffects();
    const existing = skipExisting ? await fetchUploadedIds('effect') : new Set();
    const pending = effects.filter(r => !existing.has(r.id));
    results.effects.skipped = effects.length - pending.length;
    report('effects', { done: 0, total: pending.length, skipped: results.effects.skipped });
    for (let i = 0; i < pending.length; i++) {
      const r = pending[i];
      const res = await cloudAwait.syncEffect(r);
      tally(results.effects, res, { name: r.name });
      report('effects', { done: i + 1, total: pending.length, skipped: results.effects.skipped, record: r.name });
    }
  } catch (err) {
    results.effects.errors.push({ error: err.message });
  }

  // ── REQUESTS ─────────────────────────────────────────────────────────────
  const requests = getRequests();
  report('requests', { done: 0, total: requests.length });
  for (let i = 0; i < requests.length; i++) {
    const r = requests[i];
    const res = await cloudAwait.syncRequest(r);
    tally(results.requests, res, { id: r.id });
    report('requests', { done: i + 1, total: requests.length });
  }

  // ── COMMENTS ─────────────────────────────────────────────────────────────
  const comments = getComments();
  report('comments', { done: 0, total: comments.length });
  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    const res = await cloudAwait.syncRequestComment(c);
    tally(results.comments, res, { id: c.id });
    report('comments', { done: i + 1, total: comments.length });
  }

  // ── MANUAL PLAYERS ───────────────────────────────────────────────────────
  try {
    const players = await getAllManualPlayers();
    report('manualPlayers', { done: 0, total: players.length });
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const res = await cloudAwait.syncManualPlayer(p);
      tally(results.manualPlayers, res, { id: p.id });
      report('manualPlayers', { done: i + 1, total: players.length });
    }
  } catch (err) {
    results.manualPlayers.errors.push({ error: err.message });
  }

  // ── FIELD OVERRIDES ──────────────────────────────────────────────────────
  const fieldOverrides = readAllFieldOverrides();
  // Flatten {combo → {field → overrides}} into [(combo, field, overrides)].
  const overrideRows = [];
  for (const [combo, fields] of Object.entries(fieldOverrides)) {
    const [templateType, platform] = combo.split(':');
    for (const [fieldKey, override] of Object.entries(fields)) {
      overrideRows.push({ templateType, platform, fieldKey, override });
    }
  }
  report('fieldOverrides', { done: 0, total: overrideRows.length });
  for (let i = 0; i < overrideRows.length; i++) {
    const { templateType, platform, fieldKey, override } = overrideRows[i];
    const res = await cloudAwait.syncFieldOverride(templateType, platform, fieldKey, override);
    tally(results.fieldOverrides, res, { templateType, platform, fieldKey });
    report('fieldOverrides', { done: i + 1, total: overrideRows.length });
  }

  // ── AI USAGE ─────────────────────────────────────────────────────────────
  const usage = readAllAiUsage();
  const usageRows = [];
  for (const [day, kinds] of Object.entries(usage)) {
    for (const [kind, count] of Object.entries(kinds)) {
      usageRows.push({ day, kind, count });
    }
  }
  report('aiUsage', { done: 0, total: usageRows.length });
  for (let i = 0; i < usageRows.length; i++) {
    const { day, kind, count } = usageRows[i];
    const res = await cloudAwait.syncAiUsage(day, kind, count);
    tally(results.aiUsage, res, { day, kind });
    report('aiUsage', { done: i + 1, total: usageRows.length });
  }

  report('done', { results });
  return results;
}
