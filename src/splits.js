// ─── SEASON SPLITS: regular season / postseason / total ─────────────────────
//
// WHY THIS FILE EXISTS
// The GSS league leaderboards (`/leagues/3/batting-stats`, `pitching-stats`,
// `team-batting-stats`, `team-pitching-stats`) and the official standings are
// REGULAR SEASON ONLY — they stop at the last regular-season game day and never
// absorb playoff lines. Nothing in those payloads says so, and no query param
// splits them (`isPlayoff`, `startDate`, `gameId`, `tournamentId` are all
// silently ignored; only `seasonId` filters anything, and 2026 is one season).
//
// The ONE place the feed separates them is the per-player game log:
//   /api/gamelogs/{playerId}/leagues/{leagueId}/{batting|pitching}
// where every row carries an `isPlayoff` boolean. So every split in the app is
// derived here, from those logs.
//
// VERIFIED 2026-07-27 (all 10 teams, batting AND pitching): summing every
// player's `isPlayoff:false` lines reproduces `/leagues/3/team-batting-stats`
// and `/leagues/3/team-pitching-stats` EXACTLY — every PA, AB, H, HR, R, RBI,
// BB, K, IP-out. And the postseason remainder matches the per-game team hit
// totals in `/leagues/3/games` independently. Two independent reconciliations,
// so these aggregates can be trusted as the league's own numbers.
//
// WHAT CANNOT BE SPLIT: OPS+, wRC+, bWAR, ERA+, pWAR and FIP are league-
// adjusted indices computed upstream against the regular-season run
// environment. The game logs don't carry them and we can't rebuild them
// honestly, so they are null outside the regular-season split and the UI
// renders '—' rather than a fabricated number.

import { TEAMS, fetchBattingLeaders, fetchPitchingLeaders, fetchAllRosters, canonicalizeStatRows } from './data';

const GSS_BASE = '/api/gss';
const BLW_LEAGUE_ID = 3;
const CACHE_TTL = 5 * 60 * 1000;

// Browser fan-out concurrency. The league is ~70 players × 2 log kinds = ~140
// small JSON requests; at 8 in flight that lands in ~3s cold and is edge-cached
// (s-maxage on the proxy) after. Raising this doesn't help — the upstream, not
// the client, is the bottleneck.
const FAN_OUT = 8;

export const SPLITS = [
  { id: 'regular',    label: 'Regular season', short: 'REG' },
  { id: 'postseason', label: 'Postseason',     short: 'POST' },
  { id: 'total',      label: 'Total',          short: 'TOTAL' },
];
export const SPLIT_IDS = SPLITS.map(s => s.id);
export const DEFAULT_SPLIT = 'regular';
export const splitLabel = (id) => SPLITS.find(s => s.id === id)?.label || id;

// ─── Innings-pitched math ───────────────────────────────────────────────────
// GSS writes IP in baseball thirds as a STRING: "2.1" = 2⅓ innings = 7 outs.
// Decimal arithmetic on those strings is wrong (2.1 + 2.2 must be 5.0, not
// 4.3), so every aggregation converts to outs, sums, and converts back.

export function ipToOuts(ip) {
  const [whole, frac] = String(ip ?? '0').split('.');
  const w = parseInt(whole, 10) || 0;
  // A third-digit above 2 isn't valid IP notation; clamp rather than trust it.
  const f = Math.min(2, parseInt(frac, 10) || 0);
  return w * 3 + f;
}

export function outsToIp(outs) {
  const o = Math.max(0, Math.round(outs || 0));
  return `${Math.floor(o / 3)}.${o % 3}`;
}

// A BLW game is 3 innings, so every rate stat the league publishes is
// normalized per 3 innings (ERA, K/3, BB/3, WHIP's denominator excepted).
const INNINGS_PER_GAME = 3;
const perGame = (n, outs) => (outs > 0 ? (n / (outs / 3)) * INNINGS_PER_GAME : null);

