// Reports Supabase storage + table row counts so the Files page can show a
// "47 MB used / 100 GB" style usage meter. Cheap enough to call on every
// Files page mount — one row-count per table, one list per bucket.
//
// Response:
// {
//   configured: true,
//   storage: { media: { bytes: N, count: N }, overlays: {...}, effects: {...}, total: { bytes, count } },
//   tables: { media: { rows: N }, requests: { rows: N }, ... },
//   limits: { storageBytes: 107_374_182_400, plan: 'pro' },
// }

import { getServiceClient, missingConfigResponse, requireUser, requireRole } from './_supabase.js';

const BUCKETS = ['media', 'overlays', 'effects'];
const TABLES = [
  'media', 'overlays', 'effects', 'requests', 'request_comments',
  'manual_players', 'field_overrides', 'ai_usage',
];

// Supabase Pro tier as of 2026:
//   • 100 GB storage included (additional GB billed at usage rates)
//   • 8 GB database, 250 GB egress
// The Files page shows bytes against this ceiling so the team can see at
// a glance how much of the league media archive they've consumed.
//
// Tweak this constant if/when the plan changes — it's the only place the
// UI reads its limit from. Override at deploy time via env var if you'd
// rather not touch source: SUPABASE_STORAGE_LIMIT_BYTES (number of bytes).
const PRO_TIER_STORAGE_BYTES = 100 * 1024 * 1024 * 1024;
const STORAGE_LIMIT_BYTES = Number(process.env.SUPABASE_STORAGE_LIMIT_BYTES) || PRO_TIER_STORAGE_BYTES;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Storage meter — staff-only. Athletes don't see the Files page at all.
  const ctx = await requireUser(req, res);
  if (!ctx) return;
  if (requireRole(res, ctx.profile, ['master_admin', 'admin', 'content'])) return;
  const sb = ctx.sb;
  if (!sb) return missingConfigResponse(res);

  // Per-team rollup. Source of truth is the `media` TABLE — we read
  // each row's stamped `team` column AND its `size_bytes` so the
  // breakdown reflects how each photo was tagged at upload time, not
  // how its filename happens to look. The previous implementation
  // parsed team from the storage object NAME (e.g. "LAN_03_JASO_…"),
  // but Supabase stores objects under "{uuid}.{ext}" — there's no team
  // prefix in the path — so every file landed in OTHER. The table
  // path is authoritative AND fast (one indexed query instead of
  // listing the whole bucket page-by-page).
  //
  // Fallback safety: rows with a missing or non-canonical team code
  // still land in OTHER so the chart never silently drops bytes.
  const BLW_TEAMS = new Set(['LAN', 'AZS', 'LV', 'NYG', 'DAL', 'BOS', 'PHI', 'CHI', 'MIA', 'SDO']);
  const byTeam = {};
  try {
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await sb
        .from('media')
        .select('team, size_bytes')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) {
        const raw = String(r.team || '').toUpperCase();
        const teamKey = raw === 'BLW' ? 'BLW'
          : BLW_TEAMS.has(raw) ? raw
          : 'OTHER';
        const sz = Number(r.size_bytes) || 0;
        if (!byTeam[teamKey]) byTeam[teamKey] = { bytes: 0, count: 0 };
        byTeam[teamKey].bytes += sz;
        byTeam[teamKey].count += 1;
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
  } catch (err) {
    // Soft-fail — the rest of the storage panel still renders even
    // if the per-team query 500s. Errors surface as a single OTHER
    // bucket carrying the bytes from the storage list pass below.
    byTeam.__error = err.message;
  }

  const storage = { total: { bytes: 0, count: 0 } };
  for (const bucket of BUCKETS) {
    try {
      // Supabase list returns pages; 1000 is the default max. Most setups
      // will stay well under that but paginate defensively.
      let bytes = 0, count = 0, offset = 0;
      while (true) {
        const { data, error } = await sb.storage.from(bucket).list('', {
          limit: 1000, offset, sortBy: { column: 'created_at', order: 'asc' },
        });
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const obj of data) {
          // Folders come back with metadata: null
          if (obj.metadata?.size != null) {
            bytes += obj.metadata.size;
            count += 1;
          }
        }
        if (data.length < 1000) break;
        offset += data.length;
      }
      storage[bucket] = { bytes, count };
      storage.total.bytes += bytes;
      storage.total.count += count;
    } catch (err) {
      storage[bucket] = { error: err.message, bytes: 0, count: 0 };
    }
  }

  const tables = {};
  for (const t of TABLES) {
    try {
      const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true });
      if (error) throw error;
      tables[t] = { rows: count ?? 0 };
    } catch (err) {
      tables[t] = { error: err.message };
    }
  }

  res.status(200).json({
    configured: true,
    storage,
    byTeam,
    tables,
    limits: { storageBytes: STORAGE_LIMIT_BYTES, plan: 'pro' },
  });
}
