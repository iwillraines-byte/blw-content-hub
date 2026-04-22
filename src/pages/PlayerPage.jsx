import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getTeam, getPlayerByTeamLastName, fetchAllData, fetchTeamRosterFromApi } from '../data';
import { Card, SectionHeading, RedButton, TeamLogo } from '../components';
import { colors, fonts, radius } from '../theme';
import { findPlayerMedia, blobToObjectURL } from '../media-store';
import { getManualPlayersByTeam } from '../player-store';

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

// ─── Tier badge ─────────────────────────────────────────────────────────────
// Maps a player's currentRank into a tier with distinctive styling. Placeholder
// visuals for now — drop real PNG/SVG designs in per tier when ready.
function getTierInfo(rank) {
  if (!rank || rank <= 0) return null;
  if (rank <= 3)   return { tier: 'elite',    label: `#${rank}`,            subLabel: 'ELITE',       bg: 'linear-gradient(135deg, #F5C300, #D69A00)', fg: '#2A1A00', border: '#F5C300' };
  if (rank <= 10)  return { tier: 'top-10',   label: `TOP 10`,              subLabel: `#${rank}`,    bg: 'linear-gradient(135deg, #E5E7EB, #9CA3AF)', fg: '#1F2937', border: '#D1D5DB' };
  if (rank <= 25)  return { tier: 'top-25',   label: `TOP 25`,              subLabel: `#${rank}`,    bg: 'linear-gradient(135deg, #D97706, #92400E)', fg: '#FFF7ED', border: '#D97706' };
  if (rank <= 50)  return { tier: 'top-50',   label: `TOP 50`,              subLabel: `#${rank}`,    bg: 'linear-gradient(135deg, #2563EB, #1E40AF)', fg: '#EFF6FF', border: '#2563EB' };
  if (rank <= 100) return { tier: 'top-100',  label: `TOP 100`,             subLabel: `#${rank}`,    bg: 'linear-gradient(135deg, #16A34A, #15803D)', fg: '#F0FDF4', border: '#16A34A' };
  return               { tier: 'ranked',    label: `RANKED`,              subLabel: `#${rank}`,    bg: 'linear-gradient(135deg, #6B7280, #4B5563)', fg: '#F9FAFB', border: '#6B7280' };
}

function TierBadge({ rank }) {
  const info = getTierInfo(rank);
  if (!info) return null;
  return (
    <div style={{
      display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minWidth: 92, padding: '10px 14px',
      background: info.bg, color: info.fg,
      border: `2px solid ${info.border}`,
      borderRadius: radius.base,
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
      fontFamily: fonts.heading, letterSpacing: 1,
    }} title={`Tier: ${info.tier} · BLW Rank #${rank}`}>
      <div style={{ fontSize: 20, lineHeight: 1 }}>{info.label}</div>
      <div style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 1, marginTop: 4, opacity: 0.85 }}>
        {info.subLabel}
      </div>
    </div>
  );
}

// ─── League rank helpers ────────────────────────────────────────────────────
// Compute a player's 1-indexed rank for a given numeric stat across the list.
// `direction`: "desc" means higher is better (rank 1 = highest), "asc" = lower better.
function rankOf(list, playerName, statKey, direction = 'desc', toNumber = parseFloat) {
  if (!Array.isArray(list) || list.length === 0 || !playerName) return null;
  const cleaned = list
    .map(p => ({ name: p.name, v: toNumber(p[statKey]) }))
    .filter(x => x.name && !isNaN(x.v));
  cleaned.sort((a, b) => direction === 'asc' ? a.v - b.v : b.v - a.v);
  const idx = cleaned.findIndex(x => x.name === playerName);
  return idx === -1 ? null : idx + 1;
}

// Colored pill showing a rank across BLW for a given stat.
function RankChip({ rank, total }) {
  if (!rank) {
    return <span style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.condensed, fontWeight: 600 }}>—</span>;
  }
  // Use a muted team-neutral style; tier colors only on the big tier badge
  const palette = rank <= 3
    ? { bg: '#FEF3C7', fg: '#92400E' }        // gold-ish for top 3
    : rank <= 10
      ? { bg: 'rgba(37,99,235,0.1)', fg: '#1E40AF' }
      : rank <= 25
        ? { bg: 'rgba(22,163,74,0.1)', fg: '#15803D' }
        : { bg: colors.bg, fg: colors.textSecondary };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      background: palette.bg, color: palette.fg,
      padding: '2px 8px', borderRadius: 999,
      fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
    }}>
      #{rank}{total ? ` / ${total}` : ''} BLW
    </span>
  );
}

// Single stat tile: value on top, label + league rank chip below
function StatTile({ label, value, rank, total, highlight }) {
  return (
    <div style={{
      padding: '12px 10px',
      background: colors.bg,
      borderRadius: radius.sm,
      border: highlight ? `1px solid ${colors.redBorder}` : `1px solid ${colors.borderLight}`,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{
        fontFamily: fonts.heading, fontSize: 26, letterSpacing: 0.5,
        color: highlight ? colors.red : colors.text, lineHeight: 1,
      }}>{value ?? '—'}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700, color: colors.textMuted, letterSpacing: 0.8 }}>{label}</span>
        <RankChip rank={rank} total={total} />
      </div>
    </div>
  );
}

