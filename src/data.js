// ─── GRAND SLAM SYSTEMS API ─────────────────────────────────────────────────
// Live data from app.grandslamsystems.com (prowiffleball.com stats platform)

// Routes through our Vercel serverless proxy (api/gss/[...path].js) to bypass
// the upstream CORS whitelist. In dev, Vite proxies /api/gss to the real API.
const GSS_BASE = '/api/gss';
const BLW_LEAGUE_ID = 3;

// API team abbreviations → our internal codes
const TEAM_MAP = {
  'LA': 'LAN', 'AZ': 'AZS', 'SD': 'SDO', 'LV': 'LVS',
  'NY': 'NYG', 'BOS': 'BOS', 'DAL': 'DAL', 'PHI': 'PHI',
  'CHI': 'CHI', 'MIA': 'MIA',
};

// BLW team abbreviations in the API (used to filter out non-BLW teams)
const BLW_TEAM_ABBRS = new Set(Object.keys(TEAM_MAP));

function mapTeamAbbr(apiAbbr) {
  return TEAM_MAP[apiAbbr] || apiAbbr;
}

// ─── TEAM DATA — Logo-accurate hex colors ──────────────────────────────────
export const TEAMS = [
  { id:"LAN", apiAbbr:"LA", apiTeamId:45, slug:"la-naturals", name:"Los Angeles Naturals", city:"Los Angeles", color:"#0972CE", accent:"#C1CFD4", dark:"#054A8A", record:"17-1", rank:1, owner:"Kevin Costner", pct:".944", diff:"+49", logo:"/team-logos/la-naturals.png" },
  { id:"AZS", apiAbbr:"AZ", apiTeamId:42, slug:"az-saguaros", name:"Arizona Saguaros", city:"Arizona", color:"#163E35", accent:"#6AA338", dark:"#0D2820", record:"11-5", rank:2, owner:"", pct:".688", diff:"+44", logo:"/team-logos/az-saguaros.png" },
  { id:"LV",  apiAbbr:"LV", apiTeamId:49, slug:"lv-scorpions", name:"Las Vegas Scorpions", city:"Las Vegas", color:"#1A1A1A", accent:"#A3ABB1", dark:"#0D0D0D", record:"7-4", rank:3, owner:"Marc Lasry", pct:".636", diff:"+11", logo:"/team-logos/lv-scorpions.png" },
  { id:"NYG", apiAbbr:"NY", apiTeamId:43, slug:"ny-greenapples", name:"New York Green Apples", city:"New York", color:"#538D41", accent:"#F5B8C5", dark:"#3A6A2D", record:"7-5", rank:4, owner:"Gary Vaynerchuk", pct:".583", diff:"-4", logo:"/team-logos/ny-greenapples.png" },
  { id:"DAL", apiAbbr:"DAL", apiTeamId:44, slug:"dal-pandas", name:"Dallas Pandas", city:"Dallas", color:"#1A1A1A", accent:"#A37812", dark:"#0D0D0D", record:"6-6", rank:5, owner:"Dude Perfect", pct:".500", diff:"0", logo:"/team-logos/dal-pandas.png" },
  { id:"BOS", apiAbbr:"BOS", apiTeamId:48, slug:"bos-harborhawks", name:"Boston Harbor Hawks", city:"Boston", color:"#06205B", accent:"#F9F2D8", dark:"#041640", record:"5-6", rank:6, owner:"", pct:".455", diff:"-4", logo:"/team-logos/bos-harborhawks.png" },
  { id:"PHI", apiAbbr:"PHI", apiTeamId:47, slug:"phi-wiffleclub", name:"Philadelphia Wiffle Club", city:"Philadelphia", color:"#0D223F", accent:"#A8B8C8", dark:"#08162A", record:"4-5", rank:7, owner:"David Adelman", pct:".444", diff:"+16", logo:"/team-logos/phi-wiffleclub.png" },
  { id:"CHI", apiAbbr:"CHI", apiTeamId:50, slug:"chi-bats", name:"Chicago Bats", city:"Chicago", color:"#EC1C2C", accent:"#FFFFFF", dark:"#B5151F", record:"4-6", rank:8, owner:"", pct:".400", diff:"-7", logo:"/team-logos/chi-bats.png" },
  { id:"MIA", apiAbbr:"MIA", apiTeamId:51, slug:"mia-mirage", name:"Miami Mirage", city:"Miami", color:"#144734", accent:"#7EC6BB", dark:"#0D3024", record:"4-6", rank:9, owner:"", pct:".400", diff:"-1", logo:"/team-logos/mia-mirage.png" },
  { id:"SDO", apiAbbr:"SD", apiTeamId:46, slug:"sd-orcas", name:"San Diego Orcas", city:"San Diego", color:"#0B3146", accent:"#4BCED8", dark:"#072230", record:"2-7", rank:10, owner:"", pct:".222", diff:"-6", logo:"/team-logos/sd-orcas.png" },
];

export const getTeam = (id) => TEAMS.find(t => t.id === id || t.slug === id || t.apiAbbr === id);

// ─── API STATUS ─────────────────────────────────────────────────────────────
export const API_CONFIG = {
  baseUrl: GSS_BASE,
  isLive: true, // Now always live — fetches from grandslamsystems.com directly
};

// ─── CACHED FALLBACK DATA (from April 15, 2026 snapshot) ────────────────────
const BATTING_FALLBACK = [
  { rank:1, name:"Torin Roth", num:"16", team:"SDO", ops_plus:247, avg:".417", obp:".521", slg:".812", hr:0 },
  { rank:2, name:"Tommy Hernandez", num:"18", team:"MIA", ops_plus:236, avg:".435", obp:".488", slg:".756", hr:0 },
  { rank:3, name:"Andrew Ledet", num:"2", team:"AZS", ops_plus:200, avg:".462", obp:".521", slg:".812", hr:7 },
  { rank:4, name:"Josh Wheeler", num:"40", team:"PHI", ops_plus:194, avg:".310", obp:".465", slg:".692", hr:0 },
  { rank:5, name:"Logan Rose", num:"26", team:"DAL", ops_plus:192, avg:".357", obp:".438", slg:".654", hr:0 },
  { rank:6, name:"Dustin Staggs", num:"28", team:"LV", ops_plus:192, avg:".294", obp:".421", slg:".628", hr:0 },
  { rank:7, name:"Brice Clark", num:"22", team:"AZS", ops_plus:177, avg:".292", obp:".452", slg:".681", hr:0 },
  { rank:8, name:"Nick Martinez", num:"10", team:"AZS", ops_plus:174, avg:".292", obp:".412", slg:".602", hr:2 },
  { rank:9, name:"Konnor Jaso", num:"3", team:"LAN", ops_plus:171, avg:".194", obp:".398", slg:".585", hr:2 },
  { rank:10, name:"Brody Livingston", num:"19", team:"DAL", ops_plus:159, avg:".227", obp:".398", slg:".585", hr:1 },
];

