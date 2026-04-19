import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fetchAllData, fetchAllRosters, getAllPlayersDirectory, TEAMS, getTeam, slugify, API_CONFIG } from '../data';
import { Card, PageHeader, SectionHeading, TeamChip, TeamLogo, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { getAllMedia } from '../media-store';
import { getAllManualPlayers } from '../player-store';

// Helper: render a sortable header
function SortHeader({ label, sortKey, currentSort, setSort, align = 'right', highlight = false }) {
  const active = currentSort.key === sortKey;
  const thStyle = {
    padding: '10px 12px', textAlign: align,
    fontFamily: fonts.condensed, fontWeight: 600, fontSize: 11,
    color: active ? colors.red : (highlight ? colors.red : colors.textMuted),
    textTransform: 'uppercase', letterSpacing: 0.5,
    cursor: sortKey ? 'pointer' : 'default',
    userSelect: 'none',
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
    <Link to={`/teams/${t.slug}/players/${slugify(lastName)}`} style={{
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
  const [rankingsSort, setRankingsSort] = useState({ key: 'currentRank', dir: 'asc' });
  const [playersSort, setPlayersSort] = useState({ key: 'team', dir: 'asc' });

  useEffect(() => {
    fetchAllData().then(({ batting: b, pitching: p, rankings: r }) => {
      setBatting(b); setPitching(p); setRankings(r); setLoading(false);
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
      <PageHeader title="GAME CENTER" subtitle="Stats, rankings, and standings from Grand Slam Systems" />

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
            <SectionHeading style={{ margin: 0 }}>BATTING LEADERS</SectionHeading>
            <input
              type="text"
              value={battingSearch}
              onChange={e => setBattingSearch(e.target.value)}
              placeholder="Search player or team…"
              style={{ ...inputStyle, maxWidth: 260 }}
            />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: colors.bg }}>
                  <SortHeader label="#" sortKey={null} currentSort={battingSort} setSort={setBattingSort} align="center" />
                  <SortHeader label="Player" sortKey="name" currentSort={battingSort} setSort={setBattingSort} align="left" />
                  <SortHeader label="Team" sortKey="team" currentSort={battingSort} setSort={setBattingSort} align="left" />
                  <SortHeader label="OPS+" sortKey="ops_plus" currentSort={battingSort} setSort={setBattingSort} highlight />
                  <SortHeader label="AVG" sortKey="avg" currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="OBP" sortKey="obp" currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="SLG" sortKey="slg" currentSort={battingSort} setSort={setBattingSort} />
                  <SortHeader label="HR" sortKey="hr" currentSort={battingSort} setSort={setBattingSort} />
                </tr>
              </thead>
              <tbody>
                {filteredBatting.map((p, i) => (
                  <tr key={p.playerId || p.rank} style={{ borderBottom: `1px solid ${colors.divider}`, background: i % 2 === 0 ? colors.white : colors.bg }}>
                    <td style={{ ...tdStyle(false), textAlign: 'center', color: colors.textMuted, fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ ...tdStyle(false), textAlign: 'left' }}><PlayerCell name={p.name} team={p.team} /></td>
                    <td style={{ ...tdStyle(false), textAlign: 'left' }}><TeamLink teamId={p.team} /></td>
                    <td style={{ ...tdStyle(true), fontSize: 15 }}>{p.ops_plus}</td>
                    <td style={tdStyle(false)}>{p.avg}</td>
                    <td style={tdStyle(false)}>{p.obp}</td>
                    <td style={tdStyle(false)}>{p.slg}</td>
                    <td style={{ ...tdStyle(false), fontWeight: 700 }}>{p.hr}</td>
                  </tr>
                ))}
                {filteredBatting.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: colors.textMuted }}>No players match "{battingSearch}"</td></tr>
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
            <SectionHeading style={{ margin: 0 }}>PITCHING LEADERS</SectionHeading>
            <input
              type="text"
              value={pitchingSearch}
              onChange={e => setPitchingSearch(e.target.value)}
              placeholder="Search player or team…"
              style={{ ...inputStyle, maxWidth: 260 }}
            />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: colors.bg }}>
                  <SortHeader label="#" sortKey={null} currentSort={pitchingSort} setSort={setPitchingSort} align="center" />
                  <SortHeader label="Player" sortKey="name" currentSort={pitchingSort} setSort={setPitchingSort} align="left" />
                  <SortHeader label="Team" sortKey="team" currentSort={pitchingSort} setSort={setPitchingSort} align="left" />
                  <SortHeader label="FIP" sortKey="fip" currentSort={pitchingSort} setSort={setPitchingSort} highlight />
                  <SortHeader label="ERA" sortKey="era" currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="IP" sortKey="ip" currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="K/4" sortKey="k4" currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="W" sortKey="w" currentSort={pitchingSort} setSort={setPitchingSort} />
                  <SortHeader label="L" sortKey="l" currentSort={pitchingSort} setSort={setPitchingSort} />
                </tr>
              </thead>
              <tbody>
                {filteredPitching.map((p, i) => (
                  <tr key={p.playerId || p.rank} style={{ borderBottom: `1px solid ${colors.divider}`, background: i % 2 === 0 ? colors.white : colors.bg }}>
                    <td style={{ ...tdStyle(false), textAlign: 'center', color: colors.textMuted, fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ ...tdStyle(false), textAlign: 'left' }}><PlayerCell name={p.name} team={p.team} /></td>
                    <td style={{ ...tdStyle(false), textAlign: 'left' }}><TeamLink teamId={p.team} /></td>
                    <td style={{ ...tdStyle(true), fontSize: 15 }}>{typeof p.fip === 'number' ? p.fip.toFixed(2) : p.fip}</td>
                    <td style={tdStyle(false)}>{p.era}</td>
                    <td style={tdStyle(false)}>{p.ip}</td>
                    <td style={tdStyle(false)}>{p.k4}</td>
                    <td style={{ ...tdStyle(false), fontWeight: 700 }}>{p.w}</td>
                    <td style={{ ...tdStyle(false), color: colors.textMuted }}>{p.l}</td>
                  </tr>
                ))}
                {filteredPitching.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: 30, textAlign: 'center', color: colors.textMuted }}>No players match "{pitchingSearch}"</td></tr>
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
            <SectionHeading style={{ margin: 0 }}>PLAYER RANKINGS</SectionHeading>
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
                  <SortHeader label="#" sortKey="currentRank" currentSort={rankingsSort} setSort={setRankingsSort} align="center" />
                  <SortHeader label="Player" sortKey="name" currentSort={rankingsSort} setSort={setRankingsSort} align="left" />
                  <SortHeader label="Move" sortKey="rankChange" currentSort={rankingsSort} setSort={setRankingsSort} />
                  <SortHeader label="Points" sortKey="totalPoints" currentSort={rankingsSort} setSort={setRankingsSort} highlight />
                  <SortHeader label="Avg Pts" sortKey="averagePoints" currentSort={rankingsSort} setSort={setRankingsSort} />
                  <SortHeader label="Composite" sortKey="compositePoints" currentSort={rankingsSort} setSort={setRankingsSort} />
                </tr>
              </thead>
              <tbody>
                {filteredRankings.slice(0, 50).map((p, i) => (
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
                {filteredRankings.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: colors.textMuted }}>No players match "{rankingsSearch}"</td></tr>
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
              <SectionHeading style={{ margin: 0 }}>ALL PLAYERS</SectionHeading>
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
                            <Link to={`/teams/${t.slug}/players/${slugify(p.lastName)}`} style={{ color: colors.text, textDecoration: 'none', borderBottom: `1px dotted ${colors.border}` }}>
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
            <SectionHeading style={{ margin: 0 }}>2025-26 BLW STANDINGS</SectionHeading>
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
                </tr>
              </thead>
              <tbody>
                {TEAMS.map((t, i) => {
                  const [w, l] = t.record.split('-');
                  return (
                    <tr key={t.id} style={{ borderBottom: `1px solid ${colors.divider}`, background: i % 2 === 0 ? colors.white : colors.bg }}>
                      <td style={{ ...tdStyle(false), textAlign: 'center', color: colors.textMuted, fontWeight: 700 }}>{t.rank}</td>
                      <td style={{ ...tdStyle(false), textAlign: 'left' }}>
                        <Link to={`/teams/${t.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <TeamLogo teamId={t.id} size={32} rounded="rounded" />
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 13 }}>{t.name}</div>
                              {t.owner && <div style={{ fontSize: 10, color: colors.textMuted }}>{t.owner}</div>}
                            </div>
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
