import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Link, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { TEAMS, API_CONFIG, applyTeamBrandingOverride } from './data';
import { authedFetch } from './authed-fetch';
import { colors, fonts, radius, sidebar as sidebarConfig, shadows } from './theme';
import { TeamThemeScope } from './team-theme';
import { GlobalStyles } from './global-styles';
import { useIsDark, applyMode } from './theme-mode';
import { GIT_COMMIT, BUILD_LABEL, formattedBuildDate } from './version';
// Dashboard + auth pages load eagerly (the landing surfaces — no Suspense
// flash on first paint). The heavy / less-frequently-first-hit pages are
// v4.19.0 code-split so the initial bundle is ~250KB lighter: Studio's
// canvas + stat-card renderer, the Files media layer, Rapid Tag's Shade
// bridge, AI training, and the secondary pages each load on first visit.
import ContentStudio from './pages/ContentStudio';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import AuthCallback from './pages/AuthCallback';
const Generate = lazy(() => import('./pages/Generate'));
const Resources = lazy(() => import('./pages/Resources'));
const TrainAI = lazy(() => import('./pages/TrainAI'));
const Requests = lazy(() => import('./pages/Requests'));
const GameCenter = lazy(() => import('./pages/GameCenter'));
const Files = lazy(() => import('./pages/Files'));
const RapidTag = lazy(() => import('./pages/RapidTag'));
const Settings = lazy(() => import('./pages/Settings'));
const TeamPage = lazy(() => import('./pages/TeamPage'));
const PlayerPage = lazy(() => import('./pages/PlayerPage'));
const Schedule = lazy(() => import('./pages/Schedule'));
// v5 (audit): lazy-load the changelog modal — it pulls in changelog.js
// (~180KB of release notes) which bloated the main bundle for a surface
// almost no session opens. Loads on demand when the version row is clicked.
const ChangelogModal = lazy(() => import('./changelog-modal'));
import { TeamLogo } from './components';
import { Icon } from './icon';
import { TierBadgeStyles } from './tier-badges';
import { UnreadRequestsProvider, useUnreadRequestsCtx } from './request-unread-store';
import { refreshFromCloud, lastHydratedAt } from './cloud-reader';
import { hydrateDriveFromCloud } from './drive-api';
import { supabaseConfigured } from './supabase-client';
import { ToastProvider } from './toast';
import { QuickSwitcher } from './quick-switcher';
import { AuthProvider, useAuth, ROLE_LABELS, isAthleteRole, isAdminRole } from './auth';
import { ImpersonationBanner } from './view-as';
import { TempAccessBanner } from './temp-access';

const MOBILE_BREAKPOINT = 768;

// Nav items. `roles` declares who can see each item — missing means
// "everyone signed-in". Athletes get a trimmed sidebar (no Files, no
// request queue admin, no global Settings).
// v4.8.0: every nav item declares its allowed roles explicitly,
// including the new 'fan' tier (browse-only). Fans see ProWiffle Stats
// + Settings in the sidebar; teams + player pages are reachable via
// the top-bar Teams dropdown and direct URL.
const navItems = [
  // v4.8.11: "My Team" item removed entirely. The dedicated /my-stats
  // page was redundant with team pages; athletes now land on /dashboard
  // and navigate to their team via the top-bar Teams dropdown like
  // everyone else.
  { path: "/dashboard",   label: "Dashboard",        icon: "dashboard", roles: ['master_admin', 'admin', 'content', 'athlete'] },
  { path: "/generate",    label: "Studio",           icon: "studio", iconClass: 'nav-icon-studio', roles: ['master_admin', 'admin', 'content', 'athlete'] },
  { path: "/resources",   label: "Resources",        icon: "resources", roles: ['master_admin', 'admin', 'content'] },
  { path: "/requests",    label: "Requests",         icon: "requests", roles: ['master_admin', 'admin', 'content', 'athlete'] },
  { path: "/game-center", label: "ProWiffle Stats",  icon: "stats", roles: ['master_admin', 'admin', 'content', 'athlete', 'fan'] },
  // v4.8.6: full 2026 BLW schedule. Visible to everyone signed in so
  // athletes can see their team's upcoming games + fans can see the
  // full league slate. Phase 2 will add a season switcher once the
  // first season ends and archive data exists.
  { path: "/schedule",    label: "Schedule",         icon: "schedule", roles: ['master_admin', 'admin', 'content', 'athlete', 'fan'] },
  { path: "/files",       label: "Files",            icon: "files", roles: ['master_admin', 'admin', 'content'] },
  // Command Center is a standalone static dashboard (public/command-center.html),
  // not an SPA route — `external` makes the sidebar render a real <a> so the
  // browser fully navigates to it. Gated to the content team and up.
  // (Supersedes main's "CS DATA" hotfix entry — same destination, but this v5
  // version uses the Lucide icon and adds content-role access. main's
  // command-center.html auth fix (blw-auth-v1) is preserved via the merge.)
  { path: "/command-center", label: "Command Center", icon: "command-center", roles: ['master_admin', 'admin', 'content'], external: true },
  { path: "/rapid-tag",   label: "Rapid Tag",        icon: "rapid-tag", roles: ['master_admin'] },
  { path: "/train-ai",    label: "Train AI",         icon: "train-ai", roles: ['master_admin', 'admin'] },
  { path: "/settings",    label: "Settings",         icon: "settings", roles: ['master_admin', 'admin', 'content', 'athlete', 'fan'] },
];

