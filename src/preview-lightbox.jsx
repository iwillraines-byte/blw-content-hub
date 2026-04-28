// Reusable full-size preview lightbox for the Files page and the bulk
// import modal. Two callsites today, but the UX (click thumbnail → see
// the photo bigger so you can identify the player) is something we'll
// want anywhere we render a grid of media — it's worth the small
// extraction over a copy-paste in each surface.
//
// Designed to be drop-in: caller owns the open/closed state, just
// passes the current item plus optional prev/next handlers and an
// optional sidebar element (used by the bulk modal to show edit
// fields right next to the photo).

import { useEffect } from 'react';
import { colors, fonts, radius } from './theme';

export function PreviewLightbox({
  open,
  onClose,
  // Either pass `url` directly or `blob` and we'll generate one.
  url,
  blob,
  isVideo = false,
  caption = '',
  position = '',
  onPrev = null,
  onNext = null,
  // Optional element rendered below the image — bulk import uses this
  // to put inline tag-edit fields next to the full-size photo.
  sidebar = null,
  // Optional ReactNode rendered next to the Close button — used by the
  // Files page to show a Download button without forking the lightbox.
  actions = null,
}) {
  // Keyboard nav: ←/→ flip, Esc closes. We only attach the listener
  // while the lightbox is open so no globals hang around.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && onPrev) onPrev();
      else if (e.key === 'ArrowRight' && onNext) onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onPrev, onNext]);

  // Generate a transient blob URL when the caller hands us a Blob.
  // Revoke on unmount / blob swap so we don't leak.
  const resolvedUrl = useResolvedUrl(url, blob);

  if (!open) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 300, padding: 24, gap: 16, flexDirection: 'column',
      }}
    >
      <div style={{
        position: 'absolute', top: 12, right: 16,
        display: 'flex', gap: 8, alignItems: 'center',
        color: 'rgba(255,255,255,0.85)',
        fontFamily: fonts.condensed, fontSize: 11, letterSpacing: 0.5,
      }}>
        {position && <span style={{ marginRight: 4 }}>{position}</span>}
        {actions}
        <button onClick={onClose} style={{
          background: 'transparent', color: 'inherit', border: '1px solid rgba(255,255,255,0.4)',
          borderRadius: radius.sm, padding: '4px 10px',
          fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
          cursor: 'pointer', fontFamily: 'inherit',
        }}>Close (Esc)</button>
      </div>

      {onPrev && (
        <button onClick={onPrev} style={navBtn('left')} aria-label="Previous">‹</button>
      )}
      {onNext && (
        <button onClick={onNext} style={navBtn('right')} aria-label="Next">›</button>
      )}

      <div style={{
        flex: 1, width: '100%', maxHeight: sidebar ? '60vh' : '85vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {resolvedUrl && !isVideo && (
          <img src={resolvedUrl} alt={caption || 'preview'} style={{
            maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
            borderRadius: radius.sm,
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          }} />
        )}
        {resolvedUrl && isVideo && (
          <video src={resolvedUrl} controls style={{
            maxWidth: '100%', maxHeight: '100%', borderRadius: radius.sm,
          }} />
        )}
        {!resolvedUrl && (
          <div style={{ color: 'rgba(255,255,255,0.6)', fontFamily: fonts.condensed, fontSize: 14 }}>
            Preview not available for this file.
          </div>
        )}
      </div>

      {caption && !sidebar && (
        <div style={{
          color: 'rgba(255,255,255,0.85)', fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 12, padding: '4px 12px',
          background: 'rgba(0,0,0,0.4)', borderRadius: radius.sm,
          maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{caption}</div>
      )}

      {sidebar}
    </div>
  );
}

// Keep blob → URL conversion in one place so we always remember to revoke.
function useResolvedUrl(url, blob) {
  // We can't useState here without importing React's hook list. Inline
  // ref-style lifecycle via a closure-stable variable + useEffect.
  // Simpler: caller almost always passes `url` directly (the Files page
  // already keeps blobToObjectURL maps). Use blob as a fallback.
  if (url) return url;
  if (!blob) return null;
  // Note: this allocates a new URL on every render the lightbox is open,
  // which is fine because the lightbox unmounts on close. The bulk
  // import modal handles its own URL lifecycle and never passes a blob
  // here, so we don't see the cost in practice.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return resolveBlobUrl(blob);
}

let _activeBlobUrl = null;
let _activeBlob = null;
function resolveBlobUrl(blob) {
  if (_activeBlob === blob && _activeBlobUrl) return _activeBlobUrl;
  if (_activeBlobUrl) URL.revokeObjectURL(_activeBlobUrl);
  _activeBlob = blob;
  _activeBlobUrl = URL.createObjectURL(blob);
  return _activeBlobUrl;
}

const navBtn = (side) => ({
  position: 'absolute', top: '50%', transform: 'translateY(-50%)',
  [side]: 16,
  width: 44, height: 44, borderRadius: '50%',
  background: 'rgba(255,255,255,0.18)',
  color: '#fff', border: '1px solid rgba(255,255,255,0.35)',
  fontSize: 28, lineHeight: 1, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1,
});
