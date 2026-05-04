// Canvas renderer for the four player stat cards: hitting raw stats,
// hitting percentile bubbles, pitching raw stats, pitching percentile
// bubbles. Used by the Studio compositor's "Stat Card" template so a
// designer can drop a player's actual stats onto any composition with
// the same visual treatment as the player page (rounded white card,
// team-color header gradient, savant-style percentile bars).
//
// v4.5.32: rewrote to match the exact reference designs the master
// admin provided. Both card types now read as compact lower-thirds —
// the raw card uses a 4-column grid with team-gradient header and
// mini progress bars; the percentile card mirrors the Savant
// PercentileList layout with smaller bars sized for lower-third use.
//
// All drawing is canvas-primitive — no html2canvas, no DOM rendering —
// so quality stays crisp at any export resolution.

import { percentileFor, derivedPercentileFor } from './percentile-bubble';

// v4.5.33: bypass FONT_MAP and reference the MVP theme stack directly.
// FONT_MAP is keyed for the legacy Bebas Neue / Barlow stack; the
// player page uses Space Grotesk + Inter via CSS custom properties.
// We want the canvas card to match the player page typography
// regardless of which Settings → Typography pick the user has active,
// because these cards are visually anchored to the player page design.
const FONT_HEAD = '"Space Grotesk", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
const FONT_BODY = '"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
const FONT_COND = '"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';

// Mini-bar tier palette for the 4-column raw stat card. Simpler than
// the Savant percentile bubble palette — just three bands so the eye
// reads "good / mid / weak" at a glance.
function miniBarColor(p) {
  if (p == null) return '#CBD5E1';
  if (p >= 50) return '#3B82F6';   // blue
  if (p >= 25) return '#F59E0B';   // amber
  return '#EF4444';                 // red
}

