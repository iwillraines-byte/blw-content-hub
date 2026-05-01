// Cloud-synced app settings.
//
// Single key/value store backed by Supabase's `app_settings` table.
// Read access: any authenticated user. Write access: master_admin only.
//
// Usage today:
//   key='drive' → { apiKey, folders: [{ id, name, addedAt }] }
//
// Future keys can land here without schema changes (request brand
// guidelines, feature flags, league-wide caption templates, etc.)
//
// Wire shape:
//   GET  /api/app-settings?key=drive       → { value: {...} | null }
//   POST /api/app-settings  body { key, value }  (master_admin only)

import { requireUser, requireRole } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = await requireUser(req, res);
  if (!ctx) return;
  const sb = ctx.sb;

  if (req.method === 'GET') {
    const key = String(req.query?.key || '').trim();
    if (!key) {
      res.status(400).json({ error: 'key query param required' });
      return;
    }
    try {
      const { data, error } = await sb
        .from('app_settings')
        .select('key, value, updated_at')
        .eq('key', key)
        .maybeSingle();
      if (error) throw error;
      res.status(200).json({
        value: data?.value || null,
        updatedAt: data?.updated_at || null,
      });
    } catch (err) {
      console.error('[app-settings GET]', key, err);
      res.status(500).json({ error: 'app-settings read failed', detail: err.message });
    }
    return;
  }

  if (req.method === 'POST') {
    if (requireRole(res, ctx.profile, ['master_admin'])) return;
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const key = String(body?.key || '').trim();
    const value = body?.value;
    if (!key) {
      res.status(400).json({ error: 'key required' });
      return;
    }
    if (value === undefined) {
      res.status(400).json({ error: 'value required' });
      return;
    }
    try {
      const row = {
        key,
        value,
        updated_at: new Date().toISOString(),
        updated_by: ctx.user.id,
      };
      const { error } = await sb
        .from('app_settings')
        .upsert(row, { onConflict: 'key' });
      if (error) throw error;
      res.status(200).json({ ok: true, updatedAt: row.updated_at });
    } catch (err) {
      console.error('[app-settings POST]', key, err);
      res.status(500).json({ error: 'app-settings write failed', detail: err.message });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'Method not allowed' });
}
