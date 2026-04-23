// Server-side Supabase helper for our /api/ endpoints. Uses the service_role
// key so it bypasses RLS — allowing the browser (via our API) to do privileged
// things like write media records even though the anon key can't do anything.
//
// Env vars expected on Vercel:
//   VITE_SUPABASE_URL           — project URL (also exposed to browser)
//   SUPABASE_SERVICE_ROLE_KEY   — server-only secret, NEVER prefix with VITE_
//
// Do NOT import this file from anywhere under src/ — it would leak the service
// role key into the client bundle. Only /api/*.js should ever touch it.

import { createClient } from '@supabase/supabase-js';

let _client = null;

export function getServiceClient() {
  if (_client) return _client;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

// Convenience: write a standardised "not configured" response. Phase 1-4
// endpoints gate on this so missing env vars produce clear 503s rather than
// mysterious 500s.
export function missingConfigResponse(res) {
  res.status(503).json({
    error: 'Supabase not configured',
    detail: 'VITE_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are missing from the server environment.',
  });
}
