import { useState, useRef, useEffect, useCallback } from 'react';
import { TEAMS, PLATFORMS, TEMPLATES, BATTING_LEADERS, PITCHING_LEADERS, getTeam } from '../data';
import { Card, Label, inputStyle, selectStyle, GoldButton } from '../components';

function hexToRgba(hex, alpha = 1) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

function drawDiagonalStripes(ctx, w, h, color, spacing=30, thickness=8) {
  ctx.save();
  ctx.strokeStyle = hexToRgba(color, 0.06);
  ctx.lineWidth = thickness;
  for (let i = -h; i < w + h; i += spacing) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke();
  }
  ctx.restore();
}

// Render functions
function renderGameDay(ctx, w, h, team, opp, fields) {
  const oppTeam = getTeam(opp) || TEAMS[0];
  const grad = ctx.createLinearGradient(0,0,w,h);
  grad.addColorStop(0, team.dark); grad.addColorStop(0.5, team.color); grad.addColorStop(1, team.dark);
  ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
  drawDiagonalStripes(ctx, w, h, team.accent, 40, 12);
  ctx.fillStyle = hexToRgba("#000", 0.4); ctx.fillRect(0, 0, w, 80);
  ctx.fillStyle = team.accent; ctx.font = "bold 28px 'Arial Black', sans-serif";
  ctx.textAlign = "center"; ctx.fillText("BIG LEAGUE WIFFLE BALL", w/2, 52);
  ctx.fillStyle = team.accent; ctx.font = "900 72px 'Arial Black', sans-serif";
  ctx.fillText("GAME DAY", w/2, h*0.22);
  const vsY = h * 0.42;
  ctx.fillStyle = team.color;
  drawRoundRect(ctx, 60, vsY - 80, w/2 - 90, 160, 16); ctx.fill();
  ctx.strokeStyle = team.accent; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = team.accent; ctx.font = "900 48px 'Arial Black'";
  ctx.fillText(team.id, w*0.25, vsY + 10);
  ctx.font = "600 18px Arial"; ctx.fillText(team.record, w*0.25, vsY + 45);
  ctx.fillStyle = "#FFF"; ctx.beginPath(); ctx.arc(w/2, vsY, 36, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = "#000"; ctx.font = "900 28px 'Arial Black'"; ctx.fillText("VS", w/2, vsY + 10);
  ctx.fillStyle = oppTeam.color;
  drawRoundRect(ctx, w/2 + 30, vsY - 80, w/2 - 90, 160, 16); ctx.fill();
  ctx.strokeStyle = oppTeam.accent; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = oppTeam.accent; ctx.font = "900 48px 'Arial Black'";
  ctx.fillText(oppTeam.id, w*0.75, vsY + 10);
  ctx.font = "600 18px Arial"; ctx.fillText(oppTeam.record, w*0.75, vsY + 45);
  const detY = h * 0.68;
  ctx.fillStyle = hexToRgba("#000", 0.5);
  drawRoundRect(ctx, 60, detY, w - 120, 120, 12); ctx.fill();
  ctx.fillStyle = "#FFF"; ctx.font = "bold 24px Arial";
  ctx.fillText(fields.date || "SATURDAY, APR 19", w/2, detY + 40);
  ctx.fillStyle = team.accent; ctx.font = "600 20px Arial";
  ctx.fillText(fields.time || "9:00 AM CT", w/2, detY + 72);
  ctx.fillStyle = "#999"; ctx.font = "400 16px Arial";
  ctx.fillText(fields.venue || "TOURNAMENT VENUE", w/2, detY + 100);
  ctx.fillStyle = team.accent; ctx.font = "bold 16px Arial";
  ctx.fillText("prowiffleball.com", w/2, h - 30);
}

function renderPlayerStat(ctx, w, h, team, fields) {
  const grad = ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0, team.dark); grad.addColorStop(1, team.color);
  ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
  drawDiagonalStripes(ctx, w, h, team.accent, 35, 10);
  ctx.fillStyle = team.accent; ctx.fillRect(0, 0, 8, h);
  ctx.fillStyle = hexToRgba("#000", 0.3); ctx.fillRect(0, 0, w, 70);
  ctx.fillStyle = team.accent; ctx.font = "bold 22px Arial"; ctx.textAlign = "left";
  ctx.fillText("PLAYER SPOTLIGHT", 40, 46);
  ctx.textAlign = "right"; ctx.font = "bold 18px Arial";
  ctx.fillText(team.id + " | " + team.name.toUpperCase(), w - 40, 46);
  ctx.fillStyle = "#FFF"; ctx.font = "900 64px 'Arial Black'"; ctx.textAlign = "left";
  ctx.fillText((fields.playerName || "PLAYER NAME").toUpperCase(), 40, 170);
  ctx.fillStyle = hexToRgba(team.accent, 0.15); ctx.font = "900 300px 'Arial Black'"; ctx.textAlign = "right";
  ctx.fillText(fields.number || "00", w - 20, 380);
  const stats = (fields.statLine || "OPS+ 200 | AVG .462 | HR 7 | RBI 29").split("|").map(s=>s.trim());
  const boxW = (w - 120) / stats.length;
  stats.forEach((stat, i) => {
    const x = 40 + i * (boxW + 14);
    const parts = stat.split(" ");
    const label = parts[0] || "";
    const value = parts.slice(1).join(" ") || "";
    ctx.fillStyle = hexToRgba("#000", 0.4);
    drawRoundRect(ctx, x, h * 0.48, boxW - 8, 160, 12); ctx.fill();
    ctx.strokeStyle = hexToRgba(team.accent, 0.3); ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = team.accent; ctx.font = "bold 18px Arial"; ctx.textAlign = "center";
    ctx.fillText(label, x + (boxW-8)/2, h*0.48 + 40);
    ctx.fillStyle = "#FFF"; ctx.font = "900 52px 'Arial Black'";
    ctx.fillText(value, x + (boxW-8)/2, h*0.48 + 110);
  });
  ctx.fillStyle = team.accent; ctx.font = "700 14px Arial"; ctx.textAlign = "center";
  ctx.fillText("BIG LEAGUE WIFFLE BALL  •  prowiffleball.com", w/2, h - 30);
}

