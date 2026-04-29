import { useState } from 'react';
import { TEAMS, getTeam } from './data';
import { colors, fonts, radius, shadows } from './theme';

// ─── Layout Components ─────────────────────────────────────────────────────

// Card — base container. When `onClick` is set, the card opts into the
// hover affordance (lift + tinted border + deeper shadow) defined in
// global-styles.jsx via the `.card-clickable` class. Static cards stay
// flat.
export const Card = ({ children, style, onClick, className, ...p }) => (
  <div
    onClick={onClick}
    className={[onClick ? 'card-clickable' : '', className].filter(Boolean).join(' ')}
    style={{
      background: colors.white,
      border: `1px solid ${colors.borderLight}`,
      borderRadius: radius.lg,
      padding: 22,
      boxShadow: '0 1px 3px rgba(17, 24, 39, 0.04), 0 1px 2px rgba(17, 24, 39, 0.03)',
      cursor: onClick ? 'pointer' : 'default',
      ...style
    }}
    {...p}
  >{children}</div>
);

export const PageHeader = ({ title, subtitle, children }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
    <div>
      <h1 style={{
        fontFamily: fonts.heading,
        fontSize: 36,
        fontWeight: 400,
        color: colors.text,
        margin: 0,
        letterSpacing: 1.5,
        lineHeight: 1
      }}>{title}</h1>
      {subtitle && (
        <p style={{
          fontFamily: fonts.body,
          fontSize: 14,
          color: colors.textSecondary,
          margin: '6px 0 0',
          fontWeight: 500
        }}>{subtitle}</p>
      )}
    </div>
    {children && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{children}</div>}
  </div>
);

// SectionHeading — sentence-case semibold sans-serif. Display font / ALL CAPS
// is reserved for page H1s (PageHeader) only.
export const SectionHeading = ({ children, style }) => (
  <h2 style={{
    fontFamily: fonts.body,
    fontSize: 17,
    fontWeight: 600,
    color: colors.text,
    margin: '0 0 12px',
    letterSpacing: 0,
    ...style
  }}>{children}</h2>
);

// Label — form-field label. Semibold secondary text, sentence-case.
export const Label = ({ children, style }) => (
  <div style={{
    fontFamily: fonts.body,
    fontSize: 12,
    fontWeight: 600,
    color: colors.textSecondary,
    marginBottom: 8,
    letterSpacing: 0,
    ...style
  }}>{children}</div>
);

// Skeleton — loading-state placeholder. Renders a softly-shimmering block
// at the dimensions you give it. Use one Skeleton per "thing" the user
// will eventually see; size each one to roughly match the final content
// so the layout doesn't shift on hydration.
//
// Examples:
//   <Skeleton width="100%" height={48} />        // a row
//   <Skeleton width={200} height={20} />         // a label
//   <Skeleton width="100%" height={120} radius={12} />  // a card
//
// The shimmer animation lives in src/global-styles.jsx (.skeleton class).
// Honors prefers-reduced-motion.
export const Skeleton = ({ width = '100%', height = 16, radius: r = 6, style }) => (
  <span
    className="skeleton"
    aria-hidden="true"
    style={{
      width: typeof width === 'number' ? `${width}px` : width,
      height: typeof height === 'number' ? `${height}px` : height,
      borderRadius: r,
      ...style,
    }}
  />
);

// SkeletonText — multi-line text-shaped skeleton. Convenience for the
// common "loading some prose" case. Each line gets a slight width
// variation so it doesn't read as a perfect grid.
export const SkeletonText = ({ lines = 3, height = 12, gap = 8, style }) => {
  const widths = ['100%', '92%', '85%', '78%', '95%']; // varied so it doesn't look like a barcode
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap, ...style }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={widths[i % widths.length]} height={height} />
      ))}
    </div>
  );
};

