---
product: BLW Studio
register: hybrid          # workspace surfaces = product, public/expressive surfaces = brand
north_star: Editorial x Collector
updated: 2026-06-17
---

# BLW Studio

The content engine for Big League Wiffle Ball: a real wiffle ball league run like a real sports property. The team imports media, builds and ships social content, and runs the league's public-facing pages (teams, players, schedule, standings). Atlanta cleared ~2,500 Instagram followers in month one; the league is growing and the studio is how that growth gets made.

This file is the source of truth for who v5 is for and how it should feel. DESIGN.md turns it into tokens and components.

## Register: hybrid, split by surface

Two registers live in one app. The dividing line is simple: **if a fan or athlete could see it, it's brand. If only the content team sees it while working, it's product.**

- **Workspace (product register).** Generate, Files, ContentStudio, People/admin, Settings, the sidebar and app chrome. These are tools the content team lives in daily. Design serves the work: dense, fast, legible, low-friction, keyboard-reachable. Restraint over expression. A power user should fly.
- **Public + expressive surfaces (brand register).** Team pages, Player pages, Schedule and Standings, the per-team social feed, share/export artifacts, any athlete- or fan-facing view. Here design *is* the product. Full identity, premium craft, something an athlete is proud to share.

When a surface is ambiguous, ask which user touches it most. The chrome of a brand surface (its nav, its toolbars) still follows the product register; only the content it frames goes full brand.

## Users

- **Owner / master_admin.** Runs the league and the agency behind it (BLW social content plus a sports-card data business). Power user. Lives in the workspace daily, cares about speed and about the public surfaces looking premium. The collector aesthetic is native to their world, not a costume.
- **Admins / content creators.** Make and schedule content, manage media, build posts in Generate. They need the workspace to be fast and unambiguous far more than they need it to be pretty.
- **Athletes.** Claim their player profile (per-team join code), view their team and player pages, share their highlights. They judge the app by their own page: it has to feel worth posting.
- **Fans.** Follow teams, read the schedule and standings, consume the feed. Mostly mobile, mostly read-only. They are the audience the brand surfaces are built for.

## Product purpose

Make it fast to turn raw league media into polished, on-brand content, and give every team and player a public home that feels like a premium sports property rather than a hobby site. The studio is both the factory (workspace) and the showroom (public surfaces).

## Brand

Big League Wiffle Ball takes a backyard game and runs it with the seriousness of a pro league: real teams, real stats, real rivalries, real stakes. The brand's whole move is that contrast. We never wink at it, never make it a joke, never go cartoon. The humor is in the sincerity.

**Editorial x Collector** is how that sincerity looks:

- **Editorial** is the spine. Light-capable, type-forward, restrained color, generous whitespace, stats presented as elegant tables. It says: this league deserves to be covered, not just played. Think a sports desk, not a scoreboard.
- **Collector** is the accent, reserved for the expressive surfaces. Premium trading-card craft: defined card frames, sparing metallic (foil/chrome) edges, a sense of rarity and numbering, players and moments treated as collectibles. It ties directly to the owner's card-data world and makes a player's page feel like something you'd want to own.

Keep the team-accent system: the active team's color drives `--accent`, so the same chrome reskins per team. That mechanic is a brand asset; build on it.

## Voice and tone

Confident, plainspoken, sports-literate. Real stat language, no hype-speak, no exclamation spam. Labels are nouns, actions are verbs, errors are honest. Premium does not mean stiff; it means we don't pad. Every word earns its place.

## Anti-references (what v5 must never be)

- **Childish or cartoonish (explicit).** No mascot-as-UI, no comic shapes, no candy gradients, no bouncy/elastic motion, no rounded-everything "fun" defaults, no emoji standing in for icons. Premium and serious.
- **Generic SaaS dashboard.** The expressive surfaces must not be indistinguishable from Linear/Notion. A player page should never look like a settings panel.
- **Sportsbook / gambling.** Playoff odds and stats stay editorial. No neon-on-black, no flashing odds, no DraftKings energy.
- **Corporate sports-network sheen.** Premium, not soulless. The collector craft is what keeps it human.

## Strategic principles

1. **Commit to one identity.** Retire the 11-theme runtime font picker as the brand's face. A brand has one face. (A small curated preference toggle may survive as a setting, but the default and the identity are fixed.)
2. **Earn every card.** The trading-card treatment is meaningful only where the content is genuinely collectible (players, moments, milestones). In the workspace, prefer sections and tables; never default to card grids.
3. **Restraint scales, decoration doesn't.** Metallics and expressive flourishes are reserved, deliberate, and rare. The moment foil is everywhere it stops meaning premium.
4. **Stats are a first-class surface.** Standings, records, run differentials, playoff odds: these are editorial content, not afterthoughts. They get real typographic care (tabular figures, clean tables).
5. **The athlete's page is the product demo.** If a player would proudly post their own page, the brand is working. Optimize that surface hardest.
6. **Workspace respects the maker's time.** Density, speed, and clarity beat polish inside the tool. Save the craft budget for what fans and athletes see.
