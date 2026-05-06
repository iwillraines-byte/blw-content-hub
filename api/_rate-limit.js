// Shared rate-limiting helper for AI endpoints.
//
// v4.5.38 (security audit I2). Each AI endpoint calls checkRateLimit()
// at the top of the handler. The helper:
//   1. Increments a per-(user, endpoint, hour-bucket) counter via the
//      `increment_rate_limit` Postgres RPC (db/013).
//   2. Compares the new count against the role-specific limit.
//   3. If the limit is exceeded, sets the 429 response + Retry-After
//      header and returns true (caller `return`s out of its handler).
//   4. If under, returns false — caller proceeds normally.
//
// Limits are deliberately generous for staff and tight for athletes —
// athletes don't routinely call ideas/captions/auto-tag in their normal
// flow; the limit exists to bound damage from a compromised athlete
// account or a runaway script. Staff can be hit by legitimate bulk work
// (auto-tagging a 200-photo Drive folder), so they get the headroom.
//
// Failure mode: if the RPC fails (DB hiccup, missing migration), the
// helper logs and FAILS-OPEN — better to allow a few extra calls than
// to break the AI surface entirely. The endpoint-level requireUser()
// auth check still fires, so the worst case is "rate-limiting silently
// off" not "endpoint open to anonymous callers."

import { getServiceClient } from './_supabase.js';

// Per-endpoint, per-role limits. Hour-window. Tuned for ~100-user scale —
// staff caps are well above any plausible legitimate burst; athlete caps
// are above normal use but cap a runaway loop at <30s of damage.
const LIMITS = {
  ideas: {
    master_admin: 500,
    admin:        500,
    content:      300,
    athlete:       30,
  },
  captions: {
    master_admin: 600,
    admin:        600,
    content:      400,
    athlete:       60,
  },
  'auto-tag': {
    // Auto-tag is staff-only at the auth layer (see api/auto-tag.js).
    // We still set explicit caps so a compromised staff account can't
    // burn an entire Anthropic credit tier in a single afternoon.
    master_admin: 1000,
    admin:        1000,
    content:       500,
    athlete:         0, // shouldn't get past requireRole anyway, but explicit
  },
};

const DEFAULT_FALLBACK = 50;

/**
 * Increment + check the rate-limit for this user/endpoint pair.
 * Returns true when the request should be 429'd (caller must `return`).
 * Returns false when the request can proceed.
 *
 * @param {{user, profile}} ctx — from requireUser
 * @param {string} endpoint — short id matching LIMITS keys ('ideas', 'captions', 'auto-tag')
 * @param {object} res — Vercel response (used to send 429 headers + body when blocked)
 */
export async function checkRateLimit(ctx, endpoint, res) {
  if (!ctx?.user?.id) return false; // requireUser already gates; defensive
  const role = ctx.profile?.role || 'athlete';
  const cfg = LIMITS[endpoint];
  if (!cfg) return false; // Unknown endpoint — don't block
  const limit = cfg[role] ?? DEFAULT_FALLBACK;

  let count = 0;
  try {
    const sb = getServiceClient();
    const { data, error } = await sb.rpc('increment_rate_limit', {
      p_user_id: ctx.user.id,
      p_endpoint: endpoint,
    });
    if (error) {
      // Fail-open: log and allow. Better UX than breaking the AI surface
      // when the migration hasn't been applied yet or the RPC errored
      // for some transient reason.
      console.warn('[rate-limit] RPC failed; failing open:', endpoint, error.message);
      return false;
    }
    count = Number(data) || 0;
  } catch (err) {
    console.warn('[rate-limit] threw; failing open:', endpoint, err?.message);
    return false;
  }

  if (count > limit) {
    // Compute seconds until the next hour rolls so the client can back
    // off intelligently instead of guessing.
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(now.getHours() + 1);
    const retryAfter = Math.max(60, Math.round((nextHour - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'Rate limit exceeded',
      detail: `${endpoint}: ${count} calls this hour (${role} cap = ${limit}). Try again in ${Math.ceil(retryAfter / 60)} min.`,
      role,
      limit,
      count,
      retryAfterSeconds: retryAfter,
    });
    return true;
  }
  return false;
}