// Savant-style percentile bubble palette — discrete tiers from elite
// red through to bottom-of-league navy. Same colors as the player
// page card; ports the percentileColor function from percentile-bubble.jsx.
function bubbleColor(p) {
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
// v4.5.33: ratio helpers for K:BB (and any future "x per y" stats
// that aren't a single field on the row). Mirror the helpers on
// PlayerPage.jsx so the displayed values match exactly.
function formatRatio(num, denom) {
  const n = Number(num);
  const d = Number(denom);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return '—';
  return (n / d).toFixed(2);
}
function safeRatio(num, denom) {
  const n = Number(num);
  const d = Number(denom);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

// Year label for the gradient header. We don't have a season state
// passed in — hardcode the current BLW season year for now (master
// can edit this string when we ship 2027).
const SEASON_LABEL = '2026';

// ─── Card-content builders ──────────────────────────────────────────────────
// Raw cards return EXACTLY 4 columns. The 4th is the "headline" stat
// rendered in team-accent color (matches the OPS+ treatment in the
// reference design).
//
// Percentile cards return up to 6 rows (sized for lower-third use).
// Each row has { label, value, percentile }.
//
// Cells/rows include rank info ("#32 / 64") so the viewer sees
// instantly where the player slots in BLW-wide.

function rankAndPercentile(list, playerName, key, direction = 'desc', toNumber = parseFloat) {
  if (!Array.isArray(list) || !list.length) return { rank: null, total: 0, percentile: null };
  const rows = list
    .map(r => ({ name: r?.name || '', value: toNumber(r?.[key]) }))
    .filter(r => r.name && Number.isFinite(r.value));
  if (!rows.length) return { rank: null, total: 0, percentile: null };
  rows.sort((a, b) => direction === 'asc' ? a.value - b.value : b.value - a.value);
  const idx = rows.findIndex(r => r.name === playerName);
  if (idx < 0) return { rank: null, total: rows.length, percentile: null };
  const rank = idx + 1;
  const percentile = rows.length === 1 ? 100 : (1 - idx / (rows.length - 1)) * 100;
  return { rank, total: rows.length, percentile };
}

function hittingRawCells(player, leaders) {
  const b = player.batting || {};
  const list = leaders?.batting || [];
  return [
    { label: 'AVG', value: b.avg ?? '—', ...rankAndPercentile(list, player.name, 'avg', 'desc', parseFloat) },
    { label: 'HR', value: b.hr ?? '—', ...rankAndPercentile(list, player.name, 'hr', 'desc', Number) },
    { label: 'RBI', value: b.rbi ?? '—', ...rankAndPercentile(list, player.name, 'rbi', 'desc', Number) },
    { label: 'OPS+', value: b.ops_plus ?? '—', highlight: true, ...rankAndPercentile(list, player.name, 'ops_plus', 'desc', Number) },
  ];
}

function pitchingRawCells(player, leaders) {
  const p = player.pitching || {};
  const list = leaders?.pitching || [];
  return [
    { label: 'ERA', value: p.era ?? '—', ...rankAndPercentile(list, player.name, 'era', 'asc', parseFloat) },
    { label: 'IP', value: p.ip ?? '—', ...rankAndPercentile(list, player.name, 'ip', 'desc', parseFloat) },
    { label: 'K/4', value: p.k4 ?? '—', ...rankAndPercentile(list, player.name, 'k4', 'desc', parseFloat) },
    {
      label: 'FIP',
      value: typeof p.fip === 'number' ? p.fip.toFixed(2) : (p.fip ?? '—'),
      highlight: true,
      ...rankAndPercentile(list, player.name, 'fip', 'asc', parseFloat),
    },
  ];
}

// v4.5.33: full 9-row sets matching the player page exactly. Same
// stat list, same direction (asc for "lower is better" stats like
// K% and ERA so the bubble points at "good" the same way it does for
// hitter-friendly metrics — bubble at 95 means elite, not worst).
function hittingPercentileRows(player, battingLeaders) {
  const b = player.batting || {};
  return [
    { label: 'AVG', value: b.avg ?? '—',
      percentile: percentileFor(battingLeaders, player.name, 'avg', 'desc', parseFloat) },
    { label: 'OBP', value: b.obp ?? '—',
      percentile: percentileFor(battingLeaders, player.name, 'obp', 'desc', parseFloat) },
    { label: 'SLG', value: b.slg ?? '—',
      percentile: percentileFor(battingLeaders, player.name, 'slg', 'desc', parseFloat) },
    { label: 'OPS', value: b.ops ?? '—',
      percentile: percentileFor(battingLeaders, player.name, 'ops', 'desc', parseFloat) },
    { label: 'BB%', value: formatPctValue(b.bbPct),
      percentile: percentileFor(battingLeaders, player.name, 'bbPct', 'desc', Number) },
    // K% lower-is-better for hitters
    { label: 'K%', value: formatPctValue(b.kPct),
      percentile: percentileFor(battingLeaders, player.name, 'kPct', 'asc', Number) },
    { label: 'HR/PA', value: formatRate(b.hr, b.pa),
      percentile: derivedPercentileFor(battingLeaders, player.name, (r) => safeRate(r.hr, r.pa), 'desc') },
    { label: 'RBI/PA', value: formatRate(b.rbi, b.pa),
      percentile: derivedPercentileFor(battingLeaders, player.name, (r) => safeRate(r.rbi, r.pa), 'desc') },
    { label: 'R/PA', value: formatRate(b.runs, b.pa),
      percentile: derivedPercentileFor(battingLeaders, player.name, (r) => safeRate(r.runs, r.pa), 'desc') },
  ];
}

function pitchingPercentileRows(player, pitchingLeaders) {
  const p = player.pitching || {};
  return [
    // ERA / WHIP / BB / BB/4 are "lower is better" — direction 'asc'
    // so the bubble at 95 means elite, not "worst ERA in BLW".
    { label: 'ERA',  value: p.era ?? '—',
      percentile: percentileFor(pitchingLeaders, player.name, 'era',  'asc', parseFloat) },
    { label: 'WHIP', value: p.whip ?? '—',
      percentile: percentileFor(pitchingLeaders, player.name, 'whip', 'asc', parseFloat) },
    { label: 'IP',   value: p.ip ?? '—',
      percentile: percentileFor(pitchingLeaders, player.name, 'ip',   'desc', parseFloat) },
    { label: 'K',    value: p.k ?? '—',
      percentile: percentileFor(pitchingLeaders, player.name, 'k',    'desc', Number) },
    { label: 'K/4',  value: p.k4 ?? '—',
      percentile: percentileFor(pitchingLeaders, player.name, 'k4',   'desc', parseFloat) },
    { label: 'BB',   value: p.bb ?? '—',
      percentile: percentileFor(pitchingLeaders, player.name, 'bb',   'asc', Number) },
    { label: 'BB/4', value: p.bb4 ?? '—',
      percentile: percentileFor(pitchingLeaders, player.name, 'bb4',  'asc', parseFloat) },
    { label: 'FIP',  value: typeof p.fip === 'number' ? p.fip.toFixed(2) : (p.fip ?? '—'),
      percentile: percentileFor(pitchingLeaders, player.name, 'fip',  'asc', parseFloat) },
    { label: 'K:BB', value: p.kbb || formatRatio(p.k, p.bb),
      percentile: derivedPercentileFor(pitchingLeaders, player.name, (r) => safeRatio(r.k, r.bb), 'desc') },
  ];
}

// ─── Renderers ─────────────────────────────────────────────────────────────
// Each renderer takes the canvas context, a box {x,y,w,h}, and the
// data it needs. Box sizing is tuned for lower-third use — caller
// passes a box from defaultCardBox() unless they want custom placement.

function renderRawCard(ctx, { box, team, headerLabel, cells }) {
  const { x, y, w, h } = box;
  const accent = team?.color || '#C8302B';
  const accentDark = team?.dark || accent;
  // v4.5.33: Space Grotesk + Inter to match the player page typography.
  const cond = FONT_COND;
  const head = FONT_HEAD;

  ctx.save();

  // Card body — white, rounded, white frame stroke, deep drop shadow.
  // v4.5.35: drop shadow deepened (0.15 → 0.32 alpha, 20 → 36 blur,
  // offset 6 → 14). Hairline #EBEDF0 stroke replaced with a 10px
  // white frame stroke — half draws inside the body (invisible
  // against white fill) and half draws outside, so 5px of clean
  // white border surrounds the card. Reads as a polished print
  // frame without inheriting the team color.
  ctx.shadowColor = 'rgba(15,23,42,0.32)';
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  // White frame — 10px stroke centered on the card outline; 5px
  // outside the fill becomes a visible white border.
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 10;
  ctx.lineJoin = 'round';
  roundRect(ctx, x, y, w, h, 14);
  ctx.stroke();

  // Header strip — gradient team color, fitted to the top with the
  // card's top corners rounded but the bottom edge straight (so it
  // visually fuses with the body).
  // v4.5.33: bumped header to ~25% of card height so the larger
  // condensed font has breathing room.
  const headerH = Math.max(40, Math.round(h * 0.24));
  ctx.save();
  // Clip to the card's rounded rect so the header doesn't bleed past
  // the corners. This composites cleanly even though the gradient is
  // a full rectangle underneath.
  roundRect(ctx, x, y, w, h, 14);
  ctx.clip();
  const gradient = ctx.createLinearGradient(x, y, x + w, y + headerH);
  gradient.addColorStop(0, accent);
  gradient.addColorStop(1, accentDark);
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, w, headerH);
  ctx.restore();

  // Header text — uppercase season + label, centered.
  // v4.5.33: bumped from 0.42 → 0.50 of header height for stronger
  // type presence in social previews.
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 ${Math.round(headerH * 0.50)}px ${cond}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const headerText = `${SEASON_LABEL} ${headerLabel}`.toUpperCase();
  ctx.fillText(headerText, x + w / 2, y + headerH / 2);

  // 4-column body. Equal-width columns, consistent inner padding.
  const bodyTop = y + headerH;
  const bodyH = h - headerH;
  const colW = w / 4;
  // v4.5.34: value font reduced from 52% → 40% of body height.
  // At 52% the digits in pitching-stats (0.00 / 25.0 / 11.68 / -1.85)
  // were running into each other across columns and clipping the
  // mini-bar below. 40% gives breathing room while still reading as
  // the headline number.
  const yLabel  = bodyTop + bodyH * 0.18;
  const yValue  = bodyTop + bodyH * 0.50;
  const yRank   = bodyTop + bodyH * 0.78;
  const yBar    = bodyTop + bodyH * 0.92;
  const valueFont = Math.round(bodyH * 0.40);
  const labelFont = Math.round(bodyH * 0.15);
  const rankFont = Math.round(bodyH * 0.12);

  cells.forEach((cell, i) => {
    const cx = x + colW * i + colW / 2;
    // Label
    ctx.fillStyle = '#9CA3AF';
    ctx.font = `700 ${labelFont}px ${cond}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(cell.label).toUpperCase(), cx, yLabel);

    // Value — Space Grotesk display weight 600. Highlight stat uses
    // team accent, otherwise dark text.
    ctx.fillStyle = cell.highlight ? accent : '#151C28';
    ctx.font = `600 ${valueFont}px ${head}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(cell.value), cx, yValue);

    // Rank — "#32 / 64". Hidden if rank is unknown.
    if (cell.rank != null && cell.total != null && cell.total > 0) {
      ctx.fillStyle = '#9CA3AF';
      ctx.font = `600 ${rankFont}px ${cond}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`#${cell.rank} / ${cell.total}`, cx, yRank);
    }

    // Mini progress bar — track + fill, 3-4px tall, 75% of column width.
    const barW = colW * 0.75;
    const barX = cx - barW / 2;
    const barH = 4;
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    roundRect(ctx, barX, yBar, barW, barH, barH / 2);
    ctx.fill();
    if (cell.percentile != null) {
      const pct = Math.max(0, Math.min(100, cell.percentile));
      const fillW = (barW * pct) / 100;
      ctx.fillStyle = cell.highlight ? accent : miniBarColor(pct);
      roundRect(ctx, barX, yBar, Math.max(barH, fillW), barH, barH / 2);
      ctx.fill();
    }
  });

  ctx.restore();
}

