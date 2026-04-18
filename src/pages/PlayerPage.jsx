import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getTeam, getPlayerByTeamLastName, fetchAllData, fetchTeamRosterFromApi } from '../data';
import { Card, SectionHeading, RedButton } from '../components';
import { colors, fonts, radius } from '../theme';
import { findPlayerMedia, blobToObjectURL } from '../media-store';

function buildStatLine(player) {
  if (player.batting) {
    const b = player.batting;
    return `OPS+ ${b.ops_plus} | AVG ${b.avg} | HR ${b.hr} | OBP ${b.obp}`;
  }
  if (player.pitching) {
    const p = player.pitching;
    const fip = typeof p.fip === 'number' ? p.fip.toFixed(2) : p.fip;
    return `FIP ${fip} | IP ${p.ip} | W ${p.w} | K/4 ${p.k4}`;
  }
  return '';
}

export default function PlayerPage() {
  const { slug, lastName } = useParams();
  const team = getTeam(slug);

  const [player, setPlayer] = useState(null);
  const [media, setMedia] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancel = false;
    if (!team?.id) return;
    // Load stats AND team roster in parallel, so media-only players resolve too
    Promise.all([fetchAllData(), fetchTeamRosterFromApi(team.id)]).then(async () => {
      if (cancel) return;
      const p = getPlayerByTeamLastName(team.id, lastName);
      if (p) {
        // Media match ignores jersey number — just team + lastName
        const m = await findPlayerMedia(team.id, p.lastName);
        if (cancel) return;
        // Source jersey from first uploaded media file if available
        const mediaJersey = m.find(x => x.num)?.num || '';
        setPlayer({ ...p, num: p.num || mediaJersey });
        setMedia(m);
      } else {
        setPlayer(null);
      }
      setLoaded(true);
    });
    return () => { cancel = true; };
  }, [team?.id, lastName]);

  const mediaUrls = useMemo(() => {
    const urls = {};
    for (const m of media) if (m.blob) urls[m.id] = blobToObjectURL(m.blob);
    return urls;
  }, [media]);

  if (!team) {
    return (
      <Card style={{ textAlign: 'center', padding: 40 }}>
        <SectionHeading>Team not found</SectionHeading>
        <Link to="/studio" style={{ color: colors.red, textDecoration: 'none' }}>← Back to Dashboard</Link>
      </Card>
    );
  }

  if (!loaded) {
    return <Card style={{ padding: 30, textAlign: 'center', color: colors.textMuted }}>Loading player…</Card>;
  }

  if (!player) {
    return (
      <Card style={{ textAlign: 'center', padding: 40 }}>
        <SectionHeading>Player not found</SectionHeading>
        <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12 }}>
          No stats or roster data for "{lastName}" on {team.name}.
        </div>
        <Link to={`/teams/${team.slug}`} style={{ color: colors.red, textDecoration: 'none' }}>
          ← Back to {team.name}
        </Link>
      </Card>
    );
  }

  // Group media by asset type
  const grouped = media.reduce((acc, m) => {
    const k = m.assetType || 'FILE';
    (acc[k] = acc[k] || []).push(m);
    return acc;
  }, {});

  // Build Generate CTA URL with pre-filled fields
  const generateParams = new URLSearchParams();
  generateParams.set('template', 'player-stat');
  generateParams.set('team', team.id);
  generateParams.set('platform', 'feed');
  generateParams.set('playerName', player.name);
  if (player.num) generateParams.set('number', player.num);
  const statLine = buildStatLine(player);
  if (statLine) generateParams.set('statLine', statLine);

  const headshot = media.find(m => m.assetType === 'HEADSHOT' || m.assetType === 'PORTRAIT');
  const avatarUrl = headshot ? mediaUrls[headshot.id] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: fonts.condensed }}>
        <Link to={`/teams/${team.slug}`} style={{ color: colors.red, textDecoration: 'none', fontWeight: 700 }}>
          ← {team.name.toUpperCase()}
        </Link>
      </div>

      {/* Player Header */}
      <div style={{
        background: `linear-gradient(135deg, ${team.color}, ${team.dark})`,
        color: team.accent, borderRadius: radius.lg, padding: 24,
        display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
      }}>
        <div style={{
          width: 100, height: 100, borderRadius: radius.full,
          background: avatarUrl ? `url(${avatarUrl}) center/cover` : team.accent,
          color: team.color, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: fonts.heading, fontSize: 36, letterSpacing: 1,
          border: `3px solid ${team.accent}`,
        }}>
          {!avatarUrl && player.lastName.slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: fonts.condensed, fontSize: 11, letterSpacing: 1.5, opacity: 0.7 }}>
            {team.id} · {player.num ? `#${player.num}` : 'NO JERSEY #'}
          </div>
          <div style={{ fontFamily: fonts.heading, fontSize: 42, letterSpacing: 1.5, lineHeight: 1, margin: '4px 0 6px' }}>
            {player.name.toUpperCase()}
          </div>
          <div style={{ fontFamily: fonts.body, fontSize: 13, opacity: 0.8 }}>
            {player.batting && 'Batter'} {player.batting && player.pitching && '·'} {player.pitching && 'Pitcher'}
            {player.ranking && <span> · Rank #{player.ranking.currentRank}</span>}
          </div>
        </div>
        <Link to={`/generate?${generateParams.toString()}`} style={{ textDecoration: 'none' }}>
          <RedButton style={{
            background: team.accent, color: team.color,
            padding: '14px 24px', fontSize: 14,
          }}>
            ✦ Generate Stat Post
          </RedButton>
        </Link>
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {player.batting && (
          <Card>
            <SectionHeading>BATTING</SectionHeading>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
              {[
                { label: 'OPS+', value: player.batting.ops_plus, hi: true },
                { label: 'AVG', value: player.batting.avg },
                { label: 'OBP', value: player.batting.obp },
                { label: 'SLG', value: player.batting.slg },
                { label: 'HR', value: player.batting.hr },
                { label: 'RBI', value: player.batting.rbi || '-' },
                { label: 'BB%', value: player.batting.bbPct ? player.batting.bbPct.toFixed(1) : '-' },
                { label: 'K%', value: player.batting.kPct ? player.batting.kPct.toFixed(1) : '-' },
              ].map(s => (
                <div key={s.label} style={{
                  padding: '10px 8px', textAlign: 'center',
                  background: colors.bg, borderRadius: radius.sm,
                }}>
                  <div style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 1 }}>{s.label}</div>
                  <div style={{
                    fontFamily: fonts.heading, fontSize: 22, letterSpacing: 0.5,
                    color: s.hi ? colors.red : colors.text,
                  }}>{s.value}</div>
                </div>
              ))}
            </div>
          </Card>
        )}
        {player.pitching && (
          <Card>
            <SectionHeading>PITCHING</SectionHeading>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
              {[
                { label: 'FIP', value: typeof player.pitching.fip === 'number' ? player.pitching.fip.toFixed(2) : player.pitching.fip, hi: true },
                { label: 'ERA', value: player.pitching.era },
                { label: 'WHIP', value: player.pitching.whip },
                { label: 'IP', value: player.pitching.ip },
                { label: 'W-L', value: `${player.pitching.w}-${player.pitching.l}` },
                { label: 'K/4', value: player.pitching.k4 },
                { label: 'BB/4', value: player.pitching.bb4 },
                { label: 'SO', value: player.pitching.shutouts },
              ].map(s => (
                <div key={s.label} style={{
                  padding: '10px 8px', textAlign: 'center',
                  background: colors.bg, borderRadius: radius.sm,
                }}>
                  <div style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 1 }}>{s.label}</div>
                  <div style={{
                    fontFamily: fonts.heading, fontSize: 22, letterSpacing: 0.5,
                    color: s.hi ? colors.red : colors.text,
                  }}>{s.value}</div>
                </div>
              ))}
            </div>
          </Card>
        )}
        {player.ranking && (
          <Card>
            <SectionHeading>RANKING</SectionHeading>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ padding: '10px 8px', textAlign: 'center', background: colors.bg, borderRadius: radius.sm }}>
                <div style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 1 }}>CURRENT</div>
                <div style={{ fontFamily: fonts.heading, fontSize: 28, color: colors.red, letterSpacing: 0.5 }}>#{player.ranking.currentRank}</div>
              </div>
              <div style={{ padding: '10px 8px', textAlign: 'center', background: colors.bg, borderRadius: radius.sm }}>
                <div style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 1 }}>MOVE</div>
                <div style={{
                  fontFamily: fonts.heading, fontSize: 28, letterSpacing: 0.5,
                  color: player.ranking.rankChange > 0 ? '#16A34A' : player.ranking.rankChange < 0 ? '#DC2626' : colors.textMuted,
                }}>
                  {player.ranking.rankChange > 0 ? `+${player.ranking.rankChange}` : player.ranking.rankChange < 0 ? player.ranking.rankChange : '—'}
                </div>
              </div>
              <div style={{ padding: '10px 8px', textAlign: 'center', background: colors.bg, borderRadius: radius.sm, gridColumn: 'span 2' }}>
                <div style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 1 }}>TOTAL POINTS</div>
                <div style={{ fontFamily: fonts.heading, fontSize: 22, color: colors.text, letterSpacing: 0.5 }}>
                  {player.ranking.totalPoints.toLocaleString()}
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Media Gallery */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionHeading style={{ margin: 0 }}>MEDIA</SectionHeading>
          <span style={{ fontFamily: fonts.condensed, fontSize: 11, color: colors.textMuted }}>
            {media.length} ASSET{media.length !== 1 ? 'S' : ''}
          </span>
        </div>
        {media.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
            No media uploaded for {player.name} yet.
            <br />
            <Link to="/files" style={{ color: colors.red, textDecoration: 'none', fontWeight: 700 }}>
              Upload in Files →
            </Link>
          </div>
        )}
        {media.length > 0 && Object.entries(grouped).map(([type, items]) => (
          <div key={type} style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, color: colors.textMuted, letterSpacing: 1, marginBottom: 6 }}>
              {type} ({items.length})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
              {items.map(m => (
                <div key={m.id} style={{
                  borderRadius: radius.base, overflow: 'hidden',
                  border: `1px solid ${colors.borderLight}`,
                }}>
                  <div style={{
                    width: '100%', height: 120,
                    background: mediaUrls[m.id] ? `url(${mediaUrls[m.id]}) center/cover` : `linear-gradient(135deg, ${team.color}22, ${team.color}08)`,
                  }} />
                  <div style={{
                    padding: 6, fontSize: 10, fontFamily: fonts.condensed,
                    color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{m.name}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
