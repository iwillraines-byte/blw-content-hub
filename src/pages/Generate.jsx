import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { TEAMS, PLATFORMS, BATTING_LEADERS, PITCHING_LEADERS, getTeam, getAllPlayers, fetchAllData } from '../data';
import { Card, CollapsibleCard, Label, PageHeader, SectionHeading, RedButton, OutlineButton, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { TeamThemeScope } from '../team-theme';
import { TEMPLATE_TYPES, FONT_MAP, STAT_CARD_TYPES, getFieldConfig, formatPostName } from '../template-config';
import { renderStatCard as statCardRender, defaultCardBox, ensureProwiffleLogoReady } from '../stat-card-renderer';
import { getOverlays, saveOverlay, deleteOverlay, getEffects, saveEffect, deleteEffect, blobToImage as overlayBlobToImage, resyncOverlay, resyncAllLocalOnlyOverlays } from '../overlay-store';
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

    // v4.5.62: number-first format. Was "OPS+ 117 · 0.890 OPS"; now
    // "117 OPS+ · 0.890 OPS". Slash line and existing dual-value
    // strings already lead with numbers and stay as-is.
    recs.push({
      label: 'Slash line',
      value: `${batter.avg} / ${batter.obp} / ${batter.slg}`,
      badge: pctBadge(avgPct),
    });
    if (batter.hr > 0) {
      recs.push({
        label: 'Power',
        value: `${batter.hr} HR · ${batter.rbi} RBI · ${batter.slg} SLG`,
        badge: pctBadge(hrPct),
      });
    }
    recs.push({
      label: 'Advanced',
      value: `${batter.ops_plus} OPS+ · ${batter.ops} OPS`,
      badge: pctBadge(opsPct),
    });
  }
  if (pitcher) {
    const fipPct = percentileOfValue(pitchingPool.map(b => b.fip), pitcher.fip, true);
    const k4Pct = percentileOfValue(pitchingPool.map(b => parseFloat(b.k4)), parseFloat(pitcher.k4));
    const wPct = percentileOfValue(pitchingPool.map(b => b.w), pitcher.w);

    recs.push({
      label: 'Dominance',
      value: `${typeof pitcher.fip === 'number' ? pitcher.fip.toFixed(2) : pitcher.fip} FIP · ${pitcher.k4} K/4`,
      badge: pctBadge(fipPct) || pctBadge(k4Pct),
    });
    recs.push({
      label: 'Record',
      value: `${pitcher.w}-${pitcher.l} · ${pitcher.era} ERA · ${pitcher.ip} IP`,
      badge: pctBadge(wPct),
    });
    recs.push({
      label: 'Strikeout',
      value: `${pitcher.k} K · ${pitcher.k4} K/4 · ${pitcher.ip} IP`,
      badge: pctBadge(k4Pct),
    });
  }
  return recs;
}

// Placeholder text shown in the preview when a field is empty.
// Picked so character width roughly matches expected filled value.
// v4.5.37: Templates whose imagery already carries the message — text
// fields are PRESENT in the template config (so designers can flip
// them on as a layer-cake) but default OFF so a clean photo stays
// clean. Hype/Promo, Blank Slate, and Stat Card all fall in this
// bucket: the picture (or, for stat-card, the rendered card) IS the
// content. Adding a headline is opt-in.
// v4.5.61: blank-slate + stat-card flipped to text-on-by-default per
// master direction. The headline pill toggle still lets the user
// turn it off — this is just the initial state when the template
// loads. Hype/promo stays text-off so the cinematic image isn't
// covered on first paint.
const TEMPLATES_WITH_TEXT_OFF_BY_DEFAULT = new Set(['hype']);

function defaultHiddenFieldsFor(templateType, platform) {
  if (!TEMPLATES_WITH_TEXT_OFF_BY_DEFAULT.has(templateType)) return new Set();
  const fields = getFieldConfig(templateType, platform || 'portrait');
  return new Set((fields || []).map(f => f.key));
}

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
  statLine:    '000 OPS+ · .XXX AVG · 0 HR',
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
// v4.5.37 / v4.5.42 / v4.5.44: Templates that opt into the "Headline"
// pill treatment. When a headline font is selected, the largest text
// field on the canvas gets a team-colored rounded-pill background,
// the chosen font, and a soft drop shadow — same visual energy as a
// TV chyron. Other text fields render unchanged.
//
// v4.5.42: was boolean on/off (Winner-Sans-only); now any FONT_MAP key.
// v4.5.44: was an allowlist of three templates; now ALL templates are
// eligible EXCEPT 'player-stat' (Team/Player News). News intentionally
// uses three matched stacked lines — wrapping one in a pill would
// break the symmetric typographic stack. Every other template benefits.
const HEADLINE_TOGGLE_BLOCKED_TEMPLATES = new Set(['player-stat']);
const headlineToggleEligible = (templateType) => !HEADLINE_TOGGLE_BLOCKED_TEMPLATES.has(templateType);

