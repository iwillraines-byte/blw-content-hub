// ─── Reusable stats table components ─────────────────────────────────────────
// Extracted so team pages, the dashboard, and the Game Center can all render
// the same full-fidelity batting / pitching tables with percentile shading,
// clickable player + team names, sort headers, and hover tooltips.
//
// Each table manages its own sort + search state. Callers pass in `rows` (the
// full population — percentiles are computed across ALL rows so filtering
// doesn't shift a player's percentile) plus optional props for variants
// (compact, search-less, legend-less, top-N limit, custom title).

import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getTeam, playerSlug } from './data';
import { Card, SectionHeading, TeamChip, inputStyle } from './components';
import { colors, fonts, radius } from './theme';

// ─── Primitives ──────────────────────────────────────────────────────────────

// v4.5.37 / v4.5.41: Cross-promo link shown above every stats table —
// points readers at prowiffleball.com (the league's source-of-truth
// stats site) for box scores and historical data the app doesn't
// replicate. v4.5.41 swaps the text-pill chip for the actual
// prowiffleball.com wordmark logo (public/brand/prowiffleball-logo.svg).
// Sits hard-right of the table header on its own. Hover slightly
// raises opacity so it reads as an active link rather than a static
// stamp — the logo IS the affordance.
export function ProWiffleBallBlurb({ compact = false }) {
  return (
    <a
      href="https://prowiffleball.com"
      target="_blank"
      rel="noopener noreferrer"
      title="Visit prowiffleball.com — full box scores, splits, and historical data"
      style={{
        display: 'inline-flex', alignItems: 'center',
        textDecoration: 'none',
        opacity: 0.85,
        transition: 'opacity 160ms ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '0.85'; }}
    >
      <img
        src="/brand/prowiffleball-logo.svg"
        alt="prowiffleball.com"
        height={compact ? 22 : 28}
        style={{
          display: 'block',
          width: 'auto', height: compact ? 22 : 28,
          maxWidth: '100%',
        }}
      />
    </a>
  );
}

function SortHeader({ label, sortKey, currentSort, setSort, align = 'right' }) {
  const active = currentSort.key === sortKey;
  const arrow = active ? (currentSort.dir === 'desc' ? ' ▼' : ' ▲') : '';
  return (
    <th
      style={{
        padding: '10px 12px', textAlign: align,
        fontFamily: fonts.condensed, fontWeight: 700, fontSize: 11,
        color: active ? colors.red : colors.textMuted,
        textTransform: 'uppercase', letterSpacing: 0.5,
        cursor: sortKey ? 'pointer' : 'default',
        userSelect: 'none', whiteSpace: 'nowrap',
      }}
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

function applySort(rows, sort) {
  if (!sort.key) return rows;
  return [...rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    const ax = typeof av === 'string' && !isNaN(parseFloat(av)) ? parseFloat(av) : av;
    const bx = typeof bv === 'string' && !isNaN(parseFloat(bv)) ? parseFloat(bv) : bv;
    if (ax == null) return 1;
    if (bx == null) return -1;
    if (ax < bx) return sort.dir === 'asc' ? -1 : 1;
    if (ax > bx) return sort.dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function PlayerCell({ name, team }) {
  const t = getTeam(team);
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

function TeamLink({ teamId }) {
  const t = getTeam(teamId);
  if (!t) return <TeamChip teamId={teamId} small />;
  return (
    <Link to={`/teams/${t.slug}`} style={{ textDecoration: 'none' }}>
      <TeamChip teamId={teamId} small withLogo />
    </Link>
  );
}

function MoveBadge({ change }) {
  if (!change || change === 0) {
    return <span style={{ fontSize: 12, color: colors.textMuted, fontWeight: 600 }}>—</span>;
  }
  const up = change > 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      background: up ? 'rgba(34,197,94,0.12)' : 'rgba(220,38,38,0.12)',
      color: up ? '#16A34A' : '#DC2626',
      padding: '3px 8px', borderRadius: 999,
      fontSize: 11, fontWeight: 700, fontFamily: fonts.condensed,
      letterSpacing: 0.3,
    }}>
      {up ? '▲' : '▼'}{Math.abs(change)}
    </span>
  );
}

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

// ─── Percentile coloring ─────────────────────────────────────────────────────

export const BATTING_COLOR_COLS = {
  runs: 'higher', hits: 'higher', doubles: 'higher', triples: 'higher',
  hr: 'higher', rbi: 'higher',
  bb: 'higher', bbPct: 'higher',
  k: 'lower', kPct: 'lower',
  avg: 'higher', obp: 'higher', slg: 'higher', ops: 'higher', ops_plus: 'higher',
};

export const PITCHING_COLOR_COLS = {
  ip: 'higher',
  hits: 'lower', runs: 'lower', bb: 'lower', hrAllowed: 'lower',
  k: 'higher',
  era: 'lower', whip: 'lower', fip: 'lower',
  k4: 'higher', bb4: 'lower',
};

export function computePercentiles(rows, colConfig) {
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
      let below = 0, ties = 0;
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

export function percentileColor(p) {
  if (p == null) return null;
  if (p >= 85) {
    const t = Math.min(1, (p - 85) / 15);
    const alpha = 0.10 + t * 0.40;
    return `rgba(220, 38, 38, ${alpha.toFixed(2)})`;
  }
  if (p <= 15) {
    const t = Math.min(1, (15 - p) / 15);
    const alpha = 0.10 + t * 0.40;
    return `rgba(37, 99, 235, ${alpha.toFixed(2)})`;
  }
  return null;
}

function bgForCell(percentiles, colKey, row) {
  const map = percentiles[colKey];
  if (!map) return null;
  const pct = map.get(row.playerId ?? row.name);
  return percentileColor(pct);
}

function titleForCell(percentiles, colKey, row) {
  const map = percentiles[colKey];
  if (!map) return '';
  const pct = map.get(row.playerId ?? row.name);
  if (pct == null) return '';
  if (pct >= 85) return `Top ${Math.max(1, Math.round(100 - pct))}% · ${colKey.toUpperCase()}`;
  if (pct <= 15) return `Bottom ${Math.max(1, Math.round(pct))}% · ${colKey.toUpperCase()}`;
  return '';
}

export function PercentileLegend() {
  const swatch = (pct, bordered = false) => (
    <span key={pct} style={{
      display: 'inline-block', width: 16, height: 14,
      background: percentileColor(pct) || colors.bg,
      border: bordered ? `1px solid ${colors.borderLight}` : 'none',
    }} />
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
      border: `1px solid ${colors.borderLight}`, borderRadius: radius.sm,
      flexWrap: 'wrap',
    }}>
      <span style={{ fontFamily: fonts.body, fontSize: 11, fontWeight: 600, color: colors.textSecondary }}>
        Percentile key:
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        {label('← Worst')}
        <span style={{ display: 'inline-flex', marginLeft: 6, marginRight: 2 }}>
          {swatch(0)}{swatch(7)}{swatch(15)}
        </span>
        {label('1st – 15th')}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {swatch(50, true)}
        {label('16th – 84th · no tint')}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        {label('85th – 100th')}
        <span style={{ display: 'inline-flex', marginLeft: 2, marginRight: 6 }}>
          {swatch(85)}{swatch(93)}{swatch(100)}
        </span>
        {label('Best →')}
      </span>
    </div>
  );
}

// ─── Batting table ───────────────────────────────────────────────────────────

export function BattingTable({
  rows,
  populationRows = null,
  title = 'Batting leaders',
  defaultSort = { key: 'ops_plus', dir: 'desc' },
  showSearch = true,
  showLegend = true,
  limit = null,
  emptyMessage = 'No batting data available.',
}) {
  const [sort, setSort] = useState(defaultSort);
  const [search, setSearch] = useState('');

  // Percentiles compute against `populationRows` if provided (e.g. the full
  // league when showing a team-filtered or top-N view). Falls back to `rows`.
  const percentiles = useMemo(() => computePercentiles(populationRows || rows, BATTING_COLOR_COLS), [populationRows, rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? rows.filter(p => p.name.toLowerCase().includes(q) || (p.team || '').toLowerCase().includes(q)) : rows;
    const sorted = applySort(base, sort);
    return limit ? sorted.slice(0, limit) : sorted;
  }, [rows, search, sort, limit]);

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <SectionHeading style={{ margin: 0 }}>{title}</SectionHeading>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <ProWiffleBallBlurb />
          {showSearch && (
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search player or team…"
              style={{ ...inputStyle, maxWidth: 260 }}
            />
          )}
        </div>
      </div>
      {showLegend && (
        <div style={{ padding: '12px 18px', borderBottom: `1px solid ${colors.borderLight}` }}>
          <PercentileLegend />
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="tnum" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: colors.bg }}>
              <SortHeader label="#"      sortKey={null}        currentSort={sort} setSort={setSort} align="center" />
              <SortHeader label="Player" sortKey="name"        currentSort={sort} setSort={setSort} align="left" />
              {/* v4.5.20: swapped Team and Rank — Team reads first
                  because that's the primary identity hook for most
                  scanners; Rank is the BLW-derived composite that
                  rewards a deeper read. */}
              <SortHeader label="Team"   sortKey="team"        currentSort={sort} setSort={setSort} align="left" />
              <SortHeader label="Rank"   sortKey="currentRank" currentSort={sort} setSort={setSort} align="left" />
              <SortHeader label="G"      sortKey="games"       currentSort={sort} setSort={setSort} />
              <SortHeader label="PA"     sortKey="pa"          currentSort={sort} setSort={setSort} />
              <SortHeader label="AB"     sortKey="ab"          currentSort={sort} setSort={setSort} />
              <SortHeader label="R"      sortKey="runs"        currentSort={sort} setSort={setSort} />
              <SortHeader label="H"      sortKey="hits"        currentSort={sort} setSort={setSort} />
              <SortHeader label="2B"     sortKey="doubles"     currentSort={sort} setSort={setSort} />
              <SortHeader label="3B"     sortKey="triples"     currentSort={sort} setSort={setSort} />
              <SortHeader label="HR"     sortKey="hr"          currentSort={sort} setSort={setSort} />
              <SortHeader label="RBI"    sortKey="rbi"         currentSort={sort} setSort={setSort} />
              <SortHeader label="BB"     sortKey="bb"          currentSort={sort} setSort={setSort} />
              <SortHeader label="BB%"    sortKey="bbPct"       currentSort={sort} setSort={setSort} />
              <SortHeader label="K"      sortKey="k"           currentSort={sort} setSort={setSort} />
              <SortHeader label="K%"     sortKey="kPct"        currentSort={sort} setSort={setSort} />
              <SortHeader label="AVG"    sortKey="avg"         currentSort={sort} setSort={setSort} />
              <SortHeader label="OBP"    sortKey="obp"         currentSort={sort} setSort={setSort} />
              <SortHeader label="SLG"    sortKey="slg"         currentSort={sort} setSort={setSort} />
              <SortHeader label="OPS"    sortKey="ops"         currentSort={sort} setSort={setSort} />
              <SortHeader label="OPS+"   sortKey="ops_plus"    currentSort={sort} setSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => (
              <tr key={p.playerId || `${p.name}-${p.team}-${i}`} style={{ borderBottom: `1px solid ${colors.divider}`, background: i % 2 === 0 ? colors.white : colors.bg }}>
                <td style={{ ...cellFor(sort, null), textAlign: 'center', color: colors.textMuted, fontWeight: 700 }}>{i + 1}</td>
                <td style={{ ...cellFor(sort, 'name'), textAlign: 'left' }}><PlayerCell name={p.name} team={p.team} /></td>
                <td style={{ ...cellFor(sort, 'team'), textAlign: 'left' }}><TeamLink teamId={p.team} /></td>
                <td style={{ ...cellFor(sort, 'currentRank'), textAlign: 'left' }}><RankCell row={p} /></td>
                <td style={cellFor(sort, 'games')}>{p.games ?? '—'}</td>
                <td style={cellFor(sort, 'pa')}>{p.pa ?? '—'}</td>
                <td style={cellFor(sort, 'ab')}>{p.ab ?? '—'}</td>
                <td title={titleForCell(percentiles, 'runs', p)}     style={{ ...cellFor(sort, 'runs'),     background: bgForCell(percentiles, 'runs', p) }}>{p.runs ?? '—'}</td>
                <td title={titleForCell(percentiles, 'hits', p)}     style={{ ...cellFor(sort, 'hits'),     background: bgForCell(percentiles, 'hits', p) }}>{p.hits ?? '—'}</td>
                <td title={titleForCell(percentiles, 'doubles', p)}  style={{ ...cellFor(sort, 'doubles'),  background: bgForCell(percentiles, 'doubles', p) }}>{p.doubles ?? '—'}</td>
                <td title={titleForCell(percentiles, 'triples', p)}  style={{ ...cellFor(sort, 'triples'),  background: bgForCell(percentiles, 'triples', p) }}>{p.triples ?? '—'}</td>
                <td title={titleForCell(percentiles, 'hr', p)}       style={{ ...cellFor(sort, 'hr'),       background: bgForCell(percentiles, 'hr', p) }}>{p.hr}</td>
                <td title={titleForCell(percentiles, 'rbi', p)}      style={{ ...cellFor(sort, 'rbi'),      background: bgForCell(percentiles, 'rbi', p) }}>{p.rbi}</td>
                <td title={titleForCell(percentiles, 'bb', p)}       style={{ ...cellFor(sort, 'bb'),       background: bgForCell(percentiles, 'bb', p) }}>{p.bb ?? '—'}</td>
                <td title={titleForCell(percentiles, 'bbPct', p)}    style={{ ...cellFor(sort, 'bbPct'),    background: bgForCell(percentiles, 'bbPct', p) }}>{p.bbPct != null ? `${p.bbPct.toFixed(1)}%` : '—'}</td>
                <td title={titleForCell(percentiles, 'k', p)}        style={{ ...cellFor(sort, 'k'),        background: bgForCell(percentiles, 'k', p) }}>{p.k ?? '—'}</td>
                <td title={titleForCell(percentiles, 'kPct', p)}     style={{ ...cellFor(sort, 'kPct'),     background: bgForCell(percentiles, 'kPct', p) }}>{p.kPct != null ? `${p.kPct.toFixed(1)}%` : '—'}</td>
                <td title={titleForCell(percentiles, 'avg', p)}      style={{ ...cellFor(sort, 'avg'),      background: bgForCell(percentiles, 'avg', p) }}>{p.avg}</td>
                <td title={titleForCell(percentiles, 'obp', p)}      style={{ ...cellFor(sort, 'obp'),      background: bgForCell(percentiles, 'obp', p) }}>{p.obp}</td>
                <td title={titleForCell(percentiles, 'slg', p)}      style={{ ...cellFor(sort, 'slg'),      background: bgForCell(percentiles, 'slg', p) }}>{p.slg}</td>
                <td title={titleForCell(percentiles, 'ops', p)}      style={{ ...cellFor(sort, 'ops'),      background: bgForCell(percentiles, 'ops', p) }}>{p.ops}</td>
                <td title={titleForCell(percentiles, 'ops_plus', p)} style={{ ...cellFor(sort, 'ops_plus'), background: bgForCell(percentiles, 'ops_plus', p) }}>{p.ops_plus}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={22} style={{ padding: 30, textAlign: 'center', color: colors.textMuted }}>
                {search ? `No players match "${search}"` : emptyMessage}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── Pitching table ──────────────────────────────────────────────────────────

export function PitchingTable({
  rows,
  populationRows = null,
  title = 'Pitching leaders',
  defaultSort = { key: 'fip', dir: 'asc' },
  showSearch = true,
  showLegend = true,
  limit = null,
  emptyMessage = 'No pitching data available.',
}) {
  const [sort, setSort] = useState(defaultSort);
  const [search, setSearch] = useState('');

  const percentiles = useMemo(() => computePercentiles(populationRows || rows, PITCHING_COLOR_COLS), [populationRows, rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? rows.filter(p => p.name.toLowerCase().includes(q) || (p.team || '').toLowerCase().includes(q)) : rows;
    const sorted = applySort(base, sort);
    return limit ? sorted.slice(0, limit) : sorted;
  }, [rows, search, sort, limit]);

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <SectionHeading style={{ margin: 0 }}>{title}</SectionHeading>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <ProWiffleBallBlurb />
          {showSearch && (
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search player or team…"
              style={{ ...inputStyle, maxWidth: 260 }}
            />
          )}
        </div>
      </div>
      {showLegend && (
        <div style={{ padding: '12px 18px', borderBottom: `1px solid ${colors.borderLight}` }}>
          <PercentileLegend />
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="tnum" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: colors.bg }}>
              <SortHeader label="#"      sortKey={null}        currentSort={sort} setSort={setSort} align="center" />
              <SortHeader label="Player" sortKey="name"        currentSort={sort} setSort={setSort} align="left" />
              <SortHeader label="Team"   sortKey="team"        currentSort={sort} setSort={setSort} align="left" />
              <SortHeader label="Rank"   sortKey="currentRank" currentSort={sort} setSort={setSort} align="left" />
              <SortHeader label="G"      sortKey="games"       currentSort={sort} setSort={setSort} />
              <SortHeader label="W"      sortKey="w"           currentSort={sort} setSort={setSort} />
              <SortHeader label="L"      sortKey="l"           currentSort={sort} setSort={setSort} />
              <SortHeader label="SV"     sortKey="saves"       currentSort={sort} setSort={setSort} />
              <SortHeader label="IP"     sortKey="ip"          currentSort={sort} setSort={setSort} />
              <SortHeader label="H"      sortKey="hits"        currentSort={sort} setSort={setSort} />
              <SortHeader label="R"      sortKey="runs"        currentSort={sort} setSort={setSort} />
              <SortHeader label="BB"     sortKey="bb"          currentSort={sort} setSort={setSort} />
              <SortHeader label="K"      sortKey="k"           currentSort={sort} setSort={setSort} />
              <SortHeader label="HR"     sortKey="hrAllowed"   currentSort={sort} setSort={setSort} />
              <SortHeader label="ERA"    sortKey="era"         currentSort={sort} setSort={setSort} />
              <SortHeader label="WHIP"   sortKey="whip"        currentSort={sort} setSort={setSort} />
              <SortHeader label="K/4"    sortKey="k4"          currentSort={sort} setSort={setSort} />
              <SortHeader label="BB/4"   sortKey="bb4"         currentSort={sort} setSort={setSort} />
              {/* FIP is the marquee — anchored at the end so the eye lands
                  on it last and the table reads "results, then quality." */}
              <SortHeader label="FIP"    sortKey="fip"         currentSort={sort} setSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => (
              <tr key={p.playerId || `${p.name}-${p.team}-${i}`} style={{ borderBottom: `1px solid ${colors.divider}`, background: i % 2 === 0 ? colors.white : colors.bg }}>
                <td style={{ ...cellFor(sort, null), textAlign: 'center', color: colors.textMuted, fontWeight: 700 }}>{i + 1}</td>
                <td style={{ ...cellFor(sort, 'name'), textAlign: 'left' }}><PlayerCell name={p.name} team={p.team} /></td>
                <td style={{ ...cellFor(sort, 'team'), textAlign: 'left' }}><TeamLink teamId={p.team} /></td>
                <td style={{ ...cellFor(sort, 'currentRank'), textAlign: 'left' }}><RankCell row={p} /></td>
                <td style={cellFor(sort, 'games')}>{p.games ?? '—'}</td>
                <td style={cellFor(sort, 'w')}>{p.w}</td>
                <td style={cellFor(sort, 'l')}>{p.l}</td>
                <td style={cellFor(sort, 'saves')}>{p.saves ?? 0}</td>
                <td title={titleForCell(percentiles, 'ip', p)}        style={{ ...cellFor(sort, 'ip'),        background: bgForCell(percentiles, 'ip', p) }}>{p.ip}</td>
                <td title={titleForCell(percentiles, 'hits', p)}      style={{ ...cellFor(sort, 'hits'),      background: bgForCell(percentiles, 'hits', p) }}>{p.hits ?? '—'}</td>
                <td title={titleForCell(percentiles, 'runs', p)}      style={{ ...cellFor(sort, 'runs'),      background: bgForCell(percentiles, 'runs', p) }}>{p.runs ?? '—'}</td>
                <td title={titleForCell(percentiles, 'bb', p)}        style={{ ...cellFor(sort, 'bb'),        background: bgForCell(percentiles, 'bb', p) }}>{p.bb ?? '—'}</td>
                <td title={titleForCell(percentiles, 'k', p)}         style={{ ...cellFor(sort, 'k'),         background: bgForCell(percentiles, 'k', p) }}>{p.k ?? '—'}</td>
                <td title={titleForCell(percentiles, 'hrAllowed', p)} style={{ ...cellFor(sort, 'hrAllowed'), background: bgForCell(percentiles, 'hrAllowed', p) }}>{p.hrAllowed ?? '—'}</td>
                <td title={titleForCell(percentiles, 'era', p)}       style={{ ...cellFor(sort, 'era'),       background: bgForCell(percentiles, 'era', p) }}>{p.era}</td>
                <td title={titleForCell(percentiles, 'whip', p)}      style={{ ...cellFor(sort, 'whip'),      background: bgForCell(percentiles, 'whip', p) }}>{p.whip}</td>
                <td title={titleForCell(percentiles, 'k4', p)}        style={{ ...cellFor(sort, 'k4'),        background: bgForCell(percentiles, 'k4', p) }}>{p.k4}</td>
                <td title={titleForCell(percentiles, 'bb4', p)}       style={{ ...cellFor(sort, 'bb4'),       background: bgForCell(percentiles, 'bb4', p) }}>{p.bb4}</td>
                <td title={titleForCell(percentiles, 'fip', p)}       style={{ ...cellFor(sort, 'fip'),       background: bgForCell(percentiles, 'fip', p) }}>{typeof p.fip === 'number' ? p.fip.toFixed(2) : p.fip}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={19} style={{ padding: 30, textAlign: 'center', color: colors.textMuted }}>
                {search ? `No players match "${search}"` : emptyMessage}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
