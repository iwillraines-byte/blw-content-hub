// v5 dashboard hero. A dark band atop the dashboard with the same BLW imagery
// from the login wall crossfading (faded) in the background, the three live
// action cards on top, and a rotating headline that cycles the cross-user
// stored content ideas — so the "idea engine" always feels alive.
//
// The ideas are the dashboard's own ideasListBase (AI ideas from the shared
// /api/content-ideas store, falling back to the deterministic stat-derived
// suggestions) — already cross-user, so no new storage is needed.
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { colors, fonts, radius } from './theme';
import { Icon } from './icon';

// A varied subset of the bundled login montage (graphics + action photos).
const HERO_IMAGES = [1, 5, 9, 13, 18, 25, 28, 31, 34].map(
  n => `/login/montage-${String(n).padStart(2, '0')}.jpg`,
);

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Crossfading slideshow — all tiles stacked, the active one at full opacity,
// a long ease on opacity makes the swap "really smooth". Paused for users who
// ask for reduced motion (shows a single static frame).
function MontageBackdrop({ images = HERO_IMAGES, opacity = 0.26 }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion() || images.length < 2) return;
    const t = setInterval(() => setIdx(i => (i + 1) % images.length), 5200);
    return () => clearInterval(t);
  }, [images.length]);
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity, pointerEvents: 'none' }}>
      {images.map((src, i) => (
        <img key={i} src={src} alt="" style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
          opacity: i === idx ? 1 : 0, transition: 'opacity 1.8s ease-in-out',
        }} />
      ))}
    </div>
  );
}

// Rotates idea headlines, each fading/sliding in and out.
function RotatingHeadline({ ideas = [] }) {
  const headlines = ideas.map(i => i?.headline).filter(Boolean).slice(0, 24);
  // Key the effect on the headline CONTENT (not just length) so a same-length
  // swap (deterministic suggestions → AI ideas) still resyncs the rotation.
  const sig = headlines.join('|');
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    setIdx(0);
    setShown(true);
    if (prefersReducedMotion() || headlines.length < 2) return;
    let inner;
    const t = setInterval(() => {
      setShown(false);
      inner = setTimeout(() => { setIdx(i => (i + 1) % headlines.length); setShown(true); }, 420);
    }, 4200);
    // Clear BOTH timers so a pending fade-swap can't fire after unmount or a swap.
    return () => { clearInterval(t); clearTimeout(inner); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const current = headlines[idx] || 'Turn league moments into on-brand content for every team.';
  return (
    <div style={{ minHeight: 48, display: 'flex', alignItems: 'center' }}>
      <span style={{
        fontFamily: fonts.heading, fontSize: 21, fontWeight: 700, lineHeight: 1.18,
        color: colors.textOnDark,
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : 'translateY(7px)',
        transition: 'opacity 0.42s ease, transform 0.42s ease',
      }}>{current}</span>
    </div>
  );
}

export function HeroBand({ ideas = [], children }) {
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      borderRadius: radius.lg, border: `1px solid ${colors.border}`,
      background: colors.navyDeep, padding: 18,
    }}>
      <MontageBackdrop />
      {/* gradient veil so the cards + headline always read over the photos */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `linear-gradient(180deg, ${colors.navyDeep} 0%, transparent 22%, transparent 60%, ${colors.navyDeep} 100%)`,
        opacity: 0.7,
      }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800, letterSpacing: 1,
              color: colors.red, textTransform: 'uppercase', marginBottom: 4,
            }}>
              <Icon name="studio" size={13} /> Idea engine
            </div>
            <RotatingHeadline ideas={ideas} />
          </div>
          <Link to="/generate" style={{
            flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: colors.red, color: '#fff', textDecoration: 'none',
            borderRadius: radius.base, padding: '7px 14px',
            fontFamily: fonts.condensed, fontSize: 12, fontWeight: 800, letterSpacing: 0.6,
          }}>
            Open Studio <Icon name="arrow-right" size={14} />
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
