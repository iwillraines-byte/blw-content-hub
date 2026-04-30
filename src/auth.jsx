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

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
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
    // The select includes the new column; if the column doesn't exist
    // yet (pre-migration deploys), Postgrest 400s and we retry without
    // it so the app keeps working.
    let { data, error } = await supabase
      .from('profiles')
      .select('id, email, role, team_id, display_name, created_at, updated_at, role_expires_at')
      .eq('id', userId)
      .maybeSingle();
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
      console.warn('[auth] profile fetch failed', error.message);
      return null;
    }
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
    console.warn('[auth] profile fetch threw', err);
    return null;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  // While loading is true we render a splash — avoids "logged out flash"
  // on a hard refresh before Supabase restores the session from storage.
  const [loading, setLoading] = useState(supabaseConfigured);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return undefined;
    }

    // 1) Pull any existing session out of storage on mount.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data?.session || null);
      setLoading(false);
    }).catch(err => {
      console.warn('[auth] getSession failed', err);
      setLoading(false);
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
    if (!userId) { setProfile(null); return; }
    setProfileLoading(true);
    fetchProfile(userId).then(p => {
      setProfile(p);
      setProfileLoading(false);
    });
  }, [userId]);

  const signOut = useCallback(async () => {
    if (!supabaseConfigured) return;
    await supabase.auth.signOut();
    // onAuthStateChange will fire and clear state.
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    setProfileLoading(true);
    const p = await fetchProfile(userId);
    setProfile(p);
    setProfileLoading(false);
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
  // EFFECTIVE values — what every gate / page should read. Override wins
  // when present, real values otherwise. The override teamId may be null
  // for non-athlete impersonation (e.g., view as content user).
  const effectiveRole = viewingAs?.role || realRole;
  const effectiveTeamId = viewingAs?.teamId ?? realTeamId;

  // v4.5.7: surface time-boxed-access metadata for the countdown banner.
  // roleExpiresAt is a Date when set, null otherwise. expiredRole is the
  // role the user HAD before the timer ran out (so the "access expired"
  // UI can name what they lost, not just say "you have no role").
  const roleExpiresAt = profile?.role_expires_at
    ? new Date(profile.role_expires_at)
    : null;
  const expiredRole = profile?.expiredRole || null;

  const value = {
    user: session?.user || null,
    session,
    profile,
    role: effectiveRole,
    teamId: effectiveTeamId,
    realRole,
    realTeamId,
    viewingAs,
    setViewAs,
    loading,
    profileLoading,
    signOut,
    refreshProfile,
    isConfigured: supabaseConfigured,
    roleExpiresAt,
    expiredRole,
  };

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
};
export const isAdminRole = (role) => role === 'master_admin' || role === 'admin';
export const isStaffRole = (role) => role === 'master_admin' || role === 'admin' || role === 'content';
// Athletes are restricted — used for UI gating (hide Files, restrict Generate team, etc).
export const isAthleteRole = (role) => role === 'athlete';
