// Reset / set password — single page that handles two flows:
//
//   1. Recovery: user clicked the email link from /forgot-password.
//      Supabase has already stamped a recovery session in the URL hash
//      (handled by detectSessionInUrl on the supabase client). They
//      land here, type a new password, submit → done.
//
//   2. Force-set: existing user signed in via magic-link but their
//      profile has needs_password_setup=true. AuthGate routes them
//      here automatically (intercepts before the rest of the app).
//      After they set a password, the gate clears and they land on
//      the dashboard.
//
// Both flows call the same updatePassword() helper from useAuth which
// also flips needs_password_setup=false in the profile.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { colors, fonts, radius, shadows } from '../theme';

const MIN_PASSWORD_LENGTH = 8;

export default function ResetPassword({ forceMode = false }) {
  const navigate = useNavigate();
  const { user, updatePassword, signOut, needsPasswordSetup, isConfigured } = useAuth();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [done, setDone] = useState(false);

  // We require an active session — both the recovery link and the
  // force-set gate guarantee one. If somehow no session exists, send
  // them to /login.
  if (!isConfigured) {
    return (
      <Shell>
        <h1 style={styles.title}>Cloud not configured</h1>
      </Shell>
    );
  }
  if (!user) {
    return (
      <Shell>
        <h1 style={styles.title}>Session expired</h1>
        <p style={styles.muted}>
          The reset link expired or was already used. Request a new one.
        </p>
        <button onClick={() => navigate('/forgot-password')} style={styles.submitBtn}>
          Get a new link
        </button>
      </Shell>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setErrorMsg(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    setErrorMsg('');
    const { error } = await updatePassword(password);
    setSubmitting(false);
    if (error) {
      setErrorMsg(error);
      return;
    }
    setDone(true);
    // Forced-setup users go straight to the dashboard since they were
    // already signed in. Recovery-flow users land on /login next time
    // (their recovery session is fine to keep, but they often want to
    // re-sign-in fresh on a real device). Default: dashboard.
    setTimeout(() => navigate('/dashboard'), 1200);
  };

  if (done) {
    return (
      <Shell>
        <div style={{ fontSize: 42, marginBottom: 10 }}>✓</div>
        <h1 style={styles.title}>Password set</h1>
        <p style={styles.muted}>
          Redirecting to your dashboard…
        </p>
      </Shell>
    );
  }

  const isForce = forceMode || needsPasswordSetup;

  return (
    <Shell>
      <img src="/brand/blw-logo.svg" alt="BLW Studio" style={styles.logo} />
      <h1 style={styles.title}>{isForce ? 'Set your password' : 'Reset password'}</h1>
      <p style={styles.muted}>
        {isForce
          ? "Your account doesn't have a password yet. Set one to continue."
          : `Pick a new password for ${user.email}.`}
      </p>

      <form onSubmit={submit} style={{ width: '100%', marginTop: 20 }}>
        <label htmlFor="np" style={styles.label}>
          New password <span style={styles.hint}>(at least {MIN_PASSWORD_LENGTH} characters)</span>
        </label>
        <input
          id="np"
          type="password"
          required
          autoFocus
          autoComplete="new-password"
          placeholder="••••••••"
          value={password}
          onChange={e => setPassword(e.target.value)}
          disabled={submitting}
          style={styles.input}
        />

        <label htmlFor="np2" style={{ ...styles.label, marginTop: 14 }}>Confirm new password</label>
        <input
          id="np2"
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
          {submitting ? 'Saving…' : 'Save password'}
        </button>
      </form>

      {isForce && (
        <button
          type="button"
          onClick={signOut}
          style={{ ...styles.linkButton, textDecoration: 'underline', marginTop: 16 }}
        >
          Sign out instead
        </button>
      )}
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
  hint: { fontWeight: 400, letterSpacing: 0, color: colors.textMuted, textTransform: 'none' },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 14, fontFamily: fonts.body, border: `1px solid ${colors.border}`, borderRadius: radius.base, background: colors.white, color: colors.text, outline: 'none' },
  errorBox: { marginTop: 10, padding: '8px 12px', background: 'rgba(221,60,60,0.08)', color: '#991B1B', border: `1px solid rgba(221,60,60,0.3)`, borderRadius: radius.base, fontSize: 12, textAlign: 'left' },
  submitBtn: { width: '100%', marginTop: 18, padding: '11px 14px', background: colors.red, color: '#fff', border: 'none', borderRadius: radius.base, fontFamily: fonts.condensed, fontSize: 14, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' },
  linkButton: { background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer', fontFamily: fonts.body, fontSize: 13 },
};
