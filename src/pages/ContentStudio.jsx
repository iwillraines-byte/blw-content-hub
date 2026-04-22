import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TEAMS, generateContentSuggestions, fetchAllData, getTeam, API_CONFIG } from '../data';
import { Card, PageHeader, SectionHeading, TeamChip, TeamLogo } from '../components';
import { BattingTable, PitchingTable } from '../stats-tables';
import { colors, fonts, radius } from '../theme';
import { getRequests, countByStatus, oldestPendingDays } from '../requests-store';
import { getAllMedia } from '../media-store';
import { isAlreadyTagged } from '../tag-heuristics';

export default function ContentStudio() {
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [requests, setRequests] = useState([]);
  const [mediaStats, setMediaStats] = useState({ total: 0, untagged: 0 });
  // Live batting + pitching for the Stats Leaders teaser at the bottom of the
  // dashboard. Shares the same fetchAllData() call so nothing hits twice.
  const [batting, setBatting] = useState([]);
  const [pitching, setPitching] = useState([]);

  useEffect(() => {
    fetchAllData().then(({ batting: b, pitching: p, rankings }) => {
      setSuggestions(generateContentSuggestions(b, p, rankings));
      setBatting(b || []);
      setPitching(p || []);
      setDataLoaded(true);
    });
    setRequests(getRequests());
    getAllMedia().then(all => {
      const total = all.length;
      const untagged = all.filter(m => !isAlreadyTagged(m.name)).length;
      setMediaStats({ total, untagged });
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

  // ─── Live-state card data ─────────────────────────────────────────────────
  const pendingCount     = countByStatus(requests, 'pending');
  const inProgressCount  = countByStatus(requests, 'in-progress');
  const completedCount   = countByStatus(requests, 'completed');
  const oldestDays       = oldestPendingDays(requests);
  const topSuggestion    = suggestions[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="Dashboard" subtitle="Your content command center — generate, manage, and track across all BLW teams" />

      {/* Live-state cards — each reflects current state, not just a nav shortcut */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <LiveCard
          icon="✦"
          label="Generate"
          primary={dataLoaded ? `${suggestions.length} idea${suggestions.length === 1 ? '' : 's'} ready` : 'Loading ideas…'}
          secondary={topSuggestion ? `Top: ${truncate(topSuggestion.headline, 40)}` : 'No suggestions yet'}
          to={topSuggestion ? buildLink(topSuggestion) : '/generate'}
          cta={topSuggestion ? 'Create top idea →' : 'Open Generate →'}
        />
        <LiveCard
          icon="☰"
          label="Requests"
          primary={pendingCount === 0
            ? 'No open requests'
            : `${pendingCount} pending`}
          secondary={pendingCount === 0
            ? 'Click to file a new one'
            : oldestDays != null && oldestDays > 0
              ? `Oldest: ${oldestDays} day${oldestDays === 1 ? '' : 's'} ago`
              : 'Created today'}
          to={pendingCount > 0 ? '/requests?status=pending' : '/requests'}
          cta={pendingCount > 0 ? 'Review pending →' : '+ New Request'}
        />
        <LiveCard
          icon="◫"
          label="Files"
          primary={`${mediaStats.total} file${mediaStats.total === 1 ? '' : 's'} in library`}
          secondary={mediaStats.untagged === 0
            ? 'All files tagged ✓'
            : `${mediaStats.untagged} need${mediaStats.untagged === 1 ? 's' : ''} tagging`}
          to="/files"
          cta={mediaStats.untagged > 0 ? 'Tag untagged →' : 'Open Files →'}
          warn={mediaStats.untagged > 0}
        />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* LEFT — Content Suggestions */}
        <div style={{ flex: '1 1 500px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <SectionHeading>Content ideas</SectionHeading>
            <p style={{ fontSize: 12, color: colors.textMuted, margin: '0 0 14px', fontFamily: fonts.condensed }}>
              Auto-generated from prowiffleball.com stats — click to create
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {suggestions.map(s => {
                const team = s.team !== 'BLW' ? getTeam(s.team) : null;
                const accent = team ? team.color : colors.border;
                const bgTint = team ? `${team.color}0C` : colors.bg;
                return (
                  <Link key={s.id} to={buildLink(s)} style={{ textDecoration: 'none' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px', borderRadius: radius.base,
                      background: bgTint, borderLeft: `3px solid ${accent}`,
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
              {dataLoaded && suggestions.length === 0 && (
                <div style={{ fontSize: 13, color: colors.textMuted, padding: 20, textAlign: 'center' }}>
                  No content ideas yet — stats will populate this list.
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* RIGHT — Queue + Standings */}
        <div style={{ flex: '0 1 340px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Request Queue */}
          <Card>
            <SectionHeading>Request queue</SectionHeading>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { label: 'Pending', count: pendingCount, color: '#F59E0B', status: 'pending' },
                { label: 'In Progress', count: inProgressCount, color: '#3B82F6', status: 'in-progress' },
                { label: 'Completed', count: completedCount, color: '#22C55E', status: 'completed' },
              ].map((s, i) => (
                <Link
                  key={i}
                  to={`/requests?status=${s.status}`}
                  style={{ textDecoration: 'none', flex: 1 }}
                >
                  <div style={{
                    textAlign: 'center', padding: '10px 8px',
                    borderRadius: radius.base, background: `${s.color}08`,
                    border: `1px solid ${s.color}20`, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = `${s.color}14`}
                  onMouseLeave={e => e.currentTarget.style.background = `${s.color}08`}
                  >
                    <div style={{ fontSize: 22, fontFamily: fonts.heading, color: s.color }}>{s.count}</div>
                    <div style={{ fontSize: 10, fontFamily: fonts.condensed, fontWeight: 600, color: colors.textMuted }}>{s.label}</div>
                  </div>
                </Link>
              ))}
            </div>
          </Card>

          {/* Data Status */}
          <Card>
            <SectionHeading>Data status</SectionHeading>
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

          {/* Compact Standings — row clicks go to team page; hover reveals "Create graphic" action */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <SectionHeading style={{ margin: 0 }}>Standings</SectionHeading>
              <Link to="/game-center" style={{ fontSize: 11, fontFamily: fonts.condensed, fontWeight: 600, color: colors.red, textDecoration: 'none' }}>View Full →</Link>
            </div>
            {TEAMS.map(t => (
              <StandingsRow key={t.id} team={t} navigate={navigate} />
            ))}
          </Card>
        </div>
      </div>

      {/* Stats Leaders — top 10 batters + top 10 pitchers, percentile shading
          computed across the full BLW population. A teaser of the Game Center. */}
      {dataLoaded && (batting.length > 0 || pitching.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionHeading style={{ margin: 0 }}>Stats Leaders</SectionHeading>
            <Link to="/game-center" style={{ fontSize: 12, fontFamily: fonts.condensed, fontWeight: 700, color: colors.red, textDecoration: 'none' }}>
              View full leaderboards →
            </Link>
          </div>
          {batting.length > 0 && (
            <BattingTable
              rows={batting}
              populationRows={batting}
              title="Top 10 Batters"
              showSearch={false}
              limit={10}
            />
          )}
          {pitching.length > 0 && (
            <PitchingTable
              rows={pitching}
              populationRows={pitching}
              title="Top 10 Pitchers"
              showSearch={false}
              showLegend={false}
              limit={10}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncate(str, n) {
  if (!str) return '';
  return str.length <= n ? str : str.slice(0, n - 1) + '…';
}

// Single live-state card at the top of the dashboard
function LiveCard({ icon, label, primary, secondary, to, cta, warn }) {
  return (
    <Link to={to} style={{ textDecoration: 'none' }}>
      <Card style={{
        padding: 20, cursor: 'pointer',
        borderLeft: `3px solid ${warn ? colors.warning : colors.red}`,
        display: 'flex', flexDirection: 'column', gap: 4,
        height: '100%', boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <span style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: 600, color: colors.textSecondary }}>{label}</span>
        </div>
        <div style={{ fontFamily: fonts.body, fontSize: 18, fontWeight: 700, color: colors.text, lineHeight: 1.2 }}>
          {primary}
        </div>
        <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 6 }}>{secondary}</div>
        <div style={{ fontFamily: fonts.body, fontSize: 12, fontWeight: 700, color: colors.red }}>
          {cta}
        </div>
      </Card>
    </Link>
  );
}

// Standings row — primary click goes to team page; hover reveals a secondary
// "Create graphic →" action that deep-links to Generate with the standings
// template pre-selected.
function StandingsRow({ team, navigate }) {
  const [hovering, setHovering] = useState(false);
  const goTeam = () => navigate(`/teams/${team.slug}`);
  const goGen  = (e) => {
    e.preventDefault(); e.stopPropagation();
    navigate(`/generate?template=standings&team=${team.id}`);
  };
  return (
    <div
      onClick={goTeam}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
        borderRadius: radius.sm, cursor: 'pointer',
        marginBottom: 2, transition: 'background 0.15s',
        background: hovering ? colors.bg : 'transparent',
      }}
    >
      <span style={{
        width: 18, height: 18, borderRadius: radius.full,
        background: colors.bg, border: `1px solid ${colors.borderLight}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: fonts.condensed, fontSize: 9, fontWeight: 700, color: colors.textSecondary,
        flexShrink: 0,
      }}>{team.rank}</span>
      <TeamLogo teamId={team.id} size={22} rounded="square" />
      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>
      {hovering ? (
        <button
          onClick={goGen}
          style={{
            background: colors.red, color: '#fff', border: 'none',
            borderRadius: radius.sm, padding: '3px 8px',
            fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}
          title="Generate a standings graphic featuring this team"
        >Create →</button>
      ) : (
        <span style={{ fontSize: 12, fontWeight: 700, color: colors.textSecondary, fontVariantNumeric: 'tabular-nums', fontFamily: fonts.condensed }}>{team.record}</span>
      )}
    </div>
  );
}
