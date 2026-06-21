// League Standing companion charts — the right-hand panel of the player
// "League Standing" card. Two views the parent toggles between:
//
//   <PercentileRadar> — a 6-axis radar of the player's percentile shape
//     (one discipline at a time). Each axis is a percentile (0..100), so a
//     full hexagon = elite across the board, a spiky shape = a specialist.
//
//   <OpwrTrend> — the player's OPWR rank over time, inverted so #1 sits at
//     the top. Today the series is seeded from the two ranks the GSS feed
//     carries (last period → now); a richer history source can be dropped
//     into the parent's `points` prop with no change here.
//
// Both are hand-rolled SVG (no chart lib) so they inherit the charcoal
// theme via CSS-var color tokens and take the team `accent` as the only
// pop. Pass `accent` as a resolved hex or CSS-var string — it's used
// directly as fill/stroke with a separate opacity for the radar wash.

import { useEffect, useState } from 'react';
import { colors, fonts } from './theme';

function ordinal(n) {
  if (n == null || !Number.isFinite(n)) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function usePrefersReducedMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// ─── Percentile radar ────────────────────────────────────────────────────────

export function PercentileRadar({ axes, accent, size = 200, ariaLabel = null }) {
  const reduce = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(reduce);
  useEffect(() => {
    if (reduce) { setMounted(true); return undefined; }
    const t = setTimeout(() => setMounted(true), 20);
    return () => clearTimeout(t);
  }, [reduce]);

  const list = Array.isArray(axes) ? axes : [];
  const n = list.length;
  if (n < 3) return null;

  const pad = 26;
  const cx = size / 2, cy = size / 2;
  const R = size / 2 - pad;
  const ptAt = (i, rad) => {
    const a = (-90 + (i * 360) / n) * Math.PI / 180;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  };
  const ringPoly = (f) => list.map((_, i) => ptAt(i, R * f).map(v => v.toFixed(1)).join(',')).join(' ');
  const clampPct = (p) => Math.max(0, Math.min(100, p == null ? 0 : p));
  const dataPts = list.map((ax, i) => ptAt(i, R * clampPct(ax.percentile) / 100));
  const dataPoly = dataPts.map(q => q.map(v => v.toFixed(1)).join(',')).join(' ');

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      role="img"
      aria-label={ariaLabel || 'Percentile radar across stat categories'}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* concentric reference rings */}
      {[0.25, 0.5, 0.75, 1].map((f, i) => (
        <polygon key={f} points={ringPoly(f)} fill="none"
          stroke={colors.border} strokeWidth={i === 3 ? 1.1 : 0.8} opacity={i === 3 ? 0.9 : 0.5} />
      ))}
      {/* spokes */}
      {list.map((_, i) => {
        const q = ptAt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={q[0]} y2={q[1]} stroke={colors.border} strokeWidth={0.7} opacity={0.45} />;
      })}
      {/* data shape */}
      <polygon
        points={dataPoly}
        fill={accent} fillOpacity={0.16}
        stroke={accent} strokeWidth={2} strokeLinejoin="round"
        style={{
          transformOrigin: 'center',
          transform: mounted ? 'scale(1)' : 'scale(0.82)',
          opacity: mounted ? 1 : 0,
          transition: 'transform 520ms cubic-bezier(0.22,1,0.36,1), opacity 360ms ease',
        }}
      />
      {dataPts.map((q, i) => (
        <circle key={i} cx={q[0]} cy={q[1]} r={2.6} fill={accent}
          style={{ opacity: mounted ? 1 : 0, transition: 'opacity 360ms ease 120ms' }} />
      ))}
      {/* axis labels */}
      {list.map((ax, i) => {
        const q = ptAt(i, R + 14);
        const anchor = q[0] > cx + 2 ? 'start' : q[0] < cx - 2 ? 'end' : 'middle';
        return (
          <text key={i} x={q[0]} y={q[1]} textAnchor={anchor} dominantBaseline="middle"
            fill={colors.textSecondary} fontFamily={fonts.mono} fontSize={9} fontWeight={700}>
            {ax.label}
          </text>
        );
      })}
    </svg>
  );
}

// ─── OPWR rank trend ─────────────────────────────────────────────────────────

export function OpwrTrend({ points, accent, ariaLabel = null }) {
  const reduce = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(reduce);
  useEffect(() => {
    if (reduce) { setMounted(true); return undefined; }
    const t = setTimeout(() => setMounted(true), 20);
    return () => clearTimeout(t);
  }, [reduce]);

  const pts = (Array.isArray(points) ? points : []).filter(p => Number.isFinite(p?.rank) && p.rank > 0);
  if (pts.length < 2) return null;

  const W = 230, H = 150, L = 30, Rg = 14, T = 16, B = 24;
  const ranks = pts.map(p => p.rank);
  let best = Math.min(...ranks), worst = Math.max(...ranks);
  if (best === worst) { best -= 1; worst += 1; }
  const pad = Math.max(1, Math.round((worst - best) * 0.25));
  const hi = Math.max(1, best - pad);   // top of axis = best (smallest) rank
  const lo = worst + pad;               // bottom of axis = worst rank
  const X = (i) => L + (i * (W - L - Rg)) / (pts.length - 1);
  const Y = (r) => T + ((r - hi) / (lo - hi)) * (H - T - B);
  const gridRanks = [hi, Math.round((hi + lo) / 2), lo];
  const linePts = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.rank).toFixed(1)}`).join(' ');
  const last = pts.length - 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label={ariaLabel || 'OPWR rank trend over recent periods'} style={{ display: 'block', overflow: 'visible' }}>
      {/* rank gridlines + axis labels */}
      {gridRanks.map((r, i) => {
        const y = Y(r);
        return (
          <g key={i}>
            <line x1={L} y1={y} x2={W - Rg} y2={y} stroke={colors.border} strokeWidth={0.8} opacity={0.45} />
            <text x={L - 6} y={y} textAnchor="end" dominantBaseline="middle"
              fill={colors.textMuted} fontFamily={fonts.mono} fontSize={8.5}>{`#${r}`}</text>
          </g>
        );
      })}
      {/* trend line */}
      <polyline points={linePts} fill="none" stroke={accent} strokeWidth={2.2}
        strokeLinejoin="round" strokeLinecap="round"
        style={{ opacity: mounted ? 1 : 0, transition: 'opacity 420ms ease' }} />
      {/* points + x labels */}
      {pts.map((p, i) => {
        const isLast = i === last;
        return (
          <g key={i}>
            <circle cx={X(i)} cy={Y(p.rank)} r={isLast ? 4 : 2.6}
              fill={isLast ? accent : colors.bg} stroke={accent} strokeWidth={2}
              style={{ opacity: mounted ? 1 : 0, transition: `opacity 360ms ease ${i * 70}ms` }} />
            <text x={X(i)} y={H - 8} textAnchor="middle"
              fill={colors.textMuted} fontFamily={fonts.body} fontSize={8.5}>{p.label}</text>
          </g>
        );
      })}
      {/* current-rank callout above the last point — y clamped so the
          glyphs never cross the viewBox top when the player is rank #1 */}
      <text x={X(last)} y={Math.max(10, Y(pts[last].rank) - 9)} textAnchor="middle"
        fill={colors.text} fontFamily={fonts.mono} fontSize={11} fontWeight={700}>
        {ordinal(pts[last].rank)}
      </text>
    </svg>
  );
}
