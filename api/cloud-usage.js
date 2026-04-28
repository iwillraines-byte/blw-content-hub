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

  // Team-prefix parser. Filenames in the media bucket follow
  //   "{TEAM}_{NUM}_{LASTNAME}_{ASSETTYPE}.png"   (player-scoped)
  //   "{TEAM}_{ASSETTYPE}.png"                    (team-scoped)
  // The team prefix is the first underscore-segment. We only count toward
  // a team if the prefix matches one of our BLW codes; anything else
  // (legacy, ad-hoc) lands in "OTHER" so the chart stays accurate.
  const BLW_TEAMS = new Set(['LAN', 'AZS', 'LV', 'NYG', 'DAL', 'BOS', 'PHI', 'CHI', 'MIA', 'SDO']);
  const teamFromPath = (path) => {
    if (!path) return 'OTHER';
    // Strip leading folders like "userId/" so we read the filename itself.
    const filename = path.split('/').pop() || path;
    const prefix = filename.split('_')[0]?.toUpperCase();
    return BLW_TEAMS.has(prefix) ? prefix : 'OTHER';
  };

  const storage = { total: { bytes: 0, count: 0 } };
  // Per-team rollup keyed by team code; each entry is { bytes, count }.
  const byTeam = {};
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
            // Only the media bucket carries team-tagged filenames; the
            // overlays/effects buckets are league-wide assets and roll
            // up under the bucket label rather than a team.
            if (bucket === 'media') {
              const team = teamFromPath(obj.name);
              if (!byTeam[team]) byTeam[team] = { bytes: 0, count: 0 };
              byTeam[team].bytes += obj.metadata.size;
              byTeam[team].count += 1;
            }
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
