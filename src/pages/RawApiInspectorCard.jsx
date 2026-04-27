// Admin diagnostic: hits the Grand Slam Systems API directly (no caching,
// no normalization, no canonicalization) and dumps the raw JSON of any
// rows whose name loosely matches the search term. The point is to STOP
// guessing what the API returns and actually look at it. If a player has
// stats in the API but we're showing em-dashes, this tool shows whether
// it's a matching problem (rows exist, our code missed them) or a data
// problem (API never had those stats).
//
// Endpoints inspected:
//   - /leagues/3/batting-stats?showAll=true
//   - /leagues/3/pitching-stats?showAll=true
//   - /rankings/0?showAll=true
//   - /teams/{id}/roster   (one per BLW team)

import { useState } from 'react';
import { Card, SectionHeading } from '../components';
import { colors, fonts, radius } from '../theme';
import { TEAMS } from '../data';

const GSS_BASE = '/api/gss';
const BLW_LEAGUE_ID = 3;

// Loose match: any name token (lastname, firstname, nickname-bracket) on
// either side that contains the search term. Intentionally permissive —
// we'd rather over-match in the inspector than miss a row.
function looseMatch(rowName, query) {
  if (!rowName || !query) return false;
  const norm = (s) => String(s).toLowerCase().replace(/[.,'"`]/g, '').trim();
  const q = norm(query);
  if (!q) return false;
  const name = norm(rowName);
  if (name.includes(q)) return true;
  // Also try last-token match so "richardson" hits "Jackson C. Richardson"
  const qTokens = q.split(/\s+/).filter(Boolean);
  const nameTokens = name.split(/\s+/).filter(Boolean);
  if (qTokens.length === 1 && nameTokens.includes(qTokens[0])) return true;
  return false;
}

async function safeFetchJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const status = res.status;
    let body = null;
    try { body = await res.json(); } catch { body = await res.text().catch(() => null); }
    return { ok: res.ok, status, body, url };
  } catch (e) {
    return { ok: false, status: 0, body: { error: String(e) }, url };
  }
}

// Pull the array off whatever shape the endpoint returned. GSS is
// inconsistent — sometimes the rows are at the top level, sometimes
// nested under .data, .players, .roster, .leaders, etc.
function extractRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  for (const key of ['data', 'players', 'roster', 'leaders', 'rankings', 'results', 'rows']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  // Last resort: find the first array-valued property.
  for (const v of Object.values(payload)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
  }
  return [];
}

// Try every name-ish key the API might use. Returns the first non-empty.
function nameOf(row) {
  if (!row || typeof row !== 'object') return '';
  for (const k of ['name', 'fullName', 'playerName', 'displayName']) {
    if (row[k]) return String(row[k]);
  }
  const first = row.firstName || row.first_name || row.first || '';
  const last = row.lastName || row.last_name || row.last || '';
  if (first || last) return `${first} ${last}`.trim();
  return '';
}

export default function RawApiInspectorCard() {
  const [query, setQuery] = useState('Jackson Richardson');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);

  const run = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResults(null);
    try {
      // Fire all endpoints in parallel.
      const teamRosterCalls = TEAMS.map(t =>
        safeFetchJson(`${GSS_BASE}/teams/${t.apiTeamId}/roster`).then(r => ({ ...r, _team: t }))
      );
      const [batting, pitching, rankings, ...rosters] = await Promise.all([
        safeFetchJson(`${GSS_BASE}/leagues/${BLW_LEAGUE_ID}/batting-stats?showAll=true`),
        safeFetchJson(`${GSS_BASE}/leagues/${BLW_LEAGUE_ID}/pitching-stats?showAll=true`),
        safeFetchJson(`${GSS_BASE}/rankings/0?showAll=true`),
        ...teamRosterCalls,
      ]);

      const filterMatches = (resp) => {
        const rows = extractRows(resp.body);
        return rows.filter(r => looseMatch(nameOf(r), query));
      };

      const out = {
        query,
        batting: { meta: { url: batting.url, status: batting.status, totalRows: extractRows(batting.body).length }, matches: filterMatches(batting) },
        pitching: { meta: { url: pitching.url, status: pitching.status, totalRows: extractRows(pitching.body).length }, matches: filterMatches(pitching) },
        rankings: { meta: { url: rankings.url, status: rankings.status, totalRows: extractRows(rankings.body).length }, matches: filterMatches(rankings) },
        rosters: rosters.map(r => ({
          team: r._team.id,
          teamName: r._team.name,
          meta: { url: r.url, status: r.status, totalRows: extractRows(r.body).length },
          matches: filterMatches(r),
        })),
      };
      setResults(out);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e) => { e.preventDefault(); run(); };

  return (
    <Card>
      <SectionHeading>Raw API inspector</SectionHeading>
      <p style={{ fontSize: 12, color: colors.textSecondary, margin: '0 0 12px', lineHeight: 1.5 }}>
        Hits the Grand Slam Systems API directly with <strong>no caching, no normalization, no canonicalization</strong>.
        Loose-matches your query against every row from batting, pitching, rankings, and all 10 team rosters. Use this
        to verify what the API <em>actually</em> returns for a given player before assuming our matching code is wrong.
      </p>

      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Player name (e.g. Jackson Richardson)"
          style={{
            flex: 1, padding: '8px 12px', fontSize: 13,
            border: `1px solid ${colors.border}`, borderRadius: radius.sm,
            background: colors.surface, color: colors.text,
            fontFamily: fonts.body,
          }}
        />
        <button type="submit" disabled={loading || !query.trim()} style={{
          padding: '8px 16px', borderRadius: radius.sm, fontSize: 11, fontWeight: 700,
          letterSpacing: 0.5, fontFamily: fonts.condensed, textTransform: 'uppercase',
          background: colors.red, color: '#fff', border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
        }}>{loading ? 'Fetching…' : 'Inspect'}</button>
      </form>

      {results && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SummaryBar results={results} />
          <EndpointBlock title="Batting leaders" payload={results.batting} />
          <EndpointBlock title="Pitching leaders" payload={results.pitching} />
          <EndpointBlock title="Rankings" payload={results.rankings} />
          <SectionHeading style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>Team rosters</SectionHeading>
          {results.rosters.map(r => (
            <EndpointBlock
              key={r.team}
              title={`${r.team} — ${r.teamName}`}
              payload={r}
              hideEmpty
            />
          ))}
        </div>
      )}

      {!results && !loading && (
        <div style={{ fontSize: 12, color: colors.textMuted, padding: 12, textAlign: 'center' }}>
          Enter a player name above and click <strong>Inspect</strong>.
        </div>
      )}
    </Card>
  );
}

