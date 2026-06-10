// Vercel serverless function: persistent thumbs feedback on content ideas.
//
// Votes were localStorage-only before v4.14.0 — each device only biased its
// own next generation. Now every vote upserts here (keyed idea_id + user_id)
// and /api/ideas reads the latest rows server-side, so the whole team's
// feedback shapes generation for everyone.
//
//   GET  /api/idea-feedback?limit=40
//        → { feedback: [{ id, vote, headline, angle, team, at }] }
//        newest-first. Any authed user can read.
//
//   POST /api/idea-feedback
//        body { ideaId, vote: 'up'|'down'|null, headline, angle, team }
//        vote null = retract (delete the row). Upsert keyed to the caller's
//        user id. Staff + athletes can vote; fans are read-only.
//
// Soft-fail contract: when the idea_feedback table is missing (db/019
// unrun) both methods return 200 with { tableMissing: true } so the client
// dual-write never surfaces an error toast for an infra gap.

import { requireUser, requireRole, missingConfigResponse } from './_supabase.js';
import { checkRateLimit } from './_rate-limit.js';

const TABLE = 'idea_feedback';
const MAX_LIMIT = 100;

function isMissingTable(error) {
  return /relation .* does not exist/i.test(error?.message || '')
    || error?.code === '42P01' || error?.code === 'PGRST205';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const ctx = await requireUser(req, res);
  if (!ctx) return;
  const { profile, sb, user } = ctx;
  if (!sb) { missingConfigResponse(res); return; }

  try {
    if (req.method === 'GET') {
      const lim = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query?.limit, 10) || 40));
      const { data, error } = await sb.from(TABLE)
        .select('idea_id, vote, headline, angle, team, created_at')
        .order('created_at', { ascending: false })
        .limit(lim);
      if (error) {
        if (isMissingTable(error)) { res.status(200).json({ feedback: [], tableMissing: true }); return; }
        res.status(500).json({ error: 'DB error', detail: error.message });
        return;
      }
      res.status(200).json({
        feedback: (data || []).map(r => ({
          id: r.idea_id, vote: r.vote,
          headline: r.headline || '', angle: r.angle || '', team: r.team || '',
          at: r.created_at,
        })),
      });
      return;
    }

    if (req.method === 'POST') {
      // Fans are read-only across the app — same gate here.
      if (requireRole(res, profile, ['master_admin', 'admin', 'content', 'athlete'])) return;
      if (await checkRateLimit(ctx, 'idea-feedback', res)) return;

      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      const ideaId = String(body?.ideaId || '').slice(0, 200);
      if (!ideaId) { res.status(400).json({ error: 'ideaId required' }); return; }
      const vote = body?.vote === 'up' || body?.vote === 'down' ? body.vote : null;

      if (vote === null) {
        const { error } = await sb.from(TABLE).delete()
          .eq('idea_id', ideaId).eq('user_id', user.id);
        if (error && !isMissingTable(error)) {
          res.status(500).json({ error: 'DB error', detail: error.message });
          return;
        }
        res.status(200).json({ ok: true, retracted: true, ...(isMissingTable(error || {}) ? { tableMissing: true } : {}) });
        return;
      }

      const row = {
        idea_id: ideaId,
        user_id: user.id,
        vote,
        headline: String(body?.headline || '').slice(0, 300) || null,
        angle: String(body?.angle || '').slice(0, 60) || null,
        team: String(body?.team || '').slice(0, 10) || null,
        created_at: new Date().toISOString(),
      };
      const { error } = await sb.from(TABLE).upsert(row, { onConflict: 'idea_id,user_id' });
      if (error) {
        if (isMissingTable(error)) { res.status(200).json({ ok: false, tableMissing: true }); return; }
        res.status(500).json({ error: 'DB error', detail: error.message });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '32kb' } },
};
