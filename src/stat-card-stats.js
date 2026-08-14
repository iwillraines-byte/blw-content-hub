// Stat catalog for the Studio "Stat Card" template (v5.6.0).
//
// The raw stat cards (hitting-stats / pitching-stats) show exactly four
// columns. Before this module those four were hardcoded in
// stat-card-renderer.js — AVG/HR/RBI/OPS+ for hitters, ERA/IP/K3/FIP for
// pitchers — which meant every player got the same four regardless of
// what they were actually good at. This catalog describes every stat the
// leaderboard rows carry so the Studio UI can offer a mix-and-match
// picker and the renderer can build the cells generically.
//
// Each entry:
//   id        stable key stored in prefs / passed as statKeys
//   label     what prints above the number on the card
//   hint      longer name for the picker dropdown
//   value(r)  display string for the card (r = the player's leaderboard row)
//   num(r)    numeric value used for league rank + the mini bar; null when
//             the row doesn't carry it (renderer then hides rank + bar)
//   dir       'desc' = higher is better, 'asc' = lower is better. Drives
//             which end of the league the mini bar treats as elite.
//   rankable  false for stats with no meaningful league ordering (W-L)
//
// Row shapes come from transformBatting() / transformPitching() in data.js.

// Season prefix for the raw card's default header ("2026 BATTING"). The
// header is user-editable in Studio; this only seeds the default, so
// bumping it in 2027 changes the default without stomping saved edits.
export const SEASON_LABEL = '2026';

// ─── Value / number helpers ─────────────────────────────────────────────────

function n(v) {
  const x = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(x) ? x : null;
}
function show(v) {
  return v == null || v === '' ? '—' : String(v);
}
function fixed(v, d = 2) {
  const x = n(v);
  return x == null ? '—' : x.toFixed(d);
}
function pct(v) {
  const x = n(v);
  return x == null ? '—' : `${x.toFixed(1)}%`;
}
function ratio(a, b) {
  const x = n(a), y = n(b);
  if (x == null || y == null || y === 0) return null;
  return x / y;
}
// Baseball convention: rate stats that live below 1.000 print without the
// leading zero — ".765", not "0.765". The feed hands these over as
// toFixed(3) strings WITH the zero, so we strip it at display time.
// Anything that reaches 1.000 (a slugger's SLG, an OPS) keeps its whole
// number and is untouched, and the sign survives on the way through.
// Deliberately NOT applied to ERA / WHIP / FIP and the per-3-inning
// rates — those print "0.00" / "0.89" everywhere in baseball.
function trimZero(s) {
  return String(s).replace(/^(-?)0\./, '$1.');
}

// Passthrough stat — value renders exactly as the feed supplies it
// (already-formatted strings like "3.1" / "0.89" stay untouched).
function from(id, key, label, hint, dir = 'desc') {
  return { id, label, hint, dir, value: r => show(r?.[key]), num: r => n(r?.[key]) };
}
// Passthrough sub-1.000 rate stat — AVG / OBP / SLG / OPS / ISO / BABIP
// / RISP. Same as `from`, minus the leading zero.
function rate(id, key, label, hint, dir = 'desc') {
  return {
    id, label, hint, dir,
    value: r => { const v = r?.[key]; return v == null || v === '' ? '—' : trimZero(v); },
    num: r => n(r?.[key]),
  };
}
// Numeric stat the feed hands over unrounded — print to `d` decimals.
function rounded(id, key, label, hint, dir = 'desc', d = 2) {
  return { id, label, hint, dir, value: r => fixed(r?.[key], d), num: r => n(r?.[key]) };
}
// Percentage stat stored as a bare number (12.5 → "12.5%").
function percent(id, key, label, hint, dir = 'desc') {
  return { id, label, hint, dir, value: r => pct(r?.[key]), num: r => n(r?.[key]) };
}
// Derived per-opportunity rate, e.g. HR/PA.
function perRate(id, numKey, denKey, label, hint, dir = 'desc', d = 3) {
  return {
    id, label, hint, dir,
    value: r => { const v = ratio(r?.[numKey], r?.[denKey]); return v == null ? '—' : trimZero(v.toFixed(d)); },
    num: r => ratio(r?.[numKey], r?.[denKey]),
  };
}

