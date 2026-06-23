---
product: BLW Studio
register: hybrid          # workspace surfaces = product, public/expressive surfaces = brand
north_star: Premium sports-data product
updated: 2026-06-23
---

# BLW Studio

The content engine for Big League Wiffle Ball: a real wiffle ball league run like a real sports property. The team imports media, builds and ships social content, and runs the league's public-facing pages (teams, players, schedule, standings). Atlanta cleared ~2,500 Instagram followers in month one; the league is growing and the studio is how that growth gets made.

This file is the source of truth for who BLW Studio is for and how it should feel. DESIGN.md turns it into tokens and components.

## Register: hybrid, split by surface

Two registers live in one app. The dividing line is simple: **if a fan or athlete could see it, it's brand. If only the content team sees it while working, it's product.** Both now share the same language — clean sans, thin line icons, monochrome base with team accent. The difference is density versus polish, not two different visual worlds.

- **Workspace (product register).** Generate, Files, ContentStudio, Command Center, People/admin, Settings, the sidebar and app chrome. Tools the content team lives in daily. Design serves the work: dense, fast, legible, low-friction, keyboard-reachable. A power user should fly.
- **Public + expressive surfaces (brand register).** Team pages, Player pages, Schedule and Standings, share/export artifacts, any athlete- or fan-facing view. Here design *is* the product: full identity, premium craft, something an athlete is proud to share.

When a surface is ambiguous, ask which user touches it most. The chrome of a brand surface (its nav, its toolbars) still follows the product register; only the content it frames goes full brand.

## Users

- **Owner / master_admin.** Runs the league and the agency behind it (BLW social content plus a sports-card data business). Power user. Lives in the workspace daily, cares about speed and about the public surfaces looking premium.
- **Admins / content creators.** Make and schedule content, manage media, build posts in Generate, watch cross-property performance in the Command Center. They need the workspace to be fast and unambiguous far more than they need it to be pretty.
- **Athletes.** Claim their player profile (per-team join code), view their team and player pages, share their highlights. They judge the app by their own page: it has to feel worth posting.
- **Fans.** Follow teams, read the schedule and standings. Mostly mobile, mostly read-only. They are the audience the brand surfaces are built for.

## Product purpose

Make it fast to turn raw league media into polished, on-brand content, and give every team and player a public home that feels like a premium sports property rather than a hobby site. The studio is both the factory (workspace) and the showroom (public surfaces).

## Brand

Big League Wiffle Ball takes a backyard game and runs it with the seriousness of a pro league: real teams, real stats, real rivalries, real stakes. The brand's whole move is that contrast. We never wink at it, never make it a joke, never go cartoon. The humor is in the sincerity.

**Premium sports-data product** is how that sincerity looks:

- **Sports-data spine.** The app earns trust the way a broadcast graphics package or a serious stats site does: dense, accurate, tabular figures everywhere, ESPN-grade tables, metric cards with real deltas, charts that respect the numbers. Stats are treated as content, not decoration.
- **Premium chrome.** A charcoal dark surface by default (the same restrained, monochrome register as a high-end agency or analytics tool), thin line icons, hairline borders, minimal shadow, generous but disciplined spacing. First-class light data surfaces where density helps.
- **Team color is the only pop.** The base is monochrome (neutrals tinted toward navy); the active team's color drives `--accent`, so the same chrome reskins per team. Brand red is the punch. Semantic data colors (green/red/blue/amber/teal) are reserved for stats and charts. That accent mechanic is a brand asset; build on it.

## Voice and tone

Confident, plainspoken, sports-literate. Real stat language, no hype-speak, no exclamation spam. Labels are nouns, actions are verbs, errors are honest. Premium does not mean stiff; it means we don't pad. Every word earns its place.

## Anti-references (what BLW Studio must never be)

- **Serif-editorial / collector skeuomorphism (explicit, rejected direction).** No Fraunces-style serif display face, no gold foil / chrome / holographic edges, no trading-card frames, no "card as a physical object." An earlier Editorial × Collector proposal was tried and rejected; do not drift back to it.
- **Childish or cartoonish.** No mascot-as-UI, no comic shapes, no candy gradients, no bouncy/elastic motion, no emoji standing in for icons.
- **Generic SaaS dashboard.** The expressive surfaces must not be indistinguishable from Linear/Notion. A player page should never look like a settings panel.
- **Sportsbook / gambling.** Playoff odds and stats stay editorial. No neon-on-black, no flashing odds, no DraftKings energy.
- **Rainbow dashboards.** Color discipline is the whole game: team accent plus data semantics only. Resist decorating the monochrome base.

## Strategic principles

1. **Commit to one identity.** The 11-theme runtime font picker is retired as the brand's face. A brand has one face: clean sans, thin icons, charcoal-and-accent. (A small curated appearance toggle may survive as a setting, but the default and the identity are fixed.)
2. **Stats are a first-class surface.** Standings, records, run differentials, percentiles, playoff odds, follower growth: editorial content, not afterthoughts. They get real typographic care — tabular figures, sortable sticky-header tables, honest charts.
3. **Restraint scales, decoration doesn't.** The monochrome-plus-accent system is the craft. The moment a second decorative color or a gradient creeps in, the premium feel erodes. Earn every flourish.
4. **The athlete's page is the product demo.** If a player would proudly post their own page, the brand is working. Optimize that surface hardest.
5. **Workspace respects the maker's time.** Density, speed, and clarity beat polish inside the tool. Save the craft budget for what fans and athletes see.
6. **Data has to be right before it can be pretty.** A wrong stat in a beautiful table is worse than a plain one. Accuracy is part of the aesthetic.
