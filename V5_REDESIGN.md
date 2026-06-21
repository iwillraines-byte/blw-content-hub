# BLW Studio v5 — Design Redesign Plan

Design-led overhaul of the content hub. Direction: **premium sports-data product** —
clean sans (Hanken Grotesk + Inter + JetBrains Mono numerals), thin Lucide icons,
charcoal-dark default, team color as the only pop, ESPN-grade tables + dashboard-grade
cards. Reference kit: DesignCode UI (structure/type only — no glassmorphism).

All work ships on branch `v5/phase-0-pipeline` → Vercel **preview** → master-login
review → merge to `main` only on sign-off. Production never updates without staging
review. Presentational only: data sources + routes are preserved.

## Done + staged
- **Foundation**: charcoal dark palette (default), Hanken type system, Lucide `<Icon>`,
  mode-aware team accent (`useIsDark` / `readableAccent`).
- **Player page**: teammate-nav control, inline vitals, tighter stat tiles, one-line name,
  uniform text color (no greys), `@`-icon removed, **OPWR Rank** (was "League rank"),
  PTS removed, stat-tile ranks now ordinal ("24th") with no mini-bars, "Edit player info"
  relocated under the avatar.
- **Team page**: tighter global radius (`lg 12→10`, `xl 16→12`); scoreboard → now an
  **inline record** (record · PCT · DIFF beside the rank chip); city eyebrow removed;
  TOP BATTER / TOP PITCHER strip cut; **Option B header** = a full-width photo **banner
  strip** (admin drag-to-resize height + drag-to-reposition crop, persisted per team) +
  an identity card below + an aggregates card.

## In progress / next
1. **Team aggregate redesign** — two-column Batting | Pitching card, each metric a row
   with value + **ordinal league rank**. Metrics: AVG / OBP / OPS | ERA / K / WHIP.
   Requires computing team-level OBP/OPS/WHIP/K aggregates + each metric's rank across
   all teams (only avg/hr/era/k4/ip are aggregated today). Replaces the interim
   AVG/HR/ERA/K4 card.
2. **Player percentiles** — condense the bars (~60% width) and add a **companion** in the
   freed space, with a toggle between:
   - a **percentile radar** (works with current data), and
   - an **OPWR rank history line graph** — needs new **weekly rank-snapshot capture**
     (today only `currentRank` + `previousRank` are stored; no time series).
3. **Team media library** — downloadable asset library: per-image hover actions
   (download / copy / open / send-to-Generate), filetype/res/size badges, filter chips
   (On-field / Headshots / Action / Team), multi-select + Download all, lightbox, masonry.
4. **Global polish** — clearer type scale; stat-table row-hover + sticky headers; accent
   discipline (team color primary; green/red only for good/bad data signals).

## Storage notes
- Per-team header banner config: app_settings key `team-header-photos` =
  `{ [teamId]: { mediaId, height, focusY } }`. Legacy string rows (mediaId only) are
  upgraded by `normalizeHeaderCfg`.
- Team socials / monthly targets / brand voice also live under `app_settings` keys.

## Open follow-ups
- Two-way players show both batting + pitching tiles (kept, not toggled — user choice).
- Bring team-page type/spacing fully in line with the player page.
- Rotate the Shade API key; optional RESEND_API_KEY + NOTIFY_EMAIL in Vercel.
