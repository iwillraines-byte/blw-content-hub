// v5 dashboard hero. A dark band atop the dashboard with BLW imagery (the same
// shots as the login wall, re-rendered at high res under /public/hero) slowly
// panning/zooming (Ken Burns) and crossfading behind the three live action
// cards, plus a rotating headline that cycles the cross-user stored content
// ideas — each shown with the team / player it's about.
//
// Rotation pool = master-authored custom headlines (app_settings, optional) +
// the dashboard's ideasListBase (AI ideas from the shared content_ideas store,
// falling back to the stat-derived suggestions). All cross-user already.
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { colors, fonts, radius } from './theme';
import { Icon } from './icon';
import { getTeam } from './data';
import { useIsDark } from './theme-mode';
import { readableAccent } from './team-colors';

const HERO_IMAGES = Array.from({ length: 11 }, (_, i) => `/hero/hero-${String(i + 1).padStart(2, '0')}.jpg`);

const HERO_CSS = `
@keyframes blw-hero-kb {
  0%   { transform: scale(1.06) translate3d(0, 0, 0); }
  100% { transform: scale(1.17) translate3d(-2.4%, -1.8%, 0); }
}
.blw-hero-img { animation: blw-hero-kb 26s ease-in-out infinite alternate; }
@media (prefers-reduced-motion: reduce) { .blw-hero-img { animation: none !important; } }
`;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Crossfading slideshow; each frame also slowly pans/zooms (Ken Burns) for
// motion beyond the fade. Long opacity ease keeps the swap smooth.
function MontageBackdrop({ images = HERO_IMAGES, opacity = 0.32 }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion() || images.length < 2) return;
    const t = setInterval(() => setIdx(i => (i + 1) % images.length), 6500);
    return () => clearInterval(t);
  }, [images.length]);
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity, pointerEvents: 'none' }}>
      {images.map((src, i) => (
        <img key={i} src={src} alt="" className="blw-hero-img" style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
          opacity: i === idx ? 1 : 0, transition: 'opacity 2s ease-in-out',
          animationDelay: `${-i * 4}s`, willChange: 'transform, opacity',
        }} />
      ))}
    </div>
  );
}

// Rotates through {text, team?, player?} items, fading/sliding each in and out,
// and naming the team (in its readable accent) + player the idea is about.
function RotatingHeadline({ items = [] }) {
  const isDark = useIsDark();
  const list = items.filter(it => it && it.text).slice(0, 30);
  // Key the effect on content (not length) so an equal-length swap still resyncs.
  const sig = list.map(it => it.text).join('|');
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    setIdx(0); setShown(true);
    if (prefersReducedMotion() || list.length < 2) return;
    let inner;
    const t = setInterval(() => {
      setShown(false);
      inner = setTimeout(() => { setIdx(i => (i + 1) % list.length); setShown(true); }, 460);
    }, 8400); // v5: doubled hold time per user
    return () => { clearInterval(t); clearTimeout(inner); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const cur = list[idx] || { text: 'Turn league moments into on-brand content for every team.' };
  const team = cur.team && cur.team !== 'BLW' ? getTeam(cur.team) : null;
  const accent = team ? readableAccent(team, isDark) : null;
  return (
    <div style={{ minHeight: 66 }}>
      <div style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.46s ease, transform 0.46s ease',
      }}>
        <div style={{ fontFamily: fonts.heading, fontSize: 25, fontWeight: 700, lineHeight: 1.16, color: colors.textOnDark }}>
          {cur.text}
        </div>
        {(team || cur.player) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, fontFamily: fonts.condensed, fontSize: 12.5, fontWeight: 700, letterSpacing: 0.3 }}>
            {team && <span style={{ color: accent }}>{team.name}</span>}
            {cur.player && <span style={{ color: 'rgba(255,255,255,0.72)' }}>{team ? '· ' : ''}{cur.player}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export function HeroBand({ ideas = [], customHeadlines = [], children }) {
  const items = [
    ...customHeadlines.map(h => ({ text: h?.text, team: h?.team, player: h?.player })),
    ...ideas.map(i => ({ text: i?.headline, team: i?.team, player: i?.prefill?.playerName })),
  ];
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      borderRadius: radius.lg, border: `1px solid ${colors.border}`,
      background: colors.navyDeep, padding: '30px 28px', minHeight: 260,
    }}>
      <style dangerouslySetInnerHTML={{ __html: HERO_CSS }} />
      <MontageBackdrop />
      {/* gradient veil so the headline + cards always read over the photos */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `linear-gradient(180deg, ${colors.navyDeep} 0%, transparent 30%, transparent 55%, ${colors.navyDeep} 100%)`,
        opacity: 0.72,
      }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800, letterSpacing: 1,
              color: colors.red, textTransform: 'uppercase', marginBottom: 6,
            }}>
              <Icon name="studio" size={13} /> Idea engine
            </div>
            <RotatingHeadline items={items} />
          </div>
          <Link to="/generate" style={{
            flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: colors.red, color: '#fff', textDecoration: 'none',
            borderRadius: radius.base, padding: '8px 15px',
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
