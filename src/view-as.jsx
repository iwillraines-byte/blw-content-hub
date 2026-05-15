// View-as — master-admin-only impersonation controls.
//
// Two surfaces:
//
//   <ViewAsPicker />         — a card on the dashboard that lets a master
//                              admin pick a role + team and start viewing
//                              the app from that perspective. Returns null
//                              for everyone else.
//
//   <ImpersonationBanner />  — a sticky strip across the top of the app
//                              whenever an override is active. Renders
//                              null when not impersonating. Exit button
//                              clears the override and returns the user
//                              to their real surface.
//
// The actual override state lives in src/auth.jsx (useAuth().viewingAs +
// setViewAs). Every page already reads the EFFECTIVE role/teamId from the
// auth context, so no other surface needs to change.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, ROLE_LABELS } from './auth';
import { TEAMS, getTeam, playerSlug } from './data';
import { getAllManualPlayers } from './player-store';
import { Card, SectionHeading, TeamLogo, inputStyle, selectStyle } from './components';
import { colors, fonts, radius } from './theme';

// Roles available for impersonation. Master admin obviously isn't here —
// no point impersonating yourself. Admin is OMITTED on purpose: the role
// is dormant in the enum but we don't grant it (master_admin handles the
// stuff admin used to — trades, bio import, people management — since
// those tasks all live with the master). Keeping admin out of the picker
// stops anyone (including future-you) from QA'ing a surface that won't
// actually be used.
const VIEW_AS_ROLES = [
  { id: 'content', label: 'Content',  description: 'Full app access except master-only admin tools (trades, CSV bio import, people, roster diagnostic). The role you give your social-media team.', requiresTeam: false },
  { id: 'athlete', label: 'Athlete',  description: 'Locked to one team. Lands on My Stats. Full content tools for that team only.', requiresTeam: true },
];

// ─── Picker (master_admin only) ────────────────────────────────────────────

