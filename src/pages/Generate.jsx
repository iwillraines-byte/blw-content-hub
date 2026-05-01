import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TEAMS, PLATFORMS, BATTING_LEADERS, PITCHING_LEADERS, getTeam, getAllPlayers, fetchAllData } from '../data';
import { Card, CollapsibleCard, Label, PageHeader, SectionHeading, RedButton, OutlineButton, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { TeamThemeScope } from '../team-theme';
import { TEMPLATE_TYPES, FONT_MAP, getFieldConfig } from '../template-config';
import { getOverlays, saveOverlay, deleteOverlay, getEffects, saveEffect, deleteEffect, blobToImage as overlayBlobToImage } from '../overlay-store';
import { findPlayerMedia, findTeamMedia, blobToObjectURL } from '../media-store';
import { BUILT_IN_EFFECTS, getBuiltInEffect } from '../effects-config';
import { getPresetOverlays, loadPresetImage } from '../preset-overlays';
import { applyOverrides, setFieldOverride, getOverrides, resetOverrides } from '../field-overrides-store';
import { useToast } from '../toast';
import { cloud } from '../cloud-sync';
import { refreshOverlaysFromCloud } from '../cloud-reader';
import { readStashedIdea } from '../idea-context-store';
import { extractIdeaFromNote, getRequests } from '../requests-store';
import { TemplatePreview } from '../template-preview';
import { useAuth, isAthleteRole } from '../auth';
import { localFontsReady } from '../local-fonts';

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

// Draggable field-position editor overlaid on the preview canvas. Renders
// a small chip for each field at its current (x,y); drag chips to reposition.
// Chip positions are in PREVIEW pixels; final x/y are translated back to
// NATIVE canvas pixels via the `scale` factor on drag end.
function DragOverlay({ fields, hiddenFields, customFields, canvasW, canvasH, scale, onDragEnd }) {
  const [dragging, setDragging] = useState(null); // { key, startX, startY, x0, y0 }
  const [liveDelta, setLiveDelta] = useState({ dx: 0, dy: 0 });

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      setLiveDelta({
        dx: (e.clientX - dragging.startX) / scale,
        dy: (e.clientY - dragging.startY) / scale,
      });
    };
    const onUp = () => {
      const newX = Math.max(0, Math.min(canvasW, dragging.x0 + liveDeltaRef.current.dx));
      const newY = Math.max(0, Math.min(canvasH, dragging.y0 + liveDeltaRef.current.dy));
      onDragEnd(dragging.key, Math.round(newX), Math.round(newY));
      setDragging(null);
      setLiveDelta({ dx: 0, dy: 0 });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, canvasW, canvasH, scale, onDragEnd]);

  // Track latest delta in a ref for the pointerup handler — closures would
  // otherwise see the stale initial value.
  const liveDeltaRef = useRef({ dx: 0, dy: 0 });
  useEffect(() => { liveDeltaRef.current = liveDelta; }, [liveDelta]);

  return (
    <div style={{
      position: 'absolute', inset: 0,
      pointerEvents: 'none', // children opt in below so the canvas stays clickable
    }}>
      {fields.map(f => {
        if (hiddenFields.has(f.key)) return null;
        const isDragging = dragging?.key === f.key;
        const baseX = f.x || 0;
        const baseY = f.y || 0;
        const liveX = baseX + (isDragging ? liveDelta.dx : 0);
        const liveY = baseY + (isDragging ? liveDelta.dy : 0);
        // Translate alignment so the chip anchors where the text actually
        // renders on the canvas (canvas uses ctx.textAlign = f.align).
        const translateX = f.align === 'center' ? '-50%' : f.align === 'right' ? '-100%' : '0';
        const hasValue = !!(customFields[f.key] || '').trim();
        return (
          <div
            key={f.key}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragging({ key: f.key, startX: e.clientX, startY: e.clientY, x0: baseX, y0: baseY });
            }}
            title={`${f.label} · drag to reposition · ${Math.round(liveX)},${Math.round(liveY)}`}
            style={{
              position: 'absolute',
              left: liveX * scale,
              top: liveY * scale,
              transform: `translate(${translateX}, -50%)`,
              pointerEvents: 'auto',
              cursor: isDragging ? 'grabbing' : 'grab',
              userSelect: 'none', touchAction: 'none',
              background: isDragging ? 'rgba(220,38,38,0.95)' : 'rgba(17,24,39,0.72)',
              color: '#fff',
              padding: '3px 8px', borderRadius: 4,
              fontFamily: 'var(--blw-cond, "Barlow Condensed", sans-serif)',
              fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
              whiteSpace: 'nowrap',
              border: `1px solid ${isDragging ? '#DC2626' : 'rgba(255,255,255,0.25)'}`,
              boxShadow: isDragging ? '0 4px 18px rgba(220,38,38,0.45)' : '0 2px 6px rgba(0,0,0,0.4)',
              zIndex: isDragging ? 20 : 10,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            <span style={{ opacity: hasValue ? 1 : 0.75 }}>⋮⋮</span>
            {f.label.toUpperCase()}
          </div>
        );
      })}
    </div>
  );
}

