// ─── GlobalStyles ───────────────────────────────────────────────────────────
//
// All hover, active, and focus-visible affordances for the app's interactive
// chrome. Lives as a single <style> element rendered once at the app root
// (alongside TierBadgeStyles).
//
// Why a global stylesheet rather than inline `style` callbacks?
//
//   The codebase styles components via inline `style={{}}`. Inline styles
//   can't express :hover, :focus-visible, or :active. The previous workaround
//   was onMouseEnter/onMouseLeave handlers, which weren't applied — so the
//   app had no hover states anywhere except a few native `cursor` cues.
//
//   The trick to making class-based hovers work alongside inline styles:
//   move ONLY the affected properties (background, color, transform) out of
//   inline style and into the class. CSS specificity rule: inline style
//   beats class selectors for properties they share, so leaving `background`
//   out of inline style lets `.btn-primary:hover { background: ... }` fire.
//   Everything else (padding, font, radius, etc.) stays inline so each
//   component still owns its layout.
//
// Variables read here come from theme.js (--color-*) and team-theme.jsx
// (--accent / --accent-hover / --accent-text). Brand red is the fallback
// when no scope is active.
//
// Motion philosophy: ease-out exponential curves only, no bounce, durations
// 80-150ms. Long enough to feel responsive, short enough to not delay the
// power user. Respects prefers-reduced-motion.

