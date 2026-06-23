// Shared shell for the auth pages (Login / Register).
//
// v5: replaces the old flat-navy centered card with a slow-scrolling wall of
// BLW imagery (the work the tool produces — gameday graphics, stat cards,
// standings, player news) behind a charcoal scrim, with the form floating on
// top. Images are bundled static assets under /public/login (the page is
// pre-auth, so it can't pull live media). Swap or add montage-NN.jpg files to
// refresh the wall; the column logic adapts to the count.
import { colors, fonts, radius, shadows } from './theme';

// Bundled montage tiles (mix of output graphics + action photos). Add/remove
// files and bump COUNT to match.
const COUNT = 36;
const MONTAGE = Array.from({ length: COUNT }, (_, i) => `/login/montage-${String(i + 1).padStart(2, '0')}.jpg`);

// Distribute the tiles across 4 columns (every 4th image → one column), so each
// unique image lives in a single column; then duplicate that column's list so a
// -50% translate loops seamlessly. Distributing (vs. repeating all 36 per
// column) keeps the DOM light as the library grows.
const COLUMNS = [0, 1, 2, 3].map(c => {
  const own = MONTAGE.filter((_, i) => i % 4 === c);
  return [...own, ...own];
});
// Alternating direction + varied duration → unhurried parallax drift.
const COL_ANIM = [
  'blw-auth-up 95s linear infinite',
  'blw-auth-down 120s linear infinite',
  'blw-auth-up 140s linear infinite',
  'blw-auth-down 105s linear infinite',
];

export function AuthShell({ children }) {
  return (
    <div style={{
      position: 'relative', minHeight: '100vh', overflow: 'hidden',
      background: colors.bg, fontFamily: fonts.body,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      {/* Scrolling image wall */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: '-6% 0', zIndex: 0,
        display: 'flex', gap: 14, justifyContent: 'center',
        opacity: 0.5, pointerEvents: 'none',
      }}>
        {COLUMNS.map((col, ci) => (
          <div key={ci} className="auth-col" style={{
            flex: 'none', width: 'clamp(150px, 22vw, 280px)',
            display: 'flex', flexDirection: 'column', gap: 14,
            animation: COL_ANIM[ci], willChange: 'transform',
          }}>
            {col.map((src, ti) => (
              <img
                key={ti}
                src={src}
                alt=""
                style={{
                  width: '100%', display: 'block', borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Scrim — montage stays visible in the center but fades into charcoal
          toward the edges so the form always reads. */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
        background: `radial-gradient(ellipse 95% 95% at 50% 50%, transparent 0%, ${colors.bg} 78%)`,
      }} />

      {/* Form */}
      <div style={{ position: 'relative', zIndex: 2, width: '100%', maxWidth: 410 }}>
        {children}
      </div>
    </div>
  );
}

// Shared v5 form styling so Login + Register match.
export const authStyles = {
  card: {
    background: colors.white, borderRadius: radius.lg,
    border: `1px solid ${colors.border}`, padding: 30,
    boxShadow: shadows.lg,
    display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
  },
  logo: { display: 'block', width: 60, height: 60, objectFit: 'contain', marginBottom: 12 },
  title: { fontFamily: fonts.heading, fontSize: 25, fontWeight: 700, letterSpacing: 0, color: colors.text, margin: 0, lineHeight: 1.1 },
  muted: { fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary, margin: '7px 0 0', lineHeight: 1.5 },
  label: { display: 'block', textAlign: 'left', fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700, color: colors.textSecondary, letterSpacing: 0.8, marginBottom: 6, textTransform: 'uppercase' },
  hint: { fontWeight: 400, letterSpacing: 0, color: colors.textMuted, textTransform: 'none' },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 14, fontFamily: fonts.body, border: `1px solid ${colors.border}`, borderRadius: radius.base, background: colors.bg, color: colors.text, outline: 'none', transition: 'border-color 0.15s' },
  errorBox: { marginTop: 10, padding: '9px 12px', background: colors.redLight, color: colors.text, border: `1px solid ${colors.redBorder}`, borderRadius: radius.base, fontSize: 12, textAlign: 'left', lineHeight: 1.45 },
  submitBtn: { width: '100%', marginTop: 14, padding: '11px 14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: colors.red, color: '#fff', border: 'none', borderRadius: radius.base, fontFamily: fonts.condensed, fontSize: 14, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', cursor: 'pointer' },
  linkButton: { marginTop: 16, background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer', fontFamily: fonts.body, fontSize: 13, textDecoration: 'underline' },
  smallLink: { fontSize: 12, color: colors.textSecondary, textDecoration: 'none', fontFamily: fonts.body },
  smallLinkBtn: { background: 'none', border: 'none', padding: 0, fontSize: 12, color: colors.textSecondary, cursor: 'pointer', textDecoration: 'underline', fontFamily: fonts.body },
};
