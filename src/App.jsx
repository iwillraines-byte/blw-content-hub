import { useState } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Generate from './pages/Generate';
import Requests from './pages/Requests';
import Stats from './pages/Stats';
import Assets from './pages/Assets';
import Settings from './pages/Settings';
import { TEAMS, API_CONFIG } from './data';

const navItems = [
  { path: "/dashboard", label: "Dashboard", icon: "◉" },
  { path: "/generate", label: "Generate", icon: "✦" },
  { path: "/requests", label: "Requests", icon: "📋" },
  { path: "/stats", label: "Stats Hub", icon: "📊" },
  { path: "/assets", label: "Assets", icon: "📁" },
  { path: "/settings", label: "Settings", icon: "⚙️" },
];

export default function App() {
  const location = useLocation();
  const [teamFilter, setTeamFilter] = useState("ALL");

  return (
    <div style={{
      fontFamily:"'Outfit','DM Sans',system-ui,sans-serif",
      background:"#0A0A0F", color:"#D8D8DD",
      minHeight:"100vh", display:"flex", flexDirection:"column"
    }}>
      {/* HEADER */}
      <header style={{
        background:"#0D0D13",
        borderBottom:"1px solid rgba(255,255,255,.05)",
        padding:"10px 18px", display:"flex",
        alignItems:"center", justifyContent:"space-between",
        position:"sticky", top:0, zIndex:100
      }}>
        <Link to="/dashboard" style={{ display:"flex", alignItems:"center", gap:10, textDecoration:"none" }}>
          <div style={{
            width:34, height:34, borderRadius:9,
            background:"linear-gradient(135deg,#BF8C30,#8B6914)",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:16, fontWeight:900, color:"#0A0A0F"
          }}>B</div>
          <div>
            <div style={{ fontSize:18, fontWeight:900, letterSpacing:2, color:"#BF8C30" }}>BLW CONTENT HUB</div>
            <div style={{ fontSize:9, color:"#555", letterSpacing:.8 }}>BIG LEAGUE WIFFLE BALL • CONTENT MANAGEMENT</div>
          </div>
        </Link>

        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {/* API Status */}
          <div style={{
            display:"flex", alignItems:"center", gap:6,
            padding:"4px 10px", borderRadius:6,
            background: API_CONFIG.isLive ? "rgba(74,222,128,.1)" : "rgba(244,162,97,.1)",
            border: API_CONFIG.isLive ? "1px solid rgba(74,222,128,.2)" : "1px solid rgba(244,162,97,.2)"
          }}>
            <div style={{
              width:6, height:6, borderRadius:"50%",
              background: API_CONFIG.isLive ? "#4ADE80" : "#F4A261"
            }}/>
            <span style={{ fontSize:10, fontWeight:700, color: API_CONFIG.isLive ? "#4ADE80" : "#F4A261" }}>
              {API_CONFIG.isLive ? "LIVE API" : "CACHED DATA"}
            </span>
          </div>

          <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} style={{
            background:"rgba(0,0,0,.4)", color:"#E0E0E0",
            border:"1px solid rgba(255,255,255,.08)",
            borderRadius:7, padding:"6px 10px", fontSize:11,
            fontWeight:600, cursor:"pointer", outline:"none"
          }}>
            <option value="ALL">All Teams (10)</option>
            {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id} — {t.name}</option>)}
          </select>
        </div>
      </header>

      {/* NAV */}
      <nav style={{
        display:"flex", gap:1, padding:"0 14px",
        background:"#0D0D13",
        borderBottom:"1px solid rgba(255,255,255,.03)",
        overflowX:"auto"
      }}>
        {navItems.map(n => {
          const active = location.pathname === n.path || (location.pathname === "/" && n.path === "/dashboard");
          return (
            <Link key={n.path} to={n.path} style={{
              textDecoration:"none",
              background: active ? "rgba(191,140,48,.08)" : "transparent",
              borderBottom: active ? "2px solid #BF8C30" : "2px solid transparent",
              color: active ? "#BF8C30" : "#555",
              padding:"9px 13px", fontSize:11, fontWeight:700,
              letterSpacing:.4, display:"flex", alignItems:"center",
              gap:5, whiteSpace:"nowrap"
            }}>
              <span style={{ fontSize:12 }}>{n.icon}</span> {n.label}
            </Link>
          );
        })}
      </nav>

      {/* CONTENT */}
      <main style={{ flex:1, padding:16, maxWidth:1100, margin:"0 auto", width:"100%", boxSizing:"border-box" }}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard teamFilter={teamFilter} setTeamFilter={setTeamFilter} />} />
          <Route path="/generate" element={<Generate />} />
          <Route path="/requests" element={<Requests teamFilter={teamFilter} />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/assets" element={<Assets teamFilter={teamFilter} />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      {/* FOOTER */}
      <footer style={{
        padding:"10px 18px",
        borderTop:"1px solid rgba(255,255,255,.03)",
        textAlign:"center", fontSize:9, color:"#2A2A2A"
      }}>
        BLW Content Hub v1.0 • Big League Wiffle Ball • prowiffleball.com
      </footer>
    </div>
  );
}