const PITCHING_FALLBACK = [
  { rank:1, name:"Myc Witty", num:"1", team:"LAN", fip:-1.85, era:"0.00", ip:"25.0", k4:"11.68", w:4, l:0 },
  { rank:2, name:"Will Smithey", num:"5", team:"NYG", fip:-1.79, era:"0.00", ip:"19.0", k4:"10.74", w:3, l:1 },
  { rank:3, name:"Jordan Robles", num:"8", team:"LAN", fip:-1.41, era:"0.00", ip:"30.0", k4:"9.87", w:7, l:1 },
  { rank:4, name:"Jordan Bohnet", num:"6", team:"LAN", fip:-1.07, era:"0.00", ip:"14.0", k4:"9.43", w:2, l:1 },
  { rank:5, name:"Konnor Jaso", num:"3", team:"LAN", fip:-0.31, era:"0.00", ip:"31.0", k4:"9.81", w:5, l:1 },
  { rank:6, name:"Randy Dalbey", num:"13", team:"BOS", fip:-0.18, era:"0.00", ip:"36.0", k4:"9.44", w:5, l:4 },
  { rank:7, name:"Steve Trzpis", num:"4", team:"LAN", fip:-0.02, era:"0.00", ip:"36.0", k4:"9.22", w:8, l:0 },
  { rank:8, name:"Preston Kolm", num:"21", team:"LV",  fip:0.26, era:"0.00", ip:"17.0", k4:"10.82", w:3, l:0 },
];

// ─── DATA CACHE ─────────────────────────────────────────────────────────────
// In-memory cache so we don't re-fetch on every page navigation
let _battingCache = null;
let _pitchingCache = null;
let _rankingsCache = null;
let _lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function isCacheStale() {
  return !_lastFetch || (Date.now() - _lastFetch > CACHE_TTL);
}

// ─── LIVE API FETCH FUNCTIONS ───────────────────────────────────────────────

// Transform API batting data → our internal format
function transformBatting(apiData) {
  if (!apiData?.statistics) return BATTING_FALLBACK;

  const blwOnly = apiData.statistics.filter(p => BLW_TEAM_ABBRS.has(p.team?.abbreviation));
  const sorted = blwOnly.sort((a, b) => (b.opsPlus || 0) - (a.opsPlus || 0));

  return sorted.map((p, i) => ({
    rank: i + 1,
    playerId: p.playerId,
    name: p.playerName,
    num: '', // Jersey numbers sourced from uploaded media filenames, not API
    team: mapTeamAbbr(p.team?.abbreviation || ''),
    teamName: p.team?.name || '',
    teamLogo: p.team?.logo || '',
    avatarUrl: p.avatarUrl,
    games: p.games,
    pa: p.plateAppearances,
    ab: p.atBats,
    runs: p.runs,
    hits: p.hits,
    singles: p.singles,
    doubles: p.doubles,
    triples: p.triples,
    hr: p.homeruns || 0,
    tb: p.totalBases,
    rbi: p.rbi || 0,
    bb: p.walks,
    k: p.strikeouts,
    avg: (p.battingAverage || 0).toFixed(3),
    obp: (p.onBasePercentage || 0).toFixed(3),
    slg: (p.sluggingPercentage || 0).toFixed(3),
    ops: (p.ops || 0).toFixed(3),
    ops_plus: p.opsPlus || 0,
    iso: (p.iso || 0).toFixed(3),
    babip: (p.babip || 0).toFixed(3),
    kPct: p.strikeoutPercentage || 0,
    bbPct: p.walkPercentage || 0,
    risp: (p.risp || 0).toFixed(3),
    currentRank: p.currentRank,
    previousRank: p.previousRank,
  }));
}

// Transform API pitching data → our internal format
function transformPitching(apiData) {
  if (!apiData?.statistics) return PITCHING_FALLBACK;

  const blwOnly = apiData.statistics.filter(p => BLW_TEAM_ABBRS.has(p.team?.abbreviation));
  const sorted = blwOnly.sort((a, b) => (a.fip || 999) - (b.fip || 999));

  return sorted.map((p, i) => ({
    rank: i + 1,
    playerId: p.playerId,
    name: p.playerName,
    num: '', // Jersey numbers sourced from uploaded media filenames, not API
    team: mapTeamAbbr(p.team?.abbreviation || ''),
    teamName: p.team?.name || '',
    teamLogo: p.team?.logo || '',
    avatarUrl: p.avatarUrl,
    games: p.games,
    w: p.wins || 0,
    l: p.losses || 0,
    saves: p.saves || 0,
    ip: p.inningsPitched || '0',
    hits: p.hits,
    runs: p.runs,
    // Raw counting stats (walks/strikeouts/HR allowed) — API field name variants guarded
    bb: p.walks != null ? p.walks : (p.walksAllowed || 0),
    k: p.strikeouts != null ? p.strikeouts : (p.strikeoutsThrown || 0),
    hrAllowed: p.homeruns != null ? p.homeruns : (p.homerunsAllowed != null ? p.homerunsAllowed : 0),
    era: p.era != null ? p.era.toFixed(2) : '0.00',
    whip: p.whip != null ? p.whip.toFixed(2) : '0.00',
    fip: p.fip || 0,
    k4: p.kPer != null ? p.kPer.toFixed(2) : '0.00',
    bb4: p.bbPer != null ? p.bbPer.toFixed(2) : '0.00',
    hr4: p.hrPer != null ? p.hrPer.toFixed(2) : '0.00',
    kbb: p.kbb != null ? p.kbb.toFixed(2) : '0.00',
    babip: p.babip != null ? p.babip.toFixed(3) : '.000',
    shutouts: p.shutouts || 0,
    gbPct: p.gbPercentage || 0,
    currentRank: p.currentRank,
    previousRank: p.previousRank,
  }));
}