const pageTitles = {
  '/dashboard': 'Dashboard',
  '/generate': 'Studio',
  '/resources': 'Resources',
  '/train-ai': 'Train AI',
  '/requests': 'Requests',
  '/game-center': 'ProWiffle Stats',
  '/files': 'Files',
  '/schedule': 'Schedule',
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
        {/* v4.5.39: was ⚑ (Black Flag, U+2691) — missing from default
            macOS/iOS emoji fonts, rendered as `!` for half the admin
            tier. v4.5.44: was 🏟 (Stadium, U+1F3DF) — Unicode 8.0
            (2015), still missing from older system emoji fonts on
            iOS 9 / macOS 10.10 etc. Switched to 🚩 (Triangular Flag,
            U+1F6A9, Unicode 6.0 / 2010) which has been in every OS
            emoji font for 15+ years. Same "teams / banners" semantic. */}
        <span style={{ fontSize: 20, width: 24, textAlign: 'center', opacity: onTeamRoute ? 1 : 0.6 }}>🚩</span>
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
  // v4.19.0: unread thread badge reads the shared UnreadRequestsProvider
  // instead of spinning up its own 60s poll (the dashboard + Requests page
  // used to each run their own copy too).
  const navUnread = useUnreadRequestsCtx();
  const location = useLocation();
  const { role, isConfigured } = useAuth();
  // Changelog popup state. Lives at the Sidebar level (not page-global)
  // because the trigger is the version row in the footer here.
  const [changelogOpen, setChangelogOpen] = useState(false);

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
        {/* Logo — full BLW logo from /public/brand/blw-logo.svg. v4.5.24:
            replaced the placeholder mark + typed "BLW Studio" text with
            the actual league logo file the user provided. Logo carries
            its own typography so we drop the wordmark to its right. A
            small "STUDIO" caption sits underneath since the league logo
            doesn't include it on its own. Designers can swap the SVG
            in place to update without touching code. */}
        <Link to="/dashboard" style={{ textDecoration: 'none', padding: '18px 18px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <img
            src="/brand/blw-logo.svg"
            alt="BLW"
            style={{
              display: 'block', flexShrink: 0,
              width: 48, height: 48, objectFit: 'contain',
            }}
          />
          <div style={{
            fontFamily: fonts.heading, fontSize: 19, fontWeight: 700,
            color: '#fff', letterSpacing: 0, lineHeight: 1, minWidth: 0,
          }}>BLW Studio</div>
        </Link>

        {/* Nav — a11y: named "Primary" landmark; id is the target of the
            top-bar hamburger's aria-controls. */}
        <nav id="primary-nav" aria-label="Primary" style={{ flex: 1, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          {visibleNavItems.map(n => {
            const active = location.pathname === n.path || (location.pathname === '/' && n.path === '/dashboard');
            const linkClass = ['nav-link', active ? 'is-active' : ''].filter(Boolean).join(' ');
            const linkStyle = {
              textDecoration: 'none', display: 'flex', alignItems: 'center',
              gap: 11, padding: '10px 12px', borderRadius: radius.base,
              background: active ? colors.redLight : 'transparent',
              color: active ? '#fff' : colors.textOnDarkMuted,
              fontFamily: fonts.body, fontSize: 15,
              fontWeight: active ? 700 : 500,
            };
            const inner = (
              <>
                <Icon
                  name={n.icon}
                  size={19}
                  className={n.iconClass || undefined}
                  style={{ color: active ? colors.red : undefined, opacity: active ? 1 : 0.75, transition: 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)' }}
                />
                {n.label}
                {n.path === '/requests' && navUnread.totalUnread > 0 && (
                  <span style={{
                    marginLeft: 'auto',
                    background: colors.red, color: '#fff',
                    fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
                    borderRadius: 999, padding: '1px 7px',
                    letterSpacing: 0.4, lineHeight: 1.6,
                  }}>{navUnread.totalUnread > 99 ? '99+' : navUnread.totalUnread}</span>
                )}
              </>
            );
            // External items (the standalone Command Center page) aren't SPA
            // routes — render a real <a> so the browser navigates fully.
            return n.external ? (
              <a key={n.path} href={n.path} className={linkClass} style={linkStyle}>{inner}</a>
            ) : (
              <Link key={n.path} to={n.path} className={linkClass} style={linkStyle}>{inner}</Link>
            );
          })}

          {/* Teams Dropdown */}
          <TeamsDropdown location={location} />
        </nav>

        {/* Footer — version label is a button that opens the changelog
            modal. Semver headline ("v4.0.0 · Apr 29") comes from
            package.json + the build date; tooltip carries the full
            build date + commit SHA for bug-report correlation. The
            modal renders the curated release history from
            src/changelog.js so the user can scan what shipped over the
            last few pushes without leaving the app. */}
        <div style={{
          padding: '14px 18px', borderTop: '1px solid rgba(255,255,255,0.06)',
          fontFamily: fonts.condensed, fontSize: 10,
          color: 'rgba(255,255,255,0.25)', textAlign: 'center', lineHeight: 1.5,
        }}>
          <div>Created by Savant Media</div>
          <button
            type="button"
            onClick={() => setChangelogOpen(true)}
            title={`Built ${formattedBuildDate()}${GIT_COMMIT !== 'dev' ? ` · ${GIT_COMMIT}` : ''} — click to see release notes`}
            style={{
              background: 'transparent',
              border: 'none', padding: '2px 4px',
              margin: 0,
              opacity: 0.7,
              cursor: 'pointer',
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: 10, lineHeight: 1.5,
              color: 'inherit',
              textAlign: 'center',
            }}
          >
            {GIT_COMMIT === 'dev' ? 'dev build' : BUILD_LABEL}
            <span style={{ opacity: 0.5, marginLeft: 4 }}>↗</span>
          </button>
          {/* Stats credit — links to the ProWiffleball stats platform that
              feeds this tool's live batting/pitching/rankings. v4.5.0:
              wordmark SVG instead of plain text. */}
          <a
            href="https://app.grandslamsystems.com"
            target="_blank"
            rel="noreferrer"
            title="Stats data source — ProWiffleball"
            style={{
              display: 'block', margin: '8px auto 0',
              opacity: 0.6, transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = 1}
            onMouseLeave={e => e.currentTarget.style.opacity = 0.6}
          >
            <img
              src="/brand/prowiffleball-logo.svg"
              alt="ProWiffleball"
              style={{ height: 11, display: 'block', margin: '0 auto', filter: 'invert(1)' }}
            />
          </a>
        </div>
      </aside>
      {changelogOpen && (
        <Suspense fallback={null}>
          <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
        </Suspense>
      )}
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
  return 'BLW Studio';
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

// v5: light/dark toggle in the top bar. Cycles the two primary modes (System
// stays available in Settings). Icon shows the mode you'll switch TO.
function ThemeToggle() {
  const isDark = useIsDark();
  return (
    <button
      onClick={() => applyMode(isDark ? 'light' : 'dark')}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 32, height: 32, borderRadius: radius.base,
        background: 'transparent', border: 'none',
        cursor: 'pointer', color: colors.textMuted,
      }}
    >
      <Icon name={isDark ? 'sun' : 'moon'} size={17} />
    </button>
  );
}

function TopBar({ isMobile, onMenuToggle, sidebarOpen }) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentTeam = useCurrentTeamFromUrl();
  // v4.5.0: top bar is the persistent app brand, not a duplicate of the
  // page H1. The page itself already shows its own heading via PageHeader,
  // so showing the same text in the chrome was redundant and made the
  // workspace feel unbranded. Page title still drives document.title via
  // useEffect below for tab labels and history. */
  const pageTitle = getPageTitle(location.pathname);
  const title = 'BLW Studio';
  useEffect(() => {
    document.title = pageTitle === 'BLW Studio'
      ? 'BLW Studio'
      : `${pageTitle} · BLW Studio`;
  }, [pageTitle]);
  const syncedAgo = useSyncedAgoLabel();
  const [resyncing, setResyncing] = useState(false);
  // Publish the top bar's live height as --topbar-h so sticky elements below
  // it (the dashboard ticker) can pin flush underneath at any breakpoint.
  const topbarRef = useRef(null);
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const setH = () => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`);
    setH();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(setH) : null;
    ro?.observe(el);
    window.addEventListener('resize', setH);
    return () => { ro?.disconnect(); window.removeEventListener('resize', setH); };
  }, []);
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
    <header ref={topbarRef} style={{
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
          <button onClick={onMenuToggle}
            // a11y: icon-only button had no accessible name; expose label +
            // open state + the controlled nav (id="primary-nav" on <nav>).
            aria-label="Toggle navigation menu"
            aria-expanded={sidebarOpen}
            aria-controls="primary-nav"
            style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 22, color: colors.text, padding: '2px 4px',
            display: 'flex', alignItems: 'center',
          }}><Icon name="menu" size={22} /></button>
        )}
        {/* v4.5.24: BLW logo next to the title so the brand reads on
            mobile (sidebar is hidden by default on mobile, so the
            sidebar's logo isn't visible until the hamburger is tapped).
            Smaller on mobile to keep the top bar from feeling crowded. */}
        <img
          src="/brand/blw-logo.svg"
          alt="BLW"
          style={{
            display: 'block',
            width: isMobile ? 28 : 36,
            height: isMobile ? 28 : 36,
            objectFit: 'contain',
            flexShrink: 0,
          }}
        />
        {/* a11y: this is persistent app-brand chrome, not a section heading —
            was an <h2> that competed with the page <h1> for screen readers.
            Now a plain <div> with role="img"/aria-label; identical styles. */}
        <div role="img" aria-label="BLW Studio" style={{
          fontFamily: fonts.heading, fontSize: isMobile ? 18 : 23,
          fontWeight: 700, color: colors.text, margin: 0, letterSpacing: 0,
          whiteSpace: 'nowrap',
        }}>{title}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, flexShrink: 0 }}>
        {/* v4.5.20: Visible search bar (desktop) / icon (mobile) that
            opens the global QuickSwitcher modal. Was a tiny "⌘K" chip
            buried on the right — now reads like a real search input
            so people who don't think in keyboard shortcuts can still
            find players + teams. The actual filtering UI is the
            existing QuickSwitcher modal; clicking here just opens it. */}
        <button
          onClick={() => {
            const ev = new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true });
            window.dispatchEvent(ev);
          }}
          title="Search players, teams, pages · ⌘K"
          // a11y: title alone isn't a reliable accessible name for screen readers.
          aria-label="Search (Cmd K)"
          style={{
            background: colors.bg, border: `1px solid ${colors.border}`,
            color: colors.textSecondary, cursor: 'pointer',
            padding: isMobile ? '6px 10px' : '6px 10px 6px 28px',
            borderRadius: radius.full,
            fontFamily: fonts.body, fontSize: isMobile ? 13 : 12, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', gap: 8,
            position: 'relative',
            minWidth: isMobile ? 0 : 220,
            justifyContent: isMobile ? 'center' : 'flex-start',
            transition: 'border-color 160ms ease, background 160ms ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = colors.accentBorder; e.currentTarget.style.background = colors.white; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.background = colors.bg; }}
        >
          {!isMobile && (
            <span style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              fontSize: 14, color: colors.textMuted, pointerEvents: 'none',
            }}>⌕</span>
          )}
          {isMobile ? (
            <span style={{ fontSize: 16, color: colors.textSecondary }}>⌕</span>
          ) : (
            <>
              <span style={{ flex: 1, color: colors.textMuted }}>Search players, teams…</span>
              <span style={{
                fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800, letterSpacing: 0.6,
                background: colors.white, border: `1px solid ${colors.border}`,
                color: colors.textMuted, padding: '1px 6px', borderRadius: 4,
              }}>⌘K</span>
            </>
          )}
        </button>
        {/* Cloud sync — minimal icon button (no colored badge). Click forces
            a fresh pull; the last-synced time lives in the tooltip. */}
        {syncedAgo !== null && (
          <button
            onClick={forceResync}
            disabled={resyncing}
            title={resyncing ? 'Pulling fresh data…' : `Synced ${syncedAgo} · click to refresh`}
            // a11y: icon-only button — give it a stable accessible name.
            aria-label="Refresh data"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: radius.base,
              background: 'transparent', border: 'none',
              cursor: resyncing ? 'wait' : 'pointer',
              color: colors.textMuted,
            }}
          >
            <Icon name="refresh" size={17} className={resyncing ? 'blw-spin' : undefined} />
          </button>
        )}
        <style>{`@keyframes blw-spin { to { transform: rotate(360deg) } } .blw-spin { animation: blw-spin 0.9s linear infinite }`}</style>

        <ThemeToggle />

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

        {/* v4.5.61: bell icon removed per master direction — it was static
            and never wired up to anything, so it just took header space. */}

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
  const { role, user, profileLoading, profileError, isConfigured } = useAuth();
  if (!isConfigured) return <Navigate to="/dashboard" replace />;
  if (profileLoading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: colors.textSecondary, fontSize: 13 }}>
        Loading your profile…
      </div>
    );
  }
  // The read FAILED (error/timeout) — not the same as "no profile row". Show a
  // retry screen, never the destructive "Profile setup required" card.
  if (user && !role && profileError) return <ProfileLoadError />;
  if (user && !role) return <ProfileNotFound />;
  // v4.8.11: athletes default to /dashboard (was /my-stats). The
  // "My Team" sidebar item + dedicated /my-stats page were redundant
  // with the full team page surfaces shipped in v4.6; athletes go
  // straight to a limited dashboard that surfaces ideas + requests
  // scoped to their team. /my-stats now redirects to /dashboard for
  // backward-compat (existing bookmarks).
  if (role === 'fan') return <Navigate to="/game-center" replace />;
  return <Navigate to="/dashboard" replace />;
}

// Route gate — wraps a child in an AccessDenied shell if the current role
// isn't allowed. Used for athlete-hidden routes like /files and /requests.
function RequireRole({ roles, what, children }) {
  const { role, isConfigured, profileLoading, profileError, user } = useAuth();
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
  // The read FAILED (error/timeout) — show a retry screen, not the destructive
  // "Profile setup required" card (which implies the DB row is genuinely gone).
  if (user && !role && profileError) return <ProfileLoadError />;
  // Signed in but the profile genuinely has no row (fetch succeeded, empty).
  if (user && !role) return <ProfileNotFound />;
  if (!role) return null;
  if (!roles.includes(role)) return <AccessDenied what={what} />;
  return children;
}

// Shown when the user is signed in but the profile READ failed (network /
// Supabase blip / timeout) — NOT when the row is genuinely missing. This is
// non-destructive: it never tells the user to run SQL or implies their account
// is gone. Retry re-runs the fetch; Sign out forces a fresh session.
function ProfileLoadError() {
  const { refreshProfile, signOut, profileLoading, user } = useAuth();
  return (
    <div style={{
      maxWidth: 520, margin: '60px auto', padding: 32, textAlign: 'center',
      background: colors.white, borderRadius: radius.lg,
      border: `1px solid ${colors.borderLight}`,
      fontFamily: fonts.body, color: colors.text,
    }}>
      <div style={{ fontSize: 34, marginBottom: 8 }}>🔌</div>
      <h1 style={{ fontFamily: fonts.heading, fontSize: 24, margin: 0, letterSpacing: 1, fontWeight: 400 }}>
        Couldn’t reach the server
      </h1>
      <p style={{ fontSize: 14, color: colors.textSecondary, margin: '10px 0 20px', lineHeight: 1.6 }}>
        We couldn’t load your profile just now — usually a brief network or
        Supabase hiccup. Your account and access are fine; nothing has changed.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={() => refreshProfile()}
          disabled={profileLoading}
          style={{
            background: colors.red, color: '#fff', border: 'none',
            borderRadius: radius.sm, padding: '9px 20px', cursor: profileLoading ? 'default' : 'pointer',
            fontFamily: fonts.condensed, fontSize: 13, fontWeight: 800, letterSpacing: 0.5,
            opacity: profileLoading ? 0.6 : 1,
          }}
        >
          {profileLoading ? 'Retrying…' : 'Retry'}
        </button>
        <button
          onClick={() => signOut()}
          style={{
            background: colors.bg, color: colors.textSecondary, border: `1px solid ${colors.border}`,
            borderRadius: radius.sm, padding: '9px 20px', cursor: 'pointer',
            fontFamily: fonts.condensed, fontSize: 13, fontWeight: 700, letterSpacing: 0.5,
          }}
        >
          Sign out &amp; back in
        </button>
      </div>
      {user?.email && (
        <p style={{ fontSize: 11, color: colors.textMuted, marginTop: 16 }}>
          Signed in as {user.email}
        </p>
      )}
    </div>
  );
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
  const { user, role, profileLoading, profileError, isConfigured } = useAuth();
  if (!isConfigured || profileLoading) return null;
  if (!user || role) return null;
  // Don't show the "run db/003 SQL" banner when the profile READ just failed —
  // that's a connection blip, not a missing row. The retry screen covers it.
  if (profileError) return null;
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
// Lightweight fallback shown while a code-split page chunk loads on first
// visit. Deliberately minimal so it reads as an instant flash, not a screen.
function PageLoading() {
  return (
    <div style={{ padding: 48, textAlign: 'center', color: colors.textMuted, fontFamily: fonts.condensed, fontSize: 13, letterSpacing: 0.5 }}>
      Loading…
    </div>
  );
}

// This is the old App body, now gated behind AuthGate.
function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  // URL-derived team context — drives the accent color drift on team
  // and player routes. Other routes get null and the brand red baseline
  // wins through the theme.js fallbacks.
  const currentTeam = useCurrentTeamFromUrl();
  const { user } = useAuth();

  // Phase 4: on app mount, pull latest records from Supabase into the local
  // IDB / localStorage cache. v4.5.0: re-trigger when the user id transitions
  // from null → set, because on mobile the JWT often isn't ready yet on first
  // mount — the initial fetch 401s silently and we never re-pull. Watching
  // user.id closes that race. force: true on the post-login pull bypasses
  // the throttle so a fresh sign-in always gets fresh data.
  useEffect(() => {
    if (!user?.id) {
      // Still try a non-forced pull on mount in case the session is already
      // hydrated from local storage but the user.id change won't fire.
      refreshFromCloud().catch(err => console.warn('[cloud-reader] hydrate failed', err));
      return;
    }
    refreshFromCloud({ force: true }).catch(err => console.warn('[cloud-reader] post-login hydrate failed', err));
    // v4.5.10: also pull the cloud-synced Drive config (api key + folder
    // list) so every admin inherits the master's setup automatically.
    hydrateDriveFromCloud().catch(err => console.warn('[drive-api] hydrate failed', err));
    // v5.2.0: pull the master's team-branding color overrides so every
    // account renders the same team colors set in the Global settings console.
    authedFetch('/api/app-settings?key=team-branding')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j?.value && typeof j.value === 'object') applyTeamBrandingOverride(j.value); })
      .catch(err => console.warn('[team-branding] hydrate failed', err));
  }, [user?.id]);

  return (
    <UnreadRequestsProvider>
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
        {/* Time-boxed access countdown — renders null unless the current
            user has a role_expires_at on their profile. Shown ABOVE the
            impersonation banner so the timer is the first thing they see. */}
        <TempAccessBanner />
        {/* Impersonation banner — sticky strip across the top whenever a
            master admin is viewing the app as another role. Renders null
            when not impersonating. Sits above TopBar so it doesn't fight
            with the page chrome's z-index. */}
        <ImpersonationBanner />
        <TopBar
          isMobile={isMobile}
          onMenuToggle={() => setSidebarOpen(prev => !prev)}
          sidebarOpen={sidebarOpen}
        />

        {/* Sticky banner that nudges profile setup when the user's role
            hasn't loaded. Hidden in dev + once the profile lands. */}
        <ProfileSetupBanner />

        <main style={{
          flex: 1,
          padding: isMobile ? 12 : 24,
          '--main-pad': isMobile ? '12px' : '24px',
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
          <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/dashboard" element={
              <RequireRole roles={['master_admin', 'admin', 'content', 'athlete']} what="the Dashboard">
                <ContentStudio />
              </RequireRole>
            } />
            {/* v4.8.11: /my-stats removed from the active nav; redirect
                preserves any existing bookmark or in-app deep-link. */}
            <Route path="/my-stats" element={<Navigate to="/dashboard" replace />} />
            <Route path="/generate" element={
              <RequireRole roles={['master_admin', 'admin', 'content', 'athlete']} what="Studio">
                <Generate />
              </RequireRole>
            } />
            <Route path="/requests" element={
              <RequireRole roles={['master_admin', 'admin', 'content', 'athlete']} what="the Requests queue">
                <Requests />
              </RequireRole>
            } />
            <Route path="/game-center" element={<GameCenter />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/files" element={
              <RequireRole roles={['master_admin', 'admin', 'content']} what="the Files library">
                <Files />
              </RequireRole>
            } />
            <Route path="/rapid-tag" element={
              <RequireRole roles={['master_admin']} what="Rapid Tag">
                <RapidTag />
              </RequireRole>
            } />
            <Route path="/settings" element={<Settings />} />
            <Route path="/resources" element={
              <RequireRole roles={['master_admin', 'admin', 'content']} what="Resources">
                <Resources />
              </RequireRole>
            } />
            <Route path="/train-ai" element={
              <RequireRole roles={['master_admin', 'admin']} what="AI Memory training">
                <TrainAI />
              </RequireRole>
            } />
            <Route path="/teams/:slug" element={<TeamPage />} />
            <Route path="/teams/:slug/players/:lastName" element={<PlayerPage />} />
            {/* Backward-compatible redirects */}
            <Route path="/studio" element={<Navigate to="/dashboard" replace />} />
            <Route path="/stats" element={<Navigate to="/game-center" replace />} />
            <Route path="/assets" element={<Navigate to="/files" replace />} />
          </Routes>
          </Suspense>
          </RouteAnimator>
          </TeamThemeScope>
        </main>
      </div>
    </div>
    </UnreadRequestsProvider>
  );
}

// Router-level auth gate.
//
// v4.8.0 (mass launch): expanded public-route allowlist + force-set
// password gate.
//
//   PUBLIC (no session required):
//     /login, /register, /forgot-password, /reset-password, /auth/callback
//
//   SESSION REQUIRED, no role gate yet:
//     everything else — falls through to AppShell which applies the
//     per-route RequireRole guards.
//
//   FORCE-SET GATE (session + profile loaded + needs_password_setup):
//     existing magic-link / silent-staged users land on /reset-password
//     in forceMode regardless of what URL they tried. They can't proceed
//     to any other surface until they set a password.
const PUBLIC_PATHS = new Set(['/login', '/register', '/forgot-password', '/reset-password', '/auth/callback']);

function AuthGate() {
  const { user, loading, isConfigured, needsPasswordSetup, profileLoading } = useAuth();
  const location = useLocation();

  if (isConfigured && loading) return <AuthLoadingSplash />;

  const isPublic = PUBLIC_PATHS.has(location.pathname);

  // Public routes — render regardless of auth state.
  if (isPublic) {
    // Already-signed-in users on /login or /register bounce to home.
    // /reset-password and /forgot-password stay accessible even when
    // signed in (recovery flow + force-set gate land here).
    if (user && (location.pathname === '/login' || location.pathname === '/register')) {
      return <Navigate to="/" replace />;
    }
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
      </Routes>
    );
  }

  // Protected routes — must be signed in.
  if (isConfigured && !user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  // Force-set gate: any signed-in user whose profile has
  // needs_password_setup=true is shoved to /reset-password in forceMode
  // until they pick one. We wait for the profile to finish loading
  // first to avoid a single-frame flash of the gate before the profile
  // arrives saying "false."
  if (isConfigured && user && !profileLoading && needsPasswordSetup) {
    return (
      <Routes>
        <Route path="*" element={<ResetPassword forceMode={true} />} />
      </Routes>
    );
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
