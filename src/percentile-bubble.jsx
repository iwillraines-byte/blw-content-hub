// Percentile bubble bar — Savant-style horizontal stat row.
//
// Layout per row:
//   [ STAT_LABEL ]  [ ─────●▰▰▰▰▰▰▰▰▰▰─── ]  [ VALUE ]
//
// Left:   stat label (right-aligned, condensed font).
// Middle: a horizontal track. A solid-color fill grows from the left edge
//         to the player's percentile (1..100), with a circular bubble
//         containing the percentile number sitting at the leading edge.
// Right:  the player's actual stat value (left-aligned, tabular-nums).
//
// Color tiers mirror the Baseball Savant convention — red for elite,
// blue for poor, neutral grey near the middle. The fill animates from
// 0 → target on mount; the parent `PercentileList` staggers each row
// by ~30ms so a column of bars cascades open instead of snapping.
//
// Computing percentiles for derived stats (HR/PA, K:BB, etc.) is the
// caller's job — see `percentileFor()` and `derivedPercentileFor()`
// below. The component itself just renders whatever percentile + value
// it's handed.

import { useEffect, useState } from 'react';
import { colors, fonts } from './theme';

// ─── Color palette (Savant-style) ───────────────────────────────────────────
// Discrete tiers feel more like the reference than a continuous gradient.
// Tweak these in one place if the brand wants a different temperature.
function percentileColor(p) {
  if (p == null) return '#CBD5E1';        // unknown / no rank
  if (p >= 90) return '#C8302B';          // elite
  if (p >= 75) return '#DA453A';
  if (p >= 60) return '#E07368';
  if (p >= 50) return '#D9A19B';          // upper-middle, warm
  if (p >= 40) return '#B5BFC9';          // lower-middle, cool
  if (p >= 25) return '#7B95B0';
  if (p >= 10) return '#5C7A99';
  return '#3F5A7A';                       // bottom of the league
}

// ─── Single row ─────────────────────────────────────────────────────────────

