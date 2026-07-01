// Media integrity scan (v5.2.0) — master_admin only.
//
// Surfaces profile-photo pins that point at media which is NOT usable on other
// devices: either the referenced media row doesn't exist, or it exists with no
// blob in storage (storage_path null). These are the rows that render blank on
// a fresh device — the "photos vanish when I log in elsewhere" bug.
//
// Wire shape:
//   GET /api/media-health  → { orphans: [{ id, name, team, num, profile_media_id, reason }], scanned }
//   reason ∈ 'media-missing' (no media row) | 'no-blob' (row exists, storage_path null)

import { requireUser, requireRole } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = await requireUser(req, res);
  if (!ctx) return;
  if (requireRole(res, ctx.profile, ['master_admin'])) return;
  const sb = ctx.sb;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' });
    return;
  }

  try {
    // Every player row that has pinned a profile photo.
    const { data: pinned, error: pinErr } = await sb
      .from('manual_players')
      .select('id, name, first_name, last_name, team, num, profile_media_id')
      .not('profile_media_id', 'is', null);
    if (pinErr) throw pinErr;

    const ids = [...new Set((pinned || []).map(p => p.profile_media_id).filter(Boolean))];
    // Which of those media ids actually have a blob in storage?
    const storageById = new Map();
    if (ids.length) {
      const { data: mediaRows, error: mediaErr } = await sb
        .from('media')
        .select('id, storage_path')
        .in('id', ids);
      if (mediaErr) throw mediaErr;
      for (const m of (mediaRows || [])) storageById.set(m.id, m.storage_path || null);
    }

    const orphans = [];
    for (const p of (pinned || [])) {
      const hasRow = storageById.has(p.profile_media_id);
      const path = storageById.get(p.profile_media_id);
      if (!hasRow) {
        orphans.push({ ...pubRow(p), reason: 'media-missing' });
      } else if (!path) {
        orphans.push({ ...pubRow(p), reason: 'no-blob' });
      }
    }

    res.status(200).json({ scanned: (pinned || []).length, orphans });
  } catch (err) {
    console.error('[media-health]', err);
    res.status(500).json({ error: 'media-health scan failed', detail: err.message });
  }
}

function pubRow(p) {
  return {
    id: p.id,
    name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
    team: p.team || null,
    num: p.num || null,
    profile_media_id: p.profile_media_id,
  };
}