// ─── Batting ────────────────────────────────────────────────────────────────

export const BATTING_STATS = [
  rate('avg', 'avg', 'AVG', 'Batting average'),
  rate('obp', 'obp', 'OBP', 'On-base percentage'),
  rate('slg', 'slg', 'SLG', 'Slugging percentage'),
  rate('ops', 'ops', 'OPS', 'On-base plus slugging'),
  from('ops_plus', 'ops_plus', 'OPS+', 'OPS indexed to the league (100 = average)'),
  from('wrcPlus', 'wrcPlus', 'wRC+', 'Weighted runs created plus'),
  rounded('bwar', 'bwar', 'bWAR', 'Batting wins above replacement', 'desc', 1),
  from('hr', 'hr', 'HR', 'Home runs'),
  from('rbi', 'rbi', 'RBI', 'Runs batted in'),
  from('runs', 'runs', 'R', 'Runs scored'),
  from('hits', 'hits', 'H', 'Hits'),
  from('doubles', 'doubles', '2B', 'Doubles'),
  from('triples', 'triples', '3B', 'Triples'),
  from('singles', 'singles', '1B', 'Singles'),
  from('tb', 'tb', 'TB', 'Total bases'),
  from('bb', 'bb', 'BB', 'Walks'),
  percent('bbPct', 'bbPct', 'BB%', 'Walk rate'),
  from('k', 'k', 'K', 'Strikeouts', 'asc'),
  percent('kPct', 'kPct', 'K%', 'Strikeout rate', 'asc'),
  rate('iso', 'iso', 'ISO', 'Isolated power (SLG − AVG)'),
  rate('babip', 'babip', 'BABIP', 'Batting average on balls in play'),
  rate('risp', 'risp', 'RISP', 'Average with runners in scoring position'),
  from('pa', 'pa', 'PA', 'Plate appearances'),
  from('ab', 'ab', 'AB', 'At bats'),
  from('games', 'games', 'G', 'Games played'),
  perRate('hrPa', 'hr', 'pa', 'HR/PA', 'Home runs per plate appearance'),
  perRate('rbiPa', 'rbi', 'pa', 'RBI/PA', 'RBI per plate appearance'),
  perRate('rPa', 'runs', 'pa', 'R/PA', 'Runs per plate appearance'),
];

// ─── Pitching ───────────────────────────────────────────────────────────────

export const PITCHING_STATS = [
  from('era', 'era', 'ERA', 'Earned run average', 'asc'),
  from('eraPlus', 'eraPlus', 'ERA+', 'ERA indexed to the league (100 = average)'),
  from('whip', 'whip', 'WHIP', 'Walks + hits per inning', 'asc'),
  rounded('fip', 'fip', 'FIP', 'Fielding independent pitching', 'asc'),
  rounded('pwar', 'pwar', 'pWAR', 'Pitching wins above replacement', 'desc', 1),
  from('ip', 'ip', 'IP', 'Innings pitched'),
  from('k', 'k', 'K', 'Strikeouts'),
  from('k4', 'k4', 'K/3', 'Strikeouts per 3 innings (one BLW game)'),
  from('bb', 'bb', 'BB', 'Walks allowed', 'asc'),
  from('bb4', 'bb4', 'BB/3', 'Walks per 3 innings', 'asc'),
  from('kbb', 'kbb', 'K:BB', 'Strikeout-to-walk ratio'),
  from('hits', 'hits', 'H', 'Hits allowed', 'asc'),
  rounded('h3', 'h3', 'H/3', 'Hits allowed per 3 innings', 'asc'),
  from('runs', 'runs', 'R', 'Runs allowed', 'asc'),
  from('hrAllowed', 'hrAllowed', 'HR', 'Home runs allowed', 'asc'),
  from('hr4', 'hr4', 'HR/3', 'Home runs allowed per 3 innings', 'asc'),
  from('w', 'w', 'W', 'Wins'),
  from('l', 'l', 'L', 'Losses', 'asc'),
  from('saves', 'saves', 'SV', 'Saves'),
  from('shutouts', 'shutouts', 'SHO', 'Shutouts'),
  percent('gbPct', 'gbPct', 'GB%', 'Ground-ball rate'),
  rate('babip', 'babip', 'BABIP', 'Opponent BABIP', 'asc'),
  from('games', 'games', 'G', 'Games pitched'),
  // No league ordering worth drawing a bar under — record is a pair.
  {
    id: 'record', label: 'W-L', hint: 'Win–loss record', dir: 'desc', rankable: false,
    value: r => (r?.w == null && r?.l == null ? '—' : `${r?.w ?? 0}-${r?.l ?? 0}`),
    num: () => null,
  },
];

