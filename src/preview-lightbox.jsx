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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { colors, fonts, radius } from './theme';

// usePhotoLightbox — small state machine for a photo grid that wants
// click-to-zoom + arrow-key nav. Returns helpers the grid wires onto
// each tile and props the page hands to <PreviewLightbox/> at the
// bottom of its render tree. Lives next to the component so any
// surface that imports the lightbox gets the hook for free.
//
// Usage:
//   const lb = usePhotoLightbox();
//   <Tile onClick={() => lb.openAt(items, i)} />
//   <PreviewLightbox {...lb.lightboxProps()} />
export function usePhotoLightbox() {
  const [state, setState] = useState(null); // { items, index } | null

  const openAt = useCallback((items, startIndex = 0) => {
    if (!Array.isArray(items) || items.length === 0) return;
    const clamped = Math.max(0, Math.min(items.length - 1, startIndex));
    setState({ items, index: clamped });
  }, []);
  const close = useCallback(() => setState(null), []);
  const prev = useCallback(() => setState(s => s
    ? { ...s, index: (s.index - 1 + s.items.length) % s.items.length }
    : s), []);
  const next = useCallback(() => setState(s => s
    ? { ...s, index: (s.index + 1) % s.items.length }
    : s), []);

  const current = state ? state.items[state.index] : null;
  const isVideoName = (n) => /\.(mp4|mov|webm|m4v)$/i.test(String(n || ''));

  const lightboxProps = useMemo(() => ({
    open: !!state,
    blob: current?.blob || null,
    isVideo: isVideoName(current?.name),
    caption: current?.name || '',
    position: state && state.items.length > 1 ? `${state.index + 1} / ${state.items.length}` : '',
    onClose: close,
    onPrev: state && state.items.length > 1 ? prev : null,
    onNext: state && state.items.length > 1 ? next : null,
  }), [state, current, close, prev, next]);

  return { openAt, close, prev, next, current, lightboxProps };
}

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
  const resolvedUrl = useResolvedUrl(url, blob, open);

  // Body scroll-lock while the lightbox is open. Without this the page
  // behind can still scroll (mouse-wheel, trackpad, arrow keys) which
  // makes the viewport feel like it "moves" out from under the modal —
  // which is what was happening when users said they had to "scroll
  // to find" the image. Lock at the body level only, not html, so the
  // sidebar still renders above its native scroll position.
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  // Render via a portal directly on document.body so the lightbox
  // escapes any ancestor with `transform`, `filter`, `perspective`, or
  // `contain` that would otherwise turn `position: fixed` into a
  // viewport-of-the-ancestor instead of viewport-of-the-page. That's
  // the most likely culprit when users say "the modal opens but I
  // have to scroll to find it" — a parent transform was scoping
  // fixed-positioning to the wrong containing block.
  const overlay = (
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

  // Mount on body via portal — see overlay comment for why.
  if (typeof document === 'undefined') return overlay;
  return createPortal(overlay, document.body);
}

// Proper hook: owns the lifecycle of any blob-derived object URL,
// revokes on unmount and on blob/url swap, and bails out cleanly when
// the caller passes a precomputed url directly. The previous
// implementation cached a single URL at module scope, which broke when
// (a) the lightbox unmounted while the cached blob was still being
// referenced from somewhere else and (b) a remount occurred against
// the same blob — the cached URL had already been revoked elsewhere
// so the <img> rendered as a dark frame.
function useResolvedUrl(url, blob, open) {
  const [resolved, setResolved] = useState(() => url || null);

  useEffect(() => {
    // Closed → nothing to render, no URL to manage.
    if (!open) {
      setResolved(null);
      return undefined;
    }
    // Caller-supplied URL wins; we don't allocate or revoke anything.
    if (url) {
      setResolved(url);
      return undefined;
    }
    // No blob either → render the "preview not available" fallback.
    if (!blob) {
      setResolved(null);
      return undefined;
    }
    // Allocate a fresh blob URL we own and clean up on swap/unmount.
    const u = URL.createObjectURL(blob);
    setResolved(u);
    return () => URL.revokeObjectURL(u);
  }, [url, blob, open]);

  return resolved;
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
