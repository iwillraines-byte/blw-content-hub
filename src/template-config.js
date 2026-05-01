// ─── Template Type Definitions with Fixed Text Field Zones ──────────────────
// Designers create overlay PNGs that match these layouts.
// Dynamic text is rendered at the positions defined here.
//
// Font keys (FONT_MAP at the bottom of this file):
//   'heading'   = Bebas Neue        'body'      = Barlow
//   'condensed' = Barlow Condensed  'gotham'    = Gotham Bold
//   'press'     = Press Gothic      'united'    = United Sans Bold
//
// All coordinates are in pixels at the native canvas resolution.
//
// SHADOWS — fields can carry an optional `shadows` array with one or more
// drop-shadow layers. Each layer is { offsetX, offsetY, blur, color }
// applied in order before the final clean text pass. Use NEWS_SHADOWS
// (below) for the standard three-layer Team/Player News stack; define a
// new constant if a template needs a different look.

// Three-layer drop shadow used by the Team/Player News template. Wide
// soft layer for ambient depth, medium contact layer for separation,
// tight near-edge layer for crispness. Tuned for white text on the
// green Saguaros overlay; reads cleanly on darker backgrounds too.
export const NEWS_SHADOWS = [
  { offsetX: 0, offsetY: 6, blur: 12, color: 'rgba(0, 0, 0, 0.40)' },
  { offsetX: 0, offsetY: 3, blur: 6,  color: 'rgba(0, 0, 0, 0.60)' },
  { offsetX: 0, offsetY: 1, blur: 2,  color: 'rgba(0, 0, 0, 0.80)' },
];

// Locked layout for the Team/Player News template. Same triplet of
// lines ships across all platform variants — we don't fork by export
// size, the design is intentionally identical. If you need to change
// the position/size for ALL News templates at once, update this builder
// (single source of truth). For per-platform variants, fork the
// template instead of drifting these values.
//
// Locked values (per design call 2026-04-29):
//   x        = 540
//   fontSize = 120
//   y        = 1010 / 1138 / 1266
//   font     = 'press'
function makeNewsLines() {
  return [
    { key: 'line1', label: 'Line 1', x: 540, y: 1010, fontSize: 120, font: 'press', color: '#FFFFFF', align: 'center', maxWidth: 1000, shadows: NEWS_SHADOWS },
    { key: 'line2', label: 'Line 2', x: 540, y: 1138, fontSize: 120, font: 'press', color: '#FFFFFF', align: 'center', maxWidth: 1000, shadows: NEWS_SHADOWS },
    { key: 'line3', label: 'Line 3', x: 540, y: 1266, fontSize: 120, font: 'press', color: '#FFFFFF', align: 'center', maxWidth: 1000, shadows: NEWS_SHADOWS },
  ];
}