function renderPercentileCard(ctx, { box, team, headerLabel, totalLabel, rows, playerName }) {
  const { x, y, w, h } = box;
  const accent = team?.color || '#C8302B';
  // v4.5.33: Space Grotesk + Inter to match the player page typography.
  const cond = FONT_COND;
  const head = FONT_HEAD;
  const tnum = FONT_BODY;

  ctx.save();

  // Card body — white, white frame stroke, deep drop shadow.
  // v4.5.35: shadow + frame match the raw card (0.32 alpha, 36 blur,
  // 14 offset). 10px white stroke centered on the outline gives 5px
  // of visible white border around the card.
  ctx.shadowColor = 'rgba(15,23,42,0.32)';
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 10;
  ctx.lineJoin = 'round';
  roundRect(ctx, x, y, w, h, 14);
  ctx.stroke();

  // Inner padding. v4.5.33: tightened the row spacing so all 9 stats
  // fit comfortably while font sizes go UP. padTop trimmed slightly
  // and headerHeight reduced — the body block now claims more space.
  const padX = Math.round(w * 0.045);
  const padTop = Math.round(h * 0.05);
  const headerHeight = Math.round(h * 0.13);

  // Header — title left, "Across N BLW [batters/pitchers]" right.
  // v4.5.33: title up to 64% of header height (was 55%) for stronger
  // brand presence on social previews.
  ctx.fillStyle = '#151C28';
  const titleSize = Math.round(headerHeight * 0.64);
  ctx.font = `600 ${titleSize}px ${head}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(headerLabel).toUpperCase(), x + padX, y + padTop + headerHeight * 0.5);

  ctx.fillStyle = '#9CA3AF';
  ctx.font = `400 ${Math.round(headerHeight * 0.36)}px ${cond}`;
  ctx.textAlign = 'right';
  ctx.fillText(totalLabel, x + w - padX, y + padTop + headerHeight * 0.55);

  // Body rows. Three-column grid: [label 70-ish][bar flex][value 56-ish].
  // v4.5.33: row spacing pulled in (gap between rows reduced) so 9
  // rows fit in the same vertical real estate. Each row is now
  // tighter but the bar/bubble themselves take a larger fraction of
  // the row height for visual punch.
  const bodyTop = y + padTop + headerHeight + 6;
  const bodyBottom = y + h - padTop;
  const bodyHeight = bodyBottom - bodyTop;
  const rowHeight = bodyHeight / Math.max(1, rows.length);
  const labelW = Math.round(w * 0.10);
  const valueW = Math.round(w * 0.10);
  const barX = x + padX + labelW + 14;
  const barW = w - padX * 2 - labelW - valueW - 28;

  // Bar takes ~40% of row height (was 32%) for stronger presence at
  // 9-row density. Bubble scales with bar height + a fixed minimum.
  const barH = Math.max(8, Math.round(rowHeight * 0.40));
  const bubbleR = Math.max(barH * 1.0, 12);

  // Row text size: scale up by ~10% from the previous 32% baseline.
  const rowFontSize = Math.max(13, Math.round(rowHeight * 0.36));

  rows.forEach((row, i) => {
    const rowY = bodyTop + i * rowHeight + rowHeight / 2;

    // Label — right-aligned in the 70-ish px column.
    ctx.fillStyle = '#151C28';
    ctx.font = `700 ${rowFontSize}px ${cond}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(row.label).toUpperCase(), x + padX + labelW, rowY);

    // Track
    ctx.fillStyle = '#E5E7EB';
    roundRect(ctx, barX, rowY - barH / 2, barW, barH, barH / 2);
    ctx.fill();

    // Fill
    const pct = row.percentile == null ? null : Math.max(0, Math.min(100, row.percentile));
    if (pct != null) {
      const color = bubbleColor(pct);
      const fillW = Math.max(barH, (barW * pct) / 100);
      ctx.fillStyle = color;
      roundRect(ctx, barX, rowY - barH / 2, fillW, barH, barH / 2);
      ctx.fill();

      // Bubble at the leading edge — clamp center to keep the circle
      // inside the track at extremes.
      const bubbleCx = barX + Math.max(bubbleR, Math.min(barW - bubbleR, fillW));
      const bubbleCy = rowY;
      // White ring around the bubble for separation against the track.
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(bubbleCx, bubbleCy, bubbleR + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(bubbleCx, bubbleCy, bubbleR, 0, Math.PI * 2);
      ctx.fill();
      // Bubble number — white, centered. Bumped to ~95% of bubble
      // radius for higher number readability.
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `800 ${Math.round(bubbleR * 1.0)}px ${cond}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.round(pct)), bubbleCx, bubbleCy + 1);
    }

    // Value — body font, tabular-numbers, left-aligned in the value column.
    ctx.fillStyle = '#151C28';
    ctx.font = `700 ${rowFontSize}px ${tnum}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(row.value), x + w - padX - valueW + 6, rowY);
  });

  ctx.restore();
}

