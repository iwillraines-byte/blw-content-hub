// Browser-side Supabase client — uses the public anon key. Row Level Security
// is enabled on every table in the project, so this client can read/write
// NOTHING until we add RLS policies in Phase 5 (auth + roles).
//
// In Phases 1-4 the browser talks to Supabase EXCLUSIVELY via our /api/
// serverless endpoints (which use the service_role key). This client is
// still exported for future use — once auth lands, pages can query
// directly with RLS-enforced access.

import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = !!(URL && ANON);

// When env vars aren't set (local dev without a Supabase project, for example)
// we export a no-op client that throws on any query. That way the app still
// boots — the cloud features just show "not configured" states.
export const supabase = supabaseConfigured
  ? createClient(URL, ANON, {
      auth: { persistSession: false }, // phase 5 will flip this
    })
  : null;
