// Vercel serverless function: League Context store.
//
// A single-row table that holds free-form prose the master admin types in
// to give the BLW AI tools narrative grounding — trades, draft results,
// storylines, rivalries, anything that isn't in the live stats feed.
//
// The text is injected into /api/ideas (and any future generators) as a
// "LEAGUE NARRATIVES" section of the system prompt. So when the admin types
// "Caleb Jeter just signed with Dallas — was the FA prize of the season,"
// every subsequent ideas batch knows it.
//
// ─── Required Supabase schema ─────────────────────────────────────────────
//
//   CREATE TABLE IF NOT EXISTS league_context (
//     id          INTEGER PRIMARY KEY DEFAULT 1,
//     notes       TEXT NOT NULL DEFAULT '',
//     updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//     updated_by  TEXT,
//     CONSTRAINT singleton CHECK (id = 1)
//   );
//   INSERT INTO league_context (id) VALUES (1) ON CONFLICT DO NOTHING;
//
// (RLS off — this endpoint uses the service-role key directly.)
//
// ─── Endpoints ────────────────────────────────────────────────────────────
//
//   GET  /api/league-context  → { notes, updated_at, updated_by }
//                                Any authed user can read.
//   PUT  /api/league-context  → { notes }
//                                master_admin only. Body: { notes: string }
//                                Returns the saved row.
//
// If the table is missing, GET responds 200 with an empty notes string +
// a `tableMissing: true` flag so the UI can surface a one-time setup hint.

import { getServiceClient, requireUser, requireRole, missingConfigResponse } from './_supabase.js';

const TABLE = 'league_context';
const ROW_ID = 1;
const MAX_NOTES_CHARS = 8000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const ctx = await requireUser(req, res);
  if (!ctx) return; // 401 already sent
  const { profile, sb } = ctx;
  if (!sb) { missingConfigResponse(res); return; }

  if (req.method === 'GET') {
    const { data, error } = await sb
      .from(TABLE)
      .select('notes, updated_at, updated_by')
      .eq('id', ROW_ID)
      .maybeSingle();
    if (error) {
      // Table-not-found is a 42P01 in PostgREST — surface the hint instead
      // of failing hard so the dashboard can render a setup banner.
      const missing = /relation .* does not exist/i.test(error.message)
        || error.code === '42P01'
        || error.code === 'PGRST205';
      if (missing) {
        res.status(200).json({ notes: '', updated_at: null, updated_by: null, tableMissing: true });
        return;
      }
      res.status(500).json({ error: 'DB error', detail: error.message });
      return;
    }
    res.status(200).json({
      notes: data?.notes || '',
      updated_at: data?.updated_at || null,
      updated_by: data?.updated_by || null,
    });
    return;
  }

  if (req.method === 'PUT') {
    if (requireRole(res, profile, ['master_admin'])) return; // 403 already sent

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    let notes = (body?.notes ?? '').toString();
    if (notes.length > MAX_NOTES_CHARS) {
      res.status(413).json({ error: `notes exceeds ${MAX_NOTES_CHARS} char limit` });
      return;
    }
    // Trim CRLF/trailing whitespace — keeps the prompt clean.
    notes = notes.replace(/\r\n/g, '\n').trimEnd();

    const updated_by = profile?.display_name || profile?.email || profile?.id || null;
    const { data, error } = await sb
      .from(TABLE)
      .upsert({ id: ROW_ID, notes, updated_at: new Date().toISOString(), updated_by }, { onConflict: 'id' })
      .select('notes, updated_at, updated_by')
      .maybeSingle();
    if (error) {
      const missing = /relation .* does not exist/i.test(error.message)
        || error.code === '42P01'
        || error.code === 'PGRST205';
      if (missing) {
        res.status(503).json({ error: 'league_context table missing', detail: 'Run the CREATE TABLE statement in api/league-context.js header' });
        return;
      }
      res.status(500).json({ error: 'DB error', detail: error.message });
      return;
    }
    res.status(200).json(data || { notes, updated_at: null, updated_by });
    return;
  }

  res.status(405).json({ error: 'GET or PUT only' });
}

export const config = {
  api: { bodyParser: { sizeLimit: '32kb' } },
};
