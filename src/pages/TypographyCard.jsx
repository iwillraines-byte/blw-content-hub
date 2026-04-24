// Typography picker — lets the user flip the app's display heading font
// live. Shown inside the Settings page; preference is per-browser
// (localStorage-backed).
//
// Preview: each option renders a sample heading in its own font so the
// user can eyeball how "JOSH JUNG" or "LOS ANGELES NATURALS" would feel.
// The currently-active option is highlighted and keeps its chip red.

import { useEffect, useState } from 'react';
import { Card, SectionHeading } from '../components';
import { colors, fonts, radius } from '../theme';
import { FONT_OPTIONS, applyFont, getStoredFontId } from '../fonts';
import { useToast } from '../toast';

export default function TypographyCard() {
  const toast = useToast();
  const [activeId, setActiveId] = useState(() => getStoredFontId());

  // Listen for external font changes (e.g. another tab); keeps the chosen
  // card highlighted even when the change came from somewhere else.
  useEffect(() => {
    const onChange = (e) => setActiveId(e.detail?.id || getStoredFontId());
    window.addEventListener('blw-font-changed', onChange);
    return () => window.removeEventListener('blw-font-changed', onChange);
  }, []);

  // Pre-load the font link on preview-card mount so users see each sample
  // in its real face without having to click. We do this by simulating
  // applyFont() for each option but only for preview purposes — the
  // persisted/active font doesn't change.
  useEffect(() => {
    for (const f of FONT_OPTIONS) {
      const href = `https://fonts.googleapis.com/css2?family=${f.googleFamily}&display=swap`;
      if (!document.querySelector(`link[data-blw-font="${f.googleFamily}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.setAttribute('data-blw-font', f.googleFamily);
        document.head.appendChild(link);
      }
    }
  }, []);

  const choose = (id) => {
    applyFont(id);
    setActiveId(id);
    const f = FONT_OPTIONS.find(x => x.id === id);
    toast.success(`Display font: ${f?.name || id}`, { duration: 2500 });
  };

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

      <p style={{ fontSize: 12, color: colors.textSecondary, margin: '2px 0 16px', lineHeight: 1.5 }}>
        Controls the display font used for page titles, team names, and player names across the app.
        Body text stays on Barlow.
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 10,
      }}>
        {FONT_OPTIONS.map(f => {
          const active = f.id === activeId;
          return (
            <button
              key={f.id}
              onClick={() => choose(f.id)}
              style={{
                display: 'flex', flexDirection: 'column', gap: 4,
                padding: 14, borderRadius: radius.base,
                border: `1px solid ${active ? colors.red : colors.borderLight}`,
                background: active ? colors.redLight : colors.white,
                cursor: 'pointer', textAlign: 'left',
                boxShadow: active ? `0 0 0 2px ${colors.redBorder}` : 'none',
                transition: 'all 0.12s',
              }}
            >
              {/* Live preview in the candidate face */}
              <div style={{
                fontFamily: f.stack,
                fontSize: 28,
                letterSpacing: `${f.tracking}px`,
                color: colors.text,
                lineHeight: 1,
                marginBottom: 2,
                textTransform: 'uppercase',
              }}>
                JOSH JUNG
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  fontFamily: fonts.body, fontSize: 12, fontWeight: 700, color: colors.text,
                }}>{f.name}</span>
                {active && (
                  <span style={{
                    fontFamily: fonts.condensed, fontSize: 9, fontWeight: 700,
                    letterSpacing: 0.5, textTransform: 'uppercase',
                    background: colors.red, color: '#fff',
                    padding: '1px 6px', borderRadius: radius.full,
                  }}>In use</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: colors.textSecondary, lineHeight: 1.4 }}>
                {f.description}
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
