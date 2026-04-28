// ─── BLW Content Hub Design Tokens ─────────────────────────────────────────
// Derived from blwwiffleball.com brand guidelines.
//
// Every color here resolves via a CSS custom property (--color-*) so
// light/dark mode flips at runtime (see src/theme-mode.js). The hex
// fallback inside each var() keeps SSR / pre-bootstrap renders looking
// right, and also serves as the "light" palette's default value.
//
// Components never need to change — `colors.red` still returns something
// inline-style-compatible, just now it's a CSS variable reference that
// the browser resolves against the active [data-theme] root.

export const colors = {
  // Primary
  navy:            'var(--color-navy, #151C28)',
  navyDeep:        'var(--color-navyDeep, #0F1624)',
  navyLight:       'var(--color-navyLight, #1E2736)',
  red:             'var(--color-red, #DD3C3C)',
  redHover:        'var(--color-redHover, #C73535)',
  redLight:        'var(--color-redLight, rgba(221, 60, 60, 0.08))',
  redBorder:       'var(--color-redBorder, rgba(221, 60, 60, 0.2))',

  // Accent tokens — drift to the active team's color when wrapped in a
  // <TeamThemeScope team={team}>. Outside any scope they fall back to
  // the brand red. Use these in place of `red` for surfaces that should
  // honor team context (CTAs, active states, focus rings, content rows).
  // Use plain `red` for chrome that should stay brand-consistent
  // regardless of which team is in view (sidebar, app-level nav, etc).
  accent:          'var(--accent, #DD3C3C)',
  accentHover:     'var(--accent-hover, #C73535)',
  accentText:      'var(--accent-text, #FFFFFF)',
  accentSoft:      'var(--accent-soft, rgba(221, 60, 60, 0.10))',
  accentBorder:    'var(--accent-border, rgba(221, 60, 60, 0.30))',

  // Backgrounds
  white:           'var(--color-white, #FFFFFF)',
  bg:              'var(--color-bg, #F6F7F9)',
  muted:           'var(--color-muted, #EDF3F3)',
  cardHover:       'var(--color-cardHover, #FAFBFC)',

  // Text
  text:            'var(--color-text, #151C28)',
  textSecondary:   'var(--color-textSecondary, #676F7E)',
  textMuted:       'var(--color-textMuted, #9CA3AF)',
  textOnDark:      'var(--color-textOnDark, #FFFFFF)',
  textOnDarkMuted: 'var(--color-textOnDarkMuted, rgba(255, 255, 255, 0.6))',

  // Borders & Dividers
  border:          'var(--color-border, #DCDFE5)',
  borderLight:     'var(--color-borderLight, #EBEDF0)',
  divider:         'var(--color-divider, #F0F1F3)',

  // Status
  success:         'var(--color-success, #22C55E)',
  successBg:       'var(--color-successBg, rgba(34, 197, 94, 0.08))',
  successBorder:   'var(--color-successBorder, rgba(34, 197, 94, 0.2))',
  warning:         'var(--color-warning, #F59E0B)',
  warningBg:       'var(--color-warningBg, rgba(245, 158, 11, 0.08))',
  warningBorder:   'var(--color-warningBorder, rgba(245, 158, 11, 0.2))',
  info:            'var(--color-info, #3B82F6)',
  infoBg:          'var(--color-infoBg, rgba(59, 130, 246, 0.08))',
  infoBorder:      'var(--color-infoBorder, rgba(59, 130, 246, 0.2))',
};

// All three font slots resolve via CSS custom properties so the user
// can swap the entire type system at runtime (Settings → Typography
// picker, see src/fonts.js). Each var() has a built-in fallback so
// pre-bootstrap renders and any component that bypasses applyFont()
// still get a sensible default.
export const fonts = {
  heading:   'var(--font-heading, "Bebas Neue", sans-serif)',
  body:      'var(--font-body, "Barlow", sans-serif)',
  condensed: 'var(--font-condensed, "Barlow Condensed", sans-serif)',
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