export default function PlayerPage() {
  const { slug, lastName } = useParams();
  const team = getTeam(slug);

  const [player, setPlayer] = useState(null);
  const [media, setMedia] = useState([]);
  const [battingLeaders, setBattingLeaders] = useState([]);
  const [pitchingLeaders, setPitchingLeaders] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancel = false;
    if (!team?.id) return;
    // Load stats AND team roster AND manual players in parallel
    Promise.all([fetchAllData(), fetchTeamRosterFromApi(team.id), getManualPlayersByTeam(team.id)])
      .then(async ([allData, , manualList]) => {
        if (cancel) return;
        setBattingLeaders(allData.batting || []);
        setPitchingLeaders(allData.pitching || []);
        const p = getPlayerByTeamLastName(team.id, lastName, manualList);
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

  // ─── Per-stat league-rank lookups ────────────────────────────────────────
  // Rank this player against all BLW batters/pitchers for each displayed stat
  const bTotal = battingLeaders.length;
  const pTotal = pitchingLeaders.length;
  const pn = player.name;
  const battingRanks = player.batting ? {
    avg:      rankOf(battingLeaders, pn, 'avg',      'desc', parseFloat),
    hits:     rankOf(battingLeaders, pn, 'hits',     'desc', Number),
    hr:       rankOf(battingLeaders, pn, 'hr',       'desc', Number),
    rbi:      rankOf(battingLeaders, pn, 'rbi',      'desc', Number),
    obp:      rankOf(battingLeaders, pn, 'obp',      'desc', parseFloat),
    ops_plus: rankOf(battingLeaders, pn, 'ops_plus', 'desc', Number),
  } : null;
  const pitchingRanks = player.pitching ? {
    era:  rankOf(pitchingLeaders, pn, 'era',  'asc',  parseFloat),
    whip: rankOf(pitchingLeaders, pn, 'whip', 'asc',  parseFloat),
    k4:   rankOf(pitchingLeaders, pn, 'k4',   'desc', parseFloat),
    bb4:  rankOf(pitchingLeaders, pn, 'bb4',  'asc',  parseFloat),
  } : null;

  const playerRank = player.ranking?.currentRank || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: fonts.condensed }}>
        <Link to={`/teams/${team.slug}`} style={{
          color: colors.red, textDecoration: 'none', fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          <span>←</span>
          <TeamLogo teamId={team.id} size={20} rounded="square" />
          {team.name.toUpperCase()}
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
          </div>
        </div>
        {/* Tier badge — prominent rank display in the header. Placeholder
            visual; swap in design PNG/SVG when ready. */}
        {playerRank && <TierBadge rank={playerRank} />}
        <Link to={`/generate?${generateParams.toString()}`} style={{ textDecoration: 'none' }}>
          <RedButton style={{
            background: team.accent, color: team.color,
            padding: '14px 24px', fontSize: 14,
          }}>
            ✦ Generate Stat Post
          </RedButton>
        </Link>
      </div>

      {/* Stats Cards — curated set with per-stat league rank */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        {player.batting && (
          <Card>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
              <SectionHeading style={{ margin: 0 }}>Batting</SectionHeading>
              <span style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 0.5 }}>
                Rank across {bTotal} BLW batters
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <StatTile label="AVG"  value={player.batting.avg}       rank={battingRanks?.avg}      total={bTotal} />
              <StatTile label="H"    value={player.batting.hits}      rank={battingRanks?.hits}     total={bTotal} />
              <StatTile label="HR"   value={player.batting.hr}        rank={battingRanks?.hr}       total={bTotal} />
              <StatTile label="RBI"  value={player.batting.rbi}       rank={battingRanks?.rbi}      total={bTotal} />
              <StatTile label="OBP"  value={player.batting.obp}       rank={battingRanks?.obp}      total={bTotal} />
              <StatTile label="OPS+" value={player.batting.ops_plus}  rank={battingRanks?.ops_plus} total={bTotal} highlight />
            </div>
          </Card>
        )}
        {player.pitching && (
          <Card>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
              <SectionHeading style={{ margin: 0 }}>Pitching</SectionHeading>
              <span style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 0.5 }}>
                Rank across {pTotal} BLW pitchers
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              <StatTile label="ERA"  value={player.pitching.era}  rank={pitchingRanks?.era}  total={pTotal} />
              <StatTile label="WHIP" value={player.pitching.whip} rank={pitchingRanks?.whip} total={pTotal} />
              <StatTile label="K/4"  value={player.pitching.k4}   rank={pitchingRanks?.k4}   total={pTotal} highlight />
              <StatTile label="BB/4" value={player.pitching.bb4}  rank={pitchingRanks?.bb4}  total={pTotal} />
            </div>
          </Card>
        )}
      </div>

      {/* Media Gallery */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionHeading style={{ margin: 0 }}>Media</SectionHeading>
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
