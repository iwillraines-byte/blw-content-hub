// Login page — email + password sign-in (primary) with magic-link as a fallback.
//
// v5: the flat-navy centered card became the scrolling-montage AuthShell; the
// form itself is restyled to the v5 system (shared authStyles). Auth logic is
// unchanged from v4.8.0.
//
// Flow:
//   Primary: email + password → supabase.auth.signInWithPassword →
//            session stored → AuthProvider's onAuthStateChange fires.
//   Fallback: "Email me a sign-in link" → signInWithOtp → email → /auth/callback.
//   Forgot password: → /forgot-password → reset email → /reset-password.
//   New here? → /register page

import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, supabaseConfigured } from '../supabase-client';
import { useAuth } from '../auth';
import { colors } from '../theme';
import { Icon } from '../icon';
import { AuthShell, authStyles as styles } from '../auth-shell';

function Shell({ children }) {
  return (
    <AuthShell>
      <div style={styles.card}>{children}</div>
    </AuthShell>
  );
}

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
      <Shell>
        <img src="/brand/blw-logo.svg" alt="BLW Studio" style={styles.logo} />
        <h1 style={styles.title}>Cloud not configured</h1>
        <p style={styles.muted}>
          This deployment is missing <code>VITE_SUPABASE_URL</code> or
          <code> VITE_SUPABASE_ANON_KEY</code>. Add them and redeploy.
        </p>
      </Shell>
    );
  }

  if (magicMode && magicStatus === 'sent') {
    return (
      <Shell>
        <Icon name="mail" size={38} style={{ color: colors.red, marginBottom: 10 }} />
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
      </Shell>
    );
  }

  // Magic-link mode renders a stripped form — just email + "Send link".
  if (magicMode) {
    return (
      <Shell>
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
      </Shell>
    );
  }

  return (
    <Shell>
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
          // a11y: flag invalid + point to the error message when present
          aria-invalid={errorMsg ? 'true' : undefined}
          aria-describedby={errorMsg ? 'login-error' : undefined}
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
          // a11y: flag invalid + point to the error message when present
          aria-invalid={errorMsg ? 'true' : undefined}
          aria-describedby={errorMsg ? 'login-error' : undefined}
          style={styles.input}
        />

        {/* a11y: announce errors via live region + associate with inputs below */}
        {errorMsg && <div id="login-error" role="alert" aria-live="assertive" style={styles.errorBox}>{errorMsg}</div>}

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
    </Shell>
  );
}
