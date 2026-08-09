// 2026 BLW Regular Season Schedule.
//
// Source: master pasted the full schedule on 2026-05-17. Every game is
// at Assembly Studios in Atlanta, GA, on YouTube; the first slate of
// each game day also airs on Fubo + regional sports networks.
//
// Conventions:
//   - Internal team_ids are used (ATL — migrated from legacy SDO in v4.17.0; the Atlanta Ballers' stable
//     id even after the v4.8.3 rebrand — see data.js).
//   - Times are Eastern. Stored as 24h "HH:MM" strings.
//   - All games are neutral-site (single-venue tournament format) so
//     team1/team2 are listed in the order the master provided them
//     rather than home/away.
//   - season: '2026' tags every row so Phase 2's season-archive flow
//     can filter by season without retro-fitting.
//
// Mutability: this array is read-only at runtime. Edits ship as a code
// change (commit + deploy). Future Phase 2 work may move this to the
// cloud-sync store so master can edit through the UI.

export const SCHEDULE = [
  {
    id: '2026-06-07',
    date: '2026-06-07',
    season: '2026',
    type: 'regular',
    venue: 'Assembly Studios',
    venueCity: 'Atlanta, GA',
    broadcast: 'YouTube',
    firstSlateAlso: 'Fubo + regional sports networks',
    games: [
      { time: '13:00', team1: 'ATL', team2: 'LAN' },
      { time: '13:45', team1: 'BOS', team2: 'PHI' },
      { time: '14:30', team1: 'ATL', team2: 'MIA' },
      { time: '15:15', team1: 'BOS', team2: 'LAN' },
      { time: '17:30', team1: 'ATL', team2: 'PHI' },
      { time: '18:15', team1: 'LAN', team2: 'MIA' },
      { time: '19:00', team1: 'BOS', team2: 'ATL' },
      { time: '19:45', team1: 'LAN', team2: 'BOS' },
    ],
  },
  {
    id: '2026-06-14',
    date: '2026-06-14',
    season: '2026',
    type: 'regular',
    venue: 'Assembly Studios',
    venueCity: 'Atlanta, GA',
    broadcast: 'YouTube',
    firstSlateAlso: 'Fubo + regional sports networks',
    games: [
      // v4.22.0: 13:00 & 13:45 corrected to match the GSS results — CHI and
      // NYG were swapped between these two slots, so their finals weren't
      // attaching on the schedule (CHI 3–2 PHI at 1:00, NYG 3–1 PHI at 1:45).
      { time: '13:00', team1: 'CHI', team2: 'PHI' },
      { time: '13:45', team1: 'PHI', team2: 'NYG' },
      { time: '14:30', team1: 'MIA', team2: 'CHI' },
      { time: '15:15', team1: 'MIA', team2: 'NYG' },
      { time: '17:30', team1: 'CHI', team2: 'NYG' },
      { time: '18:15', team1: 'MIA', team2: 'CHI' },
      { time: '19:00', team1: 'PHI', team2: 'NYG' },
      { time: '19:45', team1: 'PHI', team2: 'MIA' },
    ],
  },
  {
    id: '2026-06-28',
    date: '2026-06-28',
    season: '2026',
    type: 'regular',
    venue: 'Assembly Studios',
    venueCity: 'Atlanta, GA',
    broadcast: 'YouTube',
    firstSlateAlso: 'Fubo + regional sports networks',
    games: [
      { time: '13:00', team1: 'LAN', team2: 'AZS' },
      { time: '13:45', team1: 'LV',  team2: 'DAL' },
      { time: '14:30', team1: 'AZS', team2: 'LV' },
      { time: '15:15', team1: 'DAL', team2: 'BOS' },
      { time: '17:30', team1: 'DAL', team2: 'LAN' },
      { time: '18:15', team1: 'AZS', team2: 'LV' },
      { time: '19:00', team1: 'AZS', team2: 'DAL' },
      { time: '19:45', team1: 'LV',  team2: 'BOS' },
    ],
  },
  {
    // Times/order corrected to the master's 2026-07-12 schedule graphic. Same
    // six matchups as before, re-slotted — the date+time is the key that
    // attaches GSS finals, so the slots must match. No broadcast set for this
    // day (chip is omitted when broadcast is absent).
    id: '2026-07-12',
    date: '2026-07-12',
    season: '2026',
    type: 'regular',
    venue: 'Assembly Studios',
    venueCity: 'Atlanta, GA',
    games: [
      { time: '13:00', team1: 'LV',  team2: 'ATL' },
      { time: '13:45', team1: 'CHI', team2: 'AZS' },
      { time: '17:30', team1: 'DAL', team2: 'ATL' },
      { time: '18:15', team1: 'NYG', team2: 'AZS' },
      // v5.4.0: these two slots were swapped relative to the GSS feed, so
      // neither final attached and the page still showed them as upcoming
      // (CHI 3–0 DAL is the 7:00 game, NYG 2–0 LV the 7:45). The date+time key
      // is what binds a scheduled slot to its result — a slot in the wrong
      // order silently reads as an unplayed game forever.
      { time: '19:00', team1: 'CHI', team2: 'DAL' },
      { time: '19:45', team1: 'NYG', team2: 'LV' },
    ],
  },
  {
    // ─── POSTSEASON ─────────────────────────────────────────────────────────
    // v5.4.0. `type: 'postseason'` is load-bearing, not decoration: data.js
    // derives POSTSEASON_DATES from it, and that is what keeps these games out
    // of the regular-season standings, playoff odds and clinch model. Before
    // this slate was tagged, the eight games below were counting as regular-
    // season results (Dallas read 10 GP against a 6-game regular season).
    //
    // Format: six teams. LAN and NYG earned byes; the other four met in
    // play-ins, and each play-in winner then played the bye team in a
    // best-of-three semifinal. Times/orders are taken from the GSS feed, since
    // `date + time` is the key the live final scores attach on.
    id: '2026-07-26',
    date: '2026-07-26',
    season: '2026',
    type: 'postseason',
    venue: 'Assembly Studios',
    venueCity: 'Atlanta, GA',
    games: [
      { time: '13:00', team1: 'DAL', team2: 'PHI', round: 'Play-in' },
      { time: '13:45', team1: 'DAL', team2: 'LAN', round: 'Semifinal', gameNo: 1 },
      { time: '14:30', team1: 'LAN', team2: 'DAL', round: 'Semifinal', gameNo: 2 },
      { time: '15:15', team1: 'DAL', team2: 'LAN', round: 'Semifinal', gameNo: 3 },
      { time: '17:30', team1: 'CHI', team2: 'LV',  round: 'Play-in' },
      { time: '18:15', team1: 'CHI', team2: 'NYG', round: 'Semifinal', gameNo: 1 },
      { time: '19:00', team1: 'NYG', team2: 'CHI', round: 'Semifinal', gameNo: 2 },
      { time: '19:45', team1: 'CHI', team2: 'NYG', round: 'Semifinal', gameNo: 3 },
    ],
  },
  {
    // Championship. NYG beat DAL 5-0 for the 2026 title.
    //
    // This slate MUST stay tagged `type: 'postseason'` — data.js derives
    // POSTSEASON_DATES from that tag, and it is the only thing keeping this
    // game out of the regular-season standings. Untagged, New York reads 7-0
    // in a 6-game regular season.
    id: '2026-08-07',
    date: '2026-08-07',
    season: '2026',
    type: 'postseason',
    venue: 'Assembly Studios',
    venueCity: 'Atlanta, GA',
    games: [
      { time: '15:00', team1: 'DAL', team2: 'NYG', round: 'Championship' },
    ],
  },
];


