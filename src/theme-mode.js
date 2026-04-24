// Runtime light/dark mode toggle. Every color in src/theme.js resolves
// through a CSS custom property (--color-*), so flipping the active
// palette is just a single data-theme attribute change on <html>. No
// component re-renders required, no React prop drilling.
//
// Three modes:
//   'light'  — explicit light palette
//   'dark'   — explicit dark palette
//   'system' — follow the OS (prefers-color-scheme)
//
// Selection is persisted in localStorage and per-browser, same as the
// font theme.

const LS_KEY = 'blw_theme_mode_v1';

// Light palette — matches the current static colors in theme.js exactly,
// so "light" mode is indistinguishable from the pre-dark-mode app.
const LIGHT = {
  'navy':             '#151C28',
  'navyDeep':         '#0F1624',
  'navyLight':        '#1E2736',

  'red':              '#DD3C3C',
  'redHover':         '#C73535',
  'redLight':         'rgba(221, 60, 60, 0.08)',
  'redBorder':        'rgba(221, 60, 60, 0.2)',

  'white':            '#FFFFFF',   // card background in light mode
  'bg':               '#F6F7F9',   // page background
  'muted':            '#EDF3F3',
  'cardHover':        '#FAFBFC',

  'text':             '#151C28',
  'textSecondary':    '#676F7E',
  'textMuted':        '#9CA3AF',
  'textOnDark':       '#FFFFFF',
  'textOnDarkMuted':  'rgba(255, 255, 255, 0.6)',

  'border':           '#DCDFE5',
  'borderLight':      '#EBEDF0',
  'divider':          '#F0F1F3',

  'success':          '#22C55E',
  'successBg':        'rgba(34, 197, 94, 0.08)',
  'successBorder':    'rgba(34, 197, 94, 0.2)',
  'warning':          '#F59E0B',
  'warningBg':        'rgba(245, 158, 11, 0.08)',
  'warningBorder':    'rgba(245, 158, 11, 0.2)',
  'info':             '#3B82F6',
  'infoBg':           'rgba(59, 130, 246, 0.08)',
  'infoBorder':       'rgba(59, 130, 246, 0.2)',
};

// Dark palette — designed to keep the same semantic roles:
//   - `white` still means "card surface" (but it's actually dark blue-gray here)
//   - `bg` still means "page surface behind cards"
//   - `navy` stays the sidebar — slightly DARKER than cards so it reads "below"
//   - brand red is unchanged
// Accent status colors (success/warning/info) brighten so they stay visible
// on the dark surfaces; their tinted backgrounds get a stronger alpha too.
const DARK = {
  'navy':             '#0B0D10',   // sidebar — slightly darker than surface
  'navyDeep':         '#06080A',
  'navyLight':        '#151C28',

  'red':              '#DD3C3C',   // brand, unchanged
  'redHover':         '#EF4444',
  'redLight':         'rgba(221, 60, 60, 0.15)',
  'redBorder':        'rgba(221, 60, 60, 0.35)',

  'white':            '#1A2230',   // card surface
  'bg':               '#0F1320',   // page background
  'muted':            '#1F2736',
  'cardHover':        '#1F2736',

  'text':             '#F1F5F9',
  'textSecondary':    '#94A3B8',
  'textMuted':        '#64748B',
  'textOnDark':       '#F9FAFB',
  'textOnDarkMuted':  'rgba(255, 255, 255, 0.55)',

  'border':           '#2A3340',
  'borderLight':      '#1F2736',
  'divider':          '#1A1F28',

  'success':          '#4ADE80',
  'successBg':        'rgba(74, 222, 128, 0.15)',
  'successBorder':    'rgba(74, 222, 128, 0.35)',
  'warning':          '#FBBF24',
  'warningBg':        'rgba(251, 191, 36, 0.15)',
  'warningBorder':    'rgba(251, 191, 36, 0.35)',
  'info':             '#60A5FA',
  'infoBg':           'rgba(96, 165, 250, 0.15)',
  'infoBorder':       'rgba(96, 165, 250, 0.35)',
};

// Build a CSS string that declares both palettes keyed to the
// [data-theme] attribute. Injected once on bootstrap into <head>.
function buildPaletteCss() {
  const toDecls = (obj) => Object.entries(obj)
    .map(([k, v]) => `  --color-${k}: ${v};`)
    .join('\n');

  return `
:root,
[data-theme="light"] {
${toDecls(LIGHT)}
  color-scheme: light;
}
[data-theme="dark"] {
${toDecls(DARK)}
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  [data-theme="system"] {
${toDecls(DARK)}
    color-scheme: dark;
  }
}
@media (prefers-color-scheme: light) {
  [data-theme="system"] {
${toDecls(LIGHT)}
    color-scheme: light;
  }
}
`.trim();
}

// Inject the palette CSS exactly once. Idempotent so repeated
// bootstrapMode() calls in hot-reload dev mode don't bloat the head.
function ensurePaletteInjected() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('blw-theme-palette')) return;
  const style = document.createElement('style');
  style.id = 'blw-theme-palette';
  style.textContent = buildPaletteCss();
  document.head.appendChild(style);
}

// Update <body> background explicitly — otherwise the hard-coded
// background in index.html (#F6F7F9) overrides dark mode on the outer
// shell. The var fallback keeps things safe pre-bootstrap.
function applyBodyBackground() {
  if (typeof document === 'undefined') return;
  document.body.style.background = 'var(--color-bg, #F6F7F9)';
  document.body.style.color = 'var(--color-text, #151C28)';
}

export function getStoredMode() {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
    return 'light';   // default — matches pre-dark-mode behavior
  } catch { return 'light'; }
}

export function applyMode(mode) {
  ensurePaletteInjected();
  applyBodyBackground();
  const normalized = (mode === 'light' || mode === 'dark' || mode === 'system') ? mode : 'light';
  document.documentElement.setAttribute('data-theme', normalized);
  try { localStorage.setItem(LS_KEY, normalized); } catch {}
  window.dispatchEvent(new CustomEvent('blw-theme-mode-changed', { detail: { mode: normalized } }));
}

export function bootstrapMode() {
  applyMode(getStoredMode());
}

export const THEME_MODES = [
  { id: 'light',  label: 'Light',  icon: '☀' },
  { id: 'dark',   label: 'Dark',   icon: '☾' },
  { id: 'system', label: 'System', icon: '⚙' },
];
