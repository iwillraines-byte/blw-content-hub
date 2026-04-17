import { useState, useEffect } from 'react';
import { fetchBattingLeaders, fetchPitchingLeaders, API_CONFIG } from '../data';
import { Card, Label, TeamChip } from '../components';

export default function Stats() {
  const [tab, setTab] = useState("batting");
  const [batting, setBatting] = useState([]);
  const [pitching, setPitching] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchBattingLeaders(), fetchPitchingLeaders()]).then(([b, p]) => {
      setBatting(b); setPitching(p); setLoading(false);
    });
  }, []);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div>
        <div style={{ fontSize:26, fontWeight:900, color:"#BF8C30" }}>Stats Hub</div>
        <div style={{ fontSize:13, color:"#555" }}>prowiffleball.com • Batting OPS+ • Pitching FIP</div>
      </div>

      <div style={{
        background: API_CONFIG.isLive ? "linear-gradient(135deg,rgba(74,222,128,.08),transparent)" : "linear-gradient(135deg,rgba(244,162,97,.08),transparent)",
        border: API_CONFIG.isLive ? "1px solid rgba(74,222,128,.2)" : "1px solid rgba(244,162,97,.2)",
        borderRadius:10, padding:12, display:"flex", alignItems:"center", gap:10
      }}>
        <span style={{ fontSize:22 }}>{API_CONFIG.isLive ? "🟢" : "🟡"}</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:700, color: API_CONFIG.isLive ? "#4ADE80" : "#F4A261" }}>
            {API_CONFIG.isLive ? "Live API Connected" : "Cached Data (API key not configured)"}
          </div>
          <div style={{ fontSize:11, color:"#666" }}>
            {API_CONFIG.isLive ? "Data synced from prowiffleball.com" : "Add VITE_PWB_API_KEY in Vercel env vars to enable live data"}
          </div>
        </div>
      </div>

      <div style={{ display:"flex", gap:4 }}>
        <button onClick={() => setTab("batting")} style={{
          background: tab === "batting" ? "rgba(191,140,48,.12)" : "rgba(255,255,255,.02)",
          border: tab === "batting" ? "1px solid #BF8C30" : "1px solid rgba(255,255,255,.05)",
          color: tab === "batting" ? "#BF8C30" : "#666",
          borderRadius:6, padding:"8px 16px", fontSize:12, fontWeight:700, cursor:"pointer"
        }}>🏏 Batting (OPS+)</button>
        <button onClick={() => setTab("pitching")} style={{
          background: tab === "pitching" ? "rgba(191,140,48,.12)" : "rgba(255,255,255,.02)",
          border: tab === "pitching" ? "1px solid #BF8C30" : "1px solid rgba(255,255,255,.05)",
          color: tab === "pitching" ? "#BF8C30" : "#666",
          borderRadius:6, padding:"8px 16px", fontSize:12, fontWeight:700, cursor:"pointer"
        }}>💨 Pitching (FIP)</button>
      </div>

      {loading && <Card style={{ textAlign:"center", color:"#666" }}>Loading stats...</Card>}

      {!loading && tab === "batting" && (
        <Card>
          <Label>Player Batting — OPS+ Leaders</Label>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ borderBottom:"1px solid rgba(255,255,255,.08)" }}>
                  {["#","Player","Team","OPS+","AVG","OBP","SLG","HR"].map(h => (
                    <th key={h} style={{ padding:"8px 10px", textAlign: h === "Player" || h === "Team" ? "left" : "right", color: h === "OPS+" ? "#BF8C30" : "#666", fontWeight:700, fontSize:10, textTransform:"uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {batting.map(p => (
                  <tr key={p.rank} style={{ borderBottom:"1px solid rgba(255,255,255,.02)" }}>
                    <td style={{ padding:"8px 10px", textAlign:"right", fontWeight:700, color:"#555" }}>{p.rank}</td>
                    <td style={{ padding:"8px 10px", fontWeight:700 }}>{p.name}</td>
                    <td style={{ padding:"8px 10px" }}><TeamChip teamId={p.team} small /></td>
                    <td style={{ padding:"8px 10px", textAlign:"right", fontWeight:800, color:"#BF8C30", fontSize:14 }}>{p.ops_plus}</td>
                    <td style={{ padding:"8px 10px", textAlign:"right" }}>{p.avg}</td>
                    <td style={{ padding:"8px 10px", textAlign:"right" }}>{p.obp}</td>
                    <td style={{ padding:"8px 10px", textAlign:"right" }}>{p.slg}</td>
                    <td style={{ padding:"8px 10px", textAlign:"right", fontWeight:700 }}>{p.hr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && tab === "pitching" && (
        <Card>
          <Label>Player Pitching — FIP Leaders</Label>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ borderBottom:"1px solid rgba(255,255,255,.08)" }}>
                  {["#","Player","Team","FIP","ERA","IP","K/4","W","L"].map(h => (
                    <th key={h} style={{ padding:"8px 10px", textAlign: h === "Player" || h === "Team" ? "left" : "right", color: h === "FIP" ? "#BF8C30" : "#666", fontWeight:700, fontSize:10, textTransform:"uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pitching.map(p => (
                  <tr key={p.rank} style={{ borderBottom:"1px solid rgba(255,255,255,.02)" }}>
                    <td style={{ padding:"8px 10px", textAlign:"right", fontWeight:700, color:"#555" }}>{p.rank}</td>
                    <td style={{ padding:"8px 10px", fontWeight:700 }}>{p.name}</td>
                    <td style={{ padding:"8px 10px" }}><TeamChip teamId={p.team} small /></td>
                    <td style={{ padding:"8px 10px", textAlign:"right", fontWeight:800, color:"#BF8C30", fontSize:14 }}>{p.fip.toFixed(2)}</td>
                    <td style={{ padding:"8px 10px", textAlign:"right" }}>{p.era}</td>
                    <td style={{ padding:"8px 10px", textAlign:"right" }}>{p.ip}</td>
                    <td style={{ padding:"8px 10px", textAlign:"right" }}>{p.k4}</td>
                    <td style={{ padding:"8px 10px", textAlign:"right", fontWeight:700 }}>{p.w}</td>
                    <td style={{ padding:"8px 10px", textAlign:"right", fontWeight:700, color:"#888" }}>{p.l}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
