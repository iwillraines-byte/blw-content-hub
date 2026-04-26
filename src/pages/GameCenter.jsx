import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fetchAllData, fetchAllRosters, getAllPlayersDirectory, TEAMS, getTeam, slugify, playerSlug, API_CONFIG, canonicalTeamOf, resolveCanonicalName, CANONICAL_ROSTER_2026 } from '../data';
import { Card, PageHeader, SectionHeading, TeamChip, TeamLogo, FreeAgentChip, OutlineButton, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { getAllMedia } from '../media-store';
import { getAllManualPlayers } from '../player-store';

// Helper: render a sortable header
// SortHeader — the column whose sortKey matches the current sort becomes red.
// No more static `highlight` prop: emphasis follows the active sort.
function SortHeader({ label, sortKey, currentSort, setSort, align = 'right' }) {
  const active = currentSort.key === sortKey;
  const thStyle = {
    padding: '10px 12px', textAlign: align,
    fontFamily: fonts.condensed, fontWeight: 700, fontSize: 11,
    color: active ? colors.red : colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
    cursor: sortKey ? 'pointer' : 'default',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };
  const arrow = active ? (currentSort.dir === 'desc' ? ' ▼' : ' ▲') : '';
  return (
    <th
      style={thStyle}
      onClick={() => {
        if (!sortKey) return;
        if (currentSort.key === sortKey) {
          setSort({ key: sortKey, dir: currentSort.dir === 'desc' ? 'asc' : 'desc' });
        } else {
          setSort({ key: sortKey, dir: 'desc' });
        }
      }}
    >
      {label}{arrow}
    </th>
  );
}

// Compute a data-cell style that bolds + reds the cell if its column is the
// current sort key. Drop-in replacement for callers that used tdStyle(bool).
function cellFor(sort, key) {
  const active = sort.key === key;
  return {
    padding: '10px 12px',
    textAlign: 'right',
    fontSize: active ? 14 : 13,
    fontWeight: active ? 800 : 500,
    color: active ? colors.red : colors.text,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  };
}

// ─── Percentile coloring (Baseball Savant style) ────────────────────────────
// For stats where HIGHER is better, "quality percentile" == raw percentile.
// For stats where LOWER is better (ERA, WHIP, K for a batter, etc.), we invert
// so that the best performers still land in the red zone.
//
// Quality percentile ≥ 85 → progressively deeper red (deepest at 100)
// Quality percentile ≤ 15 → progressively deeper blue (deepest at 1)
// Middle band 16–84 is left untinted to keep tables readable.
const BATTING_COLOR_COLS = {
  runs: 'higher', hits: 'higher', doubles: 'higher', triples: 'higher',
  hr: 'higher', rbi: 'higher',
  bb: 'higher', bbPct: 'higher', // walks = higher is better
  k: 'lower', kPct: 'lower',     // strikeouts = lower is better for a hitter
  avg: 'higher', obp: 'higher', slg: 'higher', ops: 'higher', ops_plus: 'higher',
};

const PITCHING_COLOR_COLS = {
  ip: 'higher',
  hits: 'lower', runs: 'lower', bb: 'lower', hrAllowed: 'lower',
  k: 'higher',
  era: 'lower', whip: 'lower', fip: 'lower',
  k4: 'higher', bb4: 'lower',
};

// Compute per-player percentile for every configured column, across the full
// population (not the filtered subset). Returns { [colKey]: Map<playerKey, pct> }.
function computePercentiles(rows, colConfig) {
  const out = {};
  if (!Array.isArray(rows) || rows.length === 0) return out;
  const playerKey = p => p.playerId ?? p.name;
  for (const [colKey, direction] of Object.entries(colConfig)) {
    const values = [];
    for (const r of rows) {
      const v = parseFloat(r[colKey]);
      if (!isNaN(v)) values.push(v);
    }
    if (values.length === 0) { out[colKey] = new Map(); continue; }
    values.sort((a, b) => a - b);
    const total = values.length;
    const map = new Map();
    for (const r of rows) {
      const v = parseFloat(r[colKey]);
      if (isNaN(v)) continue;
      // Count how many are strictly below; count ties
      let below = 0;
      let ties = 0;
      // Binary-search could speed this up, but with ~100 rows per stat it's fine
      for (const x of values) {
        if (x < v) below++;
        else if (x === v) ties++;
        else break;
      }
      const raw = ((below + 0.5 * ties) / total) * 100;
      const pct = direction === 'lower' ? 100 - raw : raw;
      map.set(playerKey(r), pct);
    }
    out[colKey] = map;
  }
  return out;
}

// Map a quality percentile (0-100) to a cell background color.
// null outside the red/blue zones so zebra striping shows through.
function percentileColor(p) {
  if (p == null) return null;
  if (p >= 85) {
    const t = Math.min(1, (p - 85) / 15); // 0 at p=85, 1 at p=100
    const alpha = 0.10 + t * 0.40;
    return `rgba(220, 38, 38, ${alpha.toFixed(2)})`;
  }
  if (p <= 15) {
    const t = Math.min(1, (15 - p) / 15); // 0 at p=15, 1 at p=0
    const alpha = 0.10 + t * 0.40;
    return `rgba(37, 99, 235, ${alpha.toFixed(2)})`;
  }
  return null;
}

// Helper: given a computed percentiles map and a row, return the bg color for a cell.
function bgForCell(percentiles, colKey, row) {
  const map = percentiles[colKey];
  if (!map) return null;
  const pct = map.get(row.playerId ?? row.name);
  return percentileColor(pct);
}

// Hover tooltip for shaded cells. Only produces text when the percentile is in
// one of the tinted bands — middle band returns '' so the title attribute stays
// unset and the browser doesn't render a distracting raw-number tooltip.
function titleForCell(percentiles, colKey, row) {
  const map = percentiles[colKey];
  if (!map) return '';
  const pct = map.get(row.playerId ?? row.name);
  if (pct == null) return '';
  if (pct >= 85) return `Top ${Math.max(1, Math.round(100 - pct))}% · ${colKey.toUpperCase()}`;
  if (pct <= 15) return `Bottom ${Math.max(1, Math.round(pct))}% · ${colKey.toUpperCase()}`;
  return '';
}

// Compact color key explaining the percentile coloring on stats tables.
// Samples the same percentileColor() used by cell backgrounds so the legend
// never drifts from the actual rendered colors.
function PercentileLegend() {
  const swatch = (pct, bordered = false) => (
    <span
      key={pct}
      style={{
        display: 'inline-block', width: 16, height: 14,
        background: percentileColor(pct) || colors.bg,
        border: bordered ? `1px solid ${colors.borderLight}` : 'none',
      }}
    />
  );
  const label = (text) => (
    <span style={{
      fontFamily: fonts.condensed, fontSize: 9, fontWeight: 700,
      color: colors.textMuted, letterSpacing: 0.4,
    }}>{text}</span>
  );
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 14px', background: colors.bg,
      border: `1px solid ${colors.borderLight}`,
      borderRadius: radius.sm,
      flexWrap: 'wrap',
    }}>
      <span style={{
        fontFamily: fonts.body, fontSize: 11, fontWeight: 600, color: colors.textSecondary,
      }}>Percentile key:</span>

      {/* Bottom end — blue, deepest at 1 */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        {label('← Worst')}
        <span style={{ display: 'inline-flex', marginLeft: 6, marginRight: 2 }}>
          {swatch(0)}
          {swatch(7)}
          {swatch(15)}
        </span>
        {label('1st – 15th')}
      </span>

      {/* Middle — untinted */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {swatch(50, true)}
        {label('16th – 84th · no tint')}
      </span>

      {/* Top end — red, deepest at 100 */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        {label('85th – 100th')}
        <span style={{ display: 'inline-flex', marginLeft: 2, marginRight: 6 }}>
          {swatch(85)}
          {swatch(93)}
          {swatch(100)}
        </span>
        {label('Best →')}
      </span>

      <span style={{
        fontFamily: fonts.body, fontSize: 11, color: colors.textMuted, fontStyle: 'italic',
      }}>
        Lower-is-better stats (ERA, WHIP, K for hitters, etc.) are inverted so best still reads red.
      </span>
    </div>
  );
}

// Compact rank cell: bold rank number next to a MoveBadge for recent change.
// Shows "—" if the row has no composite rank yet (e.g., player not in the
// current composite rankings). rank and change come straight off the API row.
function RankCell({ row }) {
  const rank = row.currentRank;
  if (rank == null) {
    return <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.condensed, fontWeight: 700 }}>—</span>;
  }
  const prev = row.previousRank;
  const change = (prev != null) ? prev - rank : 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 800, color: colors.text, fontFamily: fonts.condensed }}>
        #{rank}
      </span>
      <MoveBadge change={change} />
    </span>
  );
}

