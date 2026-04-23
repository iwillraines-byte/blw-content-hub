// Reports Supabase storage + table row counts so the Files page can show a
// "47 MB used / 1 GB free" style usage meter. Cheap enough to call on every
// Files page mount — one row-count per table, one list per bucket.
//
// Response:
// {
//   configured: true,
//   storage: { media: { bytes: N, count: N }, overlays: {...}, effects: {...}, total: { bytes, count } },
//   tables: { media: { rows: N }, requests: { rows: N }, ... },
//   limits: { storageBytes: 1_073_741_824, dbRows: 500_000 },   // free-tier ballpark
// }

import { getServiceClient, missingConfigResponse } from './_supabase.js';

const BUCKETS = ['media', 'overlays', 'effects'];
const TABLES = [
  'media', 'overlays', 'effects', 'requests', 'request_comments',
  'manual_players', 'field_overrides', 'ai_usage',
];

// Supabase free tier, accurate as of 2025 (keeping code ref conservative):
//   • 1 GB storage
//   • 500 MB database (no hard row cap; size-limited)
// We show bytes against the 1 GB ceiling — most relevant to this app since
// media is the thing that grows fastest.
const FREE_TIER_STORAGE_BYTES = 1024 * 1024 * 1024;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const sb = getServiceClient();
  if (!sb) return missingConfigResponse(res);

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
    tables,
    limits: { storageBytes: FREE_TIER_STORAGE_BYTES },
  });
}
