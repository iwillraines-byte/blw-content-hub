import { useState } from 'react';

// ─── Tier badge config + glow animation ────────────────────────────────────
// Each player rank maps to one of 8 tiers. Each tier has:
//   - image: path to the badge PNG in /public/badges/
//   - label: fallback text if the image fails to load
//   - glowColor: RGB triplet for drop-shadow (matches the badge's dominant hue)
//   - glowMin / glowMax: blur radius range for the pulse (bigger = more intense)
//   - glowPeriod: pulse duration (lower = faster = more attention)
//   - fallback: gradient + palette used if the badge image 404s
//
// Glow is implemented via filter: drop-shadow() so it hugs the badge's actual
// shape rather than its rectangular bounding box. Keyframes are injected once
// via <TierBadgeStyles /> rendered at the app root.

const TIERS = [
  {
    id: 'rank-1',
    match: (r) => r === 1,
    image: '/badges/rank-1.png',
    label: '1st Overall',
    glowColor: '245, 195, 0',          // gold
    glowMin: 16, glowMax: 30, glowPeriod: '2s',
    fallback: { bg: 'linear-gradient(135deg, #F5C300, #D69A00)', fg: '#2A1A00', border: '#F5C300', labelTop: '#1', labelBottom: 'ELITE' },
  },
  {
    id: 'rank-2',
    match: (r) => r === 2,
    image: '/badges/rank-2.png',
    label: '2nd Overall',
    glowColor: '170, 210, 255',        // icy blue
    glowMin: 14, glowMax: 26, glowPeriod: '2.3s',
    fallback: { bg: 'linear-gradient(135deg, #CBD5E1, #94A3B8)', fg: '#1F2937', border: '#CBD5E1', labelTop: '#2', labelBottom: 'ELITE' },
  },
  {
    id: 'rank-3',
    match: (r) => r === 3,
    image: '/badges/rank-3.png',
    label: '3rd Overall',
    glowColor: '210, 140, 70',         // bronze/copper
    glowMin: 12, glowMax: 22, glowPeriod: '2.6s',
    fallback: { bg: 'linear-gradient(135deg, #D97706, #92400E)', fg: '#FFF7ED', border: '#D97706', labelTop: '#3', labelBottom: 'ELITE' },
  },
  {
    id: 'top-10',
    match: (r) => r >= 4 && r <= 10,
    image: '/badges/tier-top10.png',
    label: 'Top 10',
    glowColor: '120, 170, 245',        // cyan-blue
    glowMin: 10, glowMax: 18, glowPeriod: '3s',
    fallback: { bg: 'linear-gradient(135deg, #3B82F6, #1E40AF)', fg: '#EFF6FF', border: '#3B82F6', labelTop: 'TOP 10', labelBottom: '' },
  },
  {
    id: 'top-25',
    match: (r) => r >= 11 && r <= 25,
    image: '/badges/tier-top25.png',
    label: 'Top 25',
    glowColor: '200, 220, 240',        // silver-blue
    glowMin: 7, glowMax: 13, glowPeriod: '3.5s',
    fallback: { bg: 'linear-gradient(135deg, #94A3B8, #475569)', fg: '#F8FAFC', border: '#94A3B8', labelTop: 'TOP 25', labelBottom: '' },
  },
  {
    id: 'top-50',
    match: (r) => r >= 26 && r <= 50,
    image: '/badges/tier-top50.png',
    label: 'Top 50',
    glowColor: '235, 185, 50',         // gold (softer than #1)
    glowMin: 5, glowMax: 10, glowPeriod: '4s',
    fallback: { bg: 'linear-gradient(135deg, #EAB308, #A16207)', fg: '#FFFBEB', border: '#EAB308', labelTop: 'TOP 50', labelBottom: '' },
  },
  {
    id: 'top-100',
    match: (r) => r >= 51 && r <= 100,
    image: '/badges/tier-top100.png',
    label: 'Top 100',
    glowColor: '210, 220, 230',        // silver
    glowMin: 3, glowMax: 6, glowPeriod: '4.5s',
    fallback: { bg: 'linear-gradient(135deg, #E5E7EB, #9CA3AF)', fg: '#1F2937', border: '#D1D5DB', labelTop: 'TOP 100', labelBottom: '' },
  },
  {
    id: 'pro',
    match: (r) => r > 100,
    image: '/badges/tier-ranked.png',
    label: 'Pro Player',
    glowColor: '180, 110, 60',         // bronze (static, no pulse for this tier)
    glowMin: 0, glowMax: 0, glowPeriod: '0s',
    fallback: { bg: 'linear-gradient(135deg, #B45309, #78350F)', fg: '#FFF7ED', border: '#B45309', labelTop: 'PRO', labelBottom: 'PLAYER' },
  },
];

