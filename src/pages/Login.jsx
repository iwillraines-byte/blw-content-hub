// Login page — magic-link email sign-in.
//
// Flow:
//   1. User types their email → clicks "Send magic link".
//   2. Supabase emails a one-time link. The link returns to `/auth/callback`
//      with an access token in the URL hash.
//   3. The `detectSessionInUrl` option on the supabase client parses that
//      hash automatically on mount and stores the session.
//   4. AuthProvider's onAuthStateChange fires → user lands signed in.
//
// Security model (Phase 5a):
//   Supabase's dashboard gates WHO can receive a magic link. In the project's
//   Auth settings, "Allow new users to sign up" should be OFF — only users
//   who have been manually invited by the admin (Auth → Users → Invite) will
//   receive a working link. Anyone else gets "Email not allowed."
//
// Phase 5b will add a profiles-table check so role + team_id are loaded on
// every sign-in. That logic belongs in AuthProvider, not here.

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, supabaseConfigured } from '../supabase-client';
import { colors, fonts, radius, shadows } from '../theme';

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirectTo = params.get('next') || '/dashboard';

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [errorMsg, setErrorMsg] = useState('');

  const sendLink = async (e) => {
    e.preventDefault();
    if (!email.trim() || !supabaseConfigured) return;
    setStatus('sending');
    setErrorMsg('');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          // Where the link redirects after click. Site URL + this path must
          // be registered in Supabase → Auth → URL Configuration.
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
          // Phase 5a: don't auto-create new users here. The admin invites
          // people via the Supabase dashboard. Uninvited emails will get
          // rejected by Supabase before a link is sent.
          shouldCreateUser: false,
        },
      });
      if (error) throw error;
      setStatus('sent');
    } catch (err) {
      console.error('[login] magic link failed', err);
      setStatus('error');
      setErrorMsg(err?.message || 'Failed to send magic link. Try again.');
    }
  };

  // Guard: if Supabase isn't configured at build time we can't do auth.
  // Surface a clear message instead of a broken form.
  if (!supabaseConfigured) {
    return (
      <LoginShell>
        <img
          src="/brand/blw-logo.svg"
          alt="BLW Studio"
          style={{
            display: 'block', width: 88, height: 88,
            objectFit: 'contain', marginBottom: 14, opacity: 0.6,
          }}
        />
        <h1 style={styles.title}>Cloud not configured</h1>
        <p style={styles.muted}>
          This deployment is missing <code>VITE_SUPABASE_URL</code> or
          <code> VITE_SUPABASE_ANON_KEY</code>. Add them to your environment
          and redeploy.
        </p>
      </LoginShell>
    );
  }

  if (status === 'sent') {
    return (
      <LoginShell>
        <div style={{ fontSize: 42, marginBottom: 10 }}>✉️</div>
        <h1 style={styles.title}>Check your email</h1>
        <p style={styles.muted}>
          A magic link was sent to <strong>{email}</strong>. Click it on this
          device to sign in. The link expires in 1 hour.
        </p>
        <button
          onClick={() => { setStatus('idle'); setEmail(''); }}
          style={styles.linkButton}
        >
          ← Use a different email
        </button>
      </LoginShell>
    );
  }

  return (
    <LoginShell>
      {/* v4.5.24: full BLW logo file replaces the placeholder mark.
          Drop a new SVG at /public/brand/blw-logo.svg to refresh the
          lockup app-wide. */}
      <img
        src="/brand/blw-logo.svg"
        alt="BLW Studio"
        style={{
          display: 'block', width: 96, height: 96,
          objectFit: 'contain', marginBottom: 14,
        }}
      />
      <h1 style={styles.title}>BLW Studio</h1>
      <p style={styles.muted}>Sign in with your email to continue.</p>

      <form onSubmit={sendLink} style={{ width: '100%', marginTop: 20 }}>
        <label htmlFor="email" style={styles.label}>Email address</label>
        <input
          id="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={status === 'sending'}
          style={styles.input}
        />

        {status === 'error' && (
          <div style={styles.errorBox}>{errorMsg}</div>
        )}

        <button type="submit" disabled={status === 'sending' || !email.trim()} style={{
          ...styles.submitBtn,
          opacity: status === 'sending' || !email.trim() ? 0.6 : 1,
          cursor: status === 'sending' ? 'wait' : 'pointer',
        }}>
          {status === 'sending' ? 'Sending…' : 'Send magic link'}
        </button>
      </form>

      <p style={{ ...styles.muted, fontSize: 11, marginTop: 20, lineHeight: 1.5 }}>
        Only invited emails can sign in. If you don't have access yet, ask your
        admin to send an invite.
      </p>
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
  logoMark: {
    width: 56, height: 56, borderRadius: radius.base,
    background: colors.red, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: fonts.heading, fontSize: 28, letterSpacing: 1,
    marginBottom: 14,
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
};
