// Auth context — wraps the app so any component can read the current user,
// session, AND profile (role + team_id) without wiring listeners itself.
// This is the ONLY place in the app that subscribes to
// `supabase.auth.onAuthStateChange` and queries the `profiles` table.
//
// Phase 5b surface:
//   useAuth()       → { user, session, profile, role, teamId, loading, profileLoading, signOut, isConfigured,
//                       realRole, realTeamId, viewingAs, setViewAs }
//   useCurrentUser() convenience alias — just the user object (nullable)
//   useRole()        convenience — current role or null
//
// Roles (see db/003 migration):
//   master_admin → you; manages all users including admins
//   admin        → ops; manages content/athlete users
//   content      → internal content creator; full app access except People tab
//   athlete      → player/coach; restricted to their team for content generation
//
// ─── View-as (impersonation) ──────────────────────────────────────────────
// Master admins can preview the app as any role + team without signing out.
// `useAuth()` returns the EFFECTIVE role/teamId (override if set, real
// otherwise), so every existing gate (RequireRole, HomeRedirect, MyStats
// scoping, sidebar nav filter) automatically respects it. The override is
// stored in localStorage so refreshes preserve the impersonation, and is
// CLIENT-SIDE ONLY — server-side endpoints still authorise against the
// real JWT, so an athlete view can't, say, edit league context. Setting
// the override is gated to real master_admin role on the client; this is
// a UX feature for a trusted user, not a security boundary.

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase, supabaseConfigured } from './supabase-client';

const VIEW_AS_KEY = 'blw_view_as';

function loadViewAs() {
  try {
    const raw = localStorage.getItem(VIEW_AS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.role) return null;
    return parsed;
  } catch { return null; }
}

function saveViewAs(value) {
  try {
    if (value) localStorage.setItem(VIEW_AS_KEY, JSON.stringify(value));
    else localStorage.removeItem(VIEW_AS_KEY);
  } catch {}
}

const AuthContext = createContext({
  user: null,
  session: null,
  profile: null,
  role: null,
  teamId: null,
  realRole: null,
  realTeamId: null,
  viewingAs: null,
  setViewAs: () => {},
  loading: true,
  profileLoading: false,
  profileError: false,
  signOut: async () => {},
  refreshProfile: async () => {},
  isConfigured: false,
});

