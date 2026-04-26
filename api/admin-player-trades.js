// Admin endpoint for player team-affiliation overrides — trades, FA
// signings, retirements, anything where the source-of-truth API still
// lists the wrong team.
//
// Model: a row in `manual_players` with `team` set IS an override. When
// the data layer sees a manual row for a player, that team wins over
// whatever the Grand Slam Systems API reports. This endpoint creates,
// updates, and removes those rows.
//
// Routes (POST + an action key in the body):
//   { action: 'list' }                                   → all known overrides
//   { action: 'assign', name, team, num? }               → upsert override
//   { action: 'revoke', name }                           → delete override
//   { action: 'apply-preset', preset: 'trades-2026' }    → bulk preset
//
// All routes require role ∈ {master_admin, admin}.

import { requireUser, requireAdmin } from './_supabase.js';

// 2026-season preset trades hand-curated by the league commissioner.
// One-click apply via the admin tool. Idempotent — re-running just
// re-asserts the assignment (no dupes thanks to the upsert logic).
const PRESET_TRADES_2026 = [
  { name: 'Cael Foreman',          team: 'SDO' },
  { name: 'Jeff Lopes',            team: 'CHI' },
  { name: 'Brody Livingston',      team: 'PHI' },
  { name: 'Mike Stiles',           team: 'MIA' },
  { name: 'Caleb Jeter',           team: 'DAL' },
  { name: 'Ben Dulin',             team: 'DAL' },
  { name: 'Jackson Richardson',    team: 'AZS' },
  { name: 'Kyle Vonschleusingen',  team: 'BOS' },     // canonical spelling
  { name: 'Connor Smith',          team: 'SDO' },
  { name: 'Grant Miller',          team: 'CHI' },
  { name: 'Jimmy Cole',            team: 'PHI' },
  { name: 'Sean Hornberger',       team: 'MIA' },
  { name: 'Dallas Allen',          team: 'LAN' },
  { name: 'James Lee',             team: 'LV' },      // LVS → LV
  { name: 'Justin Lee',            team: 'LV' },
  { name: 'James Kline',           team: 'NYG' },
  { name: 'Konnor Jaso',           team: 'LV' },      // traded LAN → LV
  { name: 'Preston Kolm',          team: 'LAN' },     // traded LV → LAN
];

// Accept either LV (canonical) or the legacy LVS while we migrate any
// out-of-band callers. The DB migration 008 has already converted any
// existing rows; this just protects against stale clients.
const VALID_TEAMS = new Set(['LAN', 'AZS', 'LV', 'NYG', 'DAL', 'BOS', 'PHI', 'CHI', 'MIA', 'SDO']);
const LEGACY_TEAM_ALIAS = { LVS: 'LV' };

// Split "First Last" or "First Middle Last" into { firstName, lastName }.
// Single-token names go into lastName so the existing player-lookup logic
// (which keys on lastName) still finds them.
function splitName(full) {
  const s = String(full || '').trim();
  if (!s) return { firstName: '', lastName: '' };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { firstName: '', lastName: parts[0] };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

// Find an existing manual_players row that matches this name regardless
// of which team it currently sits on — otherwise an "assign" call would
// orphan duplicates every time a player moves.
async function resolveByName(sb, firstName, lastName) {
  const { data, error } = await sb.from('manual_players')
    .select('id, first_name, last_name, team, num')
    .ilike('last_name', lastName);
  if (error) throw error;
  if (!data || data.length === 0) return null;
  if (data.length === 1) return data[0];
  const fi = (firstName || '').charAt(0).toUpperCase();
  if (fi) {
    const exact = data.find(r => (r.first_name || '').toUpperCase() === firstName.toUpperCase());
    if (exact) return exact;
    const initial = data.find(r => (r.first_name || '').charAt(0).toUpperCase() === fi);
    if (initial) return initial;
  }
  return data[0];
}

// Upsert a team override. Creates a fresh manual_players row when no
// match exists; otherwise updates the existing one in place.
async function assignTeam(sb, { name, team, num }) {
  // Forgive legacy team ids the caller might still be sending.
  if (LEGACY_TEAM_ALIAS[team]) team = LEGACY_TEAM_ALIAS[team];
  if (!VALID_TEAMS.has(team)) throw new Error(`Unknown team id: ${team}`);
  const { firstName, lastName } = splitName(name);
  if (!lastName) throw new Error('Player name is required');

  const existing = await resolveByName(sb, firstName, lastName);
  if (existing) {
    const updates = { team };
    if (num) updates.num = String(num);
    if (firstName && !existing.first_name) updates.first_name = firstName;
    const { error } = await sb.from('manual_players').update(updates).eq('id', existing.id);
    if (error) throw error;
    return { id: existing.id, ...existing, ...updates, action: 'updated' };
  }
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const row = {
    id,
    first_name: firstName || null,
    last_name: lastName,
    team,
    num: num ? String(num) : null,
    position: null,
    notes: 'team override',
  };
  const { error } = await sb.from('manual_players').insert(row);
  if (error) throw error;
  return { ...row, action: 'created' };
}

async function revokeOverride(sb, name) {
  const { firstName, lastName } = splitName(name);
  if (!lastName) throw new Error('Player name is required');
  const existing = await resolveByName(sb, firstName, lastName);
  if (!existing) return { action: 'noop' };
  const { error } = await sb.from('manual_players').delete().eq('id', existing.id);
  if (error) throw error;
  return { action: 'deleted', id: existing.id };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const ctx = await requireUser(req, res);
  if (!ctx) return;
  if (requireAdmin(res, ctx.profile)) return;
  const sb = ctx.sb;

  const body = req.body || {};
  const { action } = body;

  try {
    if (action === 'list') {
      const { data, error } = await sb.from('manual_players')
        .select('id, first_name, last_name, team, num, position, notes, created_at, updated_at')
        .order('team', { ascending: true })
        .order('last_name', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ overrides: data || [] });
    }

    if (action === 'assign') {
      const result = await assignTeam(sb, {
        name: body.name,
        team: body.team,
        num: body.num,
      });
      return res.status(200).json({ result });
    }

    if (action === 'revoke') {
      const result = await revokeOverride(sb, body.name);
      return res.status(200).json({ result });
    }

    if (action === 'apply-preset') {
      const preset = body.preset || 'trades-2026';
      if (preset !== 'trades-2026') {
        return res.status(400).json({ error: `Unknown preset: ${preset}` });
      }
      const results = [];
      const errors = [];
      for (const trade of PRESET_TRADES_2026) {
        try {
          const r = await assignTeam(sb, trade);
          results.push({ name: trade.name, team: trade.team, action: r.action });
        } catch (e) {
          errors.push({ name: trade.name, team: trade.team, error: e.message });
        }
      }
      return res.status(200).json({
        total: PRESET_TRADES_2026.length,
        results,
        errors,
        successCount: results.length,
        errorCount: errors.length,
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('[admin-player-trades]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
