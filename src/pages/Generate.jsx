import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TEAMS, PLATFORMS, BATTING_LEADERS, PITCHING_LEADERS, getTeam, getAllPlayers } from '../data';
import { Card, Label, PageHeader, SectionHeading, RedButton, OutlineButton, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { TEMPLATE_TYPES, FONT_MAP, getFieldConfig } from '../template-config';
import { getOverlays, saveOverlay, deleteOverlay, getEffects, saveEffect, deleteEffect, blobToImage as overlayBlobToImage } from '../overlay-store';
import { findPlayerMedia, findTeamMedia, blobToObjectURL } from '../media-store';
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

// Placeholder text shown in the preview when a field is empty.
// Picked so character width roughly matches expected filled value.
const FIELD_PLACEHOLDERS = {
  playerName:  'PLAYER NAME',
  number:      '00',
  teamName:    'TEAM NAME',
  statLine:    'OPS+ 000 · AVG .XXX · HR 0',
  homeTeam:    'HOME',
  awayTeam:    'AWAY',
  homeRecord:  '0-0',
  awayRecord:  '0-0',
  homeScore:   '0',
  awayScore:   '0',
  result:      'FINAL',
  mvp:         'MVP NAME',
  date:        'SAT · APR 00',
  time:        '0:00 PM',
  venue:       'VENUE',
};

// ─── 4-Layer Custom Compositor ──────────────────────────────────────────────
// options: { hiddenFields: Set<string>, forExport: boolean }
// - hiddenFields: field keys the user has explicitly toggled off → skip entirely
// - forExport: true on the final download render → skip empty fields so preview
//   placeholders don't bake into the exported PNG
function renderCustomTemplate(ctx, w, h, bgImg, overlayImg, fields, fieldConfig, activeEffects = [], team, options = {}) {
  const { hiddenFields, forExport } = options;
  ctx.clearRect(0, 0, w, h);
  const teamColor = team?.color;

  // Layer 1: Background photo (cover crop), or team-colored gradient fallback
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
  } else if (team) {
    // Team-colored gradient empty state (replaces dark gray "Upload a photo" placeholder)
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, team.dark || team.color);
    grad.addColorStop(1, team.color);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else {
    // Final fallback — no team data, solid dark
    ctx.fillStyle = '#1A1A22';
    ctx.fillRect(0, 0, w, h);
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
  //  - Hidden fields (user toggled off) → skip entirely, no placeholder, no output
  //  - Empty fields in PREVIEW → placeholder at 32% opacity so the template
  //    zone layout is visible before inputs are filled
  //  - Empty fields in EXPORT → skip (preview placeholders shouldn't bake in)
  //  - Filled fields → render at full opacity always
  if (fieldConfig) {
    fieldConfig.forEach(f => {
      if (hiddenFields && hiddenFields.has(f.key)) return;
      const value = fields[f.key];
      const hasValue = value && String(value).trim().length > 0;
      if (!hasValue && forExport) return;

      const text = hasValue
        ? String(value).toUpperCase()
        : (FIELD_PLACEHOLDERS[f.key] || String(f.label || f.key).toUpperCase());

      ctx.save();
      ctx.fillStyle = f.color || '#FFFFFF';
      ctx.font = `${f.fontSize}px ${FONT_MAP[f.font] || FONT_MAP.body}`;
      ctx.textAlign = f.align || 'center';
      if (!hasValue) ctx.globalAlpha = 0.32;
      if (f.maxWidth) {
        ctx.fillText(text, f.x, f.y, f.maxWidth);
      } else {
        ctx.fillText(text, f.x, f.y);
      }
      ctx.restore();
    });
  }
}

// ─── Main Generate Component ────────────────────────────────────────────────
export default function Generate() {
  const canvasRef = useRef(null);
  const [searchParams] = useSearchParams();

  // Custom-template state (the only mode — Classic was removed).
  // URL params from dashboard Content-Idea deep links pre-fill these on mount.
  const [customType, setCustomType] = useState(() => {
    const t = searchParams.get('template');
    return (t && TEMPLATE_TYPES[t]) ? t : 'player-stat';
  });
  const [customTeam, setCustomTeam] = useState(() => searchParams.get('team') || 'LAN');
  const [customPlatform, setCustomPlatform] = useState('feed');
  const [customFields, setCustomFields] = useState({});
  // Fields the user has explicitly toggled off — no placeholder in preview, no text in export
  const [hiddenFields, setHiddenFields] = useState(() => new Set());
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

  // Auto-populate Custom mode from URL params — dashboard Content-Idea deep
  // links pass { template, team, playerName, number, statLine, ... }. Template
  // and team are consumed via the useState initializers above; anything else
  // flows into customFields so the template renders with the right copy.
  useEffect(() => {
    const params = {};
    for (const [key, value] of searchParams.entries()) {
      if (key !== 'team' && key !== 'template') params[key] = value;
    }
    if (Object.keys(params).length > 0) {
      setCustomFields(prev => ({ ...prev, ...params }));
    }
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

  // Load media for the selected context: player's media if chosen, otherwise team's
  useEffect(() => {
    const loadContextMedia = async () => {
      let mediaItems = [];
      if (selectedPlayer) {
        const p = allPlayers.find(pl => `${pl.team}_${pl.name}` === selectedPlayer);
        if (p) {
          // Pass first initial to disambiguate when two players on the team
          // share a lastname (e.g. Logan Rose vs Carson Rose). Legacy media
          // records without an initial still surface — see findPlayerMedia.
          const firstInitial = (p.firstName || (p.name || '').split(' ')[0] || '').charAt(0);
          mediaItems = await findPlayerMedia(p.team, p.lastName, { firstInitial });
        }
      } else if (customTeam) {
        // No player selected — show all team media (player-scoped only; team
        // assets have their own surface on the team page).
        mediaItems = await findTeamMedia(customTeam, { scope: 'player' });
      }
      setPlayerMedia(mediaItems);
      setPlayerMediaUrls(mediaItems.map(m => ({
        id: m.id, url: blobToObjectURL(m.blob), name: m.name, assetType: m.assetType, player: m.player,
      })));
    };
    loadContextMedia();
  }, [selectedPlayer, customTeam]);

  // Auto-fill stats when player selected (jersey sourced from media if available)
  useEffect(() => {
    if (!selectedPlayer) return;
    const p = allPlayers.find(pl => `${pl.team}_${pl.name}` === selectedPlayer);
    if (!p) return;
    const batter = BATTING_LEADERS.find(b => b.name === p.name && b.team === p.team);
    const pitcher = PITCHING_LEADERS.find(b => b.name === p.name && b.team === p.team);
    const teamObj = getTeam(p.team);
    // Look up jersey from loaded media
    const mediaJersey = playerMedia.find(m => m.num)?.num || p.num || '';
    const newFields = { playerName: p.name, number: mediaJersey, teamName: teamObj?.name || p.team };
    if (batter) newFields.statLine = `OPS+ ${batter.ops_plus} | AVG ${batter.avg} | HR ${batter.hr} | OBP ${batter.obp}`;
    else if (pitcher) newFields.statLine = `FIP ${pitcher.fip.toFixed(2)} | IP ${pitcher.ip} | W ${pitcher.w} | K/4 ${pitcher.k4}`;
    setCustomFields(prev => ({ ...prev, ...newFields }));
  }, [selectedPlayer, playerMedia]);

  const customPlat = PLATFORMS[customPlatform];
  const scale = Math.min(400 / customPlat.w, 500 / customPlat.h);
  const activeW = customPlat.w;
  const activeH = customPlat.h;

  // ── Render ──
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = customPlat.w; canvas.height = customPlat.h;
    const ctx = canvas.getContext('2d');
    const fieldConfig = getFieldConfig(customType, customPlatform);
    const customTeamObj = getTeam(customTeam);
    renderCustomTemplate(ctx, customPlat.w, customPlat.h, bgImg, overlayImg, customFields, fieldConfig, activeEffects, customTeamObj, { hiddenFields });
  }, [customType, customTeam, customPlatform, customFields, bgImg, overlayImg, customPlat, activeEffects, hiddenFields]);

  useEffect(() => { render(); }, [render]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Re-render without placeholders so the downloaded PNG only contains real
    // text + hidden fields stay hidden. Then re-render for preview afterwards.
    const ctx = canvas.getContext('2d');
    const fieldConfig = getFieldConfig(customType, customPlatform);
    const customTeamObj = getTeam(customTeam);
    renderCustomTemplate(ctx, customPlat.w, customPlat.h, bgImg, overlayImg, customFields, fieldConfig, activeEffects, customTeamObj, { hiddenFields, forExport: true });
    const link = document.createElement('a');
    link.download = `BLW_${customTeam}_${customType}_${customPlatform}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    // Restore preview render (with placeholders) right after export
    render();
  };

  const toggleFieldHidden = (key) => {
    setHiddenFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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

  const customTypeObj = TEMPLATE_TYPES[customType];
  const customFieldConfig = getFieldConfig(customType, customPlatform);
  const filteredOverlays = overlays.filter(o => o.type === customType && (!o.team || o.team === customTeam));

  const labelStyle = { fontSize: 12, color: colors.textSecondary, fontFamily: fonts.body, fontWeight: 600 };

  return (
    <div>
      <PageHeader title="GENERATE" subtitle="Create downloadable graphics for any team — download and schedule via Metricool" />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* CONTROLS */}
        <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Custom templates — the only mode.
              Form flow: Team (sets colors) → Template → Player/Data → Media → Overlay → Effects */}
          <>
              {/* 1. Team & Format — first, so brand colors drive the preview immediately */}
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

              {/* 2. Template Type */}
              <Card>
                <Label>Template Type</Label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
                  {Object.entries(TEMPLATE_TYPES).map(([key, t]) => (
                    <button key={key} onClick={() => { setCustomType(key); setCustomFields({}); setHiddenFields(new Set()); setSelectedOverlayId(null); setOverlayImg(null); }} style={{
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

              {/* 3a. Player Selector (for player-centric templates) */}
              {customTypeObj?.playerCentric && (
                <Card>
                  <Label>Select Player</Label>
                  <select value={selectedPlayer} onChange={e => setSelectedPlayer(e.target.value)} style={{ ...selectStyle }}>
                    <option value="">Choose a player...</option>
                    {filteredPlayers.map(p => (
                      <option key={`${p.team}_${p.name}`} value={`${p.team}_${p.name}`}>
                        {p.name} — {p.team}
                      </option>
                    ))}
                  </select>
                </Card>
              )}

              {/* 3b. Dynamic Content — text fields that overlay the composition.
                  Each field has a hide toggle so you can omit a zone entirely
                  (no placeholder in preview, no text in the exported PNG). */}
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Label style={{ marginBottom: 0 }}>Content</Label>
                  <span style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 0.4 }}>
                    Click 👁 to hide a field
                  </span>
                </div>
                {customFieldConfig.map(f => {
                  const isHidden = hiddenFields.has(f.key);
                  return (
                    <div key={f.key} style={{ marginBottom: 10, opacity: isHidden ? 0.5 : 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                        <label style={labelStyle}>{f.label}</label>
                        <button
                          onClick={() => toggleFieldHidden(f.key)}
                          title={isHidden ? 'Show this field' : 'Hide this field from preview + export'}
                          style={{
                            background: isHidden ? colors.bg : 'transparent',
                            border: `1px solid ${isHidden ? colors.border : 'transparent'}`,
                            borderRadius: radius.sm,
                            padding: '2px 8px', cursor: 'pointer',
                            fontSize: 12, lineHeight: 1,
                            color: isHidden ? colors.textMuted : colors.textSecondary,
                            fontFamily: fonts.body, fontWeight: 600,
                          }}
                        >
                          {isHidden ? '🚫 Hidden' : '👁'}
                        </button>
                      </div>
                      <input
                        type="text"
                        value={customFields[f.key] || ''}
                        onChange={e => setCustomFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={isHidden ? '(field hidden — click 🚫 to show)' : `Enter ${f.label.toLowerCase()}...`}
                        disabled={isHidden}
                        style={{ ...inputStyle, marginTop: 0 }}
                      />
                    </div>
                  );
                })}
              </Card>

              {/* 4. Select Media — was Background Photo */}
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Label style={{ marginBottom: 0 }}>Select Media</Label>
                  <label style={{
                    background: colors.redLight, border: `1px solid ${colors.redBorder}`,
                    color: colors.red, borderRadius: radius.sm, padding: '3px 10px',
                    fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                  }}>
                    <input type="file" accept="image/*,video/*" onChange={handleBgFileInput} style={{ display: 'none' }} />
                    + Upload New
                  </label>
                </div>

                {/* Current selection preview */}
                {bgUrl && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{
                      width: '100%', height: 120, borderRadius: radius.base,
                      background: `url(${bgUrl}) center/cover`,
                      border: `1px solid ${colors.border}`,
                    }} />
                    <button onClick={() => { setBgImg(null); setBgUrl(null); }} style={{
                      background: 'none', border: 'none', color: colors.red, fontSize: 11,
                      fontFamily: fonts.condensed, fontWeight: 700, cursor: 'pointer', marginTop: 4,
                    }}>✕ Clear selection</button>
                  </div>
                )}

                {/* Media grid — contextual: player's media if selected, else team's */}
                {playerMediaUrls.length > 0 ? (
                  <>
                    <div style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 600, color: colors.textMuted, letterSpacing: 0.8, marginBottom: 6 }}>
                      {selectedPlayer ? `PLAYER MEDIA · ${playerMediaUrls.length}` : `TEAM MEDIA · ${playerMediaUrls.length}`}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                      {playerMediaUrls.map(m => (
                        <div
                          key={m.id}
                          onClick={() => selectPlayerMediaAsBg(m.url)}
                          title={m.name}
                          style={{
                            width: '100%', aspectRatio: '1 / 1', borderRadius: radius.base, cursor: 'pointer',
                            background: `url(${m.url}) center/cover`,
                            border: bgUrl === m.url ? `2px solid ${colors.red}` : `1px solid ${colors.border}`,
                            position: 'relative',
                          }}
                        >
                          <div style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
                            padding: '2px 4px',
                            borderRadius: `0 0 ${radius.base}px ${radius.base}px`,
                            fontSize: 8, color: '#fff', fontFamily: fonts.condensed, fontWeight: 700,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {m.assetType || ''}{m.player ? ` · ${m.player}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div onDrop={handleBgDrop} onDragOver={e => e.preventDefault()} style={{
                    border: `2px dashed ${colors.border}`, borderRadius: radius.base,
                    padding: 24, textAlign: 'center', background: colors.bg,
                  }}>
                    <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.condensed }}>
                      {selectedPlayer
                        ? 'No media for this player yet'
                        : customTeam ? 'No media uploaded for this team yet' : 'Select a team or player'}
                    </div>
                    <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 4, fontFamily: fonts.condensed }}>
                      Upload files in the Files page or drop one here
                    </div>
                  </div>
                )}
              </Card>

              {/* Overlay Picker — moved below Select Media */}
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

          </>

          <RedButton onClick={download} style={{ width: '100%', padding: '14px 24px', fontSize: 14 }}>
            Download PNG ({customPlat.label})
          </RedButton>
        </div>

        {/* PREVIEW — canvas + Effects panel directly below so slider changes
            are visible without scrolling */}
        <div style={{ flex: '1 1 400px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Label>Live Preview</Label>
          <div style={{
            background: '#1A1A22', borderRadius: radius.lg, padding: 16,
            border: `1px solid ${colors.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%',
            boxSizing: 'border-box',
          }}>
            <canvas ref={canvasRef} style={{
              width: activeW * scale, height: activeH * scale,
              borderRadius: radius.base, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }} />
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, textAlign: 'center' }}>
            {activeW}x{activeH}px — Click download for full resolution
          </div>

          {/* Effects Layer — lives under the preview so slider changes are visible live */}
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
        </div>
      </div>

      {/* UPLOAD OVERLAY MODAL */}
      {showUploadModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: colors.white, borderRadius: radius.lg, padding: 24, maxWidth: 480, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <SectionHeading style={{ margin: 0 }}>Upload overlay</SectionHeading>
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
              <SectionHeading style={{ margin: 0 }}>Upload effect</SectionHeading>
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
