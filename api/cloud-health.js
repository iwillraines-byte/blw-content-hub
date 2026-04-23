// Diagnostic endpoint for Phase 1 — verifies the Supabase service-role key
// reaches the project, the schema is applied, and the storage buckets exist.
// Safe to leave in prod — it doesn't expose anything sensitive.
//
// Call via: GET /api/cloud-health

import { getServiceClient, missingConfigResponse } from './_supabase.js';

const EXPECTED_TABLES = [
  'media', 'overlays', 'effects', 'requests', 'request_comments',
  'manual_players', 'field_overrides', 'ai_usage',
];
const EXPECTED_BUCKETS = ['media', 'overlays', 'effects'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const sb = getServiceClient();
  if (!sb) return missingConfigResponse(res);

  const result = {
    configured: true,
    tables: {},
    buckets: {},
    ready: true,
    notes: [],
  };

  // Probe each expected table. We just need to know "can I query it?" so we
  // select 0 rows with head:true which returns metadata only.
  for (const table of EXPECTED_TABLES) {
    try {
      const { error, count } = await sb
        .from(table)
        .select('*', { count: 'exact', head: true });
      if (error) {
        result.tables[table] = { ok: false, error: error.message };
        result.ready = false;
      } else {
        result.tables[table] = { ok: true, rows: count ?? 0 };
      }
    } catch (err) {
      result.tables[table] = { ok: false, error: err.message };
      result.ready = false;
    }
  }

  // Probe buckets
  try {
    const { data: buckets, error } = await sb.storage.listBuckets();
    if (error) {
      result.notes.push(`listBuckets failed: ${error.message}`);
      result.ready = false;
    } else {
      const found = new Set((buckets || []).map(b => b.name));
      for (const name of EXPECTED_BUCKETS) {
        if (found.has(name)) {
          result.buckets[name] = { ok: true };
        } else {
          result.buckets[name] = { ok: false, error: 'bucket not found' };
          result.ready = false;
        }
      }
    }
  } catch (err) {
    result.notes.push(`bucket probe failed: ${err.message}`);
    result.ready = false;
  }

  if (!result.ready) {
    result.notes.push('Run db/001_initial_schema.sql in the Supabase SQL Editor to create missing tables/buckets.');
  }

  res.status(result.ready ? 200 : 503).json(result);
}
