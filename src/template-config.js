// ─── Template Type Definitions with Fixed Text Field Zones ──────────────────
// Designers create overlay PNGs that match these layouts.
// Dynamic text is rendered at the positions defined here.
//
// Font keys: 'heading' = Bebas Neue, 'body' = Barlow, 'condensed' = Barlow Condensed
// All coordinates are in pixels at the native canvas resolution.

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
    name: 'Player Stat Card',
    icon: '⭐',
    description: 'Individual player stat spotlight',
    playerCentric: true,
    fields: {
      feed: [
        { key: 'playerName', label: 'Player Name', x: 540, y: 160, fontSize: 64, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 900 },
        { key: 'number', label: 'Jersey #', x: 880, y: 380, fontSize: 220, font: 'heading', color: 'rgba(255,255,255,0.12)', align: 'center', maxWidth: 300 },
        { key: 'teamName', label: 'Team', x: 540, y: 220, fontSize: 20, font: 'condensed', color: 'rgba(255,255,255,0.6)', align: 'center', maxWidth: 400 },
        { key: 'statLine', label: 'Stat Line', x: 540, y: 860, fontSize: 30, font: 'body', color: '#FFFFFF', align: 'center', maxWidth: 950 },
      ],
      portrait: [
        { key: 'playerName', label: 'Player Name', x: 540, y: 200, fontSize: 64, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 900 },
        { key: 'number', label: 'Jersey #', x: 880, y: 500, fontSize: 220, font: 'heading', color: 'rgba(255,255,255,0.12)', align: 'center', maxWidth: 300 },
        { key: 'teamName', label: 'Team', x: 540, y: 260, fontSize: 20, font: 'condensed', color: 'rgba(255,255,255,0.6)', align: 'center', maxWidth: 400 },
        { key: 'statLine', label: 'Stat Line', x: 540, y: 1100, fontSize: 30, font: 'body', color: '#FFFFFF', align: 'center', maxWidth: 950 },
      ],
      story: [
        { key: 'playerName', label: 'Player Name', x: 540, y: 320, fontSize: 64, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 900 },
        { key: 'number', label: 'Jersey #', x: 880, y: 700, fontSize: 220, font: 'heading', color: 'rgba(255,255,255,0.12)', align: 'center', maxWidth: 300 },
        { key: 'teamName', label: 'Team', x: 540, y: 380, fontSize: 20, font: 'condensed', color: 'rgba(255,255,255,0.6)', align: 'center', maxWidth: 400 },
        { key: 'statLine', label: 'Stat Line', x: 540, y: 1560, fontSize: 30, font: 'body', color: '#FFFFFF', align: 'center', maxWidth: 950 },
      ],
      landscape: [
        { key: 'playerName', label: 'Player Name', x: 800, y: 160, fontSize: 52, font: 'heading', color: '#FFFFFF', align: 'center', maxWidth: 600 },
        { key: 'number', label: 'Jersey #', x: 1050, y: 350, fontSize: 180, font: 'heading', color: 'rgba(255,255,255,0.12)', align: 'center', maxWidth: 250 },
        { key: 'teamName', label: 'Team', x: 800, y: 210, fontSize: 18, font: 'condensed', color: 'rgba(255,255,255,0.6)', align: 'center', maxWidth: 350 },
        { key: 'statLine', label: 'Stat Line', x: 800, y: 520, fontSize: 24, font: 'body', color: '#FFFFFF', align: 'center', maxWidth: 600 },
      ],
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

  'batting-leaders': {
    name: 'Batting Leaders',
    icon: '🏏',
    description: 'Top hitters leaderboard by OPS+',
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

  'pitching-leaders': {
    name: 'Pitching Leaders',
    icon: '💨',
    description: 'Top pitchers leaderboard by FIP',
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
};

// Font map for canvas rendering
export const FONT_MAP = {
  heading: "'Bebas Neue', 'Arial Black', sans-serif",
  body: "'Barlow', Arial, sans-serif",
  condensed: "'Barlow Condensed', Arial, sans-serif",
};

// Get field config for a template type + platform
export function getFieldConfig(templateType, platform) {
  const tmpl = TEMPLATE_TYPES[templateType];
  if (!tmpl) return [];
  return tmpl.fields[platform] || tmpl.fields.feed || [];
}