// ─── Helpers ────────────────────────────────────────────────────────────────

// Parse an ISO date string ("YYYY-MM-DD") as a Date at local midnight.
// Avoids the UTC-interpretation gotcha that new Date('2026-06-07') hits.
function toLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Convert a 24h "HH:MM" string into 12h display: "HH:MM" → "1:00 PM ET"
export function formatGameTime(time24, opts = {}) {
  if (!time24) return '';
  const [hStr, mStr] = time24.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10) || 0;
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h === 0 ? 12 : (h > 12 ? h - 12 : h);
  const mm = String(m).padStart(2, '0');
  return opts.noPeriod
    ? `${display}:${mm}`
    : `${display}:${mm} ${period}${opts.tz === false ? '' : ' ET'}`;
}

// Human-readable game day label: "Sunday, June 7"
export function formatGameDayDate(dateStr, opts = {}) {
  const d = toLocalDate(dateStr);
  if (!d || isNaN(d)) return dateStr || '';
  const fmt = opts.short
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { weekday: 'long', month: 'long', day: 'numeric' };
  return d.toLocaleDateString('en-US', fmt);
}

// All game days, sorted ascending by date.
export function getAllGameDays(season) {
  const filtered = season
    ? SCHEDULE.filter(g => g.season === season)
    : SCHEDULE;
  return [...filtered].sort((a, b) => a.date.localeCompare(b.date));
}

