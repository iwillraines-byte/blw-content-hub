import { useState, useEffect, useRef } from 'react';
import { Routes, Route, Link, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { TEAMS, API_CONFIG } from './data';
import { colors, fonts, radius, sidebar as sidebarConfig, shadows } from './theme';
import { TeamThemeScope } from './team-theme';
import { GlobalStyles } from './global-styles';
import { APP_VERSION, GIT_COMMIT, formattedBuildDate } from './version';
import ContentStudio from './pages/ContentStudio';
import Generate from './pages/Generate';
import Requests from './pages/Requests';
import GameCenter from './pages/GameCenter';
import Files from './pages/Files';
import Settings from './pages/Settings';
import TeamPage from './pages/TeamPage';
import PlayerPage from './pages/PlayerPage';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import MyStats from './pages/MyStats';
import { TeamLogo } from './components';
import { TierBadgeStyles } from './tier-badges';
import { refreshFromCloud, lastHydratedAt } from './cloud-reader';
import { supabaseConfigured } from './supabase-client';
import { ToastProvider } from './toast';
import { QuickSwitcher } from './quick-switcher';
import { AuthProvider, useAuth, ROLE_LABELS, isAthleteRole, isAdminRole } from './auth';

const MOBILE_BREAKPOINT = 768;

// Nav items. `roles` declares who can see each item — missing means
// "everyone signed-in". Athletes get a trimmed sidebar (no Files, no
// request queue admin, no global Settings).
const navItems = [
  { path: "/my-stats",    label: "My Team",          icon: "★",  roles: ['athlete'] },
  { path: "/dashboard",   label: "Dashboard",        icon: "⚡", roles: ['master_admin', 'admin', 'content'] },
  { path: "/generate",    label: "Generate",         icon: "✦" },
  { path: "/requests",    label: "Requests",         icon: "☰",  roles: ['master_admin', 'admin', 'content'] },
  { path: "/game-center", label: "ProWiffle Stats",  icon: "▣" },
  { path: "/files",       label: "Files",            icon: "◫",  roles: ['master_admin', 'admin', 'content'] },
  { path: "/settings",    label: "Settings",         icon: "⚙" },
];

const pageTitles = {
  '/dashboard': 'Dashboard',
  '/generate': 'Generate',
  '/requests': 'Requests',
  '/game-center': 'ProWiffle Stats',
  '/files': 'Files',
  '/settings': 'Settings',
};

// Top-bar team selector navigates — pick a team → go to that team's page,
// "All Teams" → go to Dashboard. The current value is derived from the URL.
function useCurrentTeamFromUrl() {
  const location = useLocation();
  const m = location.pathname.match(/^\/teams\/([^/]+)/);
  if (!m) return null;
  return TEAMS.find(t => t.slug === m[1]) || null;
}

// RouteAnimator — wraps the route subtree in a div whose `key` changes on
// every pathname change, so React unmounts + remounts the children on nav.
// The .route-enter class then runs its keyframe afresh, producing the
// 180ms fade-up between pages. We don't unmount the <Routes /> itself —
// only this wrapper — so the transition is purely visual; route matching
// stays normal.
function RouteAnimator({ children }) {
  const location = useLocation();
  return (
    <div key={location.pathname} className="route-enter" style={{ minHeight: 0 }}>
      {children}
    </div>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < MOBILE_BREAKPOINT);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

function TeamsDropdown({ location }) {
  const onTeamRoute = location.pathname.startsWith('/teams');
  const [expanded, setExpanded] = useState(onTeamRoute);

  // Auto-expand when on a team route
  useEffect(() => {
    if (onTeamRoute) setExpanded(true);
  }, [onTeamRoute]);

  return (
    <>
      <button
        onClick={() => setExpanded(!expanded)}
        className={['nav-link', onTeamRoute ? 'is-active' : ''].filter(Boolean).join(' ')}
        style={{
          textDecoration: 'none', display: 'flex', alignItems: 'center',
          gap: 12, padding: '12px 14px', borderRadius: radius.base,
          background: onTeamRoute ? 'rgba(221, 60, 60, 0.12)' : 'transparent',
          color: onTeamRoute ? '#fff' : colors.textOnDarkMuted,
          fontFamily: fonts.body, fontSize: 16,
          fontWeight: onTeamRoute ? 700 : 500,
          border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
        }}>
        <span style={{ fontSize: 20, width: 24, textAlign: 'center', opacity: onTeamRoute ? 1 : 0.6 }}>⚑</span>
        <span style={{ flex: 1 }}>Teams</span>
        <span style={{ fontSize: 11, opacity: 0.5, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▶</span>
      </button>

      {expanded && (
        <div style={{ paddingLeft: 28, display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 4 }}>
          {TEAMS.map(t => {
            const teamActive = location.pathname === `/teams/${t.slug}` || location.pathname.startsWith(`/teams/${t.slug}/`);
            return (
              <Link
                key={t.id}
                to={`/teams/${t.slug}`}
                className={['nav-link', teamActive ? 'is-active' : ''].filter(Boolean).join(' ')}
                style={{
                  textDecoration: 'none', display: 'flex', alignItems: 'center',
                  gap: 10, padding: '8px 12px', borderRadius: radius.sm,
                  background: teamActive ? 'rgba(221, 60, 60, 0.1)' : 'transparent',
                  color: teamActive ? '#fff' : 'rgba(255,255,255,0.5)',
                  fontFamily: fonts.body, fontSize: 14,
                  fontWeight: teamActive ? 700 : 500,
                }}>
                <TeamLogo teamId={t.id} size={24} rounded="square" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function Sidebar({ isMobile, open, onClose }) {
  const location = useLocation();
  const { role, isConfigured } = useAuth();

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    if (isMobile) onClose();
  }, [location.pathname]);

  if (isMobile && !open) return null;

  // When Supabase isn't configured (dev without env vars) we don't filter —
  // assume the dev sees everything. Otherwise only render items whose
  // `roles` list includes the current role (or items with no `roles` set).
  const visibleNavItems = navItems.filter(n => {
    if (!n.roles) return true;
    if (!isConfigured) return true;
    return role && n.roles.includes(role);
  });

  return (
    <>
      {/* Overlay for mobile */}
      {isMobile && (
        <div onClick={onClose} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          zIndex: 99, transition: 'opacity 0.2s',
        }} />
      )}

      <aside style={{
        width: sidebarConfig.width,
        minWidth: sidebarConfig.width,
        background: colors.navy,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: isMobile ? 'fixed' : 'sticky',
        top: 0,
        left: 0,
        zIndex: isMobile ? 100 : 50,
        boxShadow: isMobile ? '4px 0 24px rgba(0,0,0,0.3)' : 'none',
      }}>
        {/* Logo — compact single line */}
        <Link to="/dashboard" style={{ textDecoration: 'none', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: radius.base,
            background: colors.red,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontFamily: fonts.heading, color: '#fff',
            letterSpacing: 1
          }}>B</div>
          <div style={{
            fontFamily: fonts.heading, fontSize: 18, color: '#fff',
            letterSpacing: 1.5, lineHeight: 1,
          }}>BLW Content Hub</div>
        </Link>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          {visibleNavItems.map(n => {
            const active = location.pathname === n.path || (location.pathname === '/' && n.path === '/dashboard');
            return (
              <Link
                key={n.path}
                to={n.path}
                className={['nav-link', active ? 'is-active' : ''].filter(Boolean).join(' ')}
                style={{
                  textDecoration: 'none', display: 'flex', alignItems: 'center',
                  gap: 12, padding: '12px 14px', borderRadius: radius.base,
                  background: active ? 'rgba(221, 60, 60, 0.12)' : 'transparent',
                  color: active ? '#fff' : colors.textOnDarkMuted,
                  fontFamily: fonts.body, fontSize: 16,
                  fontWeight: active ? 700 : 500,
                }}>
                <span style={{ fontSize: 20, width: 24, textAlign: 'center', opacity: active ? 1 : 0.6 }}>{n.icon}</span>
                {n.label}
              </Link>
            );
          })}

          {/* Teams Dropdown */}
          <TeamsDropdown location={location} />
        </nav>

        {/* Footer — version + commit are live at build time (see
            src/version.js + vite.config.js). Hovering the version row
            shows the build date so we can correlate a bug report to a
            specific deploy. The commit is a clickable link to the GitHub
            commit page, so future-me can jump from "user reported X on
            v2.1.0 · a3f8c2b" straight to that ref. */}
        <div style={{
          padding: '14px 18px', borderTop: '1px solid rgba(255,255,255,0.06)',
          fontFamily: fonts.condensed, fontSize: 10,
          color: 'rgba(255,255,255,0.25)', textAlign: 'center', lineHeight: 1.5,
        }}>
          <div>Created by Savant Media</div>
          <div style={{ opacity: 0.7 }} title={`Built ${formattedBuildDate()}`}>
            v{APP_VERSION}
            {GIT_COMMIT !== 'dev' && (
              <>
                {' · '}
                <a
                  href={`https://github.com/iwillraines-byte/blw-content-hub/commit/${GIT_COMMIT}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: 'inherit', textDecoration: 'none',
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  }}
                >{GIT_COMMIT}</a>
              </>
            )}
            {GIT_COMMIT === 'dev' && ' · dev'}
            {' · prowiffleball.com'}
          </div>
        </div>
      </aside>
    </>
  );
}

function getPageTitle(pathname) {
  if (pageTitles[pathname]) return pageTitles[pathname];
  // Dynamic title for team/player routes
  const teamMatch = pathname.match(/^\/teams\/([^/]+)(\/players\/([^/]+))?/);
  if (teamMatch) {
    const team = TEAMS.find(t => t.slug === teamMatch[1]);
    if (teamMatch[3]) {
      const last = teamMatch[3].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return `${last} · ${team?.id || teamMatch[1].toUpperCase()}`;
    }
    return team?.name || 'Team';
  }
  return 'BLW Content Hub';
}

// Small chip that shows how long ago the app last pulled from Supabase.
// Ticks every 30s so the number stays honest without being noisy. Hidden
// entirely when Supabase isn't configured (no cloud = no sync concept).
function useSyncedAgoLabel() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!supabaseConfigured) return null;
  const at = lastHydratedAt();
  if (!at) return 'Never';
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return 'Just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function TopBar({ isMobile, onMenuToggle }) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentTeam = useCurrentTeamFromUrl();
  const title = getPageTitle(location.pathname);
  const syncedAgo = useSyncedAgoLabel();
  const [resyncing, setResyncing] = useState(false);
  const forceResync = async () => {
    if (resyncing) return;
    setResyncing(true);
    try {
      await refreshFromCloud({ force: true });
    } finally {
      setResyncing(false);
    }
  };

  // Selecting a team navigates to that team's page.
  // "ALL" navigates to Dashboard — the app-wide landing view.
  const handleTeamSelect = (value) => {
    if (value === 'ALL') {
      navigate('/dashboard');
    } else {
      const team = TEAMS.find(t => t.id === value);
      if (team) navigate(`/teams/${team.slug}`);
    }
  };

  return (
    <header style={{
      background: colors.white,
      // Team context shows as a full-width bottom underline tinted with the
      // team color (not a side-stripe). When no team is in context, falls
      // back to the standard divider.
      borderBottom: currentTeam ? `2px solid ${currentTeam.color}` : `1px solid ${colors.border}`,
      padding: isMobile ? '10px 14px' : '12px 24px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      position: 'sticky', top: 0, zIndex: 40,
      gap: 10,
      transition: 'border-bottom-color 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Hamburger menu on mobile */}
        {isMobile && (
          <button onClick={onMenuToggle} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 22, color: colors.text, padding: '2px 4px',
            display: 'flex', alignItems: 'center',
          }}>☰</button>
        )}
        <h2 style={{
          fontFamily: fonts.heading, fontSize: isMobile ? 18 : 24,
          fontWeight: 400, color: colors.text, margin: 0, letterSpacing: 1.2,
          whiteSpace: 'nowrap',
        }}>{title}</h2>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, flexShrink: 0 }}>
        {/* Cmd+K hint — desktop only; hints the global switcher hotkey */}
        {!isMobile && (
          <button
            onClick={() => {
              // Synthesize a Cmd+K keystroke so the switcher opens.
              const ev = new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true });
              window.dispatchEvent(ev);
            }}
            title="Quick switcher · ⌘K"
            style={{
              background: colors.bg, border: `1px solid ${colors.border}`,
              color: colors.textSecondary, cursor: 'pointer',
              padding: '4px 10px', borderRadius: radius.full,
              fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <span>⌘K</span>
            <span style={{ opacity: 0.6 }}>JUMP TO…</span>
          </button>
        )}
        {/* Cloud sync chip — only rendered when Supabase is configured.
            Clicking forces a re-hydrate from the cloud. */}
        {syncedAgo !== null && (
          <button
            onClick={forceResync}
            disabled={resyncing}
            title={resyncing ? 'Pulling fresh data from the cloud…' : 'Click to force a fresh pull from Supabase'}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: radius.full,
              background: resyncing ? 'rgba(14,165,233,0.18)' : 'rgba(14,165,233,0.10)',
              border: `1px solid rgba(14,165,233,0.35)`,
              cursor: resyncing ? 'wait' : 'pointer',
              fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
              color: '#075985', letterSpacing: 0.5,
            }}
          >
            <span style={{
              display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
              background: resyncing ? '#0EA5E9' : '#075985',
              animation: resyncing ? 'syncpulse 1.2s ease-in-out infinite' : 'none',
            }} />
            {!isMobile && (resyncing ? 'SYNCING…' : `SYNCED ${syncedAgo.toUpperCase()}`)}
          </button>
        )}
        <style>{`@keyframes syncpulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
        {/* API Status — hide label on mobile */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: radius.full,
          background: API_CONFIG.isLive ? colors.successBg : colors.warningBg,
          border: `1px solid ${API_CONFIG.isLive ? colors.successBorder : colors.warningBorder}`,
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: API_CONFIG.isLive ? colors.success : colors.warning,
          }} />
          {!isMobile && (
            <span style={{
              fontFamily: fonts.condensed, fontSize: 10, fontWeight: 600,
              color: API_CONFIG.isLive ? '#15803D' : '#92400E',
            }}>
              {API_CONFIG.isLive ? 'LIVE API' : 'CACHED DATA'}
            </span>
          )}
        </div>

        {/* Team navigator — picking a team takes you to that team's page */}
        <select
          value={currentTeam?.id || 'ALL'}
          onChange={e => handleTeamSelect(e.target.value)}
          title="Jump to a team page"
          style={{
            background: currentTeam ? `${currentTeam.color}12` : colors.white,
            color: currentTeam ? currentTeam.color : colors.text,
            border: `1px solid ${currentTeam ? currentTeam.color + '40' : colors.border}`,
            borderRadius: radius.base,
            padding: '6px 10px', fontFamily: fonts.body,
            fontSize: 12, fontWeight: 700, cursor: 'pointer', outline: 'none',
            maxWidth: isMobile ? 130 : 'none',
            transition: 'all 0.15s',
          }}
        >
          <option value="ALL">{isMobile ? 'Jump to…' : 'Jump to team…'}</option>
          {TEAMS.map(t => <option key={t.id} value={t.id}>{isMobile ? t.id : `${t.id} · ${t.name}`}</option>)}
        </select>

        {/* Hide bell on very small screens */}
        {!isMobile && (
          <div style={{
            width: 34, height: 34, borderRadius: radius.full,
            border: `1px solid ${colors.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: 14, color: colors.textSecondary,
          }}>🔔</div>
        )}

        {/* User profile menu (replaces the old hardcoded "WR" avatar) */}
        <ProfileMenu isMobile={isMobile} />
      </div>
    </header>
  );
}

// Profile menu — initials avatar that opens a dropdown with the signed-in
// email, a link to Settings, and a sign-out action. When Supabase is not
// configured (no auth), falls back to a static "BL" chip so the layout
// doesn't shift in dev.
function ProfileMenu({ isMobile }) {
  const { user, role, teamId, signOut, isConfigured } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const email = user?.email || '';
  const initials = (email ? email[0] : 'B').toUpperCase()
    + (email.split('@')[0]?.[1] || 'L').toUpperCase();

  const doSignOut = async () => {
    setOpen(false);
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title={email || 'Account'}
        style={{
          width: 34, height: 34, borderRadius: radius.full,
          background: colors.navy, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: fonts.condensed, fontSize: 13, fontWeight: 700,
          flexShrink: 0, border: 'none', cursor: 'pointer',
          boxShadow: open ? '0 0 0 2px rgba(221,60,60,0.4)' : 'none',
          transition: 'box-shadow 0.15s',
        }}
      >
        {initials}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          minWidth: 240, maxWidth: 280,
          background: colors.white, border: `1px solid ${colors.border}`,
          borderRadius: radius.base, boxShadow: shadows.lg,
          zIndex: 60, overflow: 'hidden',
        }}>
          {/* Identity block */}
          <div style={{
            padding: '12px 14px', borderBottom: `1px solid ${colors.borderLight}`,
            background: colors.bg,
          }}>
            <div style={{
              fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
              color: colors.textSecondary, letterSpacing: 1, textTransform: 'uppercase',
            }}>Signed in as</div>
            <div style={{
              fontFamily: fonts.body, fontSize: 13, color: colors.text,
              marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', fontWeight: 600,
            }}>
              {email || (isConfigured ? '(no session)' : 'Auth not configured')}
            </div>
            {/* Role + team chips — only when a profile has loaded */}
            {role && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{
                  fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                  letterSpacing: 0.5, textTransform: 'uppercase',
                  padding: '2px 8px', borderRadius: radius.full,
                  background: isAdminRole(role) ? 'rgba(221,60,60,0.12)' : 'rgba(59,130,246,0.10)',
                  color: isAdminRole(role) ? colors.red : '#1D4ED8',
                  border: `1px solid ${isAdminRole(role) ? 'rgba(221,60,60,0.25)' : 'rgba(59,130,246,0.25)'}`,
                }}>{ROLE_LABELS[role] || role}</span>
                {teamId && (
                  <span style={{
                    fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                    letterSpacing: 0.5,
                    padding: '2px 8px', borderRadius: radius.full,
                    background: colors.bg, color: colors.textSecondary,
                    border: `1px solid ${colors.border}`,
                  }}>{teamId}</span>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <button onClick={() => { setOpen(false); navigate('/settings'); }} style={menuItemStyle}>
            <span style={{ width: 18, textAlign: 'center' }}>⚙</span>
            Settings
          </button>

          {isConfigured && user && (
            <button onClick={doSignOut} style={{ ...menuItemStyle, color: colors.red }}>
              <span style={{ width: 18, textAlign: 'center' }}>↪</span>
              Sign out
            </button>
          )}

          {isConfigured && !user && (
            <button onClick={() => { setOpen(false); navigate('/login'); }} style={menuItemStyle}>
              <span style={{ width: 18, textAlign: 'center' }}>→</span>
              Sign in
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const menuItemStyle = {
  display: 'flex', alignItems: 'center', gap: 10,
  width: '100%', padding: '10px 14px',
  background: 'none', border: 'none', cursor: 'pointer',
  fontFamily: fonts.body, fontSize: 13, color: colors.text,
  textAlign: 'left',
};

// Small "you don't have access" card shown when a user's role can't
// reach the route they navigated to directly. The nav already hides the
// link for athletes, but a typed URL or a bookmark would otherwise 404-
// ish into a broken page. This gives them a clear "ask your admin" nudge.
function AccessDenied({ what }) {
  const { role } = useAuth();
  return (
    <div style={{
      padding: 48, textAlign: 'center', fontFamily: fonts.body,
      color: colors.textSecondary,
    }}>
      <div style={{ fontSize: 42, marginBottom: 10 }}>🔒</div>
      <h1 style={{
        fontFamily: fonts.heading, fontSize: 28, color: colors.text,
        margin: 0, letterSpacing: 1.2, fontWeight: 400,
      }}>Access restricted</h1>
      <p style={{ marginTop: 10, fontSize: 14 }}>
        Your role ({ROLE_LABELS[role] || role || 'unknown'}) can't view {what}.
        Ask an admin if you need access.
      </p>
    </div>
  );
}

// "/" redirect — athletes land on /my-stats, staff on /dashboard.
// If profile is still loading, render a tiny placeholder. If the user is
// signed in but has NO profile row (migration 003 hasn't run), route to
// /settings so the in-page ProfileNotFound card can surface the fix.
function HomeRedirect() {
  const { role, user, profileLoading, isConfigured } = useAuth();
  if (!isConfigured) return <Navigate to="/dashboard" replace />;
  if (profileLoading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: colors.textSecondary, fontSize: 13 }}>
        Loading your profile…
      </div>
    );
  }
  if (user && !role) return <ProfileNotFound />;
  if (isAthleteRole(role)) return <Navigate to="/my-stats" replace />;
  return <Navigate to="/dashboard" replace />;
}

// Route gate — wraps a child in an AccessDenied shell if the current role
// isn't allowed. Used for athlete-hidden routes like /files and /requests.
function RequireRole({ roles, what, children }) {
  const { role, isConfigured, profileLoading, user } = useAuth();
  // Dev without Supabase: show everything.
  if (!isConfigured) return children;
  // Actively loading the profile — render a tiny spinner so the page isn't
  // blank (previously returned null which made /dashboard look broken).
  if (profileLoading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: colors.textSecondary, fontSize: 13 }}>
        Loading your profile…
      </div>
    );
  }
  // Signed in but the profile couldn't be loaded (migration 003 hasn't run,
  // or the trigger didn't fire for this user). Give them a clear message
  // instead of a silent-null "page is blank" state.
  if (user && !role) return <ProfileNotFound />;
  if (!role) return null;
  if (!roles.includes(role)) return <AccessDenied what={what} />;
  return children;
}

// Shown when the user is signed in but has no profile row. Tells them
// exactly what to do rather than leaving the page blank or access-denied.
function ProfileNotFound() {
  const { user } = useAuth();
  return (
    <div style={{
      maxWidth: 600, margin: '40px auto', padding: 32,
      background: colors.white, borderRadius: radius.lg,
      border: `1px solid ${colors.borderLight}`,
      fontFamily: fonts.body, color: colors.text,
    }}>
      <div style={{ fontSize: 36, marginBottom: 6 }}>🛠</div>
      <h1 style={{ fontFamily: fonts.heading, fontSize: 28, margin: 0, letterSpacing: 1.2, fontWeight: 400 }}>
        Profile setup required
      </h1>
      <p style={{ fontSize: 14, color: colors.textSecondary, margin: '10px 0 16px', lineHeight: 1.6 }}>
        You're signed in as <strong>{user?.email}</strong> but no profile row exists in the database.
        That means a role + team haven't been assigned yet, so role-gated pages (Dashboard, Files, Requests, My Team)
        are hiding themselves until setup is done.
      </p>
      <div style={{
        padding: 14, borderRadius: radius.base,
        background: colors.bg, border: `1px solid ${colors.borderLight}`,
        fontSize: 13, color: colors.text, lineHeight: 1.6,
      }}>
        <strong>To fix (master admin only):</strong>
        <ol style={{ margin: '6px 0 0 20px', padding: 0 }}>
          <li>Run <code>db/003_profiles_and_policies.sql</code> in the Supabase SQL editor.</li>
          <li>Run:<br/>
            <code style={{
              display: 'block', marginTop: 6, padding: 8, background: '#0B0D10', color: '#A7F3D0',
              fontSize: 12, borderRadius: 4, overflowX: 'auto',
            }}>
              UPDATE public.profiles SET role='master_admin' WHERE email='{user?.email}';
            </code>
          </li>
          <li>Hard-refresh this page (Cmd+Shift+R).</li>
        </ol>
      </div>
      <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 12, lineHeight: 1.5 }}>
        If you already ran the SQL, your browser may have a stale cached session. Try signing out (top-right avatar → Sign out) and back in.
      </p>
    </div>
  );
}

// Renders a spinner while AuthProvider is restoring the session on a hard
// refresh. Prevents the "flash of /login" that would happen if we gated
// before AuthProvider had a chance to read storage.
function AuthLoadingSplash() {
  return (
    <div style={{
      minHeight: '100vh', background: colors.navy,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 32, height: 32,
        border: `3px solid rgba(255,255,255,0.15)`,
        borderTopColor: '#fff', borderRadius: '50%',
        animation: 'authspin 0.9s linear infinite',
      }} />
      <style>{`@keyframes authspin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

// Small persistent banner across the top of the app when a signed-in user
// has no profile row (migration 003 not run OR auto-create trigger didn't
// fire). Self-dismissing once the profile appears.
function ProfileSetupBanner() {
  const { user, role, profileLoading, isConfigured } = useAuth();
  if (!isConfigured || profileLoading) return null;
  if (!user || role) return null;
  return (
    <div style={{
      background: '#FEF3C7', color: '#92400E',
      borderBottom: '1px solid #FDE68A',
      padding: '8px 16px',
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      fontSize: 12, fontFamily: fonts.body,
    }}>
      <span style={{ fontSize: 16 }}>⚠</span>
      <span style={{ flex: 1, minWidth: 240 }}>
        <strong>Profile setup required.</strong> Some pages are hidden until
        an admin runs <code>db/003_profiles_and_policies.sql</code> and promotes
        your account. See Dashboard for the steps.
      </span>
    </div>
  );
}

// Inner app — assumes a user is already signed in (or auth isn't configured).
// This is the old App body, now gated behind AuthGate.
function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  // URL-derived team context — drives the accent color drift on team
  // and player routes. Other routes get null and the brand red baseline
  // wins through the theme.js fallbacks.
  const currentTeam = useCurrentTeamFromUrl();

  // Phase 4: on app mount, pull latest records from Supabase into the local
  // IDB / localStorage cache. Throttled to once per 10 min so navigation
  // between pages doesn't spam the API. Silently no-ops if not configured.
  useEffect(() => {
    refreshFromCloud().catch(err => console.warn('[cloud-reader] hydrate failed', err));
  }, []);

  return (
    <div style={{
      fontFamily: fonts.body, color: colors.text,
      display: 'flex', minHeight: '100vh', background: colors.bg,
    }}>
      {/* Inject tier-badge glow keyframes once at app root */}
      <TierBadgeStyles />
      {/* Inject global hover/focus/active rules for buttons, cards,
          nav links, and form fields. See src/global-styles.jsx. */}
      <GlobalStyles />
      {/* Global Cmd+K / Ctrl+K quick switcher */}
      <QuickSwitcher />
      <Sidebar isMobile={isMobile} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar
          isMobile={isMobile}
          onMenuToggle={() => setSidebarOpen(prev => !prev)}
        />

        {/* Sticky banner that nudges profile setup when the user's role
            hasn't loaded. Hidden in dev + once the profile lands. */}
        <ProfileSetupBanner />

        <main style={{
          flex: 1,
          padding: isMobile ? 12 : 24,
          maxWidth: 1200,
          width: '100%',
          boxSizing: 'border-box',
        }}>
          {/* Route content drifts to the active team's accent palette
              when on /teams/:slug or /teams/:slug/players/:lastName.
              Scope is contained to <main>, so the sidebar and any
              cross-team chrome stay brand-consistent. Generate.jsx
              wraps a nested scope keyed off its own state-selected
              team — nested scopes override outer cleanly.

              The `key={location.pathname}` on the next div forces React
              to remount the subtree on every navigation, which retriggers
              the .route-enter keyframe (defined in global-styles.jsx).
              Net effect: a 180ms fade-up between pages instead of a hard
              cut. Cheap perceived-quality win. */}
          <TeamThemeScope team={currentTeam}>
          <RouteAnimator>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/dashboard" element={
              <RequireRole roles={['master_admin', 'admin', 'content']} what="the Dashboard">
                <ContentStudio />
              </RequireRole>
            } />
            <Route path="/my-stats" element={<MyStats />} />
            <Route path="/generate" element={<Generate />} />
            <Route path="/requests" element={
              <RequireRole roles={['master_admin', 'admin', 'content']} what="the Requests queue">
                <Requests />
              </RequireRole>
            } />
            <Route path="/game-center" element={<GameCenter />} />
            <Route path="/files" element={
              <RequireRole roles={['master_admin', 'admin', 'content']} what="the Files library">
                <Files />
              </RequireRole>
            } />
            <Route path="/settings" element={<Settings />} />
            <Route path="/teams/:slug" element={<TeamPage />} />
            <Route path="/teams/:slug/players/:lastName" element={<PlayerPage />} />
            {/* Backward-compatible redirects */}
            <Route path="/studio" element={<Navigate to="/dashboard" replace />} />
            <Route path="/stats" element={<Navigate to="/game-center" replace />} />
            <Route path="/assets" element={<Navigate to="/files" replace />} />
          </Routes>
          </RouteAnimator>
          </TeamThemeScope>
        </main>
      </div>
    </div>
  );
}

// Router-level auth gate.
//   - `/login` and `/auth/callback` are public — always accessible
//   - Everything else requires a session when Supabase is configured
//   - When Supabase is NOT configured (dev without env vars), the gate is
//     disabled entirely so the app behaves like it did pre-5a
function AuthGate() {
  const { user, loading, isConfigured } = useAuth();
  const location = useLocation();

  if (isConfigured && loading) return <AuthLoadingSplash />;

  // Public routes — render regardless of auth state. If an already-signed-in
  // user lands on /login we bounce them to the dashboard.
  if (location.pathname === '/login') {
    if (user) return <Navigate to="/dashboard" replace />;
    return <Routes><Route path="/login" element={<Login />} /></Routes>;
  }
  if (location.pathname === '/auth/callback') {
    return <Routes><Route path="/auth/callback" element={<AuthCallback />} /></Routes>;
  }

  // Protected routes.
  if (isConfigured && !user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <AppShell />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AuthGate />
      </ToastProvider>
    </AuthProvider>
  );
}