function renderFinalScore(ctx, w, h, team, opp, fields) {
  const oppTeam = getTeam(opp) || TEAMS[0];
  const homeScore = fields.teamScore || "5";
  const awayScore = fields.oppScore || "2";
  const won = parseInt(homeScore) > parseInt(awayScore);
  ctx.fillStyle = team.color; ctx.fillRect(0, 0, w/2, h);
  ctx.fillStyle = oppTeam.color; ctx.fillRect(w/2, 0, w/2, h);
  drawDiagonalStripes(ctx, w, h, "#FFFFFF", 50, 15);
  ctx.fillStyle = hexToRgba("#000", 0.7);
  drawRoundRect(ctx, w*0.08, h*0.1, w*0.84, h*0.8, 24); ctx.fill();
  ctx.fillStyle = won ? "#4ADE80" : "#F87171"; ctx.font = "900 36px 'Arial Black'"; ctx.textAlign = "center";
  ctx.fillText(won ? "VICTORY" : "FINAL", w/2, h*0.22);
  ctx.fillStyle = team.accent; ctx.font = "900 56px 'Arial Black'";
  ctx.fillText(team.id, w*0.3, h*0.42);
  ctx.fillStyle = oppTeam.accent; ctx.fillText(oppTeam.id, w*0.7, h*0.42);
  ctx.fillStyle = "#FFF"; ctx.font = "900 120px 'Arial Black'";
  ctx.fillText(homeScore, w*0.3, h*0.62); ctx.fillText(awayScore, w*0.7, h*0.62);
  ctx.fillStyle = "#666"; ctx.font = "900 60px 'Arial Black'"; ctx.fillText("—", w/2, h*0.58);
  if (fields.mvp) {
    ctx.fillStyle = hexToRgba("#FFF", 0.6); ctx.font = "600 20px Arial";
    ctx.fillText("MVP: " + fields.mvp, w/2, h*0.76);
  }
  ctx.fillStyle = "#888"; ctx.font = "bold 14px Arial"; ctx.fillText("BIG LEAGUE WIFFLE BALL", w/2, h*0.88);
}

