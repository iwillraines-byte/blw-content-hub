// Magic-link landing page.
//
// The supabase client's `detectSessionInUrl` option takes care of parsing the
// access token from the URL hash automatically on mount. AuthProvider's
// onAuthStateChange fires with the new session. All we need to do here is:
//   - show a loading state while the SDK finishes its work
//   - surface any error the URL contains (user clicked expired link, etc.)
//   - redirect to the requested page (or /dashboard) once signed in
//
// Supabase emits errors in the URL fragment too — `?error=...&error_description=...`
// We parse both the hash and query string to catch either form.

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { colors, fonts, radius, shadows } from '../theme';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, loading } = useAuth();
  const [error, setError] = useState(null);

  // Check both the query string and the hash fragment for an error.
  useEffect(() => {
    const qErr = params.get('error_description') || params.get('error');
    if (qErr) { setError(decodeURIComponent(qErr)); return; }
    // Hash errors look like: #error=access_denied&error_description=Email+link+is+invalid
    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const hErr = hash.get('error_description') || hash.get('error');
      if (hErr) setError(decodeURIComponent(hErr.replace(/\+/g, ' ')));
    }
  }, [params]);

  // Once the session lands, send the user on their way.
  useEffect(() => {
    if (loading) return;
    if (error) return;
    if (user) {
      const next = params.get('next') || '/dashboard';
      // Replace so the callback URL doesn't live in history.
      navigate(next, { replace: true });
    }
  }, [user, loading, error, navigate, params]);

  return (
    <div style={{
      minHeight: '100vh', background: colors.navy,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, fontFamily: fonts.body,
    }}>
      <div style={{
        width: '100%', maxWidth: 400,
        background: colors.white, borderRadius: radius.lg,
        padding: 32, boxShadow: shadows.lg,
        textAlign: 'center',
      }}>
        {error ? (
          <>
            <div style={{ fontSize: 36, marginBottom: 10 }}>⚠️</div>
            <h1 style={{ fontFamily: fonts.heading, fontSize: 24, margin: 0, color: colors.text, letterSpacing: 1.2 }}>
              Sign-in failed
            </h1>
            <p style={{ fontSize: 13, color: colors.textSecondary, margin: '10px 0 18px', lineHeight: 1.5 }}>
              {error}
            </p>
            <button onClick={() => navigate('/login', { replace: true })} style={{
              padding: '10px 14px', background: colors.red, color: '#fff',
              border: 'none', borderRadius: radius.base, cursor: 'pointer',
              fontFamily: fonts.condensed, fontSize: 13, fontWeight: 700,
              letterSpacing: 1, textTransform: 'uppercase',
            }}>
              Back to sign-in
            </button>
          </>
        ) : (
          <>
            <div style={{
              width: 28, height: 28, margin: '6px auto 14px',
              border: `3px solid ${colors.border}`,
              borderTopColor: colors.red,
              borderRadius: '50%', animation: 'authspin 0.9s linear infinite',
            }} />
            <h1 style={{ fontFamily: fonts.heading, fontSize: 22, margin: 0, color: colors.text, letterSpacing: 1.2 }}>
              Signing you in…
            </h1>
            <style>{`@keyframes authspin { to { transform: rotate(360deg) } }`}</style>
          </>
        )}
      </div>
    </div>
  );
}