// Small colored badge for rank movement (+3 ▲ green, -2 ▼ red, — gray)
function MoveBadge({ change }) {
  if (!change || change === 0) {
    return <span style={{ fontSize: 12, color: colors.textMuted, fontWeight: 600 }}>—</span>;
  }
  const up = change > 0;
  const bg = up ? 'rgba(34,197,94,0.12)' : 'rgba(220,38,38,0.12)';
  const fg = up ? '#16A34A' : '#DC2626';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      background: bg, color: fg,
      padding: '3px 8px', borderRadius: 999,
      fontSize: 11, fontWeight: 700, fontFamily: fonts.condensed,
      letterSpacing: 0.3,
    }}>
      {up ? '▲' : '▼'}{Math.abs(change)}
    </span>
  );
}

// Sort helper — handles numeric and string values, asc/desc
function applySort(rows, sort) {
  if (!sort.key) return rows;
  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    const ax = typeof av === 'string' && !isNaN(parseFloat(av)) ? parseFloat(av) : av;
    const bx = typeof bv === 'string' && !isNaN(parseFloat(bv)) ? parseFloat(bv) : bv;
    if (ax == null) return 1;
    if (bx == null) return -1;
    if (ax < bx) return sort.dir === 'asc' ? -1 : 1;
    if (ax > bx) return sort.dir === 'asc' ? 1 : -1;
    return 0;
  });
  return sorted;
}

// Clickable player cell — links to player page
function PlayerCell({ name, team }) {
  const t = getTeam(team);
  const lastName = name.split(' ').pop();
  if (!t) return <span style={{ fontWeight: 700 }}>{name}</span>;
  return (
    <Link to={`/teams/${t.slug}/players/${playerSlug({ name })}`} style={{
      color: colors.text, textDecoration: 'none', fontWeight: 700,
      borderBottom: `1px dotted ${colors.border}`,
    }}>
      {name}
    </Link>
  );
}

