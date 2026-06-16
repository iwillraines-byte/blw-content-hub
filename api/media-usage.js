// Vercel serverless function: media usage analytics (v4.20.0).
//
//   POST /api/media-usage   body { mediaId, kind: 'download'|'studio' }
//        Atomic increment via the increment_media_usage RPC (db/022).
//        Any authed staff (the people who download/use media). Fire-and-forget
//        from the client — never blocks a download/export.
//
//   GET  /api/media-usage?action=top&limit=30        (master_admin only)
//        → { rows: [{ mediaId, name, team, download, studio, total,
//                      lastAt, lastUserName, ownerName }] }
//        The "Most-used media" leaderboard for Settings.
//
//   GET  /api/media-usage?action=uploaders           (master_admin only)
//        → { uploaders: { [mediaId]: { ownerId, ownerName, createdAt } } }
//        Who/when each library file was added — surfaced on the Files page.
//
// Soft-fails when db/022 isn't applied yet: POST no-ops, GET returns empty.

import { requireUser, requireRole, missingConfigResponse } from './_supabase.js';
import { checkRateLimit } from './_rate-limit.js';

const VALID_KINDS = new Set(['download', 'studio']);

function isMissing(error) {
  return /relation .* does not exist|function .* does not exist|could not find/i.test(error?.message || '')
    || error?.code === '42P01' || error?.code === '42883' || error?.code === 'PGRST202' || error?.code === 'PGRST205';
}

// Build an id → "Display Name" (or email) map from a list of profile ids.
async function profileNameMap(sb, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data } = await sb.from('profiles').select('id, email, display_name').in('id', uniq);
  const map = {};
  for (const p of (data || [])) map[p.id] = p.display_name || p.email || 'Unknown';
  return map;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const ctx = await requireUser(req, res);
  if (!ctx) return;
  const { sb, user, profile } = ctx;
  if (!sb) { missingConfigResponse(res); return; }

  try {
    if (req.method === 'POST') {
      if (await checkRateLimit(ctx, 'media-usage', res)) return;
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const mediaId = String(body?.mediaId || '').slice(0, 100);
      const kind = String(body?.kind || '');
      if (!mediaId || !VALID_KINDS.has(kind)) { res.status(400).json({ error: 'mediaId + valid kind required' }); return; }
      const { error } = await sb.rpc('increment_media_usage', {
        p_media_id: mediaId, p_kind: kind, p_user_id: user.id,
      });
      if (error) {
        if (isMissing(error)) { res.status(200).json({ ok: false, tableMissing: true }); return; }
        res.status(500).json({ error: 'DB error', detail: error.message });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'GET') {
      // Both GET actions are master-only — they expose who-did-what.
      if (requireRole(res, profile, ['master_admin'])) return;
      const action = req.query?.action || 'top';

      if (action === 'uploaders') {
        const { data: media, error } = await sb.from('media')
          .select('id, owner_id, created_at')
          .limit(5000);
        if (error) {
          if (isMissing(error)) { res.status(200).json({ uploaders: {}, tableMissing: true }); return; }
          res.status(500).json({ error: 'DB error', detail: error.message });
          return;
        }
        const names = await profileNameMap(sb, (media || []).map(m => m.owner_id));
        const uploaders = {};
        for (const m of (media || [])) {
          uploaders[m.id] = {
            ownerId: m.owner_id || null,
            ownerName: m.owner_id ? (names[m.owner_id] || 'Unknown') : null,
            createdAt: m.created_at || null,
          };
        }
        res.status(200).json({ uploaders });
        return;
      }

      // action === 'top' — the leaderboard.
      const limit = Math.min(parseInt(req.query?.limit, 10) || 30, 100);
      const { data: usage, error } = await sb.from('media_usage')
        .select('media_id, kind, count, last_at, last_user_id')
        .order('count', { ascending: false })
        .limit(500);
      if (error) {
        if (isMissing(error)) { res.status(200).json({ rows: [], tableMissing: true }); return; }
        res.status(500).json({ error: 'DB error', detail: error.message });
        return;
      }

      // Roll up per media id.
      const byMedia = new Map();
      for (const u of (usage || [])) {
        const cur = byMedia.get(u.media_id) || { mediaId: u.media_id, download: 0, studio: 0, total: 0, lastAt: null, lastUserId: null };
        if (u.kind === 'download') cur.download = u.count;
        else if (u.kind === 'studio') cur.studio = u.count;
        cur.total = cur.download + cur.studio;
        if (!cur.lastAt || (u.last_at && u.last_at > cur.lastAt)) { cur.lastAt = u.last_at; cur.lastUserId = u.last_user_id; }
        byMedia.set(u.media_id, cur);
      }
      const ranked = [...byMedia.values()].sort((a, b) => b.total - a.total).slice(0, limit);

      // Join media metadata (name/team/owner) + resolve user names.
      const mediaIds = ranked.map(r => r.mediaId);
      const mediaMeta = {};
      if (mediaIds.length) {
        const { data: media } = await sb.from('media').select('id, name, team, owner_id').in('id', mediaIds);
        for (const m of (media || [])) mediaMeta[m.id] = m;
      }
      const names = await profileNameMap(sb, [
        ...ranked.map(r => r.lastUserId),
        ...Object.values(mediaMeta).map(m => m.owner_id),
      ]);

      const rows = ranked.map(r => {
        const m = mediaMeta[r.mediaId] || {};
        return {
          mediaId: r.mediaId,
          name: m.name || '(deleted file)',
          team: m.team || '',
          download: r.download,
          studio: r.studio,
          total: r.total,
          lastAt: r.lastAt,
          lastUserName: r.lastUserId ? (names[r.lastUserId] || 'Unknown') : null,
          ownerName: m.owner_id ? (names[m.owner_id] || 'Unknown') : null,
        };
      });
      res.status(200).json({ rows });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};
