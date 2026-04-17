import { useState } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { TEAMS, API_CONFIG } from './data';
import { colors, fonts, radius, sidebar as sidebarConfig } from './theme';
import ContentStudio from './pages/ContentStudio';
import Generate from './pages/Generate';
import Requests from './pages/Requests';
import GameCenter from './pages/GameCenter';
import Files from './pages/Files';
import Settings from './pages/Settings';

const navItems = [
  { path: "/studio", label: "Content Studio", icon: "⚡" },
  { path: "/generate", label: "Generate", icon: "✦" },
  { path: "/requests", label: "Requests", icon: "☰" },
  { path: "/game-center", label: "Game Center", icon: "▣" },
  { path: "/files", label: "Files", icon: "◫" },
  { path: "/settings", label: "Settings", icon: "⚙" },
];

const pageTitles = {
  '/studio': 'Content Studio',
  '/generate': 'Generate',
  '/requests': 'Requests',
  '/game-center': 'Game Center',
  '/files': 'Files',
  '/settings': 'Settings',
};

function Sidebar() {
  const location = useLocation();

  return (
    <aside style={{
      width: sidebarConfig.width,
      minWidth: sidebarConfig.width,
      background: colors.navy,
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      position: 'sticky',
      top: 0,
      zIndex: 50,
    }}>
      {/* Logo */}
      <Link to="/studio" style={{ textDecoration: 'none', padding: '20px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: radius.base,
          background: colors.red,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, fontFamily: fonts.heading, color: '#fff',
          letterSpacing: 1
        }}>B</div>
        <div>
          <div style={{
            fontFamily: fonts.heading,
            fontSize: 20,
            color: '#fff',
            letterSpacing: 2,
            lineHeight: 1
          }}>BLW CONTENT HUB</div>
          <div style={{
            fontFamily: fonts.condensed,
            fontSize: 9,
            color: colors.textOnDarkMuted,
            letterSpacing: 0.8,
            marginTop: 2
          }}>BIG LEAGUE WIFFLE BALL</div>
        </div>
      </Link>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {navItems.map(n => {
          const active = location.pathname === n.path || (location.pathname === '/' && n.path === '/studio');
          return (
            <Link key={n.path} to={n.path} style={{
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: radius.base,
              background: active ? 'rgba(221, 60, 60, 0.12)' : 'transparent',
              borderLeft: active ? `3px solid ${colors.red}` : '3px solid transparent',
              color: active ? '#fff' : colors.textOnDarkMuted,
              fontFamily: fonts.body,
              fontSize: 13,
              fontWeight: active ? 700 : 500,
              transition: 'all 0.15s',
            }}>
              <span style={{ fontSize: 16, width: 20, textAlign: 'center', opacity: active ? 1 : 0.6 }}>{n.icon}</span>
              {n.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{
        padding: '14px 18px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        fontFamily: fonts.condensed,
        fontSize: 10,
        color: 'rgba(255,255,255,0.25)',
        textAlign: 'center'
      }}>
        BLW Content Hub v2.0 · prowiffleball.com
      </div>
    </aside>
  );
}

function TopBar({ teamFilter, setTeamFilter }) {
  const location = useLocation();
  const title = pageTitles[location.pathname] || 'BLW Content Hub';

  return (
    <header style={{
      background: colors.white,
      borderBottom: `1px solid ${colors.border}`,
      padding: '12px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 40,
    }}>
      <h2 style={{
        fontFamily: fonts.heading,
        fontSize: 24,
        fontWeight: 400,
        color: colors.text,
        margin: 0,
        letterSpacing: 1.2
      }}>{title}</h2>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* API Status */}
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
          <span style={{
            fontFamily: fonts.condensed,
            fontSize: 10, fontWeight: 600,
            color: API_CONFIG.isLive ? '#15803D' : '#92400E',
          }}>
            {API_CONFIG.isLive ? 'LIVE API' : 'CACHED DATA'}
          </span>
        </div>

        {/* Team filter */}
        <select
          value={teamFilter}
          onChange={e => setTeamFilter(e.target.value)}
          style={{
            background: colors.white,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.base,
            padding: '6px 10px',
            fontFamily: fonts.body,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="ALL">All Teams (10)</option>
          {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id} — {t.name}</option>)}
        </select>

        {/* Notification bell placeholder */}
        <div style={{
          width: 34, height: 34, borderRadius: radius.full,
          border: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 14, color: colors.textSecondary,
        }}>🔔</div>

        {/* User avatar placeholder */}
        <div style={{
          width: 34, height: 34, borderRadius: radius.full,
          background: colors.navy, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: fonts.condensed, fontSize: 13, fontWeight: 700,
        }}>WR</div>
      </div>
    </header>
  );
}

export default function App() {
  const [teamFilter, setTeamFilter] = useState('ALL');

  return (
    <div style={{
      fontFamily: fonts.body,
      color: colors.text,
      display: 'flex',
      minHeight: '100vh',
      background: colors.bg,
    }}>
      <Sidebar />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar teamFilter={teamFilter} setTeamFilter={setTeamFilter} />

        <main style={{ flex: 1, padding: 24, maxWidth: 1200, width: '100%', boxSizing: 'border-box' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/studio" replace />} />
            <Route path="/studio" element={<ContentStudio teamFilter={teamFilter} setTeamFilter={setTeamFilter} />} />
            <Route path="/generate" element={<Generate />} />
            <Route path="/requests" element={<Requests teamFilter={teamFilter} />} />
            <Route path="/game-center" element={<GameCenter />} />
            <Route path="/files" element={<Files teamFilter={teamFilter} />} />
            <Route path="/settings" element={<Settings />} />
            {/* Backward compat redirects */}
            <Route path="/dashboard" element={<Navigate to="/studio" replace />} />
            <Route path="/stats" element={<Navigate to="/game-center" replace />} />
            <Route path="/assets" element={<Navigate to="/files" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
