// Theme-mode picker — three-way segmented control for Light / Dark /
// System. Rendered in Settings alongside the Typography card. Preference
// is per-browser (localStorage-backed) and flips the entire app's
// color palette live with no re-render.

import { useEffect, useState } from 'react';
import { Card, SectionHeading } from '../components';
import { colors, fonts, radius } from '../theme';
import { applyMode, getStoredMode, THEME_MODES } from '../theme-mode';

export default function ThemeModeCard() {
  const [mode, setMode] = useState(() => getStoredMode());

  // Keep the chip highlighted if something else (another tab, a system
  // toggle) changed the mode.
  useEffect(() => {
    const onChange = (e) => setMode(e.detail?.mode || getStoredMode());
    window.addEventListener('blw-theme-mode-changed', onChange);
    return () => window.removeEventListener('blw-theme-mode-changed', onChange);
  }, []);

  const pick = (id) => {
    applyMode(id);
    setMode(id);
  };

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <SectionHeading style={{ marginBottom: 0 }}>Appearance</SectionHeading>
        <span style={{
          fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 1,
          color: colors.textMuted, textTransform: 'uppercase',
        }}>
          saves per-browser
        </span>
      </div>

      <p style={{ fontSize: 12, color: colors.textSecondary, margin: '2px 0 14px', lineHeight: 1.5 }}>
        Choose between Light and Dark. <strong>System</strong> follows your OS setting and switches automatically when your computer does.
      </p>

      {/* Segmented control */}
      <div style={{
        display: 'inline-flex',
        gap: 4,
        padding: 4,
        background: colors.bg,
        border: `1px solid ${colors.borderLight}`,
        borderRadius: radius.full,
      }}>
        {THEME_MODES.map(m => {
          const active = m.id === mode;
          return (
            <button
              key={m.id}
              onClick={() => pick(m.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '7px 14px', borderRadius: radius.full,
                background: active ? colors.white : 'transparent',
                color: active ? colors.text : colors.textSecondary,
                border: `1px solid ${active ? colors.border : 'transparent'}`,
                cursor: 'pointer',
                fontFamily: fonts.body, fontSize: 12, fontWeight: active ? 700 : 500,
                letterSpacing: 0.3,
                boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                transition: 'all 0.12s',
              }}
            >
              <span style={{ fontSize: 13 }}>{m.icon}</span>
              {m.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
