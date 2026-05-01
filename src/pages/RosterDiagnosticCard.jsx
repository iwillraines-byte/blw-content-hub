// Admin diagnostic: cross-references every CANONICAL_ROSTER_2026 player
// against what the Grand Slam Systems API actually returns. Shows the
// raw API name, raw API team, playerID, and which datasets they appear
// in (batting / pitching / rankings). Lets us pinpoint exactly why a
// player isn't matching — wrong name format, missing from the API
// entirely, on the wrong team, etc.

import { useEffect, useState } from 'react';
import { Card, CollapsibleCard, SectionHeading } from '../components';
import { colors, fonts, radius } from '../theme';
import { CANONICAL_ROSTER_2026, fetchAllData, fetchAllRosters, invalidateLeagueCaches } from '../data';

// Loose lastname matcher — "Jackson Richardson" should hit any API row
// whose lastname is "Richardson" regardless of middle initials, suffixes,
// etc. Used as the diagnostic fallback when exact match misses.
function looseLastnameMatch(canonName, apiName) {
  if (!canonName || !apiName) return false;
  const norm = (s) => String(s).toLowerCase().replace(/[.,'"`]/g, '').trim();
  const apiParts = norm(apiName).split(/\s+/);
  const canonParts = norm(canonName).split(/\s+/);
  if (canonParts.length === 0 || apiParts.length === 0) return false;
  return apiParts[apiParts.length - 1] === canonParts[canonParts.length - 1];
}

export default function RosterDiagnosticCard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all'); // all | missing | name-mismatch

  const run = async ({ force = false } = {}) => {
    setLoading(true);
    try {
      // The Refresh button always forces a fresh API pull — otherwise
      // the 5-minute TTL means we'd keep showing the same cached state
      // and the user couldn't verify whether new code changed anything.
      if (force) invalidateLeagueCaches();
      const [{ batting, pitching, rankings }, allRosters] = await Promise.all([
        fetchAllData(),
        fetchAllRosters(),
      ]);
      const byNorm = (s) => String(s || '').toLowerCase().trim();
      const bIndex = new Map(batting.map(p => [byNorm(p.name), p]));
      const pIndex = new Map(pitching.map(p => [byNorm(p.name), p]));
      const rIndex = new Map(rankings.map(p => [byNorm(p.name), p]));
      const rosterIndex = new Map();
      for (const rp of allRosters) {
        if (rp.name) rosterIndex.set(byNorm(rp.name), rp);
      }

      const out = [];
      for (const c of CANONICAL_ROSTER_2026) {
        const k = byNorm(c.name);
        const exactBat = bIndex.get(k);
        const exactPit = pIndex.get(k);
        const exactRank = rIndex.get(k);
        const exactRoster = rosterIndex.get(k);

        // If exact misses, try to locate ANY row that matches this player's
        // lastname — surfaces "API has 'Jackson C. Richardson' but you're
        // looking for 'Jackson Richardson'" style mismatches.
        let looseHits = [];
        if (!exactBat && !exactPit && !exactRank && !exactRoster) {
          for (const arr of [batting, pitching, rankings, allRosters]) {
            for (const p of arr) {
              if (p?.name && looseLastnameMatch(c.name, p.name)) {
                looseHits.push({
                  name: p.name,
                  team: p.team,
                  playerId: p.playerId || null,
                });
                if (looseHits.length >= 4) break;
              }
            }
          }
        }

        out.push({
          canonical: c.name,
          team: c.team,
          inBatting: !!exactBat,
          inPitching: !!exactPit,
          inRankings: !!exactRank,
          inRoster: !!exactRoster,
          batPlayerId: exactBat?.playerId || null,
          pitPlayerId: exactPit?.playerId || null,
          rankPlayerId: exactRank?.playerId || null,
          rosterPlayerId: exactRoster?.playerId || null,
          rosterApiTeam: exactRoster?.team || null,
          looseHits,
        });
      }
      setRows(out);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { run(); }, []);

  const visible = rows.filter(r => {
    if (filter === 'missing') return !r.inBatting && !r.inPitching && !r.inRankings && !r.inRoster;
    if (filter === 'name-mismatch') return !r.inBatting && !r.inPitching && !r.inRankings && !r.inRoster && r.looseHits.length > 0;
    return true;
  });

  const stats = {
    total: rows.length,
    inBatting: rows.filter(r => r.inBatting).length,
    inPitching: rows.filter(r => r.inPitching).length,
    inRankings: rows.filter(r => r.inRankings).length,
    inRoster: rows.filter(r => r.inRoster).length,
    completelyMissing: rows.filter(r => !r.inBatting && !r.inPitching && !r.inRankings && !r.inRoster && r.looseHits.length === 0).length,
    nameMismatch: rows.filter(r => !r.inBatting && !r.inPitching && !r.inRankings && !r.inRoster && r.looseHits.length > 0).length,
  };

  // v4.5.16: roster diagnostic is now a collapsible dropdown — defaults
  // closed so the master settings page isn't dominated by a 70-row
  // table on every visit. Click to expand when actually debugging an
  // API mismatch.
  const summary = rows.length
    ? `${rows.filter(r => !r.exactBat && !r.exactPit && !r.exactRank).length} mismatches across ${rows.length} canonical players`
    : 'Click to load';

  return (
    <CollapsibleCard
      title="Roster diagnostic"
      summary={summary}
      defaultOpen={false}
      storageKey="settings.collapse.rosterDiag"
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button onClick={() => run({ force: true })} disabled={loading} style={{
          padding: '6px 12px', borderRadius: radius.sm, fontSize: 11, fontWeight: 700,
          letterSpacing: 0.4, fontFamily: fonts.condensed, textTransform: 'uppercase',
          background: 'transparent', color: colors.textSecondary,
          border: `1px solid ${colors.border}`, cursor: 'pointer',
        }}>{loading ? 'Loading…' : '↻ Force refresh'}</button>
      </div>
      <p style={{ fontSize: 12, color: colors.textSecondary, margin: '0 0 12px', lineHeight: 1.5 }}>
        Cross-references every canonical player against the Grand Slam API. Use this to figure out why a specific player isn't matching: wrong name format (look at <strong>Loose hits</strong>), absent from the API entirely, or wrong team.
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <Pill label={`Canonical · ${stats.total}`} />
        <Pill label={`Batting · ${stats.inBatting}`} tone="success" />
        <Pill label={`Pitching · ${stats.inPitching}`} tone="info" />
        <Pill label={`Rankings · ${stats.inRankings}`} tone="info" />
        <Pill label={`Roster API · ${stats.inRoster}`} tone="info" />
        <Pill label={`Name mismatch · ${stats.nameMismatch}`} tone="warn" />
        <Pill label={`Missing · ${stats.completelyMissing}`} tone="danger" />
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {[
          { id: 'all',           label: `All (${rows.length})` },
          { id: 'name-mismatch', label: `Name mismatch (${stats.nameMismatch})` },
          { id: 'missing',       label: `Completely missing (${stats.completelyMissing + stats.nameMismatch})` },
        ].map(t => (
          <button key={t.id} onClick={() => setFilter(t.id)} style={{
            padding: '5px 10px', borderRadius: radius.sm, fontSize: 11, fontWeight: 700,
            background: filter === t.id ? colors.redLight : colors.bg,
            color: filter === t.id ? colors.red : colors.textSecondary,
            border: `1px solid ${filter === t.id ? colors.redBorder : colors.border}`,
            cursor: 'pointer',
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ overflowX: 'auto', border: `1px solid ${colors.borderLight}`, borderRadius: radius.base }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: colors.bg, textAlign: 'left' }}>
              <Th>Canonical name</Th>
              <Th>Team</Th>
              <Th title="Found in batting / pitching / rankings / roster API">B/P/R/RO</Th>
              <Th>API playerID</Th>
              <Th>Loose hits (different name in API)</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const flags = [
                r.inBatting  ? 'B' : '·',
                r.inPitching ? 'P' : '·',
                r.inRankings ? 'R' : '·',
                r.inRoster   ? 'O' : '·',
              ].join(' ');
              const pid = r.batPlayerId || r.pitPlayerId || r.rankPlayerId || r.rosterPlayerId;
              const isMissing = !r.inBatting && !r.inPitching && !r.inRankings && !r.inRoster;
              return (
                <tr key={r.canonical + r.team} style={{
                  borderTop: i ? `1px solid ${colors.divider}` : 'none',
                  background: isMissing ? 'rgba(221,60,60,0.04)' : 'transparent',
                }}>
                  <Td><strong>{r.canonical}</strong></Td>
                  <Td>{r.team}</Td>
                  <Td><code style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{flags}</code></Td>
                  <Td>{pid || <span style={{ color: colors.textMuted }}>—</span>}</Td>
                  <Td>
                    {r.looseHits.length === 0 ? (
                      <span style={{ color: colors.textMuted }}>—</span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {r.looseHits.map((h, j) => (
                          <span key={j}>
                            <strong>{h.name}</strong>
                            {h.team && <span style={{ color: colors.textMuted }}> · {h.team}</span>}
                            {h.playerId != null && <span style={{ color: colors.textMuted }}> · #{h.playerId}</span>}
                          </span>
                        ))}
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
            {visible.length === 0 && !loading && (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: colors.textMuted }}>
                Nothing in this filter. Pick a different one.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </CollapsibleCard>
  );
}

function Pill({ label, tone }) {
  const palette = {
    success: { bg: 'rgba(34, 197, 94, 0.10)',  fg: '#15803D', bd: 'rgba(34, 197, 94, 0.3)' },
    info:    { bg: 'rgba(59, 130, 246, 0.10)', fg: '#1D4ED8', bd: 'rgba(59, 130, 246, 0.3)' },
    warn:    { bg: 'rgba(251, 191, 36, 0.10)', fg: '#92400E', bd: 'rgba(251, 191, 36, 0.4)' },
    danger:  { bg: 'rgba(221, 60, 60, 0.10)',  fg: '#991B1B', bd: 'rgba(221, 60, 60, 0.35)' },
  }[tone] || { bg: colors.bg, fg: colors.textSecondary, bd: colors.borderLight };
  return (
    <span style={{
      display: 'inline-flex', padding: '3px 10px', borderRadius: radius.full,
      background: palette.bg, color: palette.fg, border: `1px solid ${palette.bd}`,
      fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
    }}>{label}</span>
  );
}

const Th = ({ children, ...p }) => (
  <th {...p} style={{
    padding: '8px 10px', textAlign: 'left',
    fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
    color: colors.textSecondary, letterSpacing: 0.6, textTransform: 'uppercase',
  }}>{children}</th>
);
const Td = ({ children }) => (
  <td style={{ padding: '8px 10px', verticalAlign: 'top' }}>{children}</td>
);
