import { TEAMS, API_CONFIG } from '../data';
import { Card, Label } from '../components';

export default function Settings() {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div>
        <div style={{ fontSize:26, fontWeight:900, color:"#BF8C30" }}>Settings</div>
        <div style={{ fontSize:13, color:"#555" }}>Team colors, integrations, and configuration</div>
      </div>

      <Card>
        <Label>API Status</Label>
        <div style={{
          display:"flex", alignItems:"center", gap:10, padding:12,
          background: API_CONFIG.isLive ? "rgba(74,222,128,.08)" : "rgba(244,162,97,.08)",
          border: API_CONFIG.isLive ? "1px solid rgba(74,222,128,.2)" : "1px solid rgba(244,162,97,.2)",
          borderRadius:8
        }}>
          <div style={{ width:12, height:12, borderRadius:"50%", background: API_CONFIG.isLive ? "#4ADE80" : "#F4A261" }}/>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, fontWeight:700, color: API_CONFIG.isLive ? "#4ADE80" : "#F4A261" }}>
              {API_CONFIG.isLive ? "Live API Active" : "Using Cached Data"}
            </div>
            <div style={{ fontSize:11, color:"#666", marginTop:2 }}>
              {API_CONFIG.isLive
                ? `Connected to ${API_CONFIG.baseUrl}`
                : "To enable live data, add VITE_PWB_API_KEY to your Vercel environment variables"
              }
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <Label>Team Colors (from official logos)</Label>
        {TEAMS.map(t => (
          <div key={t.id} style={{
            display:"flex", alignItems:"center", gap:8, padding:"8px 10px",
            background:"rgba(255,255,255,.02)", borderRadius:7, marginBottom:4
          }}>
            <span style={{ width:28, height:28, borderRadius:6, background:t.color, border:"2px solid rgba(255,255,255,.1)" }}/>
            <span style={{ width:28, height:28, borderRadius:6, background:t.accent, border:"2px solid rgba(255,255,255,.1)" }}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:700 }}>{t.name}</div>
              {t.owner && <div style={{ fontSize:10, color:"#555" }}>Owner: {t.owner}</div>}
            </div>
            <code style={{ fontSize:11, color:"#BF8C30", background:"rgba(0,0,0,.3)", padding:"3px 8px", borderRadius:4 }}>{t.color}</code>
            <code style={{ fontSize:11, color:"#BF8C30", background:"rgba(0,0,0,.3)", padding:"3px 8px", borderRadius:4 }}>{t.accent}</code>
          </div>
        ))}
      </Card>

      <Card>
        <Label>Integrations</Label>
        {[
          { name:"Dropbox", desc:"Team logos & brand assets", status:"Not connected", color:"#0061FF" },
          { name:"Google Drive", desc:"Player photos & videos", status:"Not connected", color:"#34A853" },
          { name:"prowiffleball.com API", desc:"Player & team stats", status: API_CONFIG.isLive ? "Connected" : "Not configured", color:"#2A9D8F" },
          { name:"Instagram API", desc:"Auto-publish content", status:"Not connected", color:"#E1306C" },
          { name:"Slack", desc:"Team notifications", status:"Not connected", color:"#7289DA" },
        ].map((x, i) => (
          <div key={i} style={{
            display:"flex", alignItems:"center", gap:8, padding:"10px 12px",
            background:"rgba(255,255,255,.02)", borderRadius:7, marginBottom:4
          }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background: x.status === "Connected" ? "#2A9D8F" : "#555" }}/>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:700 }}>{x.name}</div>
              <div style={{ fontSize:10, color:"#555" }}>{x.desc}</div>
            </div>
            <span style={{ fontSize:10, color: x.status === "Connected" ? "#2A9D8F" : "#666", fontWeight:600 }}>{x.status}</span>
            <button style={{
              background: `${x.color}15`, border:`1px solid ${x.color}33`, color:x.color,
              borderRadius:5, padding:"5px 12px", fontSize:10, fontWeight:700, cursor:"pointer"
            }}>{x.status === "Connected" ? "Manage" : "Connect"}</button>
          </div>
        ))}
      </Card>

      <Card>
        <Label>About This App</Label>
        <div style={{ fontSize:12, color:"#999", lineHeight:1.6 }}>
          <div style={{ marginBottom:6 }}><strong style={{ color:"#BF8C30" }}>BLW Content Hub</strong> — Version 1.0</div>
          <div>Content management and graphic generation tool for Big League Wiffle Ball.</div>
          <div style={{ marginTop:10 }}>Managing content for 9 of 10 BLW teams. Season launch: May 1, 2026.</div>
        </div>
      </Card>
    </div>
  );
}
