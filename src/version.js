// Build-time version + git fingerprint. Values are injected by Vite's
// `define` (see vite.config.js). At runtime they're plain strings — the
// substitution happens at compile time, so there's no async load and no
// way for these to drift from the deployed bundle.
//
// APP_VERSION  — semver from package.json (bump that to bump the user-
//                visible version).
// GIT_COMMIT   — short SHA (7 chars) of the deployed commit. Maps the
//                user's "what version am I on" to a real git ref so we
//                can reproduce a bug from a footer screenshot.
// BUILD_DATE   — ISO timestamp the bundle was built at.
//
// On Vercel the SHA comes from VERCEL_GIT_COMMIT_SHA (set by their CI),
// not local `git`. On dev `npm run dev` it's the working tree's HEAD.

/* global __APP_VERSION__, __GIT_COMMIT__, __BUILD_DATE__ */

export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
export const GIT_COMMIT  = typeof __GIT_COMMIT__  !== 'undefined' ? __GIT_COMMIT__  : 'dev';
export const BUILD_DATE  = typeof __BUILD_DATE__  !== 'undefined' ? __BUILD_DATE__  : new Date().toISOString();

// User-friendly composite. "v2.1.0 · a3f8c2b"
export const VERSION_LABEL = `v${APP_VERSION} · ${GIT_COMMIT}`;

// "v2.1.0" alone — for places where the SHA would be too noisy.
export const VERSION_SHORT = `v${APP_VERSION}`;

// Format build date as "Apr 28, 2026" for tooltips.
export function formattedBuildDate() {
  try {
    return new Date(BUILD_DATE).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return BUILD_DATE;
  }
}

// Compact build date — "Apr 29" — for the sidebar footer where a year
// would just be noise (it's almost always the current year). Falls back
// to the raw ISO string if Intl chokes.
export function shortBuildDate() {
  try {
    return new Date(BUILD_DATE).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
    });
  } catch {
    return BUILD_DATE;
  }
}

// Build label that auto-rolls every deploy without anyone having to
// remember to bump package.json. Format: "Apr 29 · a3f8c2b". The SHA
// comes from VERCEL_GIT_COMMIT_SHA on prod (set per deployment), so
// each push produces a visibly-different footer. No GitHub link —
// the SHA is just a fingerprint, not a clickable destination.
export const BUILD_LABEL = `${shortBuildDate()} · ${GIT_COMMIT}`;
