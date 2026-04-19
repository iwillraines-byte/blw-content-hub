import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { TEAMS, generateContentSuggestions, fetchAllData, getTeam, API_CONFIG } from '../data';
import { Card, PageHeader, SectionHeading, TeamChip, TeamLogo, RedButton } from '../components';
import { colors, fonts, radius } from '../theme';

const typeColors = {
  'stat-spotlight': { border: '#3B82F6', bg: 'rgba(59,130,246,0.06)' },
  'streak': { border: '#22C55E', bg: 'rgba(34,197,94,0.06)' },
  'milestone': { border: '#F59E0B', bg: 'rgba(245,158,11,0.06)' },
  'leader-change': { border: '#8B5CF6', bg: 'rgba(139,92,246,0.06)' },
  'matchup': { border: colors.red, bg: colors.redLight },
};

export default function ContentStudio({ teamFilter, setTeamFilter }) {
  const [suggestions, setSuggestions] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    fetchAllData().then(({ batting, pitching, rankings }) => {
      setSuggestions(generateContentSuggestions(batting, pitching, rankings));
      setDataLoaded(true);
    });
  }, []);

  const buildLink = (s) => {
    const params = new URLSearchParams();
    params.set('template', s.templateId);
    if (s.team && s.team !== 'BLW') params.set('team', s.team);
    if (s.prefill) {
      Object.entries(s.prefill).forEach(([k, v]) => { if (v) params.set(k, v); });
    }
    return `/generate?${params.toString()}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="CONTENT STUDIO" subtitle="Your content command center — generate, manage, and track across all BLW teams" />

      {/* Quick Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Link to="/generate" style={{ textDecoration: 'none' }}>
          <Card style={{ padding: 16, cursor: 'pointer', borderLeft: `3px solid ${colors.red}` }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>✦</div>
            <div style={{ fontFamily: fonts.heading, fontSize: 18, color: colors.text, letterSpacing: 1 }}>GENERATE</div>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>Create graphics & content</div>
          </Card>
        </Link>
        <Link to="/requests" style={{ textDecoration: 'none' }}>
          <Card style={{ padding: 16, cursor: 'pointer', borderLeft: `3px solid ${colors.info}` }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>☰</div>
            <div style={{ fontFamily: fonts.heading, fontSize: 18, color: colors.text, letterSpacing: 1 }}>NEW REQUEST</div>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>Submit content request</div>
          </Card>
        </Link>
        <Link to="/game-center" style={{ textDecoration: 'none' }}>
          <Card style={{ padding: 16, cursor: 'pointer', borderLeft: `3px solid ${colors.success}` }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>▣</div>
            <div style={{ fontFamily: fonts.heading, fontSize: 18, color: colors.text, letterSpacing: 1 }}>GAME CENTER</div>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>Stats & live updates</div>
          </Card>
        </Link>
        <Link to="/files" style={{ textDecoration: 'none' }}>
          <Card style={{ padding: 16, cursor: 'pointer', borderLeft: `3px solid ${colors.warning}` }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>◫</div>
            <div style={{ fontFamily: fonts.heading, fontSize: 18, color: colors.text, letterSpacing: 1 }}>FILES</div>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>Upload & manage assets</div>
          </Card>
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* LEFT — Content Suggestions */}
        <div style={{ flex: '1 1 500px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <SectionHeading>CONTENT IDEAS</SectionHeading>
            <p style={{ fontSize: 12, color: colors.textMuted, margin: '0 0 14px', fontFamily: fonts.condensed }}>
              Auto-generated from prowiffleball.com stats — click to create
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {suggestions.map(s => {
                const tc = typeColors[s.type] || typeColors['stat-spotlight'];
                const team = s.team !== 'BLW' ? getTeam(s.team) : null;
                return (
                  <Link key={s.id} to={buildLink(s)} style={{ textDecoration: 'none' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px', borderRadius: radius.base,
                      background: tc.bg, borderLeft: `3px solid ${tc.border}`,
                      transition: 'box-shadow 0.15s', cursor: 'pointer',
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: colors.text, marginBottom: 2 }}>{s.headline}</div>
                        <div style={{ fontSize: 12, color: colors.textSecondary }}>{s.description}</div>
                      </div>
                      {team && <TeamChip teamId={s.team} small withLogo />}
                      <span style={{
                        fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                        color: colors.red, whiteSpace: 'nowrap',
                      }}>Create →</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>

          {/* Recent Activity */}
          <Card>
            <SectionHeading>RECENT ACTIVITY</SectionHeading>
            {[
              { icon: '✦', text: 'Generated LAN Game Day graphic', time: '2 hours ago', color: colors.red },
              { icon: '✓', text: 'Completed request #3 — AZS highlight video', time: '4 hours ago', color: colors.success },
              { icon: '☰', text: 'New request from David Adelman (PHI owner)', time: '6 hours ago', color: colors.info },
              { icon: '📊', text: 'Stats updated from prowiffleball.com', time: '1 day ago', color: '#8B5CF6' },
              { icon: '✦', text: 'Generated LAN 17-1 celebration post', time: '2 days ago', color: colors.red },
            ].map((a, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                borderBottom: i < 4 ? `1px solid ${colors.divider}` : 'none',
              }}>
                <span style={{
                  width: 28, height: 28, borderRadius: radius.sm,
                  background: `${a.color}12`, color: a.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12,
                }}>{a.icon}</span>
                <span style={{ flex: 1, fontSize: 13, color: colors.text }}>{a.text}</span>
                <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, whiteSpace: 'nowrap' }}>{a.time}</span>
              </div>
            ))}
          </Card>
        </div>

        {/* RIGHT — Standings + Status */}
        <div style={{ flex: '0 1 340px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Request Summary */}
          <Card>
            <SectionHeading>REQUEST QUEUE</SectionHeading>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { label: 'Pending', count: 3, color: '#F59E0B', to: '/requests' },
                { label: 'In Progress', count: 1, color: '#3B82F6', to: '/requests' },
                { label: 'Completed', count: 1, color: '#22C55E', to: '/requests' },
              ].map((s, i) => (
                <Link key={i} to={s.to} style={{ textDecoration: 'none', flex: 1 }}>
                  <div style={{
                    textAlign: 'center', padding: '10px 8px',
                    borderRadius: radius.base, background: `${s.color}08`,
                    border: `1px solid ${s.color}20`, cursor: 'pointer',
                  }}>
                    <div style={{ fontSize: 22, fontFamily: fonts.heading, color: s.color }}>{s.count}</div>
                    <div style={{ fontSize: 10, fontFamily: fonts.condensed, fontWeight: 600, color: colors.textMuted }}>{s.label}</div>
                  </div>
                </Link>
              ))}
            </div>
          </Card>

          {/* Data Status */}
          <Card>
            <SectionHeading>DATA STATUS</SectionHeading>
            <div style={{
              padding: 12, borderRadius: radius.base,
              background: API_CONFIG.isLive ? colors.successBg : colors.warningBg,
              border: `1px solid ${API_CONFIG.isLive ? colors.successBorder : colors.warningBorder}`,
              marginBottom: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: API_CONFIG.isLive ? colors.success : colors.warning }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: dataLoaded ? '#15803D' : '#92400E' }}>
                  {dataLoaded ? 'Live — Grand Slam Systems' : 'Loading...'}
                </span>
              </div>
              <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 4 }}>
                app.grandslamsystems.com · Auto-refreshes every 5 min
              </div>
            </div>
          </Card>

          {/* Compact Standings */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <SectionHeading style={{ margin: 0 }}>STANDINGS</SectionHeading>
              <Link to="/game-center" style={{ fontSize: 11, fontFamily: fonts.condensed, fontWeight: 600, color: colors.red, textDecoration: 'none' }}>View Full →</Link>
            </div>
            {TEAMS.map(t => (
              <div key={t.id} onClick={() => setTeamFilter(t.id)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                borderRadius: radius.sm, cursor: 'pointer',
                background: teamFilter === t.id ? colors.redLight : 'transparent',
                marginBottom: 2, transition: 'all 0.15s',
              }}>
                <span style={{
                  width: 18, height: 18, borderRadius: radius.full,
                  background: colors.bg, border: `1px solid ${colors.borderLight}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: fonts.condensed, fontSize: 9, fontWeight: 700, color: colors.textSecondary,
                  flexShrink: 0,
                }}>{t.rank}</span>
                <TeamLogo teamId={t.id} size={22} rounded="square" />
                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: colors.text }}>{t.name}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: colors.textSecondary, fontVariantNumeric: 'tabular-nums', fontFamily: fonts.condensed }}>{t.record}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
