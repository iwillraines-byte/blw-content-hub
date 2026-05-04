// Canvas renderer for the four player stat cards: hitting raw stats,
// hitting percentile bubbles, pitching raw stats, pitching percentile
// bubbles. Used by the Studio compositor's "Stat Card" template so a
// designer can drop a player's actual stats onto any composition with
// the same visual treatment as the player page (rounded white card,
// team-colored accent, savant-style percentile bars).
//
// All drawing is canvas-primitive — no html2canvas, no DOM rendering —
// so quality stays crisp at any resolution and the export PNG is
// pixel-perfect at 1080×1080 / 1080×1350 / etc.

import { percentileFor, derivedPercentileFor } from './percentile-bubble';
import { FONT_MAP } from './template-config';

// Mirrors the player-page percentile color scheme. Discrete tiers feel
// more like the Savant reference than a continuous gradient.
function percentileColor(p) {
  if (p == null) return '#CBD5E1';
  if (p >= 90) return '#C8302B';
  if (p >= 75) return '#DA453A';
  if (p >= 60) return '#E07368';
  if (p >= 50) return '#D9A19B';
  if (p >= 40) return '#B5BFC9';
  if (p >= 25) return '#7B95B0';
  if (p >= 10) return '#5C7A99';
  return '#3F5A7A';
}

