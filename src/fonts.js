// Runtime "font theme" picker — lets the user swap the ENTIRE app type
// system (heading + body + condensed) from Settings without a page
// reload. Each theme is a coherent triplet designed to feel right
// together; we don't mix-and-match one face at a time.
//
// How it works:
//   • theme.js resolves all three font slots to CSS custom properties
//       --font-heading   (big display titles: H1s, team names, player names)
//       --font-body      (paragraphs, labels, buttons)
//       --font-condensed (meta chips, "RECORD" labels, badge text)
//   • applyFont(themeId) updates all three properties + injects the
//     Google Fonts <link>s for every family the theme uses (deduped).
//   • Selection is persisted in localStorage so it survives refresh.
//   • Per-browser preference (no cloud sync) — each team member picks
//     their own.

export const FONT_OPTIONS = [
  {
    id: 'blw-classic',
    name: 'BLW Classic',
    description: 'The original — Bebas Neue over Barlow. Hard to beat.',
    heading:   { stack: '"Bebas Neue", sans-serif',       googleFamily: 'Bebas+Neue',                             tracking: 1.5 },
    body:      { stack: '"Barlow", sans-serif',           googleFamily: 'Barlow:wght@400;500;600;700;800;900' },
    condensed: { stack: '"Barlow Condensed", sans-serif', googleFamily: 'Barlow+Condensed:wght@400;500;600;700;800' },
  },
  {
    id: 'broadcast',
    name: 'Broadcast',
    description: 'Oswald headings + Inter body — clean, modern sports graphic',
    heading:   { stack: '"Oswald", sans-serif',           googleFamily: 'Oswald:wght@400;500;600;700',            tracking: 1.0 },
    body:      { stack: '"Inter", sans-serif',            googleFamily: 'Inter:wght@400;500;600;700' },
    condensed: { stack: '"Oswald", sans-serif',           googleFamily: 'Oswald:wght@400;500;600;700' },
  },
  {
    id: 'analytics',
    name: 'Analytics',
    description: 'Saira Condensed everywhere — data-first stats UI',
    heading:   { stack: '"Saira Condensed", sans-serif',  googleFamily: 'Saira+Condensed:wght@400;500;600;700;800', tracking: 0.8 },
    body:      { stack: '"Inter", sans-serif',            googleFamily: 'Inter:wght@400;500;600;700' },
    condensed: { stack: '"Saira Condensed", sans-serif',  googleFamily: 'Saira+Condensed:wght@400;500;600;700;800' },
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Archivo Black heads, Archivo body — magazine-page feel',
    heading:   { stack: '"Archivo Black", sans-serif',    googleFamily: 'Archivo+Black',                          tracking: 0.4 },
    body:      { stack: '"Archivo", sans-serif',          googleFamily: 'Archivo:wght@400;500;600;700' },
    condensed: { stack: '"Archivo Narrow", sans-serif',   googleFamily: 'Archivo+Narrow:wght@400;500;600;700' },
  },
  {
    id: 'punch',
    name: 'Punch',
    description: 'Anton headings with Rubik body — heavyweight, confident',
    heading:   { stack: '"Anton", sans-serif',            googleFamily: 'Anton',                                  tracking: 1.4 },
    body:      { stack: '"Rubik", sans-serif',            googleFamily: 'Rubik:wght@400;500;600;700;800' },
    condensed: { stack: '"Barlow Condensed", sans-serif', googleFamily: 'Barlow+Condensed:wght@400;500;600;700;800' },
  },
  {
    id: 'esports',
    name: 'Esports',
    description: 'Chakra Petch through-and-through — angular, futuristic',
    heading:   { stack: '"Chakra Petch", sans-serif',     googleFamily: 'Chakra+Petch:wght@400;500;600;700',      tracking: 1.0 },
    body:      { stack: '"Chakra Petch", sans-serif',     googleFamily: 'Chakra+Petch:wght@400;500;600;700' },
    condensed: { stack: '"Chakra Petch", sans-serif',     googleFamily: 'Chakra+Petch:wght@400;500;600;700' },
  },
  {
    id: 'broadcast-bold',
    name: 'Broadcast Bold',
    description: 'Big Shoulders Display + DM Sans — stadium-jumbotron energy',
    heading:   { stack: '"Big Shoulders Display", sans-serif', googleFamily: 'Big+Shoulders+Display:wght@400;600;700;800;900', tracking: 1.2 },
    body:      { stack: '"DM Sans", sans-serif',         googleFamily: 'DM+Sans:wght@400;500;600;700' },
    condensed: { stack: '"Barlow Condensed", sans-serif', googleFamily: 'Barlow+Condensed:wght@400;500;600;700;800' },
  },
  {
    id: 'tech-clean',
    name: 'Tech Clean',
    description: 'Space Grotesk everywhere — SaaS-modern, geometric',
    heading:   { stack: '"Space Grotesk", sans-serif',    googleFamily: 'Space+Grotesk:wght@400;500;600;700',     tracking: 0.2 },
    body:      { stack: '"Space Grotesk", sans-serif',    googleFamily: 'Space+Grotesk:wght@400;500;600;700' },
    condensed: { stack: '"Space Grotesk", sans-serif',    googleFamily: 'Space+Grotesk:wght@400;500;600;700' },
  },
  {
    id: 'modern-friendly',
    name: 'Modern Friendly',
    description: 'Unbounded headlines + DM Sans body — approachable + fresh',
    heading:   { stack: '"Unbounded", sans-serif',        googleFamily: 'Unbounded:wght@400;500;600;700;800',     tracking: 0.5 },
    body:      { stack: '"DM Sans", sans-serif',          googleFamily: 'DM+Sans:wght@400;500;600;700' },
    condensed: { stack: '"DM Sans", sans-serif',          googleFamily: 'DM+Sans:wght@400;500;600;700' },
  },
  {
    id: 'data-pro',
    name: 'Data Pro',
    description: 'Oswald heads + Manrope body — pro analytics tool vibe',
    heading:   { stack: '"Oswald", sans-serif',           googleFamily: 'Oswald:wght@400;500;600;700',            tracking: 1.0 },
    body:      { stack: '"Manrope", sans-serif',          googleFamily: 'Manrope:wght@400;500;600;700;800' },
    condensed: { stack: '"Oswald", sans-serif',           googleFamily: 'Oswald:wght@400;500;600;700' },
  },
];

