// ─── BLW Content Hub Design Tokens ─────────────────────────────────────────
// Derived from blwwiffleball.com brand guidelines

export const colors = {
  // Primary
  navy: '#151C28',
  navyDeep: '#0F1624',
  navyLight: '#1E2736',
  red: '#DD3C3C',
  redHover: '#C73535',
  redLight: 'rgba(221, 60, 60, 0.08)',
  redBorder: 'rgba(221, 60, 60, 0.2)',

  // Backgrounds
  white: '#FFFFFF',
  bg: '#F6F7F9',
  muted: '#EDF3F3',
  cardHover: '#FAFBFC',

  // Text
  text: '#151C28',
  textSecondary: '#676F7E',
  textMuted: '#9CA3AF',
  textOnDark: '#FFFFFF',
  textOnDarkMuted: 'rgba(255, 255, 255, 0.6)',

  // Borders & Dividers
  border: '#DCDFE5',
  borderLight: '#EBEDF0',
  divider: '#F0F1F3',

  // Status
  success: '#22C55E',
  successBg: 'rgba(34, 197, 94, 0.08)',
  successBorder: 'rgba(34, 197, 94, 0.2)',
  warning: '#F59E0B',
  warningBg: 'rgba(245, 158, 11, 0.08)',
  warningBorder: 'rgba(245, 158, 11, 0.2)',
  info: '#3B82F6',
  infoBg: 'rgba(59, 130, 246, 0.08)',
  infoBorder: 'rgba(59, 130, 246, 0.2)',
};

// `heading` resolves via a CSS custom property so it can be swapped at
// runtime (Settings → Typography picker, see src/fonts.js). The fallback
// inside var() makes static builds, SSR, and pre-bootstrap renders still
// look correct before applyFont() runs.
export const fonts = {
  heading: 'var(--font-heading, "Bebas Neue", sans-serif)',
  body: "'Barlow', sans-serif",
  condensed: "'Barlow Condensed', sans-serif",
};

export const radius = {
  sm: 4,
  base: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

export const shadows = {
  sm: '0 1px 2px rgba(0,0,0,0.04)',
  md: '0 2px 8px rgba(0,0,0,0.06)',
  lg: '0 4px 16px rgba(0,0,0,0.08)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const sidebar = {
  width: 240,
  collapsedWidth: 64,
};