function renderLeaderboard(ctx, w, h, type) {
  const data = type === "batting" ? BATTING_LEADERS.slice(0, 8) : PITCHING_LEADERS.slice(0, 8);
  const statLabel = type === "batting" ? "OPS+" : "FIP";
  ctx.fillStyle = "#0A0A12"; ctx.fillRect(0, 0, w, h);
  drawDiagonalStripes(ctx, w, h, "#FFFFFF", 60, 8);
  const headGrad = ctx.createLinearGradient(0, 0, w, 100);
  headGrad.addColorStop(0, "#BF8C30"); headGrad.addColorStop(1, "#8B6914");
  ctx.fillStyle = headGrad; ctx.fillRect(0, 0, w, 100);
  ctx.fillStyle = "#0A0A0F"; ctx.font = "900 38px 'Arial Black'"; ctx.textAlign = "center";
  ctx.fillText(type === "batting" ? "BATTING LEADERS" : "PITCHING LEADERS", w/2, 64);
  ctx.font = "600 16px Arial";
  ctx.fillText("BIG LEAGUE WIFFLE BALL  •  " + statLabel + " RANKINGS", w/2, 90);
  const startY = 140;
  const rowH = (h - startY - 60) / data.length;
  data.forEach((p, i) => {
    const y = startY + i * rowH;
    const t = getTeam(p.team);
    ctx.fillStyle = i % 2 === 0 ? hexToRgba("#FFF", 0.04) : "transparent";
    ctx.fillRect(30, y, w - 60, rowH);
    ctx.fillStyle = i < 3 ? "#BF8C30" : "#666"; ctx.font = "900 28px 'Arial Black'"; ctx.textAlign = "right";
    ctx.fillText(String(i+1), 80, y + rowH*0.62);
    if (t) { ctx.fillStyle = t.color; ctx.fillRect(95, y + 8, 6, rowH - 16); }
    ctx.fillStyle = "#FFF"; ctx.font = "700 22px Arial"; ctx.textAlign = "left";
    ctx.fillText(p.name, 118, y + rowH*0.55);
    ctx.fillStyle = t ? t.accent : "#888"; ctx.font = "bold 14px Arial";
    ctx.fillText(t ? t.id : "???", 118, y + rowH*0.85);
    const val = type === "batting" ? String(p.ops_plus) : p.fip.toFixed(2);
    ctx.fillStyle = "#BF8C30"; ctx.font = "900 34px 'Arial Black'"; ctx.textAlign = "right";
    ctx.fillText(val, w - 50, y + rowH*0.65);
  });
  ctx.fillStyle = "#444"; ctx.font = "bold 12px Arial"; ctx.textAlign = "center";
  ctx.fillText("prowiffleball.com  •  Data as of April 2026", w/2, h - 20);
}