export const TEMPLATE_TYPES = {
  'gameday': {
    name: 'Game Day',
    icon: '🏟️',
    description: 'Pre-game matchup hype graphic',
    playerCentric: false,
    fields: {
      feed: [ // 1080×1080
        { key: 'homeTeam', label: 'Home Team', x: 280, y: 460, fontSize: 56, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 400 },
        { key: 'awayTeam', label: 'Away Team', x: 800, y: 460, fontSize: 56, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 400 },
        { key: 'homeRecord', label: 'Home Record', x: 280, y: 520, fontSize: 22, font: 'condensed', color: 'rgba(255,255,255,0.7)', align: 'center', maxWidth: 200 },
        { key: 'awayRecord', label: 'Away Record', x: 800, y: 520, fontSize: 22, font: 'condensed', color: 'rgba(255,255,255,0.7)', align: 'center', maxWidth: 200 },
        { key: 'date', label: 'Date', x: 540, y: 740, fontSize: 36, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 600 },
        { key: 'time', label: 'Time', x: 540, y: 790, fontSize: 22, font: 'body', color: 'rgba(255,255,255,0.8)', align: 'center', maxWidth: 400 },
        { key: 'venue', label: 'Venue', x: 540, y: 830, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.5)', align: 'center', maxWidth: 500 },
      ],
      portrait: [ // 1080×1350
        { key: 'homeTeam', label: 'Home Team', x: 280, y: 580, fontSize: 56, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 400 },
        { key: 'awayTeam', label: 'Away Team', x: 800, y: 580, fontSize: 56, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 400 },
        { key: 'homeRecord', label: 'Home Record', x: 280, y: 640, fontSize: 22, font: 'condensed', color: 'rgba(255,255,255,0.7)', align: 'center', maxWidth: 200 },
        { key: 'awayRecord', label: 'Away Record', x: 800, y: 640, fontSize: 22, font: 'condensed', color: 'rgba(255,255,255,0.7)', align: 'center', maxWidth: 200 },
        { key: 'date', label: 'Date', x: 540, y: 920, fontSize: 36, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 600 },
        { key: 'time', label: 'Time', x: 540, y: 970, fontSize: 22, font: 'body', color: 'rgba(255,255,255,0.8)', align: 'center', maxWidth: 400 },
        { key: 'venue', label: 'Venue', x: 540, y: 1010, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.5)', align: 'center', maxWidth: 500 },
      ],
      story: [ // 1080×1920
        { key: 'homeTeam', label: 'Home Team', x: 280, y: 820, fontSize: 56, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 400 },
        { key: 'awayTeam', label: 'Away Team', x: 800, y: 820, fontSize: 56, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 400 },
        { key: 'homeRecord', label: 'Home Record', x: 280, y: 880, fontSize: 22, font: 'condensed', color: 'rgba(255,255,255,0.7)', align: 'center', maxWidth: 200 },
        { key: 'awayRecord', label: 'Away Record', x: 800, y: 880, fontSize: 22, font: 'condensed', color: 'rgba(255,255,255,0.7)', align: 'center', maxWidth: 200 },
        { key: 'date', label: 'Date', x: 540, y: 1300, fontSize: 36, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 600 },
        { key: 'time', label: 'Time', x: 540, y: 1350, fontSize: 22, font: 'body', color: 'rgba(255,255,255,0.8)', align: 'center', maxWidth: 400 },
        { key: 'venue', label: 'Venue', x: 540, y: 1390, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.5)', align: 'center', maxWidth: 500 },
      ],
      landscape: [ // 1200×675
        { key: 'homeTeam', label: 'Home Team', x: 310, y: 290, fontSize: 48, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 350 },
        { key: 'awayTeam', label: 'Away Team', x: 890, y: 290, fontSize: 48, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 350 },
        { key: 'homeRecord', label: 'Home Record', x: 310, y: 340, fontSize: 20, font: 'condensed', color: 'rgba(255,255,255,0.7)', align: 'center', maxWidth: 200 },
        { key: 'awayRecord', label: 'Away Record', x: 890, y: 340, fontSize: 20, font: 'condensed', color: 'rgba(255,255,255,0.7)', align: 'center', maxWidth: 200 },
        { key: 'date', label: 'Date', x: 600, y: 490, fontSize: 30, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 500 },
        { key: 'time', label: 'Time', x: 600, y: 530, fontSize: 18, font: 'body', color: 'rgba(255,255,255,0.8)', align: 'center', maxWidth: 300 },
        { key: 'venue', label: 'Venue', x: 600, y: 560, fontSize: 16, font: 'condensed', color: 'rgba(255,255,255,0.5)', align: 'center', maxWidth: 400 },
      ],
    },
  },

  'player-stat': {
    name: 'Team/Player News',
    icon: '📰',
    description: 'Three-line news / stat post stacked symmetrically inside the overlay',
    playerCentric: true,
    fields: {
      // Three centered lines, locked per the Saguaros overlay reference.
      // Locked values (do NOT drift these without an explicit design call):
      //   x        = 540      (every platform, every line)
      //   fontSize = 120      (every platform, every line)
      //   y        = 1010 / 1138 / 1266   (line 1 / 2 / 3)
      //   font     = 'press'  (Press Gothic, 60pt-equivalent display weight)
      //   color    = #FFFFFF
      //   shadows  = NEWS_SHADOWS (three-layer drop)
      //
      // The same triplet ships across feed / portrait / story / landscape
      // so the design stays consistent regardless of which platform export
      // the user picks. If a future overlay variant needs a different
      // layout we'll either fork the template or add per-platform position
      // overrides via the field-overrides store — but the default lives
      // here and is intentionally identical across exports.
      feed:      makeNewsLines(),
      portrait:  makeNewsLines(),
      story:     makeNewsLines(),
      landscape: makeNewsLines(),
    },
  },

  'score': {
    name: 'Final Score',
    icon: '📊',
    description: 'Post-game final score card',
    playerCentric: false,
    fields: {
      feed: [
        { key: 'homeTeam', label: 'Home Team', x: 320, y: 380, fontSize: 52, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 300 },
        { key: 'awayTeam', label: 'Away Team', x: 760, y: 380, fontSize: 52, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 300 },
        { key: 'homeScore', label: 'Home Score', x: 320, y: 560, fontSize: 120, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 250 },
        { key: 'awayScore', label: 'Away Score', x: 760, y: 560, fontSize: 120, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 250 },
        { key: 'result', label: 'Result (FINAL/VICTORY)', x: 540, y: 220, fontSize: 40, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 500 },
        { key: 'mvp', label: 'MVP', x: 540, y: 780, fontSize: 22, font: 'body', color: 'rgba(255,255,255,0.7)', align: 'center', maxWidth: 600 },
      ],
      portrait: [
        { key: 'homeTeam', label: 'Home Team', x: 320, y: 480, fontSize: 52, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 300 },
        { key: 'awayTeam', label: 'Away Team', x: 760, y: 480, fontSize: 52, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 300 },
        { key: 'homeScore', label: 'Home Score', x: 320, y: 680, fontSize: 120, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 250 },
        { key: 'awayScore', label: 'Away Score', x: 760, y: 680, fontSize: 120, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 250 },
        { key: 'result', label: 'Result', x: 540, y: 280, fontSize: 40, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 500 },
        { key: 'mvp', label: 'MVP', x: 540, y: 960, fontSize: 22, font: 'body', color: 'rgba(255,255,255,0.7)', align: 'center', maxWidth: 600 },
      ],
      story: [
        { key: 'homeTeam', label: 'Home Team', x: 320, y: 720, fontSize: 52, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 300 },
        { key: 'awayTeam', label: 'Away Team', x: 760, y: 720, fontSize: 52, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 300 },
        { key: 'homeScore', label: 'Home Score', x: 320, y: 920, fontSize: 120, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 250 },
        { key: 'awayScore', label: 'Away Score', x: 760, y: 920, fontSize: 120, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 250 },
        { key: 'result', label: 'Result', x: 540, y: 500, fontSize: 40, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 500 },
        { key: 'mvp', label: 'MVP', x: 540, y: 1200, fontSize: 22, font: 'body', color: 'rgba(255,255,255,0.7)', align: 'center', maxWidth: 600 },
      ],
      landscape: [
        { key: 'homeTeam', label: 'Home Team', x: 310, y: 240, fontSize: 44, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 280 },
        { key: 'awayTeam', label: 'Away Team', x: 890, y: 240, fontSize: 44, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 280 },
        { key: 'homeScore', label: 'Home Score', x: 310, y: 380, fontSize: 100, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 200 },
        { key: 'awayScore', label: 'Away Score', x: 890, y: 380, fontSize: 100, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 200 },
        { key: 'result', label: 'Result', x: 600, y: 120, fontSize: 34, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 400 },
        { key: 'mvp', label: 'MVP', x: 600, y: 540, fontSize: 18, font: 'body', color: 'rgba(255,255,255,0.7)', align: 'center', maxWidth: 500 },
      ],
    },
  },

  'hype': {
    name: 'Hype / Promo',
    icon: '🔥',
    description: 'Flexible promo graphic with headline and subtext',
    playerCentric: false,
    fields: {
      feed: [
        { key: 'headline', label: 'Headline', x: 540, y: 440, fontSize: 72, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 900 },
        { key: 'subtext', label: 'Subtext', x: 540, y: 540, fontSize: 24, font: 'body', color: 'rgba(255,255,255,0.7)', align: 'center', maxWidth: 800 },
        { key: 'teamName', label: 'Team', x: 540, y: 880, fontSize: 20, font: 'condensed', color: 'rgba(255,255,255,0.5)', align: 'center', maxWidth: 400 },
      ],
      portrait: [
        { key: 'headline', label: 'Headline', x: 540, y: 560, fontSize: 72, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 900 },
        { key: 'subtext', label: 'Subtext', x: 540, y: 660, fontSize: 24, font: 'body', color: 'rgba(255,255,255,0.7)', align: 'center', maxWidth: 800 },
        { key: 'teamName', label: 'Team', x: 540, y: 1100, fontSize: 20, font: 'condensed', color: 'rgba(255,255,255,0.5)', align: 'center', maxWidth: 400 },
      ],
      story: [
        { key: 'headline', label: 'Headline', x: 540, y: 800, fontSize: 72, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 900 },
        { key: 'subtext', label: 'Subtext', x: 540, y: 900, fontSize: 24, font: 'body', color: 'rgba(255,255,255,0.7)', align: 'center', maxWidth: 800 },
        { key: 'teamName', label: 'Team', x: 540, y: 1500, fontSize: 20, font: 'condensed', color: 'rgba(255,255,255,0.5)', align: 'center', maxWidth: 400 },
      ],
      landscape: [
        { key: 'headline', label: 'Headline', x: 600, y: 280, fontSize: 56, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 900 },
        { key: 'subtext', label: 'Subtext', x: 600, y: 360, fontSize: 20, font: 'body', color: 'rgba(255,255,255,0.7)', align: 'center', maxWidth: 700 },
        { key: 'teamName', label: 'Team', x: 600, y: 560, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.5)', align: 'center', maxWidth: 400 },
      ],
    },
  },

  'highlight': {
    name: 'Highlight',
    icon: '🎬',
    description: 'Player highlight or play-of-the-game',
    playerCentric: true,
    fields: {
      feed: [
        { key: 'playerName', label: 'Player Name', x: 540, y: 780, fontSize: 60, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 900 },
        { key: 'description', label: 'Play Description', x: 540, y: 850, fontSize: 22, font: 'body', color: 'rgba(255,255,255,0.8)', align: 'center', maxWidth: 800 },
        { key: 'teamName', label: 'Team', x: 540, y: 920, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.5)', align: 'center', maxWidth: 400 },
      ],
      portrait: [
        { key: 'playerName', label: 'Player Name', x: 540, y: 1050, fontSize: 60, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 900 },
        { key: 'description', label: 'Play Description', x: 540, y: 1120, fontSize: 22, font: 'body', color: 'rgba(255,255,255,0.8)', align: 'center', maxWidth: 800 },
        { key: 'teamName', label: 'Team', x: 540, y: 1190, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.5)', align: 'center', maxWidth: 400 },
      ],
      story: [
        { key: 'playerName', label: 'Player Name', x: 540, y: 1500, fontSize: 60, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 900 },
        { key: 'description', label: 'Play Description', x: 540, y: 1570, fontSize: 22, font: 'body', color: 'rgba(255,255,255,0.8)', align: 'center', maxWidth: 800 },
        { key: 'teamName', label: 'Team', x: 540, y: 1640, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.5)', align: 'center', maxWidth: 400 },
      ],
      landscape: [
        { key: 'playerName', label: 'Player Name', x: 800, y: 400, fontSize: 48, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 600 },
        { key: 'description', label: 'Play Description', x: 800, y: 460, fontSize: 18, font: 'body', color: 'rgba(255,255,255,0.8)', align: 'center', maxWidth: 550 },
        { key: 'teamName', label: 'Team', x: 800, y: 510, fontSize: 16, font: 'condensed', color: 'rgba(255,255,255,0.5)', align: 'center', maxWidth: 350 },
      ],
    },
  },

  // Internal id stays `batting-leaders` so existing requests, idea
  // payloads, generate_log entries, and bookmarks keep resolving.
  // Display label renamed v4.4.2 to reflect the broader use case
  // (any single-stat leader, not just OPS+).
  'batting-leaders': {
    name: 'Stat Leader',
    icon: '🏏',
    description: 'Single-stat spotlight — pick a stat and feature its leader',
    playerCentric: false,
    fields: {
      feed: [
        { key: 'title', label: 'Title', x: 540, y: 80, fontSize: 44, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 800 },
        { key: 'subtitle', label: 'Subtitle', x: 540, y: 130, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.6)', align: 'center', maxWidth: 600 },
      ],
      portrait: [
        { key: 'title', label: 'Title', x: 540, y: 100, fontSize: 44, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 800 },
        { key: 'subtitle', label: 'Subtitle', x: 540, y: 150, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.6)', align: 'center', maxWidth: 600 },
      ],
      story: [
        { key: 'title', label: 'Title', x: 540, y: 200, fontSize: 44, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 800 },
        { key: 'subtitle', label: 'Subtitle', x: 540, y: 250, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.6)', align: 'center', maxWidth: 600 },
      ],
      landscape: [
        { key: 'title', label: 'Title', x: 600, y: 60, fontSize: 36, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 700 },
        { key: 'subtitle', label: 'Subtitle', x: 600, y: 100, fontSize: 16, font: 'condensed', color: 'rgba(255,255,255,0.6)', align: 'center', maxWidth: 500 },
      ],
    },
  },

  // Internal id stays `pitching-leaders` to preserve backward compat
  // for existing requests + bookmarks. Renamed v4.4.2 from "Pitching
  // Leaders" — used now as a single-game player spotlight rather than
  // a season-long leaderboard.
  'pitching-leaders': {
    name: 'Player of the Game',
    icon: '🏆',
    description: 'Spotlight a single player coming off a standout game',
    playerCentric: false,
    fields: {
      feed: [
        { key: 'title', label: 'Title', x: 540, y: 80, fontSize: 44, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 800 },
        { key: 'subtitle', label: 'Subtitle', x: 540, y: 130, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.6)', align: 'center', maxWidth: 600 },
      ],
      portrait: [
        { key: 'title', label: 'Title', x: 540, y: 100, fontSize: 44, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 800 },
        { key: 'subtitle', label: 'Subtitle', x: 540, y: 150, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.6)', align: 'center', maxWidth: 600 },
      ],
      story: [
        { key: 'title', label: 'Title', x: 540, y: 200, fontSize: 44, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 800 },
        { key: 'subtitle', label: 'Subtitle', x: 540, y: 250, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.6)', align: 'center', maxWidth: 600 },
      ],
      landscape: [
        { key: 'title', label: 'Title', x: 600, y: 60, fontSize: 36, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 700 },
        { key: 'subtitle', label: 'Subtitle', x: 600, y: 100, fontSize: 16, font: 'condensed', color: 'rgba(255,255,255,0.6)', align: 'center', maxWidth: 500 },
      ],
    },
  },

  'standings': {
    name: 'Standings',
    icon: '📈',
    description: 'Current league standings graphic',
    playerCentric: false,
    fields: {
      feed: [
        { key: 'title', label: 'Title', x: 540, y: 70, fontSize: 44, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 800 },
        { key: 'season', label: 'Season', x: 540, y: 120, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.6)', align: 'center', maxWidth: 400 },
      ],
      portrait: [
        { key: 'title', label: 'Title', x: 540, y: 80, fontSize: 44, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 800 },
        { key: 'season', label: 'Season', x: 540, y: 130, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.6)', align: 'center', maxWidth: 400 },
      ],
      story: [
        { key: 'title', label: 'Title', x: 540, y: 180, fontSize: 44, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 800 },
        { key: 'season', label: 'Season', x: 540, y: 230, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.6)', align: 'center', maxWidth: 400 },
      ],
      landscape: [
        { key: 'title', label: 'Title', x: 600, y: 50, fontSize: 36, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 700 },
        { key: 'season', label: 'Season', x: 600, y: 90, fontSize: 16, font: 'condensed', color: 'rgba(255,255,255,0.6)', align: 'center', maxWidth: 400 },
      ],
    },
  },

  // v4.5.17: Blank Slate — pure background photo, no overlay, optional
  // text. Used by the "Download via Studio" path on the Files /
  // Player / Team pages: clicking a photo's preview action drops the
  // user into Studio with this template active and the photo
  // pre-loaded as the background. Designers who just want a clean
  // export of the source asset (or to add minimal copy on top) avoid
  // having to go through the full Custom + overlay flow.
  'blank-slate': {
    name: 'Blank Slate',
    icon: '🖼️',
    description: 'Just the photo — optional headline, no overlays. The fastest path from raw asset to social-ready export.',
    playerCentric: false,
    fields: {
      feed: [
        { key: 'headline', label: 'Headline (optional)', x: 540, y: 90, fontSize: 56, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 900,
          shadow: { color: 'rgba(0,0,0,0.7)', blur: 18, offsetX: 0, offsetY: 4 } },
      ],
      portrait: [
        { key: 'headline', label: 'Headline (optional)', x: 540, y: 130, fontSize: 56, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 900,
          shadow: { color: 'rgba(0,0,0,0.7)', blur: 18, offsetX: 0, offsetY: 4 } },
      ],
      story: [
        { key: 'headline', label: 'Headline (optional)', x: 540, y: 220, fontSize: 56, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 900,
          shadow: { color: 'rgba(0,0,0,0.7)', blur: 18, offsetX: 0, offsetY: 4 } },
      ],
      landscape: [
        { key: 'headline', label: 'Headline (optional)', x: 600, y: 70, fontSize: 48, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 1000,
          shadow: { color: 'rgba(0,0,0,0.7)', blur: 18, offsetX: 0, offsetY: 4 } },
      ],
    },
  },
};

// Font map for canvas rendering. Three canonical slots (heading/body/
// condensed) plus three local-loaded display faces (gotham/press/united)
// served from /public/fonts and registered via src/local-fonts.js. The
// canvas reads from this map by `field.font` key, so any template field
// can opt into a specific face by setting e.g. `font: 'press'`.
export const FONT_MAP = {
  heading:   "'Bebas Neue', 'Arial Black', sans-serif",
  body:      "'Barlow', Arial, sans-serif",
  condensed: "'Barlow Condensed', Arial, sans-serif",
  // Local fonts — must be present in /public/fonts AND registered by
  // src/local-fonts.js. Bold weight is the only one we ship today; the
  // canvas references the family name and weight is implicit via the
  // FontFace rule loaded at boot.
  gotham:    "'Gotham', 'Arial Black', sans-serif",
  press:     "'Press Gothic', 'Impact', sans-serif",
  united:    "'United Sans', 'Arial Black', sans-serif",
};

// Get field config for a template type + platform
export function getFieldConfig(templateType, platform) {
  const tmpl = TEMPLATE_TYPES[templateType];
  if (!tmpl) return [];
  return tmpl.fields[platform] || tmpl.fields.feed || [];
}
