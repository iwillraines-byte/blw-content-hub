import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TEAMS, getTeam, slugify, fetchAllData, fetchTeamRosterFromApi, BATTING_LEADERS, PITCHING_LEADERS } from '../data';
import { Card, PageHeader, SectionHeading } from '../components';
import { colors, fonts, radius } from '../theme';
import { findTeamMedia, blobToObjectURL } from '../media-store';

export default function TeamPage() {
  const { slug } = useParams();
  const team = getTeam(slug);

  const [media, setMedia] = useState([]);
  const [roster, setRoster] = useState([]);
  const [rosterAvatars, setRosterAvatars] = useState({}); // lastName (upper) → objectURL
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancel = false;
    if (!team?.id) return;
    Promise.all([fetchAllData(), fetchTeamRosterFromApi(team.id), findTeamMedia(team.id)])
      .then(([, apiRoster, teamMedia]) => {
        if (cancel) return;
        setMedia(teamMedia);

        // Build a lookup of jersey numbers from uploaded media (TEAM_##_LASTNAME_TYPE.ext)
        const jerseyByLastName = {};
        for (const m of teamMedia) {
          if (m.player && m.num && !jerseyByLastName[m.player]) {
            jerseyByLastName[m.player] = m.num;
          }
        }

        // Also include media-only players (with filenames like LAN_07_SMITH_*) who aren't in the API roster
        const apiLastNames = new Set(apiRoster.map(p => p.lastName.toUpperCase()));
        const mediaOnlyPlayers = [];
        const mediaOnlySeen = new Set();
        for (const m of teamMedia) {
          if (!m.player || m.player === 'TEAM' || m.player === 'LEAGUE') continue;
          const up = m.player.toUpperCase();
          if (apiLastNames.has(up) || mediaOnlySeen.has(up)) continue;
          mediaOnlySeen.add(up);
          const lastName = up.charAt(0) + up.slice(1).toLowerCase();
          mediaOnlyPlayers.push({
            playerId: null, name: lastName, firstName: '', lastName,
            team: team.id, num: m.num || '', isPitcher: false, isBatter: false, mediaOnly: true,
          });
        }

        // Attach jersey numbers (from media) to API roster entries
        const rosterWithJerseys = apiRoster.map(p => ({
          ...p,
          num: p.num || jerseyByLastName[p.lastName.toUpperCase()] || '',
        }));

        const fullRoster = [...rosterWithJerseys, ...mediaOnlyPlayers].sort((a, b) => a.lastName.localeCompare(b.lastName));
        setRoster(fullRoster);

        // Build avatar lookup per roster player
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
  }, [team?.id]);

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
        <div style={{
          width: 80, height: 80, borderRadius: radius.lg,
          background: team.accent, color: team.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: fonts.heading, fontSize: 36, letterSpacing: 1.5, flexShrink: 0,
        }}>{team.id}</div>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionHeading style={{ margin: 0 }}>ROSTER</SectionHeading>
          <span style={{ fontFamily: fonts.condensed, fontSize: 11, color: colors.textMuted }}>
            {roster.length} PLAYER{roster.length !== 1 ? 'S' : ''}
          </span>
        </div>
        {!loaded && <div style={{ padding: 20, textAlign: 'center', color: colors.textMuted }}>Loading roster…</div>}
        {loaded && roster.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
            No roster data yet. Upload media files or wait for stats to sync.
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
                <Link
                  key={p.lastName}
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
                        {statLabel}
                      </span>
                    </div>
                  </div>
                </Link>
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
