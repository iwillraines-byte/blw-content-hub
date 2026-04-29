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

// ─── Phase 5c: Auth helpers ──────────────────────────────────────────────────
//
// Every protected endpoint uses requireUser() to:
//   1. Extract the Bearer token from the Authorization header
//   2. Validate the JWT using supabase.auth.getUser(token)
//   3. Load the user's profile row (role, team_id) for role-based gating
//   4. Return { user, profile } — or null after writing a 401
//
// Callers:
//   const ctx = await requireUser(req, res);
//   if (!ctx) return; // 401 already sent
//   if (!ctx.profile || !['master_admin','admin'].includes(ctx.profile.role)) {
//     return res.status(403).json({ error: 'Forbidden' });
//   }
//
// The service-role client is used to read the profile so RLS doesn't block us
// (the user's anon-scoped query would also work since they can read own row,
// but the service role is simpler and the endpoint is already trusted).

export async function requireUser(req, res) {
  const sb = getServiceClient();
  if (!sb) {
    missingConfigResponse(res);
    return null;
  }
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return null;
  }
  const token = match[1];
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
  const user = data.user;
  // Load the profile for role + team_id. If missing, continue with null
  // profile — some endpoints may still work (e.g. logging own activity).
  let profile = null;
  try {
    const { data: p } = await sb
      .from('profiles')
      .select('id, email, role, team_id, display_name')
      .eq('id', user.id)
      .maybeSingle();
    profile = p || null;
  } catch {
    // Profile table may not exist yet in a fresh deploy — don't fail auth.
  }
  return { user, profile, sb };
}

// Gating helper — returns true + sends a 403 if the role isn't allowed.
// Usage: if (requireRole(res, ctx.profile, ['master_admin','admin'])) return;
export function requireRole(res, profile, allowedRoles) {
  if (!profile || !allowedRoles.includes(profile.role)) {
    res.status(403).json({ error: 'Forbidden', detail: `role '${profile?.role || 'none'}' is not permitted` });
    return true;
  }
  return false;
}

// Shorthand for admin-only endpoints.
//
// Policy: in the simplified role model, "admin-only" === "master_admin".
// The legacy 'admin' tier is dormant — kept in the enum so a future
// operator can revive it, but no live account holds it. Endpoints that
// previously accepted both now collapse to master-only, matching the
// UI gating in Settings + PeopleAdmin. If you ever revive the admin
// tier, switch this back to ['master_admin', 'admin'] and audit each
// caller — some endpoints (people management, role escalation) should
// stay master-only regardless.
export function requireAdmin(res, profile) {
  return requireRole(res, profile, ['master_admin']);
}