function renderStandings(ctx, w, h) {
  ctx.fillStyle = "#0A0A12"; ctx.fillRect(0, 0, w, h);
  drawDiagonalStripes(ctx, w, h, "#FFFFFF", 55, 6);
  const headGrad = ctx.createLinearGradient(0,0,w,100);
  headGrad.addColorStop(0, "#BF8C30"); headGrad.addColorStop(1, "#8B6914");
  ctx.fillStyle = headGrad; ctx.fillRect(0, 0, w, 110);
  ctx.fillStyle = "#0A0A0F"; ctx.font = "900 42px 'Arial Black'"; ctx.textAlign = "center";
  ctx.fillText("BLW STANDINGS", w/2, 60);
  ctx.font = "600 18px Arial"; ctx.fillText("2025-26 SEASON", w/2, 90);
  const startY = 140;
  const rowH = (h - startY - 80) / TEAMS.length;
  TEAMS.forEach((t, i) => {
    const y = startY + 20 + i * rowH;
    const [wins, losses] = t.record.split("-");
    ctx.fillStyle = i % 2 === 0 ? hexToRgba("#FFF", 0.03) : "transparent";
    ctx.fillRect(30, y, w - 60, rowH);
    ctx.fillStyle = t.color;
    drawRoundRect(ctx, 50, y + 6, 36, rowH - 12, 8); ctx.fill();
    ctx.fillStyle = t.accent; ctx.font = "900 18px 'Arial Black'"; ctx.textAlign = "center";
    ctx.fillText(String(i+1), 68, y + rowH*0.6);
    ctx.fillStyle = t.color; ctx.fillRect(100, y + 6, 6, rowH - 12);
    ctx.fillStyle = "#FFF"; ctx.font = "bold 20px Arial"; ctx.textAlign = "left";
    ctx.fillText(t.name, 120, y + rowH*0.5);
    ctx.fillStyle = t.accent; ctx.font = "bold 12px Arial";
    ctx.fillText(t.id, 120, y + rowH*0.8);
    ctx.fillStyle = "#CCC"; ctx.font = "700 20px 'Courier New'"; ctx.textAlign = "right";
    ctx.fillText(wins, w-250, y + rowH*0.6);
    ctx.fillText(losses, w-190, y + rowH*0.6);
    ctx.fillText(t.pct, w-110, y + rowH*0.6);
    ctx.fillStyle = t.diff.startsWith("+") && t.diff !== "0" ? "#4ADE80" : t.diff === "0" ? "#888" : "#F87171";
    ctx.fillText(t.diff, w-40, y + rowH*0.6);
  });
  ctx.fillStyle = "#444"; ctx.font = "bold 12px Arial"; ctx.textAlign = "center";
  ctx.fillText("BIG LEAGUE WIFFLE BALL  •  prowiffleball.com", w/2, h - 20);
}

