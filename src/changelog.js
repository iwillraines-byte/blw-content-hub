// Hand-curated release log. Single source of truth for the version
// label in the footer and the changelog modal that opens when you
// click it. Bump the top entry on every meaningful push.
//
// Versioning policy (loose semver — internal app, no API contract):
//   MAJOR — architectural shift (auth model, role overhaul, new core
//           surface like Player pages or the Requests detail panel)
//   MINOR — meaningful new feature, template, or workflow
//   PATCH — polish, fixes, perf, copy
//
// `kind` drives the chip color in the modal. Newest entry first.
// Items use plain Markdown-flavored prose — no HTML, the modal renders
// them as a bulleted list.
//
// CURRENT_VERSION below auto-derives from the first entry, so the only
// thing you need to edit when shipping is this array (add a new
// release object at the top).

export const RELEASES = [
  {
    version: '4.2.0',
    date: '2026-04-29',
    kind: 'minor',
    summary: 'Per-team monthly carousel + posted/draft toggle',
    items: [
      'New "Posts this month" carousel under the progress bar on every team page. Horizontal scroller of every generation for that team this month with thumbnails, template, and date.',
      'Master admin can toggle each post between Posted (✓) and Draft (✕). Drafts grey out + decrement the counter on the progress bar; flip back and they brighten + increment. Optimistic local update with a background PATCH so toggles feel instant.',
      'Dashboard "Recent posts" strip now ALWAYS renders (with empty state) so the surface is visible from a cold install. Unposted entries are greyscale + carry a "DRAFT" tag, mirroring the team carousel for visual consistency.',
      'New PATCH endpoint on /api/cloud-sync for partial record updates. Field allow-list per kind keeps the surface tight; `generate-log.posted` is the first patchable field.',
      'Counter on the progress bar derives from posted=true entries only. The 12-post target is the publishing goal — drafted-but-not-posted work no longer inflates the number.',
      'SCHEMA: requires a one-time `ALTER TABLE generate_log ADD COLUMN posted BOOLEAN NOT NULL DEFAULT TRUE;` in Supabase. Without it, every post stays in the "posted" state by default and the toggle no-ops.',
    ],
  },
  {
    version: '4.1.1',
    date: '2026-04-29',
    kind: 'patch',
    summary: 'AI tagging now returns first initial + jersey number',
    items: [
      'Auto-tag API was missing firstInitial in both its prompt and its response shape — vision results never carried it through. Schema now requires firstInitial alongside lastName/num; roster context sent to the model includes "K.JASO #03 (Konnor)" so the model can pick the right initial for cousin pairs.',
      'Server-side roster lookup fills in firstInitial AND num when the model returns a confident lastName but forgets the disambiguator (or the photo cropped the jersey). Single-record lastname matches auto-resolve.',
      'Jersey-number OCR prompt strengthened: explicit instruction to attempt every jersey location (chest, back, sleeves, hat, helmet), pad to 2 digits, and surface partial reads as candidates.',
      'Files candidate chips now show the first initial (e.g. "DAL #07 · L.ROSE 84%") so cousin pairs are distinguishable at a glance, and one-click apply fills in the initial too.',
    ],
  },
  {
    version: '4.1.0',
    date: '2026-04-29',
    kind: 'minor',
    summary: 'Files preview fix, cloud overlays, brief drawer, monthly progress, smarter AI tagging',
    items: [
      'Files preview lightbox rewritten: portal-mounted to escape ancestor stacking contexts, body scroll-locked while open, blob URL lifecycle owned by a proper hook — no more dark-screen / scroll-to-find-it bugs.',
      'Overlays now sync universally across users — Generate auto-pulls fresh overlays on team-select and a manual "↻ Sync" button surfaces uploads from other machines without waiting for the 10-min global hydrate.',
      'Brief context drawer on Generate: when you arrive from a content idea (dashboard, team page, player modal, or a Request) a small panel below Effects shows the original headline, narrative, stat pills, and platform-tabbed captions. Read-only with one-click copy.',
      'Monthly content progress on every team page: counts every published post for the team since the 1st of the calendar month, with a 12-post target. Glows team-tinted gold + 🔥 badge once you cross target.',
      'Smarter AI photo tagging: vision API now returns up to 5 ranked roster candidates when only partial info is visible (e.g. clear jersey number, ambiguous team). Files page shows the candidates as one-click chips so you pick the right player instead of typing.',
      'Server-side generate-log endpoint accepts team + since + fields filters so the progress bar runs as a count query, not a full record fetch.',
      'Role model consolidated: Admin tier is dormant. Master Admin handles trades / CSV bio import / people management / roster diagnostic; Content team gets everything else (incl. player photo edits).',
      'Hand-curated release log surfaced as a clickable popup from the sidebar footer + Settings About card.',
    ],
  },
  {
    version: '4.0.0',
    date: '2026-04-29',
    kind: 'major',
    summary: 'Requests detail overhaul + 9 polish/bug fixes',
    items: [
      'Requests page: every card has a "Brief details" disclosure with narrative, stats cited, suggested template, photos to reach for, and a flat prefill listing — plus a permanent red "Open in Generate" CTA that auto-populates team, template, and every line of copy.',
      'Idea payload now travels with the request, fenced inside the existing note column (no schema migration), so deep-links from Requests → Generate carry the FULL idea context.',
      'Roles consolidated: Admin tier is dormant; Master Admin handles trades, CSV bio import, people management, raw API tools. Content team gets everything else (incl. player photo edits). View-as picker offers Content + Athlete.',
      'Caleb Jeter avatar fix: lastname-unique fallback in resolver so a stale FI mismatch no longer blanks single-name players.',
      'Profile-pic editor: unified translate+scale transform — pan and zoom apply uniformly on both axes regardless of source-image aspect.',
      'Pitching card values auto-shrink (34→30→26→22 by char length) with nowrap+ellipsis so ERA/WHIP/K/4 never overflow.',
      'FIP moved to the end of both pitching tables.',
      'Red dot removed from the IG handle chip.',
      'Version footer auto-rolls every Vercel deploy — semver + short SHA + clickable changelog popup.',
      'Team page forces scroll-to-top on every team change.',
    ],
  },
  {
    version: '3.3.0',
    date: '2026-04-29',
    kind: 'minor',
    summary: 'Generate-content modal on player pages',
    items: [
      'Player profile CTAs: "Generate Stat Post" became "Generate content"; clicking pops up a single AI-drafted idea for that player with re-roll, then hands off to Generate.',
      'Removed the Highlight button from player profiles — the modal flow replaces it.',
      'Fixed Generate drag-to-pan getting stuck mid-drag (pointer listener identity churning).',
      'Recent posts strip moved to the bottom of the dashboard, below the Top-10 leaderboards.',
      'Two more player-page white-screen fixes (Rules of Hooks: new useCallbacks must live above early returns).',
    ],
  },
  {
    version: '3.2.0',
    date: '2026-04-29',
    kind: 'minor',
    summary: 'Team/Player News template + custom fonts',
    items: [
      'New 3-line "Team/Player News" overlay template with multi-layer drop shadows and Press Gothic display type. Layout is locked at 120pt × (540, 1010/1138/1266) for every platform.',
      'Three new local fonts available in Generate: Gotham Bold, Press Gothic, United Sans Bold. FontFace API explicit preload so canvas never falls back to Times.',
      'Two-way player hero stacks pitching card UNDER batting card with full ERA/IP/K/4/WHIP percentiles.',
    ],
  },
  {
    version: '3.1.0',
    date: '2026-04-28',
    kind: 'minor',
    summary: 'Player page polish + Savant percentile bubbles',
    items: [
      'Stat tile grids on player pages replaced with Savant-style animated percentile bubbles (9 batting, 9 pitching) under "BLW Batting/Pitching Percentile Rankings" headlines.',
      'Sticky compact mini-hero on scroll, prev/next teammate keyboard navigation, recent posts featuring the player surfaced in their gallery.',
      'IG handle chip moved below the avatar (clears the tier badge); Hype button removed.',
      'Cousin pair fix: Logan + Luke Rose now both render with their own bio info.',
      'New 1st/2nd/3rd overall rank badges (amethyst, emerald, ruby).',
      'Replaced rank-1/2/3 glow palette with the gemstone tones.',
    ],
  },
  {
    version: '3.0.0',
    date: '2026-04-28',
    kind: 'major',
    summary: 'Dashboard content drafting + AI ideas',
    items: [
      'Dashboard "Generate Content" section rebuilt as editorial idea cards with narrative, stat pills, expandable caption tabs (Instagram/X/Story), and a context-aware "More about {Player/Team}" regen.',
      'Cap of 4 visible ideas per page with prev/next pagination.',
      'AI prompt overhaul: stratified player sampling, 8-angle diversity menu, anti-paraphrase rules, league-context as research-not-assignments.',
      'League Context: master-admin-editable narrative blob (trades, draft, storylines) feeds every AI generation.',
      'Content ideas persisted server-side with a 14-day rolling window and surfaced on team + player pages.',
      'View-as: master admin can preview the app as any athlete on any team.',
      'Team scope dropdown on the dashboard locks generation to one team.',
      'Recent posts strip surfaces the last 10 downloads across the team.',
      'Files preview dark-mode bug fixed (modal background was resolving to navy against the backdrop).',
    ],
  },
  {
    version: '2.1.0',
    date: '2026-04-28',
    kind: 'minor',
    summary: 'MVP polish + version tracker',
    items: [
      'Skeleton loaders on every page-level fetch, route transition fades, empty states.',
      'Tabular-nums everywhere stat numbers render so columns line up.',
      'Live version tracker in the footer + Settings.',
      'Default font hierarchy locked across surfaces.',
    ],
  },
  {
    version: '2.0.0',
    date: '2026-04-28',
    kind: 'major',
    summary: 'Design system overhaul',
    items: [
      'Five-pass design refactor: kill side-stripes + em-dashes, team-color drift via scoped CSS variables, full hover/focus/active states, OKLCH brand-tinted neutrals, progressive disclosure on Generate.',
      'Unified theme tokens — every surface now reads from the same palette + radius + spacing system.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-04-27',
    kind: 'minor',
    summary: 'Profile-pic positioning + cousin disambig',
    items: [
      'Profile-pic pan/zoom positioning persisted to manual_players + applied to every avatar surface (player hero, team roster card, content calendar).',
      'Photo pan/zoom + exposure controls on Generate Custom mode.',
      'Single source of truth for player avatars (resolvePlayerAvatar).',
      'Cousin avatar disambiguation by jersey number + protect legacy fallback (Marshall, Lee, Rose).',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-04-24',
    kind: 'minor',
    summary: 'Bulk media import + 3-scope library',
    items: [
      'Bulk import from Google Drive folders with row-level edit + "stamp to all" shortcut.',
      'Bulk apply bar with always-editable fields and "Select all" inline.',
      'League-wide media bucket — third scope alongside player + team.',
      'Team-branded content calendar.',
      'Incremental cloud backup that skips already-uploaded media.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-04-17',
    kind: 'major',
    summary: 'Initial deploy',
    items: [
      'BLW Content Hub goes live on Vercel with full team/player/stats surface.',
      '404 routing fix for direct deep-links.',
      'Brand alignment design overhaul — hybrid theme, BLW palette, fonts.',
    ],
  },
];

// Auto-derived from the top entry so version.js doesn't have to be
// kept in sync separately. Bumping a release here updates every
// surface that reads CURRENT_VERSION.
export const CURRENT_VERSION = RELEASES[0].version;
export const CURRENT_RELEASE = RELEASES[0];

// Color tokens for the kind chip in the changelog modal. Major =
// red (the BLW accent), minor = blue (cool but present), patch =
// muted (background work). Matches the visual cadence of the
// dashboard's status chips so the modal feels native.
export const KIND_TOKENS = {
  major: { bg: 'rgba(220,38,38,0.10)', border: 'rgba(220,38,38,0.30)', fg: '#B91C1C', label: 'MAJOR' },
  minor: { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.30)', fg: '#1D4ED8', label: 'MINOR' },
  patch: { bg: 'rgba(107,114,128,0.10)', border: 'rgba(107,114,128,0.30)', fg: '#374151', label: 'PATCH' },
};
