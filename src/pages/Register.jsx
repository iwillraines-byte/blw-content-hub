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
import { colors, radius } from '../theme';
import { TEAMS } from '../data';
import { Icon } from '../icon';
import { AuthShell, authStyles as styles } from '../auth-shell';

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
  // v4.24.0: optional self-identification. 'fan' (default) or 'player'; a
  // player tells us who they are so the master can verify + grant athlete
  // access. Everyone still starts as a fan until approved.
  const [accountType, setAccountType] = useState('fan'); // 'fan' | 'player'
  const [claimTeam, setClaimTeam] = useState('');
  const [claimName, setClaimName] = useState('');
  const [claimNum, setClaimNum] = useState('');
  const [claimCode, setClaimCode] = useState('');

  // Client-side validation summary — surfaces the FIRST problem so the
  // user knows what to fix, rather than a wall of red.
  const validate = () => {
    if (!email.trim()) return 'Enter an email address.';
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (password !== confirm) return 'Passwords do not match.';
    if (accountType === 'player') {
      if (!claimTeam) return 'Pick your team.';
      if (!claimName.trim()) return 'Enter your name as it appears on the roster.';
    }
    return null;
  };

  const submit = async (e) => {
    e.preventDefault();
    const problem = validate();
    if (problem) { setErrorMsg(problem); return; }
    setSubmitting(true);
    setErrorMsg('');
    const { error } = await signUpWithPassword(
      email,
      password,
      accountType === 'player'
        ? { team: claimTeam, name: claimName.trim(), num: claimNum.trim(), code: claimCode.trim() }
        : null,
    );
    setSubmitting(false);
    if (error) {
      // Supabase returns "User already registered" for taken emails,
      // and various password complexity errors when applicable.
      setErrorMsg(error);
      return;
    }
    // v4.16.0: ping the master's inbox. Fire-and-forget — the endpoint
    // verifies server-side that this email really just signed up, and a
    // failure here must never block the registrant's flow.
    try {
      fetch('/api/notify-signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }).catch(() => {});
    } catch { /* non-blocking */ }
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
        <Icon name="mail" size={38} style={{ color: colors.red, marginBottom: 10 }} />
        <h1 style={styles.title}>Check your email</h1>
        <p style={styles.muted}>
          We sent a confirmation link to <strong>{email}</strong>. Click it to
          activate your account, then you'll be able to sign in with your password.
          {accountType === 'player' && ' Your player claim will be reviewed by an admin — you\'ll have fan access in the meantime.'}
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

        <span style={{ ...styles.label, marginTop: 16 }}>I'm a…</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <TypeButton active={accountType === 'fan'} onClick={() => setAccountType('fan')} label="Fan" sub="Follow teams & players" />
          <TypeButton active={accountType === 'player'} onClick={() => setAccountType('player')} label="Player" sub="I'm on a roster" />
        </div>

        {accountType === 'player' && (
          <div style={{ marginTop: 12, padding: 12, background: colors.bg, borderRadius: radius.base, border: `1px solid ${colors.borderLight}` }}>
            <p style={{ fontSize: 11, color: colors.textSecondary, margin: '0 0 10px', lineHeight: 1.5, textAlign: 'left' }}>
              Tell us who you are so an admin can verify you and unlock player access. You'll have fan access until they approve.
            </p>
            <label htmlFor="reg-team" style={styles.label}>Your team</label>
            <select
              id="reg-team"
              value={claimTeam}
              onChange={e => setClaimTeam(e.target.value)}
              disabled={submitting}
              style={styles.input}
            >
              <option value="">Select your team…</option>
              {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>

            <label htmlFor="reg-name" style={{ ...styles.label, marginTop: 12 }}>Your name</label>
            <input
              id="reg-name"
              type="text"
              placeholder="First and last name"
              value={claimName}
              onChange={e => setClaimName(e.target.value)}
              disabled={submitting}
              style={styles.input}
            />

            <label htmlFor="reg-num" style={{ ...styles.label, marginTop: 12 }}>
              Jersey # <span style={styles.hint}>(optional)</span>
            </label>
            <input
              id="reg-num"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 12"
              value={claimNum}
              onChange={e => setClaimNum(e.target.value)}
              disabled={submitting}
              style={{ ...styles.input, maxWidth: 120 }}
            />

            <label htmlFor="reg-code" style={{ ...styles.label, marginTop: 12 }}>
              Team join code <span style={styles.hint}>(optional)</span>
            </label>
            <input
              id="reg-code"
              type="text"
              autoCapitalize="characters"
              placeholder="Ask your team for it"
              value={claimCode}
              onChange={e => setClaimCode(e.target.value)}
              disabled={submitting}
              style={{ ...styles.input, maxWidth: 180, textTransform: 'uppercase' }}
            />
            <p style={{ fontSize: 10, color: colors.textMuted, margin: '6px 0 0', lineHeight: 1.4, textAlign: 'left' }}>
              The code confirms you're really on the roster. You can sign up without it, but an admin will have to verify you manually.
            </p>
          </div>
        )}

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
    <AuthShell>
      <div style={styles.card}>{children}</div>
    </AuthShell>
  );
}

// Segmented "fan vs player" choice on the signup form.
function TypeButton({ active, onClick, label, sub }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, textAlign: 'left', cursor: 'pointer',
        padding: '10px 12px', borderRadius: radius.base,
        border: `1.5px solid ${active ? colors.red : colors.border}`,
        background: active ? colors.redLight : colors.white,
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: active ? colors.red : colors.text }}>{label}</div>
      <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 1 }}>{sub}</div>
    </button>
  );
}