// Fetch the current user's profile row. RLS allows SELECT on their own row
// (or any row if they're admin). We query `.maybeSingle()` so a missing
// profile doesn't throw — it just resolves to null and we fall back to
// 'athlete' defaults on the client until the trigger catches up.
async function fetchProfile(userId) {
  if (!supabaseConfigured || !userId) return null;
  try {
    // v4.5.7: pull role_expires_at for time-boxed elevated access.
    // v4.8.0: pull needs_password_setup for the force-set gate.
    // Each new column is wrapped in a retry-on-error fallback so a
    // deploy that ran the code update before its SQL migration doesn't
    // 500 every profile fetch and brick the entire app.
    let { data, error } = await supabase
      .from('profiles')
      .select('id, email, role, team_id, display_name, created_at, updated_at, role_expires_at, needs_password_setup')
      .eq('id', userId)
      .maybeSingle();
    if (error && /needs_password_setup/i.test(error.message || '')) {
      // Migration 016 hasn't been applied — drop the column and retry.
      const retry = await supabase
        .from('profiles')
        .select('id, email, role, team_id, display_name, created_at, updated_at, role_expires_at')
        .eq('id', userId)
        .maybeSingle();
      data = retry.data;
      error = retry.error;
    }
    if (error && /role_expires_at/i.test(error.message || '')) {
      const fallback = await supabase
        .from('profiles')
        .select('id, email, role, team_id, display_name, created_at, updated_at')
        .eq('id', userId)
        .maybeSingle();
      data = fallback.data;
      error = fallback.error;
    }
    if (error) {
      // A read error (network / RLS / transient Supabase blip) is NOT the
      // same as "no profile row exists." Returning null here is what showed a
      // fully-provisioned master_admin the "Profile setup required" screen
      // over a momentary hiccup. THROW instead, so the caller's retry/backoff
      // runs and a transient error never strips a user of their profile.
      throw new Error(`profile fetch failed: ${error.message}`);
    }
    // Genuine empty result (query succeeded, no row) — this IS a real
    // un-provisioned account, so returning null (→ setup screen) is correct.
    if (!data) return null;
    // Demote when the elevated role has expired. Keep the original role
    // available as expiredRole so the UI can render an "access expired"
    // state instead of a generic "no permissions" screen.
    if (data.role_expires_at) {
      const expired = new Date(data.role_expires_at).getTime() <= Date.now();
      if (expired) {
        return { ...data, expiredRole: data.role, role: null };
      }
    }
    return data;
  } catch (err) {
    // Re-throw so the caller (the retrying profile effect) can distinguish a
    // failed read from a genuine empty result. Swallowing to null here was the
    // bug that surfaced "Profile setup required" on a transient failure.
    console.warn('[auth] profile fetch threw', err);
    throw err;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  // While loading is true we render a splash — avoids "logged out flash"
  // on a hard refresh before Supabase restores the session from storage.
  const [loading, setLoading] = useState(supabaseConfigured);
  const [profileLoading, setProfileLoading] = useState(false);
  // True when the profile READ failed (error/timeout) after retries — distinct
  // from "fetch succeeded but found no row." Gates a non-destructive retry
  // screen instead of the "Profile setup required" card.
  const [profileError, setProfileError] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return undefined;
    }

    // 1) Pull any existing session out of storage on mount. getSession() has
    // no built-in timeout — if Supabase Auth is slow/unreachable it can hang,
    // leaving the app stuck on the loading splash forever ("taking forever to
    // load"). A 15s watchdog forces us past the splash so the user at least
    // reaches the login screen and can attempt a fresh sign-in.
    let settled = false;
    const finishLoading = () => { if (!settled) { settled = true; setLoading(false); } };
    const sessionWatchdog = setTimeout(() => {
      console.warn('[auth] getSession timed out — proceeding to login');
      finishLoading();
    }, 15000);
    supabase.auth.getSession().then(({ data }) => {
      clearTimeout(sessionWatchdog);
      setSession(data?.session || null);
      finishLoading();
    }).catch(err => {
      clearTimeout(sessionWatchdog);
      console.warn('[auth] getSession failed', err);
      finishLoading();
    });

    // 2) Subscribe to future changes — sign-in, sign-out, token refresh.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      // When coming back from a magic-link redirect, the SDK stamps the
      // session here. We're no longer loading.
      setLoading(false);
    });

    return () => sub?.subscription?.unsubscribe();
  }, []);

  // Whenever the user id changes, (re)fetch their profile. Token refreshes
  // keep the same user id so they don't trigger a re-fetch.
  const userId = session?.user?.id || null;
  useEffect(() => {
    if (!userId) { setProfile(null); setProfileError(false); return; }
    let cancelled = false;
    let attempt = 0;
    setProfileLoading(true);
    setProfileError(false);
    // Each attempt races fetchProfile against a GENEROUS 30s timeout. The prior
    // 12s timeout was too aggressive: Supabase has occasionally taken ~65s on a
    // cold/refresh handshake, so 12s × retries aborted a slow-but-working load
    // and dumped the user onto the scary "Profile setup required" screen. 30s
    // rides out normal slowness; a genuine hang escapes to the retry screen.
    const attemptLoad = () => {
      attempt += 1;
      Promise.race([
        fetchProfile(userId),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('profile-fetch-timeout')), 30000)),
      ]).then(p => {
        if (cancelled) return;
        setProfile(p);          // row, OR a genuine null (real "no profile")
        setProfileError(false);
        setProfileLoading(false);
      }).catch(err => {
        if (cancelled) return;
        console.warn(`[auth] profile load attempt ${attempt} failed:`, err?.message || err);
        if (attempt < 3) {
          setTimeout(attemptLoad, 1500 * attempt);
        } else {
          // Exhausted retries. Flag an ERROR (distinct from "fetch succeeded
          // with no row") so the app shows a non-destructive "couldn't reach
          // the server — retry" screen, NOT the "Profile setup required" card.
          // Never null an existing profile, so a blip can't strip a signed-in
          // user mid-session.
          setProfileError(true);
          setProfileLoading(false);
        }
      });
    };
    attemptLoad();
    return () => { cancelled = true; };
  }, [userId]);

  const signOut = useCallback(async () => {
    if (!supabaseConfigured) return;
    await supabase.auth.signOut();
    // onAuthStateChange will fire and clear state.
  }, []);

  // ─── v4.8.0: Password-auth methods ───────────────────────────────────────
  // Thin wrappers around the Supabase auth client so pages don't have to
  // import supabase directly. All return { error: string | null } for a
  // consistent shape — the caller decides how to surface errors.

  const signInWithPassword = useCallback(async (email, password) => {
    if (!supabaseConfigured) return { error: 'Auth is not configured.' };
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return { error: error?.message || null };
  }, []);

  const signUpWithPassword = useCallback(async (email, password) => {
    if (!supabaseConfigured) return { error: 'Auth is not configured.' };
    // emailRedirectTo controls where Supabase's "confirm your email"
    // link lands after the user clicks it. Our /auth/callback handler
    // already handles both magic-link and confirmation tokens.
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    return { error: error?.message || null };
  }, []);

  const requestPasswordReset = useCallback(async (email) => {
    if (!supabaseConfigured) return { error: 'Auth is not configured.' };
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: error?.message || null };
  }, []);

  const updatePassword = useCallback(async (newPassword) => {
    if (!supabaseConfigured) return { error: 'Auth is not configured.' };
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: error.message };
    // Clear the force-set gate after a successful set. Best-effort: if
    // the column doesn't exist yet (migration 016 not applied), the
    // patch silently fails and the gate stays raised — better than
    // throwing in the user's face after a successful password change.
    if (userId) {
      try {
        await supabase
          .from('profiles')
          .update({ needs_password_setup: false })
          .eq('id', userId);
        // Re-fetch the profile so the gate clears in the UI.
        const p = await fetchProfile(userId);
        setProfile(p);
      } catch { /* migration 016 not applied yet — no-op */ }
    }
    return { error: null };
  }, [userId]);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    setProfileLoading(true);
    setProfileError(false);
    try {
      const p = await fetchProfile(userId);
      setProfile(p);
      setProfileError(false);
    } catch (err) {
      // Keep the existing profile on a transient failure rather than nulling
      // it (which would bounce the user to the setup screen mid-session), and
      // flag the error so the retry screen shows instead of "setup required".
      console.warn('[auth] refreshProfile failed', err?.message || err);
      setProfileError(true);
    } finally {
      setProfileLoading(false);
    }
  }, [userId]);

  // ─── View-as override state ─────────────────────────────────────────────
  const [viewingAs, setViewingAsState] = useState(() => loadViewAs());

  // If the real role drops below master_admin (e.g., the user got demoted
  // mid-session), clear any stale impersonation so they don't keep seeing
  // a privileged-feeling control they can't actually wield.
  useEffect(() => {
    const realRole = profile?.role || null;
    if (viewingAs && realRole !== 'master_admin') {
      setViewingAsState(null);
      saveViewAs(null);
    }
  }, [profile?.role, viewingAs]);

  const setViewAs = useCallback((next) => {
    // Client-side guard. Server endpoints still gate on the real JWT.
    if (next && profile?.role !== 'master_admin') return;
    if (next && !next.role) return;
    setViewingAsState(next || null);
    saveViewAs(next || null);
  }, [profile?.role]);

  const realRole = profile?.role || null;
  const realTeamId = profile?.team_id || null;
  const realUserId = session?.user?.id || null;
  // EFFECTIVE values — what every gate / page should read. Override wins
  // when present, real values otherwise. The override teamId may be null
  // for non-athlete impersonation (e.g., view as content user).
  const effectiveRole = viewingAs?.role || realRole;
  const effectiveTeamId = viewingAs?.teamId ?? realTeamId;
  // v4.7.10: effectiveUserId enables "view as a SPECIFIC athlete" so
  // PlayerPage's canEdit gates (`player.userId === user.id`) fire as
  // they would for the real athlete. Server-side calls still use the
  // real JWT — this is purely a client-side identity simulation for
  // UI/UX validation. Override is only applied when viewingAs.userId
  // is explicitly set; default impersonation (role + team, no specific
  // athlete) leaves effectiveUserId === realUserId.
  const effectiveUserId = viewingAs?.userId || realUserId;

  // v4.5.7: surface time-boxed-access metadata for the countdown banner.
  // roleExpiresAt is a Date when set, null otherwise. expiredRole is the
  // role the user HAD before the timer ran out (so the "access expired"
  // UI can name what they lost, not just say "you have no role").
  const roleExpiresAt = profile?.role_expires_at
    ? new Date(profile.role_expires_at)
    : null;
  const expiredRole = profile?.expiredRole || null;

  // v4.19.0: memoize the context value. Pre-fix this object was rebuilt on
  // every AuthProvider render, so its reference changed every time — which
  // re-rendered EVERY consumer (the whole app tree below AuthGate) on any
  // state tick (poll refreshes, route changes, etc.). All the functions
  // below are useCallback-stable and the derived values come from
  // session/profile/viewingAs, so a dependency array of those keeps the
  // reference stable until something real changes.
  const value = useMemo(() => ({
    user: session?.user || null,
    session,
    profile,
    role: effectiveRole,
    teamId: effectiveTeamId,
    // v4.7.10: effectiveUserId is what client-side per-player edit gates
    // should read. realUserId is the real master's session id; use it
    // anywhere a SERVER call's auth ownership matters.
    userId: effectiveUserId,
    realRole,
    realTeamId,
    realUserId,
    viewingAs,
    setViewAs,
    loading,
    profileLoading,
    profileError,
    signOut,
    refreshProfile,
    isConfigured: supabaseConfigured,
    roleExpiresAt,
    expiredRole,
    // v4.8.0: password auth + force-set gate
    needsPasswordSetup: !!profile?.needs_password_setup,
    signInWithPassword,
    signUpWithPassword,
    requestPasswordReset,
    updatePassword,
  }), [
    session, profile, viewingAs, loading, profileLoading, profileError,
    signOut, setViewAs, refreshProfile,
    signInWithPassword, signUpWithPassword, requestPasswordReset, updatePassword,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

// Convenience — most callers just want the user.
export function useCurrentUser() {
  return useAuth().user;
}

// Convenience — just the role string (or null if not loaded).
export function useRole() {
  return useAuth().role;
}

// Role predicates — small helpers so pages don't hardcode strings.
export const ROLE_LABELS = {
  master_admin: 'Master Admin',
  admin: 'Admin',
  content: 'Content',
  athlete: 'Athlete',
  fan: 'Fan',
};
export const isAdminRole = (role) => role === 'master_admin' || role === 'admin';
export const isStaffRole = (role) => role === 'master_admin' || role === 'admin' || role === 'content';
// Athletes are restricted — used for UI gating (hide Files, restrict Generate team, etc).
export const isAthleteRole = (role) => role === 'athlete';
// v4.8.0: fans are the public/general-usage tier. Browse-only access to
// teams, players, stats, recent posts. NO Studio, Files, Requests,
// Resources, Train AI, Settings (limited), MyStats.
export const isFanRole = (role) => role === 'fan';
