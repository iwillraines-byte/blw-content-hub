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

import { useState, useEffect } from 'react';

const LS_KEY = 'blw_theme_mode_v1';

// Palettes are written in OKLCH so neutrals can pull a whisper of warmth
// toward the brand hue (red, ~26.5°) instead of the off-the-shelf cool
// grays that scream "Tailwind defaults". Chroma values are kept low
// (0.003-0.015) so the tint is barely perceptible — neutrals still read
// as neutrals, just with a subtle family resemblance to the brand red.
//
// Brand hue anchor: oklch(0.59 0.21 26.5) = ~#DD3C3C.
//
// Status color hues are deliberately offset from their Tailwind defaults
// (which the rest of the world uses verbatim) and dialed slightly warmer:
//   success  hue 150 (more forest-leaning) instead of the generic 145
//   warning  hue 70  (closer to amber than yellow) — fits a sports brand
//   info     hue 245 (a touch more violet-blue) instead of generic 240
//
// Hex fallbacks live in src/theme.js for the rare pre-bootstrap render
// path (the `var(--color-x, #hex)` pattern). The OKLCH values below are
// what every active surface actually resolves to.
const LIGHT = {
  'navy':             'oklch(0.20 0.015 26.5)',
  'navyDeep':         'oklch(0.15 0.012 26.5)',
  'navyLight':        'oklch(0.25 0.014 26.5)',

  'red':              'oklch(0.59 0.21 26.5)',
  'redHover':         'oklch(0.54 0.20 26.5)',
  'redLight':         'oklch(0.59 0.21 26.5 / 0.08)',
  'redBorder':        'oklch(0.59 0.21 26.5 / 0.20)',

  'white':            'oklch(0.995 0.001 26.5)',       // card background
  'bg':               'oklch(0.975 0.003 26.5)',       // page background
  'muted':            'oklch(0.955 0.005 26.5)',
  'cardHover':        'oklch(0.985 0.002 26.5)',

  'text':             'oklch(0.20 0.015 26.5)',
  'textSecondary':    'oklch(0.50 0.012 26.5)',
  // a11y: darkened from 0.70 so muted/placeholder text clears WCAG AA 4.5:1
  // on every light surface (was ~2.5:1 on white — a hard fail).
  'textMuted':        'oklch(0.537 0.008 26.5)',
  'textOnDark':       'oklch(0.99 0.001 26.5)',
  'textOnDarkMuted':  'oklch(0.99 0.001 26.5 / 0.6)',

  'border':           'oklch(0.89 0.005 26.5)',
  'borderLight':      'oklch(0.94 0.004 26.5)',
  'divider':          'oklch(0.96 0.003 26.5)',

  'success':          'oklch(0.65 0.16 150)',
  'successBg':        'oklch(0.65 0.16 150 / 0.10)',
  'successBorder':    'oklch(0.65 0.16 150 / 0.24)',
  'warning':          'oklch(0.74 0.16 70)',
  'warningBg':        'oklch(0.74 0.16 70 / 0.12)',
  'warningBorder':    'oklch(0.74 0.16 70 / 0.26)',
  'info':             'oklch(0.62 0.18 245)',
  'infoBg':           'oklch(0.62 0.18 245 / 0.10)',
  'infoBorder':       'oklch(0.62 0.18 245 / 0.24)',
};

// Dark palette — same warmth strategy. Surfaces drift slightly warm at
// the same hue (26.5°) but very low chroma, so the dark world feels
// related to the brand red instead of generic cool blue-gray. Status
// colors brighten via lightness so they stay visible on dark surfaces.
// v5: charcoal monochrome — neutral and faintly cool, NOT warm/brown. The
// neutrals sit at hue ~265 with near-zero chroma so every surface reads as a
// clean charcoal gray-scale; the brand red and team accents carry the only
// real color and are nudged brighter so they pop. Card surface (white 0.205)
// sits a step above the page (bg 0.165); borders stay hairline.
const DARK = {
  'navy':             'oklch(0.150 0.003 265)',
  'navyDeep':         'oklch(0.118 0.003 265)',
  'navyLight':        'oklch(0.210 0.004 265)',

  'red':              'oklch(0.645 0.215 26.5)',
  'redHover':         'oklch(0.685 0.225 26.5)',
  'redLight':         'oklch(0.645 0.215 26.5 / 0.18)',
  'redBorder':        'oklch(0.645 0.215 26.5 / 0.36)',

  'white':            'oklch(0.205 0.004 265)',        // card surface
  'bg':               'oklch(0.165 0.003 265)',        // page background
  'muted':            'oklch(0.250 0.004 265)',
  'cardHover':        'oklch(0.240 0.004 265)',

  // Bright primary text; secondary/muted stepped down for a premium,
  // restrained hierarchy (still legible on the 0.205 card surface).
  'text':             'oklch(0.965 0.003 265)',
  'textSecondary':    'oklch(0.770 0.005 265)',
  // a11y: lightened from 0.585 so muted/placeholder text clears WCAG AA
  // 4.5:1 on every dark surface incl. the muted panel (was ~3.8-4.3:1).
  'textMuted':        'oklch(0.627 0.006 265)',
  'textOnDark':       'oklch(0.980 0.003 265)',
  'textOnDarkMuted':  'oklch(0.980 0.003 265 / 0.62)',

  'border':           'oklch(0.305 0.005 265)',
  'borderLight':      'oklch(0.260 0.004 265)',
  'divider':          'oklch(0.235 0.004 265)',

  'success':          'oklch(0.76 0.17 150)',
  'successBg':        'oklch(0.76 0.17 150 / 0.16)',
  'successBorder':    'oklch(0.76 0.17 150 / 0.34)',
  'successText':      'oklch(0.84 0.16 150)',
  'warning':          'oklch(0.82 0.16 75)',
  'warningBg':        'oklch(0.82 0.16 75 / 0.16)',
  'warningBorder':    'oklch(0.82 0.16 75 / 0.34)',
  'warningText':      'oklch(0.87 0.14 75)',
  'info':             'oklch(0.72 0.16 245)',
  'infoBg':           'oklch(0.72 0.16 245 / 0.16)',
  'infoBorder':       'oklch(0.72 0.16 245 / 0.36)',
  'infoText':         'oklch(0.84 0.15 245)',
  'dangerText':       'oklch(0.74 0.19 26.5)',
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
    return 'dark';   // v5: dark-premium is the default identity
  } catch { return 'dark'; }
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

// Is the active theme dark? Reactive to runtime toggles + the OS preference
// (for 'system'). Used by TeamThemeScope + pages to pick a surface-readable
// team accent — team primaries (Atlanta navy, Vegas black) vanish on the dark
// charcoal, so accent chrome swaps to the lighter team.accent on dark.
export function resolveDark() {
  if (typeof document === 'undefined') return true;
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}
export function useIsDark() {
  const [dark, setDark] = useState(resolveDark);
  useEffect(() => {
    const update = () => setDark(resolveDark());
    window.addEventListener('blw-theme-mode-changed', update);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('blw-theme-mode-changed', update);
      mq?.removeEventListener?.('change', update);
    };
  }, []);
  return dark;
}

export const THEME_MODES = [
  { id: 'light',  label: 'Light',  icon: '☀' },
  { id: 'dark',   label: 'Dark',   icon: '☾' },
  { id: 'system', label: 'System', icon: '⚙' },
];
