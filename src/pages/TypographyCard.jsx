// Typography picker — v4.5.16: simplified to four named buttons.
//
// Per the master's request, the previous elaborate preview-tile gallery
// was overkill — every theme had a JOSH JUNG sample, a body sample, a
// condensed-face sample, and an explanatory description. Reduced to
// four big plain-text buttons:
//   BLW Classic · BLW MVP · Punch · Data Pro
//
// The active button gets the brand-red outline + "IN USE" pill. Click
// to apply live. Preference is per-browser (localStorage-backed).

import { useEffect, useState } from 'react';
import { Card, SectionHeading } from '../components';
import { colors, fonts, radius } from '../theme';
import { FONT_OPTIONS, applyFont, getStoredFontId } from '../fonts';
import { useToast } from '../toast';

// The four IDs the user wants surfaced. Order is intentional —
// Classic anchors, then the new MVP default, then Punch (display
// face for hype graphics), then Data Pro (editorial / analytics).
const FOUR_FONTS = ['blw-classic', 'mvp', 'punch', 'data-pro'];

export default function TypographyCard() {
  const toast = useToast();
  const [activeId, setActiveId] = useState(() => getStoredFontId());

  useEffect(() => {
    const onChange = (e) => setActiveId(e.detail?.id || getStoredFontId());
    window.addEventListener('blw-font-changed', onChange);
    return () => window.removeEventListener('blw-font-changed', onChange);
  }, []);

  // Pre-load Google Fonts only for the four surfaced themes — no point
  // pulling the rest into the head when they're not selectable.
  useEffect(() => {
    const families = new Set();
    for (const id of FOUR_FONTS) {
      const f = FONT_OPTIONS.find(x => x.id === id);
      if (!f) continue;
      if (f.heading?.googleFamily)   families.add(f.heading.googleFamily);
      if (f.body?.googleFamily)      families.add(f.body.googleFamily);
      if (f.condensed?.googleFamily) families.add(f.condensed.googleFamily);
    }
    families.forEach(family => {
      if (document.querySelector(`link[data-blw-font="${family}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
      link.setAttribute('data-blw-font', family);
      document.head.appendChild(link);
    });
  }, []);

  const choose = (id) => {
    applyFont(id);
    setActiveId(id);
    const f = FONT_OPTIONS.find(x => x.id === id);
    toast.success(`Font theme: ${f?.name || id}`, { duration: 2500 });
  };

  const visibleFonts = FOUR_FONTS
    .map(id => FONT_OPTIONS.find(x => x.id === id))
    .filter(Boolean);

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <SectionHeading style={{ marginBottom: 0 }}>Typography</SectionHeading>
        <span style={{
          fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 1,
          color: colors.textMuted, textTransform: 'uppercase',
        }}>
          saves per-browser
        </span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 8,
        marginTop: 12,
      }}>
        {visibleFonts.map(f => {
          const active = f.id === activeId;
          return (
            <button
              key={f.id}
              onClick={() => choose(f.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '14px 16px', borderRadius: radius.base,
                border: `1px solid ${active ? colors.accent : colors.border}`,
                background: active ? colors.accentSoft : colors.white,
                cursor: 'pointer', textAlign: 'center',
                fontFamily: f.heading.stack,
                fontSize: 14, fontWeight: 700,
                letterSpacing: 0.5,
                color: active ? colors.accent : colors.text,
                transition: 'all 0.12s',
                boxShadow: active ? `0 0 0 2px ${colors.accentBorder}` : 'none',
              }}
            >
              <span style={{ textTransform: 'uppercase' }}>{f.name}</span>
              {active && (
                <span style={{
                  fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
                  letterSpacing: 0.5, textTransform: 'uppercase',
                  background: colors.accent, color: '#fff',
                  padding: '2px 6px', borderRadius: radius.full,
                  marginLeft: 4,
                }}>In use</span>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