// CollapsibleCard — Card variant with an expand/collapse chevron and an
// optional summary line that surfaces when collapsed. Used on Generate
// to keep the left-column form from growing into a 7-card scroll.
//
// Props:
//   title      — Label-style heading at the top of the card
//   summary    — short string or node shown next to the title when
//                collapsed (e.g. "Konnor Jaso · LAN"). Hidden when open.
//   defaultOpen — initial state (default: true)
//   storageKey — optional localStorage key so the user's expand/collapse
//                preference persists across sessions. Without one the
//                state is purely in-memory.
//
// The collapsed body is removed from the DOM (display:none) rather than
// unmounted — this preserves any uncontrolled child state (typing, focus)
// when the user expands it again. State managed by the consumer is
// untouched either way.
export const CollapsibleCard = ({
  title, summary, defaultOpen = true, storageKey,
  children, style,
}) => {
  const [open, setOpen] = useState(() => {
    if (!storageKey) return defaultOpen;
    try {
      const v = localStorage.getItem(storageKey);
      if (v === '1') return true;
      if (v === '0') return false;
    } catch {}
    return defaultOpen;
  });
  const toggle = () => {
    setOpen(prev => {
      const next = !prev;
      if (storageKey) {
        try { localStorage.setItem(storageKey, next ? '1' : '0'); } catch {}
      }
      return next;
    });
  };
  return (
    <div style={{
      background: colors.white,
      border: `1px solid ${colors.borderLight}`,
      borderRadius: radius.lg,
      boxShadow: '0 1px 3px rgba(17, 24, 39, 0.04), 0 1px 2px rgba(17, 24, 39, 0.03)',
      overflow: 'hidden',
      ...style,
    }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', padding: open ? '14px 18px 4px' : '14px 18px',
          background: 'transparent', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{
          // Chevron rotates from collapsed-pointing-right to open-pointing-down.
          // Pulled out as a separate span so the rotation transform doesn't
          // affect text rendering of the title.
          fontSize: 10, color: colors.textMuted,
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
          width: 12, textAlign: 'center', flexShrink: 0,
        }}>▶</span>
        <div style={{
          fontFamily: fonts.body, fontSize: 12, fontWeight: 600,
          color: colors.textSecondary, letterSpacing: 0,
          flexShrink: 0,
        }}>{title}</div>
        {!open && summary && (
          <div style={{
            flex: 1, minWidth: 0,
            fontSize: 12, color: colors.text, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginLeft: 4,
          }}>
            {summary}
          </div>
        )}
      </button>
      <div style={{ padding: open ? '0 18px 18px' : 0, display: open ? 'block' : 'none' }}>
        {children}
      </div>
    </div>
  );
};

// ─── Data Display ───────────────────────────────────────────────────────────

// TeamLogo — renders a team's logo image with graceful fallback to a colored ID chip
// if the file is missing (or hasn't been dropped into /public/team-logos yet).
// Props:
//   teamId: team code (e.g. "LAN") or slug (e.g. "la-naturals")
//   size: pixel size of the square container (default 40)
//   rounded: "square" | "rounded" | "circle" (default "rounded")
//   background: optional background behind the logo (useful on dark team cards)
export const TeamLogo = ({ teamId, size = 40, rounded = 'rounded', background, style }) => {
  const t = getTeam(teamId);
  const [errored, setErrored] = useState(false);
  if (!t) return null;

  const br = rounded === 'circle' ? radius.full : rounded === 'square' ? 0 : radius.base;
  const baseStyle = {
    width: size,
    height: size,
    borderRadius: br,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
    background: background || 'transparent',
    ...style,
  };

  if (!t.logo || errored) {
    // Fallback: colored ID chip
    return (
      <div style={{
        ...baseStyle,
        background: t.color,
        color: t.accent,
        fontFamily: fonts.heading,
        fontSize: Math.max(10, Math.round(size * 0.38)),
        letterSpacing: 1,
      }}>{t.id}</div>
    );
  }

  return (
    <div style={baseStyle}>
      <img
        src={t.logo}
        alt={`${t.name} logo`}
        onError={() => setErrored(true)}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </div>
  );
};

