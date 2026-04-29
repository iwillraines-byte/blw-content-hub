// Changelog modal — opens when the user clicks the version label in
// the sidebar footer (or the version chip in Settings → About). Renders
// the full RELEASES array from src/changelog.js as a scrollable
// timeline of versions. Each release has a kind chip (MAJOR / MINOR /
// PATCH), a summary headline, and a bulleted list of changes.
//
// Pure presentational component — owns its own ESC + outside-click
// close behavior so callers just need to render <ChangelogModal /> +
// pass `open` and `onClose`.

import { useEffect, useRef } from 'react';
import { RELEASES, KIND_TOKENS } from './changelog';
import { GIT_COMMIT, formattedBuildDate } from './version';
import { colors, fonts, radius } from './theme';

export default function ChangelogModal({ open, onClose }) {
  const dialogRef = useRef(null);

  // ESC closes; click outside the dialog body closes; focus moves into
  // the dialog on open so keyboard nav lands somewhere reasonable.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    // Defer focus until after paint so the browser doesn't fight the
    // animation reveal.
    const t = setTimeout(() => dialogRef.current?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-label="Release notes"
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720,
          maxHeight: 'min(86vh, 800px)',
          background: colors.white,
          borderRadius: radius.lg,
          boxShadow: '0 24px 60px rgba(0,0,0,0.32), 0 6px 16px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          outline: 'none',
        }}
      >
        {/* Header — title left, build fingerprint right. The fingerprint
            row stays tiny on purpose so the page doesn't fight for the
            user's eye with the version timeline below. */}
        <div style={{
          padding: '18px 22px',
          borderBottom: `1px solid ${colors.borderLight}`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{
              fontFamily: fonts.heading, fontSize: 22, margin: 0,
              letterSpacing: 1, color: colors.text, fontWeight: 400,
            }}>
              Release notes
            </h2>
            <div style={{
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: 11, color: colors.textMuted, marginTop: 2,
            }}>
              Currently running v{RELEASES[0]?.version}
              {GIT_COMMIT !== 'dev' && (
                <>
                  {' · '}
                  <span title="Build commit (for bug reports)">{GIT_COMMIT}</span>
                </>
              )}
              {' · '}
              <span>built {formattedBuildDate()}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none',
              fontSize: 22, color: colors.textSecondary,
              cursor: 'pointer', padding: '2px 8px',
              borderRadius: radius.sm,
            }}
          >✕</button>
        </div>

        {/* Timeline — vertical list, newest first. Each release is a
            self-contained block; the kind chip anchors the eye to where
            you are in the major/minor/patch cadence. */}
        <div style={{
          padding: '4px 22px 22px',
          overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 18,
        }}>
          {RELEASES.map((r, idx) => (
            <ReleaseBlock key={r.version} release={r} isLatest={idx === 0} />
          ))}
        </div>

        {/* Footer — small reassurance row. Keeps the modal feeling like
            a deliberate surface and not just a dump of commit messages. */}
        <div style={{
          padding: '10px 22px',
          borderTop: `1px solid ${colors.borderLight}`,
          background: colors.bg,
          fontSize: 11, color: colors.textMuted,
          fontFamily: fonts.body,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 12, flexWrap: 'wrap',
        }}>
          <span>
            BLW Content Hub release log · curated, not auto-generated.
          </span>
          <span style={{ fontFamily: fonts.condensed, letterSpacing: 0.5 }}>
            ESC to close
          </span>
        </div>
      </div>
    </div>
  );
}

function ReleaseBlock({ release, isLatest }) {
  const tokens = KIND_TOKENS[release.kind] || KIND_TOKENS.minor;

  // Format the date as "Apr 29, 2026" — full date is fine here since
  // each release block is anchored visually with the version on top.
  const dateLabel = (() => {
    try {
      return new Date(release.date).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
      });
    } catch {
      return release.date;
    }
  })();

  return (
    <div style={{
      // The "Latest" block gets a soft team-tinted card; older blocks
      // sit on the default background so the eye lands on what's new
      // first. Otherwise visually identical so the timeline reads as
      // continuous history.
      padding: isLatest ? 14 : '4px 0 0',
      background: isLatest ? colors.bg : 'transparent',
      borderRadius: isLatest ? radius.base : 0,
      border: isLatest ? `1px solid ${colors.borderLight}` : 'none',
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10,
        flexWrap: 'wrap', marginBottom: 6,
      }}>
        <span style={{
          fontFamily: fonts.heading, fontSize: 18,
          color: colors.text, letterSpacing: 0.4, fontWeight: 400,
        }}>
          v{release.version}
        </span>
        <span style={{
          background: tokens.bg, border: `1px solid ${tokens.border}`,
          color: tokens.fg,
          fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
          letterSpacing: 0.8, textTransform: 'uppercase',
          padding: '2px 7px', borderRadius: radius.sm,
        }}>{tokens.label}</span>
        {isLatest && (
          <span style={{
            fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
            letterSpacing: 0.8, color: colors.red,
            background: 'rgba(220,38,38,0.10)',
            border: '1px solid rgba(220,38,38,0.30)',
            padding: '2px 7px', borderRadius: radius.sm,
          }}>● LATEST</span>
        )}
        <span style={{
          fontSize: 11, color: colors.textMuted,
          fontFamily: fonts.condensed, marginLeft: 'auto',
          letterSpacing: 0.4,
        }}>{dateLabel}</span>
      </div>

      <div style={{
        fontFamily: fonts.body, fontSize: 14, fontWeight: 700,
        color: colors.text, lineHeight: 1.4, marginBottom: 8,
      }}>{release.summary}</div>

      <ul style={{
        margin: 0, paddingLeft: 18,
        fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary,
        lineHeight: 1.55,
      }}>
        {release.items.map((item, i) => (
          <li key={i} style={{ marginBottom: 4 }}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
