// Temp-access banner — renders a sticky countdown strip whenever the
// current user has a `role_expires_at` set on their profile. Two states:
//
//   1. Active timer    — "MASTER ACCESS · expires in 5h 23m" (amber)
//                        Color drifts to red when <1h remains.
//   2. Expired         — "MASTER ACCESS EXPIRED · contact admin to extend"
//                        (red, no exit affordance — server already
//                        demoted them, this is just the explanation).
//
// Auto-refreshes the user's profile when the timer crosses zero so the
// server-side demotion takes effect on the next API call without
// requiring a manual reload.

import { useEffect, useMemo, useState } from 'react';
import { useAuth, ROLE_LABELS } from './auth';
import { fonts } from './theme';

function formatRemaining(ms) {
  if (ms <= 0) return '0m';
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${String(mins).padStart(2, '0')}m`;
  }
  if (mins > 0) {
    const secs = totalSec % 60;
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }
  return `${totalSec}s`;
}

export function TempAccessBanner() {
  const { roleExpiresAt, expiredRole, role, refreshProfile } = useAuth();
  const expiry = roleExpiresAt instanceof Date && !isNaN(roleExpiresAt) ? roleExpiresAt : null;
  const isExpired = !!expiredRole && !role;
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second when remaining < 60s, else once a minute. Cheap
  // enough either way; the higher cadence gives a satisfying countdown
  // in the final minute without spamming re-renders all session.
  useEffect(() => {
    if (!expiry && !isExpired) return undefined;
    const remainingMs = expiry ? expiry.getTime() - Date.now() : 0;
    const interval = remainingMs > 0 && remainingMs < 60_000 ? 1000 : 60_000;
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [expiry, isExpired]);

  // When the timer crosses zero, force a profile refresh so the demoted
  // state lands on the client immediately. Without this, the user keeps
  // seeing master tools until they navigate or refresh.
  useEffect(() => {
    if (!expiry || isExpired) return;
    const remainingMs = expiry.getTime() - now;
    if (remainingMs <= 0) {
      refreshProfile?.();
    }
  }, [expiry, isExpired, now, refreshProfile]);

  const remainingMs = expiry ? expiry.getTime() - now : 0;
  const showBanner = isExpired || (expiry && remainingMs > 0);

  const colors = useMemo(() => {
    if (isExpired) {
      return { bg: '#FEE2E2', accent: '#991B1B', text: '#7F1D1D', stripe: '#FCA5A5' };
    }
    if (remainingMs > 0 && remainingMs < 60 * 60 * 1000) {
      // <1h remaining — red warning
      return { bg: '#FEF2F2', accent: '#B91C1C', text: '#7F1D1D', stripe: '#FECACA' };
    }
    // Active timer w/ >1h — amber
    return { bg: '#FEF3C7', accent: '#92400E', text: '#78350F', stripe: '#FDE68A' };
  }, [isExpired, remainingMs]);

  if (!showBanner) return null;

  const displayRole = ROLE_LABELS[expiredRole || role] || (expiredRole || role || 'Elevated');
  const headline = isExpired
    ? `${displayRole.toUpperCase()} ACCESS EXPIRED`
    : `${displayRole.toUpperCase()} ACCESS`;
  const detail = isExpired
    ? 'Your time-boxed session has ended. Contact a master admin to extend.'
    : `expires in ${formatRemaining(remainingMs)}`;

  return (
    <div
      role="status"
      style={{
        position: 'sticky', top: 0, zIndex: 60,
        background: `repeating-linear-gradient(
          45deg,
          ${colors.stripe}66 0,
          ${colors.stripe}66 14px,
          ${colors.bg} 14px,
          ${colors.bg} 28px
        ), ${colors.bg}`,
        borderBottom: `2px solid ${colors.accent}`,
        padding: '8px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        flex: 1, minWidth: 0, flexWrap: 'wrap',
      }}>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 24, height: 24, borderRadius: '50%',
            background: colors.accent, color: '#fff',
            fontSize: 13, fontWeight: 800,
          }}
        >{isExpired ? '🔒' : '⏱'}</span>
        <span style={{
          fontFamily: fonts.body,
          fontSize: 13, fontWeight: 700,
          color: colors.text,
        }}>
          {headline}
        </span>
        <span style={{
          fontFamily: fonts.condensed,
          fontSize: 11, fontWeight: 700,
          letterSpacing: 0.5, color: colors.text, opacity: 0.85,
        }}>
          {detail}
        </span>
      </div>
      {!isExpired && expiry && (
        <span
          title={`Auto-revokes at ${expiry.toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          })}`}
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            fontSize: 12, fontWeight: 700,
            color: colors.text,
            background: '#FFFFFF80',
            padding: '4px 10px', borderRadius: 999,
            border: `1px solid ${colors.accent}33`,
          }}
        >
          {formatRemaining(remainingMs)}
        </span>
      )}
    </div>
  );
}
