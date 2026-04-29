// MyStats — athlete-only landing page. The dashboard + full navigation are
// hidden from athletes; this is their entry point. It shows:
//   - Their team's colors + name + record as the hero
//   - A big "Generate content for my team" button that deep-links to /generate
//     with team pre-filled (the Generate page will auto-lock the picker since
//     they're an athlete)
//   - Their team's roster — each card links to that player's page so they can
//     pull up individual stats, media, etc.
//   - A tiny nudge to ProWiffle Stats for league-wide browsing
//
// No server-side data here beyond what fetchAllData already caches. The page
// tolerates missing team_id with a friendly "ask your admin" nudge.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAllData, getTeam, getTeamRoster, playerSlug, TEAMS } from '../data';
import { Card, PageHeader, SectionHeading, RedButton, TeamLogo } from '../components';
import { colors, fonts, radius, shadows } from '../theme';
import { findTeamMedia, blobToObjectURL } from '../media-store';
import { getAllManualPlayers } from '../player-store';
import { useAuth, ROLE_LABELS } from '../auth';

export default function MyStats() {
  const { user, teamId, role } = useAuth();
  const team = teamId ? getTeam(teamId) : null;
  const [apiData, setApiData] = useState(null);
  const [teamMedia, setTeamMedia] = useState([]);
  const [manualPlayers, setManualPlayers] = useState([]);

  useEffect(() => {
    fetchAllData().then(setApiData).catch(() => {});
    // Pull ALL manual players (not just this team's) so trade overrides
    // resolve correctly when filtering API rosters.
    getAllManualPlayers().then(setManualPlayers).catch(() => {});
  }, []);

  useEffect(() => {
    if (!teamId) return;
    findTeamMedia(teamId).then(media => setTeamMedia(media || [])).catch(() => {});
  }, [teamId]);

  const roster = useMemo(() => {
    if (!team) return [];
    return getTeamRoster(team.id, teamMedia, manualPlayers);
  }, [team, teamMedia, manualPlayers]);

  // Team record — API dependent. Data.js exposes TEAMS with cached records.
  const teamRecord = team?.record || '';
  const teamRank = team?.rank || null;

  if (!teamId || !team) {
    return (
      <div style={{ padding: 32 }}>
        <Card style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 42, marginBottom: 10 }}>👋</div>
          <h1 style={{ fontFamily: fonts.heading, fontSize: 28, color: colors.text, margin: 0, letterSpacing: 1.2, fontWeight: 400 }}>
            Welcome to BLW
          </h1>
          <p style={{ fontSize: 14, color: colors.textSecondary, margin: '10px auto 18px', lineHeight: 1.5, maxWidth: 400 }}>
            Your profile isn't assigned to a team yet. Ask your admin to set your team so you can generate content for your roster.
          </p>
          <div style={{
            fontFamily: fonts.condensed, fontSize: 11, color: colors.textMuted, letterSpacing: 0.5,
            padding: 8, background: colors.bg, borderRadius: radius.base, display: 'inline-block',
          }}>
            {user?.email} · {ROLE_LABELS[role] || role}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Hero — team colors */}
      <div style={{
        borderRadius: radius.lg,
        background: `linear-gradient(135deg, ${team.color || colors.navy} 0%, ${team.dark || colors.navyDeep} 100%)`,
        color: '#fff',
        padding: 28,
        boxShadow: shadows.lg,
        display: 'flex', flexDirection: 'column', gap: 14,
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Faint team logo as background flourish */}
        <div style={{
          position: 'absolute', right: -30, top: -30,
          opacity: 0.12, pointerEvents: 'none',
        }}>
          <TeamLogo teamId={team.id} size={220} rounded="none" />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, position: 'relative' }}>
          <TeamLogo teamId={team.id} size={64} rounded="square" />
          <div>
            <div style={{ fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700, letterSpacing: 1.5, opacity: 0.75, textTransform: 'uppercase' }}>
              My Team
            </div>
            <h1 style={{
              fontFamily: fonts.heading, fontSize: 36, color: '#fff',
              margin: '2px 0 0', letterSpacing: 1.5, lineHeight: 1, fontWeight: 400,
            }}>{team.name}</h1>
            <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 13, opacity: 0.85, fontFamily: fonts.body }}>
              {teamRecord && <span><strong>{teamRecord}</strong></span>}
              {teamRank && <span>League rank #{teamRank}</span>}
              <span>{roster.length} roster entries</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4, position: 'relative' }}>
          <Link to={`/generate?team=${team.id}&platform=portrait`} style={{
            background: '#fff', color: team.color || colors.red,
            padding: '10px 18px', borderRadius: radius.base,
            fontFamily: fonts.condensed, fontSize: 13, fontWeight: 800, letterSpacing: 1,
            textDecoration: 'none', textTransform: 'uppercase',
          }}>
            ✦ Generate content
          </Link>
          <Link to={`/teams/${team.slug}`} style={{
            background: 'rgba(255,255,255,0.15)', color: '#fff',
            border: '1px solid rgba(255,255,255,0.3)',
            padding: '10px 18px', borderRadius: radius.base,
            fontFamily: fonts.condensed, fontSize: 13, fontWeight: 800, letterSpacing: 1,
            textDecoration: 'none', textTransform: 'uppercase',
          }}>
            Full team page →
          </Link>
        </div>
      </div>

      {/* Roster grid */}
      <Card>
        <SectionHeading>My teammates</SectionHeading>
        {roster.length === 0 ? (
          <div style={{ padding: 14, color: colors.textSecondary, fontSize: 13 }}>
            No roster loaded yet. Check back once the team's stats have been pulled in.
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 10,
          }}>
            {roster.map(p => (
              <Link
                key={`${p.lastName}-${p.num || p.firstInitial || ''}`}
                to={`/teams/${team.slug}/players/${playerSlug(p)}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: 10, borderRadius: radius.base,
                  border: `1px solid ${colors.borderLight}`,
                  textDecoration: 'none', color: colors.text,
                  background: colors.white,
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
              >
                <div style={{
                  width: 38, height: 38, borderRadius: radius.full,
                  background: team.color + '20', color: team.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: fonts.heading, fontSize: 15, fontWeight: 400, letterSpacing: 0.5,
                  flexShrink: 0,
                }}>
                  {p.num || (p.lastName ? p.lastName[0] : '?')}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.name || p.lastName}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textSecondary, fontFamily: fonts.condensed, letterSpacing: 0.4 }}>
                    {p.statType === 'both' ? 'Batter · Pitcher' : p.statType === 'pitcher' ? 'Pitcher' : p.statType === 'batter' ? 'Batter' : 'Roster'}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Gentle nudge toward league-wide stats */}
      <Card style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 24 }}>▣</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>
            Explore league-wide stats
          </div>
          <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
            Compare your team against the rest of BLW across every batting and pitching category.
          </div>
        </div>
        <Link to="/game-center" style={{
          padding: '8px 14px', borderRadius: radius.base,
          background: colors.bg, border: `1px solid ${colors.border}`,
          fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800, letterSpacing: 1,
          color: colors.text, textDecoration: 'none', textTransform: 'uppercase',
        }}>
          Open →
        </Link>
      </Card>
    </div>
  );
}
