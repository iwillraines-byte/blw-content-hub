import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TEAMS, getTeam, slugify, playerSlug, fetchAllData, fetchTeamRosterFromApi, BATTING_LEADERS, PITCHING_LEADERS } from '../data';
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
  // Avatars keyed by "FI|LASTNAME" (e.g. "C|ROSE") so same-lastname players
  // each get their own headshot. Legacy records without a firstInitial are
  // keyed by "|LASTNAME" and used as a fallback.
  const [rosterAvatars, setRosterAvatars] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayerFirst, setNewPlayerFirst] = useState('');
  const [newPlayerLast, setNewPlayerLast] = useState('');
  const [newPlayerNum, setNewPlayerNum] = useState('');
  const [newPlayerPosition, setNewPlayerPosition] = useState('');

  const rebuildRoster = useCallback((apiRoster, teamMedia, manualList) => {
    // Identity key: "FI|LASTNAME" (uppercase) — lets Logan Rose and Carson Rose
    // coexist on the same roster. Legacy records without a firstInitial use "|LASTNAME".
    const identityKey = (fi, ln) => `${String(fi || '').toUpperCase()}|${String(ln || '').toUpperCase()}`;

    // Only consider player-scoped media when building the roster.
    const playerMedia = teamMedia.filter(m => (m.scope || 'player') === 'player');

    // Jersey lookup from media filenames — prefer (initial + lastname) key;
    // fall back to lastname-only for legacy records.
    const jerseyByKey = {};
    for (const m of playerMedia) {
      if (!m.player || !m.num) continue;
      const key = identityKey(m.firstInitial, m.player);
      if (!jerseyByKey[key]) jerseyByKey[key] = m.num;
      const legacyKey = identityKey('', m.player);
      if (!jerseyByKey[legacyKey]) jerseyByKey[legacyKey] = m.num;
    }
    for (const p of manualList) {
      const fi = (p.firstName || '').charAt(0).toUpperCase();
      const k = identityKey(fi, p.lastName);
      if (p.num && !jerseyByKey[k]) jerseyByKey[k] = p.num;
    }

    const taken = new Set();
    const entries = [];

    // API roster — use first-initial for identity so duplicates don't collide.
    for (const p of apiRoster) {
      const fi = (p.firstName || '').charAt(0).toUpperCase();
      const key = identityKey(fi, p.lastName);
      const legacyKey = identityKey('', p.lastName);
      taken.add(key);
      entries.push({
        ...p,
        firstInitial: fi,
        num: p.num || jerseyByKey[key] || jerseyByKey[legacyKey] || '',
        source: 'api',
      });
    }

    // Manual players not already represented in the API roster
    for (const p of manualList) {
      const fi = (p.firstName || '').charAt(0).toUpperCase();
      const key = identityKey(fi, p.lastName);
      if (taken.has(key)) continue;
      taken.add(key);
      entries.push({
        manualId: p.id,
        playerId: null,
        name: p.name,
        firstName: p.firstName,
        firstInitial: fi,
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
    for (const m of playerMedia) {
      if (!m.player || m.player === 'TEAM' || m.player === 'LEAGUE') continue;
      const fi = (m.firstInitial || '').toUpperCase();
      const key = identityKey(fi, m.player);
      if (taken.has(key)) continue;
      // Don't create a media-only player if the same lastname already exists
      // via API under a *different* initial — that's likely the same person
      // whose file was tagged before the initial convention existed.
      const lastnameAlreadyInRoster = entries.some(
        e => e.lastName.toUpperCase() === m.player && (!fi || !e.firstInitial || e.firstInitial === fi)
      );
      if (lastnameAlreadyInRoster && !fi) continue;
      taken.add(key);
      const pretty = m.player.charAt(0) + m.player.slice(1).toLowerCase();
      entries.push({
        playerId: null,
        name: fi ? `${fi}. ${pretty}` : pretty,
        firstName: fi,
        firstInitial: fi,
        lastName: pretty,
        team: team.id,
        num: m.num || '',
        isPitcher: false, isBatter: false, mediaOnly: true, source: 'media',
      });
    }

    // Defensive dedup by identity key — belt-and-braces in case sources overlap
    const seen = new Set();
    const deduped = entries.filter(p => {
      const key = identityKey(p.firstInitial, p.lastName);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const onlyThisTeam = deduped.filter(p => !p.team || p.team === team.id);
    return onlyThisTeam.sort((a, b) => a.lastName.localeCompare(b.lastName));
  }, [team?.id]);

  useEffect(() => {
    let cancel = false;
    if (!team?.id) return;

    // Clear previous team's data immediately so the user never sees the wrong roster
    setRoster([]);
    setMedia([]);
    setManualPlayers([]);
    setRosterAvatars({});
    setLoaded(false);

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

      // Avatar lookup — prefer a headshot whose firstInitial matches the
      // roster entry. Fall back to any lastname match for legacy records
      // that pre-date the initial convention.
      const urls = {};
      const playerOnly = teamMedia.filter(m => (m.scope || 'player') === 'player');
      for (const p of fullRoster) {
        const LN = p.lastName.toUpperCase();
        const FI = (p.firstInitial || (p.firstName || '').charAt(0)).toUpperCase();
        const isHeadshotLike = (m) =>
          m.assetType === 'HEADSHOT' || m.assetType === 'PORTRAIT' || m.assetType === 'ACTION';
        const exact = playerOnly.find(m => m.player === LN && (m.firstInitial || '').toUpperCase() === FI && isHeadshotLike(m));
        const legacy = playerOnly.find(m => m.player === LN && !m.firstInitial && isHeadshotLike(m));
        const headshot = exact || legacy;
        if (headshot?.blob) urls[`${FI}|${LN}`] = blobToObjectURL(headshot.blob);
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

  const teamScopedMedia = useMemo(
    () => media.filter(m => (m.scope || 'player') === 'team'),
    [media]
  );
  const playerScopedMedia = useMemo(
    () => media.filter(m => (m.scope || 'player') === 'player'),
    [media]
  );

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
          rounded="square"
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
          <SectionHeading style={{ margin: 0 }}>Roster</SectionHeading>
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
            {roster.map((p, idx) => {
              const FI = (p.firstInitial || (p.firstName || '').charAt(0)).toUpperCase();
              const avatar = rosterAvatars[`${FI}|${p.lastName.toUpperCase()}`];
              const statLabel = p.isBatter && p.isPitcher
                ? 'Two-way'
                : p.isBatter ? 'Batter'
                : p.isPitcher ? 'Pitcher'
                : p.mediaOnly ? 'Roster' : 'Roster';
              // Composite key — with first-initial + lastname, Logan Rose and
              // Carson Rose each get a stable unique key.
              const rowKey = `${p.playerId || p.manualId || p.source || 'row'}-${FI}-${p.lastName}-${idx}`;
              // Disambiguated slug: "c-rose" beats "rose".
              const slug = playerSlug(p);
              return (
                <div key={rowKey} style={{ position: 'relative' }}>
                  <Link
                    to={`/teams/${team.slug}/players/${slug}`}
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

      {/* Team Photos — team-scoped assets (TEAMPHOTO, VENUE, LOGO_*, WORDMARK) */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionHeading style={{ margin: 0 }}>Team photos</SectionHeading>
          <Link to="/files" style={{ fontSize: 11, fontFamily: fonts.condensed, fontWeight: 600, color: colors.red, textDecoration: 'none' }}>
            Go to Files →
          </Link>
        </div>
        {teamScopedMedia.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
            No team-wide photos yet. Upload a group shot, venue pic, or logo in Files — tag as <strong>TEAMPHOTO</strong>, <strong>VENUE</strong>, <strong>LOGO</strong>, or <strong>WORDMARK</strong>.
          </div>
        )}
        {teamScopedMedia.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {teamScopedMedia.slice(0, 12).map(m => (
              <div key={m.id} style={{
                borderRadius: radius.base, overflow: 'hidden',
                border: `1px solid ${colors.borderLight}`,
              }}>
                <div style={{
                  width: '100%', height: 110,
                  background: thumbUrls[m.id] ? `url(${thumbUrls[m.id]}) center/cover` : `linear-gradient(135deg, ${team.color}22, ${team.color}08)`,
                }} />
                <div style={{ padding: 8 }}>
                  <div style={{ fontSize: 10, fontFamily: fonts.condensed, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.name}
                  </div>
                  <div style={{ fontSize: 9, color: colors.textMuted, fontFamily: fonts.condensed, marginTop: 2 }}>
                    {m.assetType}{m.variant ? ` · ${m.variant}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Recently Uploaded Player Media */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionHeading style={{ margin: 0 }}>Recent player media</SectionHeading>
          <Link to="/files" style={{ fontSize: 11, fontFamily: fonts.condensed, fontWeight: 600, color: colors.red, textDecoration: 'none' }}>
            Go to Files →
          </Link>
        </div>
        {playerScopedMedia.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
            No player media uploaded for this team yet.{' '}
            <Link to="/files" style={{ color: colors.red }}>Upload in Files</Link>
          </div>
        )}
        {playerScopedMedia.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {playerScopedMedia.slice(0, 12).map(m => (
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
