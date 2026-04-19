import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TEAMS, getTeam, slugify, fetchAllData, fetchTeamRosterFromApi, BATTING_LEADERS, PITCHING_LEADERS } from '../data';
import { Card, PageHeader, SectionHeading, RedButton, OutlineButton, TeamLogo, inputStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { findTeamMedia, blobToObjectURL } from '../media-store';
import { getManualPlayersByTeam, savePlayer, deletePlayer } from '../player-store';

export default function TeamPage() {
  const { slug } = useParams();
  const team = getTeam(slug);

  const [media, setMedia] = useState([]);
  const [roster, setRoster] = useState([]);
  const [manualPlayers, setManualPlayers] = useState([]);
  const [rosterAvatars, setRosterAvatars] = useState({}); // lastName (upper) → objectURL
  const [loaded, setLoaded] = useState(false);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayerFirst, setNewPlayerFirst] = useState('');
  const [newPlayerLast, setNewPlayerLast] = useState('');
  const [newPlayerNum, setNewPlayerNum] = useState('');
  const [newPlayerPosition, setNewPlayerPosition] = useState('');

  const rebuildRoster = useCallback((apiRoster, teamMedia, manualList) => {
    // Jersey lookup from media filenames
    const jerseyByLastName = {};
    for (const m of teamMedia) {
      if (m.player && m.num && !jerseyByLastName[m.player]) {
        jerseyByLastName[m.player] = m.num;
      }
    }
    // Also seed from manual players
    for (const p of manualList) {
      const up = p.lastName.toUpperCase();
      if (p.num && !jerseyByLastName[up]) jerseyByLastName[up] = p.num;
    }

    const taken = new Set(apiRoster.map(p => p.lastName.toUpperCase()));
    const entries = [];

    // API roster (with jersey from media/manual)
    for (const p of apiRoster) {
      entries.push({
        ...p,
        num: p.num || jerseyByLastName[p.lastName.toUpperCase()] || '',
        source: 'api',
      });
    }

    // Manual players not already in API roster
    for (const p of manualList) {
      const up = p.lastName.toUpperCase();
      if (taken.has(up)) continue;
      taken.add(up);
      entries.push({
        manualId: p.id,
        playerId: null,
        name: p.name,
        firstName: p.firstName,
        lastName: p.lastName,
        team: p.team,
        num: p.num || '',
        position: p.position,
        isPitcher: /p/i.test(p.position),
        isBatter: /b|h|c|of|if/i.test(p.position),
        manual: true,
        source: 'manual',
      });
    }

    // Media-only players (not in API, not manually added)
    for (const m of teamMedia) {
      if (!m.player || m.player === 'TEAM' || m.player === 'LEAGUE') continue;
      const up = m.player.toUpperCase();
      if (taken.has(up)) continue;
      taken.add(up);
      const lastName = up.charAt(0) + up.slice(1).toLowerCase();
      entries.push({
        playerId: null, name: lastName, firstName: '', lastName,
        team: team.id, num: m.num || '',
        isPitcher: false, isBatter: false, mediaOnly: true, source: 'media',
      });
    }

    return entries.sort((a, b) => a.lastName.localeCompare(b.lastName));
  }, [team?.id]);

  useEffect(() => {
    let cancel = false;
    if (!team?.id) return;
    Promise.all([
      fetchAllData(),
      fetchTeamRosterFromApi(team.id),
      findTeamMedia(team.id),
      getManualPlayersByTeam(team.id),
    ]).then(([, apiRoster, teamMedia, manualList]) => {
      if (cancel) return;
      setMedia(teamMedia);
      setManualPlayers(manualList);

      const fullRoster = rebuildRoster(apiRoster, teamMedia, manualList);
      setRoster(fullRoster);

      // Avatar lookup
      const urls = {};
      for (const p of fullRoster) {
        const headshot = teamMedia.find(m =>
          m.player === p.lastName.toUpperCase() &&
          (m.assetType === 'HEADSHOT' || m.assetType === 'PORTRAIT' || m.assetType === 'ACTION')
        );
        if (headshot?.blob) urls[p.lastName.toUpperCase()] = blobToObjectURL(headshot.blob);
      }
      setRosterAvatars(urls);
      setLoaded(true);
    });
    return () => { cancel = true; };
  }, [team?.id, rebuildRoster]);

  const handleAddPlayer = async () => {
    if (!newPlayerLast.trim()) return;
    const record = await savePlayer({
      firstName: newPlayerFirst.trim(),
      lastName: newPlayerLast.trim(),
      team: team.id,
      num: newPlayerNum.trim(),
      position: newPlayerPosition.trim(),
    });
    const updated = [...manualPlayers, record];
    setManualPlayers(updated);
    // Rebuild roster
    const [apiRoster, teamMedia] = await Promise.all([
      fetchTeamRosterFromApi(team.id),
      findTeamMedia(team.id),
    ]);
    setRoster(rebuildRoster(apiRoster, teamMedia, updated));
    // Reset form
    setNewPlayerFirst(''); setNewPlayerLast(''); setNewPlayerNum(''); setNewPlayerPosition('');
    setShowAddPlayer(false);
  };

  const handleDeleteManualPlayer = async (manualId) => {
    await deletePlayer(manualId);
    const updated = manualPlayers.filter(p => p.id !== manualId);
    setManualPlayers(updated);
    const [apiRoster, teamMedia] = await Promise.all([
      fetchTeamRosterFromApi(team.id),
      findTeamMedia(team.id),
    ]);
    setRoster(rebuildRoster(apiRoster, teamMedia, updated));
  };

  if (!team) {
    return (
      <Card style={{ textAlign: 'center', padding: 40 }}>
        <SectionHeading>Team not found</SectionHeading>
        <Link to="/studio" style={{ color: colors.red, textDecoration: 'none' }}>← Back to Dashboard</Link>
      </Card>
    );
  }

  const teamBatters = BATTING_LEADERS.filter(p => p.team === team.id);
  const teamPitchers = PITCHING_LEADERS.filter(p => p.team === team.id);
  const topBatter = teamBatters[0];
  const topPitcher = teamPitchers[0];
  const hrLeader = [...teamBatters].sort((a, b) => (b.hr || 0) - (a.hr || 0))[0];

  const thumbUrls = useMemo(() => {
    const urls = {};
    for (const m of media) if (m.blob) urls[m.id] = blobToObjectURL(m.blob);
    return urls;
  }, [media]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Team Header */}
      <div style={{
        background: `linear-gradient(135deg, ${team.color}, ${team.dark})`,
        color: team.accent,
        borderRadius: radius.lg,
        padding: 24,
        display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
      }}>
        <TeamLogo
          teamId={team.id}
          size={96}
          rounded="rounded"
          background="rgba(255,255,255,0.1)"
          style={{ padding: 8, boxSizing: 'border-box' }}
        />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: fonts.condensed, fontSize: 11, letterSpacing: 1.5, opacity: 0.7 }}>
            RANK #{team.rank} · {team.city.toUpperCase()}
          </div>
          <div style={{ fontFamily: fonts.heading, fontSize: 42, letterSpacing: 1.5, lineHeight: 1, margin: '4px 0 6px' }}>
            {team.name.toUpperCase()}
          </div>
          {team.owner && (
            <div style={{ fontFamily: fonts.body, fontSize: 13, opacity: 0.8 }}>Owner: {team.owner}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: fonts.condensed, fontSize: 10, letterSpacing: 1, opacity: 0.6 }}>RECORD</div>
            <div style={{ fontFamily: fonts.heading, fontSize: 32, letterSpacing: 1 }}>{team.record}</div>
          </div>
          <div>
            <div style={{ fontFamily: fonts.condensed, fontSize: 10, letterSpacing: 1, opacity: 0.6 }}>PCT</div>
            <div style={{ fontFamily: fonts.heading, fontSize: 32, letterSpacing: 1 }}>{team.pct}</div>
          </div>
          <div>
            <div style={{ fontFamily: fonts.condensed, fontSize: 10, letterSpacing: 1, opacity: 0.6 }}>DIFF</div>
            <div style={{
              fontFamily: fonts.heading, fontSize: 32, letterSpacing: 1,
              color: team.diff.startsWith('+') && team.diff !== '0' ? '#4ADE80' : team.diff === '0' ? team.accent : '#F87171',
            }}>{team.diff}</div>
          </div>
        </div>
      </div>

      {/* Team Stats Summary */}
      {(topBatter || topPitcher) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {topBatter && (
            <Card style={{ borderLeft: `3px solid ${team.color}` }}>
              <div style={{ fontFamily: fonts.condensed, fontSize: 10, letterSpacing: 1, color: colors.textMuted, marginBottom: 4 }}>TOP BATTER · OPS+</div>
              <div style={{ fontFamily: fonts.heading, fontSize: 22, color: colors.text, letterSpacing: 0.5 }}>{topBatter.name}</div>
              <div style={{ fontFamily: fonts.heading, fontSize: 32, color: colors.red, letterSpacing: 1 }}>{topBatter.ops_plus}</div>
              <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                {topBatter.avg} AVG · {topBatter.hr} HR · {topBatter.obp} OBP
              </div>
            </Card>
          )}
          {topPitcher && (
            <Card style={{ borderLeft: `3px solid ${team.color}` }}>
              <div style={{ fontFamily: fonts.condensed, fontSize: 10, letterSpacing: 1, color: colors.textMuted, marginBottom: 4 }}>TOP PITCHER · FIP</div>
              <div style={{ fontFamily: fonts.heading, fontSize: 22, color: colors.text, letterSpacing: 0.5 }}>{topPitcher.name}</div>
              <div style={{ fontFamily: fonts.heading, fontSize: 32, color: colors.red, letterSpacing: 1 }}>
                {typeof topPitcher.fip === 'number' ? topPitcher.fip.toFixed(2) : topPitcher.fip}
              </div>
              <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                {topPitcher.era} ERA · {topPitcher.w}-{topPitcher.l} · {topPitcher.ip} IP
              </div>
            </Card>
          )}
          {hrLeader && hrLeader.hr > 0 && hrLeader !== topBatter && (
            <Card style={{ borderLeft: `3px solid ${team.color}` }}>
              <div style={{ fontFamily: fonts.condensed, fontSize: 10, letterSpacing: 1, color: colors.textMuted, marginBottom: 4 }}>HR LEADER</div>
              <div style={{ fontFamily: fonts.heading, fontSize: 22, color: colors.text, letterSpacing: 0.5 }}>{hrLeader.name}</div>
              <div style={{ fontFamily: fonts.heading, fontSize: 32, color: colors.red, letterSpacing: 1 }}>{hrLeader.hr}</div>
              <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                {hrLeader.avg} AVG · {hrLeader.slg} SLG
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Roster */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
          <SectionHeading style={{ margin: 0 }}>ROSTER</SectionHeading>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontFamily: fonts.condensed, fontSize: 11, color: colors.textMuted }}>
              {roster.length} PLAYER{roster.length !== 1 ? 'S' : ''}
            </span>
            <button onClick={() => setShowAddPlayer(!showAddPlayer)} style={{
              background: showAddPlayer ? colors.bg : colors.redLight,
              border: `1px solid ${showAddPlayer ? colors.border : colors.redBorder}`,
              color: showAddPlayer ? colors.textSecondary : colors.red,
              borderRadius: radius.sm, padding: '4px 10px',
              fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}>{showAddPlayer ? '✕ Cancel' : '+ Add Player'}</button>
          </div>
        </div>

        {showAddPlayer && (
          <div style={{
            background: colors.bg, border: `1px solid ${colors.border}`,
            borderRadius: radius.base, padding: 12, marginBottom: 12,
          }}>
            <div style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, color: colors.textMuted, letterSpacing: 0.8, marginBottom: 8 }}>
              ADD PLAYER TO {team.id}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px 120px', gap: 8, marginBottom: 10 }}>
              <input type="text" value={newPlayerFirst} onChange={e => setNewPlayerFirst(e.target.value)}
                placeholder="First name" style={{ ...inputStyle, fontSize: 12 }} />
              <input type="text" value={newPlayerLast} onChange={e => setNewPlayerLast(e.target.value)}
                placeholder="Last name *" style={{ ...inputStyle, fontSize: 12 }} />
              <input type="text" value={newPlayerNum} onChange={e => setNewPlayerNum(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder="#" maxLength={2} style={{ ...inputStyle, fontSize: 12, textAlign: 'center' }} />
              <input type="text" value={newPlayerPosition} onChange={e => setNewPlayerPosition(e.target.value)}
                placeholder="Position" style={{ ...inputStyle, fontSize: 12 }} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <RedButton onClick={handleAddPlayer} disabled={!newPlayerLast.trim()} style={{ padding: '8px 16px', fontSize: 12 }}>
                Add Player
              </RedButton>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.condensed, alignSelf: 'center' }}>
                Adds to local roster · Position examples: P, C, IF, OF, 2-way
              </div>
            </div>
          </div>
        )}

        {!loaded && <div style={{ padding: 20, textAlign: 'center', color: colors.textMuted }}>Loading roster…</div>}
        {loaded && roster.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
            No roster data yet. Upload media files or click "+ Add Player" to start.
          </div>
        )}
        {loaded && roster.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {roster.map(p => {
              const avatar = rosterAvatars[p.lastName.toUpperCase()];
              const statLabel = p.isBatter && p.isPitcher
                ? 'Two-way'
                : p.isBatter ? 'Batter'
                : p.isPitcher ? 'Pitcher'
                : p.mediaOnly ? 'Roster' : 'Roster';
              return (
                <div key={p.lastName} style={{ position: 'relative' }}>
                  <Link
                    to={`/teams/${team.slug}/players/${slugify(p.lastName)}`}
                    style={{
                      textDecoration: 'none', color: colors.text,
                      padding: 12, borderRadius: radius.base,
                      background: colors.white, border: `1px solid ${colors.border}`,
                      display: 'flex', alignItems: 'center', gap: 10,
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{
                      width: 48, height: 48, borderRadius: radius.full,
                      background: avatar ? `url(${avatar}) center/cover` : `linear-gradient(135deg, ${team.color}, ${team.dark})`,
                      color: team.accent, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: fonts.heading, fontSize: 16, letterSpacing: 0.5,
                      border: `2px solid ${team.color}`,
                    }}>
                      {!avatar && p.lastName.slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        {p.num && (
                          <span style={{
                            fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                            padding: '1px 6px', borderRadius: 3,
                            background: team.color, color: team.accent,
                          }}>#{p.num}</span>
                        )}
                        <span style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted }}>
                          {statLabel}{p.manual ? ' · Manual' : ''}
                        </span>
                      </div>
                    </div>
                  </Link>
                  {p.manual && p.manualId && (
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteManualPlayer(p.manualId); }}
                      title="Remove manual player"
                      style={{
                        position: 'absolute', top: 4, right: 4, width: 18, height: 18,
                        borderRadius: '50%', background: 'rgba(0,0,0,0.1)', color: colors.textMuted,
                        border: 'none', fontSize: 10, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >✕</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Recently Uploaded Media */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionHeading style={{ margin: 0 }}>RECENT MEDIA</SectionHeading>
          <Link to="/files" style={{ fontSize: 11, fontFamily: fonts.condensed, fontWeight: 600, color: colors.red, textDecoration: 'none' }}>
            Go to Files →
          </Link>
        </div>
        {media.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
            No media uploaded for this team yet.{' '}
            <Link to="/files" style={{ color: colors.red }}>Upload in Files</Link>
          </div>
        )}
        {media.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {media.slice(0, 12).map(m => (
              <div key={m.id} style={{
                borderRadius: radius.base, overflow: 'hidden',
                border: `1px solid ${colors.borderLight}`,
              }}>
                <div style={{
                  width: '100%', height: 100,
                  background: thumbUrls[m.id] ? `url(${thumbUrls[m.id]}) center/cover` : `linear-gradient(135deg, ${team.color}22, ${team.color}08)`,
                }} />
                <div style={{ padding: 8 }}>
                  <div style={{ fontSize: 10, fontFamily: fonts.condensed, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.name}
                  </div>
                  <div style={{ fontSize: 9, color: colors.textMuted, fontFamily: fonts.condensed, marginTop: 2 }}>
                    {m.assetType || 'FILE'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