const LS_KEY = 'blw_font_theme_v2';
// Legacy key from the heading-only picker. Used on first bootstrap to
// migrate an existing preference into the new theme model.
const LEGACY_LS_KEY = 'blw_display_font_v1';
const LEGACY_MAP = {
  bebas: 'blw-classic',
  oswald: 'broadcast',
  anton: 'punch',
  'saira-condensed': 'analytics',
  'big-shoulders': 'broadcast-bold',
  'barlow-condensed': 'blw-classic',
  'space-grotesk': 'tech-clean',
  'chakra-petch': 'esports',
  'archivo-black': 'editorial',
  unbounded: 'modern-friendly',
};

export function getStoredFontId() {
  try {
    const v2 = localStorage.getItem(LS_KEY);
    if (v2) return v2;
    // Migrate from the old heading-only picker if present.
    const legacy = localStorage.getItem(LEGACY_LS_KEY);
    if (legacy && LEGACY_MAP[legacy]) return LEGACY_MAP[legacy];
    return 'blw-classic';
  } catch { return 'blw-classic'; }
}

export function getFontById(id) {
  return FONT_OPTIONS.find(f => f.id === id) || FONT_OPTIONS[0];
}

// Inject a <link> for a Google Fonts family. We de-dup by the family
// string so repeated applications don't bloat the head. Each theme
// may reference 1–3 families (sometimes the same face in multiple slots).
function ensureFontLink(family) {
  if (!family) return;
  const existing = document.querySelector(`link[data-blw-font="${family}"]`);
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  link.setAttribute('data-blw-font', family);
  document.head.appendChild(link);
}

export function applyFont(id) {
  const f = getFontById(id);
  // Load every family the theme uses. Dedup is cheap (Set).
  const families = new Set([f.heading?.googleFamily, f.body?.googleFamily, f.condensed?.googleFamily].filter(Boolean));
  families.forEach(ensureFontLink);

  const root = document.documentElement;
  root.style.setProperty('--font-heading',   f.heading.stack);
  root.style.setProperty('--font-body',      f.body.stack);
  root.style.setProperty('--font-condensed', f.condensed.stack);
  root.style.setProperty('--font-heading-tracking', `${f.heading.tracking ?? 1}px`);

  try { localStorage.setItem(LS_KEY, f.id); } catch {}
  // Fire an event so Settings (or any listener) can re-render its preview
  window.dispatchEvent(new CustomEvent('blw-font-changed', { detail: { id: f.id } }));
}

// Apply on startup — call once from main.jsx before React renders.
export function bootstrapFont() {
  applyFont(getStoredFontId());
}