// Polyfill — Safari and older Chromium versions don't have roundRect.
function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// Format helpers — keep parity with the player page card display.
function formatPctValue(v) {
  if (v == null || v === '' || !Number.isFinite(Number(v))) return '—';
  return `${Number(v).toFixed(1)}%`;
}
function formatRate(num, denom) {
  const n = Number(num);
  const d = Number(denom);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return '—';
  return (n / d).toFixed(3);
}
function safeRate(num, denom) {
  const n = Number(num);
  const d = Number(denom);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

// ─── Card-content builders ──────────────────────────────────────────────────
// Each builder returns an array of rows the renderer iterates. Two row
// shapes:
//   { kind: 'pair', label, value }                    — raw stat
//   { kind: 'bubble', label, value, percentile }      — percentile bar
// Empty/missing values render as "—" so the card stays balanced.

function hittingStatRows(player) {
  const b = player.batting || {};
  return [
    { kind: 'pair', label: 'AVG', value: b.avg ?? '—' },
    { kind: 'pair', label: 'OPS+', value: b.ops_plus ?? '—' },
    { kind: 'pair', label: 'HR', value: b.hr ?? '—' },
    { kind: 'pair', label: 'OBP', value: b.obp ?? '—' },
    { kind: 'pair', label: 'SLG', value: b.slg ?? '—' },
    { kind: 'pair', label: 'OPS', value: b.ops ?? '—' },
    { kind: 'pair', label: 'RBI', value: b.rbi ?? '—' },
    { kind: 'pair', label: 'PA', value: b.pa ?? '—' },
  ];
}

function pitchingStatRows(player) {
  const p = player.pitching || {};
  return [
    { kind: 'pair', label: 'ERA', value: p.era ?? '—' },
    { kind: 'pair', label: 'FIP', value: typeof p.fip === 'number' ? p.fip.toFixed(2) : (p.fip ?? '—') },
    { kind: 'pair', label: 'IP', value: p.ip ?? '—' },
    { kind: 'pair', label: 'W-L', value: `${p.w ?? 0}-${p.l ?? 0}` },
    { kind: 'pair', label: 'K/4', value: p.k4 ?? '—' },
    { kind: 'pair', label: 'WHIP', value: p.whip ?? '—' },
    { kind: 'pair', label: 'K', value: p.k ?? '—' },
    { kind: 'pair', label: 'BB', value: p.bb ?? '—' },
  ];
}

function hittingPercentileRows(player, battingLeaders) {
  const b = player.batting || {};
  return [
    { kind: 'bubble', label: 'AVG', value: b.avg ?? '—',
      percentile: percentileFor(battingLeaders, player.name, 'avg', 'desc', parseFloat) },
    { kind: 'bubble', label: 'OBP', value: b.obp ?? '—',
      percentile: percentileFor(battingLeaders, player.name, 'obp', 'desc', parseFloat) },
    { kind: 'bubble', label: 'SLG', value: b.slg ?? '—',
      percentile: percentileFor(battingLeaders, player.name, 'slg', 'desc', parseFloat) },
    { kind: 'bubble', label: 'OPS', value: b.ops ?? '—',
      percentile: percentileFor(battingLeaders, player.name, 'ops', 'desc', parseFloat) },
    { kind: 'bubble', label: 'BB%', value: formatPctValue(b.bbPct),
      percentile: percentileFor(battingLeaders, player.name, 'bbPct', 'desc', Number) },
    { kind: 'bubble', label: 'K%', value: formatPctValue(b.kPct),
      percentile: percentileFor(battingLeaders, player.name, 'kPct', 'asc', Number) },
    { kind: 'bubble', label: 'HR/PA', value: formatRate(b.hr, b.pa),
      percentile: derivedPercentileFor(battingLeaders, player.name, (r) => safeRate(r.hr, r.pa), 'desc') },
    { kind: 'bubble', label: 'RBI/PA', value: formatRate(b.rbi, b.pa),
      percentile: derivedPercentileFor(battingLeaders, player.name, (r) => safeRate(r.rbi, r.pa), 'desc') },
  ];
}

function pitchingPercentileRows(player, pitchingLeaders) {
  const p = player.pitching || {};
  return [
    { kind: 'bubble', label: 'FIP', value: typeof p.fip === 'number' ? p.fip.toFixed(2) : (p.fip ?? '—'),
      percentile: percentileFor(pitchingLeaders, player.name, 'fip', 'asc', parseFloat) },
    { kind: 'bubble', label: 'ERA', value: p.era ?? '—',
      percentile: percentileFor(pitchingLeaders, player.name, 'era', 'asc', parseFloat) },
    { kind: 'bubble', label: 'WHIP', value: p.whip ?? '—',
      percentile: percentileFor(pitchingLeaders, player.name, 'whip', 'asc', parseFloat) },
    { kind: 'bubble', label: 'K/4', value: p.k4 ?? '—',
      percentile: percentileFor(pitchingLeaders, player.name, 'k4', 'desc', parseFloat) },
    { kind: 'bubble', label: 'IP', value: p.ip ?? '—',
      percentile: percentileFor(pitchingLeaders, player.name, 'ip', 'desc', parseFloat) },
    { kind: 'bubble', label: 'W', value: p.w ?? '—',
      percentile: percentileFor(pitchingLeaders, player.name, 'w', 'desc', parseFloat) },
  ];
}

// ─── Public entry point ────────────────────────────────────────────────────
// cardType: 'hitting-stats' | 'hitting-percentiles' | 'pitching-stats' | 'pitching-percentiles'
// player:   { name, lastName, firstName, num, team, batting?, pitching? }
// box:      { x, y, w, h }    — where to draw the card on the canvas
// team:     TEAMS entry (color, dark, name)
// leaders:  { batting: [...], pitching: [...] } — for percentile lookups

export function renderStatCard(ctx, { cardType, player, box, team, leaders }) {
  if (!player || !box || !cardType) return;
  const { x, y, w, h } = box;
  const accent = team?.color || '#C8302B';
  const accentDark = team?.dark || accent;
  const isPercentile = cardType === 'hitting-percentiles' || cardType === 'pitching-percentiles';
  const isPitching = cardType === 'pitching-stats' || cardType === 'pitching-percentiles';

  // Pick the row source based on card type
  let rows = [];
  if (cardType === 'hitting-stats') rows = hittingStatRows(player);
  else if (cardType === 'pitching-stats') rows = pitchingStatRows(player);
  else if (cardType === 'hitting-percentiles') rows = hittingPercentileRows(player, leaders?.batting || []);
  else if (cardType === 'pitching-percentiles') rows = pitchingPercentileRows(player, leaders?.pitching || []);

  ctx.save();

  // 1. Drop shadow under the card so it pops off the photo background.
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 8;

  // 2. Card body — white with rounded corners.
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, x, y, w, h, 22);
  ctx.fill();

  // Reset shadow before drawing inner content
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 3. Team-color accent bar across the top of the card.
  ctx.fillStyle = accent;
  roundRect(ctx, x, y, w, 8, 22);
  ctx.fill();

  // 4. Header strip — small uppercase label + subtitle + player name.
  const headingFont = FONT_MAP.heading || 'Bookmania, Georgia, serif';
  const condensedFont = FONT_MAP.condensed || 'Inter, Arial, sans-serif';
  const bodyFont = FONT_MAP.body || 'Inter, Arial, sans-serif';
  const tnumFont = FONT_MAP.tnum || bodyFont;
  const padX = 32;
  const headerY = y + 56;

  // Tiny label tag (e.g. "BLW BATTING PERCENTILE RANKINGS")
  const tagText = (() => {
    if (cardType === 'hitting-stats') return 'BLW · HITTING STATS';
    if (cardType === 'pitching-stats') return 'BLW · PITCHING STATS';
    if (cardType === 'hitting-percentiles') return 'BLW · HITTING PERCENTILES';
    if (cardType === 'pitching-percentiles') return 'BLW · PITCHING PERCENTILES';
    return '';
  })();
  ctx.fillStyle = accent;
  ctx.font = `800 14px ${condensedFont}`;
  ctx.textAlign = 'left';
  ctx.fillText(tagText, x + padX, headerY);

  // Player name in heading font
  ctx.fillStyle = '#1A1A22';
  ctx.font = `400 36px ${headingFont}`;
  ctx.textAlign = 'left';
  ctx.fillText(player.name || player.lastName || '', x + padX, headerY + 38);

  // Team + jersey subline
  ctx.fillStyle = '#5A5A65';
  ctx.font = `600 14px ${bodyFont}`;
  const subline = [
    team?.id || player.team || '',
    player.num ? `#${String(player.num).padStart(2, '0')}` : '',
    isPitching ? 'Pitcher' : 'Hitter',
  ].filter(Boolean).join(' · ');
  ctx.fillText(subline, x + padX, headerY + 60);

  // Hairline divider under the header
  ctx.strokeStyle = '#E5E5E5';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + padX, headerY + 80);
  ctx.lineTo(x + w - padX, headerY + 80);
  ctx.stroke();

  // 5. Body — render rows
  const bodyTop = headerY + 100;
  const bodyBottom = y + h - 24;
  const bodyHeight = bodyBottom - bodyTop;
  const rowHeight = bodyHeight / rows.length;

  rows.forEach((row, i) => {
    const rowY = bodyTop + i * rowHeight + rowHeight / 2;
    if (row.kind === 'pair') {
      // Two-column raw stat: label left, value right
      ctx.fillStyle = '#5A5A65';
      ctx.font = `700 13px ${condensedFont}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(row.label).toUpperCase(), x + padX, rowY);

      ctx.fillStyle = '#1A1A22';
      ctx.font = `700 28px ${tnumFont}`;
      ctx.textAlign = 'right';
      ctx.fillText(String(row.value), x + w - padX, rowY);
    } else if (row.kind === 'bubble') {
      // Three-column: label | bar | value
      const labelW = 70;
      const valueW = 70;
      const barX = x + padX + labelW + 10;
      const barW = w - padX * 2 - labelW - valueW - 20;
      const barH = 12;
      const barY = rowY - barH / 2;

      // Label
      ctx.fillStyle = '#5A5A65';
      ctx.font = `700 13px ${condensedFont}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(row.label).toUpperCase(), x + padX + labelW, rowY);

      // Track
      ctx.fillStyle = '#F0F0F2';
      roundRect(ctx, barX, barY, barW, barH, barH / 2);
      ctx.fill();

      // Fill
      const pct = row.percentile == null ? null : Math.max(0, Math.min(100, row.percentile));
      if (pct != null) {
        const fillW = Math.max(barH, (barW * pct) / 100);
        ctx.fillStyle = percentileColor(pct);
        roundRect(ctx, barX, barY, fillW, barH, barH / 2);
        ctx.fill();

        // Percentile bubble at the leading edge
        const bubbleSize = 24;
        const bubbleCenterX = barX + Math.max(bubbleSize / 2, Math.min(barW - bubbleSize / 2, fillW));
        const bubbleCenterY = rowY;
        ctx.fillStyle = percentileColor(pct);
        ctx.beginPath();
        ctx.arc(bubbleCenterX, bubbleCenterY, bubbleSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `700 11px ${condensedFont}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.round(pct)), bubbleCenterX, bubbleCenterY + 1);
      }

      // Value
      ctx.fillStyle = '#1A1A22';
      ctx.font = `700 16px ${tnumFont}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(row.value), x + w - padX - valueW + 10, rowY);
    }
  });

  // 6. Bottom bar — accent gradient stripe so the card has visual closure.
  const gradient = ctx.createLinearGradient(x, y + h - 6, x + w, y + h);
  gradient.addColorStop(0, accent);
  gradient.addColorStop(1, accentDark);
  ctx.fillStyle = gradient;
  roundRect(ctx, x, y + h - 6, w, 6, 22);
  ctx.fill();

  ctx.restore();
}

// ─── Helper: pick a sensible default box per platform ──────────────────────
// Card sizing is a compromise — large enough to read on social, small
// enough that there's room for the photo background or other overlays
// underneath/around it. These boxes target the lower half of the canvas
// so a hero photo at the top can carry the visual weight.
export function defaultCardBox(platform) {
  switch (platform) {
    case 'feed':      return { x: 60,  y: 220, w: 960,  h: 800  }; // 1080×1080
    case 'portrait':  return { x: 60,  y: 350, w: 960,  h: 950  }; // 1080×1350
    case 'story':     return { x: 60,  y: 600, w: 960,  h: 1200 }; // 1080×1920
    case 'landscape': return { x: 540, y: 60,  w: 600,  h: 555  }; // 1200×675 — right side
    default:          return { x: 60,  y: 220, w: 960,  h: 800  };
  }
}