// Build a short list of recommended stat-line variants for a selected player.
// Each recommendation is { label, value, badge? } where `badge` is present
// when the recommendation leans on a top-15% stat — a "worth posting" hint.
//
// The percentile calc is the same direction-aware one used on the Game Center
// tables: for lower-is-better stats (K, ERA, FIP, WHIP, BB/4), "top" means
// the player's value is low vs the league. So a pitcher with FIP 0.25 still
// gets tagged "Top 5%" even though 0.25 is numerically small.
function percentileOfValue(values, target, lowerIsBetter = false) {
  if (!Array.isArray(values) || values.length === 0 || target == null) return null;
  const sorted = [...values].filter(v => v != null && !isNaN(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  let below = 0, ties = 0;
  for (const v of sorted) {
    if (v < target) below++;
    else if (v === target) ties++;
    else break;
  }
  const raw = ((below + 0.5 * ties) / sorted.length) * 100;
  return lowerIsBetter ? 100 - raw : raw;
}

function buildRecommendations(player, batter, pitcher, battingPool, pitchingPool) {
  const recs = [];
  const pctBadge = (pct) => (pct != null && pct >= 85) ? `Top ${Math.max(1, Math.round(100 - pct))}%` : null;

  if (batter) {
    const opsPct = percentileOfValue(battingPool.map(b => b.ops_plus), batter.ops_plus);
    const avgPct = percentileOfValue(battingPool.map(b => parseFloat(b.avg)), parseFloat(batter.avg));
    const hrPct = percentileOfValue(battingPool.map(b => b.hr), batter.hr);

    recs.push({
      label: 'Slash line',
      value: `${batter.avg} / ${batter.obp} / ${batter.slg}`,
      badge: pctBadge(avgPct),
    });
    if (batter.hr > 0) {
      recs.push({
        label: 'Power',
        value: `HR ${batter.hr} · RBI ${batter.rbi} · ${batter.slg} SLG`,
        badge: pctBadge(hrPct),
      });
    }
    recs.push({
      label: 'Advanced',
      value: `OPS+ ${batter.ops_plus} · ${batter.ops} OPS`,
      badge: pctBadge(opsPct),
    });
  }
  if (pitcher) {
    const fipPct = percentileOfValue(pitchingPool.map(b => b.fip), pitcher.fip, true);
    const k4Pct = percentileOfValue(pitchingPool.map(b => parseFloat(b.k4)), parseFloat(pitcher.k4));
    const wPct = percentileOfValue(pitchingPool.map(b => b.w), pitcher.w);

    recs.push({
      label: 'Dominance',
      value: `FIP ${typeof pitcher.fip === 'number' ? pitcher.fip.toFixed(2) : pitcher.fip} · K/4 ${pitcher.k4}`,
      badge: pctBadge(fipPct) || pctBadge(k4Pct),
    });
    recs.push({
      label: 'Record',
      value: `${pitcher.w}-${pitcher.l} · ${pitcher.era} ERA · ${pitcher.ip} IP`,
      badge: pctBadge(wPct),
    });
    recs.push({
      label: 'Strikeout',
      value: `K ${pitcher.k} · K/4 ${pitcher.k4} · ${pitcher.ip} IP`,
      badge: pctBadge(k4Pct),
    });
  }
  return recs;
}

// Placeholder text shown in the preview when a field is empty.
// Picked so character width roughly matches expected filled value.
const FIELD_PLACEHOLDERS = {
  // Team/Player News template (renamed from player-stat) — three lines.
  line1:       'TEXT HERE LINE ONE',
  line2:       'TEXT HERE LINE TWO',
  line3:       'TEXT HERE LINE THREE',
  // Other templates — kept verbatim. Some legacy placeholders that
  // referenced the old player-stat fields stay in case anyone re-adds
  // them via field overrides; harmless when the keys don't exist.
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

// Default photo transform — identity (cover crop, no exposure adjustments).
// Persisted shape so all consumers (render, exports, history) read the same fields.
export const DEFAULT_BG_TRANSFORM = Object.freeze({
  offsetX: 0,    // -1 to 1, fraction of available pan range in source pixels
  offsetY: 0,    // -1 to 1
  zoom: 1,       // 1 to 4 — multiplier on the cover-crop window
  brightness: 1, // 0.4 to 1.6 — exposure
  contrast: 1,   // 0.4 to 1.6
  saturation: 1, // 0 to 2
});

// Resolve the source-rect crop for the background image given pan/zoom.
// Returns { sx, sy, sw, sh, maxPanXSource, maxPanYSource } so drag handlers
// can translate canvas-pixel deltas back into offset units.
function computeBgCrop(bgImg, w, h, transform) {
  const t = transform || DEFAULT_BG_TRANSFORM;
  const imgRatio = bgImg.width / bgImg.height;
  const canvasRatio = w / h;
  // Cover-crop base — what the canvas would show at zoom=1, offset=0
  let baseSw = bgImg.width;
  let baseSh = bgImg.height;
  if (imgRatio > canvasRatio) baseSw = bgImg.height * canvasRatio;
  else baseSh = bgImg.width / canvasRatio;
  // Apply zoom (>1 shrinks source rect → image appears larger)
  const effSw = baseSw / Math.max(0.01, t.zoom);
  const effSh = baseSh / Math.max(0.01, t.zoom);
  // Maximum pan in source pixels — the "extra" room outside the effective crop.
  // At zoom=1 with a wider-than-canvas image, this = half the cropped-off margin.
  const maxPanXSource = Math.max(0, (bgImg.width - effSw) / 2);
  const maxPanYSource = Math.max(0, (bgImg.height - effSh) / 2);
  const centerX = bgImg.width / 2 + (t.offsetX || 0) * maxPanXSource;
  const centerY = bgImg.height / 2 + (t.offsetY || 0) * maxPanYSource;
  return {
    sx: centerX - effSw / 2,
    sy: centerY - effSh / 2,
    sw: effSw,
    sh: effSh,
    maxPanXSource,
    maxPanYSource,
  };
}

// ─── 4-Layer Custom Compositor ──────────────────────────────────────────────
// options: { hiddenFields: Set<string>, forExport: boolean, bgTransform }
// - hiddenFields: field keys the user has explicitly toggled off → skip entirely
// - forExport: true on the final download render → skip empty fields so preview
//   placeholders don't bake into the exported PNG
// - bgTransform: { offsetX, offsetY, zoom, brightness, contrast, saturation } —
//   exposure adjustments are applied via ctx.filter ONLY for the background draw
//   so overlays + text remain unaffected.
function renderCustomTemplate(ctx, w, h, bgImg, overlayImg, fields, fieldConfig, activeEffects = [], team, options = {}) {
  const { hiddenFields, forExport, bgTransform } = options;
  ctx.clearRect(0, 0, w, h);
  const teamColor = team?.color;

  // Layer 1: Background photo (cover crop with pan/zoom + exposure), or team-colored gradient fallback
  if (bgImg) {
    const { sx, sy, sw, sh } = computeBgCrop(bgImg, w, h, bgTransform);
    const t = bgTransform || DEFAULT_BG_TRANSFORM;
    const filterParts = [];
    if (Math.abs(t.brightness - 1) > 0.001) filterParts.push(`brightness(${t.brightness})`);
    if (Math.abs(t.contrast - 1) > 0.001)   filterParts.push(`contrast(${t.contrast})`);
    if (Math.abs(t.saturation - 1) > 0.001) filterParts.push(`saturate(${t.saturation})`);
    const hasFilter = filterParts.length > 0;
    if (hasFilter) {
      ctx.save();
      ctx.filter = filterParts.join(' ');
    }
    ctx.drawImage(bgImg, sx, sy, sw, sh, 0, 0, w, h);
    if (hasFilter) {
      ctx.filter = 'none';
      ctx.restore();
    }
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

      const draw = () => {
        if (f.maxWidth) ctx.fillText(text, f.x, f.y, f.maxWidth);
        else ctx.fillText(text, f.x, f.y);
      };

      // Multi-layer drop-shadow stack. Each shadow is applied as its
      // own fillText pass via canvas's shadow* properties, so layers
      // composite naturally underneath the final text. The text gets
      // drawn N+1 times — once per shadow layer plus once shadowless
      // on top — but for solid-color text the result reads as a
      // single glyph with N stacked shadows.
      const shadows = Array.isArray(f.shadows) ? f.shadows : null;
      if (shadows && shadows.length) {
        for (const s of shadows) {
          ctx.shadowColor   = s.color   || 'rgba(0,0,0,0.5)';
          ctx.shadowBlur    = s.blur    || 0;
          ctx.shadowOffsetX = s.offsetX || 0;
          ctx.shadowOffsetY = s.offsetY || 0;
          draw();
        }
        // Final clean pass on top to crisp the glyph edges.
        ctx.shadowColor   = 'transparent';
        ctx.shadowBlur    = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        draw();
      } else {
        draw();
      }
      ctx.restore();
    });
  }
}

// ─── Main Generate Component ────────────────────────────────────────────────
export default function Generate() {
  const toast = useToast();
  const canvasRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const [searchParams] = useSearchParams();

  // Phase 5b: athletes are pinned to their own team. If the role is 'athlete'
  // and a profile has loaded with a team_id, `customTeam` defaults to that
  // and the team <select> is disabled. URL ?team= params are ignored for
  // athletes so a deep link can't sneak them past the restriction.
  const { role, teamId: profileTeamId } = useAuth();
  const isAthlete = isAthleteRole(role);
  const athleteLockedTeam = isAthlete ? (profileTeamId || '') : '';

  // Custom-template state (the only mode — Classic was removed).
  // URL params from dashboard Content-Idea deep links pre-fill these on mount.
  const [customType, setCustomType] = useState(() => {
    const t = searchParams.get('template');
    return (t && TEMPLATE_TYPES[t]) ? t : 'player-stat';
  });
  const [customTeam, setCustomTeam] = useState(() => {
    // Athlete roles are forced to their assigned team.
    if (isAthleteRole(role) && profileTeamId) return profileTeamId;
    return searchParams.get('team') || '';
  });

  // If the role/teamId resolves after first render (profile loads async),
  // retroactively pin the athlete to their team.
  useEffect(() => {
    if (isAthlete && profileTeamId && customTeam !== profileTeamId) {
      setCustomTeam(profileTeamId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAthlete, profileTeamId]);
  const [customPlatform, setCustomPlatform] = useState('portrait');
  const [customFields, setCustomFields] = useState({});
  // Fields the user has explicitly toggled off — no placeholder in preview, no text in export
  const [hiddenFields, setHiddenFields] = useState(() => new Set());
  const [overlays, setOverlays] = useState([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState(null);
  const [overlayImg, setOverlayImg] = useState(null);
  const [bgImg, setBgImg] = useState(null);
  const [bgUrl, setBgUrl] = useState(null);
  // Pan/zoom + exposure adjustments — applied to the background image only.
  // Reset whenever a new bgImg loads so each photo starts from identity.
  const [bgTransform, setBgTransform] = useState(DEFAULT_BG_TRANSFORM);
  const [playerMedia, setPlayerMedia] = useState([]);
  const [playerMediaUrls, setPlayerMediaUrls] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  // v4.5.9: bulk overlay upload. Single-file flow still works — uploadFiles
  // is just an array of length 1 in that case. uploadName only applies to
  // single-file uploads; bulk uploads auto-derive each name from the
  // filename so the user can drop a folder of "DAL_Game1.png", "DAL_Game2.png"
  // etc. and get individual records named for each file.
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadPreview, setUploadPreview] = useState(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [uploadType, setUploadType] = useState('player-stat');
  const [uploadTeam, setUploadTeam] = useState('');
  const [uploadPlatform, setUploadPlatform] = useState('feed');

  // Brief context drawer — when the user lands on Generate from an
  // idea card (dashboard, team page, player modal, or a Request),
  // recover the full idea payload so we can show its narrative +
  // captions next to the canvas. Two recovery paths:
  //   1. ?ideaId=X → sessionStorage stash (set by every idea-driven
  //      navigation handler).
  //   2. ?fromRequest=Y → look up the request locally and extract its
  //      embedded idea via extractIdeaFromNote. Backstop for when the
  //      stash was wiped (tab reload, private browsing).
  const [briefIdea, setBriefIdea] = useState(() => {
    const ideaId = searchParams.get('ideaId');
    if (ideaId) {
      const stashed = readStashedIdea(ideaId);
      if (stashed) return stashed;
    }
    const fromRequest = searchParams.get('fromRequest');
    if (fromRequest) {
      const r = getRequests().find(x => x.id === fromRequest);
      if (r) {
        const { idea } = extractIdeaFromNote(r.note);
        if (idea) return { ...idea, requestId: fromRequest };
      }
    }
    return null;
  });
  // Re-read on URL change (browser back/forward, in-app re-link).
  useEffect(() => {
    const ideaId = searchParams.get('ideaId');
    const fromRequest = searchParams.get('fromRequest');
    if (!ideaId && !fromRequest) { setBriefIdea(null); return; }
    if (ideaId) {
      const stashed = readStashedIdea(ideaId);
      if (stashed) { setBriefIdea(stashed); return; }
    }
    if (fromRequest) {
      const r = getRequests().find(x => x.id === fromRequest);
      const { idea } = extractIdeaFromNote(r?.note || '');
      setBriefIdea(idea ? { ...idea, requestId: fromRequest } : null);
    }
  }, [searchParams]);

  // Effects state
  const [activeEffects, setActiveEffects] = useState([]); // [{ id, type: 'builtin'|'upload', opacity, builtin?, image? }]
  const [uploadedEffects, setUploadedEffects] = useState([]); // from IndexedDB
  const [showEffectUpload, setShowEffectUpload] = useState(false);
  const [effectFile, setEffectFile] = useState(null);
  const [effectName, setEffectName] = useState('');

  // Live batting + pitching so the "Suggested stat lines" strip can compute
  // the selected player's percentile and tag top-performers accordingly.
  const [liveBatting, setLiveBatting] = useState([]);
  const [livePitching, setLivePitching] = useState([]);
  const [recommendedStatLines, setRecommendedStatLines] = useState([]); // [{ label, value, badge? }]

  useEffect(() => {
    fetchAllData().then(({ batting, pitching }) => {
      setLiveBatting(batting || []);
      setLivePitching(pitching || []);
    });
  }, []);

  // Field layout overrides (x / y / fontSize / font per field, per template/platform).
  // Version counter forces re-render of the preview + download when the user
  // edits a position or font. The actual source of truth is localStorage;
  // this counter just invalidates the useCallback dependencies.
  const [overridesVersion, setOverridesVersion] = useState(0);
  const [showLayoutEditor, setShowLayoutEditor] = useState(false);
  const patchFieldOverride = (fieldKey, partial) => {
    setFieldOverride(customType, customPlatform, fieldKey, partial);
    setOverridesVersion(v => v + 1);
  };
  const resetLayoutOverrides = () => {
    resetOverrides(customType, customPlatform);
    setOverridesVersion(v => v + 1);
  };

  const allPlayers = getAllPlayers();
  const filteredPlayers = customTeam === 'ALL' ? allPlayers : allPlayers.filter(p => p.team === customTeam);

  // Auto-populate Custom mode from URL params — dashboard Content-Idea deep
  // links pass { template, team, playerName, number, statLine, ... }. Template
  // and team are consumed via the useState initializers above; anything else
  // flows into customFields so the template renders with the right copy.
  //
  // Back-compat for the player-stat → "Team/Player News" rename: legacy URLs
  // (player page CTAs, old saved ideas, bookmarks) carry playerName / statLine
  // / number / teamName but the template now uses line1 / line2 / line3.
  // When we detect the legacy keys AND the template is player-stat, fold
  // them into the new line slots in priority order so the deep link still
  // produces a sensible rendered post.
  useEffect(() => {
    const tmpl = searchParams.get('template');
    const params = {};
    for (const [key, value] of searchParams.entries()) {
      if (key !== 'team' && key !== 'template') params[key] = value;
    }

    // Legacy → new mapping for the renamed Team/Player News template.
    if (tmpl === 'player-stat') {
      const legacyChain = [
        params.playerName,                                   // Line 1: who
        params.statLine,                                     // Line 2: the news
        params.number ? `#${params.number}` : params.teamName, // Line 3: tag
      ];
      const cleaned = legacyChain.filter(s => s && String(s).trim().length > 0);
      if (cleaned.length && !params.line1 && !params.line2 && !params.line3) {
        if (cleaned[0]) params.line1 = cleaned[0];
        if (cleaned[1]) params.line2 = cleaned[1];
        if (cleaned[2]) params.line3 = cleaned[2];
      }
      // Drop the legacy keys so they don't sit in customFields as orphans.
      delete params.playerName;
      delete params.statLine;
      delete params.number;
      delete params.teamName;
    }

    if (Object.keys(params).length > 0) {
      setCustomFields(prev => ({ ...prev, ...params }));
    }
  }, []);

  // Load overlays + effects from IndexedDB — gated on team selection so we
  // don't hydrate a team's entire asset library until the user commits to one.
  // We also kick off a focused cloud-pull for overlays so a fresh upload by
  // another user appears WITHOUT waiting for the global 10-minute hydrate
  // throttle. Pull-then-reload is sequenced so the picker shows up fast
  // (local first), then refreshes silently when the cloud round-trip
  // completes. Tiny network cost, big consistency win across machines.
  const [overlayRefreshing, setOverlayRefreshing] = useState(false);
  const reloadOverlays = useCallback(async () => {
    if (!customTeam) return;
    setOverlayRefreshing(true);
    try { await refreshOverlaysFromCloud(); }
    catch { /* best-effort — local list still renders */ }
    const list = await getOverlays();
    setOverlays(list);
    setOverlayRefreshing(false);
  }, [customTeam]);
  // v4.5.0: pull overlays from cloud on EVERY Generate page mount, not only
  // on team-change. Mobile users were missing fresh overlays uploaded by
  // desktop admins because the focused refresh was gated on customTeam being
  // set — anyone who landed on the page in a non-Custom template (or with no
  // team picked yet) never triggered a pull.
  useEffect(() => {
    let cancelled = false;
    refreshOverlaysFromCloud().then(async () => {
      if (cancelled) return;
      const fresh = await getOverlays();
      if (!cancelled && customTeam) setOverlays(fresh);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []); // mount-only — fires once when entering /generate

  useEffect(() => {
    if (!customTeam) { setOverlays([]); return; }
    // Render the local list immediately, then refresh from cloud in the
    // background. Two state-sets per team-select is fine — second one is
    // a no-op when nothing new arrived.
    let cancelled = false;
    getOverlays().then(list => { if (!cancelled) setOverlays(list); });
    refreshOverlaysFromCloud().then(async () => {
      if (cancelled) return;
      const fresh = await getOverlays();
      if (!cancelled) setOverlays(fresh);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [customTeam]);
  useEffect(() => {
    if (!customTeam) { setUploadedEffects([]); return; }
    getEffects().then(setUploadedEffects);
  }, [customTeam]);

  // Load selected overlay image. Supports two sources:
  //   - `preset:...` ids → bundled PNGs under src/assets/overlays/ (designer-delivered)
  //   - plain UUIDs → user-uploaded overlays in IndexedDB
  useEffect(() => {
    if (!selectedOverlayId) { setOverlayImg(null); return; }
    if (String(selectedOverlayId).startsWith('preset:')) {
      const preset = presetOverlays.find(p => p.id === selectedOverlayId);
      if (preset) loadPresetImage(preset).then(setOverlayImg);
      return;
    }
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
          // v4.5.0: pass BOTH firstInitial and jerseyNum from the canonical
          // roster. First-initial alone fails when both players start with
          // the same letter (Logan/Luke Rose, James/Justin Lee, both
          // Marshalls). Jersey number is the unambiguous key — every
          // canonical entry has it. Legacy records without firstInitial or
          // num still surface via the fallthrough in findPlayerMedia.
          const firstInitial = (p.firstName || (p.name || '').split(' ')[0] || '').charAt(0);
          mediaItems = await findPlayerMedia(p.team, p.lastName, { firstInitial, jerseyNum: p.num });
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
    if (!selectedPlayer) { setRecommendedStatLines([]); return; }
    const p = allPlayers.find(pl => `${pl.team}_${pl.name}` === selectedPlayer);
    if (!p) return;
    // Prefer live data so recs are current; fall back to cached fallbacks.
    const battingPool = liveBatting.length ? liveBatting : BATTING_LEADERS;
    const pitchingPool = livePitching.length ? livePitching : PITCHING_LEADERS;
    const batter = battingPool.find(b => b.name === p.name && b.team === p.team);
    const pitcher = pitchingPool.find(b => b.name === p.name && b.team === p.team);
    const teamObj = getTeam(p.team);
    const mediaJersey = playerMedia.find(m => m.num)?.num || p.num || '';
    const statLine = batter
      ? `OPS+ ${batter.ops_plus} | AVG ${batter.avg} | HR ${batter.hr} | OBP ${batter.obp}`
      : pitcher
        ? `FIP ${pitcher.fip.toFixed(2)} | IP ${pitcher.ip} | W ${pitcher.w} | K/4 ${pitcher.k4}`
        : '';

    // Per-template field shape:
    //   player-stat (Team/Player News) — three free-form lines, populate
    //     line1=name, line2=stat, line3=#jersey · team
    //   highlight / hype — legacy keys (playerName/number/teamName/statLine)
    //     so the existing field positions and AI prefills keep working.
    let newFields;
    if (customType === 'player-stat') {
      newFields = {
        line1: p.name,
        line2: statLine || (teamObj?.name || p.team),
        line3: mediaJersey ? `#${mediaJersey} · ${teamObj?.name || p.team}` : (teamObj?.name || p.team),
      };
    } else {
      newFields = { playerName: p.name, number: mediaJersey, teamName: teamObj?.name || p.team };
      if (statLine) newFields.statLine = statLine;
    }
    setCustomFields(prev => ({ ...prev, ...newFields }));

    // Build "Suggested stat lines" — a handful of pre-formatted variants the
    // user can one-click insert. Percentile badge tags the angle that leans
    // on a top-15% stat, so designers know which variant to lead with.
    setRecommendedStatLines(buildRecommendations(p, batter, pitcher, battingPool, pitchingPool));
  }, [selectedPlayer, playerMedia, liveBatting, livePitching]);

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
    const fieldConfig = applyOverrides(getFieldConfig(customType, customPlatform), customType, customPlatform);
    const customTeamObj = getTeam(customTeam);
    renderCustomTemplate(ctx, customPlat.w, customPlat.h, bgImg, overlayImg, customFields, fieldConfig, activeEffects, customTeamObj, { hiddenFields, bgTransform });
  }, [customType, customTeam, customPlatform, customFields, bgImg, overlayImg, customPlat, activeEffects, hiddenFields, bgTransform, overridesVersion]);

  // Per-input render — exactly the same shape as before the local-fonts
  // change. Two reasons not to await fonts here: (1) rebinding inside a
  // promise on every drag step calls render() twice per pointermove
  // tick, and canvas.width=N inside render() forces a state reset on
  // every call — fine but wasteful; (2) the second-pass render was
  // queued from a microtask, so any pointer event fired between the
  // two renders interacts with stale React state.
  useEffect(() => { render(); }, [render]);

  // Mount-only font preload re-render. Captures the latest render
  // function via a ref so a font-ready callback that fires AFTER state
  // has changed still draws the up-to-date frame. Fires exactly once:
  // localFontsReady() returns a cached resolved promise after the
  // first call, so future re-renders don't trigger more font waits.
  const renderRef = useRef(render);
  useEffect(() => { renderRef.current = render; }, [render]);
  useEffect(() => {
    let cancelled = false;
    localFontsReady().then(() => {
      if (!cancelled) renderRef.current();
    });
    return () => { cancelled = true; };
  }, []);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Re-render without placeholders so the downloaded PNG only contains real
    // text + hidden fields stay hidden. Then re-render for preview afterwards.
    const ctx = canvas.getContext('2d');
    const fieldConfig = applyOverrides(getFieldConfig(customType, customPlatform), customType, customPlatform);
    const customTeamObj = getTeam(customTeam);
    renderCustomTemplate(ctx, customPlat.w, customPlat.h, bgImg, overlayImg, customFields, fieldConfig, activeEffects, customTeamObj, { hiddenFields, forExport: true, bgTransform });
    const link = document.createElement('a');
    link.download = `BLW_${customTeam}_${customType}_${customPlatform}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();

    // Log the generation to Supabase so the dashboard "Recent posts" strip
    // and Settings download history have something to show. We build a
    // small thumbnail (~400 px wide) via an offscreen canvas so the stored
    // image is dashboard-sized, not full 1080× resolution.
    try {
      const thumb = document.createElement('canvas');
      const targetW = 400;
      const thumbScale = targetW / customPlat.w;
      thumb.width = targetW;
      thumb.height = Math.round(customPlat.h * thumbScale);
      const tctx = thumb.getContext('2d');
      tctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
      const thumbnailDataUrl = thumb.toDataURL('image/png');
      cloud.logGenerate({
        id: crypto.randomUUID(),
        team: customTeam,
        templateType: customType,
        platform: customPlatform,
        // Snapshot what made this composition — lets us restore it from
        // the dashboard / settings history via URL params.
        settings: {
          fields: customFields,
          hiddenFields: Array.from(hiddenFields),
          selectedPlayer,
          overlayId: selectedOverlayId,
          effects: activeEffects.map(e => ({ id: e.id, type: e.type, opacity: e.opacity })),
        },
        thumbnailDataUrl,
      });
    } catch (err) {
      console.warn('[generate-log] failed to snapshot', err);
    }

    // Restore preview render (with placeholders) right after export
    render();
    toast.success('Downloaded', { detail: `${customTeam} · ${customType} · ${customPlat.label}` });
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
    setBgTransform(DEFAULT_BG_TRANSFORM);
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
    setBgTransform(DEFAULT_BG_TRANSFORM);
  }, []);

  const selectPlayerMediaAsBg = useCallback((mediaUrl) => {
    setBgUrl(mediaUrl);
    const img = new Image();
    img.onload = () => setBgImg(img);
    img.src = mediaUrl;
    setBgTransform(DEFAULT_BG_TRANSFORM);
  }, []);

  // ── Photo pan/zoom interaction on the preview canvas ──
  // Drag to pan, scroll to zoom. Both edit `bgTransform` in offset/zoom units —
  // the renderer translates back to source pixels via computeBgCrop().
  //
  // Why the ref dance: the raw bgTransform is a state object that changes
  // every pointermove tick. Putting it directly in onCanvasPointerDown's
  // deps means React rebinds the wrapper's onPointerDown listener mid-drag,
  // and putting bgTransform-the-object in onCanvasPointerMove's deps does
  // the same. Pointer capture survives the rebind, but the churn is
  // unnecessary AND occasionally drops the first move event after a
  // rebind (the drop is what made drag feel "lost"). So we point both
  // handlers at refs that always carry the latest values, and keep the
  // useCallback deps narrow — the handlers themselves stay referentially
  // stable across the entire drag.
  const bgDragRef = useRef(null); // { startX, startY, offsetX0, offsetY0 }
  const bgTransformRef = useRef(bgTransform);
  useEffect(() => { bgTransformRef.current = bgTransform; }, [bgTransform]);

  const onCanvasPointerDown = useCallback((e) => {
    if (!bgImg || showLayoutEditor) return; // layout editor owns pointer when on
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const t = bgTransformRef.current;
    bgDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX0: t.offsetX,
      offsetY0: t.offsetY,
    };
  }, [bgImg, showLayoutEditor]);

  const onCanvasPointerMove = useCallback((e) => {
    const drag = bgDragRef.current;
    if (!drag || !bgImg) return;
    // dx/dy in canvas-display pixels → convert to offset units
    const t = bgTransformRef.current;
    const crop = computeBgCrop(bgImg, activeW, activeH, t);
    if (crop.maxPanXSource <= 0 && crop.maxPanYSource <= 0) return;
    const dxDisplay = e.clientX - drag.startX;
    const dyDisplay = e.clientY - drag.startY;
    // Drag right → image moves right → source rect moves left → offsetX decreases
    const sxPerDisplayPx = (crop.sw / activeW) / scale;
    const syPerDisplayPx = (crop.sh / activeH) / scale;
    const dxOffset = crop.maxPanXSource > 0 ? -(dxDisplay * sxPerDisplayPx) / crop.maxPanXSource : 0;
    const dyOffset = crop.maxPanYSource > 0 ? -(dyDisplay * syPerDisplayPx) / crop.maxPanYSource : 0;
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    setBgTransform(prev => ({
      ...prev,
      offsetX: clamp(drag.offsetX0 + dxOffset),
      offsetY: clamp(drag.offsetY0 + dyOffset),
    }));
  }, [bgImg, activeW, activeH, scale]);

  const onCanvasPointerUp = useCallback((e) => {
    if (bgDragRef.current) {
      e.currentTarget.releasePointerCapture?.(bgDragRef.current.pointerId);
      bgDragRef.current = null;
    }
  }, []);

  const onCanvasWheel = useCallback((e) => {
    if (!bgImg || showLayoutEditor) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015); // smooth, scale-invariant zoom
    setBgTransform(t => {
      const z = Math.max(1, Math.min(4, t.zoom * factor));
      return { ...t, zoom: z };
    });
  }, [bgImg, showLayoutEditor]);

  const resetBgTransform = useCallback(() => setBgTransform(DEFAULT_BG_TRANSFORM), []);
  const patchBgTransform = useCallback((partial) => setBgTransform(t => ({ ...t, ...partial })), []);

  // React's onWheel is passive in some browsers, so attach manually with
  // passive:false to allow preventDefault and avoid page scroll while zooming.
  useEffect(() => {
    const node = canvasWrapRef.current;
    if (!node) return;
    node.addEventListener('wheel', onCanvasWheel, { passive: false });
    return () => node.removeEventListener('wheel', onCanvasWheel);
  }, [onCanvasWheel]);

  // Overlay upload — supports single OR bulk. e.target.files may carry many
  // PNGs at once (multi-select on the picker, or drag-drop a folder).
  const handleOverlayFile = (e) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    setUploadFiles(files);
    // Preview only the first file when multiple are selected — the rest
    // are listed by name beneath the dropzone so the user can confirm.
    setUploadPreview(URL.createObjectURL(files[0]));
    if (files.length === 1 && !uploadName) {
      setUploadName(files[0].name.replace(/\.[^.]+$/, ''));
    }
  };

  // Drag-drop onto the dropzone. Falls through to the same handler so
  // the file-list logic stays in one place.
  const handleOverlayDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    setUploadFiles(files);
    setUploadPreview(URL.createObjectURL(files[0]));
    if (files.length === 1 && !uploadName) {
      setUploadName(files[0].name.replace(/\.[^.]+$/, ''));
    }
  };

  const submitOverlay = async () => {
    if (!uploadFiles.length) return;
    const isBulk = uploadFiles.length > 1;
    setUploadProgress({ current: 0, total: uploadFiles.length });
    const saved = [];
    for (let i = 0; i < uploadFiles.length; i++) {
      const file = uploadFiles[i];
      // Single-file: use the (possibly-edited) uploadName. Bulk: derive
      // from the filename so each record has a distinct, sensible label.
      const name = isBulk
        ? file.name.replace(/\.[^.]+$/, '')
        : (uploadName || file.name.replace(/\.[^.]+$/, ''));
      const record = await saveOverlay({
        name,
        type: uploadType,
        team: uploadTeam || null,
        platform: uploadPlatform,
        imageBlob: file,
        width: 0, height: 0,
      });
      saved.push(record);
      setUploadProgress({ current: i + 1, total: uploadFiles.length });
    }
    setOverlays(prev => [...prev, ...saved]);
    setShowUploadModal(false);
    setUploadFiles([]);
    setUploadPreview(null);
    setUploadName('');
    setUploadProgress({ current: 0, total: 0 });
    // Auto-select the first uploaded overlay so the user sees an
    // immediate result instead of having to dig through the picker.
    if (saved[0]) setSelectedOverlayId(saved[0].id);
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
  // Applied config — merges user overrides on top of the template defaults.
  // Reading `overridesVersion` here just forces recomputation; applyOverrides
  // re-reads from localStorage so the latest edits surface immediately.
  const customFieldConfig = useMemo(
    () => applyOverrides(getFieldConfig(customType, customPlatform), customType, customPlatform),
    [customType, customPlatform, overridesVersion]
  );
  const hasOverrides = useMemo(
    () => Object.keys(getOverrides(customType, customPlatform)).length > 0,
    [customType, customPlatform, overridesVersion]
  );
  const filteredOverlays = overlays.filter(o => o.type === customType && (!o.team || o.team === customTeam));
  // Designer-delivered preset overlays (bundled, not uploaded). Matches team
  // + template type. Empty list when the designer hasn't dropped any for
  // this combination — the uploaded-overlay flow remains as fallback.
  const presetOverlays = customTeam ? getPresetOverlays(customTeam, customType) : [];

  const labelStyle = { fontSize: 12, color: colors.textSecondary, fontFamily: fonts.body, fontWeight: 600 };

  // Drift the page's accent palette to the selected team. Falls back
  // to brand red when nothing's selected. /generate doesn't live under
  // /teams/:slug so the App-level URL scope doesn't cover it — Generate
  // owns its own scope keyed off the form's team state.
  const customTeamObjForScope = customTeam ? getTeam(customTeam) : null;

  return (
    <TeamThemeScope team={customTeamObjForScope}>
    <div>
      <PageHeader title="GENERATE" subtitle="Create downloadable graphics for any team. Download and schedule via Metricool." />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* CONTROLS */}
        <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Custom templates — the only mode.
              Form flow (left col): Team → Player → Media → Overlay → Content
              Template Type lives above the preview (right col) because it
              fundamentally changes what you're looking at. */}
          <>
              {/* 1. Team & Format — first, so brand colors drive the preview immediately */}
              <Card>
                <Label>Team & Format</Label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>
                      Team
                      {isAthlete && (
                        <span title="Your role is restricted to this team" style={{
                          marginLeft: 6, fontSize: 9, fontWeight: 700,
                          color: colors.textSecondary, letterSpacing: 0.5,
                        }}>🔒 LOCKED</span>
                      )}
                    </label>
                    <select
                      value={customTeam}
                      onChange={e => setCustomTeam(e.target.value)}
                      disabled={isAthlete}
                      title={isAthlete ? 'Your role is restricted to your own team' : undefined}
                      style={{
                        ...selectStyle,
                        marginTop: 4,
                        opacity: isAthlete ? 0.7 : 1,
                        cursor: isAthlete ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {isAthlete ? (
                        // Athlete: only their team is selectable. If the profile
                        // somehow has no team_id, we degrade to a "no team" state.
                        athleteLockedTeam ? (
                          <option value={athleteLockedTeam}>
                            {athleteLockedTeam} · {TEAMS.find(t => t.id === athleteLockedTeam)?.name || 'Your team'}
                          </option>
                        ) : (
                          <option value="">No team assigned. Ask your admin.</option>
                        )
                      ) : (
                        <>
                          <option value="">Choose a team…</option>
                          {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id} · {t.name}</option>)}
                        </>
                      )}
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

              {/* 2. Player Selector (for player-centric templates).
                  Collapsible so the form doesn't grow into a 7-card scroll —
                  shows the picked player's name as a summary when collapsed. */}
              {customTypeObj?.playerCentric && (() => {
                const selectedPlayerObj = selectedPlayer
                  ? filteredPlayers.find(p => `${p.team}_${p.name}` === selectedPlayer)
                  : null;
                const summary = selectedPlayerObj
                  ? `${selectedPlayerObj.name} · ${selectedPlayerObj.team}`
                  : (customTeam ? 'No player selected' : 'Pick a team first');
                return (
                  <CollapsibleCard
                    title="Player"
                    summary={summary}
                    storageKey="generate.collapse.player"
                    defaultOpen={!selectedPlayer}
                  >
                    <select value={selectedPlayer} onChange={e => setSelectedPlayer(e.target.value)} style={{ ...selectStyle }} disabled={!customTeam}>
                      <option value="">{customTeam ? 'Choose a player...' : 'Select a team first'}</option>
                      {filteredPlayers.map(p => (
                        <option key={`${p.team}_${p.name}`} value={`${p.team}_${p.name}`}>
                          {p.name} · {p.team}
                        </option>
                      ))}
                    </select>
                  </CollapsibleCard>
                );
              })()}

              {/* 3. Select Media — gated on team selection so we don't spin up
                  a full team's asset library until the user has committed.
                  Collapsible — surface the chosen media's name / count when
                  collapsed so the user knows the state without expanding. */}
              {(() => {
                const selectedMedia = bgUrl ? playerMediaUrls.find(m => m.url === bgUrl) : null;
                const summary = !customTeam
                  ? 'Pick a team first'
                  : selectedMedia
                    ? selectedMedia.name
                    : bgUrl
                      ? 'Custom upload'
                      : playerMediaUrls.length > 0
                        ? `${playerMediaUrls.length} available`
                        : 'No media yet';
                return (
              <CollapsibleCard
                title="Media"
                summary={summary}
                storageKey="generate.collapse.media"
                defaultOpen={!bgUrl}
              >
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                  <label style={{
                    background: customTeam ? colors.accentSoft : colors.bg,
                    border: `1px solid ${customTeam ? colors.accentBorder : colors.border}`,
                    color: customTeam ? colors.accent : colors.textMuted,
                    borderRadius: radius.sm, padding: '3px 10px',
                    fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                    cursor: customTeam ? 'pointer' : 'not-allowed',
                    opacity: customTeam ? 1 : 0.6,
                  }}>
                    <input type="file" accept="image/*,video/*" onChange={handleBgFileInput} disabled={!customTeam} style={{ display: 'none' }} />
                    + Upload New
                  </label>
                </div>

                {!customTeam ? (
                  <div style={{
                    border: `2px dashed ${colors.border}`, borderRadius: radius.base,
                    padding: 24, textAlign: 'center', background: colors.bg,
                  }}>
                    <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.condensed }}>
                      Select a team above to load media
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Current selection preview */}
                    {bgUrl && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{
                          width: '100%', height: 120, borderRadius: radius.base,
                          background: `url(${bgUrl}) center/cover`,
                          border: `1px solid ${colors.border}`,
                        }} />
                        <button onClick={() => { setBgImg(null); setBgUrl(null); }} style={{
                          background: 'none', border: 'none', color: colors.accent, fontSize: 11,
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
                                border: bgUrl === m.url ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
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
                            : 'No media uploaded for this team yet'}
                        </div>
                        <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 4, fontFamily: fonts.condensed }}>
                          Upload files in the Files page or drop one here
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CollapsibleCard>
                );
              })()}

              {/* 4. Overlay Picker — also gated on team. Collapsible like
                  the Media picker; summary surfaces the selected overlay's
                  name when collapsed. */}
              {(() => {
                const selectedPreset = selectedOverlayId && String(selectedOverlayId).startsWith('preset:')
                  ? presetOverlays.find(p => p.id === selectedOverlayId)
                  : null;
                const selectedUploaded = selectedOverlayId && !String(selectedOverlayId).startsWith('preset:')
                  ? overlays.find(o => o.id === selectedOverlayId)
                  : null;
                const summary = !customTeam
                  ? 'Pick a team first'
                  : selectedPreset
                    ? selectedPreset.name
                    : selectedUploaded
                      ? selectedUploaded.name
                      : (presetOverlays.length + filteredOverlays.length) > 0
                        ? `${presetOverlays.length + filteredOverlays.length} available`
                        : 'No overlay';
                return (
              <CollapsibleCard
                title="Overlay"
                summary={summary}
                storageKey="generate.collapse.overlay"
                defaultOpen={!selectedOverlayId}
              >
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, gap: 6 }}>
                  {/* Cloud refresh — pulls any overlays uploaded by other
                      users since the local IDB cache was last hydrated.
                      Auto-fires on team-select; this button is the
                      manual nudge for "I just uploaded one on my desktop
                      and I'm checking from my laptop." */}
                  <button
                    onClick={async () => {
                      await reloadOverlays();
                      toast.success('Overlays synced from cloud');
                    }}
                    disabled={!customTeam || overlayRefreshing}
                    title="Pull the latest overlays uploaded by anyone on the team"
                    style={{
                      background: 'transparent',
                      border: `1px solid ${colors.border}`,
                      color: colors.textSecondary,
                      borderRadius: radius.sm, padding: '3px 10px',
                      fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                      cursor: customTeam ? 'pointer' : 'not-allowed',
                      opacity: customTeam ? 1 : 0.6,
                    }}
                  >{overlayRefreshing ? '↻ Syncing…' : '↻ Sync'}</button>
                  <button onClick={() => setShowUploadModal(true)} disabled={!customTeam} style={{
                    background: customTeam ? colors.accentSoft : colors.bg,
                    border: `1px solid ${customTeam ? colors.accentBorder : colors.border}`,
                    color: customTeam ? colors.accent : colors.textMuted,
                    borderRadius: radius.sm, padding: '3px 10px',
                    fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                    cursor: customTeam ? 'pointer' : 'not-allowed',
                    opacity: customTeam ? 1 : 0.6,
                  }}>+ Upload Overlay</button>
                </div>
                {!customTeam ? (
                  <div style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', padding: 20, fontFamily: fonts.condensed }}>
                    Select a team above to load overlays
                  </div>
                ) : (presetOverlays.length === 0 && filteredOverlays.length === 0) ? (
                  <div style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', padding: 20 }}>
                    No overlays for this type/team yet.
                    <br />Upload a PNG with transparency, or ask the designer for a preset.
                  </div>
                ) : (
                  <>
                    {presetOverlays.length > 0 && (
                      <>
                        <div style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 600, color: colors.textMuted, letterSpacing: 0.8, marginBottom: 6 }}>
                          PRESETS · {presetOverlays.length}
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: filteredOverlays.length > 0 ? 12 : 0 }}>
                          {presetOverlays.map(p => (
                            <div
                              key={p.id}
                              onClick={() => setSelectedOverlayId(p.id === selectedOverlayId ? null : p.id)}
                              title={`${p.name}${p.teamId === 'all' ? ' · league-wide preset' : ''}`}
                              style={{
                                width: 80, height: 80, borderRadius: radius.base, cursor: 'pointer',
                                background: `#1A1A22 url(${p.url}) center/cover`,
                                border: selectedOverlayId === p.id ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
                                position: 'relative',
                              }}
                            >
                              <div style={{
                                position: 'absolute', top: 4, right: 4,
                                background: p.teamId === 'all' ? 'rgba(0,0,0,0.65)' : 'rgba(124,58,237,0.85)',
                                color: '#fff',
                                borderRadius: 2, padding: '1px 4px',
                                fontSize: 7, fontFamily: fonts.condensed, fontWeight: 800, letterSpacing: 0.5,
                              }}>
                                {p.teamId === 'all' ? 'LEAGUE' : 'PRESET'}
                              </div>
                              <div style={{
                                position: 'absolute', bottom: 0, left: 0, right: 0,
                                background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
                                padding: '2px 4px',
                                borderRadius: `0 0 ${radius.base}px ${radius.base}px`,
                                fontSize: 8, color: '#fff', fontFamily: fonts.condensed, fontWeight: 700,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                                {p.name}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {filteredOverlays.length > 0 && (
                      <>
                        {presetOverlays.length > 0 && (
                          <div style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 600, color: colors.textMuted, letterSpacing: 0.8, marginBottom: 6 }}>
                            UPLOADED · {filteredOverlays.length}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {filteredOverlays.map(o => (
                            <div key={o.id} style={{ position: 'relative' }}>
                              <div onClick={() => setSelectedOverlayId(o.id === selectedOverlayId ? null : o.id)} style={{
                                width: 80, height: 80, borderRadius: radius.base, cursor: 'pointer',
                                background: '#1A1A22', border: selectedOverlayId === o.id ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
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
                      </>
                    )}
                  </>
                )}
              </CollapsibleCard>
                );
              })()}

              {/* 5. Dynamic Content — text fields that overlay the composition.
                  Each field has a VISIBLE / HIDDEN badge so you can omit a zone
                  entirely (no placeholder in preview, no text in the PNG). */}
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 6, flexWrap: 'wrap' }}>
                  <Label style={{ marginBottom: 0 }}>Content</Label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {hasOverrides && (
                      <button
                        onClick={resetLayoutOverrides}
                        title={`Revert position/font edits for ${customType} · ${customPlatform} back to template defaults`}
                        style={{
                          background: colors.bg,
                          border: `1px solid ${colors.border}`,
                          color: colors.textMuted,
                          borderRadius: radius.sm, padding: '3px 8px',
                          fontFamily: fonts.condensed, fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
                          cursor: 'pointer',
                        }}
                      >↺ RESET LAYOUT</button>
                    )}
                    <button
                      onClick={() => setShowLayoutEditor(v => !v)}
                      title={showLayoutEditor ? 'Hide per-field layout controls' : 'Show per-field layout controls (position + font)'}
                      style={{
                        background: showLayoutEditor ? colors.accentSoft : colors.bg,
                        border: `1px solid ${showLayoutEditor ? colors.accentBorder : colors.border}`,
                        color: showLayoutEditor ? colors.accent : colors.textSecondary,
                        borderRadius: radius.sm, padding: '3px 10px',
                        fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
                        cursor: 'pointer',
                      }}
                    >
                      {showLayoutEditor ? '✕ CLOSE LAYOUT' : '⚙ EDIT LAYOUT'}
                    </button>
                  </div>
                </div>
                {customFieldConfig.map(f => {
                  const isHidden = hiddenFields.has(f.key);
                  const overridesForCombo = getOverrides(customType, customPlatform);
                  const fieldOverride = overridesForCombo[f.key];
                  const isOverridden = !!fieldOverride;
                  // Matched-size toggle: VISIBLE (green) ↔ HIDDEN (muted) so the
                  // control has the same visual weight whether it's on or off.
                  const badgeStyle = {
                    borderRadius: radius.sm,
                    padding: '3px 10px',
                    cursor: 'pointer',
                    fontSize: 10,
                    lineHeight: 1.2,
                    fontFamily: fonts.condensed,
                    fontWeight: 800,
                    letterSpacing: 0.6,
                    minWidth: 64,
                    textAlign: 'center',
                    border: '1px solid',
                    background: isHidden ? colors.bg : 'rgba(34,197,94,0.12)',
                    color: isHidden ? colors.textMuted : '#15803D',
                    borderColor: isHidden ? colors.border : 'rgba(34,197,94,0.35)',
                  };
                  return (
                    <div key={f.key} style={{ marginBottom: 10, opacity: isHidden ? 0.5 : 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                        <label style={labelStyle}>
                          {f.label}
                          {isOverridden && (
                            <span title="This field has layout overrides applied" style={{
                              display: 'inline-block', marginLeft: 6,
                              width: 6, height: 6, borderRadius: '50%', background: colors.accent,
                              verticalAlign: 'middle',
                            }} />
                          )}
                        </label>
                        <button
                          onClick={() => toggleFieldHidden(f.key)}
                          title={isHidden ? 'Show this field in preview + export' : 'Hide this field from preview + export'}
                          style={badgeStyle}
                        >
                          {isHidden ? 'HIDDEN' : 'VISIBLE'}
                        </button>
                      </div>
                      <input
                        type="text"
                        value={customFields[f.key] || ''}
                        onChange={e => setCustomFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={isHidden ? '(field hidden; click HIDDEN to show)' : `Enter ${f.label.toLowerCase()}...`}
                        disabled={isHidden}
                        style={{ ...inputStyle, marginTop: 0 }}
                      />
                      {/* Layout panel — visible when the user toggled EDIT LAYOUT.
                          X/Y are in canvas pixels at native resolution; font is
                          the key into FONT_MAP (heading/body/condensed); font size
                          is also in native pixels. Changes persist to localStorage. */}
                      {showLayoutEditor && !isHidden && (
                        <div style={{
                          marginTop: 6, padding: 8,
                          background: colors.bg, border: `1px solid ${colors.borderLight}`,
                          borderRadius: radius.sm,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontFamily: fonts.condensed, fontSize: 9, fontWeight: 700, color: colors.textMuted, letterSpacing: 0.6 }}>
                              LAYOUT · {customPlat.w}×{customPlat.h}px
                            </span>
                            {isOverridden && (
                              <button
                                onClick={() => patchFieldOverride(f.key, null)}
                                title="Revert this field to the template default"
                                style={{
                                  background: 'transparent', border: 'none',
                                  color: colors.textMuted, fontFamily: fonts.condensed,
                                  fontSize: 9, fontWeight: 700, letterSpacing: 0.4, cursor: 'pointer',
                                }}
                              >↺ Reset</button>
                            )}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                            <div>
                              <label style={{ ...labelStyle, fontSize: 9, marginBottom: 2, display: 'block' }}>X (px)</label>
                              <input
                                type="number" min={0} max={customPlat.w}
                                value={f.x ?? 0}
                                onChange={e => patchFieldOverride(f.key, { x: Math.max(0, Math.min(customPlat.w, parseInt(e.target.value, 10) || 0)) })}
                                style={{ ...inputStyle, fontSize: 12, marginTop: 0 }}
                              />
                            </div>
                            <div>
                              <label style={{ ...labelStyle, fontSize: 9, marginBottom: 2, display: 'block' }}>Y (px)</label>
                              <input
                                type="number" min={0} max={customPlat.h}
                                value={f.y ?? 0}
                                onChange={e => patchFieldOverride(f.key, { y: Math.max(0, Math.min(customPlat.h, parseInt(e.target.value, 10) || 0)) })}
                                style={{ ...inputStyle, fontSize: 12, marginTop: 0 }}
                              />
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                            <div>
                              <label style={{ ...labelStyle, fontSize: 9, marginBottom: 2, display: 'block' }}>Font size (px)</label>
                              <input
                                type="number" min={8} max={200}
                                value={f.fontSize ?? 24}
                                onChange={e => patchFieldOverride(f.key, { fontSize: Math.max(8, Math.min(200, parseInt(e.target.value, 10) || 24)) })}
                                style={{ ...inputStyle, fontSize: 12, marginTop: 0 }}
                              />
                            </div>
                            <div>
                              <label style={{ ...labelStyle, fontSize: 9, marginBottom: 2, display: 'block' }}>Font</label>
                              <select
                                value={f.font || 'body'}
                                onChange={e => patchFieldOverride(f.key, { font: e.target.value })}
                                style={{ ...selectStyle, fontSize: 12, marginTop: 0 }}
                              >
                                <optgroup label="Default">
                                  <option value="heading">Heading (Bebas Neue)</option>
                                  <option value="body">Body (Barlow)</option>
                                  <option value="condensed">Condensed (Barlow Condensed)</option>
                                </optgroup>
                                <optgroup label="Display (local)">
                                  <option value="gotham">Gotham Bold</option>
                                  <option value="press">Press Gothic</option>
                                  <option value="united">United Sans Bold</option>
                                </optgroup>
                              </select>
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Suggested stat lines — player-specific, computed against
                          the full league. Click to insert into the stat line. */}
                      {(f.key === 'statLine' || f.key === 'line2') && !isHidden && recommendedStatLines.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ fontFamily: fonts.condensed, fontSize: 9, fontWeight: 700, color: colors.textMuted, letterSpacing: 0.8, marginBottom: 4 }}>
                            ✨ SUGGESTED STAT LINES
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {recommendedStatLines.map((rec, idx) => (
                              <button
                                key={idx}
                                onClick={() => setCustomFields(prev => ({ ...prev, [f.key]: rec.value }))}
                                title={`Insert: ${rec.value}`}
                                style={{
                                  background: customFields[f.key] === rec.value ? colors.accentSoft : colors.bg,
                                  border: `1px solid ${customFields[f.key] === rec.value ? colors.accentBorder : colors.border}`,
                                  color: customFields[f.key] === rec.value ? colors.accent : colors.textSecondary,
                                  borderRadius: radius.sm,
                                  padding: '4px 8px',
                                  cursor: 'pointer',
                                  fontFamily: fonts.condensed,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  textAlign: 'left',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  maxWidth: '100%',
                                }}
                              >
                                <span style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                  {rec.label}
                                </span>
                                {rec.badge && (
                                  <span style={{
                                    background: 'rgba(220,38,38,0.15)',
                                    color: '#DC2626',
                                    padding: '1px 5px',
                                    borderRadius: 999,
                                    fontSize: 8,
                                    letterSpacing: 0.3,
                                  }}>
                                    {rec.badge}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </Card>

          </>

          <RedButton onClick={download} style={{ width: '100%', padding: '14px 24px', fontSize: 14 }}>
            Download PNG ({customPlat.label})
          </RedButton>
        </div>

        {/* PREVIEW — Template Type sits above the preview because it dictates
            what the canvas is actually showing. Effects panel directly below
            so slider changes are visible without scrolling. */}
        <div style={{ flex: '1 1 400px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Card>
            <Label>Template Type</Label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {Object.entries(TEMPLATE_TYPES).map(([key, t]) => (
                <button key={key} onClick={() => { setCustomType(key); setCustomFields({}); setHiddenFields(new Set()); setSelectedOverlayId(null); setOverlayImg(null); }} style={{
                  background: customType === key ? colors.accentSoft : colors.white,
                  border: customType === key ? `1px solid ${colors.accent}` : `1px solid ${colors.border}`,
                  color: customType === key ? colors.accent : colors.textSecondary,
                  borderRadius: radius.base, padding: 6, cursor: 'pointer',
                  fontFamily: fonts.body, fontSize: 10, fontWeight: 700, textAlign: 'center',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                }}>
                  <TemplatePreview
                    templateKey={key}
                    platform={customPlatform}
                    team={customTeam}
                    width={72}
                    height={72}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <span style={{ fontSize: 12 }}>{t.icon}</span>
                    <span>{t.name}</span>
                  </div>
                </button>
              ))}
            </div>
          </Card>
          <Label>Live Preview {showLayoutEditor && <span style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.accent, letterSpacing: 0.5, marginLeft: 6 }}>· DRAG FIELDS TO REPOSITION</span>}</Label>
          <div style={{
            background: '#1A1A22', borderRadius: radius.lg, padding: 16,
            border: `1px solid ${colors.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%',
            boxSizing: 'border-box',
          }}>
            <div
              ref={canvasWrapRef}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              onPointerCancel={onCanvasPointerUp}
              style={{
                position: 'relative',
                width: activeW * scale, height: activeH * scale,
                cursor: bgImg && !showLayoutEditor ? (bgDragRef.current ? 'grabbing' : 'grab') : 'default',
                touchAction: 'none',
              }}
            >
              <canvas ref={canvasRef} style={{
                width: activeW * scale, height: activeH * scale,
                borderRadius: radius.base, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                display: 'block',
                pointerEvents: 'none', // wrapper owns pointer events
              }} />
              {/* Drag overlay — only visible when EDIT LAYOUT is on. Each
                  field becomes a small draggable handle pinned at its current
                  (x,y). Dragging translates preview-pixel deltas back to
                  native canvas pixels via the `scale` factor. */}
              {showLayoutEditor && (
                <DragOverlay
                  fields={customFieldConfig}
                  hiddenFields={hiddenFields}
                  customFields={customFields}
                  canvasW={activeW}
                  canvasH={activeH}
                  scale={scale}
                  onDragEnd={(fieldKey, x, y) => patchFieldOverride(fieldKey, { x, y })}
                />
              )}
            </div>
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, textAlign: 'center' }}>
            {activeW}x{activeH}px · Click download for full resolution
          </div>

          {/* Photo Adjust — pan/zoom + exposure. Affects ONLY the background photo;
              overlay PNGs and text are untouched. Drag the preview to pan, scroll
              to zoom; sliders below are duplicates for fine control. */}
          {bgImg && (
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Label style={{ marginBottom: 0 }}>Photo Adjust</Label>
                <button onClick={resetBgTransform} style={{
                  background: colors.bg, border: `1px solid ${colors.border}`,
                  color: colors.textSecondary, borderRadius: radius.sm, padding: '3px 10px',
                  fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                }}>RESET</button>
              </div>
              <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.condensed, marginBottom: 10, fontStyle: 'italic' }}>
                Drag preview to pan · Scroll to zoom · Sliders affect photo only
              </div>
              {[
                { key: 'zoom',       label: 'Zoom',       min: 1,   max: 4,   step: 0.01, fmt: v => `${v.toFixed(2)}×` },
                { key: 'brightness', label: 'Exposure',   min: 0.4, max: 1.6, step: 0.01, fmt: v => `${Math.round((v - 1) * 100)}%` },
                { key: 'contrast',   label: 'Contrast',   min: 0.4, max: 1.6, step: 0.01, fmt: v => `${Math.round((v - 1) * 100)}%` },
                { key: 'saturation', label: 'Saturation', min: 0,   max: 2,   step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
              ].map(s => (
                <div key={s.key} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                    <span style={{ ...labelStyle, textTransform: 'none', fontWeight: 700 }}>{s.label}</span>
                    <span style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.accent, fontWeight: 700 }}>
                      {s.fmt(bgTransform[s.key])}
                    </span>
                  </div>
                  <input
                    type="range" min={s.min} max={s.max} step={s.step}
                    value={bgTransform[s.key]}
                    onChange={e => patchBgTransform({ [s.key]: parseFloat(e.target.value) })}
                    style={{ width: '100%', accentColor: colors.accent }}
                  />
                </div>
              ))}
            </Card>
          )}

          {/* Effects Layer — lives under the preview so slider changes are visible live */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Label style={{ marginBottom: 0 }}>Effects</Label>
              <button onClick={() => setShowEffectUpload(true)} style={{
                background: colors.accentSoft, border: `1px solid ${colors.accentBorder}`,
                color: colors.accent, borderRadius: radius.sm, padding: '3px 10px',
                fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, cursor: 'pointer',
              }}>+ Upload Effect</button>
            </div>

            {/* Built-in effect thumbnails */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {BUILT_IN_EFFECTS.map(fx => {
                const active = isEffectActive('builtin', fx.id);
                return (
                  <button key={fx.id} onClick={() => toggleBuiltInEffect(fx.id)} style={{
                    background: active ? colors.accentSoft : colors.bg,
                    border: active ? `1px solid ${colors.accent}` : `1px solid ${colors.border}`,
                    borderRadius: radius.sm, padding: '6px 8px', cursor: 'pointer',
                    fontFamily: fonts.body, fontSize: 10, fontWeight: 700,
                    color: active ? colors.accent : colors.textSecondary,
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
                        background: active ? colors.accentSoft : colors.bg,
                        border: active ? `1px solid ${colors.accent}` : `1px solid ${colors.border}`,
                        borderRadius: radius.sm, padding: '6px 8px', cursor: 'pointer',
                        fontFamily: fonts.body, fontSize: 10, fontWeight: 700,
                        color: active ? colors.accent : colors.textSecondary,
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
                        <span style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.accent, fontWeight: 700 }}>
                          {Math.round(fx.opacity * 100)}%
                        </span>
                      </div>
                      <input
                        type="range" min={0} max={1} step={0.01}
                        value={fx.opacity}
                        onChange={e => setEffectOpacity({ type: fx.type, id: fx.id }, parseFloat(e.target.value))}
                        style={{ width: '100%', accentColor: colors.accent }}
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

          {/* Brief context drawer — only renders when the user landed
              on Generate from a content idea (dashboard, team page,
              player modal, or a Request). Shows the AI-drafted
              narrative and any caption variants the idea carried so
              the user has the original brief in view while composing
              the canvas. Read-only; this isn't where you EDIT
              captions, just where you reference them. */}
          {briefIdea && <BriefContextDrawer idea={briefIdea} onDismiss={() => setBriefIdea(null)} />}
        </div>
      </div>

      {/* UPLOAD OVERLAY MODAL — supports single OR bulk. v4.5.9: drop a
          folder of PNGs onto the dropzone (or multi-select via picker)
          and they all share the same template type / platform / team
          metadata. Each file becomes its own overlay record, named
          after its filename. */}
      {showUploadModal && (() => {
        const isBulk = uploadFiles.length > 1;
        const isUploading = uploadProgress.total > 0;
        const closeModal = () => {
          if (isUploading) return; // don't allow close mid-upload
          setShowUploadModal(false);
          setUploadFiles([]);
          setUploadPreview(null);
          setUploadName('');
        };
        return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: colors.white, borderRadius: radius.lg, padding: 24, maxWidth: 480, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <SectionHeading style={{ margin: 0 }}>
                Upload overlay{isBulk ? `s · ${uploadFiles.length}` : ''}
              </SectionHeading>
              <button onClick={closeModal} disabled={isUploading} style={{
                background: 'none', border: 'none', fontSize: 20, cursor: isUploading ? 'wait' : 'pointer', color: colors.textMuted,
                opacity: isUploading ? 0.4 : 1,
              }}>✕</button>
            </div>

            <label
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={handleOverlayDrop}
              style={{ cursor: 'pointer', display: 'block', marginBottom: 16 }}
            >
              <input type="file" accept="image/png" multiple onChange={handleOverlayFile} style={{ display: 'none' }} />
              <div style={{
                border: `2px dashed ${colors.border}`, borderRadius: radius.base,
                padding: uploadPreview ? 0 : 30, textAlign: 'center',
                background: colors.bg, overflow: 'hidden',
                height: uploadPreview ? 160 : 'auto',
                position: 'relative',
              }}>
                {uploadPreview ? (
                  <div style={{ width: '100%', height: '100%', background: `url(${uploadPreview}) center/contain no-repeat`, backgroundColor: '#1A1A22' }} />
                ) : (
                  <div>
                    <div style={{ fontSize: 13, color: colors.text, fontWeight: 600 }}>
                      Drop PNG files here, or click to select
                    </div>
                    <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 6 }}>
                      Multi-select to bulk-add overlays for the same template
                    </div>
                  </div>
                )}
                {isBulk && (
                  <div style={{
                    position: 'absolute', top: 8, right: 8,
                    background: colors.red, color: '#fff',
                    padding: '3px 9px', borderRadius: 999,
                    fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                    letterSpacing: 0.5,
                  }}>
                    +{uploadFiles.length - 1} MORE
                  </div>
                )}
              </div>
            </label>

            {isBulk && (
              <div style={{
                marginBottom: 12,
                background: colors.bg, borderRadius: radius.base,
                padding: '8px 12px',
                maxHeight: 110, overflow: 'auto',
              }}>
                <div style={{
                  fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                  letterSpacing: 0.5, color: colors.textMuted, marginBottom: 4,
                }}>FILES TO UPLOAD ({uploadFiles.length})</div>
                {uploadFiles.map((f, i) => (
                  <div key={`${f.name}-${i}`} style={{
                    fontSize: 12, color: colors.textSecondary,
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    padding: '2px 0',
                    display: 'flex', justifyContent: 'space-between', gap: 8,
                  }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name.replace(/\.[^.]+$/, '')}
                    </span>
                    <span style={{ color: colors.textMuted, flexShrink: 0 }}>
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!isBulk && (
                <div>
                  <label style={labelStyle}>Overlay Name</label>
                  <input type="text" value={uploadName} onChange={e => setUploadName(e.target.value)}
                    placeholder="e.g. DAL Game Day Feed v1" style={{ ...inputStyle, marginTop: 3 }} />
                </div>
              )}
              {isBulk && (
                <div style={{
                  fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed,
                  letterSpacing: 0.4,
                }}>
                  EACH FILE WILL BE NAMED FROM ITS FILENAME · SAME TEMPLATE / PLATFORM / TEAM APPLIED TO ALL
                </div>
              )}
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
                  {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id} · {t.name}</option>)}
                </select>
              </div>
            </div>

            {isUploading && (
              <div style={{ marginTop: 14 }}>
                <div style={{
                  fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                  letterSpacing: 0.5, color: colors.textSecondary, marginBottom: 4,
                }}>UPLOADING {uploadProgress.current} / {uploadProgress.total}</div>
                <div style={{ height: 6, background: colors.bg, borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{
                    width: `${(uploadProgress.current / uploadProgress.total) * 100}%`,
                    height: '100%', background: colors.red,
                    transition: 'width 0.2s',
                  }} />
                </div>
              </div>
            )}

            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <RedButton onClick={submitOverlay} disabled={!uploadFiles.length || isUploading} style={{ flex: 1 }}>
                {isUploading
                  ? `Uploading… ${uploadProgress.current}/${uploadProgress.total}`
                  : isBulk
                    ? `Save ${uploadFiles.length} Overlays`
                    : 'Save Overlay'}
              </RedButton>
              <OutlineButton onClick={closeModal} disabled={isUploading}>Cancel</OutlineButton>
            </div>
          </div>
        </div>
        );
      })()}

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
    </TeamThemeScope>
  );
}

// ─── Brief context drawer ──────────────────────────────────────────────────
// Renders below the Effects card when the user came from an idea card.
// Three sections, all collapsible-friendly via height/overflow:
//   1. Headline + narrative — what the idea is ABOUT
//   2. Caption tabs — copy-ready text per platform
//   3. Stat pills — numbers the AI cited, for visual reinforcement
// Pure presentational; doesn't mutate the idea, just surfaces it.
function BriefContextDrawer({ idea, onDismiss }) {
  // Active caption tab. Falls back to the first key with a draft so
  // the panel doesn't open on an empty platform when one was generated.
  const captionKeys = idea?.captions ? Object.keys(idea.captions).filter(k => idea.captions[k]) : [];
  const [tab, setTab] = useState(captionKeys[0] || 'instagram');
  // Re-pin the tab when the idea changes (browser back/forward).
  useEffect(() => { setTab(captionKeys[0] || 'instagram'); /* eslint-disable-next-line */ }, [idea?.id]);

  const stats = Array.isArray(idea?.dataPoints) ? idea.dataPoints.filter(Boolean) : [];
  const narrative = idea?.narrative || idea?.description || '';
  const tabsAvailable = captionKeys.length > 0;

  const copyCaption = async (text) => {
    try {
      await navigator.clipboard.writeText(text || '');
    } catch {
      /* clipboard might be denied; fail silently */
    }
  };

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header strip — one line, identifies the source so the user
          knows why this drawer is here. AI badge + dismiss control. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px',
        borderBottom: `1px solid ${colors.borderLight}`,
        background: colors.bg,
      }}>
        <span style={{
          fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
          letterSpacing: 0.8, textTransform: 'uppercase',
          color: '#7C3AED',
          background: 'rgba(124,58,237,0.10)',
          border: '1px solid rgba(124,58,237,0.30)',
          padding: '2px 7px', borderRadius: radius.sm,
        }}>{idea.aiGenerated ? '✨ AI brief' : 'Brief'}</span>
        <Label style={{ marginBottom: 0, flex: 1 }}>
          {idea.requestId ? 'From request' : 'From content idea'}
        </Label>
        <button
          onClick={onDismiss}
          title="Hide this brief"
          style={{
            background: 'transparent', border: 'none',
            color: colors.textMuted, cursor: 'pointer',
            fontSize: 16, lineHeight: 1, padding: '0 4px',
          }}
        >✕</button>
      </div>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Headline + narrative */}
        {idea.headline && (
          <div>
            <div style={{
              fontFamily: fonts.heading, fontSize: 16, lineHeight: 1.25,
              color: colors.text, fontWeight: 400, letterSpacing: 0.3,
              marginBottom: 4,
            }}>{idea.headline}</div>
            {narrative && (
              <div style={{
                fontFamily: fonts.body, fontSize: 12, color: colors.textSecondary,
                lineHeight: 1.55, whiteSpace: 'pre-wrap', maxWidth: '60ch',
              }}>{narrative}</div>
            )}
          </div>
        )}

        {/* Stat pills — AI-cited numbers, lightly tinted */}
        {stats.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {stats.map((s, i) => (
              <span
                key={i}
                className="tnum"
                style={{
                  fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                  letterSpacing: 0.3, color: colors.textSecondary,
                  background: colors.bg,
                  border: `1px solid ${colors.borderLight}`,
                  padding: '2px 7px', borderRadius: radius.sm,
                }}
              >{s}</span>
            ))}
          </div>
        )}

        {/* Caption tabs — only when the idea has drafted captions */}
        {tabsAvailable ? (
          <div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              {captionKeys.map(k => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  style={{
                    background: tab === k ? colors.accentSoft : 'transparent',
                    border: `1px solid ${tab === k ? colors.accentBorder : colors.borderLight}`,
                    color: tab === k ? colors.accent : colors.textSecondary,
                    borderRadius: radius.sm,
                    padding: '3px 10px',
                    fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                    letterSpacing: 0.4, textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >{k}</button>
              ))}
              <span style={{ flex: 1 }} />
              <button
                onClick={() => copyCaption(idea.captions?.[tab])}
                title="Copy this caption to clipboard"
                style={{
                  background: 'transparent',
                  border: `1px solid ${colors.border}`,
                  color: colors.textSecondary,
                  borderRadius: radius.sm,
                  padding: '3px 10px',
                  fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                  letterSpacing: 0.4, textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >Copy</button>
            </div>
            <div style={{
              fontFamily: fonts.body, fontSize: 12, color: colors.text,
              lineHeight: 1.55,
              padding: 10,
              background: colors.bg,
              border: `1px solid ${colors.borderLight}`,
              borderRadius: radius.sm,
              whiteSpace: 'pre-wrap',
              maxHeight: 180, overflowY: 'auto',
            }}>
              {idea.captions[tab] || '—'}
            </div>
          </div>
        ) : (
          <div style={{
            fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed,
            fontStyle: 'italic',
          }}>
            No captions drafted yet for this idea. Generate them on the dashboard
            or in the Requests detail panel.
          </div>
        )}
      </div>
    </Card>
  );
}
