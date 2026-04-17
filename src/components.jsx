import { TEAMS, getTeam } from './data';
import { colors, fonts, radius, shadows } from './theme';

// ─── Layout Components ─────────────────────────────────────────────────────

export const Card = ({ children, style, onClick, ...p }) => (
  <div onClick={onClick} style={{
    background: colors.white,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.base,
    padding: 18,
    boxShadow: shadows.sm,
    cursor: onClick ? 'pointer' : 'default',
    transition: 'box-shadow 0.15s, border-color 0.15s',
    ...style
  }} {...p}>{children}</div>
);

export const PageHeader = ({ title, subtitle, children }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
    <div>
      <h1 style={{
        fontFamily: fonts.heading,
        fontSize: 36,
        fontWeight: 400,
        color: colors.text,
        margin: 0,
        letterSpacing: 1.5,
        lineHeight: 1
      }}>{title}</h1>
      {subtitle && (
        <p style={{
          fontFamily: fonts.body,
          fontSize: 14,
          color: colors.textSecondary,
          margin: '6px 0 0',
          fontWeight: 500
        }}>{subtitle}</p>
      )}
    </div>
    {children && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{children}</div>}
  </div>
);

export const SectionHeading = ({ children, style }) => (
  <h2 style={{
    fontFamily: fonts.heading,
    fontSize: 22,
    fontWeight: 400,
    color: colors.text,
    margin: '0 0 12px',
    letterSpacing: 1,
    ...style
  }}>{children}</h2>
);

export const Label = ({ children, style }) => (
  <div style={{
    fontFamily: fonts.condensed,
    fontSize: 12,
    fontWeight: 600,
    color: colors.textSecondary,
    marginBottom: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    ...style
  }}>{children}</div>
);

// ─── Data Display ───────────────────────────────────────────────────────────

export const TeamChip = ({ teamId, small }) => {
  const t = getTeam(teamId);
  if (!t) return null;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      background: t.color,
      color: t.accent,
      padding: small ? '2px 7px' : '3px 10px',
      borderRadius: radius.sm,
      fontSize: small ? 9 : 11,
      fontFamily: fonts.condensed,
      fontWeight: 700,
      letterSpacing: 0.6
    }}>{t.id}</span>
  );
};

export const StatusBadge = ({ status }) => {
  const map = {
    pending: { bg: '#FEF3C7', c: '#92400E', l: 'Pending' },
    'in-progress': { bg: '#DBEAFE', c: '#1E40AF', l: 'In Progress' },
    approved: { bg: '#D1FAE5', c: '#065F46', l: 'Approved' },
    revision: { bg: '#FEE2E2', c: '#991B1B', l: 'Revision' },
    completed: { bg: '#D1FAE5', c: '#065F46', l: 'Completed' },
  };
  const s = map[status] || { bg: '#F3F4F6', c: '#374151', l: status };
  return (
    <span style={{
      background: s.bg, color: s.c,
      padding: '3px 10px', borderRadius: radius.full,
      fontSize: 10, fontFamily: fonts.condensed,
      fontWeight: 700, letterSpacing: 0.3,
      textTransform: 'uppercase', whiteSpace: 'nowrap'
    }}>{s.l}</span>
  );
};

export const PriorityDot = ({ p }) => (
  <span style={{
    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
    background: { high: '#EF4444', medium: '#F59E0B', low: '#22C55E' }[p] || '#9CA3AF',
    marginRight: 4
  }} />
);

// ─── Buttons ────────────────────────────────────────────────────────────────

export const RedButton = ({ children, onClick, disabled, style }) => (
  <button onClick={onClick} disabled={disabled} style={{
    background: disabled ? '#E5E7EB' : colors.red,
    color: disabled ? '#9CA3AF' : '#FFFFFF',
    border: 'none',
    borderRadius: radius.base,
    padding: '10px 22px',
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer',
    letterSpacing: 0.3,
    transition: 'background 0.15s',
    ...style
  }}>{children}</button>
);

export const OutlineButton = ({ children, onClick, disabled, style }) => (
  <button onClick={onClick} disabled={disabled} style={{
    background: 'transparent',
    color: disabled ? '#9CA3AF' : colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.base,
    padding: '9px 20px',
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
    letterSpacing: 0.3,
    transition: 'background 0.15s, border-color 0.15s',
    ...style
  }}>{children}</button>
);

export const IconButton = ({ children, onClick, active, style }) => (
  <button onClick={onClick} style={{
    background: active ? colors.redLight : 'transparent',
    color: active ? colors.red : colors.textSecondary,
    border: 'none',
    borderRadius: radius.sm,
    width: 34, height: 34,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer',
    fontSize: 16,
    transition: 'background 0.15s',
    ...style
  }}>{children}</button>
);

// ─── Form Elements ──────────────────────────────────────────────────────────

export const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  background: colors.white,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.base,
  padding: '9px 12px',
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: 500,
  outline: 'none',
  transition: 'border-color 0.15s',
};

export const selectStyle = { ...inputStyle, cursor: 'pointer' };

// ─── Utility ────────────────────────────────────────────────────────────────

export const Divider = ({ style }) => (
  <div style={{ height: 1, background: colors.divider, margin: '16px 0', ...style }} />
);

export const Badge = ({ children, color = colors.red, style }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: color, color: '#fff',
    fontSize: 10, fontFamily: fonts.condensed, fontWeight: 700,
    minWidth: 18, height: 18, borderRadius: radius.full,
    padding: '0 5px',
    ...style
  }}>{children}</span>
);