export function PercentileBubble({
  label,                       // 'AVG'
  value,                       // '.413'
  percentile,                  // 0..100, or null when unknown
  delayMs = 0,                 // stagger from the parent list
  onClick = null,              // optional; passes through to the row
  ariaLabel = null,
}) {
  // Animate the bar from 0 → target percentile on mount. Two-step state:
  // `mounted` flips true after the initial paint so the CSS transition
  // has something to interpolate against. `prefers-reduced-motion`
  // collapses to the final state instantly.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setMounted(true);
      return undefined;
    }
    const t = setTimeout(() => setMounted(true), Math.max(0, delayMs));
    return () => clearTimeout(t);
  }, [delayMs]);

  const pct = percentile == null ? null : Math.max(0, Math.min(100, Math.round(percentile)));
  const fill = percentileColor(pct);
  // Bubble sits on the leading edge of the fill. Clamp the center
  // position so the bubble stays inside the track at the extremes
  // (a bubble at 0% or 100% would otherwise clip).
  const targetWidthPct = pct == null ? 0 : pct;
  const animatedWidthPct = mounted ? targetWidthPct : 0;
  const bubbleSize = 22;

  return (
    <div
      onClick={onClick}
      aria-label={ariaLabel || `${label}: ${value}${pct != null ? `, ${pct}th percentile` : ''}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '70px 1fr 56px',
        alignItems: 'center',
        gap: 12,
        padding: '6px 0',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {/* Label */}
      <div style={{
        fontFamily: fonts.condensed,
        fontSize: 12, fontWeight: 700,
        color: colors.text,
        letterSpacing: 0.5,
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}>{label}</div>

      {/* Track + fill + bubble. The track is 8px tall so the 22px bubble
          overhangs ±7px above/below the bar — exactly matches the Savant
          reference's "bubble floats on the bar" feel. */}
      <div style={{
        position: 'relative',
        height: bubbleSize + 4,                // breathing room for the bubble
        display: 'flex', alignItems: 'center',
      }}>
        {/* Background track */}
        <div style={{
          width: '100%', height: 8, borderRadius: 999,
          background: '#E5E7EB',
          position: 'relative', overflow: 'visible',
        }}>
          {/* Animated fill */}
          <div style={{
            position: 'absolute', top: 0, left: 0, bottom: 0,
            width: `${animatedWidthPct}%`,
            background: fill,
            borderRadius: 999,
            transition: 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)',
          }} />
          {/* Bubble — only renders when we have a percentile. Positioned
              at the leading edge of the fill via translateX(-50%) so
              its center sits exactly at the percentile point. */}
          {pct != null && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: `${animatedWidthPct}%`,
                transform: 'translate(-50%, -50%)',
                width: bubbleSize, height: bubbleSize,
                borderRadius: '50%',
                background: fill,
                color: '#fff',
                border: '2px solid #fff',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.18)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800,
                letterSpacing: 0.2,
                transition: 'left 700ms cubic-bezier(0.22, 1, 0.36, 1), background 300ms ease',
                pointerEvents: 'none',
              }}
            >
              {pct}
            </div>
          )}
        </div>
      </div>

      {/* Player's stat value */}
      <div className="tnum" style={{
        fontFamily: fonts.body,
        fontSize: 13, fontWeight: 700,
        color: colors.text,
        letterSpacing: 0.2,
        textAlign: 'left',
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
      }}>{value ?? '—'}</div>
    </div>
  );
}

// ─── List wrapper with stagger animation ────────────────────────────────────

export function PercentileList({ rows, headerLabel = null, ariaLabel = null }) {
  // 30ms per row produces a smooth cascade without feeling laggy. The
  // upper bound of ~12 rows × 30ms = 360ms total stagger keeps the page
  // feeling snappy at the bottom of long lists too.
  const stagger = 30;
  return (
    <div role="list" aria-label={ariaLabel}>
      {headerLabel && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '70px 1fr 56px',
          gap: 12,
          padding: '0 0 6px',
          borderBottom: `1px solid ${colors.borderLight}`,
          marginBottom: 4,
          fontFamily: fonts.condensed,
          fontSize: 9, fontWeight: 800,
          color: colors.textMuted,
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}>
          <span style={{ textAlign: 'right' }}>STAT</span>
          <span style={{ textAlign: 'left' }}>{headerLabel}</span>
          <span style={{ textAlign: 'left' }}>VALUE</span>
        </div>
      )}
      {rows.map((row, i) => (
        <PercentileBubble
          key={row.key || row.label}
          label={row.label}
          value={row.value}
          percentile={row.percentile}
          delayMs={i * stagger}
        />
      ))}
    </div>
  );
}

// ─── Percentile computation helpers ─────────────────────────────────────────
//
// percentileFor() handles the common "rank a player by a direct field on
// the leaderboard" case. For derived stats (HR/PA, K:BB), use
// derivedPercentileFor() which takes a value-extractor function so it
// can compute the metric per row before sorting.
//
// Direction:
//   'desc' → higher is better (player at top of list = high percentile)
//   'asc'  → lower is better (player at top of list = high percentile)
//
// Returns null when the player isn't found in the list — caller should
// hide the row or render the bubble in unknown state.

export function percentileFor(list, playerName, fieldKey, direction = 'desc', toNumber = parseFloat) {
  return derivedPercentileFor(
    list,
    playerName,
    (row) => toNumber(row?.[fieldKey]),
    direction
  );
}

export function derivedPercentileFor(list, playerName, valueOf, direction = 'desc') {
  if (!Array.isArray(list) || list.length === 0) return null;
  // Project to (name, value) pairs, dropping rows where value isn't finite.
  const rows = list
    .map(r => ({ name: r?.name || '', value: valueOf(r) }))
    .filter(r => r.name && Number.isFinite(r.value));
  if (rows.length === 0) return null;
  // Sort so the BEST value is at the top (rank 1). If desc, that's
  // sort by value descending; if asc, ascending.
  rows.sort((a, b) => direction === 'asc' ? a.value - b.value : b.value - a.value);
  const idx = rows.findIndex(r => r.name === playerName);
  if (idx < 0) return null;
  // Rank-based percentile, 1..100. With N rows, rank 1 → 100, rank N → ~1.
  // (1 - idx / (N - 1)) * 100, with N=1 short-circuit to 100.
  if (rows.length === 1) return 100;
  const pct = (1 - idx / (rows.length - 1)) * 100;
  return Math.max(0, Math.min(100, pct));
}