// ─── Aggregation ────────────────────────────────────────────────────────────
// Output shapes deliberately MIRROR transformBatting/transformPitching in
// data.js (same keys, same string formatting) so every existing stat tile,
// table and card can render a split with no per-call-site changes.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function aggregateBatting(logs) {
  const rows = Array.isArray(logs) ? logs : [];
  if (rows.length === 0) return null;

  const s = { games: rows.length, pa: 0, ab: 0, runs: 0, hits: 0, singles: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, k: 0 };
  for (const g of rows) {
    s.pa      += num(g.plateAppearances);
    s.ab      += num(g.atBats);
    s.runs    += num(g.runs);
    s.hits    += num(g.hits);
    s.singles += num(g.singles);
    s.doubles += num(g.doubles);
    s.triples += num(g.triples);
    s.hr      += num(g.homeruns);
    s.rbi     += num(g.rbi);
    s.bb      += num(g.walks);
    s.k       += num(g.strikeouts);
  }

  // Game logs don't carry totalBases — rebuild it from the hit breakdown.
  const tb = s.singles + 2 * s.doubles + 3 * s.triples + 4 * s.hr;
  const avg = s.ab > 0 ? s.hits / s.ab : 0;
  const slg = s.ab > 0 ? tb / s.ab : 0;
  // OBP over plate appearances. GSS tracks no HBP and no sac flies in this
  // league (verified: PA - AB - BB === 0 across the whole 2026 season), so PA
  // is exactly AB + BB and this matches the upstream OBP to the third decimal.
  const obp = s.pa > 0 ? (s.hits + s.bb) / s.pa : 0;
  const babipDen = s.ab - s.k - s.hr;

  return {
    ...s,
    tb,
    avg: avg.toFixed(3),
    obp: obp.toFixed(3),
    slg: slg.toFixed(3),
    ops: (obp + slg).toFixed(3),
    iso: (slg - avg).toFixed(3),
    babip: (babipDen > 0 ? (s.hits - s.hr) / babipDen : 0).toFixed(3),
    kPct: s.pa > 0 ? (s.k / s.pa) * 100 : 0,
    bbPct: s.pa > 0 ? (s.bb / s.pa) * 100 : 0,
    risp: null,        // situational split, not carried on the game log
    // League-adjusted indices — see the header note. Never fabricated.
    ops_plus: null,
    wrcPlus: null,
    bwar: null,
  };
}

export function aggregatePitching(logs) {
  const rows = Array.isArray(logs) ? logs : [];
  if (rows.length === 0) return null;

  const s = { games: rows.length, w: 0, l: 0, saves: 0, hits: 0, runs: 0, hrAllowed: 0, bb: 0, k: 0, shutouts: 0 };
  let outs = 0;
  for (const g of rows) {
    outs += ipToOuts(g.inningsPitched);
    s.hits      += num(g.hits);
    s.runs      += num(g.runs);
    s.hrAllowed += num(g.homeruns);
    s.bb        += num(g.walks);
    s.k         += num(g.strikeouts);
    if (g.shutout) s.shutouts += 1;
    // `decision` is the log's own W/L/S attribution — the only place a
    // pitcher's record exists per game.
    const d = String(g.decision || '').toLowerCase();
    if (d === 'win') s.w += 1;
    else if (d === 'loss') s.l += 1;
    else if (d === 'save') s.saves += 1;
  }

  const ipInnings = outs / 3;
  const era = perGame(s.runs, outs);
  const whip = ipInnings > 0 ? (s.hits + s.bb) / ipInnings : null;

  return {
    ...s,
    outs,
    ip: outsToIp(outs),
    era: era != null ? era.toFixed(2) : '0.00',
    whip: whip != null ? whip.toFixed(2) : '0.00',
    k4: perGame(s.k, outs)?.toFixed(2) ?? '0.00',
    bb4: perGame(s.bb, outs)?.toFixed(2) ?? '0.00',
    hr4: perGame(s.hrAllowed, outs)?.toFixed(2) ?? '0.00',
    h3: perGame(s.hits, outs),
    kbb: s.bb > 0 ? (s.k / s.bb).toFixed(2) : (s.k > 0 ? '∞' : '0.00'),
    // League-adjusted / league-constant metrics — see the header note.
    fip: null,
    eraPlus: null,
    pwar: null,
    babip: null,
    gbPct: null,
  };
}

// Split one player's logs three ways. `total` is every game, NOT regular+post
// re-added, so rate stats are computed once over the full sample.
export function splitLogs(logs) {
  const rows = Array.isArray(logs) ? logs : [];
  return {
    regular: rows.filter(g => !g.isPlayoff),
    postseason: rows.filter(g => g.isPlayoff),
    total: rows,
  };
}

function aggregateSplits(logs, kind) {
  const agg = kind === 'pitching' ? aggregatePitching : aggregateBatting;
  const parts = splitLogs(logs);
  return { regular: agg(parts.regular), postseason: agg(parts.postseason), total: agg(parts.total) };
}

// ─── Fetching ───────────────────────────────────────────────────────────────