// ─── Lookup + defaults ──────────────────────────────────────────────────────

// Raw card types only — percentile cards render their own fixed 9 rows.
export const RAW_CARD_TYPES = ['hitting-stats', 'pitching-stats'];

export function isPitchingCard(cardType) {
  return cardType === 'pitching-stats' || cardType === 'pitching-percentiles';
}

// The option list a picker should show for a given card type.
export function statOptionsFor(cardType) {
  return isPitchingCard(cardType) ? PITCHING_STATS : BATTING_STATS;
}

export function findStat(cardType, id) {
  return statOptionsFor(cardType).find(s => s.id === id) || null;
}

// The pre-v5.6.0 hardcoded four, preserved so existing compositions look
// identical until someone deliberately changes them. Slot 4 is the
// "headline" column — the renderer paints it in the team accent color.
export const DEFAULT_STAT_KEYS = {
  'hitting-stats': ['avg', 'hr', 'rbi', 'ops_plus'],
  'pitching-stats': ['era', 'ip', 'k4', 'fip'],
};

export const DEFAULT_HEADER_LABELS = {
  'hitting-stats': `${SEASON_LABEL} Batting`,
  'pitching-stats': `${SEASON_LABEL} Pitching`,
  'hitting-percentiles': 'BLW Batting Percentile Rankings',
  'pitching-percentiles': 'BLW Pitching Percentile Rankings',
};

export function defaultStatKeys(cardType) {
  return (DEFAULT_STAT_KEYS[cardType] || DEFAULT_STAT_KEYS['hitting-stats']).slice();
}

export function defaultHeaderLabel(cardType) {
  return DEFAULT_HEADER_LABELS[cardType] || '';
}

// Coerce whatever we get (saved prefs, a request payload) into exactly four
// valid stat ids for this card type. Anything unknown falls back to the
// default in that slot, so a renamed/removed stat can't blank a column.
export function normalizeStatKeys(cardType, keys) {
  const fallback = defaultStatKeys(cardType);
  const list = Array.isArray(keys) ? keys : [];
  return fallback.map((def, i) => (findStat(cardType, list[i]) ? list[i] : def));
}

// ─── Studio preferences (localStorage) ──────────────────────────────────────
// Designer-scoped, per-browser — same treatment as field overrides. Keeps a
// chosen four (and a rewritten header) alive across page navigations and
// reloads instead of resetting to AVG/HR/RBI/OPS+ every visit.

const LS_KEY = 'blw_stat_card_prefs_v1';

function readPrefs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function writePrefs(prefs) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(prefs || {})); } catch {}
}

// Returns { statKeys: { cardType: [4 ids] }, headers: { cardType: string } }
// with every raw card type filled in, so callers can seed state directly.
export function loadStatCardPrefs() {
  const saved = readPrefs();
  const statKeys = {};
  RAW_CARD_TYPES.forEach(ct => {
    statKeys[ct] = normalizeStatKeys(ct, saved?.statKeys?.[ct]);
  });
  const headers = {};
  Object.keys(DEFAULT_HEADER_LABELS).forEach(ct => {
    const v = saved?.headers?.[ct];
    if (typeof v === 'string' && v.trim()) headers[ct] = v;
  });
  return { statKeys, headers };
}

export function saveStatCardPrefs({ statKeys, headers }) {
  writePrefs({ statKeys: statKeys || {}, headers: headers || {} });
}
