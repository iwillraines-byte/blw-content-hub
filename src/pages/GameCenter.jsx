import { useState, useEffect } from 'react';
import { fetchAllData, TEAMS, API_CONFIG } from '../data';
import { Card, PageHeader, SectionHeading, TeamChip, Label } from '../components';
import { colors, fonts, radius } from '../theme';

export default function GameCenter() {
  const [tab, setTab] = useState('batting');
  const [batting, setBatting] = useState([]);
  const [pitching, setPitching] = useState([]);
  const [rankings, setRankings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAllData().then(({ batting: b, pitching: p, rankings: r }) => {
      setBatting(b); setPitching(p); setRankings(r); setLoading(false);
    });
  }, []);

  const tabStyle = (active) => ({
    background: active ? colors.redLight : colors.white,
    border: active ? `1px solid ${colors.redBorder}` : `1px solid ${colors.border}`,
    color: active ? colors.red : colors.textSecondary,
    borderRadius: radius.base,
    padding: '8px 18px',
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  });

  const thStyle = (highlight) => ({
    padding: '10px 12px',
    textAlign: 'right',
    fontFamily: fonts.condensed,
    fontWeight: 600,
    fontSize: 11,
    color: highlight ? colors.red : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  });

  const tdStyle = (highlight) => ({
    padding: '10px 12px',
    textAlign: 'right',
    fontSize: 13,
    fontWeight: highlight ? 800 : 500,
    color: highlight ? colors.red : colors.text,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="GAME CENTER" subtitle="Stats, standings, and live game infrastructure from prowiffleball.com" />

      {/* API Status */}
      <Card style={{
        padding: 14,
        background: API_CONFIG.isLive ? colors.successBg : colors.warningBg,
        border: `1px solid ${API_CONFIG.isLive ? colors.successBorder : colors.warningBorder}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>{API_CONFIG.isLive ? '🟢' : '🟡'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#15803D' }}>
              Live API Connected — Grand Slam Systems
            </div>
            <div style={{ fontSize: 12, color: colors.textSecondary }}>
              {batting.length} batters · {pitching.length} pitchers · {rankings.length} ranked players
            </div>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setTab('batting')} style={tabStyle(tab === 'batting')}>Batting (OPS+)</button>
        <button onClick={() => setTab('pitching')} style={tabStyle(tab === 'pitching')}>Pitching (FIP)</button>
        <button onClick={() => setTab('rankings')} style={tabStyle(tab === 'rankings')}>Player Rankings</button>
        <button onClick={() => setTab('standings')} style={tabStyle(tab === 'standings')}>Standings</button>
      </div>

      {loading && <Card style={{ textAlign: 'center', color: colors.textMuted, padding: 40 }}>Loading stats...</Card>}

      {/* Batting */}
      {!loading && tab === 'batting' && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: `1px solid ${colors.border}` }}>
            <SectionHeading style={{ margin: 0 }}>BATTING LEADERS — OPS+</SectionHeading>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: colors.bg }}>
                  <th style={{ ...thStyle(false), textAlign: 'center', width: 40 }}>#</th>
                  <th style={{ ...thStyle(false), textAlign: 'left' }}>Player</th>
                  <th style={{ ...thStyle(false), textAlign: 'left' }}>Team</th>
                  <th style={thStyle(true)}>OPS+</th>
                  <th style={thStyle(false)}>AVG</th>
                  <th style={thStyle(false)}>OBP</th>
                  <th style={thStyle(false)}>SLG</th>
                  <th style={thStyle(false)}>HR</th>
                </tr>
              </thead>
              <tbody>
                {batting.map((p, i) => (
                  <tr key={p.rank} style={{ borderBottom: `1px solid ${colors.divider}`, background: i % 2 === 0 ? colors.white : colors.bg }}>
                    <td style={{ ...tdStyle(false), textAlign: 'center', color: colors.textMuted, fontWeight: 700 }}>{p.rank}</td>
                    <td style={{ ...tdStyle(false), textAlign: 'left', fontWeight: 700 }}>{p.name}</td>
                    <td style={{ ...tdStyle(false), textAlign: 'left' }}><TeamChip teamId={p.team} small /></td>
                    <td style={{ ...tdStyle(true), fontSize: 15 }}>{p.ops_plus}</td>
                    <td style={tdStyle(false)}>{p.avg}</td>
                    <td style={tdStyle(false)}>{p.obp}</td>
                    <td style={tdStyle(false)}>{p.slg}</td>
                    <td style={{ ...tdStyle(false), fontWeight: 700 }}>{p.hr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Pitching */}
      {!loading && tab === 'pitching' && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: `1px solid ${colors.border}` }}>
            <SectionHeading style={{ margin: 0 }}>PITCHING LEADERS — FIP</SectionHeading>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: colors.bg }}>
                  <th style={{ ...thStyle(false), textAlign: 'center', width: 40 }}>#</th>
                  <th style={{ ...thStyle(false), textAlign: 'left' }}>Player</th>
                  <th style={{ ...thStyle(false), textAlign: 'left' }}>Team</th>
                  <th style={thStyle(true)}>FIP</th>
                  <th style={thStyle(false)}>ERA</th>
                  <th style={thStyle(false)}>IP</th>
                  <th style={thStyle(false)}>K/4</th>
                  <th style={thStyle(false)}>W</th>
                  <th style={thStyle(false)}>L</th>
                </tr>
              </thead>
              <tbody>
                {pitching.map((p, i) => (
                  <tr key={p.rank} style={{ borderBottom: `1px solid ${colors.divider}`, background: i % 2 === 0 ? colors.white : colors.bg }}>
                    <td style={{ ...tdStyle(false), textAlign: 'center', color: colors.textMuted, fontWeight: 700 }}>{p.rank}</td>
                    <td style={{ ...tdStyle(false), textAlign: 'left', fontWeight: 700 }}>{p.name}</td>
                    <td style={{ ...tdStyle(false), textAlign: 'left' }}><TeamChip teamId={p.team} small /></td>
                    <td style={{ ...tdStyle(true), fontSize: 15 }}>{p.fip.toFixed(2)}</td>
                    <td style={tdStyle(false)}>{p.era}</td>
                    <td style={tdStyle(false)}>{p.ip}</td>
                    <td style={tdStyle(false)}>{p.k4}</td>
                    <td style={{ ...tdStyle(false), fontWeight: 700 }}>{p.w}</td>
                    <td style={{ ...tdStyle(false), color: colors.textMuted }}>{p.l}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Rankings */}
      {!loading && tab === 'rankings' && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: `1px solid ${colors.border}` }}>
            <SectionHeading style={{ margin: 0 }}>PLAYER RANKINGS — COMPOSITE POINTS</SectionHeading>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: colors.bg }}>
                  <th style={{ ...thStyle(false), textAlign: 'center', width: 40 }}>#</th>
                  <th style={{ ...thStyle(false), textAlign: 'left' }}>Player</th>
                  <th style={thStyle(false)}>Move</th>
                  <th style={thStyle(true)}>Points</th>
                  <th style={thStyle(false)}>Avg Pts</th>
                  <th style={thStyle(false)}>Composite</th>
                </tr>
              </thead>
              <tbody>
                {rankings.slice(0, 30).map((p, i) => (
                  <tr key={p.playerId} style={{ borderBottom: `1px solid ${colors.divider}`, background: i % 2 === 0 ? colors.white : colors.bg }}>
                    <td style={{ ...tdStyle(false), textAlign: 'center', color: colors.textMuted, fontWeight: 700 }}>{p.currentRank}</td>
                    <td style={{ ...tdStyle(false), textAlign: 'left', fontWeight: 700 }}>{p.name}</td>
                    <td style={{
                      ...tdStyle(false), fontWeight: 700, fontSize: 12,
                      color: p.rankChange > 0 ? '#16A34A' : p.rankChange < 0 ? '#DC2626' : colors.textMuted,
                    }}>
                      {p.rankChange > 0 ? `+${p.rankChange}` : p.rankChange < 0 ? p.rankChange : '—'}
                    </td>
                    <td style={{ ...tdStyle(true), fontSize: 15 }}>{p.totalPoints.toLocaleString()}</td>
                    <td style={tdStyle(false)}>{p.averagePoints.toFixed(0)}</td>
                    <td style={tdStyle(false)}>{p.compositePoints.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Standings */}
      {!loading && tab === 'standings' && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: `1px solid ${colors.border}` }}>
            <SectionHeading style={{ margin: 0 }}>2025-26 BLW STANDINGS</SectionHeading>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: colors.bg }}>
                  <th style={{ ...thStyle(false), textAlign: 'center', width: 40 }}>#</th>
                  <th style={{ ...thStyle(false), textAlign: 'left' }}>Team</th>
                  <th style={thStyle(false)}>W</th>
                  <th style={thStyle(false)}>L</th>
                  <th style={thStyle(true)}>PCT</th>
                  <th style={thStyle(false)}>DIFF</th>
                </tr>
              </thead>
              <tbody>
                {TEAMS.map((t, i) => {
                  const [w, l] = t.record.split('-');
                  return (
                    <tr key={t.id} style={{ borderBottom: `1px solid ${colors.divider}`, background: i % 2 === 0 ? colors.white : colors.bg }}>
                      <td style={{ ...tdStyle(false), textAlign: 'center', color: colors.textMuted, fontWeight: 700 }}>{t.rank}</td>
                      <td style={{ ...tdStyle(false), textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{
                            width: 28, height: 28, borderRadius: 6,
                            background: t.color, color: t.accent,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700
                          }}>{t.id}</span>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{t.name}</div>
                            {t.owner && <div style={{ fontSize: 10, color: colors.textMuted }}>{t.owner}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ ...tdStyle(false), fontWeight: 700 }}>{w}</td>
                      <td style={{ ...tdStyle(false), fontWeight: 700 }}>{l}</td>
                      <td style={{ ...tdStyle(true), fontSize: 15 }}>{t.pct}</td>
                      <td style={{
                        ...tdStyle(false), fontWeight: 700,
                        color: t.diff.startsWith('+') && t.diff !== '0' ? '#16A34A' : t.diff === '0' ? colors.textMuted : '#DC2626'
                      }}>{t.diff}</td>
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
