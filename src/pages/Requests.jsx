import { useState } from 'react';
import { TEAMS, TEMPLATES, getTeam } from '../data';
import { Card, Label, TeamChip, StatusBadge, PriorityDot, inputStyle, selectStyle, GoldButton } from '../components';

const INITIAL_REQUESTS = [
  { id:1, team:"DAL", template:"gameday", status:"pending", requester:"Jake M. (Athlete)", date:"Apr 14", priority:"high", note:"Need this for the Lone Star Showdown at RoughRiders park" },
  { id:2, team:"MIA", template:"player-stat", status:"in-progress", requester:"Sarah K. (Team Mgr)", date:"Apr 13", priority:"medium", note:"Tommy Hernandez batting .435 — needs a stat spotlight" },
  { id:3, team:"AZS", template:"highlight-video", status:"approved", requester:"Mike R. (Internal)", date:"Apr 12", priority:"low", note:"Top 5 plays from Scottsdale tournament" },
  { id:4, team:"NYG", template:"ranking-change", status:"pending", requester:"Alex T. (Athlete)", date:"Apr 14", priority:"high", note:"Climbed to 4th — Gary Vee wants this posted ASAP" },
  { id:5, team:"CHI", template:"score", status:"revision", requester:"Internal Auto", date:"Apr 13", priority:"medium", note:"Score graphic had wrong final — needs correction" },
  { id:6, team:"LAN", template:"hype", status:"completed", requester:"Logan R. (Internal)", date:"Apr 11", priority:"low", note:"17-1 celebration post — Costner retweeted" },
  { id:7, team:"PHI", template:"pitching-leaders", status:"pending", requester:"David Adelman (Owner)", date:"Apr 14", priority:"high", note:"Josh Wheeler leading — need graphic" },
];

export default function Requests({ teamFilter }) {
  const [requests, setRequests] = useState(INITIAL_REQUESTS);
  const [showNew, setShowNew] = useState(false);
  const [newTeam, setNewTeam] = useState("");
  const [newTemplate, setNewTemplate] = useState("");
  const [newPriority, setNewPriority] = useState("medium");
  const [newNote, setNewNote] = useState("");

  const filtered = requests.filter(r => teamFilter === "ALL" || r.team === teamFilter);
  const updateStatus = (id, status) => setRequests(rs => rs.map(r => r.id === id ? {...r, status} : r));

  const submit = () => {
    if (!newTeam || !newTemplate) return;
    setRequests(rs => [{
      id: rs.length + 1, team: newTeam, template: newTemplate,
      status: "pending", requester: "You (Internal)", date: "Apr 15",
      priority: newPriority, note: newNote
    }, ...rs]);
    setShowNew(false); setNewTeam(""); setNewTemplate(""); setNewNote("");
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:26, fontWeight:900, color:"#BF8C30" }}>Content Requests</div>
          <div style={{ fontSize:13, color:"#555" }}>Athletes, owners, managers, internal</div>
        </div>
        <button onClick={() => setShowNew(!showNew)} style={{
          background: showNew ? "#E63946" : "rgba(191,140,48,.1)",
          color: showNew ? "#fff" : "#BF8C30",
          border:"none", borderRadius:7, padding:"8px 16px",
          fontSize:12, fontWeight:700, cursor:"pointer"
        }}>{showNew ? "✕ Cancel" : "+ New Request"}</button>
      </div>

      {showNew && (
        <Card style={{ borderColor:"rgba(191,140,48,.15)" }}>
          <Label>New Request</Label>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:10 }}>
            <div>
              <label style={{ fontSize:10, color:"#666", fontWeight:700, textTransform:"uppercase" }}>Team</label>
              <select value={newTeam} onChange={e => setNewTeam(e.target.value)} style={{ ...selectStyle, marginTop:3 }}>
                <option value="">Select...</option>
                {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:10, color:"#666", fontWeight:700, textTransform:"uppercase" }}>Type</label>
              <select value={newTemplate} onChange={e => setNewTemplate(e.target.value)} style={{ ...selectStyle, marginTop:3 }}>
                <option value="">Select...</option>
                {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:10, color:"#666", fontWeight:700, textTransform:"uppercase" }}>Priority</label>
              <select value={newPriority} onChange={e => setNewPriority(e.target.value)} style={{ ...selectStyle, marginTop:3 }}>
                <option value="high">🔴 High</option>
                <option value="medium">🟡 Medium</option>
                <option value="low">🟢 Low</option>
              </select>
            </div>
          </div>
          <textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Notes..." style={{ ...inputStyle, minHeight:60, resize:"vertical", marginBottom:10 }} />
          <GoldButton onClick={submit} disabled={!newTeam || !newTemplate}>Submit Request</GoldButton>
        </Card>
      )}

      {filtered.map(r => {
        const tp = TEMPLATES.find(t => t.id === r.template);
        return (
          <Card key={r.id}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
              <PriorityDot p={r.priority} />
              <TeamChip teamId={r.team} small />
              <span style={{ fontSize:13, fontWeight:800 }}>{tp?.icon} {tp?.name || r.template}</span>
              <div style={{ flex:1 }} />
              <StatusBadge status={r.status} />
            </div>
            <div style={{ fontSize:12, color:"#888", marginBottom:6, paddingLeft:16 }}>{r.note}</div>
            <div style={{ display:"flex", alignItems:"center", gap:8, paddingLeft:16 }}>
              <span style={{ fontSize:10, color:"#555" }}>{r.requester} · {r.date}</span>
              <div style={{ flex:1 }} />
              {r.status === "pending" && (
                <>
                  <button onClick={() => updateStatus(r.id, "in-progress")} style={{ background:"#4895EF", color:"#fff", border:"none", borderRadius:4, padding:"4px 10px", fontSize:10, fontWeight:700, cursor:"pointer" }}>Start</button>
                  <button onClick={() => updateStatus(r.id, "approved")} style={{ background:"#2A9D8F", color:"#fff", border:"none", borderRadius:4, padding:"4px 10px", fontSize:10, fontWeight:700, cursor:"pointer" }}>Approve</button>
                </>
              )}
              {r.status === "in-progress" && (
                <>
                  <button onClick={() => updateStatus(r.id, "revision")} style={{ background:"#E63946", color:"#fff", border:"none", borderRadius:4, padding:"4px 10px", fontSize:10, fontWeight:700, cursor:"pointer" }}>Revision</button>
                  <button onClick={() => updateStatus(r.id, "completed")} style={{ background:"#2A9D8F", color:"#fff", border:"none", borderRadius:4, padding:"4px 10px", fontSize:10, fontWeight:700, cursor:"pointer" }}>Complete</button>
                </>
              )}
              {r.status === "revision" && (
                <button onClick={() => updateStatus(r.id, "in-progress")} style={{ background:"#4895EF", color:"#fff", border:"none", borderRadius:4, padding:"4px 10px", fontSize:10, fontWeight:700, cursor:"pointer" }}>Resume</button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