// v4.5.67: Helper to draw an image fully covering a rect (object-fit:
// cover semantics). Used by the split-screen renderer where each half
// of the canvas needs an independent center-cover crop. Caller owns
// the optional pan/zoom math; this just handles the source-rect
// derivation for a plain center-crop default.
function drawCovered(ctx, img, dx, dy, dw, dh) {
  if (!img) return;
  const imgRatio = img.width / img.height;
  const dRatio = dw / dh;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (imgRatio > dRatio) {
    // Source wider than dest — crop horizontally.
    sw = img.height * dRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / dRatio;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function renderCustomTemplate(ctx, w, h, bgImg, overlayImg, fields, fieldConfig, activeEffects = [], team, options = {}) {
  const { hiddenFields, forExport, bgTransform, statCard, headlineFont, templateType, splitScreen, bgImg2 } = options;
  const headlineEnabled = !!headlineFont && headlineToggleEligible(templateType);
  // The "headline" is whichever rendered field has the largest fontSize.
  // Computed once so each field's draw block can decide if it's the one.
  const headlineKey = headlineEnabled && fieldConfig
    ? (fieldConfig
        .filter(f => !(hiddenFields && hiddenFields.has(f.key)))
        .reduce((best, f) => (best == null || f.fontSize > best.fontSize ? f : best), null)?.key)
    : null;
  ctx.clearRect(0, 0, w, h);
  const teamColor = team?.color;

  // v4.5.67: Split-screen mode (blank-slate only) — stack two photos
  // top/bottom inside the canvas. Each half gets an independent
  // center-cover crop; the user's bgTransform pan/zoom only applies
  // to the top image since the second slot doesn't have its own
  // transform state yet (kept simple for v1; per-slot transforms can
  // land in a follow-up). A 4px white divider visually separates
  // the two halves so the eye knows it's a deliberate stack and not
  // a single panoramic photo.
  if (splitScreen && bgImg && bgImg2) {
    const halfH = Math.floor(h / 2);
    drawCovered(ctx, bgImg, 0, 0, w, halfH);
    drawCovered(ctx, bgImg2, 0, halfH, w, h - halfH);
    // White hairline divider
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, halfH - 2, w, 4);
  }
  // Layer 1: Background photo (cover crop with pan/zoom + exposure), or team-colored gradient fallback
  else if (bgImg) {
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

  // v4.5.20: Layer order is now Photo → Effects → Overlay → Text.
  // Previously effects rendered ABOVE overlays, which let a vignette /
  // grain bleed onto branded chrome (logos, scoreboards, lower-thirds)
  // and made overlays look dirty. Effects are a *photo treatment* and
  // should never affect the overlay layer.

  // Layer 2: Effects (built-in + uploaded) — applied to the photo layer
  // only. When there's no photo we still render team-gradient because
  // it composites cleanly against the team-color empty state.
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

  // Layer 3: Overlay template PNG (sits on top of effects so brand
  // chrome stays sharp regardless of how heavy the effects stack is).
  if (overlayImg) {
    ctx.drawImage(overlayImg, 0, 0, w, h);
  }

  // v4.5.31: Layer 3.5 — Stat Card. Drawn between the overlay layer
  // and the text layer so brand chrome can frame it from above (overlay)
  // and captions/credits can sit on top of it (text fields below).
  // The card is rendered programmatically by stat-card-renderer.js
  // using canvas primitives — same visual treatment as the player
  // page card (rounded white BG, team-color accent bar, savant
  // percentile bubbles or two-column raw stats).
  if (statCard?.cardType && statCard?.player && statCard?.box) {
    statCardRender(ctx, statCard);
  }

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
      // v4.5.37: Headline pill treatment — when this field is the
      // template's largest and the toggle is on, swap to Winner Sans
      // and draw a team-colored rounded rectangle behind the text.
      // Pill width hugs the text + padding; height grows with fontSize.
      // White-on-team-color reads at every photo brightness, with a
      // subtle dark shadow under the pill for separation from the bg.
      const isHeadlinePill = headlineEnabled && f.key === headlineKey && hasValue;
      // v4.5.42: pill renders in whichever font the user picked from
      // the headline font picker (winner / heading / press / united /
      // gotham / etc). Falls back to the field's own font if the key
      // is unknown so we never render in default-serif.
      const fontKey = isHeadlinePill ? headlineFont : f.font;
      ctx.fillStyle = isHeadlinePill ? '#FFFFFF' : (f.color || '#FFFFFF');
      ctx.font = `${f.fontSize}px ${FONT_MAP[fontKey] || FONT_MAP.body}`;
      ctx.textAlign = f.align || 'center';
      if (!hasValue) ctx.globalAlpha = 0.32;

      if (isHeadlinePill) {
        // v4.5.61: pill 15% tighter against the text per master direction.
        // padX 0.5 → 0.425, padY 0.22 → 0.187. Both axes pulled the same
        // % so the pill stays visually balanced — wider on the X is
        // still proportional to its height.
        const padX = Math.round(f.fontSize * 0.425);
        const padY = Math.round(f.fontSize * 0.187);
        const measured = ctx.measureText(text);
        const textW = Math.min(measured.width, f.maxWidth || measured.width);
        const pillW = textW + padX * 2;
        // v4.5.43: Center the pill on the *actually-rendered* glyphs
        // instead of a baked 0.78×fontSize ascent constant. The old
        // approximation undershot Winner Sans (cap height ~0.85fs) so
        // the pill sat too low — visible whitespace below the
        // baseline outweighed whitespace above the cap. Using
        // ctx.measureText().actualBoundingBox{Ascent,Descent} pulls
        // the real per-font extents at the active fontSize, so the
        // pill auto-recenters for whatever face the picker selected
        // (winner / heading / press / united / gotham / condensed).
        // Falls back to a sensible 0.74/0.20 split if the metrics
        // aren't available (older WebKit on iOS < 11.3).
        const ascent = (typeof measured.actualBoundingBoxAscent === 'number' && measured.actualBoundingBoxAscent > 0)
          ? measured.actualBoundingBoxAscent
          : f.fontSize * 0.74;
        const descent = (typeof measured.actualBoundingBoxDescent === 'number' && measured.actualBoundingBoxDescent >= 0)
          ? measured.actualBoundingBoxDescent
          : f.fontSize * 0.20;
        const visibleH = ascent + descent;
        const pillH = visibleH + padY * 2;
        const pillY = (f.y - ascent) - padY;
        let pillX;
        if ((f.align || 'center') === 'left')        pillX = f.x - padX;
        else if ((f.align || 'center') === 'right')  pillX = f.x - pillW + padX;
        else                                          pillX = f.x - pillW / 2;
        // v4.5.61: corners further tightened. Was pillH * 0.18 capped at
        // 24px — still read as too pill-shaped at large headlines. Now
        // pillH * 0.10 capped at 14px so the pill looks closer to a
        // chip / cut-stone than a button.
        const radius = Math.min(Math.round(pillH * 0.10), 14);
        ctx.save();
        ctx.fillStyle = team?.color || '#DC2626';
        ctx.shadowColor   = 'rgba(0,0,0,0.32)';
        ctx.shadowBlur    = 16;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
        drawRoundRect(ctx, pillX, pillY, pillW, pillH, radius);
        ctx.fill();
        ctx.restore();
        // Reset fill style for the text pass.
        ctx.fillStyle = '#FFFFFF';
      }

      // v4.6.1: 2-line wrap is now scoped tightly to avoid the
      // "filler text reads as broken multi-line stack at design time"
      // problem master flagged on news + hype. Behavior now:
      //   • News / Hype / etc.: revert to canvas squeeze (truncation).
      //   • Blank Slate + Stat Card: wrap allowed BUT ONLY when the
      //     headline pill is toggled on. The pill itself never wraps
      //     (skip when f.key === headlineKey), but the supporting
      //     caption fields under it can fold to two lines so the
      //     pill+caption block reads as a paragraph.
      const wrapEligibleTemplate = (templateType === 'blank-slate' || templateType === 'stat-card');
      const wrapAllowedHere = wrapEligibleTemplate
        && headlineEnabled
        && !isHeadlinePill
        && f.maxWidth;
      const splitTwoLines = (str) => {
        const words = String(str).split(/\s+/);
        if (words.length < 2) return [str, ''];
        // Binary-search-ish: try splits, pick the one that minimizes
        // |line1.width - line2.width| while keeping both ≤ maxWidth.
        let best = null;
        for (let i = 1; i < words.length; i++) {
          const a = words.slice(0, i).join(' ');
          const b = words.slice(i).join(' ');
          const aw = ctx.measureText(a).width;
          const bw = ctx.measureText(b).width;
          if (aw <= f.maxWidth && bw <= f.maxWidth) {
            const balance = Math.abs(aw - bw);
            if (!best || balance < best.balance) best = { a, b, balance };
          }
        }
        return best ? [best.a, best.b] : [str, ''];
      };
      const draw = () => {
        const naturalW = ctx.measureText(text).width;
        const shouldWrap = wrapAllowedHere && naturalW > f.maxWidth;
        if (shouldWrap) {
          const [a, b] = splitTwoLines(text);
          // Line spacing: ~1.05× the font size so the two lines read
          // as a paragraph block, not split chunks. Top line shifts
          // up by 0.55×fontSize, bottom line down by 0.55×fontSize.
          const lh = Math.round(f.fontSize * 1.05);
          ctx.fillText(a, f.x, f.y - lh / 2, f.maxWidth);
          if (b) ctx.fillText(b, f.x, f.y + lh / 2, f.maxWidth);
        } else if (f.maxWidth) {
          ctx.fillText(text, f.x, f.y, f.maxWidth);
        } else {
          ctx.fillText(text, f.x, f.y);
        }
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

  // v4.5.15: mobile detection — drives placement of the Template Type card.
  // On desktop it lives above the preview (right column) since picking a
  // template fundamentally changes what the canvas shows. On mobile the
  // right column drops below the left, so the Template Type card was
  // buried under Team / Player / Media / Overlay / Effects / Download —
  // counter-intuitive when it's the first decision the user needs to make.
  // We render the SAME card in both spots and gate visibility on isMobile.
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

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
  // Fields the user has explicitly toggled off — no placeholder in preview, no text in export.
  // v4.5.37: For templates that ship with their dynamic content baked into
  // the imagery (Hype/Promo, Blank Slate, Stat Card), every text field
  // starts HIDDEN by default. The designer can flip individual fields
  // back on as needed — but the canvas should never auto-render
  // "Headline / Subtext / Team" placeholder text on a clean photo.
  const [hiddenFields, setHiddenFields] = useState(() => defaultHiddenFieldsFor(
    (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('template'))
      || 'player-stat',
    'portrait',
  ));
  const [overlays, setOverlays] = useState([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState(null);
  const [overlayImg, setOverlayImg] = useState(null);
  const [bgImg, setBgImg] = useState(null);
  const [bgUrl, setBgUrl] = useState(null);
  // Pan/zoom + exposure adjustments — applied to the background image only.
  // Reset whenever a new bgImg loads so each photo starts from identity.
  const [bgTransform, setBgTransform] = useState(DEFAULT_BG_TRANSFORM);
  const [playerMedia, setPlayerMedia] = useState([]);
  // v4.5.66: "Browse larger" media picker — opens a fullscreen-ish
  // modal with much bigger tiles when there are >6 media items.
  // Sidesteps the cramped 72px grid for players with deep archives.
  const [bigPickerOpen, setBigPickerOpen] = useState(false);
  // v4.5.67: split-screen mode (blank-slate only). When on, the
  // canvas renders bgImg in the top half and bgImg2 in the bottom
  // half with a white hairline divider. Second photo gets its own
  // upload / picker slot; v1 has no per-half pan/zoom.
  const [splitScreen, setSplitScreen] = useState(false);
  const [bgImg2, setBgImg2] = useState(null);
  const [bgUrl2, setBgUrl2] = useState(null);
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

  // v4.5.37 / v4.5.42: Headline pill picker. State is the FONT_MAP key
  // for the picked face, or null when off. Defaulting to null keeps
  // backward-compatible behavior (no pill) — flipping a chip in the
  // UI sets it to that font and re-renders. The five-chip picker
  // lives in the Custom-mode controls (see HEADLINE_FONT_CHOICES).
  const [headlineFont, setHeadlineFont] = useState(null);

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

  // v4.5.31: Stat Card type picker state. Only used when customType ===
  // 'stat-card'. Defaults to hitting-stats; user picks one of the four
  // sub-types to drive the card content. Resets to hitting-stats when
  // the template changes so a fresh stat-card always opens with hitting.
  const [statCardType, setStatCardType] = useState('hitting-stats');

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
      // v4.5.37: If the deep-link explicitly populates a field on a
      // template that defaults its text off (Hype/Blank/StatCard), the
      // user's intent IS to render that text — un-hide just those keys.
      setHiddenFields(prev => {
        if (!prev || prev.size === 0) return prev;
        const next = new Set(prev);
        for (const k of Object.keys(params)) next.delete(k);
        return next;
      });
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
    // v4.5.62: number-first stat-line format per master direction.
    // "OPS+ 117 | AVG .315" reads like a label-then-value pair; the
    // broadcast / front-office convention is value-then-label so the
    // number lands first ("117 OPS+ | .315 AVG"). Same shape applied
    // to every suggestion in buildRecommendations.
    const statLine = batter
      ? `${batter.ops_plus} OPS+ | ${batter.avg} AVG | ${batter.hr} HR | ${batter.obp} OBP`
      : pitcher
        ? `${pitcher.fip.toFixed(2)} FIP | ${pitcher.ip} IP | ${pitcher.w} W | ${pitcher.k4} K/4`
        : '';

    // Per-template field shape:
    //   player-stat (Team/Player News) — three free-form lines.
    //   pitching-leaders (Player of the Game) — three stat boxes.
    //   highlight / hype — legacy keys (playerName/number/teamName/statLine).
    let newFields;
    if (customType === 'player-stat') {
      newFields = {
        line1: p.name,
        line2: statLine || (teamObj?.name || p.team),
        line3: mediaJersey ? `#${mediaJersey} · ${teamObj?.name || p.team}` : (teamObj?.name || p.team),
      };
    } else if (customType === 'pitching-leaders') {
      // v4.5.18 + v4.5.19: Player of the Game — three boxes laid
      // horizontally (think scoreboard). Each box holds ONE short
      // value (a number, an inning count, etc.) so the layout reads
      // at a glance. Auto-fill picks the three most salient season
      // numbers as a starting point; the user wipes and replaces
      // with the actual game performance via the form fields.
      //   batter  → HR · AVG · OPS+
      //   pitcher → IP · K/4 · W
      //   neither → empty (user types the game stats by hand)
      const box = batter
        ? { statBox1: String(batter.hr ?? ''), statBox2: String(batter.avg ?? ''), statBox3: String(batter.ops_plus ?? '') }
        : pitcher
          ? { statBox1: String(pitcher.ip ?? ''), statBox2: pitcher.k4 != null ? String(pitcher.k4) : '', statBox3: String(pitcher.w ?? '') }
          : { statBox1: '', statBox2: '', statBox3: '' };
      newFields = box;
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

  // v4.5.31: build the statCard option payload when the active template
  // wants one. The renderer needs the resolved player object (with
  // batting/pitching), team, leaders for percentile lookup, and the
  // box geometry — all derived from existing state.
  const statCardOption = useMemo(() => {
    const t = TEMPLATE_TYPES[customType];
    if (!t?.rendersStatCard) return null;
    if (!selectedPlayer) return null;
    const p = (allPlayers || []).find(pl => `${pl.team}_${pl.name}` === selectedPlayer);
    if (!p) return null;
    // Fold live stats into the player object so the renderer has them.
    const battingPool = liveBatting.length ? liveBatting : BATTING_LEADERS;
    const pitchingPool = livePitching.length ? livePitching : PITCHING_LEADERS;
    const batter = battingPool.find(b => b.name === p.name && b.team === p.team) || null;
    const pitcher = pitchingPool.find(b => b.name === p.name && b.team === p.team) || null;
    const customTeamObj = getTeam(customTeam);
    const enriched = { ...p, batting: batter, pitching: pitcher };
    return {
      cardType: statCardType,
      player: enriched,
      box: defaultCardBox(customPlatform, statCardType),
      team: customTeamObj,
      leaders: { batting: battingPool, pitching: pitchingPool },
    };
  }, [customType, selectedPlayer, liveBatting, livePitching, customTeam, customPlatform, statCardType]);

  // ── Render ──
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = customPlat.w; canvas.height = customPlat.h;
    const ctx = canvas.getContext('2d');
    const fieldConfig = applyOverrides(getFieldConfig(customType, customPlatform), customType, customPlatform);
    const customTeamObj = getTeam(customTeam);
    renderCustomTemplate(ctx, customPlat.w, customPlat.h, bgImg, overlayImg, customFields, fieldConfig, activeEffects, customTeamObj, { hiddenFields, bgTransform, statCard: statCardOption, headlineFont, templateType: customType, splitScreen: customType === "blank-slate" && splitScreen, bgImg2 });
  }, [customType, customTeam, customPlatform, customFields, bgImg, overlayImg, customPlat, activeEffects, hiddenFields, bgTransform, overridesVersion, statCardOption, headlineFont, splitScreen, bgImg2]);

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
    // v4.5.48: also re-render once the prowiffleball.com logo SVG
    // finishes loading so it appears on the FIRST stat-card paint
    // instead of popping in on the next user interaction. Cheap —
    // the promise resolves in <50 ms on a warm cache and is cached
    // across renders so subsequent stat cards have it instantly.
    ensureProwiffleLogoReady().then(() => {
      if (!cancelled) renderRef.current();
    });
    return () => { cancelled = true; };
  }, []);

  // v4.5.37: download() takes an optional scale multiplier. Standard
  // download (1×) renders to the visible canvas at native template
  // size. HD download (2×) renders to an offscreen canvas at double
  // the resolution — every layer (background, overlay, effects, text,
  // stat card) is drawn from primitives at the larger size, so the
  // output is genuinely sharper, not just an upscaled bitmap. PNG
  // file size grows roughly 3–4× but every glyph + edge stays crisp
  // when designers print, post to Twitter (which doesn't downsample
  // 2160px exports as aggressively), or composite into a video.
  const download = (scale = 1) => {
    const previewCanvas = canvasRef.current;
    if (!previewCanvas) return;
    const fieldConfig = applyOverrides(getFieldConfig(customType, customPlatform), customType, customPlatform);
    const customTeamObj = getTeam(customTeam);

    let exportCanvas;
    if (scale > 1) {
      // Offscreen canvas at the higher resolution. Renderer scales
      // every coordinate by `scale`, so text positions/sizes stay in
      // proportion to the canvas instead of getting interpolated.
      exportCanvas = document.createElement('canvas');
      exportCanvas.width = customPlat.w * scale;
      exportCanvas.height = customPlat.h * scale;
      const ectx = exportCanvas.getContext('2d');
      ectx.scale(scale, scale);
      renderCustomTemplate(
        ectx, customPlat.w, customPlat.h, bgImg, overlayImg,
        customFields, fieldConfig, activeEffects, customTeamObj,
        { hiddenFields, forExport: true, bgTransform, statCard: statCardOption, headlineFont, templateType: customType, splitScreen: customType === "blank-slate" && splitScreen, bgImg2 },
      );
    } else {
      // Standard 1× — re-render the visible canvas without placeholders.
      const ctx = previewCanvas.getContext('2d');
      renderCustomTemplate(
        ctx, customPlat.w, customPlat.h, bgImg, overlayImg,
        customFields, fieldConfig, activeEffects, customTeamObj,
        { hiddenFields, forExport: true, bgTransform, statCard: statCardOption, headlineFont, templateType: customType, splitScreen: customType === "blank-slate" && splitScreen, bgImg2 },
      );
      exportCanvas = previewCanvas;
    }

    const hdSuffix = scale > 1 ? '_HD' : '';
    // v4.5.37: filename matches the in-app post label —
    // {Name}_{Template}_{MM/DD/YY}.png (with _HD suffix at 2× scale).
    // Slashes in the date stamp are filename-illegal on most operating
    // systems, so the date here uses dashes; the dashboard label uses
    // slashes for human reading. Both come from the same data via
    // formatPostName, so changing one source updates both.
    //
    // v4.5.54: also strip dots and asterisks from the filename body.
    // Dots in the middle of a filename can confuse Safari's download
    // handler — if the user's name was "J.J. Smith" or the template
    // produced "POST 2.2", macOS sometimes parses ".png" as a second
    // extension and saves the file as a generic document. Replacing
    // every `.` in the body with `-` guarantees the only dot is the
    // one that opens the `.png` extension at the end.
    const niceName = formatPostName(
      { templateType: customType, team: customTeam, settings: { fields: customFields }, createdAt: new Date() },
      getTeam,
    ) || `BLW_${customTeam}_${customType}_${customPlatform}`;
    const safeName = niceName.replace(/[/\\:?"<>|.*]/g, '-');
    const filename = `${safeName}${hdSuffix}.png`;

    // v4.5.54: Post-download bookkeeping — runs after the file
    // actually lands on disk. Pulled into a closure so the toBlob
    // callback below can invoke it.
    const finishDownloadBookkeeping = () => {
      // Log the generation to Supabase so the dashboard "Recent posts"
      // strip and Settings download history have something to show.
      // We build a small thumbnail (~400 px wide) via an offscreen
      // canvas so the stored image is dashboard-sized, not full
      // 1080× resolution.
      try {
        const thumb = document.createElement('canvas');
        const targetW = 400;
        const thumbScale = targetW / customPlat.w;
        thumb.width = targetW;
        thumb.height = Math.round(customPlat.h * thumbScale);
        const tctx = thumb.getContext('2d');
        // Always use the visible preview canvas for the thumbnail —
        // the HD offscreen canvas is throwaway after the download.
        tctx.drawImage(previewCanvas, 0, 0, thumb.width, thumb.height);
        const thumbnailDataUrl = thumb.toDataURL('image/png');
        cloud.logGenerate({
          id: crypto.randomUUID(),
          team: customTeam,
          templateType: customType,
          platform: customPlatform,
          // Snapshot what made this composition — lets us restore it
          // from the dashboard / settings history via URL params.
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
      const hdLabel = scale > 1 ? ` · HD ${customPlat.w * scale}×${customPlat.h * scale}` : '';
      toast.success('Downloaded', { detail: `${customTeam} · ${customType} · ${customPlat.label}${hdLabel}` });
    };

    // v4.5.54: BLOB-based download instead of toDataURL.
    // Pre-fix: link.href = canvas.toDataURL('image/png') worked
    // reliably for standard 1× exports (~500KB base64) but FAILED
    // intermittently on 2× HD exports (~4-8MB base64). Safari has a
    // hard cap on data: URLs in `link.download` — when the URL
    // exceeds the cap, Safari silently degrades to "open in new tab"
    // and the OS-suggested filename loses its `.png` extension,
    // resulting in files saved as generic documents (the "0526 POST
    // 2.2" symptom).
    //
    // Blob URLs have no size cap and every browser honors the
    // download attribute reliably. canvas.toBlob is async so the
    // bookkeeping that used to be linear is now wrapped in the
    // callback above.
    exportCanvas.toBlob((blob) => {
      if (!blob) {
        toast.error('Couldn\'t generate the PNG', {
          detail: 'Browser refused canvas.toBlob — usually a cross-origin taint. Try removing the headline pill or stat card and re-exporting.',
        });
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = filename;
      link.href = objectUrl;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      // Defer revocation past the click so Safari has time to read
      // the blob — revoking too soon truncates the download on
      // slower disk writes.
      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
        link.remove();
      }, 1000);
      finishDownloadBookkeeping();
    }, 'image/png');
  };

  const toggleFieldHidden = (key) => {
    setHiddenFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // v4.5.63: stat-card-only download. Sized to the card's own box
  // (no full-canvas crop) so the file weight is small + the card
  // sits flush against the edges. Transparent everywhere outside
  // the card so designers can stack it on any background.
  const downloadStatCardOnly = (scale = 2) => {
    if (customType !== 'stat-card' || !statCardOption) return;
    const box = defaultCardBox(customPlatform, statCardType);
    const out = document.createElement('canvas');
    out.width = Math.round(box.w * scale);
    out.height = Math.round(box.h * scale);
    const ctx = out.getContext('2d');
    ctx.scale(scale, scale);
    // Translate so the renderer can keep its box.x/box.y math intact
    // but the card lands at (0,0) in the output canvas.
    ctx.translate(-box.x, -box.y);
    statCardRender(ctx, statCardOption);

    const niceName = formatPostName(
      { templateType: 'stat-card', team: customTeam, settings: { fields: customFields }, createdAt: new Date() },
      getTeam,
    ) || `BLW_${customTeam}_stat-card`;
    const safeName = niceName.replace(/[/\\:?"<>|.*]/g, '-');
    const filename = `${safeName}_CARD-ONLY.png`;
    out.toBlob((blob) => {
      if (!blob) { toast.error('Couldn\'t export stat card'); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = filename;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Stat card exported', { detail: `${box.w * scale}×${box.h * scale}px · transparent` });
    }, 'image/png');
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

  // v4.5.17: deep-link entry point from Files preview "Download via
  // Studio" — URL carries ?bgMediaId=<media.id>. Look up the media
  // record in IndexedDB and load it as the background. Fires once on
  // mount; clears the param on first apply so a manual change to the
  // template URL doesn't keep re-applying.
  const [bgMediaIdParam] = useState(() => searchParams.get('bgMediaId') || '');
  useEffect(() => {
    if (!bgMediaIdParam) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await import('../media-store').then(m => m.getAllMedia());
        if (cancelled) return;
        const found = all.find(x => x.id === bgMediaIdParam);
        if (!found?.blob) return;
        const url = URL.createObjectURL(found.blob);
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          setBgUrl(url);
          setBgImg(img);
          setBgTransform(DEFAULT_BG_TRANSFORM);
        };
        img.src = url;
      } catch { /* media-store not ready or media missing — silent */ }
    })();
    return () => { cancelled = true; };
  }, [bgMediaIdParam]);

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
    // v4.5.62: news template can letterbox via zoom < 1×; clamp at 0.5.
    const minZoom = customType === 'player-stat' ? 0.5 : 1;
    setBgTransform(t => {
      const z = Math.max(minZoom, Math.min(4, t.zoom * factor));
      return { ...t, zoom: z };
    });
  }, [bgImg, showLayoutEditor, customType]);

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
      // v4.5.46: saveOverlay now AWAITS the cloud sync inline and
      // stamps `cloudSyncedAt` on the returned record (or
      // `cloudSyncError` on failure). The progress counter reflects
      // local saves; the success/failure split is reported in the
      // toast below from the actual record state.
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

    // v4.5.46: per-record cloud-sync outcome reporting. Counts how
    // many of the just-saved overlays actually made it to the cloud
    // (visible to other admins) vs landed local-only. The toast tells
    // the master what really happened so they don't think a silent
    // 500 means "everything synced." Local-only records get an amber
    // dot in the picker + a Retry action.
    const cloudOk = saved.filter(r => r.cloudSyncedAt).length;
    const localOnly = saved.length - cloudOk;
    if (saved.length === 1) {
      if (cloudOk === 1) {
        toast.success('Overlay saved + synced to cloud', { detail: 'Visible to other admins on their next refresh.' });
      } else {
        toast.error('Saved locally — cloud sync failed', {
          detail: `${saved[0].cloudSyncError || 'Unknown error'} — open the picker and click ↻ to retry.`,
        });
      }
    } else {
      if (localOnly === 0) {
        toast.success(`${cloudOk} overlays saved + synced`, { detail: 'All visible to other admins on their next refresh.' });
      } else if (cloudOk === 0) {
        toast.error(`${saved.length} saved locally — none reached the cloud`, {
          detail: 'Open the picker and use "↻ Sync local-only overlays" to retry.',
        });
      } else {
        toast.error(`${cloudOk} synced · ${localOnly} stuck local-only`, {
          detail: 'Open the picker and use "↻ Sync local-only overlays" to retry the rest.',
        });
      }
    }
  };

  // v4.5.46: per-overlay manual retry handler. Called from the picker's
  // amber-dot tile when master-admin clicks ↻ on a stuck overlay.
  const retryOverlaySync = useCallback(async (id) => {
    const updated = await resyncOverlay(id);
    if (!updated) return;
    setOverlays(prev => prev.map(o => o.id === id ? updated : o));
    if (updated.cloudSyncedAt) {
      toast.success('Synced to cloud', { detail: `"${updated.name}" is now visible to other admins.` });
    } else {
      toast.error('Sync still failing', { detail: updated.cloudSyncError || 'Try again in a moment.' });
    }
  }, [toast]);

  // v4.5.46: bulk retry — walk every local-only overlay in IndexedDB
  // and push each in sequence. Fires from the "↻ Sync local-only"
  // button at the top of the overlay picker. Sequential by design so
  // a transient flaky network doesn't take down the whole batch.
  const resyncAllLocalOnly = useCallback(async () => {
    toast.info?.('Resyncing local-only overlays…') ?? toast.success('Resyncing local-only overlays…');
    const summary = await resyncAllLocalOnlyOverlays();
    // Refresh state from IDB so the indicators update.
    const fresh = await getOverlays();
    setOverlays(fresh);
    if (summary.total === 0) {
      toast.success('Nothing to resync', { detail: 'Every overlay is already in the cloud.' });
    } else if (summary.failed === 0) {
      toast.success(`${summary.synced} overlay${summary.synced === 1 ? '' : 's'} pushed to cloud`);
    } else {
      toast.error(`${summary.synced}/${summary.total} synced · ${summary.failed} still failing`, {
        detail: 'Failures often retry-clear after a refresh. The stuck ones will keep their amber dot.',
      });
    }
  }, [toast]);

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
  // v4.5.37: Component-level reference to the team object — used by the
  // Headline toggle UI to tint the active state in the team's color. The
  // render callbacks below also resolve this independently for stable
  // useCallback dependencies.
  const customTeamObj = useMemo(() => getTeam(customTeam), [customTeam]);
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

  // v4.5.18: thumbnail URLs for uploaded overlays. Match the preset
  // tile aesthetic — image-as-background instead of a dark text tile.
  // useMemo keyed on the overlay ids so we don't reallocate every
  // re-render; revoke on cleanup so we don't leak object URLs after
  // the tile unmounts (e.g., when the user changes team / template).
  const overlayThumbUrls = useMemo(() => {
    const map = new Map();
    for (const o of filteredOverlays) {
      if (o.imageBlob) {
        try { map.set(o.id, URL.createObjectURL(o.imageBlob)); }
        catch { /* blob may be revoked or absent — tile falls back to dark */ }
      }
    }
    return map;
  }, [filteredOverlays.map(o => o.id).join(',')]);
  useEffect(() => () => {
    // Revoke every URL we allocated when the map changes or on unmount.
    for (const url of overlayThumbUrls.values()) {
      try { URL.revokeObjectURL(url); } catch {}
    }
  }, [overlayThumbUrls]);

  // Format an uploaded overlay's display name. Strip the file extension,
  // turn underscores / dashes into spaces, title-case the result so a
  // raw filename like "DAL_GAME_DAY_FEED_v1.png" reads as
  // "DAL Game Day Feed v1" — much friendlier than the raw filename.
  const formatOverlayName = (rawName) => {
    if (!rawName) return 'Overlay';
    return String(rawName)
      .replace(/\.[^.]+$/, '')          // drop extension
      .replace(/[_\-]+/g, ' ')          // _ / - → space
      .replace(/\s+/g, ' ').trim();
  };
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

  // v4.5.62 / v4.5.63: Template Type card pulled BELOW Player + smaller
  // tiles + grey-out for overlay-required templates that have no
  // overlays for the active team. Click on a greyed tile prompts
  // for an overlay upload instead of silently entering a template
  // that'll just render the raw photo + text.
  // Templates that ship without overlays — they own their own chrome,
  // so the lack of an overlay isn't a foot-gun.
  const TEMPLATES_OK_WITHOUT_OVERLAY = new Set(['blank-slate', 'stat-card']);
  const templateTypeCard = (
    <Card style={{ padding: 14 }}>
      <Label style={{ marginBottom: 6 }}>Template</Label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(78px, 1fr))', gap: 6 }}>
        {Object.entries(TEMPLATE_TYPES).map(([key, t]) => {
          const presetCountForTemplate = customTeam ? getPresetOverlays(customTeam, key).length : 0;
          const uploadedCountForTemplate = overlays.filter(o => o.type === key && (!o.team || o.team === customTeam)).length;
          const totalOverlays = presetCountForTemplate + uploadedCountForTemplate;
          const needsOverlay = !TEMPLATES_OK_WITHOUT_OVERLAY.has(key);
          const greyed = customTeam && needsOverlay && totalOverlays === 0;
          return (
            <button
              key={key}
              onClick={() => {
                if (greyed) {
                  // Prompt the user to upload an overlay. We can't trigger
                  // the file picker programmatically without a user gesture
                  // landing on the input element itself, so show a toast
                  // pointing them to the upload affordance + still set the
                  // template so they see the "no overlays" empty state in
                  // the picker below.
                  toast.warn(
                    `No ${t.name} overlays for ${customTeam} yet`,
                    { detail: 'Upload one from the Overlay card below (or pick Blank Slate / Stat Card — those don\'t need overlays).' }
                  );
                  return;
                }
                setCustomType(key);
                setCustomFields({});
                setHiddenFields(defaultHiddenFieldsFor(key, customPlatform));
                setSelectedOverlayId(null);
                setOverlayImg(null);
                setHeadlineFont(null);
              }}
              title={greyed
                ? `No overlays uploaded for ${customTeam} + ${t.name}. Click to see how to add one.`
                : t.description || t.name}
              style={{
                background: customType === key ? colors.accentSoft : colors.white,
                border: customType === key ? `1px solid ${colors.accent}` : `1px solid ${colors.border}`,
                color: customType === key ? colors.accent : colors.textSecondary,
                borderRadius: radius.base, padding: '5px 4px',
                cursor: greyed ? 'not-allowed' : 'pointer',
                opacity: greyed ? 0.45 : 1,
                fontFamily: fonts.condensed, fontSize: 9, fontWeight: 700, textAlign: 'center',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                letterSpacing: 0.3, lineHeight: 1.15,
                position: 'relative',
              }}
            >
              <TemplatePreview
                templateKey={key}
                platform={customPlatform}
                team={customTeam}
                width={48}
                height={48}
              />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                {t.icon} {t.name}
              </span>
              {greyed && (
                <span style={{
                  position: 'absolute', top: 2, right: 2,
                  fontSize: 8, fontWeight: 800, color: colors.warningText,
                  background: colors.warningBg, border: `1px solid ${colors.warningBorder}`,
                  borderRadius: 2, padding: '0 3px',
                  fontFamily: fonts.condensed, letterSpacing: 0.4,
                }}>NO OVERLAY</span>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );

  // v4.5.20: Effects card extracted so the same JSX can render in the
  // left column (canonical) on desktop, while still giving us the
  // option to place it anywhere we need on mobile. The render-order
  // and on-card layer position now match the conceptual stack:
  // Photo → Effects → Overlay → Text.
  const effectsCard = (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Label style={{ marginBottom: 0 }}>Effects</Label>
        <button onClick={() => setShowEffectUpload(true)} style={{
          background: colors.accentSoft, border: `1px solid ${colors.accentBorder}`,
          color: colors.accent, borderRadius: radius.sm, padding: '3px 10px',
          fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, cursor: 'pointer',
        }}>+ Upload Effect</button>
      </div>
      <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.condensed, marginBottom: 8, fontStyle: 'italic' }}>
        Photo treatments — apply to the photo only. Overlays + text stay sharp.
      </div>

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
  );

  return (
    <TeamThemeScope team={customTeamObjForScope}>
    <div>
      <PageHeader title="STUDIO" subtitle="Create downloadable graphics for any team. Download and schedule via Metricool." />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* CONTROLS */}
        <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* v4.5.15: on mobile, Template Type sits at the very top of
              the controls column so it's the first thing the user sees.
              On desktop it stays in the preview column (next block). */}
          {isMobile && templateTypeCard}
          {/* Custom templates — the only mode.
              Form flow (left col): Team → Player → Media → Overlay → Content
              Template Type lives above the preview (right col) because it
              fundamentally changes what you're looking at. */}
          <>
              {/* 1. Team — Format dropdown removed in v4.5.62. Every BLW
                  post is now 1080×1350 portrait (the IG feed format
                  master is standardizing on), so the format toggle
                  was just an extra click + a source of off-brand
                  exports. The renderer still uses customPlatform
                  ('portrait') under the hood — only the UI is gone. */}
              <Card>
                <Label>Team</Label>
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
                <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.condensed, marginTop: 6, letterSpacing: 0.4 }}>
                  Every post is exported at 1080×1350 (Instagram portrait).
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

              {/* v4.5.62: Template selector sits HERE — below Team
                  (and below Player when the template is player-centric),
                  not floating above the preview anymore. */}
              {!isMobile && templateTypeCard}

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
                    {/* v4.5.61: removed the 120px selection-preview thumbnail —
                        it duplicates the live preview to the right. The
                        chosen tile is highlighted in the grid below, and
                        Clear sits inline with the grid header. */}

                    {/* Media grid — contextual: player's media if selected, else team's */}
                    {playerMediaUrls.length > 0 ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, gap: 8 }}>
                          <div style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 600, color: colors.textMuted, letterSpacing: 0.8 }}>
                            {selectedPlayer ? `PLAYER MEDIA · ${playerMediaUrls.length}` : `TEAM MEDIA · ${playerMediaUrls.length}`}
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                            {/* v4.5.66: >6 photos → "Browse larger" opens a
                                modal with bigger tiles so users can actually
                                see the photo content instead of squinting
                                at 72px thumbnails. */}
                            {playerMediaUrls.length > 6 && (
                              <button onClick={() => setBigPickerOpen(true)} style={{
                                background: colors.accentSoft, color: colors.accent,
                                border: `1px solid ${colors.accentBorder}`,
                                borderRadius: radius.sm, padding: '3px 10px',
                                fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                                cursor: 'pointer', letterSpacing: 0.4,
                              }}>🔍 Browse larger ({playerMediaUrls.length})</button>
                            )}
                            {bgUrl && (
                              <button onClick={() => { setBgImg(null); setBgUrl(null); }} style={{
                                background: 'none', border: 'none', color: colors.accent, fontSize: 10,
                                fontFamily: fonts.condensed, fontWeight: 700, cursor: 'pointer',
                                letterSpacing: 0.4,
                              }}>✕ Clear selection</button>
                            )}
                          </div>
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

              {/* v4.5.67: Split-screen toggle — blank-slate only.
                  When on, the canvas stacks two photos top/bottom
                  with a white hairline divider. The second photo
                  has its own upload affordance below the toggle. */}
              {customType === 'blank-slate' && (
                <Card>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <Label style={{ marginBottom: 0 }}>Split screen</Label>
                    <button
                      onClick={() => {
                        setSplitScreen(prev => {
                          const next = !prev;
                          if (!next) { setBgImg2(null); setBgUrl2(null); }
                          return next;
                        });
                      }}
                      style={{
                        background: splitScreen ? (customTeamObj?.color || colors.accent) : colors.white,
                        color: splitScreen ? '#FFFFFF' : colors.textSecondary,
                        border: `1px solid ${splitScreen ? (customTeamObj?.color || colors.accent) : colors.border}`,
                        borderRadius: radius.full, padding: '6px 14px',
                        fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800,
                        letterSpacing: 0.5, textTransform: 'uppercase',
                        cursor: 'pointer',
                      }}
                    >{splitScreen ? 'ON' : 'OFF'}</button>
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, lineHeight: 1.45, fontStyle: 'italic', marginBottom: splitScreen ? 12 : 0 }}>
                    Stack two photos top/bottom in the canvas. The top photo is whichever you've already picked above; the bottom photo uses the second slot below.
                  </div>
                  {splitScreen && (
                    <div>
                      <div style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, color: colors.textMuted, letterSpacing: 0.8, marginBottom: 6, textTransform: 'uppercase' }}>
                        Bottom photo
                      </div>
                      {bgUrl2 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 100, aspectRatio: '1 / 1', borderRadius: radius.base,
                            background: `url(${bgUrl2}) center/cover`,
                            border: `1px solid ${colors.border}`,
                          }} />
                          <button onClick={() => { setBgImg2(null); setBgUrl2(null); }} style={{
                            background: 'none', border: 'none', color: colors.accent, fontSize: 11,
                            fontFamily: fonts.condensed, fontWeight: 700, cursor: 'pointer',
                            letterSpacing: 0.4,
                          }}>✕ Clear</button>
                        </div>
                      ) : (
                        <label style={{
                          display: 'block', cursor: 'pointer',
                          border: `2px dashed ${colors.border}`, borderRadius: radius.base,
                          padding: 18, textAlign: 'center', background: colors.bg,
                          fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                          color: colors.textSecondary, letterSpacing: 0.4,
                        }}>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file || !file.type.startsWith('image/')) return;
                              const url = URL.createObjectURL(file);
                              setBgUrl2(url);
                              const img = new Image();
                              img.onload = () => setBgImg2(img);
                              img.src = url;
                              e.target.value = '';
                            }}
                            style={{ display: 'none' }}
                          />
                          + Upload bottom-half photo
                        </label>
                      )}
                    </div>
                  )}
                </Card>
              )}

              {/* v4.5.31: Stat Card picker — only shown when the active
                  template renders a stat card. Four sub-types: hitting
                  raw, hitting percentiles, pitching raw, pitching
                  percentiles. The selected type drives the canvas
                  rendering in stat-card-renderer.js. */}
              {customTypeObj?.rendersStatCard && (
                <Card>
                  <Label>Stat Card Type</Label>
                  <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.condensed, marginBottom: 8, fontStyle: 'italic' }}>
                    Pick which card to layer onto the composition. Stats auto-fill from the selected player.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                    {STAT_CARD_TYPES.map(t => {
                      const active = statCardType === t.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => setStatCardType(t.id)}
                          style={{
                            background: active ? colors.accentSoft : colors.white,
                            border: active ? `1px solid ${colors.accent}` : `1px solid ${colors.border}`,
                            color: active ? colors.accent : colors.textSecondary,
                            borderRadius: radius.base, padding: '10px 12px',
                            cursor: 'pointer',
                            textAlign: 'left',
                            display: 'flex', flexDirection: 'column', gap: 4,
                            transition: 'border-color 160ms ease, background 160ms ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 16, color: active ? colors.accent : colors.textMuted }}>{t.icon}</span>
                            <span style={{ fontFamily: fonts.body, fontSize: 12, fontWeight: 700 }}>{t.label}</span>
                          </div>
                          <div style={{
                            fontSize: 10, color: colors.textMuted,
                            fontFamily: fonts.condensed, lineHeight: 1.4,
                          }}>{t.hint}</div>
                        </button>
                      );
                    })}
                  </div>
                  {!selectedPlayer && (
                    <div style={{
                      marginTop: 10, padding: 8,
                      fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed,
                      fontStyle: 'italic', textAlign: 'center',
                      background: colors.bg, borderRadius: radius.sm,
                      border: `1px dashed ${colors.borderLight}`,
                    }}>
                      Pick a player above to populate the card.
                    </div>
                  )}
                </Card>
              )}

              {/* v4.5.61: Headline picker pared back to a single
                  toggle pair — OFF and Winner Sans. The other display
                  faces were producing inconsistent brand expression
                  across posts; locking the headline to Winner Sans
                  keeps the on-pill chyron typography uniform across
                  every team.
                  Click "Winner Sans" to enable; click "OFF" or the
                  active chip again to remove. */}
              {headlineToggleEligible(customType) && (
                <Card>
                  <Label style={{ marginBottom: 4 }}>Headline treatment</Label>
                  <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, lineHeight: 1.45, fontStyle: 'italic', marginBottom: 12 }}>
                    Wraps the title in a team-colored Winner Sans pill — the BLW chyron lockup. Click again to turn off.
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {[
                      { key: null,       label: 'OFF',          familyPreview: null },
                      { key: 'winner',   label: 'Winner Sans',  familyPreview: FONT_MAP.winner },
                    ].map(opt => {
                      const active = headlineFont === opt.key;
                      const isOff = opt.key === null;
                      return (
                        <button
                          key={opt.label}
                          onClick={() => setHeadlineFont(opt.key)}
                          style={{
                            background: active ? (customTeamObj?.color || colors.accent) : colors.white,
                            color: active ? '#FFFFFF' : colors.textSecondary,
                            border: `1px solid ${active ? (customTeamObj?.color || colors.accent) : colors.border}`,
                            borderRadius: radius.full,
                            padding: '6px 14px',
                            fontFamily: opt.familyPreview || fonts.condensed,
                            fontSize: isOff ? 11 : 13, fontWeight: 700,
                            letterSpacing: isOff ? 0.6 : 0.3,
                            textTransform: isOff ? 'uppercase' : 'none',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            boxShadow: active ? '0 4px 10px rgba(15,23,42,0.18)' : 'none',
                            transition: 'background 160ms ease, color 160ms ease, border-color 160ms ease',
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </Card>
              )}

              {/* 3.5 Effects — sits between Picture and Overlay so the
                  on-screen card order mirrors the layer stack. */}
              {effectsCard}

              {/* 4. Overlay Picker — also gated on team. Collapsible like
                  the Media picker; summary surfaces the selected overlay's
                  name when collapsed.
                  v4.5.61: hidden entirely on stat-card and blank-slate.
                  Stat cards have their own header/footer chrome; blank
                  slate is meant to ship a clean canvas with just the
                  background + text. Putting an overlay on either was
                  always a foot-gun. */}
              {customType !== 'stat-card' && customType !== 'blank-slate' && (() => {
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
                        {/* v4.5.46: header now includes a per-team
                            local-only count + bulk resync action.
                            Only renders the badge when there's at
                            least one stuck overlay, so the master
                            sees a clear "you have N to retry" signal. */}
                        {(() => {
                          const localOnlyCount = filteredOverlays.filter(o => !o.cloudSyncedAt).length;
                          return (
                            <div style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              marginBottom: 6, gap: 8, flexWrap: 'wrap',
                            }}>
                              <div style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 600, color: colors.textMuted, letterSpacing: 0.8 }}>
                                UPLOADED · {filteredOverlays.length}
                                {localOnlyCount > 0 && (
                                  <span style={{
                                    marginLeft: 8, color: '#92400E',
                                    background: 'rgba(245,158,11,0.18)',
                                    border: '1px solid rgba(245,158,11,0.4)',
                                    borderRadius: 999, padding: '2px 8px',
                                    fontWeight: 700,
                                  }}>
                                    {localOnlyCount} LOCAL-ONLY
                                  </span>
                                )}
                              </div>
                              {localOnlyCount > 0 && (
                                <button
                                  onClick={resyncAllLocalOnly}
                                  title="Push every local-only overlay to the cloud one at a time. Sequential — a network blip on one doesn't take down the rest."
                                  style={{
                                    background: '#F59E0B', color: '#FFFFFF', border: 'none',
                                    borderRadius: 999, padding: '4px 12px', cursor: 'pointer',
                                    fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
                                  }}
                                >↻ SYNC LOCAL-ONLY ({localOnlyCount})</button>
                              )}
                            </div>
                          );
                        })()}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {filteredOverlays.map(o => {
                            const thumbUrl = overlayThumbUrls.get(o.id);
                            const display = formatOverlayName(o.name);
                            const isCloudSynced = !!o.cloudSyncedAt;
                            return (
                            <div key={o.id} style={{ position: 'relative' }}>
                              <div
                                onClick={() => setSelectedOverlayId(o.id === selectedOverlayId ? null : o.id)}
                                title={isCloudSynced
                                  ? `${display} · synced to cloud ${new Date(o.cloudSyncedAt).toLocaleString()}`
                                  : `${display} · LOCAL ONLY · ${o.cloudSyncError || 'cloud sync failed'} — click ↻ to retry`}
                                style={{
                                  width: 80, height: 80, borderRadius: radius.base, cursor: 'pointer',
                                  background: thumbUrl
                                    ? `#1A1A22 url(${thumbUrl}) center/cover`
                                    : '#1A1A22',
                                  border: selectedOverlayId === o.id
                                    ? `2px solid ${colors.accent}`
                                    : !isCloudSynced
                                      ? `2px solid #F59E0B` // amber rim for local-only
                                      : `1px solid ${colors.border}`,
                                  position: 'relative', overflow: 'hidden',
                                }}
                              >
                                {/* Top-right chip — matches the preset tile so
                                    uploaded overlays read as the same family
                                    of object, just with a different source. */}
                                <div style={{
                                  position: 'absolute', top: 4, right: 4,
                                  background: o.team ? 'rgba(220,38,38,0.85)' : 'rgba(0,0,0,0.65)',
                                  color: '#fff',
                                  borderRadius: 2, padding: '1px 4px',
                                  fontSize: 7, fontFamily: fonts.condensed, fontWeight: 800, letterSpacing: 0.5,
                                }}>
                                  {o.team ? o.team : 'UPLOAD'}
                                </div>
                                {/* v4.5.46: cloud-sync indicator. Green
                                    dot = in cloud, visible to other
                                    admins. Amber dot = local-only,
                                    needs retry. Click amber to retry
                                    THIS overlay specifically. */}
                                <div
                                  onClick={(e) => {
                                    if (isCloudSynced) return;
                                    e.stopPropagation();
                                    retryOverlaySync(o.id);
                                  }}
                                  title={isCloudSynced
                                    ? 'Synced to cloud · visible to other admins'
                                    : `Local only · click to retry sync (${o.cloudSyncError || 'sync failed'})`}
                                  style={{
                                    position: 'absolute', top: 4, left: 4,
                                    width: 14, height: 14, borderRadius: '50%',
                                    background: isCloudSynced ? '#22C55E' : '#F59E0B',
                                    border: '1px solid rgba(0,0,0,0.4)',
                                    cursor: isCloudSynced ? 'default' : 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 9, color: '#fff', fontWeight: 800,
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
                                  }}
                                >
                                  {isCloudSynced ? '✓' : '↻'}
                                </div>
                                {/* Bottom name caption with gradient — same
                                    pattern as the preset tiles. Friendly
                                    formatted name (no underscores / extension). */}
                                <div style={{
                                  position: 'absolute', bottom: 0, left: 0, right: 0,
                                  background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
                                  padding: '2px 4px',
                                  borderRadius: `0 0 ${radius.base}px ${radius.base}px`,
                                  fontSize: 8, color: '#fff', fontFamily: fonts.condensed, fontWeight: 700,
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                  {display}
                                </div>
                              </div>
                              <button onClick={() => handleDeleteOverlay(o.id)} title={`Delete ${display}`} style={{
                                position: 'absolute', top: -4, right: -4, width: 16, height: 16,
                                borderRadius: '50%', background: '#EF4444', color: '#fff',
                                border: 'none', fontSize: 8, cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                zIndex: 1,
                              }}>✕</button>
                            </div>
                            );
                          })}
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

        </div>

        {/* PREVIEW — Template Type sits above the preview on desktop
            because it dictates what the canvas is actually showing.
            On mobile the same card is rendered at the top of the
            controls column instead so the user sees it before any
            other input. Effects panel still sits directly below the
            preview so slider changes are visible without scrolling.

            v4.5.44: Sticky on desktop. The preview + download buttons
            stay pinned in view while the user scrolls the controls
            column — no more "scroll up to confirm, scroll down to
            edit" loop. Download row moved OUT of the controls column
            into here so it's reachable from any scroll position.
            maxHeight + overflowY:auto means a tall right column
            (canvas + photo adjust + download) scrolls internally
            instead of forcing the page to grow. */}
        <div style={{
          flex: '1 1 400px',
          display: 'flex', flexDirection: 'column', gap: 10,
          ...(isMobile ? {} : {
            position: 'sticky',
            top: 70,
            alignSelf: 'flex-start',
            maxHeight: 'calc(100vh - 86px)',
            overflowY: 'auto',
            paddingRight: 4, // breathing room before scrollbar
          }),
        }}>
          {/* v4.5.62: Template card no longer renders here — it lives
              below Player in the left controls column now. */}
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

          {/* v4.5.44: Download row — moved INTO the sticky right column so
              it stays one click away no matter where the user is in
              the controls scroll. Standard = native template size
              (e.g. 1080×1350). HD = 2× resolution rendered from
              primitives for print, prowiffleball.com hero blocks, and
              video composites. */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <RedButton onClick={() => download(1)} style={{ flex: '2 1 auto', padding: '14px 18px', fontSize: 14 }}>
              Download PNG ({customPlat.label})
            </RedButton>
            <OutlineButton
              onClick={() => download(2)}
              title={`Render at 2× — ${customPlat.w * 2}×${customPlat.h * 2}px. Sharper for print, large social, and video composites.`}
              style={{ flex: '1 1 auto', padding: '14px 14px', fontSize: 12, fontWeight: 800, letterSpacing: 0.4 }}
            >
              ⤓ HD 2×
            </OutlineButton>
          </div>
          {/* v4.5.63: stat-card-only download. Renders just the white
              stat card onto a transparent canvas matching the card's
              own dimensions, so designers can drop the card onto a
              video, print page, or different background without
              shipping the full post photo behind it. */}
          {customType === 'stat-card' && statCardOption && (
            <OutlineButton
              onClick={() => downloadStatCardOnly(2)}
              title="Export just the stat card (no background photo) at 2× resolution on a transparent canvas. Drop into Premiere, Keynote, etc."
              style={{ padding: '10px 14px', fontSize: 12, fontWeight: 800, letterSpacing: 0.4 }}
            >
              ⤓ Stat card only (transparent · 2×)
            </OutlineButton>
          )}

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
              {/* v4.5.62: Zoom min dropped 1.00 → 0.5 on team/player news
                  so horizontal source photos (landscape action shots,
                  group photos) can pad-fit inside the portrait canvas
                  without losing the sides. The crop window simply
                  exceeds the source rect; the renderer fills the
                  outside with the background color so it reads as a
                  letterbox. Other templates stay clamped to ≥1.00×
                  because letterboxing them looks broken. */}
              {[
                { key: 'zoom',       label: 'Zoom',       min: customType === 'player-stat' ? 0.5 : 1,   max: 4,   step: 0.01, fmt: v => `${v.toFixed(2)}×` },
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

          {/* v4.5.20: Effects card moved to the left column between Media
              and Overlay so the on-screen order matches the conceptual
              layer stack (Photo → Effects → Overlay → Text). */}

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
        // v4.5.25: portal + body-scroll-lock so the modal centers in the
        // viewport regardless of how far down the page the user is, and
        // any transform-having ancestor in the tree can't break the
        // fixed positioning.
        return createPortal((
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
        ), document.body);
      })()}

      {/* UPLOAD EFFECT MODAL — also via portal so the modal is centered
          on the viewport regardless of scroll position. */}
      {showEffectUpload && createPortal((
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
      ), document.body)}

      {/* v4.5.66: "Browse larger" media picker modal. Same player media
          list as the inline grid but rendered at 200-260px per tile
          so users can actually evaluate the photo content. Click a
          tile to select + close. ESC / click-outside close without
          selecting. */}
      {bigPickerOpen && createPortal((
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setBigPickerOpen(false); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)',
            zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
        >
          <div style={{
            background: colors.white, borderRadius: radius.lg,
            width: '100%', maxWidth: 1100, maxHeight: '90vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 24px 60px rgba(0,0,0,0.42)',
          }}>
            <div style={{
              padding: '14px 20px', borderBottom: `1px solid ${colors.borderLight}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontFamily: fonts.heading, fontSize: 18, letterSpacing: 0.6, color: colors.text }}>
                  Browse player media
                </div>
                <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, letterSpacing: 0.3, marginTop: 2 }}>
                  {playerMediaUrls.length} files · click any to select for this post
                </div>
              </div>
              <button
                onClick={() => setBigPickerOpen(false)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 24, lineHeight: 1, color: colors.textMuted, padding: 4,
                }}
              >×</button>
            </div>
            <div style={{ overflowY: 'auto', padding: 16, flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {playerMediaUrls.map(m => (
                  <button
                    key={m.id}
                    onClick={() => { selectPlayerMediaAsBg(m.url); setBigPickerOpen(false); }}
                    style={{
                      padding: 0, border: bgUrl === m.url ? `3px solid ${colors.accent}` : `1px solid ${colors.border}`,
                      borderRadius: radius.base, overflow: 'hidden', cursor: 'pointer',
                      background: colors.white, textAlign: 'left',
                      transition: 'transform 0.12s ease, box-shadow 0.12s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 10px 24px rgba(0,0,0,0.12)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
                  >
                    <div style={{
                      width: '100%', aspectRatio: '1 / 1',
                      background: `url(${m.url}) center/cover`,
                    }} />
                    <div style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.name}>
                        {m.name}
                      </div>
                      <div style={{ fontSize: 10, fontFamily: fonts.condensed, color: colors.textMuted, marginTop: 2, letterSpacing: 0.3 }}>
                        {m.assetType || 'FILE'}{m.player ? ` · ${m.player}` : ''}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ), document.body)}
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
