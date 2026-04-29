// Content ideas — client-side hooks against /api/content-ideas.
//
// One hook for callers (`useContentIdeas`) that handles the lifecycle:
//   - fetch on mount + whenever filters change
//   - prepend optimistically when /api/ideas returns a fresh batch
//   - patch (caption edits / regens) with optimistic UI
//   - delete (dismiss) with optimistic UI
//
// Filters: { team?, player? } — both optional. Omit team to get the
// dashboard's league-wide view. Player must be a lastname (uppercase
// or any case — server normalises).
//
// Persistence is best-effort. If /api/content-ideas fails, the hook
// returns whatever it has plus an `error` field so the caller can show
// a soft hint without breaking the UI.

import { useEffect, useState, useCallback, useRef } from 'react';
import { authedFetch } from './authed-fetch';
import { useAuth } from './auth';

const ENDPOINT = '/api/content-ideas';

export function useContentIdeas({ team = null, player = null, limit = 50 } = {}) {
  const { user } = useAuth();
  const [ideas, setIdeas] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [error, setError] = useState(null);
  // Track last fetched filters to avoid double-fetches when the parent
  // re-renders without changing the filter values.
  const sigRef = useRef('');

  const sig = `${user?.id || ''}|${team || ''}|${player || ''}|${limit}`;

  const fetchNow = useCallback(async () => {
    if (!user?.id) return;  // Endpoint requires auth
    const params = new URLSearchParams();
    if (team) params.set('team', team);
    if (player) params.set('player', player);
    if (limit) params.set('limit', String(limit));
    try {
      const res = await authedFetch(`${ENDPOINT}?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`);
        return;
      }
      setIdeas(Array.isArray(data.ideas) ? data.ideas : []);
      setTableMissing(!!data.tableMissing);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }, [user?.id, team, player, limit]);

  useEffect(() => {
    if (sigRef.current === sig) return;
    sigRef.current = sig;
    fetchNow();
  }, [sig, fetchNow]);

  // Optimistically prepend new ideas to the local list. Caller still has
  // to re-trigger a fetch to reconcile against the server, but for the
  // dashboard's "Generate Ideas" path we know the server already wrote
  // them, so the optimistic prepend is equivalent.
  const prependIdeas = useCallback((newIdeas) => {
    if (!Array.isArray(newIdeas) || newIdeas.length === 0) return;
    setIdeas(prev => {
      const seen = new Set(newIdeas.map(i => i.id));
      const trimmed = prev.filter(i => !seen.has(i.id));
      return [...newIdeas, ...trimmed];
    });
  }, []);

  // Patch a single idea both locally and on the server. Used when
  // captions are drafted/regenerated/edited so the change persists
  // across refreshes and surfaces.
  const patchIdea = useCallback(async (ideaId, patch) => {
    setIdeas(prev => prev.map(i => i.id === ideaId ? { ...i, ...patch } : i));
    if (!user?.id) return;
    try {
      await authedFetch(`${ENDPOINT}?id=${encodeURIComponent(ideaId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch {
      // Soft-fail: local state is already updated, the user will see
      // the change. A reload would lose un-patched edits, but that's
      // acceptable degradation.
    }
  }, [user?.id]);

  const dismissIdea = useCallback(async (ideaId) => {
    setIdeas(prev => prev.filter(i => i.id !== ideaId));
    if (!user?.id) return;
    try {
      await authedFetch(`${ENDPOINT}?id=${encodeURIComponent(ideaId)}`, { method: 'DELETE' });
    } catch {
      // Soft-fail same as patch.
    }
  }, [user?.id]);

  return {
    ideas,
    loaded,
    error,
    tableMissing,
    refetch: fetchNow,
    prependIdeas,
    patchIdea,
    dismissIdea,
  };
}
