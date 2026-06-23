# BLW Studio — DESIGN.md

The design system for the v5 "premium sports-data product" direction (see PRODUCT.md for who and why). This is the source of truth for tokens, type, icons, and components. Values below are the ones actually shipped, not proposals.

## Theme: dark by default

Charcoal dark is the **default and the brand's face** — the same restrained, monochrome register as a high-end analytics tool. Light mode is a first-class data surface, not an afterthought, for dense daytime work. Mode lives in `src/theme-mode.js` (`useIsDark()`, applied via CSS custom properties, no prop drilling). `colors.white` is a semantic token meaning "card surface," not literal white — in dark mode it resolves to a raised charcoal (`oklch(0.205 …)`).

## Color

OKLCH throughout. Never `#000` / `#fff`. Neutrals are tinted (cool, hue ~265, chroma ≤ 0.006) so the grayscale has a subtle family resemblance instead of looking dead. The brand red anchors hue **26.5°**.

**Color strategy: restrained monochrome + accent.** The base is grayscale. The only chroma in the chrome is the brand red and the active team's `--accent` (the active team color drives `--accent`, so the same chrome reskins per team). Semantic data colors (green / red / blue / amber) are reserved for stats and charts — never for decoration.

### Dark (primary)
- Page bg `oklch(0.165 0.003 265)`, card surface `oklch(0.205 0.004 265)`, raised `oklch(0.240 …)`.
- Borders are hairline: `oklch(0.305 …)` / lighter `oklch(0.260 …)`. Lean on borders + slight raise, not heavy shadow.
- Text `oklch(0.965 …)`, secondary `0.770`, muted `0.585` — stepped down for a premium, restrained hierarchy.
- Brand red `oklch(0.645 0.215 26.5)`; `redLight` / `redBorder` are alpha variants for active states.
- Data semantics carry a brighter `*Text` variant for WCAG AA on the dark card surface (e.g. `successText`, `warningText`). Use the `*Text` token for colored text/icons on cards, not the base hue.

### Light (data surfaces)
- Page bg `oklch(0.975 0.003 26.5)`, card `oklch(0.995 …)`, ink `oklch(0.20 0.015 26.5)`, hairline borders `oklch(0.89 …)`.

## Typography

One clean modern sans, committed. The 11-theme runtime font picker is retired as the identity (a curated few survive only as an opt-in Appearance setting; default is fixed).

- **Default theme `mvp` ("BLW v5")**, resolved in `src/fonts.js` → CSS vars `--font-heading` / `--font-body` / `--font-condensed`:
  - Heading: **Hanken Grotesk** (400–800) — premium grotesque, reads sports-data not SaaS-bland.
  - Body + condensed: **Inter** (400–800) — tabular figures + small-size legibility for dense tables.
  - Numerals: **JetBrains Mono** (loaded globally) for the densest stat columns.
- **Tabular figures everywhere** data appears. Hierarchy via weight + size contrast (≥1.25 step ratio), not a second display face. Minimal tracking, no ALL-CAPS pressure.

## Iconography

Lucide only, via the single `<Icon name="…" />` wrapper in `src/icon.jsx` (thin/outline, `strokeWidth` ~1.75, monochrome, inherits `currentColor`). Names are app-domain (`schedule`, `command-center`), not lucide names, so icon choices change in one place. Zero emoji-as-icon.

## Elevation & materials

Flat and rounded. Cards 12–16px radius, 1px hairline borders, minimal shadow (dark leans on border + slight raise). No foil, no glass-as-default, no skeuomorphism, no decorative gradients.

## Components

- **Sidebar** (`src/App.jsx`) — dark, grouped, role-gated nav items with thin icons and a rounded active state (red-tinted). Nav items declare `roles`; `external: true` items render a real `<a>` for non-SPA destinations (the Command Center).
- **Metric cards** (dashboard, `src/pages/ContentStudio.jsx`) — tinted icon chip, uppercase label, large heading-font number, accent CTA. Use the AA-safe `accent`/`*Text` token for colored foreground on light cards.
- **Data tables** (`src/stats-tables.jsx`, `GameCenter.jsx`) — tabular figures, sortable, **sticky headers** inside a bounded `maxHeight` scroll container, full-row hover via a box-shadow overlay that composites over inline heatmap cell backgrounds (`.stat-table` rules in `src/global-styles.jsx`).
- **Percentile companion** (`src/league-standing.jsx`, `PlayerPage.jsx`) — hand-rolled SVG: condensed percentile bars + a batting/pitching radar (hover fades in the exact percentile and scales the vertex dot) + an OPWR monthly rank trend from real GSS history. Pitching radar axis order is fixed clockwise: ERA, WHIP, K/4, BB/4, HR/4, FIP.
- **Roster cards** (`src/pages/TeamPage.jsx`) — portrait 4:5 tiles, jersey # + tier overlays, the full team in one row.
- **Command Center rail** (`public/command-center.html`) — the standalone reporting dashboard keeps a slim fixed left nav rail (BLW mark + icon links back into the SPA, active item highlighted) so it reads as part of the app while staying a distinct, denser "command" experience.
- **Chips, EmptyState, LoadingState** — rounded, thin-icon + label; propagate the good empty-state pattern.

## Team logos

`TeamLogo` (`src/components.jsx`) resolves: in dark mode, a team's `darkLogo` at every size if present (so navy-on-navy marks don't vanish on charcoal); else the icon-only `altLogo` at ≤32px; else the primary `logo`. On load error it falls back to a colored ID chip.

## Motion

Subtle, fast, ease-out (quint/expo, 120–220ms). No bounce, no elastic. Never animate layout properties. Restrained hover/active states (rounded highlight).

## Bans (match-and-refuse)

- No serif-editorial, no foil / metallic / holo, no trading-card skeuomorphism (the rejected Editorial × Collector direction).
- No candy gradients, no gradient-text, no glassmorphism-as-default, no emoji-as-icon.
- No side-stripe accent borders, no hero-metric template, no identical icon-card grids.
- Monochrome discipline: color = team accent + data semantics only. No rainbow dashboards.
- No `#000` / `#fff`; no `--` or em dashes in copy.
