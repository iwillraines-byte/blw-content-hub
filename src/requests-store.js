// ─── Simple localStorage-backed requests store ─────────────────────────────
// Lets Requests.jsx and the Dashboard share the same persisted list so the
// dashboard's "N pending" card reflects real data session-to-session.
//
// Records:
//   { id, team, template, status, requester, date, createdAt (ms epoch),
//     priority, note }

const LS_KEY = 'blw_requests_v1';
const LS_COMMENTS_KEY = 'blw_request_comments_v1';

export function getRequests() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveRequests(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list || [])); }
  catch {}
}

export function getComments() {
  try {
    const raw = localStorage.getItem(LS_COMMENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveComments(list) {
  try { localStorage.setItem(LS_COMMENTS_KEY, JSON.stringify(list || [])); }
  catch {}
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