export default function Generate() {
  const canvasRef = useRef(null);
  const [team, setTeam] = useState("LAN");
  const [opp, setOpp] = useState("AZS");
  const [template, setTemplate] = useState("gameday");
  const [platform, setPlatform] = useState("feed");
  const [fields, setFields] = useState({});

  const teamObj = getTeam(team);
  const plat = PLATFORMS[platform];
  const scale = Math.min(400 / plat.w, 500 / plat.h);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !teamObj) return;
    canvas.width = plat.w; canvas.height = plat.h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, plat.w, plat.h);
    switch(template) {
      case "gameday": renderGameDay(ctx, plat.w, plat.h, teamObj, opp, fields); break;
      case "player-stat": renderPlayerStat(ctx, plat.w, plat.h, teamObj, fields); break;
      case "score": renderFinalScore(ctx, plat.w, plat.h, teamObj, opp, fields); break;
      case "batting-leaders": renderLeaderboard(ctx, plat.w, plat.h, "batting"); break;
      case "pitching-leaders": renderLeaderboard(ctx, plat.w, plat.h, "pitching"); break;
      case "standings": renderStandings(ctx, plat.w, plat.h); break;
    }
  }, [team, opp, template, platform, fields, teamObj, plat]);

  useEffect(() => { render(); }, [render]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `BLW_${team}_${template}_${platform}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const autoFillBatting = () => {
    const top = BATTING_LEADERS.find(p => p.team === team) || BATTING_LEADERS[0];
    setFields({ playerName: top.name, number: top.num, statLine: `OPS+ ${top.ops_plus} | AVG ${top.avg} | HR ${top.hr} | OBP ${top.obp}` });
  };

  const autoFillPitching = () => {
    const top = PITCHING_LEADERS.find(p => p.team === team) || PITCHING_LEADERS[0];
    setFields({ playerName: top.name, number: top.num, statLine: `FIP ${top.fip.toFixed(2)} | IP ${top.ip} | W ${top.w} | K/4 ${top.k4}` });
  };

  const currentTemplate = TEMPLATES.find(t => t.id === template);
  const needsOpp = template === "gameday" || template === "score";

  return (
    <div>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:26, fontWeight:900, color:"#BF8C30" }}>Content Generator</div>
        <div style={{ fontSize:13, color:"#555" }}>Create downloadable graphics for any team</div>
      </div>

      <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
        {/* CONTROLS */}
        <div style={{ flex:"1 1 320px", display:"flex", flexDirection:"column", gap:12 }}>
          <Card>
            <Label>Template</Label>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:4 }}>
              {TEMPLATES.map(t => (
                <button key={t.id} onClick={() => { setTemplate(t.id); setFields({}); }} style={{
                  background: template === t.id ? "rgba(191,140,48,.12)" : "rgba(255,255,255,.02)",
                  border: template === t.id ? "1px solid #BF8C30" : "1px solid rgba(255,255,255,.05)",
                  color: template === t.id ? "#BF8C30" : "#777",
                  borderRadius:8, padding:"10px 4px", cursor:"pointer",
                  fontSize:10, fontWeight:700, textAlign:"center"
                }}>
                  <div style={{ fontSize:18 }}>{t.icon}</div>{t.name}
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <Label>Team & Format</Label>
            <div style={{ display:"flex", gap:8, marginBottom:8 }}>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:10, color:"#666", fontWeight:700, textTransform:"uppercase" }}>Team</label>
                <select value={team} onChange={e => setTeam(e.target.value)} style={{ ...selectStyle, marginTop:3 }}>
                  {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id} — {t.name}</option>)}
                </select>
              </div>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:10, color:"#666", fontWeight:700, textTransform:"uppercase" }}>Format</label>
                <select value={platform} onChange={e => setPlatform(e.target.value)} style={{ ...selectStyle, marginTop:3 }}>
                  {Object.entries(PLATFORMS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
            </div>
            {needsOpp && (
              <div>
                <label style={{ fontSize:10, color:"#666", fontWeight:700, textTransform:"uppercase" }}>Opponent</label>
                <select value={opp} onChange={e => setOpp(e.target.value)} style={{ ...selectStyle, marginTop:3 }}>
                  {TEAMS.filter(t => t.id !== team).map(t => <option key={t.id} value={t.id}>{t.id} — {t.name}</option>)}
                </select>
              </div>
            )}
          </Card>

          {currentTemplate?.fields?.length > 0 && (
            <Card>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <Label>Content</Label>
                {template === "player-stat" && (
                  <div style={{ display:"flex", gap:4 }}>
                    <button onClick={autoFillBatting} style={{ background:"rgba(106,163,56,.15)", border:"1px solid rgba(106,163,56,.3)", color:"#6AA338", borderRadius:5, padding:"3px 8px", fontSize:9, fontWeight:700, cursor:"pointer" }}>Auto Batting</button>
                    <button onClick={autoFillPitching} style={{ background:"rgba(9,114,206,.15)", border:"1px solid rgba(9,114,206,.3)", color:"#0972CE", borderRadius:5, padding:"3px 8px", fontSize:9, fontWeight:700, cursor:"pointer" }}>Auto Pitching</button>
                  </div>
                )}
              </div>
              {currentTemplate.fields.filter(f => f !== "opponent").map(f => (
                <div key={f} style={{ marginBottom:6 }}>
                  <label style={{ fontSize:9, color:"#666", fontWeight:700, textTransform:"uppercase" }}>{f.replace(/([A-Z])/g,' $1').trim()}</label>
                  <input type="text" value={fields[f] || ""} onChange={e => setFields({...fields, [f]: e.target.value})} placeholder={`Enter ${f}...`} style={{ ...inputStyle, marginTop:2 }} />
                </div>
              ))}
            </Card>
          )}

          <GoldButton onClick={download} style={{ width:"100%", padding:"14px 24px", fontSize:14 }}>
            Download PNG ({plat.label}) ⬇
          </GoldButton>
        </div>

        {/* PREVIEW */}
        <div style={{ flex:"1 1 400px", display:"flex", flexDirection:"column", alignItems:"center" }}>
          <Label>Live Preview</Label>
          <div style={{ background:"#1A1A22", borderRadius:12, padding:16, border:"1px solid rgba(255,255,255,.05)", display:"flex", alignItems:"center", justifyContent:"center", width:"100%" }}>
            <canvas ref={canvasRef} style={{ width: plat.w * scale, height: plat.h * scale, borderRadius:8, boxShadow:"0 8px 32px rgba(0,0,0,.5)" }} />
          </div>
          <div style={{ fontSize:10, color:"#555", marginTop:8 }}>
            {plat.w}×{plat.h}px • Click download for full resolution
          </div>
        </div>
      </div>
    </div>
  );
}
