// Auth context — wraps the app so any component can read the current user,
// session, AND profile (role + team_id) without wiring listeners itself.
// This is the ONLY place in the app that subscribes to
// `supabase.auth.onAuthStateChange` and queries the `profiles` table.
//
// Phase 5b surface:
//   useAuth()       → { user, session, profile, role, teamId, loading, profileLoading, signOut, isConfigured }
//   useCurrentUser() convenience alias — just the user object (nullable)
//   useRole()        convenience — current role or null
//
// Roles (see db/003 migration):
//   master_admin → you; manages all users including admins
//   admin        → ops; manages content/athlete users
//   content      → internal content creator; full app access except People tab
//   athlete      → player/coach; restricted to their team for content generation

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase, supabaseConfigured } from './supabase-client';

const AuthContext = createContext({
  user: null,
  session: null,
  profile: null,
  role: null,
  teamId: null,
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
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, role, team_id, display_name, created_at, updated_at')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      // Most likely cause: the profiles table doesn't exist yet (migration 003
      // hasn't been applied). Log and return null so the app still works.
      console.warn('[auth] profile fetch failed', error.message);
      return null;
    }
    return data || null;
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

  const value = {
    user: session?.user || null,
    session,
    profile,
    role: profile?.role || null,
    teamId: profile?.team_id || null,
    loading,
    profileLoading,
    signOut,
    refreshProfile,
    isConfigured: supabaseConfigured,
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
