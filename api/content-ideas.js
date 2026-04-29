// Vercel serverless function: persistent store for AI / deterministic
// content ideas surfaced across the dashboard, team pages, and player
// pages.
//
// An idea row is keyed by its slug-style id (matching what /api/ideas
// already mints, e.g. "leader-jaso-ops"). On generate, /api/ideas
// upserts each idea here so the dashboard re-render can refetch them
// instead of holding them in component state — and so team/player
// pages can render the same ideas filtered by team or player.
//
// 14-day rolling retention is enforced at READ time (`created_at >
// NOW() - INTERVAL '14 days'`). Old rows hang around in the table
// harmlessly but don't appear in the UI; a periodic SQL cleanup is
// optional and not required for correctness.
//
// ─── Required Supabase schema ─────────────────────────────────────────────
//
//   CREATE TABLE IF NOT EXISTS content_ideas (
//     id                  TEXT PRIMARY KEY,
//     headline            TEXT NOT NULL,
//     narrative           TEXT,
//     description         TEXT,
//     team                TEXT NOT NULL,
//     player_last_name    TEXT,
//     player_first_initial TEXT,
//     template_id         TEXT,
//     angle               TEXT,
//     data_points         JSONB DEFAULT '[]'::jsonb,
//     captions            JSONB DEFAULT '{}'::jsonb,
//     prefill             JSONB DEFAULT '{}'::jsonb,
//     source              TEXT NOT NULL DEFAULT 'ai',
//     created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//     updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//     created_by          TEXT
//   );
//   CREATE INDEX IF NOT EXISTS content_ideas_team_idx        ON content_ideas (team);
//   CREATE INDEX IF NOT EXISTS content_ideas_team_player_idx ON content_ideas (team, player_last_name);
//   CREATE INDEX IF NOT EXISTS content_ideas_created_at_idx  ON content_ideas (created_at DESC);
//
// ─── Endpoints ────────────────────────────────────────────────────────────
//
//   GET  /api/content-ideas?team=AZS&player=jaso&limit=50
//        → { ideas: [...] }   sorted newest-first, age-filtered to 14 days.
//        Any authed user can read.
//
//   POST /api/content-ideas
//        body { ideas: [...] } — bulk upsert. master_admin/admin/content
//        roles only. Used by /api/ideas to persist what it just generated.
//
//   PATCH /api/content-ideas?id=XYZ
//        body { captions, ... } — partial update. master_admin/admin/content.
//
//   DELETE /api/content-ideas?id=XYZ
//        Hard delete. master_admin/admin/content.

import { getServiceClient, requireUser, requireRole, missingConfigResponse } from './_supabase.js';

const TABLE = 'content_ideas';
const RETENTION_DAYS = 14;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Fields a row can carry. Extra keys on the input are ignored.
const ROW_FIELDS = [
  'id', 'headline', 'narrative', 'description', 'team',
  'player_last_name', 'player_first_initial', 'template_id', 'angle',
  'data_points', 'captions', 'prefill', 'source', 'created_by',
];

// Map an idea object (camelCase, as it lives in JS) into a row (snake_case).
// Tolerates partial input — only sets fields that are explicitly present.
export function ideaToRow(idea, { createdBy = null } = {}) {
  if (!idea || !idea.id || !idea.headline || !idea.team) return null;
  // Player extraction — pull lastname + first-initial from prefill.playerName
  // when the template is player-scoped. This is what the player-page filter
  // matches against.
  let playerLast = idea.player_last_name || null;
  let playerFI = idea.player_first_initial || null;
  if ((!playerLast || !playerFI) && idea.prefill && idea.prefill.playerName) {
    const parts = String(idea.prefill.playerName).trim().split(/\s+/);
    if (parts.length >= 1) {
      const last = parts[parts.length - 1];
      const fi = (parts[0] || '').charAt(0).toUpperCase();
      if (!playerLast && last) playerLast = last;
      if (!playerFI && fi) playerFI = fi;
    }
  }
  const row = {
    id: idea.id,
    headline: idea.headline,
    narrative: idea.narrative || null,
    description: idea.description || null,
    team: idea.team,
    player_last_name: playerLast ? String(playerLast).toUpperCase() : null,
    player_first_initial: playerFI ? String(playerFI).toUpperCase() : null,
    template_id: idea.templateId || idea.template_id || null,
    angle: idea.angle || null,
    data_points: Array.isArray(idea.dataPoints) ? idea.dataPoints : (Array.isArray(idea.data_points) ? idea.data_points : []),
    captions: idea.captions && typeof idea.captions === 'object' ? idea.captions : {},
    prefill: idea.prefill && typeof idea.prefill === 'object' ? idea.prefill : {},
    source: idea.source || (idea.aiGenerated ? 'ai' : 'deterministic'),
    created_by: createdBy,
  };
  return row;
}

// Inverse — row (snake_case) → idea (camelCase, as the IdeaCard expects).
export function rowToIdea(row) {
  if (!row) return null;
  return {
    id: row.id,
    headline: row.headline,
    narrative: row.narrative || '',
    description: row.description || '',
    team: row.team,
    templateId: row.template_id || '',
    angle: row.angle || '',
    dataPoints: Array.isArray(row.data_points) ? row.data_points : [],
    captions: row.captions && typeof row.captions === 'object' ? row.captions : {},
    prefill: row.prefill && typeof row.prefill === 'object' ? row.prefill : {},
    aiGenerated: row.source === 'ai',
    createdAt: row.created_at,
    playerLastName: row.player_last_name || null,
    playerFirstInitial: row.player_first_initial || null,
  };
}

