import { TEAMS, getTeam } from './data';

export const Card = ({children, style, ...p}) => (
  <div style={{
    background:"linear-gradient(150deg,#111118,#16161F)",
    border:"1px solid rgba(255,255,255,.05)",
    borderRadius:14, padding:18, ...style
  }} {...p}>{children}</div>
);

export const Label = ({children}) => (
  <div style={{
    fontSize:15, fontWeight:800, color:"#BF8C30",
    marginBottom:14, letterSpacing:1.2, textTransform:"uppercase"
  }}>{children}</div>
);

export const TeamChip = ({teamId, small}) => {
  const t = getTeam(teamId);
  if (!t) return null;
  return (
    <span style={{
      display:"inline-flex", alignItems:"center",
      background:t.color, color:t.accent,
      padding: small ? "2px 7px" : "3px 10px",
      borderRadius:5, fontSize: small ? 9 : 11,
      fontWeight:800, letterSpacing:.6
    }}>{t.id}</span>
  );
};

export const StatusBadge = ({status}) => {
  const map = {
    pending:{bg:"#FFF3CD",c:"#856404",l:"Pending"},
    "in-progress":{bg:"#CCE5FF",c:"#004085",l:"In Progress"},
    approved:{bg:"#D4EDDA",c:"#155724",l:"Approved"},
    revision:{bg:"#F8D7DA",c:"#721C24",l:"Revision"},
    completed:{bg:"#D1ECF1",c:"#0C5460",l:"Completed"},
  };
  const s = map[status] || { bg:"#eee", c:"#333", l:status };
  return (
    <span style={{
      background:s.bg, color:s.c, padding:"3px 10px", borderRadius:20,
      fontSize:10, fontWeight:700, letterSpacing:.3,
      textTransform:"uppercase", whiteSpace:"nowrap"
    }}>{s.l}</span>
  );
};

export const PriorityDot = ({p}) => (
  <span style={{
    display:"inline-block", width:8, height:8, borderRadius:"50%",
    background:{high:"#E63946",medium:"#F4A261",low:"#2A9D8F"}[p]||"#888",
    marginRight:4
  }}/>
);

export const inputStyle = {
  width:"100%", boxSizing:"border-box",
  background:"rgba(0,0,0,.4)", border:"1px solid rgba(255,255,255,.08)",
  borderRadius:7, padding:"9px 11px", color:"#E0E0E0",
  fontSize:12, outline:"none", fontFamily:"inherit"
};

export const selectStyle = { ...inputStyle, cursor:"pointer" };

export const GoldButton = ({ children, onClick, disabled, style }) => (
  <button onClick={onClick} disabled={disabled} style={{
    background: disabled ? "#333" : "linear-gradient(135deg,#BF8C30,#D4A84B)",
    color: disabled ? "#666" : "#0A0A0F",
    border:"none", borderRadius:8, padding:"10px 22px",
    fontSize:12, fontWeight:800, cursor: disabled ? "default" : "pointer",
    letterSpacing:.4, opacity: disabled ? .5 : 1, ...style
  }}>{children}</button>
);
