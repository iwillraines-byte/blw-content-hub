import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getTeam, getPlayerByTeamLastName, fetchAllData, fetchTeamRosterFromApi, getTeamRoster, playerSlug, TEAMS } from '../data';
import { Card, SectionHeading, Label, RedButton, OutlineButton, TeamLogo, PositionedAvatar } from '../components';
import { ContentIdeasSection } from '../content-ideas-section';
import { colors, fonts, radius } from '../theme';
import { findPlayerMedia, findTeamMedia, getAllMedia, resolvePlayerAvatar, blobToObjectURL } from '../media-store';
import { getManualPlayersByTeam, getAllManualPlayers, upsertManualPlayer } from '../player-store';
import { TierBadge } from '../tier-badges';
import { useAuth, isStaffRole } from '../auth';
import { useToast } from '../toast';
import { fetchRecentGenerates } from '../cloud-sync';
import { authedJson } from '../authed-fetch';
import { PercentileList, percentileFor, derivedPercentileFor } from '../percentile-bubble';
import { useLeagueContext } from '../league-context';
import IdeaCard from '../idea-card';
import { buildGenerateLinkFromIdea } from '../requests-store';
import { stashIdeaForGenerate } from '../idea-context-store';

// Shared style for the teammate prev/next chips on the breadcrumb row.
// Disabled state (no neighbor in that direction) renders as a muted chip
// without hover affordances, so the layout stays balanced even at the
// ends of the roster.
function teammateNavBtnStyle(enabled) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 10px', borderRadius: 999,
    background: enabled ? 'transparent' : 'transparent',
    color: enabled ? '#475569' : '#94A3B8',
    border: '1px solid #E5E7EB',
    fontFamily: 'var(--font-condensed, system-ui)',
    fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
    textDecoration: 'none', cursor: enabled ? 'pointer' : 'default',
    textTransform: 'uppercase',
    transition: 'background 120ms ease, border-color 120ms ease',
  };
}

// ─── Small format helpers used by the percentile bubble lists ──────────────
// Keep them as plain functions (not memoised) — they run once per render
// per row and the cost is trivial compared to the surrounding work.

// Decimal percentage from the leaders feed comes through as a number in
// 0..100 range (e.g. 14.9). Format as "14.9%" with one decimal.
function formatPct(value) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  return `${n.toFixed(1)}%`;
}

// Per-PA / per-IP rate stat: numerator over denominator, formatted as a
// 3-decimal proportion ("0.057"). Returns "—" when denominator is 0.
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

// K:BB ratio — formatted as "X.XX" so even 12 strikeouts vs 1 walk
// reads as "12.00" rather than "12". Returns "—" on no walks (avoids
// dividing by zero); some pitchers will hit this and that's accurate.
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

function buildStatLine(player) {
  if (player.batting) {
    const b = player.batting;
    return `OPS+ ${b.ops_plus} | AVG ${b.avg} | HR ${b.hr} | OBP ${b.obp}`;
  }
  if (player.pitching) {
    const p = player.pitching;
    const fip = typeof p.fip === 'number' ? p.fip.toFixed(2) : p.fip;
    return `FIP ${fip} | IP ${p.ip} | W ${p.w} | K/4 ${p.k4}`;
  }
  return '';
}


// ─── League rank helpers ────────────────────────────────────────────────────
// Compute a player's 1-indexed rank for a given numeric stat across the list.
// `direction`: "desc" means higher is better (rank 1 = highest), "asc" = lower better.
function rankOf(list, playerName, statKey, direction = 'desc', toNumber = parseFloat) {
  if (!Array.isArray(list) || list.length === 0 || !playerName) return null;
  const cleaned = list
    .map(p => ({ name: p.name, v: toNumber(p[statKey]) }))
    .filter(x => x.name && !isNaN(x.v));
  cleaned.sort((a, b) => direction === 'asc' ? a.v - b.v : b.v - a.v);
  const idx = cleaned.findIndex(x => x.name === playerName);
  return idx === -1 ? null : idx + 1;
}

// Colored pill showing a rank across BLW for a given stat.
function RankChip({ rank, total }) {
  if (!rank) {
    return <span style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.condensed, fontWeight: 600 }}>—</span>;
  }
  // Use a muted team-neutral style; tier colors only on the big tier badge
  const palette = rank <= 3
    ? { bg: '#FEF3C7', fg: '#92400E' }        // gold-ish for top 3
    : rank <= 10
      ? { bg: 'rgba(37,99,235,0.1)', fg: '#1E40AF' }
      : rank <= 25
        ? { bg: 'rgba(22,163,74,0.1)', fg: '#15803D' }
        : { bg: colors.bg, fg: colors.textSecondary };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      background: palette.bg, color: palette.fg,
      padding: '2px 8px', borderRadius: 999,
      fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
    }}>
      #{rank}{total ? ` / ${total}` : ''} BLW
    </span>
  );
}

// ─── PlayerHero — ESPN-style header card ───────────────────────────────────
// Renders:
//   [profile circle]  [name + team/number + position + CTA]   [vitals column]   [season stats card]
// Vitals sourced from manual_players.* — we read player.vitals if present
// (stored under that shape client-side after migration 004 lands + app
// reads them). Missing fields render a neutral "—".

function formatHeight(totalInches) {
  if (!totalInches || Number.isNaN(Number(totalInches))) return null;
  const n = Number(totalInches);
  const ft = Math.floor(n / 12);
  const inch = n % 12;
  return `${ft}' ${inch}"`;
}

function formatBirthdate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const age = Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    return `${d.toLocaleDateString('en-US')}${age ? ` (${age})` : ''}`;
  } catch { return null; }
}

// League-rank row — uses the same VitalRow layout but injects a movement
// indicator (▲3 / ▼2 / —) when we know the rank delta. rankChange > 0
// means the player MOVED UP (lower rank number = better), so a green
// up-arrow. < 0 = moved down = red down-arrow. 0 = steady (gray dash).
function LeagueRankRow({ ranking }) {
  const rank = ranking?.currentRank || null;
  const change = typeof ranking?.rankChange === 'number' ? ranking.rankChange : 0;
  if (!rank) {
    return <VitalRow label="League Rank" value={null} />;
  }
  const arrow = change > 0 ? '▲' : change < 0 ? '▼' : '—';
  const arrowColor = change > 0 ? '#15803D' : change < 0 ? '#991B1B' : colors.textMuted;
  const compositePts = typeof ranking?.compositePoints === 'number'
    ? ranking.compositePoints.toLocaleString()
    : null;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0', borderBottom: `1px solid ${colors.divider}` }}>
      <div style={{
        fontFamily: fonts.body, fontSize: 11, fontWeight: 600,
        color: colors.textMuted, letterSpacing: 0.2,
        width: 76, flexShrink: 0,
      }}>League rank</div>
      <div style={{
        fontFamily: fonts.body, fontSize: 13, color: colors.text, fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontFamily: fonts.heading, fontSize: 18, lineHeight: 1, letterSpacing: 0.5 }}>
          #{rank}
        </span>
        {change !== 0 && (
          <span title={change > 0 ? `Up ${change} from last week` : `Down ${Math.abs(change)} from last week`} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
            color: arrowColor,
          }}>
            <span style={{ fontSize: 10 }}>{arrow}</span>
            {Math.abs(change)}
          </span>
        )}
        {compositePts && (
          <span style={{
            fontFamily: fonts.condensed, fontSize: 10, fontWeight: 600,
            color: colors.textMuted, letterSpacing: 0.3,
          }}>
            {compositePts} PTS
          </span>
        )}
      </div>
    </div>
  );
}

