// Typography picker — lets the user flip the app's full font theme
// (heading + body + condensed together) from Settings without a page
// reload. Shown in Settings for everyone; preference is per-browser
// (localStorage-backed).
//
// Each tile previews the theme's three faces in context:
//   • Heading face rendered as a large "JOSH JUNG" sample
//   • Body face underneath (a "Outlook Modern" descriptor line)
//   • Condensed face in a small META chip
// The currently-active theme gets a red outline + "IN USE" pill.

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

  // Pre-load every theme's Google Fonts on first render so every preview
  // tile shows in its real face without waiting for a click. Dedup by
  // family string — many themes share the same body/condensed face.
  useEffect(() => {
    const families = new Set();
    for (const f of FONT_OPTIONS) {
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
        Each theme swaps the entire font system: headings, body text, and condensed labels all at once. Click a tile to apply live.
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 12,
      }}>
        {FONT_OPTIONS.map(f => {
          const active = f.id === activeId;
          return (
            <button
              key={f.id}
              onClick={() => choose(f.id)}
              style={{
                display: 'flex', flexDirection: 'column', gap: 6,
                padding: 16, borderRadius: radius.base,
                border: `1px solid ${active ? colors.red : colors.borderLight}`,
                background: active ? colors.redLight : colors.white,
                cursor: 'pointer', textAlign: 'left',
                boxShadow: active ? `0 0 0 2px ${colors.redBorder}` : 'none',
                transition: 'all 0.12s',
              }}
            >
              {/* Heading face — big display sample */}
              <div style={{
                fontFamily: f.heading.stack,
                fontSize: 30,
                letterSpacing: `${f.heading.tracking ?? 1}px`,
                color: colors.text,
                lineHeight: 0.95,
                textTransform: 'uppercase',
              }}>
                JOSH JUNG
              </div>

              {/* Body face — descriptor + theme name */}
              <div style={{
                fontFamily: f.body.stack,
                fontSize: 13,
                color: colors.text,
                lineHeight: 1.4,
                marginTop: 2,
              }}>
                <span style={{ fontWeight: 700 }}>{f.name}</span>
                <span style={{ color: colors.textSecondary, marginLeft: 6 }}>
                  {f.description}
                </span>
              </div>

              {/* Condensed face — meta chip row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span style={{
                  fontFamily: f.condensed.stack,
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
                  color: colors.textMuted, textTransform: 'uppercase',
                  padding: '3px 8px', borderRadius: radius.full,
                  background: colors.bg, border: `1px solid ${colors.borderLight}`,
                }}>
                  Record · 12-4 · +28 Diff
                </span>
                {active && (
                  <span style={{
                    fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
                    letterSpacing: 0.5, textTransform: 'uppercase',
                    background: colors.red, color: '#fff',
                    padding: '2px 8px', borderRadius: radius.full,
                  }}>In use</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