// ─── Public entry point ────────────────────────────────────────────────────
// cardType: 'hitting-stats' | 'hitting-percentiles' | 'pitching-stats' | 'pitching-percentiles'
// player:   { name, lastName, firstName, num, team, batting?, pitching? }
// box:      { x, y, w, h }    — where to draw the card on the canvas
// team:     TEAMS entry (color, dark, name)
// leaders:  { batting: [...], pitching: [...] } — for percentile lookups

export function renderStatCard(ctx, { cardType, player, box, team, leaders }) {
  if (!player || !box || !cardType) return;
  const battingLeaders = leaders?.batting || [];
  const pitchingLeaders = leaders?.pitching || [];

  if (cardType === 'hitting-stats') {
    renderRawCard(ctx, {
      box, team,
      headerLabel: 'BATTING',
      cells: hittingRawCells(player, leaders),
    });
  } else if (cardType === 'pitching-stats') {
    renderRawCard(ctx, {
      box, team,
      headerLabel: 'PITCHING',
      cells: pitchingRawCells(player, leaders),
    });
  } else if (cardType === 'hitting-percentiles') {
    renderPercentileCard(ctx, {
      box, team,
      headerLabel: 'BLW Batting Percentile Rankings',
      totalLabel: `Across ${battingLeaders.length} BLW batters`,
      rows: hittingPercentileRows(player, battingLeaders),
      playerName: player.name,
    });
  } else if (cardType === 'pitching-percentiles') {
    renderPercentileCard(ctx, {
      box, team,
      headerLabel: 'BLW Pitching Percentile Rankings',
      totalLabel: `Across ${pitchingLeaders.length} BLW pitchers`,
      rows: pitchingPercentileRows(player, pitchingLeaders),
      playerName: player.name,
    });
  }
}