// Compact "HT/WT" style stat row with bold value on the right.
function VitalRow({ label, value, dot }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0', borderBottom: `1px solid ${colors.divider}` }}>
      <div style={{
        // Sentence-case for vital labels — "Height" reads cleaner than
        // "HEIGHT" at this size, especially in Inter where lowercase is
        // a first-class citizen rather than an afterthought (which is
        // why the codebase had to ALL CAPS everything when it was set
        // in Bebas).
        fontFamily: fonts.body, fontSize: 11, fontWeight: 600,
        color: colors.textMuted, letterSpacing: 0.2,
        width: 76, flexShrink: 0,
      }}>{label}</div>
      <div style={{
        fontFamily: fonts.body, fontSize: 13, color: colors.text, fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {dot && <span style={{
          width: 8, height: 8, borderRadius: '50%', background: dot,
        }} />}
        {value || <span style={{ color: colors.textMuted, fontWeight: 400 }}>—</span>}
      </div>
    </div>
  );
}

// Season stats compact card — 4 KPIs with tiny league-rank labels.
// Renders one stat sub-card (gradient header + 4-tile grid). Reused by
// SeasonStatsCard so two-way players can show batting + pitching stacked
// in the same hero column. Each card is self-contained: its own header,
// its own tile grid, its own percentile bars.
function SeasonStatsSubCard({ team, label, tiles }) {
  return (
    <div style={{
      background: colors.white,
      border: `1px solid ${colors.borderLight}`,
      borderRadius: radius.base,
      overflow: 'hidden',
      boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
    }}>
      <div style={{
        background: `linear-gradient(135deg, ${team.color}, ${team.dark})`,
        color: '#fff',
        padding: '10px 14px',
        fontFamily: fonts.condensed, fontSize: 12, fontWeight: 700,
        letterSpacing: 1.4, textAlign: 'center', textTransform: 'uppercase',
      }}>
        {label}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        padding: '16px 8px', gap: 4,
      }}>
        {tiles.map(t => {
          const pct = (t.rank && t.total && t.total > 0)
            ? Math.max(0, Math.min(1, 1 - (t.rank - 1) / Math.max(1, t.total - 1)))
            : null;
          const fill = pct == null
            ? colors.borderLight
            : t.highlight
              ? team.color
              : (pct >= 0.85 ? '#22C55E' : pct >= 0.5 ? '#3B82F6' : pct >= 0.25 ? '#F59E0B' : '#94A3B8');
          return (
            <div key={t.label} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '2px 4px',
            }}>
              <div style={{
                fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
              }}>{t.label}</div>
              {/* Stat value font size auto-shrinks for longer numbers
                  (3.50 fits at 34, 12.45 needs to drop) so pitching
                  ERAs / WHIPs / K/4 ratios never overflow the tile.
                  Lookup table is cheaper than a measure pass and the
                  result is identical at every viewport. Letter-spacing
                  also dialed down at smaller sizes to keep numbers
                  readable. */}
              {(() => {
                const raw = t.value == null ? '—' : String(t.value);
                const len = raw.length;
                const fontSize = len >= 6 ? 22 : len === 5 ? 26 : len === 4 ? 30 : 34;
                const letterSpacing = len >= 5 ? 0 : 0.5;
                return (
                  <div style={{
                    fontFamily: fonts.heading, fontSize,
                    color: t.highlight ? colors.accent : colors.text,
                    lineHeight: 1, letterSpacing,
                    whiteSpace: 'nowrap',
                    maxWidth: '100%',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{raw}</div>
                );
              })()}
              <div style={{
                fontFamily: fonts.condensed, fontSize: 10, fontWeight: 600,
                color: colors.textMuted, letterSpacing: 0.4,
              }}>
                {t.rank ? `#${t.rank} / ${t.total}` : '—'}
              </div>
              {/* Percentile bar — visible only when rank/total available.
                  Tinted with team color for the marquee stat in each row. */}
              {pct != null && (
                <div
                  aria-hidden="true"
                  title={`${Math.round(pct * 100)}th percentile`}
                  style={{
                    marginTop: 2, width: '78%',
                    height: 3, borderRadius: 999,
                    background: 'rgba(0,0,0,0.06)',
                    position: 'relative', overflow: 'hidden',
                  }}
                >
                  <div style={{
                    position: 'absolute', top: 0, left: 0, bottom: 0,
                    width: `${pct * 100}%`,
                    background: fill,
                    borderRadius: 999,
                  }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Hero-column stats. For two-way players, renders BOTH batting + pitching
// as two stacked sub-cards in the same flex slot. For single-role players,
// renders just one. The wrapper enforces flex sizing so the column behavior
// is identical regardless of how many sub-cards live inside.
function SeasonStatsCard({ player, team, battingRanks, pitchingRanks, bTotal, pTotal }) {
  const hasBatting = !!player.batting;
  const hasPitching = !!player.pitching;

  const battingTiles = [
    { label: 'AVG',  value: player.batting?.avg,      rank: battingRanks?.avg,      total: bTotal },
    { label: 'HR',   value: player.batting?.hr,       rank: battingRanks?.hr,       total: bTotal },
    { label: 'RBI',  value: player.batting?.rbi,      rank: battingRanks?.rbi,      total: bTotal },
    { label: 'OPS+', value: player.batting?.ops_plus, rank: battingRanks?.ops_plus, total: bTotal, highlight: true },
  ];

  const pitchingTiles = [
    { label: 'ERA',  value: player.pitching?.era,  rank: pitchingRanks?.era,  total: pTotal },
    { label: 'IP',   value: player.pitching?.ip,   rank: pitchingRanks?.ip,   total: pTotal },
    { label: 'K/4',  value: player.pitching?.k4,   rank: pitchingRanks?.k4,   total: pTotal, highlight: true },
    { label: 'WHIP', value: player.pitching?.whip, rank: pitchingRanks?.whip, total: pTotal },
  ];

  // Single-role: original visual carries over with the original label.
  // Two-way: split the labels so each card is unambiguous about which
  // role it's reporting.
  const isTwoWay = hasBatting && hasPitching;
  const battingLabel = isTwoWay ? '2026 Batting' : '2026 Season Stats';
  const pitchingLabel = isTwoWay ? '2026 Pitching' : '2026 Season Stats';

  return (
    <div style={{
      // Now that the tier-badge column is gone, the stats card gets the
      // breathing room. Larger min-width + flex basis so it can expand
      // into what used to be column 4. For two-way players, the wrapper
      // becomes a vertical flex stack of two sub-cards.
      minWidth: 280,
      flex: '1 1 280px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      {hasBatting && (
        <SeasonStatsSubCard team={team} label={battingLabel} tiles={battingTiles} />
      )}
      {hasPitching && (
        <SeasonStatsSubCard team={team} label={pitchingLabel} tiles={pitchingTiles} />
      )}
    </div>
  );
}

// Admin-only photo picker modal. Renders every piece of media for the
// team in a grid so the admin can click any asset — headshot, action
// shot, even a team photo — as this player's profile circle. "Reset to
// default" clears the override so the default HEADSHOT heuristic
// resumes. Closes on background click, ESC, or after a successful pick.
// Pan/zoom positioning editor for the chosen profile photo. Renders the
// avatar in the same circular crop the player hero uses, with drag-to-pan
// and scroll-to-zoom plus sliders + reset. Persists profile_offset_x/y +
// profile_zoom to manual_players via the parent's onSave callback.
function PositionEditor({ team, src, initial, onClose, onSave, saving }) {
  const PREVIEW = 280; // editor circle diameter — bigger than the hero so
                      // small adjustments are easy to dial in
  const [offsetX, setOffsetX] = useState(initial?.offsetX ?? 0);
  const [offsetY, setOffsetY] = useState(initial?.offsetY ?? 0);
  const [zoom,    setZoom]    = useState(initial?.zoom ?? 1);
  const dragRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  // Drag-to-pan. The img inside is scaled by `zoom`; one px of drag in
  // display space ≈ 1/zoom px of "image" space. We persist offset as
  // a fraction of the pannable range, so the consumer can apply it via
  // CSS object-position (which is also a fraction of the cover frame).
  const onPointerDown = useCallback((e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX0: offsetX,
      offsetY0: offsetY,
    };
  }, [offsetX, offsetY]);

  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    // New pan math (matches PositionedAvatar's translate+scale transform):
    //   visible_dx_px = (offsetX * 50% × PREVIEW) × zoom
    //                 = offsetX × PREVIEW/2 × zoom
    // So a 1-display-pixel drag should change offsetX by:
    //   Δoffset = 2 / (PREVIEW × zoom)
    // Sign: drag RIGHT → image follows the cursor → offsetX increases.
    // (Earlier code subtracted the delta because it was thinking in
    // object-position terms; the new translate transform is the
    // opposite convention.)
    const z = Math.max(1, zoom);
    const range = (PREVIEW / 2) * z;
    const dx = (e.clientX - drag.startX) / range;
    const dy = (e.clientY - drag.startY) / range;
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    setOffsetX(clamp(drag.offsetX0 + dx));
    setOffsetY(clamp(drag.offsetY0 + dy));
  }, [zoom]);

  const onPointerUp = useCallback((e) => {
    if (dragRef.current) {
      e.currentTarget.releasePointerCapture?.(dragRef.current.pointerId);
      dragRef.current = null;
    }
  }, []);

  // Scroll-to-zoom on the preview circle. Uses passive:false via useEffect
  // so we can preventDefault the page scroll.
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const onWheel = (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      setZoom(z => Math.max(1, Math.min(4, z * factor)));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const reset = () => { setOffsetX(0); setOffsetY(0); setZoom(1); };
  const handleSave = () => onSave({ offsetX, offsetY, zoom });

  return (
    <div
      onClick={() => !saving && onClose?.()}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460,
          background: colors.white, borderRadius: radius.lg,
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: 18, borderBottom: `1px solid ${colors.borderLight}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <TeamLogo teamId={team.id} size={28} rounded="square" />
          <div style={{ flex: 1 }}>
            <h2 style={{ fontFamily: fonts.heading, fontSize: 22, margin: 0, letterSpacing: 1.2, fontWeight: 400 }}>
              Adjust position
            </h2>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
              Drag to pan · Scroll to zoom · Affects the profile photo only.
            </div>
          </div>
          <button onClick={() => !saving && onClose?.()} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 22, color: colors.textSecondary, padding: '2px 6px',
          }}>✕</button>
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div
            ref={wrapRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
              width: PREVIEW, height: PREVIEW,
              borderRadius: '50%', overflow: 'hidden',
              border: `4px solid ${team.color}`,
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
              touchAction: 'none',
              cursor: dragRef.current ? 'grabbing' : 'grab',
              background: '#1A1A22',
            }}
          >
            <img
              src={src}
              alt="Profile preview"
              draggable={false}
              style={{
                width: '100%', height: '100%',
                objectFit: 'cover',
                objectPosition: 'center center',
                // Same transform PositionedAvatar uses everywhere — single
                // translate+scale so pan and zoom apply uniformly on both
                // axes. Object-position is anchored at center so the
                // transform is the only thing moving the image.
                transform: `translate(${offsetX * 50}%, ${offsetY * 50}%) scale(${zoom})`,
                transformOrigin: 'center center',
                display: 'block',
                pointerEvents: 'none', // wrapper owns pointer events
                userSelect: 'none',
              }}
            />
          </div>

          {/* Sliders — duplicate of drag/scroll for fine control */}
          <div style={{ width: '100%' }}>
            {[
              { key: 'zoom',    label: 'Zoom',     value: zoom,    set: setZoom,    min: 1,  max: 4, step: 0.01, fmt: v => `${v.toFixed(2)}×` },
              { key: 'offsetX', label: 'Pan X',    value: offsetX, set: setOffsetX, min: -1, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
              { key: 'offsetY', label: 'Pan Y',    value: offsetY, set: setOffsetY, min: -1, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
            ].map(s => (
              <div key={s.key} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, fontWeight: 600 }}>{s.label}</span>
                  <span style={{ fontFamily: fonts.condensed, fontSize: 11, color: colors.accent, fontWeight: 700 }}>
                    {s.fmt(s.value)}
                  </span>
                </div>
                <input
                  type="range" min={s.min} max={s.max} step={s.step}
                  value={s.value}
                  onChange={e => s.set(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: colors.accent }}
                />
              </div>
            ))}
          </div>
        </div>

        <div style={{
          padding: 14, borderTop: `1px solid ${colors.borderLight}`,
          display: 'flex', gap: 8, justifyContent: 'space-between',
        }}>
          <OutlineButton onClick={reset} disabled={saving}>Reset</OutlineButton>
          <div style={{ display: 'flex', gap: 8 }}>
            <OutlineButton onClick={() => !saving && onClose?.()} disabled={saving}>Cancel</OutlineButton>
            <RedButton onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save position'}
            </RedButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhotoPicker({ team, teamMedia, mediaUrls, currentId, onClose, onPick, saving }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Split media by asset-type group so the picker reads "Headshots on
  // top, action shots, then team photos" — easier to scan at a glance.
  const groups = {};
  for (const m of teamMedia) {
    const k = m.assetType || 'FILE';
    (groups[k] = groups[k] || []).push(m);
  }
  // Preferred order so headshots surface first
  // New (v4.3.0) names listed first; legacy values (ACTION/ACTION2/
  // HIGHLIGHT2) kept further down so existing media still groups
  // correctly until the master admin runs the rename SQL.
  const orderedKeys = ['HEADSHOT', 'PORTRAIT', 'HITTING', 'ACTION', 'PITCHING', 'ACTION2', 'HIGHLIGHT', 'HYPE', 'HIGHLIGHT2', 'INTERVIEW', 'GROUP', 'TEAMPHOTO', 'VENUE', 'LOGO_PRIMARY', 'LOGO_DARK', 'LOGO_LIGHT', 'LOGO_ICON', 'WORDMARK', 'FILE'];
  const sortedKeys = [
    ...orderedKeys.filter(k => groups[k]?.length),
    ...Object.keys(groups).filter(k => !orderedKeys.includes(k)),
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 820, maxHeight: '85vh',
          background: colors.white, borderRadius: radius.lg,
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: 18, borderBottom: `1px solid ${colors.borderLight}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <TeamLogo teamId={team.id} size={28} rounded="square" />
          <div style={{ flex: 1 }}>
            <h2 style={{ fontFamily: fonts.heading, fontSize: 22, margin: 0, letterSpacing: 1.2, fontWeight: 400 }}>
              Choose profile photo
            </h2>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
              Pick any asset uploaded for {team.name}. Click outside or press ESC to cancel.
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 22, color: colors.textSecondary, padding: '2px 6px',
          }}>✕</button>
        </div>

        {/* Grid */}
        <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
          {teamMedia.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: colors.textSecondary, fontSize: 13 }}>
              No media uploaded for {team.name} yet. Go to <strong>Files</strong> to add some.
            </div>
          )}
          {sortedKeys.map(key => (
            <div key={key} style={{ marginBottom: 20 }}>
              <div style={{
                fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
                marginBottom: 8,
              }}>
                {key} ({groups[key].length})
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8,
              }}>
                {groups[key].map(m => {
                  const url = mediaUrls[m.id];
                  const active = m.id === currentId;
                  return (
                    <button
                      key={m.id}
                      onClick={() => !saving && onPick(m.id)}
                      disabled={saving}
                      title={m.name}
                      style={{
                        display: 'flex', flexDirection: 'column',
                        padding: 0, border: `2px solid ${active ? colors.accent : colors.borderLight}`,
                        borderRadius: radius.base, overflow: 'hidden',
                        background: colors.white, cursor: saving ? 'wait' : 'pointer',
                        boxShadow: active ? `0 0 0 2px ${colors.accentBorder}` : 'none',
                        transition: 'all 0.12s',
                      }}
                    >
                      <div style={{
                        width: '100%', aspectRatio: '1 / 1',
                        background: url
                          ? `url(${url}) center/cover`
                          : `linear-gradient(135deg, ${team.color}30, ${team.color}10)`,
                      }} />
                      <div style={{
                        padding: '4px 6px', fontSize: 10, fontFamily: fonts.condensed,
                        color: colors.text, textAlign: 'left',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{m.name}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: 14, borderTop: `1px solid ${colors.borderLight}`,
          display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          <OutlineButton onClick={() => !saving && onPick(null)} disabled={saving}>
            Reset to default
          </OutlineButton>
          <OutlineButton onClick={onClose} disabled={saving}>
            Cancel
          </OutlineButton>
        </div>
      </div>
    </div>
  );
}

// Compact "More info" badge that expands a small popover with the
// player's Instagram handle (linked) and fun-facts blurb. Returns null
// when neither piece of data is present so the chip never shows up
// for players with empty bios.
function ExtrasDropdown({ instagramHandle, funFacts }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Close on outside click + ESC, same pattern as the profile menu in App.jsx
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!instagramHandle && !funFacts) return null;

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Player extras"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 12px', borderRadius: radius.full,
          background: open ? colors.bg : 'transparent',
          color: colors.textSecondary,
          border: `1px solid ${colors.border}`,
          cursor: 'pointer',
          fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
          letterSpacing: 0.4, textTransform: 'uppercase',
          transition: 'background 0.12s',
        }}
      >
        <span style={{ fontSize: 12 }}>ⓘ</span>
        More
        <span style={{
          fontSize: 9, opacity: 0.6,
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.12s',
        }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0,
          minWidth: 240, maxWidth: 320,
          background: colors.white,
          border: `1px solid ${colors.border}`,
          borderRadius: radius.base,
          boxShadow: '0 10px 28px rgba(17,24,39,0.14), 0 2px 6px rgba(17,24,39,0.06)',
          zIndex: 30,
          padding: 12,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {instagramHandle && (
            <div>
              <div style={{
                fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
                color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
                marginBottom: 4,
              }}>Instagram</div>
              <a
                href={`https://instagram.com/${instagramHandle}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontFamily: fonts.body, fontSize: 13, fontWeight: 700,
                  color: colors.accent, textDecoration: 'none',
                }}
              >
                <span style={{ fontSize: 14 }}>📷</span>
                @{instagramHandle}
                <span style={{ fontSize: 10, opacity: 0.6 }}>↗</span>
              </a>
            </div>
          )}
          {funFacts && (
            <div>
              <div style={{
                fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
                color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
                marginBottom: 4,
              }}>Fun facts</div>
              <div style={{
                fontFamily: fonts.body, fontSize: 12, color: colors.text,
                lineHeight: 1.5, whiteSpace: 'pre-wrap',
              }}>{funFacts}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlayerHero({ player, team, avatarUrl, profileOffsetX, profileOffsetY, profileZoom, playerRank, battingRanks, pitchingRanks, bTotal, pTotal, onGenerate, generating = false, canEditPhoto, onEditPhoto, onAdjustPhoto, prevPlayer = null, nextPlayer = null }) {
  // Vitals — pull from whatever the merged player object carries. All optional.
  const v = player.vitals || {};
  const height = formatHeight(v.heightIn);
  const weight = v.weightLbs ? `${v.weightLbs} lbs` : null;
  const htWt = height && weight ? `${height}, ${weight}` : height || weight || null;
  const birth = formatBirthdate(v.birthdate);
  const bats = v.bats ? ({ R: 'Right', L: 'Left', S: 'Switch' }[v.bats] || v.bats) : null;
  const throws = v.throws ? ({ R: 'Right', L: 'Left' }[v.throws] || v.throws) : null;
  const batThrow = bats && throws ? `${bats}/${throws}` : (bats || throws || null);
  const birthplace = v.birthplace || null;
  const nickname = v.nickname || null;
  const status = v.status || 'active';
  const statusColor = status === 'active' ? colors.success : status === 'injured' ? colors.warning : colors.textMuted;
  const statusLabel = status === 'active' ? 'Active' : status === 'injured' ? 'Injured' : 'Inactive';

  const position = player.batting && player.pitching
    ? 'Two-Way Player'
    : player.batting ? 'Batter'
    : player.pitching ? 'Pitcher'
    : (player.position || '—');

  // Split "Josh Jung" → first name + last name for stacked layout. If we
  // only got a last name (roster-only records), show just the lastName.
  const parts = (player.name || player.lastName || '').split(/\s+/);
  const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
  const lastNameDisplay = parts.length > 1 ? parts[parts.length - 1] : parts[0];

  return (
    <div style={{
      background: colors.white,
      // Full-bleed hairline tinted with the team color replaces the prior
      // 4px left side-stripe. Avatar border, team chip, and the team-color
      // gradient wash already brand the hero.
      border: `1px solid ${team.color}33`,
      borderRadius: radius.lg,
      // Subtle two-layer drop shadow — gives the hero card a bit of lift
      // off the page without going full Material-raised. The wider, softer
      // outer layer does the ambient feel; the tighter inner layer sharpens
      // the edge on the sides of the card.
      boxShadow: '0 8px 24px rgba(17,24,39,0.08), 0 2px 6px rgba(17,24,39,0.05)',
      // overflow visible (not hidden) so the ExtrasDropdown's absolutely-
      // positioned menu can escape the hero card. The team-color gradient
      // wash below uses alpha values low enough that letting it bleed past
      // the rounded corners would be invisible anyway, so the trade is
      // safe — but we clip the gradient itself with its own overflow.
      overflow: 'visible',
      position: 'relative',
    }}>
      {/* Subtle team gradient wash on the left pane. Clipped by its own
          rounded-corner mask + a small inset so it doesn't paint over the
          card's border radius now that the parent doesn't clip. */}
      <div style={{
        position: 'absolute', top: 0, left: 0, width: 240, height: '100%',
        background: `linear-gradient(135deg, ${team.color}18, ${team.color}04 70%, transparent)`,
        borderRadius: `${radius.lg}px 0 0 ${radius.lg}px`,
        pointerEvents: 'none',
      }} />
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 24,
        padding: 22,
        alignItems: 'center',
        position: 'relative',
      }}>
        {/* Col 1 — Profile + name + team chip. flex:1 so name breathes if there's space. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flex: '2 1 300px', minWidth: 260 }}>
          {/* Avatar column — circle plus the Instagram chip stacked
              below. Vertical flex so the IG handle reads as part of the
              player's identity, not their stat row. Gap leaves enough
              room for the tier badge that overflows the circle on the
              bottom-right (extends ~29px below the wrapper). */}
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            flexShrink: 0, gap: 36,
          }}>
          {/* Profile circle — wrapped in position:relative so the tier
              badge can overlay on the bottom-right. Circle bumped to
              128px to give the 80px tier badge more landing room without
              eating too much of the photo/initials. */}
          <div style={{ position: 'relative', width: 128, height: 128 }}>
            <PositionedAvatar
              src={avatarUrl}
              offsetX={profileOffsetX}
              offsetY={profileOffsetY}
              zoom={profileZoom}
              size={128}
              borderColor={team.color}
              borderWidth={3}
              fallbackBg={`linear-gradient(135deg, ${team.color}, ${team.dark})`}
              fallback={
                <span style={{
                  color: '#fff',
                  fontFamily: fonts.heading, fontSize: 46, letterSpacing: 1,
                }}>
                  {(player.lastName || '??').slice(0, 2).toUpperCase()}
                </span>
              }
              style={{ boxShadow: '0 4px 14px rgba(0,0,0,0.14)' }}
            />
            {/* Admin-only edit buttons. Pencil = pick photo, target =
                pan/zoom adjust. Stacked top-left so they never collide
                with the tier badge sitting bottom-right. */}
            {canEditPhoto && (
              <button
                onClick={onEditPhoto}
                title="Change profile photo"
                style={{
                  position: 'absolute',
                  top: -4, left: -4,
                  width: 32, height: 32, borderRadius: radius.full,
                  background: colors.white,
                  border: `2px solid ${team.color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                  fontSize: 14, lineHeight: 1,
                  padding: 0,
                  zIndex: 1,
                }}
              >
                ✎
              </button>
            )}
            {canEditPhoto && avatarUrl && (
              <button
                onClick={onAdjustPhoto}
                title="Adjust photo position (pan/zoom)"
                style={{
                  position: 'absolute',
                  top: 30, left: -4,
                  width: 32, height: 32, borderRadius: radius.full,
                  background: colors.white,
                  border: `2px solid ${team.color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                  fontSize: 14, lineHeight: 1,
                  padding: 0,
                  zIndex: 1,
                }}
              >
                ⌖
              </button>
            )}
            {/* Tier badge — overlaid at the 4:30 perimeter point.
                Geometry: circle 128 (radius 64), badge 96. Its CENTER
                sits on the circle perimeter at 45° which is (cos45° × 64,
                sin45° × 64) ≈ (45, 45) from the circle center. So the
                badge top-left offsets (64 + 45 − 48, 64 + 45 − 48) ≈
                (61, 61), i.e. bottom: -29, right: -29 from the 128px
                wrapper. Drop shadow lifts it off either a photo or a
                colored gradient. */}
            {playerRank && (
              <div style={{
                position: 'absolute',
                bottom: -29, right: -29,
                filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.28))',
                pointerEvents: 'none',
              }}>
                <TierBadge rank={playerRank} size={96} />
              </div>
            )}
          </div>
          {/* IG chip — sits below the avatar (and clears the tier badge
              via the column gap). One click → opens the player's
              profile in a new tab. Hidden when the handle is unset. */}
          {player.instagramHandle && (
            <a
              href={`https://instagram.com/${player.instagramHandle}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`@${player.instagramHandle} on Instagram`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                letterSpacing: 0.4,
                padding: '3px 10px', borderRadius: radius.full,
                background: 'rgba(228, 64, 95, 0.10)',
                color: '#E4405F',
                border: '1px solid rgba(228, 64, 95, 0.30)',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                maxWidth: 140,
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              @{player.instagramHandle}
            </a>
          )}
          </div>
          <div style={{ minWidth: 0 }}>
            {firstName && (
              <div style={{
                fontFamily: fonts.heading,
                fontSize: 30, lineHeight: 0.9,
                color: colors.text, letterSpacing: 'var(--font-heading-tracking, 1.5px)',
                textTransform: 'uppercase',
              }}>{firstName}</div>
            )}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              marginTop: firstName ? 2 : 0,
            }}>
              <div style={{
                fontFamily: fonts.heading,
                fontSize: 38, lineHeight: 0.9,
                color: colors.text, letterSpacing: 'var(--font-heading-tracking, 1.5px)',
                textTransform: 'uppercase',
              }}>{lastNameDisplay}</div>
              {/* Rookie chip — only renders when player.isRookie. Sits
                  inline with the lastName so it's the first thing the
                  eye lands on after the player's identity. */}
              {player.isRookie && (
                <span title="Rookie season" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: radius.full,
                  background: 'linear-gradient(135deg, #FCD34D, #F59E0B)',
                  color: '#451A03', fontFamily: fonts.condensed,
                  fontSize: 10, fontWeight: 800, letterSpacing: 1,
                  textTransform: 'uppercase',
                  boxShadow: '0 1px 3px rgba(245, 158, 11, 0.4)',
                  border: '1px solid rgba(245, 158, 11, 0.6)',
                }}>
                  <span style={{ fontSize: 10 }}>★</span> Rookie
                </span>
              )}
            </div>

            {/* Nickname — quiet italic line, shown only when present.
                Lives directly under the lastName so it reads as part
                of the identity ("Konnor Jaso · 'The Closer'"). */}
            {nickname && (
              <div style={{
                marginTop: 6,
                fontFamily: fonts.body, fontStyle: 'italic',
                fontSize: 13, color: colors.textSecondary,
                letterSpacing: 0.2,
              }}>
                "{nickname}"
              </div>
            )}

            {/* Team + jersey + position row */}
            <div style={{
              marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            }}>
              <TeamLogo teamId={team.id} size={18} rounded="square" />
              <span style={{
                fontFamily: fonts.body, fontSize: 12, color: colors.text, fontWeight: 700,
              }}>{team.name}</span>
              <span style={{ color: colors.textMuted, fontSize: 11 }}>·</span>
              <span style={{
                fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                color: colors.textSecondary, letterSpacing: 0.5,
              }}>
                {player.num ? `#${player.num}` : 'NO #'}
              </span>
              <span style={{ color: colors.textMuted, fontSize: 11 }}>·</span>
              <span style={{
                fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                color: colors.textSecondary, letterSpacing: 0.5,
              }}>{position}</span>
              {/* Composite rank chip — pulls from the league-wide composite
                  rankings feed. Surfaces the number right next to the tier
                  badge's visual tier so a scanner can read "OH, they're
                  #19 league-wide, that's the real context." */}
              {playerRank && (
                <>
                  <span style={{ color: colors.textMuted, fontSize: 11 }}>·</span>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800, letterSpacing: 0.8,
                    padding: '2px 8px', borderRadius: radius.full,
                    background: `${team.color}18`, color: team.color,
                    border: `1px solid ${team.color}40`,
                    textTransform: 'uppercase',
                  }}>
                    <span style={{ fontFamily: fonts.heading, fontSize: 12, lineHeight: 1 }}>
                      #{playerRank}
                    </span>
                    <span>Composite</span>
                  </span>
                </>
              )}
            </div>

            {/* Fun-facts strip — quiet italic blurb directly under the
                identity row. Used to be tucked behind the "More" dropdown,
                but it's the single most personality-bearing piece of bio
                we have, so we surface it inline now. Hidden when blank. */}
            {player.funFacts && (
              <div style={{
                marginTop: 8,
                fontFamily: fonts.body, fontSize: 12,
                color: colors.textSecondary, lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                maxWidth: '60ch',
                paddingLeft: 10, borderLeft: `2px solid ${team.color}40`,
              }}>
                {player.funFacts}
              </div>
            )}

            {/* Generate Content — single CTA. Click triggers an AI idea
                generation scoped to this player; the resulting card pops
                up in a modal with the IdeaCard's existing "Open in
                Generate" path so the user gets a drafted idea (headline +
                story + captions) before landing in the canvas. */}
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <RedButton
                onClick={onGenerate}
                disabled={generating}
                style={{ padding: '8px 16px', fontSize: 12 }}
              >
                {generating ? '…GENERATING' : '✦ Generate content'}
              </RedButton>
            </div>
          </div>
        </div>

        {/* Col 2 — Vital stats */}
        <div style={{ flex: '1 1 200px', minWidth: 200 }}>
          <VitalRow label="HT/WT" value={htWt} />
          <VitalRow label="Birthdate" value={birth} />
          <VitalRow label="Bat/Thr" value={batThrow} />
          <VitalRow label="Birthplace" value={birthplace} />
          <VitalRow label="Status" value={statusLabel} dot={statusColor} />
          {/* League rank — shown prominently in vitals so a viewer
              sees composite standing alongside physical profile.
              Renders arrow + delta when rank changed this week. */}
          <LeagueRankRow ranking={player.ranking} />
        </div>

        {/* Col 3 — Season stats */}
        <SeasonStatsCard
          player={player} team={team}
          battingRanks={battingRanks} pitchingRanks={pitchingRanks}
          bTotal={bTotal} pTotal={pTotal}
        />

      </div>
    </div>
  );
}

// Single stat tile: value on top, label + league rank chip below, plus a
// thin percentile bar at the bottom that fills proportionally to the
// player's rank-out-of-N (1 = full, last = empty). Lets the user judge
// "how good is this number?" at a glance without having to read the
// "#57 / 64" chip.
function StatTile({ label, value, rank, total, highlight }) {
  // Percentile in [0..1]. Only render when we have both rank + total and
  // total is reasonable. Bar uses team-tinted hue if highlighted (i.e. the
  // marquee stat for this row), otherwise a neutral. Color shifts from
  // muted at 0 to vibrant at 1 so a top-5 stat looks alive.
  const pct = (rank && total && total > 0)
    ? Math.max(0, Math.min(1, 1 - (rank - 1) / Math.max(1, total - 1)))
    : null;
  const barFillColor = pct == null
    ? colors.borderLight
    : highlight
      ? colors.accent
      : (pct >= 0.85 ? '#22C55E' : pct >= 0.5 ? '#3B82F6' : pct >= 0.25 ? '#F59E0B' : '#94A3B8');

  return (
    <div style={{
      padding: '12px 10px',
      background: colors.bg,
      borderRadius: radius.sm,
      border: highlight ? `1px solid ${colors.accentBorder}` : `1px solid ${colors.borderLight}`,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{
        fontFamily: fonts.heading, fontSize: 26, letterSpacing: 0.5,
        color: highlight ? colors.accent : colors.text, lineHeight: 1,
      }}>{value ?? '—'}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700, color: colors.textMuted, letterSpacing: 0.8 }}>{label}</span>
        <RankChip rank={rank} total={total} />
      </div>
      {/* Percentile bar — visible only when rank/total available. Rendered
          as a 4px-tall track at the bottom edge of the tile so it acts as
          a quiet "stat health" indicator without competing with the value. */}
      {pct != null && (
        <div
          aria-hidden="true"
          title={`${Math.round(pct * 100)}th percentile in BLW`}
          style={{
            marginTop: 4,
            height: 4, borderRadius: 999,
            background: 'rgba(0,0,0,0.06)',
            position: 'relative', overflow: 'hidden',
          }}
        >
          <div style={{
            position: 'absolute', top: 0, left: 0, bottom: 0,
            width: `${pct * 100}%`,
            background: barFillColor,
            borderRadius: 999,
            transition: 'width 320ms cubic-bezier(0.22, 1, 0.36, 1)',
          }} />
        </div>
      )}
    </div>
  );
}