export function tierFor(rank) {
  if (!rank || rank <= 0) return null;
  return TIERS.find(t => t.match(rank)) || null;
}

// Render this once at the app root so all TierBadges share the keyframes.
// Each tier gets its own @keyframes block because blur radii + colors differ.
export function TierBadgeStyles() {
  const css = TIERS.map(t => {
    // Static tier: no pulse, just a constant shadow
    if (t.glowMax === 0) {
      return `.tier-glow-${t.id} { filter: drop-shadow(0 2px 4px rgba(0,0,0,0.15)); }`;
    }
    return `
      @keyframes tier-pulse-${t.id} {
        0%, 100% {
          filter:
            drop-shadow(0 0 ${t.glowMin}px rgba(${t.glowColor}, 0.55))
            drop-shadow(0 2px 4px rgba(0,0,0,0.2));
        }
        50% {
          filter:
            drop-shadow(0 0 ${t.glowMax}px rgba(${t.glowColor}, 0.95))
            drop-shadow(0 0 ${Math.round(t.glowMin * 0.6)}px rgba(${t.glowColor}, 0.7));
        }
      }
      .tier-glow-${t.id} {
        animation: tier-pulse-${t.id} ${t.glowPeriod} ease-in-out infinite;
        will-change: filter;
      }
    `.trim();
  }).join('\n');

  // Respect reduced-motion: freeze the pulse at a middle intensity
  const reducedMotionCss = `
    @media (prefers-reduced-motion: reduce) {
      ${TIERS.filter(t => t.glowMax > 0).map(t => `
        .tier-glow-${t.id} {
          animation: none;
          filter:
            drop-shadow(0 0 ${Math.round((t.glowMin + t.glowMax) / 2)}px rgba(${t.glowColor}, 0.75))
            drop-shadow(0 2px 4px rgba(0,0,0,0.2));
        }
      `).join('')}
    }
  `;

  return <style dangerouslySetInnerHTML={{ __html: css + '\n' + reducedMotionCss }} />;
}

// ─── TierBadge ──────────────────────────────────────────────────────────────
// Renders the badge image with the animated glow. Falls back to a gradient
// placeholder if the image 404s (bad filename / file not dropped yet).
export function TierBadge({ rank, size = 96 }) {
  const tier = tierFor(rank);
  const [errored, setErrored] = useState(false);
  if (!tier) return null;

  if (errored) {
    // Visible fallback so you know the image is missing — easier to debug
    return (
      <div
        className={`tier-glow-${tier.id}`}
        style={{
          display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          width: size, height: size, padding: 10,
          background: tier.fallback.bg,
          color: tier.fallback.fg,
          border: `2px solid ${tier.fallback.border}`,
          borderRadius: 12,
          fontFamily: "'Bebas Neue', sans-serif", letterSpacing: 1,
          textAlign: 'center',
        }}
        role="img"
        aria-label={`${tier.label} · Rank ${rank}`}
        title={`${tier.label} · BLW Rank #${rank} · (badge image missing — check /public/badges/)`}
      >
        <div style={{ fontSize: 20, lineHeight: 1 }}>{tier.fallback.labelTop || tier.label}</div>
        {tier.fallback.labelBottom && (
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginTop: 4, opacity: 0.85 }}>
            {tier.fallback.labelBottom}
          </div>
        )}
      </div>
    );
  }

  return (
    <img
      src={tier.image}
      alt={`${tier.label} · Rank ${rank}`}
      title={`${tier.label} · BLW Rank #${rank}`}
      className={`tier-glow-${tier.id}`}
      onError={() => setErrored(true)}
      style={{
        width: size, height: size,
        objectFit: 'contain',
        // The drop-shadow is provided by the .tier-glow-<id> class; don't
        // stack a box-shadow here or it'll wrap the transparent PNG's bounding box.
      }}
    />
  );
}
