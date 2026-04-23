// Browser-side Supabase client — uses the public anon key.
//
// Phase 5a (auth): persistSession is now ON. The SDK keeps the session token
// in localStorage under `sb-<project-ref>-auth-token` and refreshes it in the
// background. `detectSessionInUrl` lets magic-link redirects land directly on
// our app with the access token in the URL hash and the SDK parses it out.
//
// Row Level Security policies land in Phase 5b. Until then, ALL direct table
// reads/writes from this browser client will be denied by default (RLS
// default-deny is already enabled on every table from db/001_initial_schema).
// All data access in the app still flows through our /api/cloud-* serverless
// endpoints which use the service_role key on the server.

import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = !!(URL && ANON);

// When env vars aren't set (local dev without a Supabase project, for example)
// we export a no-op client that throws on any query. That way the app still
// boots — the cloud features just show "not configured" states.
export const supabase = supabaseConfigured
  ? createClient(URL, ANON, {
      auth: {
        // Phase 5a: keep the user signed in across page loads and tabs.
        persistSession: true,
        // Refresh the JWT in the background before it expires.
        autoRefreshToken: true,
        // Parse magic-link tokens from the URL hash on landing.
        detectSessionInUrl: true,
        // Use implicit flow — tokens come back in the hash, not a code-exchange.
        flowType: 'implicit',
        storageKey: 'blw-auth-v1',
      },
    })
  : null;
