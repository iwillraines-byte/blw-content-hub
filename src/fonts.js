// Runtime font picker — lets the user swap the display heading font
// (Bebas Neue by default) from Settings without a page reload. The body
// and condensed fonts stay as Barlow / Barlow Condensed.
//
// How it works:
//   • `theme.fonts.heading` resolves to `var(--font-heading, "Bebas Neue", sans-serif)`.
//   • `applyFont(id)` updates the CSS custom property + injects a Google
//     Fonts <link> for the chosen family.
//   • Selection is persisted in localStorage so it survives refresh.
//   • Per-browser preference (no cloud sync) — each team member can have
//     their own typography.

export const FONT_OPTIONS = [
  {
    id: 'bebas',
    name: 'Bebas Neue',
    description: 'Classic sports display — bold, all-caps friendly',
    stack: '"Bebas Neue", sans-serif',
    googleFamily: 'Bebas+Neue',
    tracking: 1.5,
  },
  {
    id: 'oswald',
    name: 'Oswald',
    description: 'Refined Bebas cousin — better kerning, still condensed',
    stack: '"Oswald", sans-serif',
    googleFamily: 'Oswald:wght@400;500;600;700',
    tracking: 1.2,
  },
  {
    id: 'anton',
    name: 'Anton',
    description: 'Punchier than Bebas — thicker strokes, pure display',
    stack: '"Anton", sans-serif',
    googleFamily: 'Anton',
    tracking: 1.5,
  },
  {
    id: 'saira-condensed',
    name: 'Saira Condensed',
    description: 'Technical, data-first — modern sports UI',
    stack: '"Saira Condensed", sans-serif',
    googleFamily: 'Saira+Condensed:wght@400;500;600;700;800',
    tracking: 0.8,
  },
  {
    id: 'big-shoulders',
    name: 'Big Shoulders Display',
    description: 'Distinctive industrial feel — from TypeNetwork',
    stack: '"Big Shoulders Display", sans-serif',
    googleFamily: 'Big+Shoulders+Display:wght@400;600;700;800;900',
    tracking: 1.2,
  },
  {
    id: 'barlow-condensed',
    name: 'Barlow Condensed',
    description: 'Matches the body text — quietly modern',
    stack: '"Barlow Condensed", sans-serif',
    googleFamily: 'Barlow+Condensed:wght@400;500;600;700;800',
    tracking: 0.8,
  },
  {
    id: 'space-grotesk',
    name: 'Space Grotesk',
    description: 'Modern + geometric — tech / SaaS vibe',
    stack: '"Space Grotesk", sans-serif',
    googleFamily: 'Space+Grotesk:wght@400;500;600;700',
    tracking: 0.2,
  },
  {
    id: 'chakra-petch',
    name: 'Chakra Petch',
    description: 'Tech / esports energy — angular, futuristic',
    stack: '"Chakra Petch", sans-serif',
    googleFamily: 'Chakra+Petch:wght@400;500;600;700',
    tracking: 1.0,
  },
  {
    id: 'archivo-black',
    name: 'Archivo Black',
    description: 'Bold geometric sans — confident, editorial',
    stack: '"Archivo Black", sans-serif',
    googleFamily: 'Archivo+Black',
    tracking: 0.4,
  },
  {
    id: 'unbounded',
    name: 'Unbounded',
    description: 'Rounded display — friendly, distinctive',
    stack: '"Unbounded", sans-serif',
    googleFamily: 'Unbounded:wght@400;500;600;700;800',
    tracking: 0.5,
  },
];

const LS_KEY = 'blw_display_font_v1';

export function getStoredFontId() {
  try { return localStorage.getItem(LS_KEY) || 'bebas'; }
  catch { return 'bebas'; }
}

export function getFontById(id) {
  return FONT_OPTIONS.find(f => f.id === id) || FONT_OPTIONS[0];
}

// Inject a <link> for the chosen Google Fonts family. We de-dup by the
// family name so repeated applications don't bloat the head.
function ensureFontLink(family) {
  const href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  const existing = document.querySelector(`link[data-blw-font="${family}"]`);
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute('data-blw-font', family);
  document.head.appendChild(link);
}

export function applyFont(id) {
  const f = getFontById(id);
  ensureFontLink(f.googleFamily);
  document.documentElement.style.setProperty('--font-heading', f.stack);
  document.documentElement.style.setProperty('--font-heading-tracking', `${f.tracking}px`);
  try { localStorage.setItem(LS_KEY, f.id); } catch {}
  // Fire an event so Settings (or any listener) can re-render its preview
  window.dispatchEvent(new CustomEvent('blw-font-changed', { detail: { id: f.id } }));
}

// Apply on startup — call once from main.jsx before React renders.
export function bootstrapFont() {
  applyFont(getStoredFontId());
}
