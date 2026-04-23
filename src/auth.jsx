// Auth context — wraps the app so any component can read the current user
// and session state without wiring listeners itself. This is the ONLY place
// in the app that subscribes to `supabase.auth.onAuthStateChange`.
//
// Phase 5a surface:
//   useAuth()       → { user, session, loading, signOut, isConfigured }
//   useCurrentUser() convenience alias — just the user object (nullable)
//
// Phase 5b will add `profile` (role + team_id + display name) loaded from the
// `profiles` table on auth change. Existing consumers will keep working
// because they only read `user` / `loading`.

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase, supabaseConfigured } from './supabase-client';

const AuthContext = createContext({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
  isConfigured: false,
});

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  // While loading is true we render a splash — avoids "logged out flash"
  // on a hard refresh before Supabase restores the session from storage.
  const [loading, setLoading] = useState(supabaseConfigured);

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

  const signOut = useCallback(async () => {
    if (!supabaseConfigured) return;
    await supabase.auth.signOut();
    // onAuthStateChange will fire and clear state.
  }, []);

  const value = {
    user: session?.user || null,
    session,
    loading,
    signOut,
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
