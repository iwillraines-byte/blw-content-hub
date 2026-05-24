// Register page — open self-signup with email + password.
//
// v4.8.0: First public-facing signup surface. Anyone can create an
// account at /register; new accounts default to the 'fan' tier (the
// SQL trigger in migration 016 sets role='fan' when encrypted_password
// is non-null). After signup, Supabase sends a confirmation email — the
// account can't log in until the user clicks the link.
//
// Athletes still get created the old way (master invites or silent-
// stages via Settings → People), in which case the trigger defaults
// them to 'athlete' + needs_password_setup=true. Athletes can ALSO
// self-register if they prefer — master can then promote them in the
// People list.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { colors, fonts, radius, shadows } from '../theme';

// Minimum password length. Supabase's own default is 6, which is too
// weak — Pro plans enforce ≥8. We mirror that on the client for clear
// inline validation instead of waiting for the server to reject.
const MIN_PASSWORD_LENGTH = 8;

export default function Register() {
  const navigate = useNavigate();
  const { signUpWithPassword, isConfigured } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [sent, setSent] = useState(false);

  // Client-side validation summary — surfaces the FIRST problem so the
  // user knows what to fix, rather than a wall of red.
  const validate = () => {
    if (!email.trim()) return 'Enter an email address.';
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (password !== confirm) return 'Passwords do not match.';
    return null;
  };

  const submit = async (e) => {
    e.preventDefault();
    const problem = validate();
    if (problem) { setErrorMsg(problem); return; }
    setSubmitting(true);
    setErrorMsg('');
    const { error } = await signUpWithPassword(email, password);
    setSubmitting(false);
    if (error) {
      // Supabase returns "User already registered" for taken emails,
      // and various password complexity errors when applicable.
      setErrorMsg(error);
      return;
    }
    setSent(true);
  };

  if (!isConfigured) {
    return (
      <Shell>
        <img src="/brand/blw-logo.svg" alt="BLW Studio" style={styles.logo} />
        <h1 style={styles.title}>Cloud not configured</h1>
        <p style={styles.muted}>
          Registration requires Supabase to be configured. Contact the admin.
        </p>
      </Shell>
    );
  }

  if (sent) {
    return (
      <Shell>
        <div style={{ fontSize: 42, marginBottom: 10 }}>✉️</div>
        <h1 style={styles.title}>Check your email</h1>
        <p style={styles.muted}>
          We sent a confirmation link to <strong>{email}</strong>. Click it to
          activate your account, then you'll be able to sign in with your password.
        </p>
        <Link to="/login" style={{ ...styles.linkButton, textDecoration: 'underline' }}>
          ← Back to sign in
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <img src="/brand/blw-logo.svg" alt="BLW Studio" style={styles.logo} />
      <h1 style={styles.title}>Create an account</h1>
      <p style={styles.muted}>
        Join BLW to follow your favorite teams, players, and content.
      </p>

      <form onSubmit={submit} style={{ width: '100%', marginTop: 20 }}>
        <label htmlFor="reg-email" style={styles.label}>Email</label>
        <input
          id="reg-email"
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

        <label htmlFor="reg-password" style={{ ...styles.label, marginTop: 14 }}>
          Password <span style={styles.hint}>(at least {MIN_PASSWORD_LENGTH} characters)</span>
        </label>
        <input
          id="reg-password"
          type="password"
          required
          autoComplete="new-password"
          placeholder="••••••••"
          value={password}
          onChange={e => setPassword(e.target.value)}
          disabled={submitting}
          style={styles.input}
        />

        <label htmlFor="reg-confirm" style={{ ...styles.label, marginTop: 14 }}>Confirm password</label>
        <input
          id="reg-confirm"
          type="password"
          required
          autoComplete="new-password"
          placeholder="••••••••"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          disabled={submitting}
          style={styles.input}
        />

        {errorMsg && <div style={styles.errorBox}>{errorMsg}</div>}

        <button
          type="submit"
          disabled={submitting}
          style={{
            ...styles.submitBtn,
            opacity: submitting ? 0.6 : 1,
            cursor: submitting ? 'wait' : 'pointer',
          }}
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${colors.borderLight}`, width: '100%', textAlign: 'center' }}>
        <span style={{ fontSize: 13, color: colors.textSecondary }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: colors.red, fontWeight: 700, textDecoration: 'none' }}>
            Sign in
          </Link>
        </span>
      </div>
    </Shell>
  );
}

function Shell({ children }) {
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
  hint: {
    fontWeight: 400, letterSpacing: 0, color: colors.textMuted,
    textTransform: 'none',
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
    width: '100%', marginTop: 18,
    padding: '11px 14px',
    background: colors.red, color: '#fff',
    border: 'none', borderRadius: radius.base,
    fontFamily: fonts.condensed, fontSize: 14, fontWeight: 700,
    letterSpacing: 1, textTransform: 'uppercase',
  },
  linkButton: {
    marginTop: 16, background: 'none', border: 'none',
    color: colors.textSecondary, cursor: 'pointer',
    fontFamily: fonts.body, fontSize: 13,
  },
};