export default function PlayerPage() {
  const { slug, lastName } = useParams();
  const navigate = useNavigate();
  const team = getTeam(slug);
  const toast = useToast();
  const { user, role } = useAuth();
  // Photo-edit + pan/zoom buttons surface for ANY staff user (master +
  // content). Picking a player's headshot is daily content work, not a
  // data-management task — locking it to master-only would block the
  // social-media team from doing their job.
  const isAdmin = isStaffRole(role);
  const isMaster = role === 'master_admin';
  const isAthlete = role === 'athlete';

  const [player, setPlayer] = useState(null);
  const [media, setMedia] = useState([]);
  // Full team media (all players + team-scoped assets) for the photo picker.
  // Lazy-loaded the first time the picker opens, then kept in state.
  const [teamMedia, setTeamMedia] = useState([]);
  // ENTIRE local media store — fed to resolvePlayerAvatar so this page
  // sees the same pool TeamPage's roster card sees. Without this, the
  // avatar resolver only had the strict findPlayerMedia() result + the
  // (lazy) teamMedia, which meant the player-page hero would miss photos
  // that the team-page roster successfully matched. (Repro: Cooper Ruckel
  // showed on the AZS roster card but not on his player page; opening
  // the photo picker fetched team media and "fixed" it temporarily, but
  // a refresh wiped teamMedia and the avatar disappeared again.)
  const [allMediaPool, setAllMediaPool] = useState([]);
  const [battingLeaders, setBattingLeaders] = useState([]);
  const [pitchingLeaders, setPitchingLeaders] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [positionEditorOpen, setPositionEditorOpen] = useState(false);
  const [savingPosition, setSavingPosition] = useState(false);
  // Recent posts featuring this player. Pulled from the global generate-log
  // (last 100 posts) and filtered client-side on settings.fields.playerName
  // so we don't need a new index. Soft-fails to an empty list when cloud
  // isn't configured.
  const [recentPosts, setRecentPosts] = useState([]);
  // Generate-content modal state. Clicking the hero CTA fires
  // /api/ideas with a player-scoped seed and shows the resulting
  // single idea in a modal — same IdeaCard that lives on the
  // dashboard, so the user can edit captions or jump into Generate
  // from the popup. Loading state disables the button while waiting
  // for the API. Replacing the legacy direct deep-link with this
  // flow gives the user an AI-drafted idea to work from instead of
  // dropping them into Generate with empty fields.
  const [pendingIdea, setPendingIdea] = useState(null);
  const [generatingIdea, setGeneratingIdea] = useState(false);
  const leagueCtx = useLeagueContext();
  // Teammate roster (alphabetical by lastName) — drives prev/next navigation.
  // Populated in the same mount effect that loads `player`. We don't need
  // media here, just the names → slugs mapping for the nav links.
  const [teammates, setTeammates] = useState([]);

  useEffect(() => {
    let cancel = false;
    if (!team?.id) return;
    // Load stats AND team roster AND ALL manual players in parallel.
    // We pass the FULL manual_players list (not just this team's) so
    // cross-team trade overrides resolve correctly.
    Promise.all([fetchAllData(), fetchTeamRosterFromApi(team.id), getAllManualPlayers(), getAllMedia()])
      .then(async ([allData, , manualList, all]) => {
        if (cancel) return;
        setBattingLeaders(allData.batting || []);
        setPitchingLeaders(allData.pitching || []);
        // Cache the entire local media pool so the avatar resolver has the
        // same visibility TeamPage gives it. See allMediaPool comment above.
        setAllMediaPool(all || []);
        const p = getPlayerByTeamLastName(team.id, lastName, manualList);
        if (p) {
          // Media match uses team + lastName, disambiguated by first initial
          // (handles Carson vs Logan Rose since they have different initials)
          // AND by jersey number (Logan vs Luke Rose share initial 'L', so
          // jersey is the only signal that separates their assets). The
          // canonical roster carries explicit `num` for cousin pairs.
          const m = await findPlayerMedia(team.id, p.lastName, {
            firstInitial: p.firstInitial,
            jerseyNum: p.num,
          });
          if (cancel) return;
          // Source jersey from first uploaded media file if available
          const mediaJersey = m.find(x => x.num)?.num || '';
          setPlayer({ ...p, num: p.num || mediaJersey });
          setMedia(m);
          // Build the teammate roster (alphabetical by lastName) so prev/
          // next navigation works. getTeamRoster handles cousin pairs and
          // canonical-roster injection so even players without API stats
          // appear. We pass an empty mediaList here — we only need names
          // and slugs for the nav links.
          try {
            const roster = getTeamRoster(team.id, [], manualList || []);
            setTeammates(roster);
          } catch { setTeammates([]); }
          // Pull recent generates and filter to posts that named this
          // player in their template fields. We pull a generous 100 so
          // even infrequently-spotlit players have a chance to surface a
          // few results. Filter is name-equality (case-insensitive) and
          // also matches the player's lastName as a fallback for posts
          // whose playerName field is missing/short.
          fetchRecentGenerates(100).then(posts => {
            if (cancel) return;
            const targetName = (p.name || '').trim().toLowerCase();
            const targetLast = (p.lastName || '').trim().toLowerCase();
            const matches = posts.filter(post => {
              if (post.team && post.team !== team.id) return false;
              const fields = post?.settings?.fields || {};
              const pn = String(fields.playerName || '').trim().toLowerCase();
              if (!pn) return false;
              if (targetName && pn === targetName) return true;
              // Loose fallback: same lastName + (no FI conflict OR matching FI)
              const lastInPost = pn.split(/\s+/).pop();
              return targetLast && lastInPost === targetLast;
            });
            setRecentPosts(matches.slice(0, 12));
          }).catch(() => { /* soft-fail */ });
        } else {
          setPlayer(null);
        }
        setLoaded(true);
      });
    return () => { cancel = true; };
  }, [team?.id, lastName]);

  // Blob URLs for player-scoped media, team media, AND the full local
  // media pool. Deduped by id so a single url cache serves every render
  // (profile circle, gallery, picker tile). The `allMediaPool` inclusion
  // is what lets the avatar resolver pick a legacy / cross-team record
  // and have its URL actually resolve here.
  const mediaUrls = useMemo(() => {
    const urls = {};
    const seen = new Set();
    const addAll = (list) => {
      for (const m of list) {
        if (!m || seen.has(m.id)) continue;
        seen.add(m.id);
        if (m.blob) urls[m.id] = blobToObjectURL(m.blob);
      }
    };
    addAll(media);
    addAll(teamMedia);
    addAll(allMediaPool);
    return urls;
  }, [media, teamMedia, allMediaPool]);

  // ─── Photo-picker callbacks ────────────────────────────────────────────
  // IMPORTANT: these useCallbacks MUST live above every conditional return
  // below — React's rules-of-hooks don't allow hook counts to change
  // between renders. (First-render hits "!loaded" → early return, later
  // renders don't — would change hook count and white-screen the page.)
  //
  // Open the photo picker — lazy-load the team's media the first time so
  // we don't fetch every team's blobs on every player page view.
  const openPhotoPicker = useCallback(async () => {
    if (!team?.id) return;
    if (teamMedia.length === 0) {
      try {
        const tm = await findTeamMedia(team.id);
        setTeamMedia(tm || []);
      } catch (err) {
        console.warn('findTeamMedia failed', err);
      }
    }
    setPhotoPickerOpen(true);
  }, [team?.id, teamMedia.length]);

  // Write the profile_media_id override and update local state so the
  // new avatar renders immediately without a round-trip refetch.
  const choosePhoto = useCallback(async (mediaId) => {
    if (!team?.id || !player?.lastName) return;
    setSavingPhoto(true);
    try {
      await upsertManualPlayer({
        team: team.id,
        lastName: player.lastName,
        firstInitial: player.firstInitial,
        firstName: player.firstName,
        num: player.num,
        updates: { profile_media_id: mediaId || null },
      });
      setPlayer(prev => prev ? {
        ...prev,
        profileMediaId: mediaId || null,
        // Picking a new photo resets positioning so the modal opens at
        // identity. The user can re-adjust via the ⌖ button afterward.
        profileOffsetX: null,
        profileOffsetY: null,
        profileZoom: null,
      } : prev);
      toast.success(mediaId ? 'Profile photo updated' : 'Profile photo reset');
      setPhotoPickerOpen(false);
    } catch (err) {
      toast.error('Failed to save', { detail: err.message?.slice(0, 80) });
    } finally {
      setSavingPhoto(false);
    }
  }, [team?.id, player?.lastName, player?.firstInitial, player?.firstName, player?.num, toast]);

  // Persist pan/zoom offsets to manual_players. Same upsert path as the
  // photo picker — mapPlayerToRow on cloud-sync.js translates camelCase →
  // snake_case for the Supabase row.
  const savePosition = useCallback(async ({ offsetX, offsetY, zoom }) => {
    if (!team?.id || !player?.lastName) return;
    setSavingPosition(true);
    try {
      await upsertManualPlayer({
        team: team.id,
        lastName: player.lastName,
        firstInitial: player.firstInitial,
        firstName: player.firstName,
        num: player.num,
        updates: {
          profile_offset_x: offsetX,
          profile_offset_y: offsetY,
          profile_zoom: zoom,
        },
      });
      setPlayer(prev => prev ? {
        ...prev,
        profileOffsetX: offsetX,
        profileOffsetY: offsetY,
        profileZoom: zoom,
      } : prev);
      toast.success('Position saved');
      setPositionEditorOpen(false);
    } catch (err) {
      toast.error('Failed to save', { detail: err.message?.slice(0, 80) });
    } finally {
      setSavingPosition(false);
    }
  }, [team?.id, player?.lastName, player?.firstInitial, player?.firstName, player?.num, toast]);

  // ─── Hooks below MUST stay above the early returns (Rules of Hooks). ─────
  // ── Generate-content flow ──────────────────────────────────────────────
  // The hero CTA used to be a direct deep-link into Generate with the
  // player's name + stat line pre-filled into legacy params. Now it
  // calls /api/ideas with a player-scoped seed and shows the resulting
  // SINGLE idea in a modal — the IdeaCard on the dashboard. From the
  // modal the user can edit captions, queue as a request, or open in
  // Generate (the IdeaCard's own "Open in Generate" deep-link).
  //
  // Tolerates a null `player` / `team` so it can sit above the early
  // returns. The actual click handler bails when player isn't loaded.
  const generateIdea = useCallback(async () => {
    if (!player || !team) return;
    setGeneratingIdea(true);
    try {
      const res = await fetch('/api/ideas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          context: {
            teams: TEAMS.map(t => ({ id: t.id, name: t.name, record: t.record, rank: t.rank, color: t.color, accent: t.accent })),
            batting: battingLeaders.slice(0, 60),
            pitching: pitchingLeaders.slice(0, 60),
            // Pass THIS player's voice block so the modal-generated
            // idea actually reads it. Server keys on TEAM|LASTNAME
            // and only renders for sampled players, so we send a
            // single-key map keyed to the active player.
            athleteVoices: player.athleteVoice && Object.values(player.athleteVoice).some(v => v)
              ? { [`${player.team}|${player.lastName.toUpperCase()}`]: player.athleteVoice }
              : {},
          },
          count: 1,
          seedIdea: {
            id: `playerpage-seed-${Date.now()}`,
            team: player.team || team.id,
            headline: `${player.name} — content seed`,
            prefill: { playerName: player.name },
          },
          team: player.team || team.id,
          leagueContext: leagueCtx.notes || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const idea = (data.ideas || [])[0];
      if (!idea) throw new Error('No idea returned');
      setPendingIdea(idea);
    } catch (err) {
      toast.error('Couldn\'t generate idea', { detail: err.message?.slice(0, 80) });
    } finally {
      setGeneratingIdea(false);
    }
  }, [player, team, battingLeaders, pitchingLeaders, leagueCtx.notes, toast]);

  // They all tolerate null/undefined `team` and `player` so calling them
  // before the data has loaded is safe.

  // Teammate prev/next nav — locate this player in the alphabetical roster,
  // surface link chips + ←/→ keyboard shortcuts. Returns nulls until data is
  // loaded, so the early-return paths above don't see partial state.
  const teammateNav = useMemo(() => {
    if (!teammates.length || !player?.lastName || !team?.slug) {
      return { prev: null, next: null, idx: -1, total: teammates.length || 0 };
    }
    const norm = (s) => String(s || '').toLowerCase();
    const targetName = norm(player.name);
    const targetLast = norm(player.lastName);
    const idx = teammates.findIndex(t =>
      norm(t.name) === targetName || norm(t.lastName) === targetLast
    );
    if (idx < 0) return { prev: null, next: null, idx: -1, total: teammates.length };
    const prev = idx > 0 ? teammates[idx - 1] : null;
    const next = idx < teammates.length - 1 ? teammates[idx + 1] : null;
    const toLink = (t) => {
      if (!t) return null;
      const slug = playerSlug({
        firstName: t.firstName,
        firstInitial: t.firstInitial,
        lastName: t.lastName,
      });
      return {
        name: t.name,
        firstName: t.firstName,
        lastName: t.lastName,
        href: `/teams/${team.slug}/players/${slug}`,
      };
    };
    return { prev: toLink(prev), next: toLink(next), idx, total: teammates.length };
  }, [teammates, player?.name, player?.lastName, team?.slug]);

  // Keyboard shortcuts: ← prev, → next. Skip when focus is in an input/
  // textarea so typing in caption editors / search bars stays unaffected.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      if (e.key === 'ArrowLeft' && teammateNav.prev) {
        e.preventDefault();
        navigate(teammateNav.prev.href);
      } else if (e.key === 'ArrowRight' && teammateNav.next) {
        e.preventDefault();
        navigate(teammateNav.next.href);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [teammateNav.prev, teammateNav.next, navigate]);

  // Sticky mini-hero — fades in once the full hero scrolls out of view.
  // The ref attaches to the hero card further down in the JSX, but we
  // declare the hook up here so it stays in a stable position relative
  // to the early returns below.
  const heroRef = useRef(null);
  const [heroOutOfView, setHeroOutOfView] = useState(false);
  useEffect(() => {
    const node = heroRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver(
      ([entry]) => setHeroOutOfView(!entry.isIntersecting),
      { rootMargin: '-80px 0px 0px 0px', threshold: 0 }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [player?.name]);

  if (!team) {
    return (
      <Card style={{ textAlign: 'center', padding: 40 }}>
        <SectionHeading>Team not found</SectionHeading>
        <Link to="/studio" style={{ color: colors.accent, textDecoration: 'none' }}>← Back to Dashboard</Link>
      </Card>
    );
  }

  if (!loaded) {
    return <Card style={{ padding: 30, textAlign: 'center', color: colors.textMuted }}>Loading player…</Card>;
  }

  if (!player) {
    return (
      <Card style={{ textAlign: 'center', padding: 40 }}>
        <SectionHeading>Player not found</SectionHeading>
        <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12 }}>
          No stats or roster data for "{lastName}" on {team.name}.
        </div>
        <Link to={`/teams/${team.slug}`} style={{ color: colors.accent, textDecoration: 'none' }}>
          ← Back to {team.name}
        </Link>
      </Card>
    );
  }

  // Legacy slug resolved but multiple players share this lastname — warn so
  // the user knows to use the new first-initial link on the team page.
  const ambiguityBanner = player.ambiguous ? (
    <div style={{
      background: '#FEF3C7', color: '#92400E',
      border: '1px solid #FDE68A', borderRadius: radius.sm,
      padding: '10px 14px', fontSize: 13, fontFamily: fonts.body,
    }}>
      ⚠︎ {player.candidateCount} players on {team.name} share the lastname "{player.lastName}". Showing <strong>{player.name}</strong>; use the roster on the team page for a direct link to each player.
    </div>
  ) : null;

  // Group media by asset type
  const grouped = media.reduce((acc, m) => {
    const k = m.assetType || 'FILE';
    (acc[k] = acc[k] || []).push(m);
    return acc;
  }, {});

  // Stat line is still useful for the IdeaCard's "Open in Generate"
  // path — kept here so the existing helper still resolves.
  const statLine = buildStatLine(player);

  // Avatar resolution — delegate to the canonical resolver in
  // media-store.js so the player hero and team-page roster card always
  // pick the same photo. Feeds the FULL local media pool (not just the
  // strict findPlayerMedia result + lazy teamMedia) so this page sees
  // the same records TeamPage sees. Lastname uniqueness is irrelevant
  // here — the lookup is already scoped by FI + num to this specific
  // player — so we leave lastnameUnique at its default of true.
  const avatarPool = allMediaPool.length > 0 ? allMediaPool : [...media, ...teamMedia];
  // candidateCount > 1 means a cousin pair shares this lastname on the
  // team — the resolver must NOT fall back to lastname-only matches in
  // that case (would hand the wrong cousin's photo to whichever player
  // happens to render first). Single-Jeter players (Caleb on LAN) get
  // the relaxed fallback so a stale FI mismatch doesn't blank the avatar.
  const lastnameUnique = !player.candidateCount || player.candidateCount === 1;
  const headshot = resolvePlayerAvatar(player, avatarPool, {
    profileMediaId: player.profileMediaId,
    lastnameUnique,
  });
  const avatarUrl = headshot ? mediaUrls[headshot.id] : null;

  // ─── Per-stat league-rank lookups ────────────────────────────────────────
  // Rank this player against all BLW batters/pitchers for each displayed stat
  const bTotal = battingLeaders.length;
  const pTotal = pitchingLeaders.length;
  const pn = player.name;
  const battingRanks = player.batting ? {
    avg:      rankOf(battingLeaders, pn, 'avg',      'desc', parseFloat),
    hits:     rankOf(battingLeaders, pn, 'hits',     'desc', Number),
    hr:       rankOf(battingLeaders, pn, 'hr',       'desc', Number),
    rbi:      rankOf(battingLeaders, pn, 'rbi',      'desc', Number),
    obp:      rankOf(battingLeaders, pn, 'obp',      'desc', parseFloat),
    ops_plus: rankOf(battingLeaders, pn, 'ops_plus', 'desc', Number),
  } : null;
  const pitchingRanks = player.pitching ? {
    era:  rankOf(pitchingLeaders, pn, 'era',  'asc',  parseFloat),
    whip: rankOf(pitchingLeaders, pn, 'whip', 'asc',  parseFloat),
    k4:   rankOf(pitchingLeaders, pn, 'k4',   'desc', parseFloat),
    bb4:  rankOf(pitchingLeaders, pn, 'bb4',  'asc',  parseFloat),
    // IP — descending (more is better, durability signal). Powers the
    // hero strip's percentile bar; the field-level rank chip already
    // renders only when this is non-null, so a missing rank just hides
    // the bar without breaking layout.
    ip:   rankOf(pitchingLeaders, pn, 'ip',   'desc', parseFloat),
  } : null;

  const playerRank = player.ranking?.currentRank || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {ambiguityBanner}

      {/* Breadcrumb + teammate nav. Left side links back to the team
          page, right side has prev/next teammate chips. ←/→ keyboard
          shortcuts also fire (when no input has focus) — see the
          teammateNav effect above. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        fontSize: 12, fontFamily: fonts.condensed,
        flexWrap: 'wrap', justifyContent: 'space-between',
      }}>
        <Link to={`/teams/${team.slug}`} style={{
          color: colors.accent, textDecoration: 'none', fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          <span>←</span>
          <TeamLogo teamId={team.id} size={20} rounded="square" />
          {team.name.toUpperCase()}
        </Link>
        {(teammateNav.prev || teammateNav.next) && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: fonts.condensed,
          }}>
            {teammateNav.prev ? (
              <Link
                to={teammateNav.prev.href}
                title={`Previous teammate: ${teammateNav.prev.name} (← key)`}
                style={teammateNavBtnStyle(true)}
              >
                <span aria-hidden="true">‹</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
                  {teammateNav.prev.lastName}
                </span>
              </Link>
            ) : (
              <span style={teammateNavBtnStyle(false)}>
                <span aria-hidden="true">‹</span>
                <span>Start of roster</span>
              </span>
            )}
            <span style={{
              fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
              color: colors.textMuted, letterSpacing: 0.4,
            }}>
              {teammateNav.idx + 1} / {teammateNav.total}
            </span>
            {teammateNav.next ? (
              <Link
                to={teammateNav.next.href}
                title={`Next teammate: ${teammateNav.next.name} (→ key)`}
                style={teammateNavBtnStyle(true)}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
                  {teammateNav.next.lastName}
                </span>
                <span aria-hidden="true">›</span>
              </Link>
            ) : (
              <span style={teammateNavBtnStyle(false)}>
                <span>End of roster</span>
                <span aria-hidden="true">›</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Player Header — ESPN-style 4-column layout.
          Left: profile circle + name + team chip + position
          Middle: vitals (HT/WT, birthdate, bats/throws, birthplace, status)
          Right: season stats card with league ranks
          Tier badge floats at top-right of the name column. */}
      <div ref={heroRef}>
        <PlayerHero
          player={player}
          team={team}
          avatarUrl={avatarUrl}
          profileOffsetX={player.profileOffsetX}
          profileOffsetY={player.profileOffsetY}
          profileZoom={player.profileZoom}
          playerRank={playerRank}
          battingRanks={battingRanks}
          pitchingRanks={pitchingRanks}
          bTotal={bTotal}
          pTotal={pTotal}
          onGenerate={generateIdea}
          generating={generatingIdea}
          canEditPhoto={isAdmin}
          onEditPhoto={openPhotoPicker}
          onAdjustPhoto={() => setPositionEditorOpen(true)}
        />
      </div>

      {/* Sticky mini-hero — fades in once the full hero scrolls out of
          view so the primary "Generate content" CTA stays one click
          away while you're reading down the page. Tucks itself just below
          the topbar (which is sticky at top:0 with z-index 40 in App.jsx),
          so it sits at top:60 with z-index 30 — under modals/banners. */}
      <StickyMiniHero
        active={heroOutOfView}
        player={player}
        team={team}
        avatarUrl={avatarUrl}
        profileOffsetX={player.profileOffsetX}
        profileOffsetY={player.profileOffsetY}
        profileZoom={player.profileZoom}
        onGenerate={generateIdea}
        generating={generatingIdea}
      />

      {/* Admin-only profile-picture picker modal. Shows the full set of
          team media with the current selection highlighted. "Reset" goes
          back to the default headshot heuristic. */}
      {photoPickerOpen && (
        <PhotoPicker
          team={team}
          teamMedia={teamMedia}
          mediaUrls={mediaUrls}
          currentId={player.profileMediaId || headshot?.id || null}
          onClose={() => !savingPhoto && setPhotoPickerOpen(false)}
          onPick={choosePhoto}
          saving={savingPhoto}
        />
      )}

      {/* Pan/zoom positioning modal — opens via the ⌖ button on the
          PlayerHero. Persists profile_offset_x/y + profile_zoom which
          flow through to all avatar consumers via PositionedAvatar. */}
      {positionEditorOpen && avatarUrl && (
        <PositionEditor
          team={team}
          src={avatarUrl}
          initial={{
            offsetX: player.profileOffsetX ?? 0,
            offsetY: player.profileOffsetY ?? 0,
            zoom:    player.profileZoom ?? 1,
          }}
          onClose={() => !savingPosition && setPositionEditorOpen(false)}
          onSave={savePosition}
          saving={savingPosition}
        />
      )}

      {/* Generated-content modal — opens when "✦ Generate content" pops
          a fresh AI idea for this player. Renders the same IdeaCard the
          dashboard uses, so the user can edit captions, queue as a
          request, or hit "Open in Generate" to drop into the canvas
          with the idea's prefill. Backdrop click + ESC close. The
          IdeaCard's onIdeaUpdate path patches the local pendingIdea so
          caption regen / edits stay in sync inside the modal. */}
      {pendingIdea && (
        <GeneratedIdeaModal
          idea={pendingIdea}
          player={player}
          team={team}
          leagueContext={leagueCtx.notes || ''}
          onClose={() => setPendingIdea(null)}
          onIdeaUpdate={(id, patch) => setPendingIdea(prev => prev && prev.id === id ? { ...prev, ...patch } : prev)}
          onOpenInGenerate={(idea) => {
            // Stash full idea (narrative + captions) for the brief
            // context drawer in Generate, then route with prefill
            // params + ideaId tag so a refresh of /generate keeps the
            // drawer populated from sessionStorage.
            stashIdeaForGenerate(idea);
            navigate(buildGenerateLinkFromIdea(idea));
            setPendingIdea(null);
          }}
          onRegenerate={generateIdea}
          regenerating={generatingIdea}
        />
      )}

      {/* Percentile bubble cards — Savant-style horizontal bars showing
          where this player ranks across the league for each stat. The
          bubble carries the percentile, the value sits on the right.
          Direct stats use percentileFor(); rate stats (HR/PA, RBI/PA,
          K:BB) use derivedPercentileFor() with an inline value getter
          so we don't have to materialise them into the leaderboard
          rows. Bars animate in with a 30ms-per-row stagger on mount. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        {player.batting && (
          <Card>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
              <SectionHeading style={{
                margin: 0,
                fontFamily: fonts.heading,
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
              }}>BLW Batting Percentile Rankings</SectionHeading>
              <span style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 0.5 }}>
                Across {bTotal} BLW batters
              </span>
            </div>
            <PercentileList
              ariaLabel={`${player.name} batting percentiles`}
              rows={[
                { label: 'AVG',    value: player.batting.avg,
                  percentile: percentileFor(battingLeaders, player.name, 'avg', 'desc', parseFloat) },
                { label: 'OBP',    value: player.batting.obp,
                  percentile: percentileFor(battingLeaders, player.name, 'obp', 'desc', parseFloat) },
                { label: 'SLG',    value: player.batting.slg,
                  percentile: percentileFor(battingLeaders, player.name, 'slg', 'desc', parseFloat) },
                { label: 'OPS',    value: player.batting.ops,
                  percentile: percentileFor(battingLeaders, player.name, 'ops', 'desc', parseFloat) },
                { label: 'BB%',    value: formatPct(player.batting.bbPct),
                  percentile: percentileFor(battingLeaders, player.name, 'bbPct', 'desc', Number) },
                // K% is "lower is better" for hitters — fewer strikeouts is good.
                { label: 'K%',     value: formatPct(player.batting.kPct),
                  percentile: percentileFor(battingLeaders, player.name, 'kPct', 'asc', Number) },
                { label: 'HR/PA',  value: formatRate(player.batting.hr, player.batting.pa),
                  percentile: derivedPercentileFor(battingLeaders, player.name,
                    (r) => safeRate(r.hr, r.pa), 'desc') },
                { label: 'RBI/PA', value: formatRate(player.batting.rbi, player.batting.pa),
                  percentile: derivedPercentileFor(battingLeaders, player.name,
                    (r) => safeRate(r.rbi, r.pa), 'desc') },
                // R/PA — runs scored per plate appearance. Tracks how often
                // the player crosses the plate when they come up; pairs
                // nicely with RBI/PA above (driving in vs scoring runs).
                { label: 'R/PA',   value: formatRate(player.batting.runs, player.batting.pa),
                  percentile: derivedPercentileFor(battingLeaders, player.name,
                    (r) => safeRate(r.runs, r.pa), 'desc') },
              ]}
            />
          </Card>
        )}
        {player.pitching && (
          <Card>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
              <SectionHeading style={{
                margin: 0,
                fontFamily: fonts.heading,
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
              }}>BLW Pitching Percentile Rankings</SectionHeading>
              <span style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 0.5 }}>
                Across {pTotal} BLW pitchers
              </span>
            </div>
            <PercentileList
              ariaLabel={`${player.name} pitching percentiles`}
              rows={[
                // Lower-is-better stats use 'asc' direction so the percentile
                // points at "good" the same way it does for hitter-friendly
                // metrics — bubble at 95 means "elite," not "worst ERA in BLW".
                { label: 'ERA',  value: player.pitching.era,
                  percentile: percentileFor(pitchingLeaders, player.name, 'era',  'asc', parseFloat) },
                { label: 'WHIP', value: player.pitching.whip,
                  percentile: percentileFor(pitchingLeaders, player.name, 'whip', 'asc', parseFloat) },
                { label: 'IP',   value: player.pitching.ip,
                  percentile: percentileFor(pitchingLeaders, player.name, 'ip',   'desc', parseFloat) },
                { label: 'K',    value: player.pitching.k,
                  percentile: percentileFor(pitchingLeaders, player.name, 'k',    'desc', Number) },
                { label: 'K/4',  value: player.pitching.k4,
                  percentile: percentileFor(pitchingLeaders, player.name, 'k4',   'desc', parseFloat) },
                { label: 'BB',   value: player.pitching.bb,
                  percentile: percentileFor(pitchingLeaders, player.name, 'bb',   'asc', Number) },
                { label: 'BB/4', value: player.pitching.bb4,
                  percentile: percentileFor(pitchingLeaders, player.name, 'bb4',  'asc', parseFloat) },
                { label: 'FIP',  value: typeof player.pitching.fip === 'number' ? player.pitching.fip.toFixed(2) : player.pitching.fip,
                  percentile: percentileFor(pitchingLeaders, player.name, 'fip',  'asc', parseFloat) },
                { label: 'K:BB', value: player.pitching.kbb || formatRatio(player.pitching.k, player.pitching.bb),
                  percentile: derivedPercentileFor(pitchingLeaders, player.name,
                    (r) => safeRatio(r.k, r.bb), 'desc') },
              ]}
            />
          </Card>
        )}
      </div>

      {/* Recent posts featuring this player — pulled from the global
          generate-log so users can see at a glance what content has
          already been made about this player. Helps avoid duplicates.
          Self-hides when no posts match. */}
      {recentPosts.length > 0 && (
        <PlayerRecentPosts posts={recentPosts} team={team} player={player} />
      )}

      {/* Athlete voice — self-authored "About me" block that feeds the
          AI ideas generator.
            • master_admin → always editable + sees the linker
            • athlete → editable only when player.userId equals their
              auth user.id (strict 1:1 binding via manual_players.user_id)
            • everyone else → read-only
          Hides entirely when read-only AND the voice block is empty so
          this card doesn't surface as an empty box for staff. */}
      <AthleteVoiceCard
        player={player}
        team={team}
        isMaster={isMaster}
        canEdit={isMaster || (isAthlete && !!user?.id && player.userId === user.id)}
      />

      {/* Content ideas about this player — only shows when there are
          actually ideas tagged for this player (matched server-side via
          player_last_name extracted from prefill.playerName). The section
          self-hides when empty so it doesn't clutter pages for less
          frequently-spotlighted players. */}
      <ContentIdeasSection
        team={team.id}
        player={player.lastName}
        title={`Content ideas about ${player.firstName || player.name?.split(' ')[0] || ''} ${player.lastName}`.trim()}
      />

      {/* Media Gallery */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionHeading style={{ margin: 0 }}>Media</SectionHeading>
          <span style={{ fontFamily: fonts.body, fontSize: 11, color: colors.textMuted, fontWeight: 500 }}>
            {media.length} {media.length === 1 ? 'asset' : 'assets'}
          </span>
        </div>
        {media.length === 0 && (
          <div style={{
            padding: 28, textAlign: 'center',
            background: colors.bg, borderRadius: radius.base,
            border: `1px dashed ${colors.borderLight}`,
          }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📸</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.text, marginBottom: 4 }}>
              No photos for {player.name.split(' ')[0]} yet
            </div>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 14, maxWidth: 280, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
              Add a HEADSHOT, ACTION shot, or PORTRAIT in Files; tag the file with the player's last name to wire it through.
            </div>
            <Link to="/files" style={{
              display: 'inline-block',
              fontSize: 12, fontFamily: fonts.body, fontWeight: 700,
              color: colors.accent, textDecoration: 'none',
              padding: '6px 14px', borderRadius: radius.base,
              border: `1px solid ${colors.accentBorder}`,
              background: colors.accentSoft,
            }}>Upload in Files →</Link>
          </div>
        )}
        {media.length > 0 && Object.entries(grouped).map(([type, items]) => (
          <div key={type} style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, color: colors.textMuted, letterSpacing: 1, marginBottom: 6 }}>
              {type} ({items.length})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
              {items.map(m => (
                <div key={m.id} style={{
                  borderRadius: radius.base, overflow: 'hidden',
                  border: `1px solid ${colors.borderLight}`,
                }}>
                  <div style={{
                    width: '100%', height: 120,
                    background: mediaUrls[m.id] ? `url(${mediaUrls[m.id]}) center/cover` : `linear-gradient(135deg, ${team.color}22, ${team.color}08)`,
                  }} />
                  <div style={{
                    padding: 6, fontSize: 10, fontFamily: fonts.condensed,
                    color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{m.name}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ─── Generated-idea modal ──────────────────────────────────────────────────
// Wraps the dashboard's IdeaCard in a centered modal so the player-page
// "Generate content" CTA can show one AI-drafted idea without leaving the
// page. Backdrop click + ESC close. A footer row carries Re-roll (calls
// generateIdea() again) and Open in Generate (handled by IdeaCard itself).
function GeneratedIdeaModal({ idea, player, team, leagueContext, onClose, onIdeaUpdate, onOpenInGenerate, onRegenerate, regenerating }) {
  // ESC-to-close. Mirrors the keyboard pattern used by the photo picker
  // and position editor so all PlayerPage modals dismiss the same way.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 250,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        style={{
          background: colors.white, borderRadius: radius.lg,
          maxWidth: 640, width: '100%',
          maxHeight: '88vh', overflowY: 'auto',
          boxShadow: '0 20px 50px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.14)',
          padding: 18,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        {/* Header — small, identifies the surface and lets the user close. */}
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 12, flexWrap: 'wrap',
        }}>
          <div>
            <div style={{
              fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
              letterSpacing: 0.8, color: colors.textMuted, textTransform: 'uppercase',
            }}>Generated content</div>
            <div style={{
              fontFamily: fonts.heading, fontSize: 22, color: colors.text,
              letterSpacing: 0.3, marginTop: 2,
            }}>
              {player.firstName ? `${player.firstName} ` : ''}{player.lastName}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: `1px solid ${colors.borderLight}`,
              color: colors.textSecondary, borderRadius: radius.sm,
              padding: '4px 10px', fontFamily: fonts.condensed,
              fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
              cursor: 'pointer',
            }}
          >Close (Esc)</button>
        </div>

        {/* The actual idea — full IdeaCard so the user can edit captions,
            queue as a request, or open in Generate from here. */}
        <IdeaCard
          idea={idea}
          queuedRequestId={null}
          ideasLoading={false}
          leagueContext={leagueContext}
          onQueue={() => { /* queue from modal — handled outside if needed */ }}
          onOpenInGenerate={onOpenInGenerate}
          onIdeaUpdate={onIdeaUpdate}
          // Intentionally NO onMoreLikeThis here — the modal has a single
          // dedicated Re-roll button below that owns regen.
        />

        {/* Footer — Re-roll for "give me another angle on this player".
            Open in Generate is wired into the IdeaCard above. */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap',
          paddingTop: 4,
          borderTop: `1px solid ${colors.borderLight}`,
        }}>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating}
            title="Generate a different idea about this player"
            style={{
              background: 'transparent', color: colors.textSecondary,
              border: `1px solid ${colors.borderLight}`,
              borderRadius: radius.sm, padding: '6px 12px',
              fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
              letterSpacing: 0.4, cursor: regenerating ? 'wait' : 'pointer',
              marginTop: 8,
            }}
          >{regenerating ? '…ROLLING' : '↻ Re-roll'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Sticky mini-hero ───────────────────────────────────────────────────────
// Compact strip that slides down from below the topbar once the full hero
// scrolls out of view. Carries the avatar + name + team chip + the primary
// Generate CTA so the user never has to scroll back up to start a post.
function StickyMiniHero({ active, player, team, avatarUrl, profileOffsetX, profileOffsetY, profileZoom, onGenerate, generating = false }) {
  const playerFirst = player.firstName || (player.name || '').split(' ')[0] || '';
  const playerLast = player.lastName || '';
  return (
    <div
      aria-hidden={!active}
      style={{
        position: 'fixed',
        top: 60,                       // sits just below the global TopBar
        left: 0, right: 0,
        zIndex: 30,                    // below modals (200+) and banners (50)
        // Slide-down + fade-in. When inactive we still keep the element in
        // the tree so the transition runs both ways smoothly.
        transform: active ? 'translateY(0)' : 'translateY(-100%)',
        opacity: active ? 1 : 0,
        pointerEvents: active ? 'auto' : 'none',
        transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease',
        background: colors.white,
        borderBottom: `2px solid ${team.color}`,
        boxShadow: '0 4px 14px rgba(17, 24, 39, 0.08)',
      }}
    >
      <div style={{
        maxWidth: 1200, margin: '0 auto',
        padding: '8px 24px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ flexShrink: 0, width: 36, height: 36 }}>
          <PositionedAvatar
            src={avatarUrl}
            offsetX={profileOffsetX}
            offsetY={profileOffsetY}
            zoom={profileZoom}
            size={36}
            borderColor={team.color}
            borderWidth={2}
            fallbackBg={`linear-gradient(135deg, ${team.color}, ${team.dark})`}
            fallback={
              <span style={{
                color: '#fff', fontFamily: fonts.heading,
                fontSize: 13, letterSpacing: 0.4,
              }}>{playerLast.slice(0, 2).toUpperCase()}</span>
            }
          />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{
            fontFamily: fonts.heading,
            fontSize: 16, lineHeight: 1,
            color: colors.text, letterSpacing: 0.6,
            textTransform: 'uppercase',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {playerFirst} {playerLast}
          </span>
          <TeamLogo teamId={team.id} size={16} rounded="square" />
          <span style={{
            fontFamily: fonts.body, fontSize: 11, color: colors.textSecondary, fontWeight: 600,
          }}>{team.name}{player.num ? ` · #${player.num}` : ''}</span>
        </div>
        <RedButton
          onClick={onGenerate}
          disabled={generating}
          style={{ padding: '6px 14px', fontSize: 11, flexShrink: 0 }}
        >
          {generating ? '…GENERATING' : '✦ Generate content'}
        </RedButton>
      </div>
    </div>
  );
}

// ─── Recent posts featuring this player ─────────────────────────────────────
// A small horizontal grid of thumbnails pulled from the global generate-log,
// filtered to posts where settings.fields.playerName matches this player.
// Useful for "have we already made a Jaso highlight this week?" — clicking
// a thumbnail re-opens the same composition in Generate.
function PlayerRecentPosts({ posts, team, player }) {
  const timeAgo = (d) => {
    if (!d) return '';
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'Just now';
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const buildRegenerateLink = (post) => {
    const params = new URLSearchParams();
    if (post.templateType) params.set('template', post.templateType);
    if (post.team) params.set('team', post.team);
    if (post.platform) params.set('platform', post.platform);
    if (post.settings?.fields) {
      for (const [k, v] of Object.entries(post.settings.fields)) {
        if (v != null && v !== '') params.set(k, v);
      }
    }
    return `/generate?${params.toString()}`;
  };
  const playerFirst = player.firstName || (player.name || '').split(' ')[0] || '';
  const titleName = `${playerFirst} ${player.lastName}`.trim();

  return (
    <Card style={{ padding: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline',
        justifyContent: 'space-between', gap: 10,
        flexWrap: 'wrap', marginBottom: 10,
      }}>
        <SectionHeading style={{ margin: 0 }}>Recent posts featuring {titleName}</SectionHeading>
        <span style={{
          fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
          letterSpacing: 0.5, color: colors.textMuted,
        }}>{posts.length} POST{posts.length === 1 ? '' : 'S'} · CHECK BEFORE DUPLICATING</span>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 10,
      }}>
        {posts.map(post => (
          <Link
            key={post.id}
            to={buildRegenerateLink(post)}
            title={`${post.templateType || 'post'} · ${post.platform || ''} · ${timeAgo(post.createdAt)} · click to re-open in Generate`}
            style={{ textDecoration: 'none', display: 'block' }}
          >
            <div style={{
              borderRadius: radius.base, overflow: 'hidden',
              border: `1px solid ${colors.borderLight}`,
              background: '#1A1A22',
              aspectRatio: '1 / 1',
              position: 'relative',
            }}>
              {post.thumbnailUrl ? (
                <img
                  src={post.thumbnailUrl}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  background: `linear-gradient(135deg, ${team.color}, ${team.dark})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: fonts.heading, fontSize: 24, color: team.accent || '#fff',
                  letterSpacing: 1,
                }}>{team.id}</div>
              )}
            </div>
            <div style={{ padding: '6px 2px 0' }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: colors.text,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {post.templateType || 'post'}
              </div>
              <div style={{
                fontSize: 10, fontFamily: fonts.condensed,
                color: colors.textMuted, letterSpacing: 0.3,
                display: 'flex', justifyContent: 'space-between',
              }}>
                <span>{post.platform || '—'}</span>
                <span>{timeAgo(post.createdAt)}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </Card>
  );
}

// ─── Athlete voice card ────────────────────────────────────────────────────
// Self-authored "About me" block — feeds the AI ideas generator with
// per-player vibe, references, and content preferences. Stored as a
// flexible JSON object on manual_players.athlete_voice so we can add
// new fields without a schema migration.
//
// Fields:
//   vibe         — short tagline / personality summary
//   references   — pop-culture / sports references the player loves
//   walkupMusic  — at-bat song or vibe
//   funFacts     — anecdotes, "did you know" lines
//   contentPrefs — what they want / don't want on their accounts
//
// Edit gating is decided by the parent (master_admin always; athletes
// when their profile is pinned to this team). When the viewer can't
// edit AND the voice block is empty, we render nothing so this card
// doesn't surface as an empty box for staff.
function AthleteVoiceCard({ player, team, canEdit, isMaster }) {
  const initial = player?.athleteVoice && typeof player.athleteVoice === 'object'
    ? player.athleteVoice
    : {};
  const [voice, setVoice] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  // Local mirror of the player's userId binding so the linker can
  // optimistically update without a re-render of the parent. Synced
  // back from the prop whenever the player slug changes.
  const [linkedUserId, setLinkedUserId] = useState(player?.userId || null);
  const toast = useToast();

  // Hydrate when the player record changes (slug navigation between
  // teammates) so the form reflects the active player's data.
  useEffect(() => {
    setVoice(player?.athleteVoice && typeof player.athleteVoice === 'object' ? player.athleteVoice : {});
    setLinkedUserId(player?.userId || null);
    setEditing(false);
  }, [player?.id]);

  const hasContent = Object.values(voice).some(v => v && String(v).trim().length > 0);
  // Master admin always sees the card (so they can link the athlete
  // account even when no About-me has been written yet). Athletes see
  // it when they're the linked owner OR when the section already has
  // content (their own page; static read-only). Staff sees it only
  // when there's content to read.
  if (!hasContent && !canEdit && !isMaster) return null;

  const setField = (key, value) => setVoice(prev => ({ ...prev, [key]: value }));

  const save = async () => {
    if (!player?.lastName) return;
    setSaving(true);
    try {
      await upsertManualPlayer({
        team: player.team,
        lastName: player.lastName,
        firstInitial: player.firstInitial,
        firstName: player.firstName,
        num: player.num,
        updates: { athleteVoice: voice },
      });
      setSavedAt(Date.now());
      setEditing(false);
      toast.success('About-me saved', { detail: 'AI will use this on the next idea generation' });
    } catch (err) {
      toast.error('Couldn\'t save', { detail: err.message?.slice(0, 80) });
    } finally {
      setSaving(false);
    }
  };

  const FIELDS = [
    { key: 'vibe',         label: 'Vibe',           placeholder: 'A one-liner that captures who you are. e.g. "Loose, loud, swings hard."' },
    { key: 'references',   label: 'References',     placeholder: 'Movies, TV, athletes, music, memes you reference. The AI will weave these in.' },
    { key: 'walkupMusic',  label: 'Walk-up music',  placeholder: 'Song or artist that plays when you step in. Helps the AI capture vibe.' },
    { key: 'funFacts',     label: 'Fun facts',      placeholder: 'Backstory / anecdotes / "did you know" lines. Surfaces in posts.' },
    { key: 'contentPrefs', label: 'Content notes',  placeholder: 'What you DO and DON\'T want on your accounts. e.g. "Lean into stats; skip locker-room shots."' },
  ];

  return (
    <Card>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10,
        flexWrap: 'wrap', marginBottom: 4,
      }}>
        <SectionHeading style={{ margin: 0 }}>About {player.firstName || player.name?.split(' ')[0] || player.lastName}</SectionHeading>
        <span style={{
          fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
          letterSpacing: 0.5, color: colors.textMuted,
        }}>FEEDS THE AI · {canEdit ? 'EDITABLE' : 'READ ONLY'}</span>
      </div>
      <p style={{
        fontSize: 12, color: colors.textSecondary,
        margin: '4px 0 14px', lineHeight: 1.5,
        maxWidth: '60ch',
      }}>
        {canEdit
          ? 'Tell the AI more about you. Vibe, references, fun facts. The more honest, the better the captions and ideas it drafts.'
          : `${player.firstName || player.lastName}'s self-authored notes. Drives the AI's caption + idea drafting for posts about them.`}
      </p>

      {/* Master-admin only — link this player record to a specific
          athlete profile so that one (and only one) athlete can edit
          this About-me. Without this binding, the prior "any athlete
          on the team can edit any teammate" model was too permissive.
          The picker fetches /api/admin-people to render every athlete
          profile + a "(unlinked)" option to clear the binding. */}
      {isMaster && (
        <LinkAthleteAccount
          player={player}
          team={team}
          linkedUserId={linkedUserId}
          onLink={async (newUserId) => {
            const prev = linkedUserId;
            setLinkedUserId(newUserId); // optimistic
            try {
              await upsertManualPlayer({
                team: player.team,
                lastName: player.lastName,
                firstInitial: player.firstInitial,
                firstName: player.firstName,
                num: player.num,
                updates: { userId: newUserId || null },
              });
              toast.success(newUserId ? 'Linked athlete account' : 'Unlinked athlete account');
            } catch (err) {
              setLinkedUserId(prev); // roll back
              toast.error('Couldn\'t update link', { detail: err.message?.slice(0, 80) });
            }
          }}
        />
      )}

      {!editing ? (
        // Read mode — only show fields that have content. Empty fields
        // collapse out so the card reads like a brief, not a form.
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {FIELDS.filter(f => voice[f.key] && String(voice[f.key]).trim()).map(f => (
            <div key={f.key}>
              <div style={{
                fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
                color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
                marginBottom: 3,
              }}>{f.label}</div>
              <div style={{
                fontFamily: fonts.body, fontSize: 13, color: colors.text,
                lineHeight: 1.55, whiteSpace: 'pre-wrap',
              }}>{voice[f.key]}</div>
            </div>
          ))}
          {!hasContent && (
            <div style={{
              fontSize: 12, color: colors.textMuted,
              fontFamily: fonts.condensed, fontStyle: 'italic',
            }}>
              Nothing here yet — click Edit to add a vibe, references, fun facts.
            </div>
          )}
          {canEdit && (
            <div style={{ marginTop: 4 }}>
              <OutlineButton onClick={() => setEditing(true)} style={{ fontSize: 12 }}>
                {hasContent ? '✎ Edit' : '+ Add about-me'}
              </OutlineButton>
              {savedAt && (
                <span style={{
                  marginLeft: 10, fontSize: 11, color: '#15803D',
                  fontFamily: fonts.condensed, fontWeight: 700, letterSpacing: 0.4,
                }}>✓ Saved · AI will use this next time</span>
              )}
            </div>
          )}
        </div>
      ) : (
        // Edit mode — every field rendered as a textarea so the user
        // can pour in as much detail as they want. No required fields:
        // partial completion is fine.
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {FIELDS.map(f => (
            <div key={f.key}>
              <Label>{f.label}</Label>
              <textarea
                value={voice[f.key] || ''}
                onChange={e => setField(f.key, e.target.value)}
                placeholder={f.placeholder}
                style={{
                  width: '100%',
                  marginTop: 4,
                  padding: '10px 12px',
                  background: colors.white,
                  border: `1px solid ${colors.borderLight}`,
                  borderRadius: radius.sm,
                  fontFamily: fonts.body, fontSize: 13,
                  color: colors.text, lineHeight: 1.5,
                  minHeight: f.key === 'vibe' || f.key === 'walkupMusic' ? 50 : 80,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
                maxLength={1000}
              />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <RedButton onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save about-me'}
            </RedButton>
            <OutlineButton onClick={() => { setVoice(initial); setEditing(false); }} disabled={saving}>
              Cancel
            </OutlineButton>
            <span style={{ flex: 1 }} />
            <span style={{
              fontSize: 11, color: colors.textMuted,
              fontFamily: fonts.condensed, letterSpacing: 0.3,
            }}>
              The AI ideas generator will read this on its next run.
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Link athlete account picker (master-admin only) ──────────────────────
// Tiny strip rendered inside the AthleteVoiceCard that lets the master
// admin bind ONE athlete profile to ONE player record. Once bound,
// only that athlete (plus master_admin) can edit the About-me block —
// teammates with athlete role can still SEE it but can't edit it.
//
// Fetches /api/admin-people lazily on mount (master-admin endpoint that
// returns every profile). Filters to athlete-role profiles to keep the
// picker focused on the people who'd actually claim a player. Falls
// back gracefully if the endpoint 401s.
function LinkAthleteAccount({ player, team, linkedUserId, onLink }) {
  const [profiles, setProfiles] = useState(null); // null = loading
  const [error, setError] = useState(null);
  useEffect(() => {
    let cancel = false;
    authedJson('/api/admin-people')
      .then(data => {
        if (cancel) return;
        // Only show athletes — content/admin profiles aren't bound to
        // player records. Sort by team for ergonomic scanning.
        const list = (data.profiles || [])
          .filter(p => p.role === 'athlete')
          .sort((a, b) => {
            const tCmp = (a.team_id || '').localeCompare(b.team_id || '');
            if (tCmp !== 0) return tCmp;
            return (a.email || '').localeCompare(b.email || '');
          });
        setProfiles(list);
      })
      .catch(err => { if (!cancel) setError(err.message); });
    return () => { cancel = true; };
  }, []);

  const linked = profiles?.find(p => p.id === linkedUserId);
  const teamProfiles = (profiles || []).filter(p => !p.team_id || p.team_id === team.id);
  const otherProfiles = (profiles || []).filter(p => p.team_id && p.team_id !== team.id);

  return (
    <div style={{
      marginBottom: 14,
      padding: 10,
      background: colors.bg,
      border: `1px solid ${colors.borderLight}`,
      borderRadius: radius.sm,
      display: 'flex', alignItems: 'center', gap: 10,
      flexWrap: 'wrap',
    }}>
      <div style={{
        fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
        color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
      }}>MASTER ADMIN</div>
      <div style={{
        fontSize: 12, color: colors.textSecondary, fontFamily: fonts.body,
        flex: 1, minWidth: 200,
      }}>
        Link this player record to ONE athlete account so only that person can edit their About-me.
      </div>
      {profiles === null && !error && (
        <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed }}>Loading…</span>
      )}
      {error && (
        <span style={{ fontSize: 11, color: '#991B1B', fontFamily: fonts.condensed }} title={error}>
          Couldn't load profiles
        </span>
      )}
      {profiles !== null && !error && (
        <select
          value={linkedUserId || ''}
          onChange={e => onLink(e.target.value || null)}
          style={{
            fontSize: 12, fontFamily: fonts.body,
            padding: '5px 8px',
            background: colors.white,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.sm,
            color: colors.text,
            minWidth: 220,
            cursor: 'pointer',
          }}
        >
          <option value="">— Not linked —</option>
          {teamProfiles.length > 0 && (
            <optgroup label={`${team.id} athletes`}>
              {teamProfiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.email}{p.display_name ? ` · ${p.display_name}` : ''}
                </option>
              ))}
            </optgroup>
          )}
          {otherProfiles.length > 0 && (
            <optgroup label="Other teams (uncommon)">
              {otherProfiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.team_id || '?'} · {p.email}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      )}
      {linked && (
        <span
          title={`Currently linked: ${linked.email}`}
          style={{
            fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
            letterSpacing: 0.5, color: colors.success,
            background: colors.successBg,
            border: `1px solid ${colors.successBorder}`,
            padding: '3px 8px', borderRadius: radius.sm,
          }}
        >✓ LINKED</span>
      )}
    </div>
  );
}