// TeamChip — colored pill showing a team's ID abbreviation.
// Pass `withLogo` to prepend a tiny logo image (falls back gracefully if logo missing).
// FA chip — shown when a player has no team affiliation OR isn't on the
// canonical 70 active roster. Gray pill, conveys "free agent / not on
// a current BLW roster" without spreading misinformation about a team.
export const FreeAgentChip = ({ small }) => (
  <span title="Not currently on a BLW team roster" style={{
    display: 'inline-flex', alignItems: 'center',
    background: '#E5E7EB', color: '#374151',
    padding: small ? '2px 7px' : '3px 10px',
    borderRadius: radius.sm,
    fontSize: small ? 9 : 11,
    fontFamily: fonts.condensed,
    fontWeight: 700,
    letterSpacing: 0.6,
    border: '1px solid #D1D5DB',
  }}>FA</span>
);

export const TeamChip = ({ teamId, small, withLogo }) => {
  // Render the FA chip when there's no team OR no matching team in our
  // TEAMS list (e.g. cross-league residue from the API).
  if (!teamId) return <FreeAgentChip small={small} />;
  const t = getTeam(teamId);
  if (!t) return <FreeAgentChip small={small} />;
  const logoSize = small ? 11 : 14;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: withLogo ? (small ? 4 : 5) : 0,
      background: t.color,
      color: t.accent,
      padding: small ? '2px 7px' : '3px 10px',
      borderRadius: radius.sm,
      fontSize: small ? 9 : 11,
      fontFamily: fonts.condensed,
      fontWeight: 700,
      letterSpacing: 0.6
    }}>
      {withLogo && t.logo && (
        <TeamLogo teamId={t.id} size={logoSize} rounded="square" background="rgba(255,255,255,0.15)" />
      )}
      {t.id}
    </span>
  );
};

export const StatusBadge = ({ status }) => {
  // Token-driven palette — bg/text colors come from the theme so dark-
  // mode flips and any future palette tweaks reach every status badge
  // automatically. Previously hardcoded hex; see theme.js {name}Bg /
  // {name}Text tokens for the source of truth.
  const map = {
    pending:        { bg: colors.warningBg, c: colors.warningText, l: 'Pending' },
    'in-progress':  { bg: colors.infoBg,    c: colors.infoText,    l: 'In Progress' },
    approved:       { bg: colors.successBg, c: colors.successText, l: 'Approved' },
    revision:       { bg: colors.redLight,  c: colors.dangerText,  l: 'Revision' },
    completed:      { bg: colors.successBg, c: colors.successText, l: 'Completed' },
  };
  const s = map[status] || { bg: colors.bg, c: colors.textSecondary, l: status };
  return (
    <span style={{
      background: s.bg, color: s.c,
      padding: '5px 14px', borderRadius: radius.full,
      fontSize: 12, fontFamily: fonts.condensed,
      fontWeight: 700, letterSpacing: 0.5,
      textTransform: 'uppercase', whiteSpace: 'nowrap'
    }}>{s.l}</span>
  );
};

export const PriorityDot = ({ p }) => (
  // Pulls from theme tokens too — high → red brand, medium → warning
  // amber, low → success green, unknown → muted text gray.
  <span style={{
    display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
    background: { high: colors.red, medium: colors.warning, low: colors.success }[p] || colors.textMuted,
    marginRight: 4
  }} />
);

// ─── Buttons ────────────────────────────────────────────────────────────────

// RedButton — primary CTA. Background, color, and disabled state live in
// the `.btn-primary` class (global-styles.jsx) so :hover and :active can
// fire. Inline style still owns layout, font, padding, etc.
//
// Note on inline style + class interaction: CSS specificity makes inline
// style win for any property they share. We deliberately leave background
// + color OUT of inline style here so the class rules can express hover.
// Only override these via className/style if you really mean to lock them.
export const RedButton = ({ children, onClick, disabled, style, className, type }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className={['btn-primary', className].filter(Boolean).join(' ')}
    style={{
      border: 'none',
      borderRadius: radius.base,
      padding: '10px 22px',
      fontFamily: fonts.body,
      fontSize: 13,
      fontWeight: 700,
      cursor: disabled ? 'default' : 'pointer',
      letterSpacing: 0.3,
      ...style
    }}
  >{children}</button>
);