// Transform rankings data
function transformRankings(apiData) {
  if (!Array.isArray(apiData)) return [];
  // Filter to players in BLW (league id 3)
  const blwPlayers = apiData.filter(p =>
    p.leagues?.some(l => l.id === BLW_LEAGUE_ID)
  );
  return blwPlayers.map(p => ({
    playerId: p.id,
    name: `${p.firstName} ${p.lastName}`,
    firstName: p.firstName,
    lastName: p.lastName,
    shortName: p.shortName,
    currentRank: p.currentRank,
    previousRank: p.previousRank,
    rankChange: p.previousRank - p.currentRank,
    totalPoints: p.totalPoints,
    averagePoints: p.averagePoints,
    compositePoints: p.compositePoints,
    bats: p.bats,
    throws: p.throws,
  }));
}

export async function fetchBattingLeaders() {
  if (!isCacheStale() && _battingCache) return _battingCache;
  try {
    const res = await fetch(`${GSS_BASE}/leagues/${BLW_LEAGUE_ID}/batting-stats?showAll=true`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _battingCache = transformBatting(data);
    _lastFetch = Date.now();
    return _battingCache;
  } catch (e) {
    console.warn('Batting API failed, using fallback:', e);
    return _battingCache || BATTING_FALLBACK;
  }
}

export async function fetchPitchingLeaders() {
  if (!isCacheStale() && _pitchingCache) return _pitchingCache;
  try {
    const res = await fetch(`${GSS_BASE}/leagues/${BLW_LEAGUE_ID}/pitching-stats?showAll=true`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _pitchingCache = transformPitching(data);
    _lastFetch = Date.now();
    return _pitchingCache;
  } catch (e) {
    console.warn('Pitching API failed, using fallback:', e);
    return _pitchingCache || PITCHING_FALLBACK;
  }
}

export async function fetchRankings() {
  if (!isCacheStale() && _rankingsCache) return _rankingsCache;
  try {
    // Without ?showAll=true the endpoint caps the response at the leaderboard
    // page size (~72 players), so a player like Bryson Livingston at #118
    // wouldn't exist in the cache. Same-lastname cousins (Brody + Bryson)
    // then silently inherit whichever record was returned — causing the
    // wrong tier badge to show. Always fetch the full list.
    const res = await fetch(`${GSS_BASE}/rankings/0?showAll=true`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _rankingsCache = transformRankings(data);
    _lastFetch = Date.now();
    return _rankingsCache;
  } catch (e) {
    console.warn('Rankings API failed, using fallback:', e);
    return _rankingsCache || [];
  }
}

// Fetch all data in parallel
export async function fetchAllData() {
  const [batting, pitching, rankings] = await Promise.all([
    fetchBattingLeaders(),
    fetchPitchingLeaders(),
    fetchRankings(),
  ]);
  return { batting, pitching, rankings };
}

// ─── LEAGUE SCHEDULE ────────────────────────────────────────────────────────
// Pulls game-by-game data from Grand Slam Systems /games. Each raw game has
// apiAbbr-style team codes (LA, AZ, NY) — we remap to our BLW ids (LAN, AZS,
// NYG) via the existing TEAMS lookup so calendars can filter by team cleanly.
// Non-BLW opponents (tournaments include teams like LVW, OTR, WD) pass through
// with a null `homeTeam` / `awayTeam`.

let _gamesCache = null;
let _gamesFetchedAt = 0;

export async function fetchGames() {
  if (_gamesCache && (Date.now() - _gamesFetchedAt) < CACHE_TTL) return _gamesCache;
  try {
    const res = await fetch(`${GSS_BASE}/leagues/${BLW_LEAGUE_ID}/games?showAll=true`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];

    const abbrToId = new Map();
    for (const t of TEAMS) abbrToId.set((t.apiAbbr || '').toUpperCase(), t.id);

    _gamesCache = items.map(g => ({
      id: g.id,
      dateTime: g.dateTime,            // "2026-06-07T18:00:00"
      timezone: g.timezoneId,
      status: g.status,                // "SCHEDULED" | "SUBMITTED" | etc
      home: {
        apiAbbr: g.homeAbbreviation,
        teamId: abbrToId.get((g.homeAbbreviation || '').toUpperCase()) || null,
        name: g.homeName,
        score: g.homeScore,
      },
      away: {
        apiAbbr: g.awayAbbreviation,
        teamId: abbrToId.get((g.awayAbbreviation || '').toUpperCase()) || null,
        name: g.awayName,
        score: g.awayScore,
      },
      tournamentId: g.tournamentId,
    }));
    _gamesFetchedAt = Date.now();
    return _gamesCache;
  } catch (e) {
    console.warn('[fetchGames] failed', e);
    return _gamesCache || [];
  }
}

// Utility: returns all games (any status) for a given team id (LAN, AZS, ...).
// Sorted ascending by dateTime so callers can take the next N upcoming games
// via `.filter(g => new Date(g.dateTime) > now)`.
export function gamesForTeam(games, teamId) {
  if (!teamId || !Array.isArray(games)) return [];
  return games
    .filter(g => g.home?.teamId === teamId || g.away?.teamId === teamId)
    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
}

// ─── TEAM ROSTER API ────────────────────────────────────────────────────────
// Fetches the official team roster from /api/teams/:apiTeamId/roster
// This is the authoritative source for who's on each team — not just players
// with current BLW stats. Players don't have jersey numbers in this data.

const _rosterCache = new Map(); // teamId → { roster, fetchedAt }

export async function fetchTeamRosterFromApi(teamId) {
  const team = TEAMS.find(t => t.id === teamId);
  if (!team?.apiTeamId) return [];
  const cached = _rosterCache.get(teamId);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL) return cached.roster;
  try {
    const res = await fetch(`${GSS_BASE}/teams/${team.apiTeamId}/roster`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const roster = (Array.isArray(data) ? data : []).map(p => ({
      playerId: p.playerId,
      name: p.playerName,
      shortName: p.shortName,
      firstName: (p.playerName || '').split(' ').slice(0, -1).join(' '),
      lastName: (p.playerName || '').split(' ').pop(),
      avatarUrl: p.avatarUrl,
      team: teamId,
      currentRank: p.currentRank,
      previousRank: p.previousRank,
      careerGames: p.careerGames,
      // Batting summary
      atBats: p.atBats,
      hits: p.hits,
      hr: p.homeruns || 0,
      rbi: p.rbi || 0,
      avg: p.battingAverage != null ? p.battingAverage.toFixed(3) : '.000',
      ops: p.ops != null ? p.ops.toFixed(3) : '.000',
      // Pitching summary
      ip: p.inningsPitched || '0',
      w: p.wins || 0,
      l: p.losses || 0,
      k: p.strikeouts || 0,
      era: p.era != null ? Number(p.era).toFixed(2) : '0.00',
      whip: p.whip != null ? Number(p.whip).toFixed(2) : '0.00',
      // Heuristic stat type
      isPitcher: (p.inningsPitched && parseFloat(p.inningsPitched) > 0),
      isBatter: (p.atBats || 0) > 0,
    }));
    _rosterCache.set(teamId, { roster, fetchedAt: Date.now() });
    return roster;
  } catch (e) {
    console.warn(`Roster API failed for ${teamId}:`, e);
    return cached?.roster || [];
  }
}

// Fetch rosters for all BLW teams in parallel — used by the master Players directory
export async function fetchAllRosters() {
  const results = await Promise.all(TEAMS.map(t => fetchTeamRosterFromApi(t.id)));
  return results.flat();
}

// ─── LEGACY EXPORTS (for components still using static data) ────────────────
// These are the fallback snapshots — used by canvas render functions and
// anywhere that needs synchronous access before the API loads
export const BATTING_LEADERS = BATTING_FALLBACK;
export const PITCHING_LEADERS = PITCHING_FALLBACK;

export const TEMPLATES = [
  { id: "gameday", name: "Game Day Graphic", icon: "🏟️", desc: "Pre-game matchup hype", fields: ["opponent","date","time","venue"] },
  { id: "score", name: "Final Score", icon: "📊", desc: "Post-game score card", fields: ["opponent","teamScore","oppScore","mvp"] },
  { id: "player-stat", name: "Player Stat Card", icon: "⭐", desc: "Individual stat spotlight", fields: ["playerName","number","statLine"] },
  { id: "batting-leaders", name: "Batting Leaders", icon: "🏏", desc: "Top hitters by OPS+", fields: [] },
  { id: "pitching-leaders", name: "Pitching Leaders", icon: "💨", desc: "Top pitchers by FIP", fields: [] },
  { id: "standings", name: "Standings", icon: "📈", desc: "Current league standings", fields: [] },
];

export const PLATFORMS = {
  "feed": { w: 1080, h: 1080, label: "1080×1080 Feed" },
  "portrait": { w: 1080, h: 1350, label: "1080×1350 Portrait" },
  "story": { w: 1080, h: 1920, label: "1080×1920 Story" },
  "landscape": { w: 1200, h: 675, label: "1200×675 Landscape" },
};

// ─── PLAYER ROSTER (combined from live or fallback data) ────────────────────
export function getAllPlayers() {
  const seen = new Set();
  const players = [];
  const addPlayer = (p, statType) => {
    const key = `${p.team}_${p.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const lastName = p.name.split(' ').pop();
    players.push({ name: p.name, num: p.num, team: p.team, lastName, statType });
  };
  // Use cached live data if available, otherwise fallback
  (_battingCache || BATTING_FALLBACK).forEach(p => addPlayer(p, 'batting'));
  (_pitchingCache || PITCHING_FALLBACK).forEach(p => addPlayer(p, 'pitching'));
  return players;
}

// URL-safe slug for player last names
// ─── Canonical 2026 BLW active roster ───────────────────────────────────────
// 70 players, 7 per team. The Grand Slam Systems API returns historical /
// dev-league / cross-league players that aren't on a current BLW roster;
// this list is the league commissioner's authoritative cut. The roster
// filter in getTeamRoster + rebuildRoster drops anyone not in it.
//
// `name` is the player's CANONICAL name as it should display in the UI.
// If the API uses a different name, add an entry to NAME_ALIASES so we
// can look up their stats (e.g. API has "Mychal Witty Jr." but the
// canonical name is "Myc Witty"; aliases the other direction so a CSV
// or API lookup finds the same person).
export const CANONICAL_ROSTER_2026 = [
  // Arizona Saguaros
  { team: 'AZS', name: 'Andrew Ledet' },
  { team: 'AZS', name: 'Paul Marshall' },
  { team: 'AZS', name: 'Will Marshall' },
  { team: 'AZS', name: 'Edward Martinez' },
  { team: 'AZS', name: 'Brice Clark' },
  { team: 'AZS', name: 'Cooper Ruckel' },
  { team: 'AZS', name: 'Jackson Richardson' },
  // Boston Harbor Hawks
  { team: 'BOS', name: 'Randy Dalbey' },
  { team: 'BOS', name: 'Jake Sullivan' },
  { team: 'BOS', name: 'Ethan Winer' },
  { team: 'BOS', name: 'Jonathan Dalbey' },
  { team: 'BOS', name: 'Jim Balian' },
  { team: 'BOS', name: 'Tom Gannon' },
  { team: 'BOS', name: 'Kyle Vonschleusingen' },
  // Chicago Bats
  { team: 'CHI', name: 'Keaton Kimmel' },
  { team: 'CHI', name: 'Justin Hall' },
  { team: 'CHI', name: 'Bryson Livingston' },
  { team: 'CHI', name: "Ryan O'Rear" },
  { team: 'CHI', name: 'Drew Balmaan' },
  { team: 'CHI', name: 'Jeff Lopes' },
  { team: 'CHI', name: 'Grant Miller' },
  // Dallas Pandas
  { team: 'DAL', name: 'Jaxson Blum' },
  { team: 'DAL', name: 'Carson Rose' },
  { team: 'DAL', name: 'Logan Rose' },
  { team: 'DAL', name: 'Luke Rose' },
  { team: 'DAL', name: 'Joey Jankowski' },
  { team: 'DAL', name: 'Caleb Jeter' },
  { team: 'DAL', name: 'Ben Dulin' },
  // Las Vegas Scorpions (id LV)
  { team: 'LV',  name: 'Dustin Staggs' },
  { team: 'LV',  name: 'Jaxen Pearson' },
  { team: 'LV',  name: 'Konnor Jaso' },         // traded from LAN
  { team: 'LV',  name: 'Steven Hayden' },
  { team: 'LV',  name: 'Sawyer Behen' },
  { team: 'LV',  name: 'James Lee' },
  { team: 'LV',  name: 'Justin Lee' },
  // Los Angeles Naturals
  { team: 'LAN', name: 'Jordan Robles' },
  { team: 'LAN', name: 'Preston Kolm' },         // traded from LV
  { team: 'LAN', name: 'Vincent Lea' },
  { team: 'LAN', name: 'Myc Witty' },            // CSV says "Mychal Witty Jr." — alias below
  { team: 'LAN', name: 'Joaquin Jimenez' },
  { team: 'LAN', name: 'Bryan Owens' },
  { team: 'LAN', name: 'Dallas Allen' },
  // Miami Mirage
  { team: 'MIA', name: 'Tommy Hernandez' },
  { team: 'MIA', name: 'Cam Smith' },
  { team: 'MIA', name: 'Jeremy Adams' },
  { team: 'MIA', name: 'Jackson Albers' },
  { team: 'MIA', name: 'John Paul Gunn' },
  { team: 'MIA', name: 'Mike Stiles' },
  { team: 'MIA', name: 'Sean Hornberger' },
  // New York Green Apples
  { team: 'NYG', name: 'Will Smithey' },
  { team: 'NYG', name: 'Gus Skibbe' },
  { team: 'NYG', name: 'Brendan Dudas' },
  { team: 'NYG', name: 'Reid Werner' },
  { team: 'NYG', name: 'Tyler Flakne' },
  { team: 'NYG', name: 'Sam Skibbe' },
  { team: 'NYG', name: 'James Kline' },
  // Philadelphia Wiffle Club
  { team: 'PHI', name: 'Josh Wheeler' },
  { team: 'PHI', name: 'Dominic Citrowske' },
  { team: 'PHI', name: 'Chandler Melton' },
  { team: 'PHI', name: 'Kaiden Rice' },
  { team: 'PHI', name: 'Spencer Foss' },
  { team: 'PHI', name: 'Brody Livingston' },
  { team: 'PHI', name: 'Jimmy Cole' },
  // San Diego Orcas
  { team: 'SDO', name: 'Brett Caladie' },
  { team: 'SDO', name: 'Torin Roth' },
  { team: 'SDO', name: 'Jack Roth' },
  { team: 'SDO', name: 'Brandon Crone' },
  { team: 'SDO', name: 'Trevor Bauer' },
  { team: 'SDO', name: 'Cael Foreman' },
  { team: 'SDO', name: 'Connor Smith' },
];

// Name aliases — maps any-known-form-of-a-player's-name to their canonical
// name. Used to merge same-person variants from the API, the bio CSV, and
// the canonical roster. Keys are normalized (lowercase + collapsed spaces);
// values are the canonical display name.
const NAME_ALIASES_RAW = {
  // Mychal Witty Jr. is referred to as "Myc Witty" in the API + UI
  'mychal witty jr.': 'Myc Witty',
  'mychal witty jr':  'Myc Witty',
  'mychal witty':     'Myc Witty',
  // Edward Martinez also goes by Nick / Eddie
  'nick martinez':    'Edward Martinez',
  'eddie martinez':   'Edward Martinez',
  'ed martinez':      'Edward Martinez',
};
const _normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
export const NAME_ALIASES = Object.fromEntries(
  Object.entries(NAME_ALIASES_RAW).map(([k, v]) => [_normName(k), v])
);

// Resolve any name (alias or canonical) to its canonical form. Falls
// through unchanged if not aliased.
export function resolveCanonicalName(name) {
  return NAME_ALIASES[_normName(name)] || name;
}

// Quick membership test against the canonical roster — accepts aliases
// transparently so callers don't have to normalize first.
const _canonicalNameSet = new Set(CANONICAL_ROSTER_2026.map(p => _normName(p.name)));
export function isOnActiveRoster(name) {
  if (!name) return false;
  const canonical = resolveCanonicalName(name);
  return _canonicalNameSet.has(_normName(canonical));
}

// What team is this player on per the canonical roster? Honors aliases.
const _canonicalTeamByName = new Map(CANONICAL_ROSTER_2026.map(p => [_normName(p.name), p.team]));
export function canonicalTeamOf(name) {
  const canonical = resolveCanonicalName(name);
  return _canonicalTeamByName.get(_normName(canonical)) || null;
}

export function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Returns the full roster for a team — combines stats data with media-referenced
// players (so a player with uploaded assets appears even if they haven't played).
// mediaList is an optional array of stored media (from getAllMedia) to cross-reference.
// Build a master players directory by combining API team rosters, batting/pitching
// stats, media files, and manually-added players. Returns one entry per
// (team, lastName).
export async function getAllPlayersDirectory(mediaList = [], manualPlayers = []) {
  // Identity = team + first-initial + lastname. Handles same-lastname players
  // on one team (e.g. Logan Rose / Carson Rose). Callers that don't supply a
  // first initial (legacy media, some manual entries) fall into a "" bucket;
  // we reconcile those back to the initialled entry whenever possible.
  const registry = new Map(); // `${team}_${FI}_${UPPER_LASTNAME}` → entry
  const key = (team, firstInitial, lastName) =>
    `${team}_${(firstInitial || '').toUpperCase()}_${String(lastName || '').toUpperCase()}`;

  const upsert = (team, name, patch) => {
    if (!team || !name) return;
    const lastName = name.split(' ').pop();
    const firstName = name.split(' ').slice(0, -1).join(' ');
    const firstInitial = firstName.charAt(0).toUpperCase();
    const k = key(team, firstInitial, lastName);
    const existing = registry.get(k) || {
      name: '', firstName: '', firstInitial, lastName,
      team, num: '', hasStats: false, hasMedia: false, hasManual: false, isPitcher: false, isBatter: false,
    };
    registry.set(k, {
      ...existing,
      name: existing.name || name,
      firstName: existing.firstName || firstName,
      firstInitial: existing.firstInitial || firstInitial,
      ...patch,
    });
  };

  // Batting stats (cached)
  for (const p of (_battingCache || [])) {
    upsert(p.team, p.name, { hasStats: true, isBatter: true });
  }
  // Pitching stats (cached)
  for (const p of (_pitchingCache || [])) {
    upsert(p.team, p.name, { hasStats: true, isPitcher: true });
  }
  // Team roster endpoint cache (career stats)
  for (const [teamId, cached] of _rosterCache.entries()) {
    for (const p of cached.roster) {
      upsert(teamId, p.name, {
        hasStats: true,
        isBatter: p.isBatter || undefined,
        isPitcher: p.isPitcher || undefined,
      });
    }
  }
  // Media files — prefer (initial + lastname) key; fall back to lastname-only
  // match so legacy records attach to an existing initialled entry instead of
  // creating a phantom duplicate.
  for (const m of mediaList) {
    if (!m.team || !m.player || m.player === 'TEAM' || m.player === 'LEAGUE') continue;
    if (m.scope === 'team') continue; // team-scoped assets aren't players
    const titleLast = m.player.charAt(0) + m.player.slice(1).toLowerCase();
    const FI = (m.firstInitial || '').toUpperCase();
    let matched = null;
    if (FI) {
      matched = registry.get(key(m.team, FI, m.player));
    }
    if (!matched) {
      // Legacy record (no initial) or no exact match — try to find a single
      // initialled entry with matching team + lastname. If there's exactly
      // one, attach to it; otherwise bucket under "" (ambiguous).
      const siblings = [...registry.values()].filter(
        e => e.team === m.team && e.lastName.toUpperCase() === m.player.toUpperCase()
      );
      if (siblings.length === 1) matched = siblings[0];
    }
    if (matched) {
      matched.hasMedia = true;
      if (!matched.num && m.num) matched.num = m.num;
    } else {
      upsert(m.team, FI ? `${FI}. ${titleLast}` : titleLast, { hasMedia: true, num: m.num || '' });
    }
  }
  // Manual players
  for (const p of manualPlayers) {
    const FI = (p.firstName || '').charAt(0).toUpperCase();
    const k = key(p.team, FI, p.lastName);
    const existing = registry.get(k);
    if (existing) {
      registry.set(k, {
        ...existing,
        hasManual: true, manualId: p.id,
        num: existing.num || p.num || '',
        firstName: existing.firstName || p.firstName || '',
        firstInitial: existing.firstInitial || FI,
      });
    } else {
      upsert(p.team, p.name || p.lastName, { hasManual: true, manualId: p.id, num: p.num || '' });
    }
  }

  return Array.from(registry.values()).sort((a, b) => {
    if (a.team !== b.team) return a.team.localeCompare(b.team);
    return a.lastName.localeCompare(b.lastName);
  });
}

export function getTeamRoster(teamId, mediaList = [], manualPlayers = []) {
  const roster = new Map(); // key: canonicalName (uppercased) → player object

  // Build the override index — canonical name → manual_players.team.
  // Aliases are folded so "Mychal Witty Jr." override on LAN matches
  // the API's "Myc Witty" record.
  const overrideByName = new Map();
  for (const p of manualPlayers) {
    if (!p?.team) continue;
    const raw = (p.name || `${p.firstName || ''} ${p.lastName || ''}`).trim();
    if (!raw) continue;
    const canonical = resolveCanonicalName(raw);
    overrideByName.set(_normName(canonical), p.team);
  }

  // Player belongs on this team if (a) the canonical roster says so, OR
  // (b) an override puts them here, OR (c) no canonical/override info
  // and the API matches. Combined with the active-roster filter below,
  // this naturally drops free agents and dev-league residue.
  const belongsHere = (apiPlayer) => {
    const canonical = resolveCanonicalName(apiPlayer.name);
    const key = _normName(canonical);
    if (overrideByName.has(key)) return overrideByName.get(key) === teamId;
    const canonicalTeam = canonicalTeamOf(canonical);
    if (canonicalTeam) return canonicalTeam === teamId;
    return apiPlayer.team === teamId;
  };

  // Active-roster filter — anyone not in the canonical 70 is hidden
  // (free agents, retired, dev-league, cross-league residue).
  const activeOnly = (apiPlayer) => isOnActiveRoster(apiPlayer.name);

  const addStatPlayer = (p, statType) => {
    const lastName = p.name.split(' ').pop();
    const key = lastName.toUpperCase();
    const existing = roster.get(key);
    if (existing) {
      existing.stats.push(statType);
      if (!existing.num && p.num) existing.num = p.num;
    } else {
      roster.set(key, {
        name: p.name,
        firstName: p.name.split(' ').slice(0, -1).join(' '),
        lastName,
        team: teamId,
        num: p.num || '',
        stats: [statType],
        hasStats: true,
        hasMedia: false,
      });
    }
  };

  // Players with stats — honoring overrides + active-roster filter
  (_battingCache || BATTING_FALLBACK)
    .filter(activeOnly)
    .filter(belongsHere)
    .forEach(p => addStatPlayer(p, 'batting'));
  (_pitchingCache || PITCHING_FALLBACK)
    .filter(activeOnly)
    .filter(belongsHere)
    .forEach(p => addStatPlayer(p, 'pitching'));

  // Manual players assigned to this team but with no API stats yet
  // (e.g. a brand-new FA signing).
  for (const m of manualPlayers) {
    if (m.team !== teamId) continue;
    const lastName = m.lastName || (m.name || '').split(' ').pop();
    if (!lastName) continue;
    const key = lastName.toUpperCase();
    if (roster.has(key)) continue;
    roster.set(key, {
      name: m.name || `${m.firstName || ''} ${lastName}`.trim(),
      firstName: m.firstName || '',
      lastName,
      team: teamId,
      num: m.num || '',
      stats: [],
      hasStats: false,
      hasMedia: false,
    });
  }

  // Add players referenced only by media
  mediaList
    .filter(m => m.team === teamId && m.player && m.player !== 'TEAM' && m.player !== 'LEAGUE')
    .forEach(m => {
      const key = m.player.toUpperCase();
      const existing = roster.get(key);
      if (existing) {
        existing.hasMedia = true;
        if (!existing.num && m.num) existing.num = m.num;
      } else {
        // Title case last name for display
        const lastName = m.player.charAt(0) + m.player.slice(1).toLowerCase();
        roster.set(key, {
          name: lastName,
          firstName: '',
          lastName,
          team: teamId,
          num: m.num || '',
          stats: [],
          hasStats: false,
          hasMedia: true,
        });
      }
    });

  // Mark hasMedia on stat players based on media matches
  mediaList
    .filter(m => m.team === teamId && m.player)
    .forEach(m => {
      const key = m.player.toUpperCase();
      const existing = roster.get(key);
      if (existing) existing.hasMedia = true;
    });

  return Array.from(roster.values()).sort((a, b) => a.lastName.localeCompare(b.lastName));
}

// Parse a player slug. Supports two forms:
//   "rose"     → { firstInitial: '', lastName: 'rose' }         (legacy)
//   "c-rose"   → { firstInitial: 'C', lastName: 'rose' }        (disambiguated)
// When a player's actual last name is hyphenated (e.g. "smith-jones"), the
// legacy parse would swallow the first segment as an initial. We guard
// against that by only treating the first segment as an initial when it's a
// single letter.
function parsePlayerSlug(slug) {
  const norm = slugify(slug);
  const parts = norm.split('-');
  if (parts.length >= 2 && parts[0].length === 1 && /^[a-z]$/.test(parts[0])) {
    return { firstInitial: parts[0].toUpperCase(), lastName: parts.slice(1).join('-') };
  }
  return { firstInitial: '', lastName: norm };
}
export { parsePlayerSlug };

// Fetch detailed player info for the player page.
// Disambiguates between same-lastname players using a first-initial prefix in
// the slug (e.g. "c-rose" vs "l-rose"). Legacy slugs without an initial still
// resolve: if there's exactly one player with that lastname we return them;
// if there are multiple, we return the first and flag `ambiguous: true` so
// the UI can warn.
export function getPlayerByTeamLastName(teamId, lastNameSlug, manualPlayers = []) {
  const { firstInitial: WANT_FI, lastName: LN_NORM } = parsePlayerSlug(lastNameSlug);

  const matchLast = (name) => slugify(String(name || '').split(' ').pop()) === LN_NORM;
  const matchFullSlug = (name) => {
    const n = String(name || '').trim();
    const fi = n.charAt(0).toUpperCase();
    const ln = slugify(n.split(' ').pop());
    return WANT_FI ? (fi === WANT_FI && ln === LN_NORM) : (ln === LN_NORM);
  };

  // Gather all candidates for this team/lastname across every source.
  //
  // Key wrinkle: a player in `manualPlayers` whose team !== teamId has
  // been TRADED to another team (manual_players is the override layer).
  // So when assembling the candidate set for THIS teamId we:
  //   - allow batting/pitching/roster matches whose name doesn't have
  //     an override pointing them somewhere else
  //   - allow manual matches whose team === teamId (they live here now)
  // The result: visiting /teams/PHI/players/livingston resolves to the
  // traded Livingston instead of the original DAL one.
  const overrideByName = new Map();
  for (const p of manualPlayers) {
    if (!p?.team) continue;
    const raw = (p.name || `${p.firstName || ''} ${p.lastName || ''}`).trim();
    if (!raw) continue;
    const canonical = resolveCanonicalName(raw);
    overrideByName.set(_normName(canonical), p.team);
  }
  // Effective team for any API name: canonical-roster team beats API
  // team, override beats canonical-roster team. Returns null if the
  // player is unknown to us (free agent, dev league, etc).
  const effectiveTeamFor = (apiName) => {
    const canonical = resolveCanonicalName(apiName);
    const key = _normName(canonical);
    if (overrideByName.has(key)) return overrideByName.get(key);
    return canonicalTeamOf(canonical);
  };
  const belongsToThisTeam = (apiPlayer) => {
    const eff = effectiveTeamFor(apiPlayer.name);
    if (eff) return eff === teamId;
    return apiPlayer.team === teamId;
  };

  const battingAll = (_battingCache || BATTING_FALLBACK)
    .filter(p => matchLast(p.name))
    .filter(p => isOnActiveRoster(p.name) && belongsToThisTeam(p));
  const pitchingAll = (_pitchingCache || PITCHING_FALLBACK)
    .filter(p => matchLast(p.name))
    .filter(p => isOnActiveRoster(p.name) && belongsToThisTeam(p));
  const rosterCached = _rosterCache.get(teamId);
  const rosterAll = (rosterCached?.roster || []).filter(p => matchLast(p.name));
  const manualAll = manualPlayers.filter(p => p.team === teamId && matchLast(p.name || p.lastName));
  const rankingAll = (_rankingsCache || []).filter(r => matchLast(r.name));

  // Narrow by first-initial when requested.
  const byInitial = (arr) => WANT_FI
    ? arr.filter(p => String(p.name || p.lastName || '').trim().charAt(0).toUpperCase() === WANT_FI)
    : arr;

  const battingMatches = byInitial(battingAll);
  const pitchingMatches = byInitial(pitchingAll);
  const rosterMatches = byInitial(rosterAll);
  const manualMatches = byInitial(manualAll);
  const rankingMatches = byInitial(rankingAll);

  // Count unique candidates on this team by full-name — detects legacy slug
  // collisions so the UI can warn.
  const candidateNames = new Set();
  for (const p of [...battingAll, ...pitchingAll, ...rosterAll, ...manualAll]) {
    if (p.name) candidateNames.add(p.name);
  }
  const ambiguous = !WANT_FI && candidateNames.size > 1;

  const batting = battingMatches[0] || battingAll[0] || null;
  const pitching = pitchingMatches[0] || pitchingAll[0] || null;
  const rosterPlayer = rosterMatches[0] || rosterAll[0] || null;
  const manual = manualMatches[0] || manualAll[0] || null;

  const source = batting || pitching || rosterPlayer || manual;
  if (!source && rankingMatches.length === 0 && rankingAll.length === 0) return null;

  // ─── Ranking match — prefer EXACT full-name equality when we know the
  // source player's name, so same-initial siblings (Brody + Bryson both
  // "B. Livingston") don't inherit each other's ranking record. First
  // initial alone isn't enough because both "B.Livingston"s match.
  const sourceName = source?.name || '';
  const exactRankingMatch = sourceName
    ? rankingAll.find(r => r.name === sourceName)
    : null;
  const ranking = exactRankingMatch || rankingMatches[0] || (rankingAll.length === 1 ? rankingAll[0] : null);

  if (!source && !ranking) return null;

  const name = source?.name || ranking?.name || '';
  const lastName = name.split(' ').pop();
  const firstName = name.split(' ').slice(0, -1).join(' ');

  return {
    name,
    firstName,
    lastName,
    firstInitial: firstName.charAt(0).toUpperCase(),
    team: teamId,
    num: source?.num || '',
    position: manual?.position || null,
    // Admin-chosen profile pic (db/005). NULL → fall back to the default
    // HEADSHOT/PORTRAIT heuristic in PlayerPage.
    profileMediaId: manual?.profile_media_id || manual?.profileMediaId || null,
    batting: batting || null,
    pitching: pitching || null,
    ranking: ranking || null,
    roster: rosterPlayer || null,
    manual: manual || null,
    // Vitals — sourced from the manual_players record if present. See
    // db/004_player_vitals.sql. All fields are optional so the PlayerPage
    // renders a "—" placeholder when missing.
    vitals: manual ? {
      heightIn:   manual.height_in ?? manual.heightIn ?? null,
      weightLbs:  manual.weight_lbs ?? manual.weightLbs ?? null,
      birthdate:  manual.birthdate ?? null,
      bats:       manual.bats ?? null,
      throws:     manual.throws ?? null,
      birthplace: manual.birthplace ?? null,
      status:     manual.status ?? 'active',
      nickname:   manual.nickname ?? null,
    } : null,
    // Player-facing extras (db/006) — top-level so the PlayerHero can
    // grab them without poking through `vitals`.
    instagramHandle: manual?.instagram_handle ?? manual?.instagramHandle ?? null,
    funFacts:        manual?.fun_facts ?? manual?.funFacts ?? null,
    isRookie:        Boolean(manual?.is_rookie ?? manual?.isRookie ?? false),
    ambiguous,
    candidateCount: candidateNames.size,
  };
}

// Build the canonical disambiguated slug for a player.
export function playerSlug(player) {
  if (!player) return '';
  const fn = player.firstName || String(player.name || '').split(' ').slice(0, -1).join(' ');
  const ln = player.lastName || String(player.name || '').split(' ').pop();
  const fi = (fn || '').charAt(0).toLowerCase();
  const lnSlug = slugify(ln);
  return fi ? `${fi}-${lnSlug}` : lnSlug;
}

// ─── CONTENT SUGGESTIONS ENGINE ─────────────────────────────────────────────
export function generateContentSuggestions(batting, pitching, rankings) {
  const b = batting || _battingCache || BATTING_FALLBACK;
  const p = pitching || _pitchingCache || PITCHING_FALLBACK;
  const suggestions = [];

  // Batting leader by AVG
  const avgLeader = [...b].sort((a, bb) => parseFloat(bb.avg) - parseFloat(a.avg))[0];
  if (avgLeader) {
    suggestions.push({
      id: 'avg-leader', type: 'stat-spotlight',
      headline: `${avgLeader.name} leads the league with ${avgLeader.avg} AVG`,
      description: 'Create a stat card for the top batter in BLW',
      team: avgLeader.team, templateId: 'player-stat',
      prefill: { playerName: avgLeader.name, number: avgLeader.num, statLine: `AVG ${avgLeader.avg} | OPS+ ${avgLeader.ops_plus} | OBP ${avgLeader.obp} | SLG ${avgLeader.slg}` },
    });
  }

  // OPS+ leader
  const opsLeader = b[0];
  if (opsLeader && opsLeader.name !== avgLeader?.name) {
    suggestions.push({
      id: 'ops-leader', type: 'stat-spotlight',
      headline: `${opsLeader.name} has a ${opsLeader.ops_plus} OPS+ — league best`,
      description: 'Spotlight the OPS+ king',
      team: opsLeader.team, templateId: 'player-stat',
      prefill: { playerName: opsLeader.name, number: opsLeader.num, statLine: `OPS+ ${opsLeader.ops_plus} | AVG ${opsLeader.avg} | HR ${opsLeader.hr} | OBP ${opsLeader.obp}` },
    });
  }

  // FIP leader
  const fipLeader = p[0];
  if (fipLeader) {
    const fipVal = typeof fipLeader.fip === 'number' ? fipLeader.fip.toFixed(2) : fipLeader.fip;
    suggestions.push({
      id: 'fip-leader', type: 'stat-spotlight',
      headline: `${fipLeader.name} has a ${fipVal} FIP — pitching dominance`,
      description: 'The best pitcher in the league deserves a spotlight card',
      team: fipLeader.team, templateId: 'player-stat',
      prefill: { playerName: fipLeader.name, number: fipLeader.num, statLine: `FIP ${fipVal} | IP ${fipLeader.ip} | K/4 ${fipLeader.k4} | W-L ${fipLeader.w}-${fipLeader.l}` },
    });
  }

  // Top team streak
  const topTeam = TEAMS[0];
  if (topTeam && parseFloat(topTeam.pct) > 0.800) {
    suggestions.push({
      id: 'top-team-streak', type: 'streak',
      headline: `${topTeam.name} are ${topTeam.record} — create a streak graphic`,
      description: 'The #1 team in BLW is dominating. Celebrate it.',
      team: topTeam.id, templateId: 'standings', prefill: {},
    });
  }

  // Undefeated pitcher
  const undefeated = p.find(x => x.l === 0 && x.w >= 3);
  if (undefeated) {
    const fipVal = typeof undefeated.fip === 'number' ? undefeated.fip.toFixed(2) : undefeated.fip;
    suggestions.push({
      id: 'undefeated-pitcher', type: 'milestone',
      headline: `${undefeated.name} is ${undefeated.w}-0 — undefeated spotlight`,
      description: 'Perfect record on the mound — highlight the achievement',
      team: undefeated.team, templateId: 'player-stat',
      prefill: { playerName: undefeated.name, number: undefeated.num, statLine: `W-L ${undefeated.w}-0 | FIP ${fipVal} | IP ${undefeated.ip} | K/4 ${undefeated.k4}` },
    });
  }

  // HR leader
  const hrLeader = [...b].sort((a, bb) => (bb.hr || 0) - (a.hr || 0))[0];
  if (hrLeader && hrLeader.hr > 0) {
    suggestions.push({
      id: 'hr-leader', type: 'milestone',
      headline: `${hrLeader.name} leads BLW with ${hrLeader.hr} HR`,
      description: 'Power numbers are rare in wiffle ball — make it count',
      team: hrLeader.team, templateId: 'player-stat',
      prefill: { playerName: hrLeader.name, number: hrLeader.num, statLine: `HR ${hrLeader.hr} | AVG ${hrLeader.avg} | OPS+ ${hrLeader.ops_plus} | SLG ${hrLeader.slg}` },
    });
  }

  // Biggest rank climber (rankings)
  if (rankings?.length) {
    const climber = [...rankings].sort((a, bb) => bb.rankChange - a.rankChange)[0];
    if (climber && climber.rankChange > 3) {
      suggestions.push({
        id: 'rank-climber', type: 'leader-change',
        headline: `${climber.name} surged +${climber.rankChange} spots to #${climber.currentRank}`,
        description: 'Biggest rank mover this week — highlight the climb',
        team: 'BLW', templateId: 'player-stat',
        prefill: { playerName: climber.name, statLine: `Rank #${climber.currentRank} | +${climber.rankChange} | ${climber.totalPoints} pts` },
      });
    }
  }

  // Leaderboard graphics
  suggestions.push({ id: 'batting-leaderboard', type: 'leader-change', headline: 'Updated Batting Leaders graphic', description: 'Post the latest OPS+ leaderboard', team: 'BLW', templateId: 'batting-leaders', prefill: {} });
  suggestions.push({ id: 'pitching-leaderboard', type: 'leader-change', headline: 'Updated Pitching Leaders graphic', description: 'Post the latest FIP leaderboard', team: 'BLW', templateId: 'pitching-leaders', prefill: {} });

  return suggestions;
}
