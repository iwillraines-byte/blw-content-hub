// Vercel serverless function: per-user read markers for request threads.
//
//   GET  /api/request-reads
//        → { reads: [{ requestId, lastReadAt }] } for the calling user.
//
//   POST /api/request-reads   body { requestId }
//        Upserts last_read_at = NOW() for (user, request). Called when the
//        user opens a thread; everything newer than this stamp (authored by
//        someone else) counts as unread.
//
// Stored server-side (not localStorage) so reading a thread on one device
// clears the unread badge on every other device the user owns.
//
// Soft-fail contract: when the request_reads table is missing (db/020
// unrun) both methods return 200 with { tableMissing: true } — the client
// degrades to zero badges instead of erroring.

import { requireUser, missingConfigResponse } from './_supabase.js';

const TABLE = 'request_reads';

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
  const { sb, user } = ctx;
  if (!sb) { missingConfigResponse(res); return; }

  try {
    if (req.method === 'GET') {
      const { data, error } = await sb.from(TABLE)
        .select('request_id, last_read_at')
        .eq('user_id', user.id);
      if (error) {
        if (isMissingTable(error)) { res.status(200).json({ reads: [], tableMissing: true }); return; }
        res.status(500).json({ error: 'DB error', detail: error.message });
        return;
      }
      res.status(200).json({
        reads: (data || []).map(r => ({ requestId: r.request_id, lastReadAt: r.last_read_at })),
      });
      return;
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      const requestId = String(body?.requestId || '').slice(0, 200);
      if (!requestId) { res.status(400).json({ error: 'requestId required' }); return; }
      const { error } = await sb.from(TABLE).upsert({
        user_id: user.id,
        request_id: requestId,
        last_read_at: new Date().toISOString(),
      }, { onConflict: 'user_id,request_id' });
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
  api: { bodyParser: { sizeLimit: '16kb' } },
};
