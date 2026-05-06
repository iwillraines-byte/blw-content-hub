// Magic-link landing page.
//
// Handles three different URL shapes that Supabase sends:
//   1. PKCE return-user sign-in: ?code=XXX
//      → SDK auto-exchanges via detectSessionInUrl + the code_verifier
//        stashed in localStorage at signInWithOtp time.
//   2. Implicit return-user sign-in: #access_token=XXX&refresh_token=YYY
//      → SDK auto-extracts via detectSessionInUrl. (Pre-PKCE legacy
//        links + any project still configured for implicit flow.)
//   3. Invitation / recovery / email-change: ?token_hash=XXX&type=invite
//      → Must be exchanged manually via supabase.auth.verifyOtp({
//        token_hash, type }). detectSessionInUrl does NOT handle this
//        path because invited users have no prior code_verifier.
//
// v4.5.51: Added explicit verifyOtp handling for case (3). Pre-fix,
// invitation links from inviteUserByEmail hung forever on the
// "Signing you in…" spinner because PKCE-mode detectSessionInUrl
// silently ignored token_hash/type and waited for a session that
// would never arrive.
//
// Also adds a 12-second timeout that surfaces a recovery CTA if the
// SDK is stuck for any other reason — guarantees no user gets stuck
// staring at a spinner indefinitely.

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { supabase } from '../supabase-client';
import { colors, fonts, radius, shadows } from '../theme';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, loading } = useAuth();
  const [error, setError] = useState(null);
  // v4.5.51: timeout flag — flips true if we're still spinning after
  // 12 seconds with no session, no user, and no URL error. The UI
  // swaps the spinner for a "this is taking too long" recovery CTA
  // so users don't sit there indefinitely.
  const [stuck, setStuck] = useState(false);

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

  // v4.5.51: Manually handle invitation / recovery / email-change links.
  // These arrive as `?token_hash=XXX&type=invite|recovery|email_change`
  // and need an explicit verifyOtp() call — the auto-exchange in
  // detectSessionInUrl only handles PKCE `?code=` and implicit hashes.
  // Pre-fix this hung forever for newly-invited admins.
  useEffect(() => {
    const tokenHash = params.get('token_hash');
    const type = params.get('type');
    if (!tokenHash || !type) return;
    let cancelled = false;
    (async () => {
      try {
        const { error: verifyErr } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        if (cancelled) return;
        if (verifyErr) {
          setError(verifyErr.message || 'Invitation verification failed.');
        }
        // On success, onAuthStateChange fires inside AuthProvider and
        // the user-redirect effect below picks up.
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Invitation verification threw.');
      }
    })();
    return () => { cancelled = true; };
  }, [params]);

  // v4.5.51: 12-second escape hatch. If we're still loading with no
  // user and no error after 12 seconds, the SDK is silently stuck
  // (PKCE code_verifier mismatch on a cross-device click, expired
  // token, scanner pre-burn, etc.). Show a recovery CTA instead of
  // an indefinite spinner.
  useEffect(() => {
    if (user || error) return;
    const t = setTimeout(() => setStuck(true), 12_000);
    return () => clearTimeout(t);
  }, [user, error]);

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
            <p style={{ fontSize: 13, color: colors.textSecondary, margin: '10px 0 14px', lineHeight: 1.5 }}>
              {error}
            </p>
            {/* v4.5.45: explain the most common cause + offer the
                one-click fix. The "expired / invalid" error usually
                means a corporate email scanner pre-clicked the link
                or the user opened it on a different device than the
                one they requested it from (PKCE flow). Either way,
                the fix is "request a new link" — surface it as the
                primary CTA so the user doesn't have to figure out
                what to do next. */}
            <div style={{
              padding: 12, background: colors.bg, borderRadius: radius.base,
              border: `1px solid ${colors.borderLight}`,
              fontSize: 11, color: colors.textSecondary, lineHeight: 1.5,
              textAlign: 'left', marginBottom: 16,
            }}>
              <strong style={{ color: colors.text }}>Why this happens:</strong> corporate
              email security tools (Outlook, Mimecast, etc.) sometimes
              pre-click links to scan for malware, which burns the
              one-time token before you do. Or the link was opened on
              a different device than the one that requested it.
              <br /><br />
              <strong style={{ color: colors.text }}>Fix:</strong> request a fresh
              link below and click it from this same browser within
              5 minutes.
            </div>
            <button onClick={() => navigate('/login', { replace: true })} style={{
              padding: '10px 14px', background: colors.red, color: '#fff',
              border: 'none', borderRadius: radius.base, cursor: 'pointer',
              fontFamily: fonts.condensed, fontSize: 13, fontWeight: 700,
              letterSpacing: 1, textTransform: 'uppercase',
            }}>
              Send a new link →
            </button>
          </>
        ) : stuck ? (
          <>
            {/* v4.5.51: 12s timeout reached. Common reason for an
                invited admin: their browser doesn't have the PKCE
                code_verifier from a prior signInWithOtp call (because
                they were invited, not logging in). The verifyOtp
                handler above should have caught it — if we're still
                stuck here, the most likely repro is a stale link or
                a scanner-burned token. CTA bounces them to /login
                where they can request a fresh magic link. */}
            <div style={{ fontSize: 36, marginBottom: 10 }}>⏱</div>
            <h1 style={{ fontFamily: fonts.heading, fontSize: 22, margin: 0, color: colors.text, letterSpacing: 1.2 }}>
              This is taking too long
            </h1>
            <p style={{ fontSize: 13, color: colors.textSecondary, margin: '10px 0 14px', lineHeight: 1.5 }}>
              The sign-in link couldn't be verified. The most likely cause is
              a stale or already-used link — invitation emails sent before
              today\'s update need to be re-sent.
            </p>
            <div style={{
              padding: 12, background: colors.bg, borderRadius: radius.base,
              border: `1px solid ${colors.borderLight}`,
              fontSize: 11, color: colors.textSecondary, lineHeight: 1.5,
              textAlign: 'left', marginBottom: 16,
            }}>
              <strong style={{ color: colors.text }}>What to do:</strong> ask
              the admin who invited you to send a fresh invite, or use the
              button below to request a regular magic-link sign-in.
            </div>
            <button onClick={() => navigate('/login', { replace: true })} style={{
              padding: '10px 14px', background: colors.red, color: '#fff',
              border: 'none', borderRadius: radius.base, cursor: 'pointer',
              fontFamily: fonts.condensed, fontSize: 13, fontWeight: 700,
              letterSpacing: 1, textTransform: 'uppercase',
            }}>
              Send a new link →
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
