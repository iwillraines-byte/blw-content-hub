import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TEAMS, PLATFORMS, TEMPLATES, BATTING_LEADERS, PITCHING_LEADERS, getTeam, getAllPlayers } from '../data';
import { Card, Label, PageHeader, SectionHeading, RedButton, OutlineButton, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { TEMPLATE_TYPES, FONT_MAP, getFieldConfig } from '../template-config';
import { getOverlays, saveOverlay, deleteOverlay, getEffects, saveEffect, deleteEffect, blobToImage as overlayBlobToImage } from '../overlay-store';
import { findPlayerMedia, blobToObjectURL } from '../media-store';
import { BUILT_IN_EFFECTS, getBuiltInEffect } from '../effects-config';

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

// ─── 4-Layer Custom Compositor ──────────────────────────────────────────────
function renderCustomTemplate(ctx, w, h, bgImg, overlayImg, fields, fieldConfig, activeEffects = [], teamColor) {
  ctx.clearRect(0, 0, w, h);

  // Layer 1: Background photo (cover crop)
  if (bgImg) {
    const imgRatio = bgImg.width / bgImg.height;
    const canvasRatio = w / h;
    let sx = 0, sy = 0, sw = bgImg.width, sh = bgImg.height;
    if (imgRatio > canvasRatio) {
      sw = bgImg.height * canvasRatio;
      sx = (bgImg.width - sw) / 2;
    } else {
      sh = bgImg.width / canvasRatio;
      sy = (bgImg.height - sh) / 2;
    }
    ctx.drawImage(bgImg, sx, sy, sw, sh, 0, 0, w, h);
  } else {
    ctx.fillStyle = '#1A1A22';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.font = `24px ${FONT_MAP.heading}`;
    ctx.textAlign = 'center';
    ctx.fillText('Upload a background photo', w / 2, h / 2);
  }

  // Layer 2: Overlay template PNG
  if (overlayImg) {
    ctx.drawImage(overlayImg, 0, 0, w, h);
  }

  // Layer 3: Effects (built-in + uploaded)
  activeEffects.forEach(effect => {
    if (effect.opacity <= 0) return;
    if (effect.type === 'builtin' && effect.builtin) {
      effect.builtin.render(ctx, w, h, effect.opacity, teamColor);
    } else if (effect.type === 'upload' && effect.image) {
      ctx.save();
      ctx.globalAlpha = effect.opacity;
      ctx.drawImage(effect.image, 0, 0, w, h);
      ctx.restore();
    }
  });

  // Layer 4: Dynamic text fields
  if (fieldConfig) {
    fieldConfig.forEach(f => {
      const value = fields[f.key];
      if (!value) return;
      ctx.fillStyle = f.color || '#FFFFFF';
      ctx.font = `${f.fontSize}px ${FONT_MAP[f.font] || FONT_MAP.body}`;
      ctx.textAlign = f.align || 'center';
      if (f.maxWidth) {
        ctx.fillText(value.toUpperCase(), f.x, f.y, f.maxWidth);
      } else {
        ctx.fillText(value.toUpperCase(), f.x, f.y);
      }
    });
  }
}

// ─── Main Generate Component ────────────────────────────────────────────────
export default function Generate() {
  const canvasRef = useRef(null);
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState('custom'); // 'classic' or 'custom'

  // ── Classic mode state ──
  const [team, setTeam] = useState(searchParams.get('team') || 'LAN');
  const [opp, setOpp] = useState('AZS');
  const [template, setTemplate] = useState(searchParams.get('template') || 'gameday');
  const [platform, setPlatform] = useState('feed');
  const [fields, setFields] = useState({});

  // ── Custom mode state ──
  const [customType, setCustomType] = useState('player-stat');
  const [customTeam, setCustomTeam] = useState('LAN');
  const [customPlatform, setCustomPlatform] = useState('feed');
  const [customFields, setCustomFields] = useState({});
  const [overlays, setOverlays] = useState([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState(null);
  const [overlayImg, setOverlayImg] = useState(null);
  const [bgImg, setBgImg] = useState(null);
  const [bgUrl, setBgUrl] = useState(null);
  const [playerMedia, setPlayerMedia] = useState([]);
  const [playerMediaUrls, setPlayerMediaUrls] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadPreview, setUploadPreview] = useState(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadType, setUploadType] = useState('player-stat');
  const [uploadTeam, setUploadTeam] = useState('');
  const [uploadPlatform, setUploadPlatform] = useState('feed');

  // Effects state
  const [activeEffects, setActiveEffects] = useState([]); // [{ id, type: 'builtin'|'upload', opacity, builtin?, image? }]
  const [uploadedEffects, setUploadedEffects] = useState([]); // from IndexedDB
  const [showEffectUpload, setShowEffectUpload] = useState(false);
  const [effectFile, setEffectFile] = useState(null);
  const [effectName, setEffectName] = useState('');

  const allPlayers = getAllPlayers();
  const filteredPlayers = customTeam === 'ALL' ? allPlayers : allPlayers.filter(p => p.team === customTeam);

  // Auto-populate classic mode from URL params
  useEffect(() => {
    const params = {};
    for (const [key, value] of searchParams.entries()) {
      if (key !== 'team' && key !== 'template') params[key] = value;
    }
    if (Object.keys(params).length > 0) setFields(params);
  }, []);

  // Load overlays from IndexedDB
  useEffect(() => { getOverlays().then(setOverlays); }, []);
  useEffect(() => { getEffects().then(setUploadedEffects); }, []);

  // Load selected overlay image
  useEffect(() => {
    if (!selectedOverlayId) { setOverlayImg(null); return; }
    const ov = overlays.find(o => o.id === selectedOverlayId);
    if (ov?.imageBlob) {
      overlayBlobToImage(ov.imageBlob).then(setOverlayImg);
    }
  }, [selectedOverlayId, overlays]);

  // Player media matching
  useEffect(() => {
    if (!selectedPlayer) { setPlayerMedia([]); setPlayerMediaUrls([]); return; }
    const p = allPlayers.find(pl => `${pl.team}_${pl.num}_${pl.name}` === selectedPlayer);
    if (!p) return;
    findPlayerMedia(p.team, p.lastName, p.num).then(media => {
      setPlayerMedia(media);
      setPlayerMediaUrls(media.map(m => ({ id: m.id, url: blobToObjectURL(m.blob), name: m.name })));
    });
  }, [selectedPlayer]);

  // Auto-fill stats when player selected
  useEffect(() => {
    if (!selectedPlayer) return;
    const p = allPlayers.find(pl => `${pl.team}_${pl.num}_${pl.name}` === selectedPlayer);
    if (!p) return;
    const batter = BATTING_LEADERS.find(b => b.name === p.name && b.team === p.team);
    const pitcher = PITCHING_LEADERS.find(b => b.name === p.name && b.team === p.team);
    const teamObj = getTeam(p.team);
    const newFields = { playerName: p.name, number: p.num, teamName: teamObj?.name || p.team };
    if (batter) newFields.statLine = `OPS+ ${batter.ops_plus} | AVG ${batter.avg} | HR ${batter.hr} | OBP ${batter.obp}`;
    else if (pitcher) newFields.statLine = `FIP ${pitcher.fip.toFixed(2)} | IP ${pitcher.ip} | W ${pitcher.w} | K/4 ${pitcher.k4}`;
    setCustomFields(prev => ({ ...prev, ...newFields }));
  }, [selectedPlayer]);

  const teamObj = getTeam(team);
  const plat = PLATFORMS[platform];
  const customPlat = PLATFORMS[customPlatform];
  const scale = mode === 'classic'
    ? Math.min(400 / plat.w, 500 / plat.h)
    : Math.min(400 / customPlat.w, 500 / customPlat.h);
  const activeW = mode === 'classic' ? plat.w : customPlat.w;
  const activeH = mode === 'classic' ? plat.h : customPlat.h;

  // ── Render ──
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (mode === 'classic') {
      if (!teamObj) return;
      canvas.width = plat.w; canvas.height = plat.h;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, plat.w, plat.h);
      switch (template) {
        case 'gameday': renderGameDay(ctx, plat.w, plat.h, teamObj, opp, fields); break;
        case 'player-stat': renderPlayerStat(ctx, plat.w, plat.h, teamObj, fields); break;
        case 'score': renderFinalScore(ctx, plat.w, plat.h, teamObj, opp, fields); break;
        case 'batting-leaders': renderLeaderboard(ctx, plat.w, plat.h, 'batting'); break;
        case 'pitching-leaders': renderLeaderboard(ctx, plat.w, plat.h, 'pitching'); break;
        case 'standings': renderStandings(ctx, plat.w, plat.h); break;
      }
    } else {
      canvas.width = customPlat.w; canvas.height = customPlat.h;
      const ctx = canvas.getContext('2d');
      const fieldConfig = getFieldConfig(customType, customPlatform);
      const customTeamObj = getTeam(customTeam);
      renderCustomTemplate(ctx, customPlat.w, customPlat.h, bgImg, overlayImg, customFields, fieldConfig, activeEffects, customTeamObj?.color);
    }
  }, [mode, team, opp, template, platform, fields, teamObj, plat, customType, customTeam, customPlatform, customFields, bgImg, overlayImg, customPlat, activeEffects]);

  useEffect(() => { render(); }, [render]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    const prefix = mode === 'classic' ? `BLW_${team}_${template}_${platform}` : `BLW_${customTeam}_${customType}_${customPlatform}`;
    link.download = `${prefix}.png`;
    link.href = canvas.toDataURL('image/png');
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

  const handleBgDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setBgUrl(url);
    const img = new Image();
    img.onload = () => setBgImg(img);
    img.src = url;
  }, []);

  const handleBgFileInput = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setBgUrl(url);
    const img = new Image();
    img.onload = () => setBgImg(img);
    img.src = url;
    e.target.value = '';
  }, []);

  const selectPlayerMediaAsBg = useCallback((mediaUrl) => {
    setBgUrl(mediaUrl);
    const img = new Image();
    img.onload = () => setBgImg(img);
    img.src = mediaUrl;
  }, []);

  // Overlay upload
  const handleOverlayFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadFile(file);
    setUploadPreview(URL.createObjectURL(file));
    if (!uploadName) setUploadName(file.name.replace(/\.[^.]+$/, ''));
  };

  const submitOverlay = async () => {
    if (!uploadFile) return;
    const record = await saveOverlay({
      name: uploadName || uploadFile.name,
      type: uploadType,
      team: uploadTeam || null,
      platform: uploadPlatform,
      imageBlob: uploadFile,
      width: 0, height: 0,
    });
    setOverlays(prev => [...prev, record]);
    setShowUploadModal(false);
    setUploadFile(null); setUploadPreview(null); setUploadName('');
    setSelectedOverlayId(record.id);
  };

  const handleDeleteOverlay = async (id) => {
    await deleteOverlay(id);
    setOverlays(prev => prev.filter(o => o.id !== id));
    if (selectedOverlayId === id) { setSelectedOverlayId(null); setOverlayImg(null); }
  };

  // ── Effects management ──
  const toggleBuiltInEffect = (effectId) => {
    const existing = activeEffects.find(e => e.type === 'builtin' && e.id === effectId);
    if (existing) {
      setActiveEffects(prev => prev.filter(e => !(e.type === 'builtin' && e.id === effectId)));
    } else {
      const builtin = getBuiltInEffect(effectId);
      setActiveEffects(prev => [...prev, { id: effectId, type: 'builtin', opacity: 0.5, builtin }]);
    }
  };

  const toggleUploadedEffect = async (effect) => {
    const existing = activeEffects.find(e => e.type === 'upload' && e.id === effect.id);
    if (existing) {
      setActiveEffects(prev => prev.filter(e => !(e.type === 'upload' && e.id === effect.id)));
    } else {
      const image = await overlayBlobToImage(effect.imageBlob);
      setActiveEffects(prev => [...prev, { id: effect.id, type: 'upload', opacity: 0.5, image, name: effect.name }]);
    }
  };

  const setEffectOpacity = (matchKey, opacity) => {
    setActiveEffects(prev => prev.map(e =>
      (e.type === matchKey.type && e.id === matchKey.id) ? { ...e, opacity } : e
    ));
  };

  const handleEffectFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEffectFile(file);
    if (!effectName) setEffectName(file.name.replace(/\.[^.]+$/, ''));
  };

  const submitEffect = async () => {
    if (!effectFile) return;
    const record = await saveEffect({ name: effectName || effectFile.name, imageBlob: effectFile, width: 0, height: 0 });
    setUploadedEffects(prev => [...prev, record]);
    setShowEffectUpload(false);
    setEffectFile(null);
    setEffectName('');
  };

  const handleDeleteEffect = async (id) => {
    await deleteEffect(id);
    setUploadedEffects(prev => prev.filter(e => e.id !== id));
    setActiveEffects(prev => prev.filter(e => !(e.type === 'upload' && e.id === id)));
  };

  const isEffectActive = (type, id) => !!activeEffects.find(e => e.type === type && e.id === id);
  const getEffectOpacity = (type, id) => activeEffects.find(e => e.type === type && e.id === id)?.opacity ?? 0.5;

  const currentTemplate = TEMPLATES.find(t => t.id === template);
  const needsOpp = template === 'gameday' || template === 'score';
  const customTypeObj = TEMPLATE_TYPES[customType];
  const customFieldConfig = getFieldConfig(customType, customPlatform);
  const filteredOverlays = overlays.filter(o => o.type === customType && (!o.team || o.team === customTeam));

  const labelStyle = { fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, fontWeight: 600, textTransform: 'uppercase' };
  const modeTabStyle = (active) => ({
    flex: 1, padding: '10px 16px', textAlign: 'center', cursor: 'pointer',
    fontFamily: fonts.heading, fontSize: 16, letterSpacing: 1.5,
    background: active ? colors.red : colors.white,
    color: active ? '#fff' : colors.textSecondary,
    border: active ? `1px solid ${colors.red}` : `1px solid ${colors.border}`,
    borderRadius: radius.base,
  });

  return (
    <div>
      <PageHeader title="GENERATE" subtitle="Create downloadable graphics for any team — download and schedule via Metricool" />

      {/* Mode Toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button onClick={() => setMode('custom')} style={modeTabStyle(mode === 'custom')}>CUSTOM TEMPLATES</button>
        <button onClick={() => setMode('classic')} style={modeTabStyle(mode === 'classic')}>CLASSIC</button>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* CONTROLS */}
        <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {mode === 'custom' ? (
            <>
              {/* Template Type */}
              <Card>
                <Label>Template Type</Label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
                  {Object.entries(TEMPLATE_TYPES).map(([key, t]) => (
                    <button key={key} onClick={() => { setCustomType(key); setCustomFields({}); setSelectedOverlayId(null); setOverlayImg(null); }} style={{
                      background: customType === key ? colors.redLight : colors.bg,
                      border: customType === key ? `1px solid ${colors.red}` : `1px solid ${colors.border}`,
                      color: customType === key ? colors.red : colors.textSecondary,
                      borderRadius: radius.base, padding: '8px 4px', cursor: 'pointer',
                      fontFamily: fonts.body, fontSize: 9, fontWeight: 700, textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 16 }}>{t.icon}</div>{t.name}
                    </button>
                  ))}
                </div>
              </Card>

              {/* Team & Format */}
              <Card>
                <Label>Team & Format</Label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Team</label>
                    <select value={customTeam} onChange={e => setCustomTeam(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
                      {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id} — {t.name}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Format</label>
                    <select value={customPlatform} onChange={e => setCustomPlatform(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
                      {Object.entries(PLATFORMS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                </div>
              </Card>

              {/* Player Selector (for player-centric templates) */}
              {customTypeObj?.playerCentric && (
                <Card>
                  <Label>Select Player</Label>
                  <select value={selectedPlayer} onChange={e => setSelectedPlayer(e.target.value)} style={{ ...selectStyle, marginBottom: 8 }}>
                    <option value="">Choose a player...</option>
                    {filteredPlayers.map(p => (
                      <option key={`${p.team}_${p.num}_${p.name}`} value={`${p.team}_${p.num}_${p.name}`}>
                        {p.name} (#{p.num}) — {p.team}
                      </option>
                    ))}
                  </select>
                  {/* Player media suggestions */}
                  {playerMediaUrls.length > 0 && (
                    <div>
                      <label style={{ ...labelStyle, marginTop: 8, display: 'block' }}>Matched Media — click to use as background</label>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                        {playerMediaUrls.map(m => (
                          <div key={m.id} onClick={() => selectPlayerMediaAsBg(m.url)} style={{
                            width: 70, height: 70, borderRadius: radius.base, cursor: 'pointer',
                            background: `url(${m.url}) center/cover`,
                            border: bgUrl === m.url ? `2px solid ${colors.red}` : `1px solid ${colors.border}`,
                          }} title={m.name} />
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedPlayer && playerMediaUrls.length === 0 && (
                    <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 6 }}>
                      No media found — upload photos on the Files page using naming convention
                    </div>
                  )}
                </Card>
              )}

              {/* Overlay Picker */}
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Label style={{ marginBottom: 0 }}>Overlay Template</Label>
                  <button onClick={() => setShowUploadModal(true)} style={{
                    background: colors.redLight, border: `1px solid ${colors.redBorder}`,
                    color: colors.red, borderRadius: radius.sm, padding: '3px 10px',
                    fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                  }}>+ Upload Overlay</button>
                </div>
                {filteredOverlays.length === 0 ? (
                  <div style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', padding: 20 }}>
                    No overlays uploaded for this type/team yet.
                    <br />Upload a PNG with transparency to get started.
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {filteredOverlays.map(o => (
                      <div key={o.id} style={{ position: 'relative' }}>
                        <div onClick={() => setSelectedOverlayId(o.id === selectedOverlayId ? null : o.id)} style={{
                          width: 80, height: 80, borderRadius: radius.base, cursor: 'pointer',
                          background: '#1A1A22', border: selectedOverlayId === o.id ? `2px solid ${colors.red}` : `1px solid ${colors.border}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9, fontFamily: fonts.condensed, color: colors.textMuted, textAlign: 'center', padding: 4,
                        }}>
                          {o.name}
                        </div>
                        <button onClick={() => handleDeleteOverlay(o.id)} style={{
                          position: 'absolute', top: -4, right: -4, width: 16, height: 16,
                          borderRadius: '50%', background: '#EF4444', color: '#fff',
                          border: 'none', fontSize: 8, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Background Photo */}
              <Card>
                <Label>Background Photo</Label>
                <label style={{ cursor: 'pointer' }}>
                  <input type="file" accept="image/*" onChange={handleBgFileInput} style={{ display: 'none' }} />
                  <div onDrop={handleBgDrop} onDragOver={e => e.preventDefault()} style={{
                    border: `2px dashed ${colors.border}`, borderRadius: radius.base,
                    padding: bgUrl ? 0 : 24, textAlign: 'center', overflow: 'hidden',
                    background: bgUrl ? 'transparent' : colors.bg, height: bgUrl ? 120 : 'auto',
                  }}>
                    {bgUrl ? (
                      <div style={{ width: '100%', height: '100%', background: `url(${bgUrl}) center/cover`, borderRadius: radius.base }} />
                    ) : (
                      <>
                        <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.condensed }}>
                          Drag & drop a photo or click to browse
                        </div>
                      </>
                    )}
                  </div>
                </label>
                {bgUrl && (
                  <button onClick={() => { setBgImg(null); setBgUrl(null); }} style={{
                    background: 'none', border: 'none', color: colors.red, fontSize: 11,
                    fontFamily: fonts.condensed, fontWeight: 700, cursor: 'pointer', marginTop: 4,
                  }}>Remove background</button>
                )}
              </Card>

              {/* Effects Layer */}
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Label style={{ marginBottom: 0 }}>Effects</Label>
                  <button onClick={() => setShowEffectUpload(true)} style={{
                    background: colors.redLight, border: `1px solid ${colors.redBorder}`,
                    color: colors.red, borderRadius: radius.sm, padding: '3px 10px',
                    fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                  }}>+ Upload Effect</button>
                </div>

                {/* Built-in effect thumbnails */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  {BUILT_IN_EFFECTS.map(fx => {
                    const active = isEffectActive('builtin', fx.id);
                    return (
                      <button key={fx.id} onClick={() => toggleBuiltInEffect(fx.id)} style={{
                        background: active ? colors.redLight : colors.bg,
                        border: active ? `1px solid ${colors.red}` : `1px solid ${colors.border}`,
                        borderRadius: radius.sm, padding: '6px 8px', cursor: 'pointer',
                        fontFamily: fonts.body, fontSize: 10, fontWeight: 700,
                        color: active ? colors.red : colors.textSecondary,
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        minWidth: 62,
                      }}>
                        <span style={{ fontSize: 14 }}>{fx.icon}</span>
                        <span style={{ marginTop: 2 }}>{fx.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Uploaded effect thumbnails */}
                {uploadedEffects.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    {uploadedEffects.map(fx => {
                      const active = isEffectActive('upload', fx.id);
                      return (
                        <div key={fx.id} style={{ position: 'relative' }}>
                          <button onClick={() => toggleUploadedEffect(fx)} style={{
                            background: active ? colors.redLight : colors.bg,
                            border: active ? `1px solid ${colors.red}` : `1px solid ${colors.border}`,
                            borderRadius: radius.sm, padding: '6px 8px', cursor: 'pointer',
                            fontFamily: fonts.body, fontSize: 10, fontWeight: 700,
                            color: active ? colors.red : colors.textSecondary,
                            minWidth: 62, maxWidth: 100,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            ◊ {fx.name}
                          </button>
                          <button onClick={() => handleDeleteEffect(fx.id)} style={{
                            position: 'absolute', top: -4, right: -4, width: 14, height: 14,
                            borderRadius: '50%', background: '#EF4444', color: '#fff',
                            border: 'none', fontSize: 8, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Opacity sliders for active effects */}
                {activeEffects.length > 0 && (
                  <div style={{ marginTop: 6, paddingTop: 10, borderTop: `1px solid ${colors.divider}` }}>
                    {activeEffects.map(fx => {
                      const label = fx.type === 'builtin' ? fx.builtin?.label : fx.name;
                      return (
                        <div key={`${fx.type}-${fx.id}`} style={{ marginBottom: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                            <span style={{ ...labelStyle, textTransform: 'none', fontWeight: 700 }}>{label}</span>
                            <span style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.red, fontWeight: 700 }}>
                              {Math.round(fx.opacity * 100)}%
                            </span>
                          </div>
                          <input
                            type="range" min={0} max={1} step={0.01}
                            value={fx.opacity}
                            onChange={e => setEffectOpacity({ type: fx.type, id: fx.id }, parseFloat(e.target.value))}
                            style={{ width: '100%', accentColor: colors.red }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {activeEffects.length === 0 && (
                  <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, fontStyle: 'italic' }}>
                    Click effects above to stack them. Use sliders to control intensity.
                  </div>
                )}
              </Card>

              {/* Dynamic Fields */}
              <Card>
                <Label>Dynamic Content</Label>
                {customFieldConfig.map(f => (
                  <div key={f.key} style={{ marginBottom: 8 }}>
                    <label style={labelStyle}>{f.label}</label>
                    <input type="text" value={customFields[f.key] || ''} onChange={e => setCustomFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={`Enter ${f.label.toLowerCase()}...`} style={{ ...inputStyle, marginTop: 3 }} />
                  </div>
                ))}
              </Card>
            </>
          ) : (
            <>
              {/* CLASSIC MODE — existing UI */}
              <Card>
                <Label>Template</Label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  {TEMPLATES.map(t => (
                    <button key={t.id} onClick={() => { setTemplate(t.id); setFields({}); }} style={{
                      background: template === t.id ? colors.redLight : colors.bg,
                      border: template === t.id ? `1px solid ${colors.red}` : `1px solid ${colors.border}`,
                      color: template === t.id ? colors.red : colors.textSecondary,
                      borderRadius: radius.base, padding: '10px 4px', cursor: 'pointer',
                      fontFamily: fonts.body, fontSize: 10, fontWeight: 700, textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 18 }}>{t.icon}</div>{t.name}
                    </button>
                  ))}
                </div>
              </Card>
              <Card>
                <Label>Team & Format</Label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Team</label>
                    <select value={team} onChange={e => setTeam(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
                      {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id} — {t.name}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Format</label>
                    <select value={platform} onChange={e => setPlatform(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
                      {Object.entries(PLATFORMS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                </div>
                {needsOpp && (
                  <div>
                    <label style={labelStyle}>Opponent</label>
                    <select value={opp} onChange={e => setOpp(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
                      {TEAMS.filter(t => t.id !== team).map(t => <option key={t.id} value={t.id}>{t.id} — {t.name}</option>)}
                    </select>
                  </div>
                )}
              </Card>
              {currentTemplate?.fields?.length > 0 && (
                <Card>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <Label style={{ marginBottom: 0 }}>Content</Label>
                    {template === 'player-stat' && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={autoFillBatting} style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#16A34A', borderRadius: radius.sm, padding: '3px 8px', fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>Auto Batting</button>
                        <button onClick={autoFillPitching} style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: '#2563EB', borderRadius: radius.sm, padding: '3px 8px', fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>Auto Pitching</button>
                      </div>
                    )}
                  </div>
                  {currentTemplate.fields.filter(f => f !== 'opponent').map(f => (
                    <div key={f} style={{ marginBottom: 8 }}>
                      <label style={labelStyle}>{f.replace(/([A-Z])/g, ' $1').trim()}</label>
                      <input type="text" value={fields[f] || ''} onChange={e => setFields({ ...fields, [f]: e.target.value })}
                        placeholder={`Enter ${f}...`} style={{ ...inputStyle, marginTop: 3 }} />
                    </div>
                  ))}
                </Card>
              )}
            </>
          )}

          <RedButton onClick={download} style={{ width: '100%', padding: '14px 24px', fontSize: 14 }}>
            Download PNG ({mode === 'classic' ? plat.label : customPlat.label})
          </RedButton>
        </div>

        {/* PREVIEW */}
        <div style={{ flex: '1 1 400px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Label>Live Preview</Label>
          <div style={{
            background: '#1A1A22', borderRadius: radius.lg, padding: 16,
            border: `1px solid ${colors.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%',
          }}>
            <canvas ref={canvasRef} style={{
              width: activeW * scale, height: activeH * scale,
              borderRadius: radius.base, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }} />
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 8, fontFamily: fonts.condensed }}>
            {activeW}x{activeH}px — Click download for full resolution
          </div>
        </div>
      </div>

      {/* UPLOAD OVERLAY MODAL */}
      {showUploadModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: colors.white, borderRadius: radius.lg, padding: 24, maxWidth: 480, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <SectionHeading style={{ margin: 0 }}>UPLOAD OVERLAY</SectionHeading>
              <button onClick={() => { setShowUploadModal(false); setUploadFile(null); setUploadPreview(null); }} style={{
                background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: colors.textMuted,
              }}>✕</button>
            </div>

            <label style={{ cursor: 'pointer', display: 'block', marginBottom: 16 }}>
              <input type="file" accept="image/png" onChange={handleOverlayFile} style={{ display: 'none' }} />
              <div style={{
                border: `2px dashed ${colors.border}`, borderRadius: radius.base,
                padding: uploadPreview ? 0 : 30, textAlign: 'center',
                background: colors.bg, overflow: 'hidden', height: uploadPreview ? 160 : 'auto',
              }}>
                {uploadPreview ? (
                  <div style={{ width: '100%', height: '100%', background: `url(${uploadPreview}) center/contain no-repeat`, backgroundColor: '#1A1A22' }} />
                ) : (
                  <div style={{ fontSize: 12, color: colors.textMuted }}>Click to select a PNG with transparency</div>
                )}
              </div>
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={labelStyle}>Overlay Name</label>
                <input type="text" value={uploadName} onChange={e => setUploadName(e.target.value)}
                  placeholder="e.g. DAL Game Day Feed v1" style={{ ...inputStyle, marginTop: 3 }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Template Type</label>
                  <select value={uploadType} onChange={e => setUploadType(e.target.value)} style={{ ...selectStyle, marginTop: 3 }}>
                    {Object.entries(TEMPLATE_TYPES).map(([k, t]) => <option key={k} value={k}>{t.icon} {t.name}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Platform</label>
                  <select value={uploadPlatform} onChange={e => setUploadPlatform(e.target.value)} style={{ ...selectStyle, marginTop: 3 }}>
                    {Object.entries(PLATFORMS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Team (or leave blank for Universal)</label>
                <select value={uploadTeam} onChange={e => setUploadTeam(e.target.value)} style={{ ...selectStyle, marginTop: 3 }}>
                  <option value="">Universal (all teams)</option>
                  {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id} — {t.name}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <RedButton onClick={submitOverlay} disabled={!uploadFile} style={{ flex: 1 }}>Save Overlay</RedButton>
              <OutlineButton onClick={() => { setShowUploadModal(false); setUploadFile(null); setUploadPreview(null); }}>Cancel</OutlineButton>
            </div>
          </div>
        </div>
      )}

      {/* UPLOAD EFFECT MODAL */}
      {showEffectUpload && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: colors.white, borderRadius: radius.lg, padding: 24, maxWidth: 420, width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <SectionHeading style={{ margin: 0 }}>UPLOAD EFFECT</SectionHeading>
              <button onClick={() => { setShowEffectUpload(false); setEffectFile(null); setEffectName(''); }} style={{
                background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: colors.textMuted,
              }}>✕</button>
            </div>

            <label style={{ cursor: 'pointer', display: 'block', marginBottom: 16 }}>
              <input type="file" accept="image/png" onChange={handleEffectFile} style={{ display: 'none' }} />
              <div style={{
                border: `2px dashed ${colors.border}`, borderRadius: radius.base,
                padding: 24, textAlign: 'center', background: colors.bg,
              }}>
                <div style={{ fontSize: 12, color: colors.textMuted }}>
                  {effectFile ? effectFile.name : 'Click to select a PNG with transparency'}
                </div>
                <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 4, fontFamily: fonts.condensed }}>
                  (Grain textures, light leaks, gradient overlays, etc.)
                </div>
              </div>
            </label>

            <div>
              <label style={labelStyle}>Effect Name</label>
              <input type="text" value={effectName} onChange={e => setEffectName(e.target.value)}
                placeholder="e.g. Warm Grain" style={{ ...inputStyle, marginTop: 3 }} />
            </div>

            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <RedButton onClick={submitEffect} disabled={!effectFile} style={{ flex: 1 }}>Save Effect</RedButton>
              <OutlineButton onClick={() => { setShowEffectUpload(false); setEffectFile(null); setEffectName(''); }}>Cancel</OutlineButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
