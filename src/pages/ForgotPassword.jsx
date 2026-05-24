// Forgot password — request a reset email.
//
// User flow:
//   1. /forgot-password → enter email → click "Send reset link"
//   2. Supabase emails the reset link with a recovery token
//   3. Click → /reset-password (separate page) → set new password
//
// Kept as a dedicated page (not a modal on /login) so the reset-link
// email lands on a clean URL and so deep-linking from any other surface
// works.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { colors, fonts, radius, shadows } from '../theme';

export default function ForgotPassword() {
  const { requestPasswordReset, isConfigured } = useAuth();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setErrorMsg('');
    const { error } = await requestPasswordReset(email);
    setSubmitting(false);
    if (error) {
      // We DO NOT leak whether the email exists — Supabase's
      // resetPasswordForEmail doesn't either. So if we ever see an
      // error here, it's an actual delivery problem.
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
      </Shell>
    );
  }

  if (sent) {
    return (
      <Shell>
        <div style={{ fontSize: 42, marginBottom: 10 }}>✉️</div>
        <h1 style={styles.title}>Check your email</h1>
        <p style={styles.muted}>
          If an account exists for <strong>{email}</strong>, you'll receive
          a password-reset link shortly.
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
      <h1 style={styles.title}>Reset password</h1>
      <p style={styles.muted}>
        Enter your account email. We'll send a link to set a new password.
      </p>

      <form onSubmit={submit} style={{ width: '100%', marginTop: 20 }}>
        <label htmlFor="fp-email" style={styles.label}>Email</label>
        <input
          id="fp-email"
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

        {errorMsg && <div style={styles.errorBox}>{errorMsg}</div>}

        <button
          type="submit"
          disabled={submitting || !email.trim()}
          style={{
            ...styles.submitBtn,
            opacity: submitting || !email.trim() ? 0.6 : 1,
            cursor: submitting ? 'wait' : 'pointer',
          }}
        >
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>
      </form>

      <Link to="/login" style={{ ...styles.linkButton, textDecoration: 'underline', marginTop: 20 }}>
        ← Back to sign in
      </Link>
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
  logo: { display: 'block', width: 96, height: 96, objectFit: 'contain', marginBottom: 14 },
  title: { fontFamily: fonts.heading, fontSize: 28, color: colors.text, margin: 0, letterSpacing: 1.5, fontWeight: 400 },
  muted: { fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary, margin: '8px 0 0', lineHeight: 1.5 },
  label: { display: 'block', textAlign: 'left', fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700, color: colors.textSecondary, letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 14, fontFamily: fonts.body, border: `1px solid ${colors.border}`, borderRadius: radius.base, background: colors.white, color: colors.text, outline: 'none' },
  errorBox: { marginTop: 10, padding: '8px 12px', background: 'rgba(221,60,60,0.08)', color: '#991B1B', border: `1px solid rgba(221,60,60,0.3)`, borderRadius: radius.base, fontSize: 12, textAlign: 'left' },
  submitBtn: { width: '100%', marginTop: 18, padding: '11px 14px', background: colors.red, color: '#fff', border: 'none', borderRadius: radius.base, fontFamily: fonts.condensed, fontSize: 14, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' },
  linkButton: { marginTop: 16, background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer', fontFamily: fonts.body, fontSize: 13 },
};