async function fetchLogPages(playerId, kind) {
  const items = [];
  let page = 1;
  // The endpoint pages at 10 and IGNORES ?pageSize, so `next` must be followed.
  // A deep playoff run already puts players at 10+ games, so this is live —
  // not defensive padding. The page ceiling is a runaway guard only.
  for (;;) {
    const res = await fetch(`${GSS_BASE}/gamelogs/${playerId}/leagues/${BLW_LEAGUE_ID}/${kind}?page=${page}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const batch = Array.isArray(data?.items) ? data.items : [];
    items.push(...batch);
    if (!data?.next || batch.length === 0 || page >= 20) break;
    page++;
  }
  return items;
}

const _playerLogCache = new Map(); // `${playerId}|${kind}` → { items, fetchedAt }

async function fetchLog(playerId, kind) {
  const key = `${playerId}|${kind}`;
  const hit = _playerLogCache.get(key);
  if (hit && (Date.now() - hit.fetchedAt) < CACHE_TTL) return hit.items;
  try {
    const items = await fetchLogPages(playerId, kind);
    _playerLogCache.set(key, { items, fetchedAt: Date.now() });
    return items;
  } catch (e) {
    console.warn(`[splits] game log failed for ${playerId}/${kind}`, e);
    return hit?.items || [];
  }
}

// One player's batting + pitching splits. Two requests — cheap enough to call
// straight from a player page.
export async function fetchPlayerSplits(playerId) {
  if (playerId == null) return null;
  const [batting, pitching] = await Promise.all([
    fetchLog(playerId, 'batting'),
    fetchLog(playerId, 'pitching'),
  ]);
  return {
    playerId,
    logs: { batting, pitching },
    batting: aggregateSplits(batting, 'batting'),
    pitching: aggregateSplits(pitching, 'pitching'),
  };
}

// Run `worker` over `items` with a bounded number in flight.
async function pooled(items, worker, limit = FAN_OUT) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

// Every player who appears anywhere in the league this season, with the team
// the feed attributes them to. The leaderboards alone miss players who have
// only appeared in the postseason (they were never in a regular-season stat
// row), and the rosters alone miss players tagged to a non-BLW team, so the
// union of both is what actually covers the league.
async function fetchLeaguePlayers() {
  const [batting, pitching, rosters] = await Promise.all([
    fetchBattingLeaders().catch(() => []),
    fetchPitchingLeaders().catch(() => []),
    fetchAllRosters().catch(() => []),
  ]);
  const byId = new Map();
  const add = (playerId, name, team) => {
    if (playerId == null) return;
    if (!byId.has(playerId)) byId.set(playerId, { playerId, name, team });
    else if (!byId.get(playerId).team && team) byId.get(playerId).team = team;
  };
  for (const r of rosters) add(r.playerId, r.name, r.team);
  for (const r of batting) add(r.playerId, r.name, r.team);
  for (const r of pitching) add(r.playerId, r.name, r.team);
  return [...byId.values()];
}

let _leagueCache = null;
let _leagueFetchedAt = 0;
let _leagueInFlight = null;

// League-wide splits: every player's batting + pitching aggregates for all
// three splits, plus the same rolled up per team. Heavy (~140 requests) but
// cached, de-duplicated across concurrent callers, and only triggered when a
// surface actually needs a non-regular split.
export async function fetchLeagueSplits() {
  if (_leagueCache && (Date.now() - _leagueFetchedAt) < CACHE_TTL) return _leagueCache;
  if (_leagueInFlight) return _leagueInFlight;

  _leagueInFlight = (async () => {
    const players = await fetchLeaguePlayers();
    const logs = await pooled(players, async (p) => ({
      ...p,
      batting: await fetchLog(p.playerId, 'batting'),
      pitching: await fetchLog(p.playerId, 'pitching'),
    }));

    const playerSplits = logs.map(p => ({
      playerId: p.playerId,
      name: p.name,
      team: p.team,
      batting: aggregateSplits(p.batting, 'batting'),
      pitching: aggregateSplits(p.pitching, 'pitching'),
    }));

    // Team rollups: re-aggregate from the raw logs rather than summing the
    // players' finished lines, so team rate stats come from team totals (a
    // mean of player averages is not a team average).
    const teamLogs = new Map(); // teamId → { batting: [], pitching: [] }
    for (const p of logs) {
      if (!p.team) continue;
      if (!teamLogs.has(p.team)) teamLogs.set(p.team, { batting: [], pitching: [] });
      const bucket = teamLogs.get(p.team);
      bucket.batting.push(...p.batting);
      bucket.pitching.push(...p.pitching);
    }
    const teams = new Map();
    for (const t of TEAMS) {
      const bucket = teamLogs.get(t.id) || { batting: [], pitching: [] };
      teams.set(t.id, {
        teamId: t.id,
        batting: aggregateSplits(bucket.batting, 'batting'),
        pitching: aggregateSplits(bucket.pitching, 'pitching'),
      });
    }

    // The authoritative set of postseason game ids, straight from the flag the
    // league itself sets. Consumers use this to split records and schedules
    // without hardcoding a cutoff date.
    const playoffGameIds = new Set();
    for (const p of logs) {
      for (const g of [...p.batting, ...p.pitching]) {
        if (g.isPlayoff && g.gameId != null) playoffGameIds.add(g.gameId);
      }
    }

    return { players: playerSplits, teams, playoffGameIds, playerCount: players.length };
  })();

  try {
    _leagueCache = await _leagueInFlight;
    _leagueFetchedAt = Date.now();
    return _leagueCache;
  } catch (e) {
    console.warn('[splits] league fan-out failed', e);
    return _leagueCache || { players: [], teams: new Map(), playoffGameIds: new Set(), playerCount: 0 };
  } finally {
    _leagueInFlight = null;
  }
}

// ─── Split leaderboards ─────────────────────────────────────────────────────
// A drop-in replacement for fetchBattingLeaders()/fetchPitchingLeaders() that
// works for ANY split, so every existing stat table, leader board and roster
// trio can render a split without changing how it reads a row.
//
// The regular-season split deliberately returns the LIVE leaderboards rather
// than re-deriving from logs: they're identical on the counting stats
// (verified) but they also carry OPS+, wRC+, bWAR, ERA+ and FIP, which the
// logs don't have. Re-deriving would throw those away for no gain.

export async function fetchSplitLeaders(split = DEFAULT_SPLIT) {
  if (split === 'regular') {
    const [batting, pitching] = await Promise.all([
      fetchBattingLeaders().catch(() => []),
      fetchPitchingLeaders().catch(() => []),
    ]);
    return { batting, pitching };
  }

  const [{ players }, regBat, regPit] = await Promise.all([
    fetchLeagueSplits(),
    fetchBattingLeaders().catch(() => []),
    fetchPitchingLeaders().catch(() => []),
  ]);

  // OPWR rank and avatars are NOT season-scoped — the rank is a global,
  // cross-league board and the avatar is just the player's photo. Carrying them
  // over keeps the rank column and headshots populated when the user switches
  // split, instead of blanking fields that never depended on the split.
  const carryOver = new Map();
  for (const r of [...regBat, ...regPit]) {
    if (r.playerId != null && !carryOver.has(r.playerId)) {
      carryOver.set(r.playerId, {
        currentRank: r.currentRank,
        previousRank: r.previousRank,
        avatarUrl: r.avatarUrl,
      });
    }
  }

  const rowsFor = (kind) => players
    .filter(p => p[kind]?.[split])
    .map(p => ({
      playerId: p.playerId,
      name: p.name,
      team: p.team,
      num: '',            // jersey numbers come from media filenames, not the API
      ...(carryOver.get(p.playerId) || null),
      ...p[kind][split],
    }));

  // Regular-season boards sort by OPS+ (batting) and FIP (pitching); neither
  // exists per split, so fall back to the closest unadjusted equivalent.
  const byOps = (a, b) => parseFloat(b.ops) - parseFloat(a.ops);
  const byEra = (a, b) => parseFloat(a.era) - parseFloat(b.era);

  return {
    batting: canonicalizeStatRows(rowsFor('batting'), byOps),
    pitching: canonicalizeStatRows(rowsFor('pitching'), byEra),
  };
}

// ─── Ranking within a split ─────────────────────────────────────────────────
// The stat tiles show "6th" next to a value, which only means something
// relative to the same split. `lowerIsBetter` covers ERA / WHIP.

// `rows` is [{ playerId, value }] for the ONE stat being ranked, already
// filtered to the players who qualify for it in this split.
export function rankWithin(rows, playerId, { lowerIsBetter = false } = {}) {
  const vals = (rows || [])
    .map(r => ({ playerId: r.playerId, v: Number(r.value) }))
    .filter(r => Number.isFinite(r.v));
  if (vals.length === 0) return null;
  const mine = vals.find(r => r.playerId === playerId);
  if (!mine) return null;
  const better = vals.filter(r => (lowerIsBetter ? r.v < mine.v : r.v > mine.v)).length;
  const tied = vals.filter(r => r.v === mine.v).length > 1;
  return { rank: better + 1, tied, total: vals.length };
}
