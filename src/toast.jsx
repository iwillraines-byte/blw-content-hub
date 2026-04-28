// Lightweight toast notification system. Drop <ToastProvider> at the app
// root; call `useToast()` from anywhere to push transient messages.
//
// Usage:
//   const toast = useToast();
//   toast.success('Request queued');
//   toast.error('Couldn\'t save');
//   toast.info('Syncing…', { duration: null });   // null = sticky
//   toast.push({ kind: 'info', text: 'Deleted', action: { label: 'Undo', onClick: () => ... } });
//
// Each toast auto-dismisses after `duration` ms (default 4000). Action
// toasts live long enough to actually click ("Undo" defaults to 7s).

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { colors, fonts, radius } from './theme';

const ToastContext = createContext(null);

const KIND_STYLES = {
  success: { bg: 'rgba(34,197,94,0.10)', fg: '#15803D', border: 'rgba(34,197,94,0.35)', icon: '✓' },
  error:   { bg: 'rgba(220,38,38,0.10)', fg: '#991B1B', border: 'rgba(220,38,38,0.35)', icon: '✕' },
  info:    { bg: 'rgba(14,165,233,0.10)', fg: '#075985', border: 'rgba(14,165,233,0.35)', icon: 'ℹ' },
  warn:    { bg: 'rgba(245,158,11,0.12)', fg: '#92400E', border: 'rgba(245,158,11,0.35)', icon: '⚠' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((opts) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const toast = {
      id,
      kind: opts.kind || 'info',
      text: opts.text || '',
      detail: opts.detail || null,
      action: opts.action || null,
      duration: opts.duration === null ? null : (opts.duration ?? (opts.action ? 7000 : 4000)),
    };
    setToasts(prev => [...prev, toast]);
    if (toast.duration != null) {
      setTimeout(() => dismiss(id), toast.duration);
    }
    return id;
  }, [dismiss]);

  const api = {
    push,
    dismiss,
    success: (text, opts = {}) => push({ kind: 'success', text, ...opts }),
    error:   (text, opts = {}) => push({ kind: 'error',   text, ...opts }),
    info:    (text, opts = {}) => push({ kind: 'info',    text, ...opts }),
    warn:    (text, opts = {}) => push({ kind: 'warn',    text, ...opts }),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, dismiss }) {
  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 16,
      display: 'flex', flexDirection: 'column', gap: 8,
      zIndex: 9999, pointerEvents: 'none',
      maxWidth: 'calc(100vw - 32px)', width: 360,
    }}>
      {toasts.map(t => {
        const s = KIND_STYLES[t.kind] || KIND_STYLES.info;
        return (
          <div key={t.id} style={{
            pointerEvents: 'auto',
            background: 'white',
            // Severity is already conveyed by the colored icon circle at left
            // and the action-button accent. The full 1px tinted border holds
            // the boundary without a 3px side-stripe shouting at the user.
            border: `1px solid ${s.border}`,
            borderRadius: radius.base,
            padding: '10px 12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)',
            fontFamily: fonts.body, fontSize: 13,
            color: colors.text,
            display: 'flex', alignItems: 'flex-start', gap: 10,
            animation: 'toastin 0.18s ease-out',
          }}>
            <span style={{
              background: s.bg, color: s.fg,
              width: 22, height: 22, borderRadius: '50%',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, fontSize: 13, fontWeight: 800,
            }}>{s.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{t.text}</div>
              {t.detail && (
                <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>{t.detail}</div>
              )}
            </div>
            {t.action && (
              <button
                onClick={() => { t.action.onClick(); dismiss(t.id); }}
                style={{
                  background: s.bg, border: `1px solid ${s.border}`,
                  color: s.fg, padding: '4px 10px', borderRadius: radius.sm,
                  fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
                  letterSpacing: 0.6, cursor: 'pointer', whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >{t.action.label}</button>
            )}
            <button onClick={() => dismiss(t.id)} style={{
              background: 'transparent', border: 'none', color: colors.textMuted,
              cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0,
              width: 18, height: 18, flexShrink: 0,
            }}>×</button>
          </div>
        );
      })}
      <style>{`@keyframes toastin { from { transform: translateY(8px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Gracefully no-op if used outside the provider — rare but defensive.
    return {
      push: () => null,
      dismiss: () => {},
      success: () => {},
      error: () => {},
      info: () => {},
      warn: () => {},
    };
  }
  return ctx;
}