// Game days on or after `now` (defaults to today). Used by the dashboard
// "next 4 game days" widget and the team-page upcoming-games card.
export function getUpcomingGameDays(now = new Date()) {
  const todayKey = toIsoDate(now);
  return getAllGameDays().filter(g => g.date >= todayKey);
}

// All game days that include `teamId`, in date order. Each entry is the
// game day enriched with `teamGames` — just the games featuring this team.
export function getTeamSchedule(teamId, opts = {}) {
  if (!teamId) return [];
  const all = opts.season ? getAllGameDays(opts.season) : getAllGameDays();
  return all
    .map(gd => {
      const teamGames = gd.games.filter(g => g.team1 === teamId || g.team2 === teamId);
      if (teamGames.length === 0) return null;
      return { ...gd, teamGames };
    })
    .filter(Boolean);
}

// Next game day for a team — first scheduled date with at least one
// of their games. Returns null if the team has no upcoming games.
export function getNextGameDay(teamId, now = new Date()) {
  if (!teamId) return null;
  const todayKey = toIsoDate(now);
  const team = getTeamSchedule(teamId);
  return team.find(gd => gd.date >= todayKey) || null;
}

// Game day matching a specific ISO date ("YYYY-MM-DD"). Used by the
// content calendar to look up "is this calendar cell a game day?"
export function getGameDayByDate(dateStr) {
  if (!dateStr) return null;
  return SCHEDULE.find(g => g.date === dateStr) || null;
}

// Game days within a [start, end] inclusive date range. Used by the
// content calendar to fetch the visible 4-week window in one pass.
export function getGameDaysInRange(startDate, endDate) {
  const startKey = startDate instanceof Date ? toIsoDate(startDate) : startDate;
  const endKey   = endDate   instanceof Date ? toIsoDate(endDate)   : endDate;
  return SCHEDULE.filter(g => g.date >= startKey && g.date <= endKey);
}

// Number of games featuring a given team across the entire season.
// Used for team-page "X games this season" stat.
export function getTeamGameCount(teamId, season) {
  if (!teamId) return 0;
  const days = season ? getAllGameDays(season) : getAllGameDays();
  return days.reduce((n, gd) =>
    n + gd.games.filter(g => g.team1 === teamId || g.team2 === teamId).length, 0);
}

// Format a Date as YYYY-MM-DD using local time (NOT toISOString, which
// converts to UTC and shifts the day for west-of-UTC time zones).
export function toIsoDate(d) {
  if (!(d instanceof Date)) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