export function ViewAsPicker() {
  const navigate = useNavigate();
  const { realRole, viewingAs, setViewAs } = useAuth();
  if (realRole !== 'master_admin') return null;

  const startView = (role, teamId) => {
    const teamLabel = teamId ? (getTeam(teamId)?.name || teamId) : null;
    const label = teamLabel ? `${ROLE_LABELS[role] || role} · ${teamLabel}` : (ROLE_LABELS[role] || role);
    setViewAs({ role, teamId: teamId || null, label });
    // Athletes land on /my-stats; content/admins on /dashboard. Mirror that.
    navigate(role === 'athlete' ? '/my-stats' : '/dashboard');
  };

  return (
    <Card>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10,
        flexWrap: 'wrap', marginBottom: 4,
      }}>
        <SectionHeading style={{ margin: 0 }}>View as</SectionHeading>
        <span style={{
          fontFamily: fonts.condensed,
          fontSize: 10, fontWeight: 700,
          letterSpacing: 0.5, color: colors.textMuted,
        }}>MASTER ADMIN ONLY · preview the app from another seat</span>
      </div>
      <p style={{
        fontSize: 12, color: colors.textSecondary,
        margin: '4px 0 14px', lineHeight: 1.5,
        maxWidth: '60ch',
      }}>
        Switch into an athlete's view to confirm what they see — sidebar restrictions, locked team picker, the My Stats landing page. A banner stays pinned across the top while you're impersonating; click Exit on the banner (or the active row below) to come back.
      </p>

      {/* v4.7.10: specific-athlete picker. Pre-fix the picker only let you
          view as "an athlete on TEAM X" — useful for testing role gating
          but not for verifying per-player edit gates (each athlete should
          only edit THEIR own player record). Now you can pick a real
          linked athlete and the impersonation carries their user_id so
          canEdit() on PlayerPage fires exactly as it would for them. */}
      <SpecificAthletePicker />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
        {VIEW_AS_ROLES.map(r => (
          <div key={r.id}>
            <div style={{
              display: 'flex', alignItems: 'baseline',
              gap: 8, marginBottom: 6, flexWrap: 'wrap',
            }}>
              <span style={{
                fontFamily: fonts.body,
                fontSize: 14, fontWeight: 700,
                color: colors.text,
              }}>{r.label}</span>
              <span style={{
                fontSize: 12, color: colors.textSecondary,
                lineHeight: 1.5,
              }}>{r.description}</span>
            </div>

            {r.requiresTeam ? (
              // Athlete picker — one chip per BLW team.
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 6,
              }}>
                {TEAMS.map(t => {
                  const active = viewingAs?.role === r.id && viewingAs?.teamId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => active ? setViewAs(null) : startView(r.id, t.id)}
                      title={active ? 'Currently viewing — click to exit' : `Start viewing as an athlete on ${t.name}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 10px',
                        background: active ? `${t.color}1A` : colors.white,
                        border: `1px solid ${active ? t.color : colors.borderLight}`,
                        borderRadius: radius.sm,
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontFamily: fonts.body,
                        fontSize: 12, fontWeight: 600,
                        color: active ? (t.dark || t.color) : colors.text,
                        transition: 'background 160ms ease, border-color 160ms ease',
                      }}
                    >
                      <TeamLogo teamId={t.id} size={20} rounded="square" />
                      <span style={{
                        flex: 1, minWidth: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{t.name}</span>
                      {active && (
                        <span style={{
                          fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
                          letterSpacing: 0.5, color: t.dark || t.color,
                        }}>● ON</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              // Non-team-scoped roles — single button.
              (() => {
                const active = viewingAs?.role === r.id && !viewingAs?.teamId;
                return (
                  <button
                    type="button"
                    onClick={() => active ? setViewAs(null) : startView(r.id, null)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      padding: '8px 14px',
                      background: active ? '#7C3AED14' : colors.white,
                      border: `1px solid ${active ? '#7C3AED' : colors.borderLight}`,
                      borderRadius: radius.sm,
                      cursor: 'pointer',
                      fontFamily: fonts.body,
                      fontSize: 12, fontWeight: 700,
                      color: active ? '#7C3AED' : colors.text,
                    }}
                  >
                    {active ? `● Viewing as ${r.label} — click to exit` : `Start viewing as ${r.label}`}
                  </button>
                );
              })()
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Banner (anywhere — only renders when viewing as) ──────────────────────

export function ImpersonationBanner() {
  const navigate = useNavigate();
  const { viewingAs, realRole, setViewAs } = useAuth();
  if (!viewingAs) return null;

  const team = viewingAs.teamId ? getTeam(viewingAs.teamId) : null;
  const accent = team?.color || '#7C3AED';
  const accentDark = team?.dark || '#5B21B6';

  const exit = () => {
    setViewAs(null);
    // Send the master admin back to their real home. We can't reuse
    // HomeRedirect easily mid-render, so do the equivalent inline.
    if (realRole === 'master_admin' || realRole === 'admin' || realRole === 'content') {
      navigate('/dashboard');
    } else {
      navigate('/');
    }
  };

  const roleLabel = ROLE_LABELS[viewingAs.role] || viewingAs.role;

  return (
    <div
      role="status"
      style={{
        position: 'sticky', top: 0, zIndex: 50,
        // Diagonal stripes evoke "construction zone" without being garish —
        // signals "this is not your real session" with one glance.
        background: `repeating-linear-gradient(
          45deg,
          ${accent}1A 0,
          ${accent}1A 14px,
          ${accent}26 14px,
          ${accent}26 28px
        ), ${accent}10`,
        borderBottom: `2px solid ${accent}`,
        padding: '8px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        flex: 1, minWidth: 0, flexWrap: 'wrap',
      }}>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 24, height: 24, borderRadius: '50%',
            background: accent, color: '#fff',
            fontSize: 13, fontWeight: 800,
          }}
        >👁</span>
        <span style={{
          fontFamily: fonts.body,
          fontSize: 13, fontWeight: 700,
          color: accentDark,
        }}>
          Viewing as {roleLabel}
          {team && (
            <>
              {' · '}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle' }}>
                <TeamLogo teamId={team.id} size={18} rounded="square" />
                {team.name}
              </span>
            </>
          )}
        </span>
        <span style={{
          fontFamily: fonts.condensed,
          fontSize: 10, fontWeight: 700,
          letterSpacing: 0.5, color: accentDark, opacity: 0.7,
        }}>
          PREVIEW · server permissions still match your real account
        </span>
      </div>
      <button
        type="button"
        onClick={exit}
        style={{
          background: accent, color: '#fff', border: 'none',
          borderRadius: radius.sm, padding: '6px 14px',
          fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800,
          letterSpacing: 0.5, cursor: 'pointer',
          flexShrink: 0,
        }}
      >EXIT VIEW</button>
    </div>
  );
}

// ─── Specific-athlete picker ──────────────────────────────────────────────
// v4.7.10: master picks an actual linked athlete and the impersonation
// carries that player's user_id, so PlayerPage's per-player edit gate
// fires as it would for them. Drives off manual_players rows that have
// both a team_id and a user_id (otherwise there's nobody to impersonate).
function SpecificAthletePicker() {
  const navigate = useNavigate();
  const { realRole, viewingAs, setViewAs } = useAuth();
  const [manualPlayers, setManualPlayers] = useState([]);
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (realRole !== 'master_admin') return;
    getAllManualPlayers().then(rows => {
      setManualPlayers(rows || []);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [realRole]);

  if (realRole !== 'master_admin') return null;

  // Only show athletes who have BOTH a linked user_id AND a team. Without
  // user_id, the per-player canEdit gate won't actually behave as it does
  // for that athlete (no signal to match against). Without a team they're
  // ambiguous in the impersonation routing.
  const linked = useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = (manualPlayers || []).filter(p => p.team && (p.user_id || p.userId));
    if (!q) return arr;
    return arr.filter(p => {
      const fullName = `${p.firstName || ''} ${p.lastName || ''}`.toLowerCase();
      const team = (p.team || '').toLowerCase();
      const num = String(p.num || '');
      return fullName.includes(q) || team.includes(q) || num.includes(q);
    });
  }, [manualPlayers, search]);

  const startView = (p) => {
    const team = getTeam(p.team);
    const fullName = `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.name || 'Athlete';
    const label = team ? `${fullName} · ${team.name}` : fullName;
    setViewAs({
      role: 'athlete',
      teamId: p.team,
      userId: p.user_id || p.userId,
      label,
      playerName: fullName,
      playerSlug: playerSlug(p),
    });
    // Send the master straight to the impersonated athlete's player page
    // so they can immediately verify the edit affordances they expected.
    const slug = playerSlug(p);
    if (slug) {
      const teamSlug = (team?.slug) || (team?.id ? team.id.toLowerCase() : '');
      navigate(`/teams/${teamSlug}/players/${slug}`);
    } else {
      navigate('/my-stats');
    }
  };

  const activeUserId = viewingAs?.userId || null;

  return (
    <div style={{
      borderTop: `1px dashed ${colors.borderLight}`,
      paddingTop: 14, marginTop: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontFamily: fonts.body, fontSize: 14, fontWeight: 700, color: colors.text }}>
          View as a specific athlete
        </span>
        <span style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 1.5 }}>
          Carries the athlete's <code style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>user_id</code> so per-player edit gates fire as they would for them.
        </span>
      </div>
      {loaded && linked.length === 0 ? (
        <div style={{
          padding: 14, fontSize: 12, color: colors.textMuted,
          background: colors.bg, borderRadius: radius.sm,
          border: `1px dashed ${colors.borderLight}`,
        }}>
          No linked athletes yet. On a player page, scroll to the AthleteVoice card and use the "Link athlete account" control to bind a Supabase user to that player.
        </div>
      ) : (
        <>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, team, or jersey #…"
            style={{ ...inputStyle, marginBottom: 8 }}
          />
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 6,
            maxHeight: 320, overflowY: 'auto',
          }}>
            {linked.slice(0, 60).map(p => {
              const team = getTeam(p.team);
              const fullName = `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.name || '—';
              const uid = p.user_id || p.userId;
              const active = activeUserId === uid;
              return (
                <button
                  key={p.id || uid}
                  type="button"
                  onClick={() => active ? setViewAs(null) : startView(p)}
                  title={active ? 'Currently viewing — click to exit' : `View as ${fullName}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px',
                    background: active && team ? `${team.color}1A` : colors.white,
                    border: `1px solid ${active && team ? team.color : colors.borderLight}`,
                    borderRadius: radius.sm,
                    cursor: 'pointer', textAlign: 'left',
                    fontFamily: fonts.body, fontSize: 12, fontWeight: 600,
                    color: active && team ? (team.dark || team.color) : colors.text,
                    transition: 'background 160ms ease, border-color 160ms ease',
                  }}
                >
                  {team && <TeamLogo teamId={team.id} size={20} rounded="square" />}
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {fullName}
                    {p.num && <span style={{ color: colors.textMuted, marginLeft: 4 }}>#{p.num}</span>}
                  </span>
                  {active && (
                    <span style={{
                      fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
                      letterSpacing: 0.5,
                      color: team ? (team.dark || team.color) : colors.accent,
                    }}>● ON</span>
                  )}
                </button>
              );
            })}
          </div>
          {linked.length > 60 && (
            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 6, fontFamily: fonts.condensed }}>
              {linked.length - 60} more — narrow with the search box.
            </div>
          )}
        </>
      )}
    </div>
  );
}
