// Browser-side Supabase client — uses the public anon key.
//
// Phase 5a (auth): persistSession is now ON. The SDK keeps the session token
// in localStorage under `blw-auth-v1` and refreshes it in the background.
// `detectSessionInUrl` lets magic-link redirects land directly on our app —
// in PKCE mode (v4.5.45+) the SDK exchanges the URL code for a session
// transparently on /auth/callback.
//
// v4.5.45 — flow switched implicit → PKCE.
// WHY: with `flowType: 'implicit'` the magic-link URL itself was the
// access token. Corporate email scanners (Outlook 365, Mimecast,
// Barracuda, Gmail's image proxy in some configs) GET every URL in
// inbound mail to check for malware — that GET burned the one-time
// token before the human ever clicked. Result: legitimate admins
// reported "link expired" within minutes of the master sending it.
//
// PKCE moves the token off the URL. The link now carries a `?code=...`
// that's only exchangeable for tokens by the browser holding the
// matching `code_verifier` (stashed in localStorage when the user
// requested the link). A scanner GET sees the code but can't redeem
// it — only the user's actual browser can. Side effect: the user MUST
// click the email from the same device/browser they requested it on.
// For Login → "send me a link" that's basically always the same
// device. For Settings → People & Roles invitations the invited user
// has no prior session, so PKCE doesn't apply there — those still use
// implicit-style tokens (vulnerable, but Supabase mitigates with a
// 24h default expiry, configurable in the Auth dashboard).
//
// Row Level Security: per-table policies are now in place (db/003,
// db/012). The browser client respects them on direct reads/writes;
// most data access still flows through /api/cloud-* with service_role.

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
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // v4.5.45: PKCE — see header comment. Defeats email-scanner
        // token-burn for the regular sign-in flow.
        flowType: 'pkce',
        storageKey: 'blw-auth-v1',
      },
    })
  : null;
