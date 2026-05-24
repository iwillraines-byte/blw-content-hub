// Login page — email + password sign-in (primary) with magic-link as a fallback.
//
// v4.8.0: Password auth is now the primary path. Magic-link stays as
// a recovery option for users who don't remember their password and
// don't want to go through the formal reset flow. Fans + athletes
// both use the same login form.
//
// Flow:
//   Primary: email + password → supabase.auth.signInWithPassword →
//            session stored → AuthProvider's onAuthStateChange fires →
//            user lands signed in.
//
//   Fallback: "Email me a sign-in link" → supabase.auth.signInWithOtp →
//             Supabase emails the link → click → /auth/callback resolves
//             the session.
//
//   Forgot password: link → /forgot-password page → reset email → user
//                    clicks → /reset-password → sets new password →
//                    signed in.
//
//   New here? → /register page

import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, supabaseConfigured } from '../supabase-client';
import { useAuth } from '../auth';
import { colors, fonts, radius, shadows } from '../theme';

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirectTo = params.get('next') || '/dashboard';
  const { signInWithPassword } = useAuth();

  // Primary state — email + password form.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Fallback state — magic-link "send me a link" toggle.
  const [magicMode, setMagicMode] = useState(false);
  const [magicStatus, setMagicStatus] = useState('idle'); // idle | sending | sent | error

  const signIn = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password || !supabaseConfigured) return;
    setSubmitting(true);
    setErrorMsg('');
    const { error } = await signInWithPassword(email, password);
    if (error) {
      // Supabase returns "Invalid login credentials" for both wrong-
      // password AND no-account-exists. Surface it as-is — leaking
      // existence would be a security regression.
      setErrorMsg(error);
      setSubmitting(false);
      return;
    }
    // onAuthStateChange will populate the session; AuthGate handles
    // routing. Reset submitting in case the redirect is queued.
    setSubmitting(false);
  };

  const sendLink = async (e) => {
    e.preventDefault();
    if (!email.trim() || !supabaseConfigured) return;
    setMagicStatus('sending');
    setErrorMsg('');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
          shouldCreateUser: false,
        },
      });
      if (error) throw error;
      setMagicStatus('sent');
    } catch (err) {
      console.error('[login] magic link failed', err);
      setMagicStatus('error');
      setErrorMsg(err?.message || 'Failed to send sign-in link.');
    }
  };

  if (!supabaseConfigured) {
    return (
      <LoginShell>
        <img src="/brand/blw-logo.svg" alt="BLW Studio" style={styles.logo} />
        <h1 style={styles.title}>Cloud not configured</h1>
        <p style={styles.muted}>
          This deployment is missing <code>VITE_SUPABASE_URL</code> or
          <code> VITE_SUPABASE_ANON_KEY</code>. Add them and redeploy.
        </p>
      </LoginShell>
    );
  }

  if (magicMode && magicStatus === 'sent') {
    return (
      <LoginShell>
        <div style={{ fontSize: 42, marginBottom: 10 }}>✉️</div>
        <h1 style={styles.title}>Check your email</h1>
        <p style={styles.muted}>
          A sign-in link was sent to <strong>{email}</strong>. Click it on this
          device to sign in.
        </p>
        <button
          onClick={() => { setMagicStatus('idle'); setMagicMode(false); }}
          style={styles.linkButton}
        >
          ← Back to sign in
        </button>
      </LoginShell>
    );
  }

  // Magic-link mode renders a stripped form — just email + "Send link".
  if (magicMode) {
    return (
      <LoginShell>
        <img src="/brand/blw-logo.svg" alt="BLW Studio" style={styles.logo} />
        <h1 style={styles.title}>Email me a link</h1>
        <p style={styles.muted}>
          We'll send a one-time sign-in link. Works for accounts that already exist.
        </p>

        <form onSubmit={sendLink} style={{ width: '100%', marginTop: 20 }}>
          <label htmlFor="magic-email" style={styles.label}>Email address</label>
          <input
            id="magic-email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            disabled={magicStatus === 'sending'}
            style={styles.input}
          />

          {magicStatus === 'error' && (
            <div style={styles.errorBox}>{errorMsg}</div>
          )}

          <button
            type="submit"
            disabled={magicStatus === 'sending' || !email.trim()}
            style={{
              ...styles.submitBtn,
              opacity: magicStatus === 'sending' || !email.trim() ? 0.6 : 1,
              cursor: magicStatus === 'sending' ? 'wait' : 'pointer',
            }}
          >
            {magicStatus === 'sending' ? 'Sending…' : 'Send sign-in link'}
          </button>
        </form>

        <button onClick={() => setMagicMode(false)} style={styles.linkButton}>
          ← Use a password instead
        </button>
      </LoginShell>
    );
  }

  return (
    <LoginShell>
      <img src="/brand/blw-logo.svg" alt="BLW Studio" style={styles.logo} />
      <h1 style={styles.title}>BLW Studio</h1>
      <p style={styles.muted}>Sign in to continue.</p>

      <form onSubmit={signIn} style={{ width: '100%', marginTop: 20 }}>
        <label htmlFor="email" style={styles.label}>Email</label>
        <input
          id="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={submitting}
          style={styles.input}
        />

        <label htmlFor="password" style={{ ...styles.label, marginTop: 14 }}>Password</label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={e => setPassword(e.target.value)}
          disabled={submitting}
          style={styles.input}
        />

        {errorMsg && <div style={styles.errorBox}>{errorMsg}</div>}

        <button
          type="submit"
          disabled={submitting || !email.trim() || !password}
          style={{
            ...styles.submitBtn,
            opacity: submitting || !email.trim() || !password ? 0.6 : 1,
            cursor: submitting ? 'wait' : 'pointer',
          }}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginTop: 16, gap: 12 }}>
        <Link to="/forgot-password" style={styles.smallLink}>Forgot password?</Link>
        <button onClick={() => setMagicMode(true)} style={styles.smallLinkBtn}>Email me a link</button>
      </div>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${colors.borderLight}`, width: '100%', textAlign: 'center' }}>
        <span style={{ fontSize: 13, color: colors.textSecondary }}>
          New here?{' '}
          <Link to="/register" style={{ color: colors.red, fontWeight: 700, textDecoration: 'none' }}>
            Create an account
          </Link>
        </span>
      </div>
    </LoginShell>
  );
}

function LoginShell({ children }) {
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
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        textAlign: 'center',
      }}>
        {children}
      </div>
    </div>
  );
}

const styles = {
  logo: {
    display: 'block', width: 96, height: 96,
    objectFit: 'contain', marginBottom: 14,
  },
  title: {
    fontFamily: fonts.heading, fontSize: 28, color: colors.text,
    margin: 0, letterSpacing: 1.5, fontWeight: 400,
  },
  muted: {
    fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary,
    margin: '8px 0 0', lineHeight: 1.5,
  },
  label: {
    display: 'block', textAlign: 'left',
    fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
    color: colors.textSecondary, letterSpacing: 1,
    marginBottom: 6, textTransform: 'uppercase',
  },
  input: {
    width: '100%', boxSizing: 'border-box',
    padding: '10px 12px', fontSize: 14, fontFamily: fonts.body,
    border: `1px solid ${colors.border}`, borderRadius: radius.base,
    background: colors.white, color: colors.text,
    outline: 'none', transition: 'border-color 0.15s',
  },
  errorBox: {
    marginTop: 10, padding: '8px 12px',
    background: 'rgba(221,60,60,0.08)', color: '#991B1B',
    border: `1px solid rgba(221,60,60,0.3)`, borderRadius: radius.base,
    fontSize: 12, textAlign: 'left',
  },
  submitBtn: {
    width: '100%', marginTop: 14,
    padding: '11px 14px',
    background: colors.red, color: '#fff',
    border: 'none', borderRadius: radius.base,
    fontFamily: fonts.condensed, fontSize: 14, fontWeight: 700,
    letterSpacing: 1, textTransform: 'uppercase',
  },
  linkButton: {
    marginTop: 16, background: 'none', border: 'none',
    color: colors.textSecondary, cursor: 'pointer',
    fontFamily: fonts.body, fontSize: 13, textDecoration: 'underline',
  },
  smallLink: {
    fontSize: 12, color: colors.textSecondary, textDecoration: 'none',
    fontFamily: fonts.body,
  },
  smallLinkBtn: {
    background: 'none', border: 'none', padding: 0,
    fontSize: 12, color: colors.textSecondary, cursor: 'pointer',
    textDecoration: 'underline', fontFamily: fonts.body,
  },
};
