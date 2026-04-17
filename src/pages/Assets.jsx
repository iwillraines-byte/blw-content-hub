import { useState } from 'react';
import { TEAMS, getTeam } from '../data';
import { Card, Label, inputStyle } from '../components';

const MOCK_FILES = [
  { name:"LAN_00_TEAM_LOGO_PRIMARY.png", team:"LAN", num:"00", player:"TEAM", type:"LOGO", source:"dropbox" },
  { name:"LAN_01_WITTY_HEADSHOT.png", team:"LAN", num:"01", player:"WITTY", type:"HEADSHOT", source:"dropbox" },
  { name:"LAN_01_WITTY_HIGHLIGHT.mp4", team:"LAN", num:"01", player:"WITTY", type:"HIGHLIGHT", source:"gdrive" },
  { name:"LAN_03_JASO_HEADSHOT.png", team:"LAN", num:"03", player:"JASO", type:"HEADSHOT", source:"dropbox" },
  { name:"LAN_08_ROBLES_HEADSHOT.png", team:"LAN", num:"08", player:"ROBLES", type:"HEADSHOT", source:"dropbox" },
  { name:"AZS_00_TEAM_LOGO_PRIMARY.png", team:"AZS", num:"00", player:"TEAM", type:"LOGO", source:"dropbox" },
  { name:"AZS_02_LEDET_HEADSHOT.png", team:"AZS", num:"02", player:"LEDET", type:"HEADSHOT", source:"dropbox" },
  { name:"AZS_02_LEDET_ACTION.jpg", team:"AZS", num:"02", player:"LEDET", type:"ACTION", source:"gdrive" },
  { name:"DAL_26_ROSE_HEADSHOT.png", team:"DAL", num:"26", player:"ROSE", type:"HEADSHOT", source:"dropbox" },
  { name:"BOS_13_DALBEY_HEADSHOT.png", team:"BOS", num:"13", player:"DALBEY", type:"HEADSHOT", source:"dropbox" },
  { name:"MIA_18_HERNANDEZ_HEADSHOT.png", team:"MIA", num:"18", player:"HERNANDEZ", type:"HEADSHOT", source:"dropbox" },
  { name:"SDO_16_ROTH_HEADSHOT.png", team:"SDO", num:"16", player:"ROTH", type:"HEADSHOT", source:"dropbox" },
  { name:"LVS_28_STAGGS_HEADSHOT.png", team:"LVS", num:"28", player:"STAGGS", type:"HEADSHOT", source:"dropbox" },
];

const typeIcons = { HEADSHOT:"👤", ACTION:"📸", HIGHLIGHT:"🎬", LOGO:"🎨", PORTRAIT:"🖼️" };
const sourceIcons = { dropbox:"📦", gdrive:"📁" };
const sourceColors = { dropbox:"#0061FF", gdrive:"#34A853" };

export default function Assets({ teamFilter }) {
  const [connDropbox, setConnDropbox] = useState(false);
  const [connGdrive, setConnGdrive] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = MOCK_FILES.filter(f => {
    if (teamFilter !== "ALL" && f.team !== teamFilter) return false;
    if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div>
        <div style={{ fontSize:26, fontWeight:900, color:"#BF8C30" }}>Asset Manager</div>
        <div style={{ fontSize:13, color:"#555" }}>Browse media stored in Dropbox and Google Drive</div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <Card style={{ padding:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:28 }}>📦</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:14, fontWeight:800, color: connDropbox ? "#4D9AFF" : "#888" }}>Dropbox</div>
              <div style={{ fontSize:10, color: connDropbox ? "#4D9AFF" : "#666" }}>
                {connDropbox ? `Connected — ${MOCK_FILES.filter(f => f.source === "dropbox").length} files` : "Paste shared folder link"}
              </div>
            </div>
            {connDropbox
              ? <div style={{ width:10, height:10, borderRadius:"50%", background:"#4ADE80" }} />
              : <button onClick={() => setConnDropbox(true)} style={{ background:"#0061FF", color:"#fff", border:"none", borderRadius:6, padding:"6px 14px", fontSize:11, fontWeight:700, cursor:"pointer" }}>Connect</button>
            }
          </div>
        </Card>
        <Card style={{ padding:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:28 }}>📁</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:14, fontWeight:800, color: connGdrive ? "#34A853" : "#888" }}>Google Drive</div>
              <div style={{ fontSize:10, color: connGdrive ? "#34A853" : "#666" }}>
                {connGdrive ? `Connected — ${MOCK_FILES.filter(f => f.source === "gdrive").length} files` : "Paste shared folder link"}
              </div>
            </div>
            {connGdrive
              ? <div style={{ width:10, height:10, borderRadius:"50%", background:"#4ADE80" }} />
              : <button onClick={() => setConnGdrive(true)} style={{ background:"#34A853", color:"#fff", border:"none", borderRadius:6, padding:"6px 14px", fontSize:11, fontWeight:700, cursor:"pointer" }}>Connect</button>
            }
          </div>
        </Card>
      </div>

      <Card>
        <input type="text" placeholder="Search by filename or player..." value={search} onChange={e => setSearch(e.target.value)} style={inputStyle} />
        <div style={{ fontSize:11, color:"#555", marginTop:8 }}>{filtered.length} file{filtered.length !== 1 ? "s" : ""}</div>
      </Card>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(200px, 1fr))", gap:10 }}>
        {filtered.map((f, i) => {
          const t = getTeam(f.team);
          return (
            <Card key={i} style={{ padding:12 }}>
              <div style={{
                width:"100%", height:100, borderRadius:8, marginBottom:8,
                background: t ? `linear-gradient(135deg,${t.color}33,${t.color}11)` : "rgba(255,255,255,.02)",
                display:"flex", alignItems:"center", justifyContent:"center", position:"relative"
              }}>
                <span style={{ fontSize:32, opacity:.6 }}>{typeIcons[f.type] || "📄"}</span>
                <div style={{ position:"absolute", top:6, right:6, background:sourceColors[f.source]+"22", borderRadius:4, padding:"2px 6px", fontSize:9, color:sourceColors[f.source], fontWeight:700 }}>
                  {sourceIcons[f.source]}
                </div>
              </div>
              <div style={{ fontSize:11, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:4 }}>{f.name}</div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                {t && <span style={{ background:t.color, color:t.accent, padding:"1px 6px", borderRadius:4, fontSize:9, fontWeight:800 }}>{t.id}</span>}
                <span style={{ color:"#888", fontSize:9, fontWeight:700 }}>{f.type}</span>
              </div>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <Card style={{ textAlign:"center", padding:40, color:"#555" }}>
          No assets found. Connect Dropbox or Google Drive above to browse your media library.
        </Card>
      )}
    </div>
  );
}
