import { Link } from 'react-router-dom';
import { TEAMS } from '../data';
import { Card, Label } from '../components';

export default function Dashboard({ teamFilter, setTeamFilter }) {
  const stats = [
    { v: 4, l: "Pending", c: "#F4A261", to: "/requests" },
    { v: 2, l: "In Progress", c: "#4895EF", to: "/requests" },
    { v: 12, l: "Completed This Week", c: "#2A9D8F", to: "/requests" },
    { v: 10, l: "Teams", c: "#BF8C30", to: "/settings" },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      {/* Page title */}
      <div>
        <div style={{ fontSize:26, fontWeight:900, color:"#BF8C30" }}>Dashboard</div>
        <div style={{ fontSize:13, color:"#555" }}>Welcome back — here's what's happening across BLW</div>
      </div>

      {/* Metric cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10 }}>
        {stats.map((m, i) => (
          <Link key={i} to={m.to} style={{ textDecoration:"none" }}>
            <Card style={{ borderLeft:`3px solid ${m.c}`, padding:14, cursor:"pointer" }}>
              <div style={{ fontSize:30, fontWeight:900, color:m.c }}>{m.v}</div>
              <div style={{ fontSize:12, fontWeight:700, marginTop:2, color:"#D8D8DD" }}>{m.l}</div>
            </Card>
          </Link>
        ))}
      </div>

      {/* Quick Actions */}
      <Card>
        <Label>Quick Actions</Label>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <Link to="/generate" style={{ textDecoration:"none" }}>
            <button style={{
              background:"rgba(191,140,48,.06)", border:"1px solid rgba(191,140,48,.15)",
              color:"#BF8C30", padding:"10px 16px", borderRadius:7,
              fontSize:12, fontWeight:700, cursor:"pointer"
            }}>✦ Generate Content</button>
          </Link>
          <Link to="/requests" style={{ textDecoration:"none" }}>
            <button style={{
              background:"rgba(191,140,48,.06)", border:"1px solid rgba(191,140,48,.15)",
              color:"#BF8C30", padding:"10px 16px", borderRadius:7,
              fontSize:12, fontWeight:700, cursor:"pointer"
            }}>+ New Request</button>
          </Link>
          <Link to="/stats" style={{ textDecoration:"none" }}>
            <button style={{
              background:"rgba(191,140,48,.06)", border:"1px solid rgba(191,140,48,.15)",
              color:"#BF8C30", padding:"10px 16px", borderRadius:7,
              fontSize:12, fontWeight:700, cursor:"pointer"
            }}>📊 Pull Stats</button>
          </Link>
          <Link to="/assets" style={{ textDecoration:"none" }}>
            <button style={{
              background:"rgba(191,140,48,.06)", border:"1px solid rgba(191,140,48,.15)",
              color:"#BF8C30", padding:"10px 16px", borderRadius:7,
              fontSize:12, fontWeight:700, cursor:"pointer"
            }}>📁 Browse Assets</button>
          </Link>
        </div>
      </Card>

      {/* Standings */}
      <Card>
        <Label>Current BLW Standings</Label>
        {TEAMS.map(t => (
          <div key={t.id} onClick={() => setTeamFilter(t.id)} style={{
            display:"flex", alignItems:"center", gap:8, padding:"8px 10px",
            borderRadius:8, cursor:"pointer",
            background: teamFilter === t.id ? "rgba(191,140,48,.06)" : "transparent",
            border: teamFilter === t.id ? "1px solid rgba(191,140,48,.12)" : "1px solid transparent",
            marginBottom:3, transition:"all .15s"
          }}>
            <span style={{
              width:24, height:24, borderRadius:5, background:t.color, color:t.accent,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:11, fontWeight:900
            }}>{t.rank}</span>
            <span style={{
              width:32, height:32, borderRadius:7,
              background:`linear-gradient(135deg,${t.color},${t.color}bb)`, color:t.accent,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:11, fontWeight:900
            }}>{t.id}</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.name}</div>
              {t.owner && <div style={{ fontSize:10, color:"#555" }}>Owner: {t.owner}</div>}
            </div>
            <span style={{ fontSize:12, fontWeight:700, color:"#777", fontVariantNumeric:"tabular-nums" }}>{t.record}</span>
            <span style={{ fontSize:11, fontWeight:600, color:"#888", minWidth:36, textAlign:"right" }}>{t.pct}</span>
            <span style={{
              fontSize:11, fontWeight:700, minWidth:32, textAlign:"right",
              color: t.diff.startsWith("+") && t.diff !== "0" ? "#2A9D8F" : t.diff === "0" ? "#888" : "#E63946"
            }}>{t.diff}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
