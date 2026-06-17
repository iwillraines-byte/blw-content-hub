// ─── Unread tracking for request threads (v4.15.0) ──────────────────────────
// useUnreadRequests() computes, per visible request, how many thread
// messages are newer than the user's server-side last-read marker AND
// authored by someone else. Powers the nav badge, the dashboard "N unread
// replies" line, and the per-card unread dot.
//
// Read markers live in Supabase (request_reads, db/020) — per USER, not per
// device — so opening a thread on your phone clears the badge on your laptop.
// Soft-fails everywhere: no session / table missing / fetch error → zero
// badges, never an error surface.

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authedJson } from './authed-fetch';
import { refreshRequestsFromCloud } from './cloud-reader';
import { getRequests, getComments } from './requests-store';
import { useAuth } from './auth';

const REFRESH_MS = 60 * 1000;

function computeUnread({ requests, comments, reads, me, isAthlete, email }) {
  const readAt = new Map((reads || []).map(r => [r.requestId, new Date(r.lastReadAt).getTime()]));
  const visible = (requests || []).filter(r => {
    if (!isAthlete) return true;
    return (me && r.requesterUserId === me) || (email && r.requesterEmail === email);
  });
  const visibleIds = new Set(visible.map(r => r.id));
  const unreadByRequest = {};
  for (const c of (comments || [])) {
    if (!visibleIds.has(c.requestId)) continue;
    if (me && c.authorUserId === me) continue; // my own messages aren't unread
    const at = c.createdAt || 0;
    const seen = readAt.get(c.requestId) || 0;
    if (at > seen) unreadByRequest[c.requestId] = (unreadByRequest[c.requestId] || 0) + 1;
  }
  const totalUnread = Object.values(unreadByRequest).reduce((a, b) => a + b, 0);
  return { totalUnread, unreadByRequest };
}

export function useUnreadRequests({ userId, email, isAthlete, enabled = true } = {}) {
  const [state, setState] = useState({ totalUnread: 0, unreadByRequest: {} });
  const readsRef = useRef([]);

  const recompute = useCallback(() => {
    setState(computeUnread({
      requests: getRequests(),
      comments: getComments(),
      reads: readsRef.current,
      me: userId, isAthlete, email,
    }));
  }, [userId, isAthlete, email]);

  const refresh = useCallback(async () => {
    if (!enabled || !userId) return;
    // Skip polling while the tab is backgrounded — no point hitting the
    // network every 60s for a view nobody's looking at. We refresh on
    // focus / visibilitychange when the user comes back.
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const [readsRes] = await Promise.all([
        authedJson('/api/request-reads').catch(() => null),
        refreshRequestsFromCloud().catch(() => null),
      ]);
      // Only replace the cache when the fetch actually returned reads. On a
      // failed call, KEEP the previous markers — clearing them to [] would
      // make every message read as unread and balloon the badge until the
      // next good poll.
      if (readsRes?.reads) readsRef.current = readsRes.reads;
    } catch { /* zero badges beat an error surface */ }
    recompute();
  }, [enabled, userId, recompute]);

  useEffect(() => {
    if (!enabled || !userId) return;
    refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    const onFocus = () => refresh();
    const onVisible = () => { if (!document.hidden) refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, userId, refresh]);

  // Mark a thread read: optimistic local clear + server stamp.
  const markRead = useCallback((requestId) => {
    if (!requestId) return;
    const nowIso = new Date().toISOString();
    const rest = readsRef.current.filter(r => r.requestId !== requestId);
    readsRef.current = [...rest, { requestId, lastReadAt: nowIso }];
    recompute();
    if (userId) {
      authedJson('/api/request-reads', { method: 'POST', body: { requestId } }).catch(() => {});
    }
  }, [userId, recompute]);

  return { ...state, refresh, recompute, markRead };
}

// ─── Shared provider (v4.19.0) ──────────────────────────────────────────────
// Pre-fix, useUnreadRequests() was called independently in the Sidebar, the
// dashboard card, AND the Requests page — so 2-3 copies each ran their own
// 60s poll + cloud refresh, out of phase. Now ONE instance runs at the app
// shell and every consumer reads it from context. markRead/refresh are shared
// so a read in one place clears the badge everywhere instantly.
const UnreadCtx = createContext({ totalUnread: 0, unreadByRequest: {}, markRead: () => {}, refresh: () => {}, recompute: () => {} });

export function UnreadRequestsProvider({ children }) {
  const { user, role } = useAuth();
  const value = useUnreadRequests({
    userId: user?.id,
    email: user?.email,
    isAthlete: role === 'athlete',
    enabled: !!user?.id && ['master_admin', 'admin', 'content', 'athlete'].includes(role),
  });
  return <UnreadCtx.Provider value={value}>{children}</UnreadCtx.Provider>;
}

export function useUnreadRequestsCtx() {
  return useContext(UnreadCtx);
}
