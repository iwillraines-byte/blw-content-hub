// ─── Simple localStorage-backed requests store ─────────────────────────────
// Lets Requests.jsx and the Dashboard share the same persisted list so the
// dashboard's "N pending" card reflects real data session-to-session.
//
// Records:
//   { id, team, template, status, requester, date, createdAt (ms epoch),
//     priority, note }

import { cloud } from './cloud-sync';

const LS_KEY = 'blw_requests_v1';
const LS_COMMENTS_KEY = 'blw_request_comments_v1';

export function getRequests() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// Phase 2 dual-write: after the local save, diff the incoming list against
// what was there and sync inserts/updates + deletes up to Supabase. Callers
// pass the entire new list today — we reconstruct the delta from the prior
// local state so we don't need to change any call sites.
export function saveRequests(list) {
  const prev = getRequests();
  try { localStorage.setItem(LS_KEY, JSON.stringify(list || [])); }
  catch {}

  // Sync: upsert anything changed or added, delete anything removed.
  const prevById = new Map(prev.map(r => [r.id, r]));
  const nextById = new Map((list || []).map(r => [r.id, r]));
  for (const r of (list || [])) {
    const before = prevById.get(r.id);
    // Cheap shallow compare — if any field differs, sync.
    if (!before || JSON.stringify(before) !== JSON.stringify(r)) {
      cloud.syncRequest(r);
    }
  }
  for (const [id] of prevById) {
    if (!nextById.has(id)) cloud.deleteRequest(id);
  }
}

export function getComments() {
  try {
    const raw = localStorage.getItem(LS_COMMENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveComments(list) {
  const prev = getComments();
  try { localStorage.setItem(LS_COMMENTS_KEY, JSON.stringify(list || [])); }
  catch {}

  const prevById = new Map(prev.map(c => [c.id, c]));
  const nextById = new Map((list || []).map(c => [c.id, c]));
  for (const c of (list || [])) {
    const before = prevById.get(c.id);
    if (!before || JSON.stringify(before) !== JSON.stringify(c)) {
      cloud.syncRequestComment(c);
    }
  }
  for (const [id] of prevById) {
    if (!nextById.has(id)) cloud.deleteRequestComment(id);
  }
}

// ─── Helpers used by dashboard card ─────────────────────────────────────────
export function countByStatus(requests, status) {
  return (requests || []).filter(r => r.status === status).length;
}

export function oldestPendingDays(requests) {
  const pendings = (requests || []).filter(r => r.status === 'pending' && r.createdAt);
  if (pendings.length === 0) return null;
  const oldest = Math.min(...pendings.map(r => r.createdAt));
  const days = Math.floor((Date.now() - oldest) / (1000 * 60 * 60 * 24));
  return days;
}