const css = `
/* ─── Focus ring ──────────────────────────────────────────────────────── */
/* Always honor keyboard focus (focus-visible only fires on keyboard nav,
   never on click) so power users can navigate with tab without seeing a
   ring on every button click. */
:focus { outline: none; }
:focus-visible {
  outline: 2px solid var(--accent, #DD3C3C);
  outline-offset: 2px;
  border-radius: 6px;
}

/* ─── Primary button (RedButton) ──────────────────────────────────────── */
.btn-primary {
  background: var(--accent, #DD3C3C);
  color: var(--accent-text, #FFFFFF);
  transition: background 0.12s cubic-bezier(0.22, 1, 0.36, 1),
              transform 0.08s cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 0.12s cubic-bezier(0.22, 1, 0.36, 1);
}
.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover, #C73535);
  box-shadow: 0 2px 8px rgba(221, 60, 60, 0.18);
}
.btn-primary:active:not(:disabled) {
  transform: scale(0.97);
  box-shadow: none;
}
.btn-primary:disabled {
  background: #E5E7EB;
  color: #9CA3AF;
  cursor: default;
}

/* ─── Outline button ──────────────────────────────────────────────────── */
.btn-outline {
  transition: background 0.12s cubic-bezier(0.22, 1, 0.36, 1),
              border-color 0.12s cubic-bezier(0.22, 1, 0.36, 1),
              transform 0.08s cubic-bezier(0.22, 1, 0.36, 1);
}
.btn-outline:hover:not(:disabled) {
  background: var(--accent-soft, rgba(221, 60, 60, 0.08));
  border-color: var(--accent-border, rgba(221, 60, 60, 0.30));
}
.btn-outline:active:not(:disabled) {
  transform: scale(0.97);
}

/* ─── Icon button ─────────────────────────────────────────────────────── */
.btn-icon {
  transition: background 0.12s cubic-bezier(0.22, 1, 0.36, 1),
              color 0.12s cubic-bezier(0.22, 1, 0.36, 1);
}
.btn-icon:hover {
  background: var(--accent-soft, rgba(221, 60, 60, 0.08));
  color: var(--accent, #DD3C3C);
}

/* ─── Card hover (only when clickable) ────────────────────────────────── */
/* The clickable variant gets a subtle lift + tinted border on hover. The
   inline style still owns the default border + shadow; we only override
   on hover so the card has somewhere to go. */
.card-clickable {
  transition: box-shadow 0.15s cubic-bezier(0.22, 1, 0.36, 1),
              border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1),
              transform 0.15s cubic-bezier(0.22, 1, 0.36, 1);
}
.card-clickable:hover {
  border-color: var(--accent-border, rgba(221, 60, 60, 0.30));
  box-shadow: 0 4px 16px rgba(17, 24, 39, 0.08), 0 2px 4px rgba(17, 24, 39, 0.04);
  transform: translateY(-1px);
}
.card-clickable:active {
  transform: translateY(0);
  box-shadow: 0 1px 3px rgba(17, 24, 39, 0.04);
}

/* ─── Nav links (sidebar + dropdown) ──────────────────────────────────── */
/* Sidebar links sit in a dark surface, so hover uses a soft white tint
   rather than the brand-red soft tint (which would be invisible). */
.nav-link {
  transition: background 0.12s cubic-bezier(0.22, 1, 0.36, 1),
              color 0.12s cubic-bezier(0.22, 1, 0.36, 1);
}
.nav-link:not(.is-active):hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.92) !important;
}

/* ─── Form inputs and selects ─────────────────────────────────────────── */
/* Subtle border tint on focus — pulls toward whatever accent is active. */
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: none;
  border-color: var(--accent, #DD3C3C) !important;
  box-shadow: 0 0 0 3px var(--accent-soft, rgba(221, 60, 60, 0.10));
}

/* Hover on form fields: slight border darken so text feels editable. */
input:hover:not(:disabled):not(:focus-visible),
select:hover:not(:disabled):not(:focus-visible),
textarea:hover:not(:disabled):not(:focus-visible) {
  border-color: var(--color-textSecondary, #676F7E);
}

/* ─── Slider thumb (range inputs) ─────────────────────────────────────── */
/* Pan/zoom + opacity sliders. The native thumb gets a small grow-on-grab
   tactile cue. accentColor on the input itself is set inline. */
input[type="range"]::-webkit-slider-thumb {
  transition: transform 0.08s cubic-bezier(0.22, 1, 0.36, 1);
}
input[type="range"]:active::-webkit-slider-thumb {
  transform: scale(1.18);
}

/* ─── Skeleton shimmer ────────────────────────────────────────────────── */
/* Used by <Skeleton /> to indicate content is loading. The animation slides
   a soft highlight across a low-contrast block. Layered on top of any
   background, so it works on cards (white) and the page bg (warm neutral)
   alike. */
@keyframes blw-shimmer {
  0%   { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
}
.skeleton {
  background-color: var(--color-muted, #EDF3F3);
  background-image: linear-gradient(
    90deg,
    transparent 0,
    rgba(255, 255, 255, 0.55) 50%,
    transparent 100%
  );
  background-size: 200px 100%;
  background-repeat: no-repeat;
  animation: blw-shimmer 1.4s cubic-bezier(0.22, 1, 0.36, 1) infinite;
  border-radius: 6px;
  display: block;
}
[data-theme="dark"] .skeleton,
[data-theme="system"] .skeleton {
  background-image: linear-gradient(
    90deg,
    transparent 0,
    rgba(255, 255, 255, 0.06) 50%,
    transparent 100%
  );
}

/* ─── Route transitions ──────────────────────────────────────────────── */
/* Fade-up on route change. The route wrapper in App.jsx is keyed on
   pathname, so React unmounts/remounts the subtree on navigation, which
   triggers the keyframe afresh. 120ms is short enough to not delay the
   power user, long enough to feel like continuity. */
@keyframes blw-route-in {
  0%   { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}
.route-enter {
  animation: blw-route-in 0.18s cubic-bezier(0.22, 1, 0.36, 1) both;
}

/* ─── Tabular figures on stats data ──────────────────────────────────── */
/* Numbers in stats columns align rigidly so .341 / .298 / .287 read as
   a column instead of a smear. Applied at the table level so cells with
   non-numeric text aren't affected. */
.tnum,
.tnum td,
.tnum th {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}

/* ─── Reduced motion ──────────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .btn-primary,
  .btn-outline,
  .btn-icon,
  .card-clickable,
  .nav-link,
  input,
  select,
  textarea,
  input[type="range"]::-webkit-slider-thumb {
    transition: none !important;
  }
  .btn-primary:active:not(:disabled),
  .btn-outline:active:not(:disabled),
  .card-clickable:hover,
  .card-clickable:active,
  input[type="range"]:active::-webkit-slider-thumb {
    transform: none !important;
  }
  .skeleton,
  .route-enter {
    animation: none !important;
  }
}
`;

export function GlobalStyles() {
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