function SummaryBar({ results }) {
  const totalMatches =
    results.batting.matches.length +
    results.pitching.matches.length +
    results.rankings.matches.length +
    results.rosters.reduce((acc, r) => acc + r.matches.length, 0);
  const teamsWithMatch = results.rosters.filter(r => r.matches.length > 0).map(r => r.team);
  return (
    <div style={{
      padding: 10, background: colors.bg, border: `1px solid ${colors.borderLight}`,
      borderRadius: radius.base, fontSize: 12, color: colors.textSecondary,
      display: 'flex', flexWrap: 'wrap', gap: 12,
    }}>
      <span><strong style={{ color: colors.text }}>{totalMatches}</strong> total matches for "{results.query}"</span>
      <span>·</span>
      <span>Batting: <strong style={{ color: colors.text }}>{results.batting.matches.length}</strong></span>
      <span>Pitching: <strong style={{ color: colors.text }}>{results.pitching.matches.length}</strong></span>
      <span>Rankings: <strong style={{ color: colors.text }}>{results.rankings.matches.length}</strong></span>
      <span>Rosters: <strong style={{ color: colors.text }}>{teamsWithMatch.join(', ') || 'none'}</strong></span>
    </div>
  );
}

function EndpointBlock({ title, payload, hideEmpty }) {
  const [expanded, setExpanded] = useState(payload.matches.length > 0);
  if (hideEmpty && payload.matches.length === 0) return null;

  const statusColor = payload.meta.status >= 200 && payload.meta.status < 300 ? colors.text : '#B91C1C';

  return (
    <div style={{ border: `1px solid ${colors.borderLight}`, borderRadius: radius.base, overflow: 'hidden' }}>
      <button onClick={() => setExpanded(e => !e)} style={{
        width: '100%', textAlign: 'left', padding: '10px 12px',
        background: colors.bg, border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontFamily: fonts.condensed, fontSize: 12, fontWeight: 700, color: colors.text,
        letterSpacing: 0.4, textTransform: 'uppercase',
      }}>
        <span>{title} · <span style={{ color: statusColor }}>HTTP {payload.meta.status}</span> · {payload.meta.totalRows} rows · <span style={{ color: payload.matches.length ? '#15803D' : colors.textMuted }}>{payload.matches.length} match{payload.matches.length === 1 ? '' : 'es'}</span></span>
        <span style={{ color: colors.textMuted, fontSize: 14 }}>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div style={{ padding: 12, background: colors.surface }}>
          <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 8, fontFamily: 'ui-monospace, Menlo, monospace' }}>
            GET {payload.meta.url}
          </div>
          {payload.matches.length === 0 ? (
            <div style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic' }}>
              No matching rows. {payload.meta.totalRows === 0 ? 'Endpoint returned 0 rows total — likely a payload-shape issue, not a data issue.' : `Endpoint returned ${payload.meta.totalRows} rows but none matched the query.`}
            </div>
          ) : (
            <pre style={{
              margin: 0, padding: 10, background: colors.bg, borderRadius: radius.sm,
              fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, lineHeight: 1.5,
              color: colors.text, overflowX: 'auto', maxHeight: 400,
              border: `1px solid ${colors.borderLight}`,
            }}>{JSON.stringify(payload.matches, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}