// Clickable team chip
function TeamLink({ teamId }) {
  const t = getTeam(teamId);
  if (!t) return <TeamChip teamId={teamId} small />;
  return (
    <Link to={`/teams/${t.slug}`} style={{ textDecoration: 'none' }}>
      <TeamChip teamId={teamId} small withLogo />
    </Link>
  );
}

export default function GameCenter() {
  const [tab, setTab] = useState('batting');
  const [batting, setBatting] = useState([]);
  const [pitching, setPitching] = useState([]);
  const [rankings, setRankings] = useState([]);
  const [loading, setLoading] = useState(true);

  const [players, setPlayers] = useState([]);

  const [battingSearch, setBattingSearch] = useState('');
  const [pitchingSearch, setPitchingSearch] = useState('');
  const [rankingsSearch, setRankingsSearch] = useState('');
  const [playersSearch, setPlayersSearch] = useState('');
  const [playersTeamFilter, setPlayersTeamFilter] = useState('ALL');
  const [playersFilter, setPlayersFilter] = useState('all'); // all | missing-media | missing-jersey

  const [battingSort, setBattingSort] = useState({ key: 'ops_plus', dir: 'desc' });
  const [pitchingSort, setPitchingSort] = useState({ key: 'fip', dir: 'asc' });
  const [rankingsSort, setRankingsSort] = useState({ key: 'compositePoints', dir: 'desc' });
  const [playersSort, setPlayersSort] = useState({ key: 'team', dir: 'asc' });
  // How many ranking rows to show. Bumps by RANKINGS_PAGE_SIZE on
  // "Load more" — keeps the initial render fast on the rare ranking
  // dump with hundreds of cross-league entries.
  const [rankingsVisible, setRankingsVisible] = useState(50);
  const RANKINGS_PAGE_SIZE = 50;

  useEffect(() => {
    Promise.all([fetchAllData(), fetchAllRosters()]).then(([{ batting: b, pitching: p, rankings: r }, allRosters]) => {
      // Build playerId → team lookup from rosters so rankings can display team logos
      const idToTeam = new Map();
      const nameToTeam = new Map();
      for (const rp of allRosters) {
        if (rp.playerId) idToTeam.set(rp.playerId, rp.team);
        if (rp.name) nameToTeam.set(rp.name.toLowerCase(), rp.team);
      }
      // Apply canonical-team override + name resolution to every leaderboard
      // entry. Stats stay (they're tied to the player); the team field is
      // overridden so traded/renamed players show under their real team.
      const overlayCanonical = (player) => {
        const canonical = resolveCanonicalName(player.name || '');
        const canonTeam = canonicalTeamOf(canonical);
        return {
          ...player,
          name: canonical || player.name,
          team: canonTeam || player.team,
        };
      };
      const rWithTeam = r.map(p => {
        const canonical = resolveCanonicalName(p.name || '');
        const canonTeam = canonicalTeamOf(canonical);
        return {
          ...p,
          name: canonical || p.name,
          team: canonTeam
            || idToTeam.get(p.playerId)
            || nameToTeam.get((canonical || p.name || '').toLowerCase())
            || null,
        };
      });

      // Pad batting + pitching with canonical roster players who haven't
      // recorded stats yet — they appear at the bottom of the leaderboard
      // with em-dashes so the user can confirm "every BLW player is
      // accounted for, here's who hasn't logged a hit / inning yet."
      const batCanonical = b.map(overlayCanonical);
      const pitCanonical = p.map(overlayCanonical);
      const presentBatNames = new Set(batCanonical.map(x => (x.name || '').toLowerCase()));
      const presentPitNames = new Set(pitCanonical.map(x => (x.name || '').toLowerCase()));
      const noStatsBatting = CANONICAL_ROSTER_2026
        .filter(c => !presentBatNames.has(c.name.toLowerCase()))
        .map(c => ({
          name: c.name,
          team: c.team,
          ab: 0, hits: 0, hr: 0, rbi: 0,
          avg: '—', obp: '—', slg: '—', ops_plus: null,
          noStats: true,
        }));
      const noStatsPitching = CANONICAL_ROSTER_2026
        .filter(c => !presentPitNames.has(c.name.toLowerCase()))
        .map(c => ({
          name: c.name,
          team: c.team,
          ip: 0, w: 0, l: 0,
          era: '—', whip: '—', fip: null, k4: '—', bb4: '—',
          noStats: true,
        }));

      setBatting([...batCanonical, ...noStatsBatting]);
      setPitching([...pitCanonical, ...noStatsPitching]);
      setRankings(rWithTeam);
      setLoading(false);
    });
  }, []);

  // Load Players tab data only when accessed (and refresh when tab is opened)
  useEffect(() => {
    if (tab !== 'players') return;
    Promise.all([
      fetchAllData(),
      fetchAllRosters(),
      getAllMedia(),
      getAllManualPlayers(),
    ]).then(async ([, , mediaList, manualList]) => {
      const directory = await getAllPlayersDirectory(mediaList, manualList);
      setPlayers(directory);
    });
  }, [tab]);

  const tabStyle = (active) => ({
    background: active ? colors.redLight : colors.white,
    border: active ? `1px solid ${colors.redBorder}` : `1px solid ${colors.border}`,
    color: active ? colors.red : colors.textSecondary,
    borderRadius: radius.base, padding: '8px 18px',
    fontFamily: fonts.body, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  });

  const tdStyle = (highlight) => ({
    padding: '10px 12px', textAlign: 'right', fontSize: 13,
    fontWeight: highlight ? 800 : 500,
    color: highlight ? colors.red : colors.text,
  });

  const filteredBatting = useMemo(() => {
    const q = battingSearch.trim().toLowerCase();
    const filtered = q ? batting.filter(p => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)) : batting;
    return applySort(filtered, battingSort);
  }, [batting, battingSearch, battingSort]);

  // Percentile coloring — computed from the FULL population so filtering/sorting
  // doesn't shift a player's percentile. Memoized on the raw lists only.
  const battingPercentiles = useMemo(() => computePercentiles(batting, BATTING_COLOR_COLS), [batting]);
  const pitchingPercentiles = useMemo(() => computePercentiles(pitching, PITCHING_COLOR_COLS), [pitching]);

  const filteredPitching = useMemo(() => {
    const q = pitchingSearch.trim().toLowerCase();
    const filtered = q ? pitching.filter(p => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)) : pitching;
    return applySort(filtered, pitchingSort);
  }, [pitching, pitchingSearch, pitchingSort]);

  const filteredRankings = useMemo(() => {
    const q = rankingsSearch.trim().toLowerCase();
    const filtered = q ? rankings.filter(p => p.name.toLowerCase().includes(q)) : rankings;
    return applySort(filtered, rankingsSort);
  }, [rankings, rankingsSearch, rankingsSort]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="PROWIFFLE STATS" subtitle="Stats, rankings, and standings from Grand Slam Systems" />

      {/* API Status */}
      <Card style={{
        padding: 14,
        background: API_CONFIG.isLive ? colors.successBg : colors.warningBg,
        border: `1px solid ${API_CONFIG.isLive ? colors.successBorder : colors.warningBorder}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🟢</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#15803D' }}>Live API Connected — Grand Slam Systems</div>
            <div style={{ fontSize: 12, color: colors.textSecondary }}>
              {batting.length} batters · {pitching.length} pitchers · {rankings.length} ranked players
            </div>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={() => setTab('batting')} style={tabStyle(tab === 'batting')}>Batting</button>
        <button onClick={() => setTab('pitching')} style={tabStyle(tab === 'pitching')}>Pitching</button>
        <button onClick={() => setTab('rankings')} style={tabStyle(tab === 'rankings')}>Player Rankings</button>
        <button onClick={() => setTab('players')} style={tabStyle(tab === 'players')}>Players</button>
        <button onClick={() => setTab('standings')} style={tabStyle(tab === 'standings')}>Standings</button>
      </div>

      {loading && <Card style={{ textAlign: 'center', color: colors.textMuted, padding: 40 }}>Loading stats…</Card>}

      {/* Batting */}
      {!loading && tab === 'batting' && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <SectionHeading style={{ margin: 0 }}>Batting leaders</SectionHeading>
            <input
              type="text"
              value={battingSearch}
              onChange={e => setBattingSearch(e.target.value)}
              placeholder="Search player or team…"
              style={{ ...inputStyle, maxWidth: 260 }}
            />
          </div>
          <div style={{ padding: '12px 18px', borderBottom: `1px solid ${colors.borderLight}` }}>
            <PercentileLegend />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: colors.bg }}>
                  <SortHeader label="#"      sortKey={null}        currentSort={battingSort} setSort={setBattingSort} align="center" />
                  <SortHeader label="Player" sortKey="name"        currentSort={battingSort} setSort={setBattingSort} align="left" />
                  <SortHeader label="Rank"   sortKey="currentRank" currentSort={battingSort} setSort={setBattingSort} align="left" />
                  <SortHeader label="Team"   sortKey="team"        currentSort={battingSort} setSort={setBattingSort} align="left" />
                  <SortHeader label="G"      sortKey="games"       currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="PA"     sortKey="pa"          currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="AB"     sortKey="ab"          currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="R"      sortKey="runs"        currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="H"      sortKey="hits"        currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="2B"     sortKey="doubles"     currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="3B"     sortKey="triples"     currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="HR"     sortKey="hr"          currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="RBI"    sortKey="rbi"         currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="BB"     sortKey="bb"          currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="BB%"    sortKey="bbPct"       currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="K"      sortKey="k"           currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="K%"     sortKey="kPct"        currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="AVG"    sortKey="avg"         currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="OBP"    sortKey="obp"         currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="SLG"    sortKey="slg"         currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="OPS"    sortKey="ops"         currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="OPS+"   sortKey="ops_plus"    currentSort={battingSort} setSort={setBattingSort} />
                </tr>
              </thead>
              <tbody>
                {filteredBatting.map((p, i) => (
                  <tr key={p.playerId || p.rank} style={{ borderBottom: `1px solid ${colors.divider}`, background: i % 2 === 0 ? colors.white : colors.bg }}>
                    <td style={{ ...cellFor(battingSort, null), textAlign: 'center', color: colors.textMuted, fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ ...cellFor(battingSort, 'name'), textAlign: 'left' }}><PlayerCell name={p.name} team={p.team} /></td>
                    <td style={{ ...cellFor(battingSort, 'currentRank'), textAlign: 'left' }}><RankCell row={p} /></td>
                    <td style={{ ...cellFor(battingSort, 'team'), textAlign: 'left' }}><TeamLink teamId={p.team} /></td>
                    <td style={cellFor(battingSort, 'games')}>{p.games ?? '—'}</td>
                    <td style={cellFor(battingSort, 'pa')}>{p.pa ?? '—'}</td>
                    <td style={cellFor(battingSort, 'ab')}>{p.ab ?? '—'}</td>
                    <td title={titleForCell(battingPercentiles, 'runs', p)}     style={{ ...cellFor(battingSort, 'runs'),     background: bgForCell(battingPercentiles, 'runs', p) }}>{p.runs ?? '—'}</td>
                    <td title={titleForCell(battingPercentiles, 'hits', p)}     style={{ ...cellFor(battingSort, 'hits'),     background: bgForCell(battingPercentiles, 'hits', p) }}>{p.hits ?? '—'}</td>
                    <td title={titleForCell(battingPercentiles, 'doubles', p)}  style={{ ...cellFor(battingSort, 'doubles'),  background: bgForCell(battingPercentiles, 'doubles', p) }}>{p.doubles ?? '—'}</td>
                    <td title={titleForCell(battingPercentiles, 'triples', p)}  style={{ ...cellFor(battingSort, 'triples'),  background: bgForCell(battingPercentiles, 'triples', p) }}>{p.triples ?? '—'}</td>
                    <td title={titleForCell(battingPercentiles, 'hr', p)}       style={{ ...cellFor(battingSort, 'hr'),       background: bgForCell(battingPercentiles, 'hr', p) }}>{p.hr}</td>
                    <td title={titleForCell(battingPercentiles, 'rbi', p)}      style={{ ...cellFor(battingSort, 'rbi'),      background: bgForCell(battingPercentiles, 'rbi', p) }}>{p.rbi}</td>
                    <td title={titleForCell(battingPercentiles, 'bb', p)}       style={{ ...cellFor(battingSort, 'bb'),       background: bgForCell(battingPercentiles, 'bb', p) }}>{p.bb ?? '—'}</td>
                    <td title={titleForCell(battingPercentiles, 'bbPct', p)}    style={{ ...cellFor(battingSort, 'bbPct'),    background: bgForCell(battingPercentiles, 'bbPct', p) }}>{p.bbPct != null ? `${p.bbPct.toFixed(1)}%` : '—'}</td>
                    <td title={titleForCell(battingPercentiles, 'k', p)}        style={{ ...cellFor(battingSort, 'k'),        background: bgForCell(battingPercentiles, 'k', p) }}>{p.k ?? '—'}</td>
                    <td title={titleForCell(battingPercentiles, 'kPct', p)}     style={{ ...cellFor(battingSort, 'kPct'),     background: bgForCell(battingPercentiles, 'kPct', p) }}>{p.kPct != null ? `${p.kPct.toFixed(1)}%` : '—'}</td>
                    <td title={titleForCell(battingPercentiles, 'avg', p)}      style={{ ...cellFor(battingSort, 'avg'),      background: bgForCell(battingPercentiles, 'avg', p) }}>{p.avg}</td>
                    <td title={titleForCell(battingPercentiles, 'obp', p)}      style={{ ...cellFor(battingSort, 'obp'),      background: bgForCell(battingPercentiles, 'obp', p) }}>{p.obp}</td>
                    <td title={titleForCell(battingPercentiles, 'slg', p)}      style={{ ...cellFor(battingSort, 'slg'),      background: bgForCell(battingPercentiles, 'slg', p) }}>{p.slg}</td>
                    <td title={titleForCell(battingPercentiles, 'ops', p)}      style={{ ...cellFor(battingSort, 'ops'),      background: bgForCell(battingPercentiles, 'ops', p) }}>{p.ops}</td>
                    <td title={titleForCell(battingPercentiles, 'ops_plus', p)} style={{ ...cellFor(battingSort, 'ops_plus'), background: bgForCell(battingPercentiles, 'ops_plus', p) }}>{p.ops_plus}</td>
                  </tr>
                ))}
                {filteredBatting.length === 0 && (
                  <tr><td colSpan={22} style={{ padding: 30, textAlign: 'center', color: colors.textMuted }}>No players match "{battingSearch}"</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Pitching */}
      {!loading && tab === 'pitching' && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <SectionHeading style={{ margin: 0 }}>Pitching leaders</SectionHeading>
            <input
              type="text"
              value={pitchingSearch}
              onChange={e => setPitchingSearch(e.target.value)}
              placeholder="Search player or team…"
              style={{ ...inputStyle, maxWidth: 260 }}
            />
          </div>
          <div style={{ padding: '12px 18px', borderBottom: `1px solid ${colors.borderLight}` }}>
            <PercentileLegend />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: colors.bg }}>
                  <SortHeader label="#"      sortKey={null}        currentSort={pitchingSort} setSort={setPitchingSort} align="center" />
                  <SortHeader label="Player" sortKey="name"        currentSort={pitchingSort} setSort={setPitchingSort} align="left" />
                  <SortHeader label="Rank"   sortKey="currentRank" currentSort={pitchingSort} setSort={setPitchingSort} align="left" />
                  <SortHeader label="Team"   sortKey="team"        currentSort={pitchingSort} setSort={setPitchingSort} align="left" />
                  <SortHeader label="G"      sortKey="games"    currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="W"      sortKey="w"        currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="L"      sortKey="l"        currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="SV"     sortKey="saves"    currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="IP"     sortKey="ip"       currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="H"      sortKey="hits"     currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="R"      sortKey="runs"     currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="BB"     sortKey="bb"       currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="K"      sortKey="k"        currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="HR"     sortKey="hrAllowed" currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="ERA"    sortKey="era"      currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="WHIP"   sortKey="whip"     currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="FIP"    sortKey="fip"      currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="K/4"    sortKey="k4"       currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="BB/4"   sortKey="bb4"      currentSort={pitchingSort} setSort={setPitchingSort} />
                </tr>
              </thead>
              <tbody>
                {filteredPitching.map((p, i) => (
                  <tr key={p.playerId || p.rank} style={{ borderBottom: `1px solid ${colors.divider}`, background: i % 2 === 0 ? colors.white : colors.bg }}>
                    <td style={{ ...cellFor(pitchingSort, null), textAlign: 'center', color: colors.textMuted, fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ ...cellFor(pitchingSort, 'name'), textAlign: 'left' }}><PlayerCell name={p.name} team={p.team} /></td>
                    <td style={{ ...cellFor(pitchingSort, 'currentRank'), textAlign: 'left' }}><RankCell row={p} /></td>
                    <td style={{ ...cellFor(pitchingSort, 'team'), textAlign: 'left' }}><TeamLink teamId={p.team} /></td>
                    <td style={cellFor(pitchingSort, 'games')}>{p.games ?? '—'}</td>
                    <td style={cellFor(pitchingSort, 'w')}>{p.w}</td>
                    <td style={cellFor(pitchingSort, 'l')}>{p.l}</td>
                    <td style={cellFor(pitchingSort, 'saves')}>{p.saves ?? 0}</td>
                    <td title={titleForCell(pitchingPercentiles, 'ip', p)}        style={{ ...cellFor(pitchingSort, 'ip'),        background: bgForCell(pitchingPercentiles, 'ip', p) }}>{p.ip}</td>
                    <td title={titleForCell(pitchingPercentiles, 'hits', p)}      style={{ ...cellFor(pitchingSort, 'hits'),      background: bgForCell(pitchingPercentiles, 'hits', p) }}>{p.hits ?? '—'}</td>
                    <td title={titleForCell(pitchingPercentiles, 'runs', p)}      style={{ ...cellFor(pitchingSort, 'runs'),      background: bgForCell(pitchingPercentiles, 'runs', p) }}>{p.runs ?? '—'}</td>
                    <td title={titleForCell(pitchingPercentiles, 'bb', p)}        style={{ ...cellFor(pitchingSort, 'bb'),        background: bgForCell(pitchingPercentiles, 'bb', p) }}>{p.bb ?? '—'}</td>
                    <td title={titleForCell(pitchingPercentiles, 'k', p)}         style={{ ...cellFor(pitchingSort, 'k'),         background: bgForCell(pitchingPercentiles, 'k', p) }}>{p.k ?? '—'}</td>
                    <td title={titleForCell(pitchingPercentiles, 'hrAllowed', p)} style={{ ...cellFor(pitchingSort, 'hrAllowed'), background: bgForCell(pitchingPercentiles, 'hrAllowed', p) }}>{p.hrAllowed ?? '—'}</td>
                    <td title={titleForCell(pitchingPercentiles, 'era', p)}       style={{ ...cellFor(pitchingSort, 'era'),       background: bgForCell(pitchingPercentiles, 'era', p) }}>{p.era}</td>
                    <td title={titleForCell(pitchingPercentiles, 'whip', p)}      style={{ ...cellFor(pitchingSort, 'whip'),      background: bgForCell(pitchingPercentiles, 'whip', p) }}>{p.whip}</td>
                    <td title={titleForCell(pitchingPercentiles, 'fip', p)}       style={{ ...cellFor(pitchingSort, 'fip'),       background: bgForCell(pitchingPercentiles, 'fip', p) }}>{typeof p.fip === 'number' ? p.fip.toFixed(2) : p.fip}</td>
                    <td title={titleForCell(pitchingPercentiles, 'k4', p)}        style={{ ...cellFor(pitchingSort, 'k4'),        background: bgForCell(pitchingPercentiles, 'k4', p) }}>{p.k4}</td>
                    <td title={titleForCell(pitchingPercentiles, 'bb4', p)}       style={{ ...cellFor(pitchingSort, 'bb4'),       background: bgForCell(pitchingPercentiles, 'bb4', p) }}>{p.bb4}</td>
                  </tr>
                ))}
                {filteredPitching.length === 0 && (
                  <tr><td colSpan={19} style={{ padding: 30, textAlign: 'center', color: colors.textMuted }}>No players match "{pitchingSearch}"</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Rankings */}
      {!loading && tab === 'rankings' && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <SectionHeading style={{ margin: 0 }}>Player rankings</SectionHeading>
            <input
              type="text"
              value={rankingsSearch}
              onChange={e => setRankingsSearch(e.target.value)}
              placeholder="Search player…"
              style={{ ...inputStyle, maxWidth: 260 }}
            />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: colors.bg }}>
                  <SortHeader label="#"         sortKey="currentRank"     currentSort={rankingsSort} setSort={setRankingsSort} align="center" />
                  <SortHeader label="Player"    sortKey="name"            currentSort={rankingsSort} setSort={setRankingsSort} align="left" />
                  <SortHeader label="Move"      sortKey="rankChange"      currentSort={rankingsSort} setSort={setRankingsSort} />
                  <SortHeader label="Avg Pts"   sortKey="averagePoints"   currentSort={rankingsSort} setSort={setRankingsSort} />
                  <SortHeader label="Composite" sortKey="compositePoints" currentSort={rankingsSort} setSort={setRankingsSort} />
                </tr>
              </thead>
              <tbody>
                {filteredRankings.slice(0, rankingsVisible).map((p, i) => {
                  const team = p.team ? getTeam(p.team) : null;
                  return (
                  <tr key={p.playerId} style={{ borderBottom: `1px solid ${colors.divider}`, background: i % 2 === 0 ? colors.white : colors.bg }}>
                    <td style={{ ...cellFor(rankingsSort, 'currentRank'), textAlign: 'center' }}>{p.currentRank}</td>
                    <td style={{ ...cellFor(rankingsSort, 'name'), textAlign: 'left', fontWeight: 700 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {/* Logo on the left if we know the team; otherwise
                            show a small FA chip in the same slot so the
                            row stays aligned and the FA status is obvious. */}
                        {team
                          ? <TeamLogo teamId={team.id} size={22} rounded="square" />
                          : <FreeAgentChip small />
                        }
                        {team ? (
                          <Link to={`/teams/${team.slug}/players/${playerSlug({ name: p.name })}`} style={{ color: colors.text, textDecoration: 'none', borderBottom: `1px dotted ${colors.border}` }}>
                            {p.name}
                          </Link>
                        ) : (
                          <span style={{ color: colors.textSecondary }}>{p.name}</span>
                        )}
                      </div>
                    </td>
                    <td style={{ ...cellFor(rankingsSort, 'rankChange'), textAlign: 'center' }}>
                      <MoveBadge change={p.rankChange} />
                    </td>
                    <td style={cellFor(rankingsSort, 'averagePoints')}>{p.averagePoints.toFixed(0)}</td>
                    <td style={cellFor(rankingsSort, 'compositePoints')}>{p.compositePoints.toFixed(0)}</td>
                  </tr>
                  );
                })}
                {filteredRankings.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 30, textAlign: 'center', color: colors.textMuted }}>No players match "{rankingsSearch}"</td></tr>
                )}
                {filteredRankings.length > rankingsVisible && (
                  <tr>
                    <td colSpan={5} style={{ padding: 14, textAlign: 'center', borderTop: `1px solid ${colors.border}` }}>
                      <OutlineButton
                        onClick={() => setRankingsVisible(v => v + RANKINGS_PAGE_SIZE)}
                        style={{ padding: '6px 16px', fontSize: 12 }}
                      >
                        Load next {Math.min(RANKINGS_PAGE_SIZE, filteredRankings.length - rankingsVisible)} · {rankingsVisible} of {filteredRankings.length} shown
                      </OutlineButton>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Players — master directory */}
      {!loading && tab === 'players' && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: `1px solid ${colors.border}`, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <SectionHeading style={{ margin: 0 }}>All players</SectionHeading>
              <div style={{ fontFamily: fonts.condensed, fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                {players.length} total · sourced from API, uploaded media, and manual entries
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={playersTeamFilter} onChange={e => setPlayersTeamFilter(e.target.value)} style={{ ...selectStyle, fontSize: 12, maxWidth: 130 }}>
                <option value="ALL">All Teams</option>
                {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id} — {t.name}</option>)}
              </select>
              <select value={playersFilter} onChange={e => setPlayersFilter(e.target.value)} style={{ ...selectStyle, fontSize: 12 }}>
                <option value="all">All players</option>
                <option value="missing-media">Missing media</option>
                <option value="missing-jersey">Missing jersey #</option>
                <option value="has-stats">With stats</option>
                <option value="manual">Manual entries</option>
              </select>
              <input type="text" value={playersSearch} onChange={e => setPlayersSearch(e.target.value)}
                placeholder="Search name…" style={{ ...inputStyle, maxWidth: 200 }} />
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: colors.bg }}>
                  <SortHeader label="Player" sortKey="name" currentSort={playersSort} setSort={setPlayersSort} align="left" />
                  <SortHeader label="Team" sortKey="team" currentSort={playersSort} setSort={setPlayersSort} align="left" />
                  <SortHeader label="#" sortKey="num" currentSort={playersSort} setSort={setPlayersSort} align="center" />
                  <SortHeader label="Stats" sortKey="hasStats" currentSort={playersSort} setSort={setPlayersSort} align="center" />
                  <SortHeader label="Media" sortKey="hasMedia" currentSort={playersSort} setSort={setPlayersSort} align="center" />
                  <SortHeader label="Source" sortKey={null} currentSort={playersSort} setSort={setPlayersSort} align="left" />
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const q = playersSearch.trim().toLowerCase();
                  let filtered = players;
                  if (playersTeamFilter !== 'ALL') filtered = filtered.filter(p => p.team === playersTeamFilter);
                  if (q) filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || p.lastName.toLowerCase().includes(q));
                  if (playersFilter === 'missing-media') filtered = filtered.filter(p => !p.hasMedia);
                  if (playersFilter === 'missing-jersey') filtered = filtered.filter(p => !p.num);
                  if (playersFilter === 'has-stats') filtered = filtered.filter(p => p.hasStats);
                  if (playersFilter === 'manual') filtered = filtered.filter(p => p.hasManual);
                  filtered = applySort(filtered, playersSort);
                  if (filtered.length === 0) return (
                    <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: colors.textMuted }}>
                      No players match the current filters.
                    </td></tr>
                  );
                  return filtered.map((p, i) => {
                    const t = getTeam(p.team);
                    const sources = [
                      p.hasStats && 'stats',
                      p.hasMedia && 'media',
                      p.hasManual && 'manual',
                    ].filter(Boolean);
                    return (
                      <tr key={`${p.team}_${p.lastName}`} style={{ borderBottom: `1px solid ${colors.divider}`, background: i % 2 === 0 ? colors.white : colors.bg }}>
                        <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 700 }}>
                          {t ? (
                            <Link to={`/teams/${t.slug}/players/${playerSlug(p)}`} style={{ color: colors.text, textDecoration: 'none', borderBottom: `1px dotted ${colors.border}` }}>
                              {p.name}
                            </Link>
                          ) : p.name}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {t ? (
                            <Link to={`/teams/${t.slug}`} style={{ textDecoration: 'none' }}>
                              <TeamChip teamId={p.team} small withLogo />
                            </Link>
                          ) : <TeamChip teamId={p.team} small withLogo />}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 13, fontFamily: fonts.condensed, fontWeight: 700, color: p.num ? colors.text : colors.textMuted }}>
                          {p.num || '—'}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12 }}>
                          {p.hasStats ? (
                            <span style={{ color: colors.success, fontWeight: 700 }}>
                              {p.isBatter && p.isPitcher ? 'B+P' : p.isBatter ? 'B' : p.isPitcher ? 'P' : '✓'}
                            </span>
                          ) : <span style={{ color: colors.textMuted }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12 }}>
                          {p.hasMedia
                            ? <span style={{ color: colors.success, fontWeight: 700 }}>✓</span>
                            : <span style={{ color: colors.textMuted }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 10, fontFamily: fonts.condensed, color: colors.textMuted, letterSpacing: 0.4 }}>
                          {sources.join(' · ').toUpperCase()}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Standings */}
      {!loading && tab === 'standings' && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: `1px solid ${colors.border}` }}>
            <SectionHeading style={{ margin: 0 }}>2025-26 BLW standings</SectionHeading>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: colors.bg }}>
                  <SortHeader label="#" sortKey={null} currentSort={{}} setSort={() => {}} align="center" />
                  <SortHeader label="Team" sortKey={null} currentSort={{}} setSort={() => {}} align="left" />
                  <SortHeader label="W" sortKey={null} currentSort={{}} setSort={() => {}} />
                  <SortHeader label="L" sortKey={null} currentSort={{}} setSort={() => {}} />
                  <SortHeader label="PCT" sortKey={null} currentSort={{}} setSort={() => {}} highlight />
                  <SortHeader label="DIFF" sortKey={null} currentSort={{}} setSort={() => {}} />
                  <SortHeader label="AVG COMP" sortKey={null} currentSort={{}} setSort={() => {}} />
                </tr>
              </thead>
              <tbody>
                {TEAMS.map((t, i) => {
                  const [w, l] = t.record.split('-');
                  // Average composite = mean compositePoints across ranked players on this team
                  const teamRanked = rankings.filter(p => p.team === t.id && typeof p.compositePoints === 'number');
                  const avgComp = teamRanked.length > 0
                    ? teamRanked.reduce((sum, p) => sum + p.compositePoints, 0) / teamRanked.length
                    : null;
                  return (
                    <tr key={t.id} style={{ borderBottom: `1px solid ${colors.divider}`, background: i % 2 === 0 ? colors.white : colors.bg }}>
                      <td style={{ ...tdStyle(false), textAlign: 'center', color: colors.textMuted, fontWeight: 700 }}>{t.rank}</td>
                      <td style={{ ...tdStyle(false), textAlign: 'left' }}>
                        <Link to={`/teams/${t.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <TeamLogo teamId={t.id} size={32} rounded="rounded" />
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{t.name}</div>
                          </div>
                        </Link>
                      </td>
                      <td style={{ ...tdStyle(false), fontWeight: 700 }}>{w}</td>
                      <td style={{ ...tdStyle(false), fontWeight: 700 }}>{l}</td>
                      <td style={{ ...tdStyle(true), fontSize: 15 }}>{t.pct}</td>
                      <td style={{
                        ...tdStyle(false), fontWeight: 700,
                        color: t.diff.startsWith('+') && t.diff !== '0' ? '#16A34A' : t.diff === '0' ? colors.textMuted : '#DC2626',
                      }}>{t.diff}</td>
                      <td style={{ ...tdStyle(false), fontWeight: 700, color: colors.textSecondary }}>
                        {avgComp != null ? avgComp.toFixed(0) : <span style={{ color: colors.textMuted }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
