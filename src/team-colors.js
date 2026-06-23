// Shared team-color helpers. Team primaries are tuned for light surfaces;
// several (Atlanta navy #021E42, Vegas black, Philadelphia navy) vanish on the
// v5 charcoal dark surface, so accent-bearing chrome swaps to the lighter
// team.accent on dark. A near-white accent (Chicago white, Boston cream) is
// floored to brand red so it still reads as a team pop, not neutral chrome.
//
// Canonical home for what used to be copy-pasted into PlayerPage / TeamPage.
import { colors } from './theme';

// Relative luminance 0..1 of a #RRGGBB hex (0.5 when unparseable).
export function hexLuma(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return 0.5;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// A team accent that stays legible on the active surface.
export function readableAccent(team, isDark) {
  if (!team) return colors.red;
  const a = isDark ? (team.accent || team.color) : (team.color || team.accent);
  if (isDark && hexLuma(a) > 0.85) return colors.red;
  return a || colors.red;
}