// OutlineButton — secondary action. Hover gets a soft accent-tinted fill
// + accent-tinted border via `.btn-outline`. Border + transparent bg
// stay in the inline style so the resting state is readable.
export const OutlineButton = ({ children, onClick, disabled, style, className, type }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className={['btn-outline', className].filter(Boolean).join(' ')}
    style={{
      background: 'transparent',
      color: disabled ? '#9CA3AF' : colors.text,
      border: `1px solid ${colors.border}`,
      borderRadius: radius.base,
      padding: '9px 20px',
      fontFamily: fonts.body,
      fontSize: 13,
      fontWeight: 600,
      cursor: disabled ? 'default' : 'pointer',
      letterSpacing: 0.3,
      ...style
    }}
  >{children}</button>
);

// IconButton — square 34px button with an icon glyph. Active state is
// expressed inline (so it persists between renders). Hover affordance
// from `.btn-icon` only fires on non-active buttons because they already
// carry the tint when active.
export const IconButton = ({ children, onClick, active, style }) => (
  <button
    onClick={onClick}
    className={active ? '' : 'btn-icon'}
    style={{
      background: active ? colors.accentSoft : 'transparent',
      color: active ? colors.accent : colors.textSecondary,
      border: 'none',
      borderRadius: radius.sm,
      width: 34, height: 34,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer',
      fontSize: 16,
      ...style
    }}
  >{children}</button>
);

// ─── Form Elements ──────────────────────────────────────────────────────────

export const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  background: colors.white,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.base,
  padding: '9px 12px',
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: 500,
  outline: 'none',
  transition: 'border-color 0.15s',
};

export const selectStyle = { ...inputStyle, cursor: 'pointer' };

// Avatar with pan/zoom positioning baked in. Renders a circular crop with
// an inner image scaled + offset per the manual_players profile_offset_*
// + profile_zoom values. NULL/undefined values render plain object-fit:cover.
//
// Pan math: a single transform combines translate + scale so both axes
// pan and zoom uniformly. We deliberately DON'T use object-position
// because in cover-fit mode it only has slack on the constrained axis,
// which is what made the editor feel "axis-locked" before. Translate
// happens in pre-transform pixel space, so a positive ox always moves
// the image right by the same display amount regardless of zoom; pan
// range scales naturally with zoom because the image's visible content
// is z× larger on screen.
//
// Use case: anywhere a player avatar appears (player hero, team roster card,
// trade history, content calendar, etc) — passing the same offset/zoom values
// keeps every surface visually consistent.
export const PositionedAvatar = ({
  src, fallback, fallbackBg, alt = '',
  offsetX, offsetY, zoom,
  size, // optional pixel size — when omitted the parent's box is used
  borderColor,
  borderWidth = 2,
  rounded = '50%',
  style,
}) => {
  // -1..1 → -50%..50% translate of the original (pre-scale) box. With
  // scale applied AFTER translate (read right-to-left in CSS), the
  // visible displacement is `ox% × scale_factor` — i.e. pan range grows
  // with zoom, which is exactly what feels right when zoomed in.
  const ox = (offsetX ?? 0) * 50;
  const oy = (offsetY ?? 0) * 50;
  const z  = Math.max(1, zoom ?? 1);
  const wrap = {
    width: size ?? '100%', height: size ?? '100%',
    borderRadius: rounded, overflow: 'hidden',
    background: fallbackBg || `linear-gradient(135deg,#1A1A22,#2A2A35)`,
    border: borderColor ? `${borderWidth}px solid ${borderColor}` : undefined,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    ...style,
  };
  if (!src) {
    return <div style={wrap}>{fallback}</div>;
  }
  return (
    <div style={wrap}>
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          width: '100%', height: '100%',
          objectFit: 'cover',
          objectPosition: 'center center',
          transform: `translate(${ox}%, ${oy}%) scale(${z})`,
          transformOrigin: 'center center',
          display: 'block',
          userSelect: 'none',
        }}
      />
    </div>
  );
};

// ─── Utility ────────────────────────────────────────────────────────────────

export const Divider = ({ style }) => (
  <div style={{ height: 1, background: colors.divider, margin: '16px 0', ...style }} />
);

export const Badge = ({ children, color = colors.red, style }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: color, color: '#fff',
    fontSize: 10, fontFamily: fonts.condensed, fontWeight: 700,
    minWidth: 18, height: 18, borderRadius: radius.full,
    padding: '0 5px',
    ...style
  }}>{children}</span>
);
