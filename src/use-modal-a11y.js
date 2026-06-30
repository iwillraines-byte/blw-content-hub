// ─── useModalA11y ───────────────────────────────────────────────────────────
//
// Shared focus management for modal dialogs / overlays. On open it moves
// focus into the dialog, traps Tab / Shift+Tab inside it, and on close
// restores focus to whatever element was focused when the modal opened
// (the trigger). Escape-to-close stays with each modal — this hook only
// owns focus.
//
// Usage:
//   const dialogRef = useRef(null);
//   useModalA11y(open, dialogRef);
//   ...
//   <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="…">
//
// The container should be the dialog root. Give it tabIndex={-1} so the
// hook can focus the container itself when it holds no focusable children
// yet. Mark a preferred initial target with `data-autofocus` (e.g. the
// first text input) — otherwise the first focusable element is used.

import { useEffect } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useModalA11y(open, containerRef) {
  useEffect(() => {
    if (!open) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    // Remember the trigger so we can hand focus back on close.
    const previouslyFocused = document.activeElement;

    const visibleFocusable = () =>
      Array.from(container.querySelectorAll(FOCUSABLE))
        .filter(n => n.offsetParent !== null || n === document.activeElement);

    // Move focus in after paint (the dialog content must be mounted first).
    const raf = requestAnimationFrame(() => {
      const target =
        container.querySelector('[data-autofocus]') ||
        visibleFocusable()[0] ||
        container;
      try { target.focus(); } catch { /* noop */ }
    });

    // Trap Tab within the dialog.
    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const nodes = visibleFocusable();
      if (nodes.length === 0) { e.preventDefault(); try { container.focus(); } catch { /* noop */ } return; }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !container.contains(active)) { e.preventDefault(); last.focus(); }
      } else if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    container.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener('keydown', onKeyDown);
      // Restore focus to the trigger if it's still in the document.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        try { previouslyFocused.focus(); } catch { /* noop */ }
      }
    };
  }, [open, containerRef]);
}
