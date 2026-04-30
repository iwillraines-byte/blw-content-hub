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
    version: '4.5.6',
    date: '2026-04-30',
    kind: 'patch',
    summary: 'Roster dedup by lastName + jersey (handles malformed CSV-imported rows)',
    items: [
      'The team dashboard / roster surface was showing duplicate teammates whose firstNames differed but who were the same person — e.g. "Andrew Ledet" #34 (canonical) AND "Andrew Ledet Ledet" #34 (CSV row with first_name set to the full name), or "Nick Martinez" (no num) AND "Eddie \"Nick\" Martinez" #10 (richer CSV data).',
      'Strengthened the v4.5.5 roster dedup with a jersey-first merge pass. Two entries that share lastName + jersey are treated as the same player. The cleaner-named one (lower duplicate-lastName score, fewer embedded quotes, shorter firstName) is kept; the other folds its hasStats / hasMedia / num signals in.',
      'Companion cleanup SQL is in this release\'s notes — find any manual_players row whose first_name contains its last_name twice (the "Andrew Ledet Ledet" shape) and either fix or delete it.',
    ],
  },
  {
    version: '4.5.5',
    date: '2026-04-30',
    kind: 'patch',
    summary: 'Roster pills: drop the ghost-Ledet duplicate + harder fallback labels',
    items: [
      'Root cause of the persistent "Next: LEDET" pill on Andrew Ledet\'s page: the live API was returning a bare "Ledet" stat row with no firstName alongside the canonical "Andrew Ledet" row. getTeamRoster keyed them separately (fullNameKey \'\' vs \'andrew\') and emitted two roster entries — a real one and a ghost. The ghost showed up as the "next teammate" because both lastNames were identical.',
      'Fix: dedup pass at the end of getTeamRoster. When two entries share a lastName and one has no firstName, the no-firstName ghost folds its signals (hasStats / hasMedia / num) into the named entry and is dropped. Safe merge — only fires when the named entry is unambiguous OR the ghost\'s jersey number matches a specific named entry.',
      'Also hardened the pill label resolver: when no firstInitial / firstName is available, falls back to "#34 LEDET" using jersey before giving up to lastName-only.',
    ],
  },
  {
    version: '4.5.4',
    date: '2026-04-30',
    kind: 'patch',
    summary: 'Jersey safety net + roster-pill labels show first initial',
    items: [
      'CSV bio-import: jersey number is now a secondary disambiguator. Resolver hierarchy is exact firstName → exact jersey → legacy quirk fallback → first-initial multi-row fallback. Catches CSV variants like "Luke A." vs "Luke" that would otherwise miss the exact-name path on a same-team cousin pair.',
      'Roster pills (top-right teammate prev/next on player pages) now read "A. LEDET" instead of just "LEDET". On rosters with multiple Ledets / Roses / Marshalls / Lees, the next pill used to look like a self-reference because both pills displayed only the lastName. First initial is included whenever available; legacy entries without a firstName still fall back to lastName-only.',
    ],
  },
  {
    version: '4.5.3',
    date: '2026-04-30',
    kind: 'patch',
    summary: 'Server-side: fix the same collision in CSV bio-import path',
    items: [
      'api/players-sheet-sync.js had the same "if exactly 1 manual_players row matches the lastName, use it" fallback as the client-side getPlayerByTeamLastName. With Carson being the only DAL Rose row, a CSV row for Logan or Luke would overwrite Carson\'s bio. Same trap was lying in wait for any future CSV import where one cousin had a record and others didn\'t.',
      'Tightened: server now only falls back when the existing single row has NO first_name at all (legacy quirk case). Multi-row + no firstName match → INSERT a new row, never overwrite an unrelated cousin.',
      'No code path remains that can silently merge one Rose/Lee/Marshall into another. Three-Rose collision is now closed end-to-end (write path v4.5.1, read path v4.5.2, CSV import v4.5.3).',
    ],
  },
  {
    version: '4.5.2',
    date: '2026-04-30',
    kind: 'patch',
    summary: 'Read-path: stop serving Carson Rose\'s About-me to Logan and Luke',
    items: [
      'getPlayerByTeamLastName had a "if exactly 1 manual_players row matches the lastName, use it" fallback that was meant to handle legacy rows with blank firstName. With Carson Rose being the only DAL Rose with a manual_players row, the fallback served his About-me block under Logan AND Luke\'s URLs. That\'s the root cause of the "all Roses share the same About section" bug.',
      'Tightened: the fallback now only fires when the single candidate has NO firstName at all (the actual legacy-quirk case). A row with an explicit firstName that doesn\'t match the URL is treated as a different player — no cross-contamination.',
      'Pair this with the v4.5.1 write-path fix and the Rose pages now resolve cleanly: Carson sees Carson, Logan sees an empty card (no manual record yet), Luke sees an empty card (his data is sitting under the "Luke Ross" typo row).',
    ],
  },
  {
    version: '4.5.1',
    date: '2026-04-30',
    kind: 'patch',
    summary: 'Fixed manual_players collision (Roses sharing About-me records)',
    items: [
      'Tightened upsertManualPlayer matching rules. The OLD logic matched on (team, lastName, firstInitial) which collapsed every Rose with initial "L" into a single record — editing Logan\'s About-me overwrote Luke\'s. Same trap caught Marshalls and any future twin pair sharing an initial.',
      'New matching priority: (1) firstName + lastName + team [exact identity, used by every UI form], (2) jersey + lastName + team, (3) firstInitial + lastName + team but ONLY if unique on team, (4) lastName + team but ONLY if unique. Ambiguous matches now create a new record instead of overwriting an existing one — losing data is worse than a duplicate an admin can clean up.',
      'Existing collided records still need a one-time cleanup in Supabase — the code fix prevents future collisions but can\'t un-merge data that\'s already been overwritten. See post-deploy notes for cleanup SQL.',
    ],
  },
  {
    version: '4.5.0',
    date: '2026-04-30',
    kind: 'minor',
    summary: 'Demo prep · Round 1: mobile overlay sync, name-collision fixes, brand chrome',
    items: [
      'Mobile overlay sync — overlays uploaded by one admin now show up on every other admin\'s device within 60 seconds, not 10 minutes. Three fixes compounded: lowered the global hydrate throttle from 10 min → 60 sec, retriggered hydrate when the auth session lands (closing a JWT race that silently 401\'d on first mobile mount), and force-refreshed overlays on every Generate-page mount instead of only on team-select.',
      'Name collision fixes — Logan/Luke Rose, James/Justin Lee, and the Marshall pair on AZS no longer cross-wire each other\'s media or trap users on prev/next teammate nav. Disambiguation now uses lastName + firstInitial + jersey in combination, with legacy untagged records still surfacing rather than being silently dropped.',
      'Top-bar brand chrome — the page H1 no longer duplicates in the workspace header. The chrome reads "BLW Studio" everywhere, with the actual page title still driving the browser tab via document.title.',
      'BLW + ProWiffleball logos — branded marks land in the sidebar header, login screen, and footer credit. Drop replacement SVGs at /public/brand/blw-logo.svg, blw-mark.svg, or prowiffleball-logo.svg to swap them across the app without touching code.',
      'Renamed app from "BLW Content Hub" to "BLW Studio" everywhere it appeared (window title, sidebar, login, settings about, file manifest, changelog modal).',
    ],
  },
  {
    version: '4.4.2',
    date: '2026-04-29',
    kind: 'patch',
    summary: 'Renamed templates: Batting Leaders → Stat Leader, Pitching Leaders → Player of the Game',
    items: [
      'Batting Leaders → Stat Leader (🏏). Repositioned for any single-stat spotlight, not just OPS+.',
      'Pitching Leaders → Player of the Game (🏆). Repositioned as a standout-game spotlight.',
      'Internal template ids stay stable (`batting-leaders`, `pitching-leaders`) so existing requests, generate-log entries, content ideas, and bookmarks keep resolving.',
    ],
  },
  {
    version: '4.4.1',
    date: '2026-04-29',
    kind: 'patch',
    summary: 'Athletes can only edit THEIR OWN player About-me',
    items: [
      'New strict 1:1 link between a player record and an athlete profile via manual_players.user_id. Athletes can edit the About-me block ONLY when this matches their auth user.id — no more "any teammate can edit any teammate" leakage.',
      'Master admin gets a "Link athlete account" picker inside the AthleteVoiceCard: pick which athlete profile owns this player. Picker fetches /api/admin-people, filters to athlete-role accounts, groups by team. ✓ LINKED chip surfaces when the binding is set.',
      'Athletes whose account isn\'t linked to a player yet still see other players\' About-me cards (read-only) but can\'t edit anything. Master admin links them via the picker on their player page.',
    ],
  },
  {
    version: '4.4.0',
    date: '2026-04-29',
    kind: 'major',
    summary: 'Requests overhaul + athlete role + athlete voice for AI ideas',
    items: [
      'Requests have TYPES now: Content, Profile update, Bug, Template, Feature, Integration. Each type opens a tailored form so a bug request asks for repro steps, a profile-update asks what to change, a content request asks for player + template + athlete input.',
      'New RequestModal — single progressive form with type picker, polished chrome, priority chips (added CRITICAL), needed-by date, and a confirmation that shows where notifications will land. Replaces the inline three-field form.',
      'Athlete role gets first-class treatment: athletes see ONLY their own requests (server-enforced via requester_user_id, with email fallback for legacy rows). Their team auto-pins on the form, status-flip buttons hide, and the page header switches to a personal "your requests" voice.',
      '"Notify requester" button on completed requests opens a pre-filled mailto: with subject + body, then stamps notified_at so a follow-up click reads "Re-notify". Real Resend/SendGrid pipeline lands later — the mailto path covers v1.',
      'Type filter chips above the existing status chips so you can scope by "show me all bugs" or "show me high-priority profile updates."',
      'New per-card layout: type badge tinted by category, priority dot (with explicit CRITICAL chip when relevant), team chip, player chip, needBy countdown ("Due in 3d", "Overdue 2d"), then the title + status — reads at a glance without opening Brief details.',
      'Athletes get an editable "About me" card on their player page (master_admin can edit anyone\'s). Free-form fields: vibe, references, walk-up music, fun facts, content notes. Stored as JSON on manual_players.athlete_voice.',
      '/api/ideas reads the athlete voice for any sampled player and weaves it into its prompt as an "ATHLETE VOICE" block. Stronger signal than stats alone — captions get the player\'s actual identity, not just generic stat lines.',
    ],
  },
  {
    version: '4.3.0',
    date: '2026-04-29',
    kind: 'minor',
    summary: 'Asset-type rename + per-team storage breakdown + roster-fallback AI chips',
    items: [
      'Asset types renamed: ACTION → HITTING, ACTION2 → PITCHING, HIGHLIGHT2 → HYPE. Added GROUP for multi-player shots. Old strings still resolve everywhere they\'re read (avatar resolver, photo picker, idea suggester) so existing media tagged with the legacy names continues to work — a one-time SQL migration is optional.',
      'Cloud storage "Breakdown by team" now reads team from the media table\'s `team` column instead of trying to parse it from object filenames (storage paths are `{uuid}.png`, no team prefix). Every team that has uploaded media now appears with its own bar + color.',
      'Drag-and-drop and Bulk import card alignment fixed: label was collapsing to inline baseline, leaving the dropzone shorter than the neighboring card. Both children now flex-stretch and use border-box so the 2px borders sit inside the grid cell.',
      'AI candidate chips now include a roster fallback: whenever the team is identified (by AI or user pick), the FULL roster of that team surfaces as one-click chips so you can pick the right player even when the AI returned no specific candidate. ROSTER badge distinguishes these from AI-ranked suggestions.',
      'tag-heuristics.js learns the new vocabulary: "batting" / "swing" → HITTING, "pitching" / "mound" → PITCHING, "hype" / "intro" / "walkup" → HYPE, "group" / "squad" → GROUP.',
      'auto-tag system prompt updated with the new asset-type list + a note keeping the legacy strings recognizable so the model returns the new names even on photos labeled with old conventions.',
    ],
  },
  {
    version: '4.2.1',
    date: '2026-04-29',
    kind: 'patch',
    summary: 'Status badge + priority dot palette pulls from theme tokens',
    items: [
      'StatusBadge (Pending / In Progress / Approved / Revision / Completed) and PriorityDot (high / medium / low) no longer hardcode hex colors — they read from theme tokens just like every other surface.',
      'Added successText / warningText / infoText / dangerText tokens to theme.js so dark-mode flips and any future palette tweaks reach every status surface automatically.',
    ],
  },
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