// ─── Server-callable helper ──────────────────────────────────────────────
// Used internally by /api/ideas to persist newly generated ideas without
// having to round-trip through HTTP. Caller passes the SAME service-role
// supabase client they already have.
export async function persistIdeas(sb, ideas, { createdBy = null } = {}) {
  if (!Array.isArray(ideas) || ideas.length === 0) return { inserted: 0, errors: [] };
  const rows = ideas.map(i => ideaToRow(i, { createdBy })).filter(Boolean);
  if (rows.length === 0) return { inserted: 0, errors: [] };
  // Upsert so a regenerated idea with the same id replaces the old row
  // instead of dropping a constraint error.
  const { data, error } = await sb.from(TABLE).upsert(rows, { onConflict: 'id' }).select('id');
  if (error) {
    // Soft-fail: idea generation should still succeed even if persistence
    // is broken (table missing, RLS misconfigured). Caller logs but doesn't
    // bounce the user.
    return { inserted: 0, errors: [{ message: error.message, code: error.code }] };
  }
  return { inserted: data?.length || 0, errors: [] };
}

// ─── HTTP handler ────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const ctx = await requireUser(req, res);
  if (!ctx) return;
  const { profile, sb } = ctx;
  if (!sb) { missingConfigResponse(res); return; }

  const isWrite = req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE';
  if (isWrite && requireRole(res, profile, ['master_admin', 'admin', 'content'])) return;

  try {
    if (req.method === 'GET') return handleGet(req, res, sb);
    if (req.method === 'POST') return handlePost(req, res, sb, profile);
    if (req.method === 'PATCH') return handlePatch(req, res, sb);
    if (req.method === 'DELETE') return handleDelete(req, res, sb);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
}

async function handleGet(req, res, sb) {
  const { team, player, limit } = req.query || {};
  const lim = Math.min(MAX_LIMIT, Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT));
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let q = sb.from(TABLE).select('*').gte('created_at', cutoff).order('created_at', { ascending: false }).limit(lim);
  if (team) q = q.eq('team', String(team).toUpperCase());
  if (player) q = q.eq('player_last_name', String(player).toUpperCase());

  const { data, error } = await q;
  if (error) {
    const missing = /relation .* does not exist/i.test(error.message)
      || error.code === '42P01' || error.code === 'PGRST205';
    if (missing) {
      // Surface the setup hint inline so the dashboard can show a banner
      // without us 500'ing.
      res.status(200).json({ ideas: [], tableMissing: true });
      return;
    }
    res.status(500).json({ error: 'DB error', detail: error.message });
    return;
  }
  res.status(200).json({ ideas: (data || []).map(rowToIdea) });
}

async function handlePost(req, res, sb, profile) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const ideas = Array.isArray(body?.ideas) ? body.ideas : (body?.idea ? [body.idea] : []);
  if (ideas.length === 0) { res.status(400).json({ error: 'ideas array required' }); return; }
  const createdBy = profile?.display_name || profile?.email || profile?.id || null;
  const result = await persistIdeas(sb, ideas, { createdBy });
  if (result.errors.length) {
    const first = result.errors[0];
    const missing = /relation .* does not exist/i.test(first.message || '')
      || first.code === '42P01' || first.code === 'PGRST205';
    if (missing) {
      res.status(503).json({ error: 'content_ideas table missing', detail: 'Run the CREATE TABLE statement in api/content-ideas.js header' });
      return;
    }
    res.status(500).json({ error: 'DB error', detail: first.message });
    return;
  }
  res.status(200).json({ inserted: result.inserted });
}

async function handlePatch(req, res, sb) {
  const id = req.query?.id;
  if (!id) { res.status(400).json({ error: 'id query param required' }); return; }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  // Whitelist patchable fields. id, created_at, source are immutable here.
  const patch = {};
  if (body?.captions && typeof body.captions === 'object') patch.captions = body.captions;
  if (Array.isArray(body?.dataPoints)) patch.data_points = body.dataPoints;
  if (typeof body?.headline === 'string') patch.headline = body.headline;
  if (typeof body?.narrative === 'string') patch.narrative = body.narrative;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'no patchable fields supplied' });
    return;
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await sb.from(TABLE).update(patch).eq('id', id).select('*').maybeSingle();
  if (error) { res.status(500).json({ error: 'DB error', detail: error.message }); return; }
  if (!data) { res.status(404).json({ error: 'idea not found' }); return; }
  res.status(200).json({ idea: rowToIdea(data) });
}

async function handleDelete(req, res, sb) {
  const id = req.query?.id;
  if (!id) { res.status(400).json({ error: 'id query param required' }); return; }
  const { error } = await sb.from(TABLE).delete().eq('id', id);
  if (error) { res.status(500).json({ error: 'DB error', detail: error.message }); return; }
  res.status(200).json({ ok: true });
}

export const config = {
  api: { bodyParser: { sizeLimit: '256kb' } },
};
