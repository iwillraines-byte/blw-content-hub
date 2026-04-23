# Preset Overlays

PNGs dropped into this directory auto-surface in the Generate page's Overlay
picker when a matching team + template type is selected. No manifest to update,
no code to touch — Vite's `import.meta.glob` picks them up on build.

## Naming Convention

```
src/assets/overlays/{teamId}/{templateType}/{variant}.png
```

| Segment        | Value                               | Notes |
|----------------|-------------------------------------|-------|
| `teamId`       | Lowercase BLW id                    | `lan`, `azs`, `lvs`, `nyg`, `dal`, `bos`, `phi`, `chi`, `mia`, `sdo` |
| `teamId`       | Or `all` for league-wide overlays   | Appears on every team's picker |
| `templateType` | Template key from `template-config` | `player-stat`, `gameday`, `score`, `hype`, `highlight`, `batting-leaders`, `pitching-leaders`, `standings` |
| `variant`      | Short descriptive filename          | e.g. `hero.png`, `mvp-frame.png`, `week-3.png` |

Filenames show as the picker label — use kebab-case, it's more readable in the UI.

## Image Requirements

- **Format:** PNG with transparent background (the overlay sits on top of a background image)
- **Aspect ratio matters.** The overlay is stretched to the active platform size. Make a separate variant for each aspect ratio you plan to support:
  - `1080x1080` (feed)
  - `1080x1350` (portrait — default)
  - `1080x1920` (story)
  - `1200x675` (landscape)
- **Respect the text field zones.** Open `src/template-config.js` to see where dynamic text (playerName, statLine, etc.) will be drawn. Leave those regions clear or use low-opacity treatments that don't fight the text.

## Example

```
src/assets/overlays/
├── README.md
├── lan/
│   ├── player-stat/
│   │   ├── hero-portrait.png
│   │   ├── hero-feed.png
│   │   └── muted-portrait.png
│   └── gameday/
│       └── home-matchup.png
├── all/
│   └── standings/
│       └── weekly-standings.png
└── mia/
    └── score/
        └── final-turquoise.png
```

In this example:
- LAN players viewing `player-stat` see three overlay options
- All ten teams viewing `standings` see the shared `weekly-standings.png`
- MIA viewing `score` sees `final-turquoise.png`

## Supporting Multiple Aspect Ratios

You can encode the intended platform in the filename — the picker will label
them so users pick the right one:

```
lan/player-stat/
├── hero-portrait-1080x1350.png
├── hero-feed-1080x1080.png
└── hero-story-1080x1920.png
```

(Filenames display verbatim — bake in the dimensions when helpful.)

## Removing a Preset

Delete the PNG, commit, deploy. Gone. No other cleanup needed.