// ─── Default lower-third box per platform ──────────────────────────────────
// v4.5.32: cards are now sized as lower-thirds — sit in the bottom
// 25-30% of the canvas with healthy side margins, full-width up to the
// card's horizontal bounds. Raw and percentile cards differ in height
// because percentile rows take more vertical space.

export function defaultCardBox(platform, cardType = 'hitting-stats') {
  // Raw cards are short — header strip + 4 columns; percentile cards
  // are taller because each row is a discrete bar.
  // v4.5.33: percentile cards now show all 9 stats (was 6) so heights
  // bumped up to keep rows readable at the new font sizes.
  const isPct = cardType === 'hitting-percentiles' || cardType === 'pitching-percentiles';

  switch (platform) {
    case 'feed': {
      // 1080×1080
      const w = 940, h = isPct ? 540 : 240;
      return { x: (1080 - w) / 2, y: 1080 - h - 70, w, h };
    }
    case 'portrait': {
      // 1080×1350
      const w = 940, h = isPct ? 580 : 260;
      return { x: (1080 - w) / 2, y: 1350 - h - 80, w, h };
    }
    case 'story': {
      // 1080×1920
      const w = 940, h = isPct ? 640 : 300;
      return { x: (1080 - w) / 2, y: 1920 - h - 200, w, h };
    }
    case 'landscape': {
      // 1200×675 — percentile card too tall here for a true lower-third;
      // anchor to the right side with full canvas height usable.
      const w = 720, h = isPct ? 540 : 230;
      return { x: 1200 - w - 50, y: 675 - h - 40, w, h };
    }
    default: {
      const w = 940, h = isPct ? 540 : 240;
      return { x: (1080 - w) / 2, y: 1080 - h - 70, w, h };
    }
  }
}
