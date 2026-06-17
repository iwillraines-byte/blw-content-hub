// Team join codes — master_admin only. Powers signup verification: the master
// sets/rotates a secret code per team and shares it in that team's private
// channel; the db/023 trigger flags a claim "verified" when the registrant
// enters the matching code. Codes only ever leave the server through this
// master-gated endpoint.
//
// GET  /api/team-codes   — list { team_id, code, updated_at }[]
// POST /api/team-codes   — set/generate a team's code. Body: { team_id, code? }
//                          (code omitted → a fresh random one)

import { requireUser, requireAdmin } from './_supabase.js';

function genCode() {
  // 6 chars, ambiguous 0/O/1/I removed so codes are easy to read aloud.
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export default async function handler(req, res) {
  const ctx = await requireUser(req, res);
  if (!ctx) return;
  if (requireAdmin(res, ctx.profile)) return;
  // Codes are a verification secret — master only, not general admins.
  if (ctx.profile?.role !== 'master_admin') {
    return res.status(403).json({ error: 'master_admin only' });
  }
  const { sb } = ctx;

  try {
    if (req.method === 'GET') {
      const { data, error } = await sb
        .from('team_join_codes')
        .select('team_id, code, updated_at');
      if (error) {
        // Pre-db/023: table doesn't exist yet — soft-empty so the UI renders.
        if (/team_join_codes|relation|does not exist/i.test(error.message || '')) {
          return res.status(200).json({ codes: [], tableMissing: true });
        }
        throw error;
      }
      return res.status(200).json({ codes: data || [] });
    }

    if (req.method === 'POST') {
      const { team_id, code } = req.body || {};
      if (!team_id || typeof team_id !== 'string') {
        return res.status(400).json({ error: 'team_id is required' });
      }
      const value = (typeof code === 'string' && code.trim())
        ? code.trim().toUpperCase().slice(0, 24)
        : genCode();
      const { data, error } = await sb
        .from('team_join_codes')
        .upsert({ team_id, code: value, updated_at: new Date().toISOString() }, { onConflict: 'team_id' })
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ code: data });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[team-codes]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
