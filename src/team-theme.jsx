// ─── TeamThemeScope ────────────────────────────────────────────────────────
//
// Scopes a set of CSS custom properties (--accent, --accent-hover,
// --accent-text, --accent-soft, --accent-border) to a subtree, so that
// any descendant component that reads `colors.accent` (etc.) from the
// theme picks up the team's palette instead of the global brand red.
//
// Why scope via CSS variables instead of React context?
//
//   - Inline styles (the only styling system in this app) can't read
//     React context cheaply on every render.
//   - CSS vars cascade naturally — nested scopes override outer ones,
//     and a button using `colors.accent` doesn't care where the value
//     comes from.
//   - When `team` is null, the var falls back to the brand red baked
//     into theme.js, so we get graceful degradation without props
//     drilling.
//
// Usage:
//   <TeamThemeScope team={team}>
//     <RedButton>...</RedButton>   ← drifts to team.color
//   </TeamThemeScope>
//
// Pass `null`/`undefined` to fall back to brand red. Nested scopes work
// (e.g. wrap whole route in a URL-derived scope, then a subtree in a
// state-derived scope) — the closest one wins.

// Heuristic for picking a readable text color on top of an arbitrary
// hex background. A dark team color (Boston navy, Vegas black) gets
// white text; a light team color gets near-black.
export function bestTextOn(hex) {
  if (!hex) return '#FFFFFF';
  const m = /^#?([a-f\d]{6})$/i.exec(String(hex).trim());
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#111827' : '#FFFFFF';
}

// Convert a hex string to "rgba(r, g, b, alpha)". Used for soft tints.
function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(0, 0, 0, ${alpha})`;
  const m = /^#?([a-f\d]{6})$/i.exec(String(hex).trim());
  if (!m) return `rgba(0, 0, 0, ${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Wraps children in a div that scopes accent CSS custom properties.
// Pass `team` (a TEAMS entry with `color` + `dark`) to drift, or omit
// to keep the brand red baseline.
export function TeamThemeScope({ team, children, style, as: Tag = 'div' }) {
  // No team → render children without an extra wrapper so we don't
  // pollute the DOM with inert divs on non-team routes. The fallback
  // values inside theme.js's var(--accent, #DD3C3C) handle the case
  // implicitly.
  if (!team || !team.color) {
    return <>{children}</>;
  }
  const accent = team.color;
  const accentHover = team.dark || team.color;
  const accentText = bestTextOn(accent);
  return (
    <Tag style={{
      // Custom property names are camelCased only in the JS object form
      // for inline `style` — they're emitted as kebab-case CSS. React
      // accepts the dashed form directly when passed as strings.
      '--accent':        accent,
      '--accent-hover':  accentHover,
      '--accent-text':   accentText,
      '--accent-soft':   hexToRgba(accent, 0.10),
      '--accent-border': hexToRgba(accent, 0.30),
      ...style,
    }}>
      {children}
    </Tag>
  );
}
