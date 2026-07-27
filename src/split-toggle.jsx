// Regular season / Postseason / Total segmented control.
//
// One control, used on every surface that reports 2026 stats (player hero
// tiles, schedule standings, team stats) so the split always looks and behaves
// the same. Visual pattern matches the existing Radar/OPWR-Trend segmented
// control in PlayerPage — muted track, white raised thumb on the active item.
//
// `available` optionally marks splits that have no data yet (e.g. postseason
// before a team has played one). Those stay visible but disabled, so the UI
// never silently drops an option the user is looking for.

import { colors, fonts, radius, shadows } from './theme';
import { SPLITS } from './splits';

export default function SplitToggle({
  value,
  onChange,
  available = null,
  size = 'base',
  ariaLabel = 'Stat split',
  style = {},
}) {
  const small = size === 'sm';
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex', gap: 0,
        background: colors.muted,
        border: `1px solid ${colors.borderLight}`,
        borderRadius: radius.base,
        padding: 3,
        ...style,
      }}
    >
      {SPLITS.map(s => {
        const active = value === s.id;
        const enabled = !available || available[s.id] !== false;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => enabled && onChange(s.id)}
            aria-pressed={active}
            disabled={!enabled}
            title={enabled ? s.label : `No ${s.label.toLowerCase()} games yet`}
            style={{
              border: 'none',
              cursor: enabled ? 'pointer' : 'default',
              background: active ? colors.white : 'transparent',
              color: active ? colors.text : (enabled ? colors.textMuted : colors.borderLight),
              boxShadow: active ? shadows.sm : 'none',
              fontFamily: fonts.condensed,
              fontSize: small ? 10 : 11,
              fontWeight: 700,
              letterSpacing: 0.3,
              padding: small ? '4px 9px' : '5px 12px',
              borderRadius: radius.sm,
              whiteSpace: 'nowrap',
              transition: 'background 140ms ease, color 140ms ease',
            }}
          >
            {small ? s.short : s.label}
          </button>
        );
      })}
    </div>
  );
}
