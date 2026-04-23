import { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { TEAMS, API_CONFIG } from './data';
import { colors, fonts, radius, sidebar as sidebarConfig } from './theme';
import ContentStudio from './pages/ContentStudio';
import Generate from './pages/Generate';
import Requests from './pages/Requests';
import GameCenter from './pages/GameCenter';
import Files from './pages/Files';
import Settings from './pages/Settings';
import TeamPage from './pages/TeamPage';
import PlayerPage from './pages/PlayerPage';
import { TeamLogo } from './components';
import { TierBadgeStyles } from './tier-badges';
import { refreshFromCloud, lastHydratedAt } from './cloud-reader';
import { supabaseConfigured } from './supabase-client';
import { ToastProvider } from './toast';
import { QuickSwitcher } from './quick-switcher';

const MOBILE_BREAKPOINT = 768;

const navItems = [
  { path: "/dashboard", label: "Dashboard", icon: "⚡" },
  { path: "/generate", label: "Generate", icon: "✦" },
  { path: "/requests", label: "Requests", icon: "☰" },
  { path: "/game-center", label: "ProWiffle Stats", icon: "▣" },
  { path: "/files", label: "Files", icon: "◫" },
  { path: "/settings", label: "Settings", icon: "⚙" },
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
      <button onClick={() => setExpanded(!expanded)} style={{
        textDecoration: 'none', display: 'flex', alignItems: 'center',
        gap: 12, padding: '12px 14px', borderRadius: radius.base,
        background: onTeamRoute ? 'rgba(221, 60, 60, 0.12)' : 'transparent',
        borderLeft: onTeamRoute ? `3px solid ${colors.red}` : '3px solid transparent',
        color: onTeamRoute ? '#fff' : colors.textOnDarkMuted,
        fontFamily: fonts.body, fontSize: 16,
        fontWeight: onTeamRoute ? 700 : 500,
        border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
        transition: 'all 0.15s',
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
              <Link key={t.id} to={`/teams/${t.slug}`} style={{
                textDecoration: 'none', display: 'flex', alignItems: 'center',
                gap: 10, padding: '8px 12px', borderRadius: radius.sm,
                background: teamActive ? 'rgba(221, 60, 60, 0.1)' : 'transparent',
                color: teamActive ? '#fff' : 'rgba(255,255,255,0.5)',
                fontFamily: fonts.body, fontSize: 14,
                fontWeight: teamActive ? 700 : 500,
                transition: 'all 0.15s',
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

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    if (isMobile) onClose();
  }, [location.pathname]);

  if (isMobile && !open) return null;

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
          {navItems.map(n => {
            const active = location.pathname === n.path || (location.pathname === '/' && n.path === '/dashboard');
            return (
              <Link key={n.path} to={n.path} style={{
                textDecoration: 'none', display: 'flex', alignItems: 'center',
                gap: 12, padding: '12px 14px', borderRadius: radius.base,
                background: active ? 'rgba(221, 60, 60, 0.12)' : 'transparent',
                borderLeft: active ? `3px solid ${colors.red}` : '3px solid transparent',
                color: active ? '#fff' : colors.textOnDarkMuted,
                fontFamily: fonts.body, fontSize: 16,
                fontWeight: active ? 700 : 500, transition: 'all 0.15s',
              }}>
                <span style={{ fontSize: 20, width: 24, textAlign: 'center', opacity: active ? 1 : 0.6 }}>{n.icon}</span>
                {n.label}
              </Link>
            );
          })}

          {/* Teams Dropdown */}
          <TeamsDropdown location={location} />
        </nav>

        {/* Footer */}
        <div style={{
          padding: '14px 18px', borderTop: '1px solid rgba(255,255,255,0.06)',
          fontFamily: fonts.condensed, fontSize: 10,
          color: 'rgba(255,255,255,0.25)', textAlign: 'center', lineHeight: 1.5,
        }}>
          <div>Created by Savant Media</div>
          <div style={{ opacity: 0.7 }}>v2.0 · prowiffleball.com</div>
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
      borderBottom: `1px solid ${colors.border}`,
      borderLeft: currentTeam ? `4px solid ${currentTeam.color}` : '4px solid transparent',
      padding: isMobile ? '10px 14px' : '12px 24px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      position: 'sticky', top: 0, zIndex: 40,
      gap: 10,
      transition: 'border-left-color 0.2s',
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
          {TEAMS.map(t => <option key={t.id} value={t.id}>{isMobile ? t.id : `${t.id} — ${t.name}`}</option>)}
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

        {/* User avatar */}
        <div style={{
          width: 34, height: 34, borderRadius: radius.full,
          background: colors.navy, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: fonts.condensed, fontSize: 13, fontWeight: 700,
          flexShrink: 0,
        }}>WR</div>
      </div>
    </header>
  );
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  // Phase 4: on app mount, pull latest records from Supabase into the local
  // IDB / localStorage cache. Throttled to once per 10 min so navigation
  // between pages doesn't spam the API. Silently no-ops if not configured.
  useEffect(() => {
    refreshFromCloud().catch(err => console.warn('[cloud-reader] hydrate failed', err));
  }, []);

  return (
    <ToastProvider>
    <div style={{
      fontFamily: fonts.body, color: colors.text,
      display: 'flex', minHeight: '100vh', background: colors.bg,
    }}>
      {/* Inject tier-badge glow keyframes once at app root */}
      <TierBadgeStyles />
      {/* Global Cmd+K / Ctrl+K quick switcher */}
      <QuickSwitcher />
      <Sidebar isMobile={isMobile} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar
          isMobile={isMobile}
          onMenuToggle={() => setSidebarOpen(prev => !prev)}
        />

        <main style={{
          flex: 1,
          padding: isMobile ? 12 : 24,
          maxWidth: 1200,
          width: '100%',
          boxSizing: 'border-box',
        }}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<ContentStudio />} />
            <Route path="/generate" element={<Generate />} />
            <Route path="/requests" element={<Requests />} />
            <Route path="/game-center" element={<GameCenter />} />
            <Route path="/files" element={<Files />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/teams/:slug" element={<TeamPage />} />
            <Route path="/teams/:slug/players/:lastName" element={<PlayerPage />} />
            {/* Backward-compatible redirects */}
            <Route path="/studio" element={<Navigate to="/dashboard" replace />} />
            <Route path="/stats" element={<Navigate to="/game-center" replace />} />
            <Route path="/assets" element={<Navigate to="/files" replace />} />
          </Routes>
        </main>
      </div>
    </div>
    </ToastProvider>
  );
}
