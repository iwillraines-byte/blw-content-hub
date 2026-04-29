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

// ─── Idea-payload encoding ──────────────────────────────────────────────────
// Requests created from an AI content idea carry the FULL structured idea
// (headline, narrative, prefill, captions, stat pills, source angle) so
// the Requests page can render a rich detail view AND deep-link straight
// into Generate with all fields auto-populated.
//
// The cloud `requests` table only has flat columns (id, team, template,
// status, priority, requester, note). To avoid a schema migration we
// stash the structured payload as a JSON suffix INSIDE the `note` field,
// fenced by sentinel markers. On read we split the note back into
// human-prose + idea-payload. Old requests without the markers continue
// to render exactly the way they always did.
const IDEA_FENCE_OPEN = '\n<<idea_payload>>\n';
const IDEA_FENCE_CLOSE = '\n<<end_idea_payload>>';

export function embedIdeaInNote(prose, idea) {
  if (!idea) return prose || '';
  let payload;
  try { payload = JSON.stringify(idea); }
  catch { return prose || ''; }
  return `${prose || ''}${IDEA_FENCE_OPEN}${payload}${IDEA_FENCE_CLOSE}`;
}

export function extractIdeaFromNote(note) {
  if (!note || typeof note !== 'string') return { prose: note || '', idea: null };
  const start = note.indexOf(IDEA_FENCE_OPEN);
  if (start === -1) return { prose: note, idea: null };
  const end = note.indexOf(IDEA_FENCE_CLOSE, start);
  if (end === -1) return { prose: note, idea: null };
  const prose = note.slice(0, start).trimEnd();
  const json = note.slice(start + IDEA_FENCE_OPEN.length, end);
  try {
    return { prose, idea: JSON.parse(json) };
  } catch {
    return { prose: note, idea: null };
  }
}

// Build a /generate?... URL from an idea so the Request detail and the
// Idea card both use the same routing logic. Empty values are skipped
// so the URL stays clean. Mirrors buildLink() in ContentStudio.jsx —
// hoisted here so any caller (Requests, Idea card, etc.) shares it.
export function buildGenerateLinkFromIdea(idea) {
  if (!idea) return '/generate';
  const params = new URLSearchParams();
  if (idea.templateId) params.set('template', idea.templateId);
  if (idea.team && idea.team !== 'BLW') params.set('team', idea.team);
  if (idea.prefill && typeof idea.prefill === 'object') {
    for (const [k, v] of Object.entries(idea.prefill)) {
      if (v != null && v !== '') params.set(k, String(v));
    }
  }
  // Tag the link so the Generate page can show a one-time "loaded from
  // Request X" banner if we want to wire that later. Cheap to include
  // and ignored by the page today.
  if (idea.requestId) params.set('fromRequest', idea.requestId);
  const qs = params.toString();
  return qs ? `/generate?${qs}` : '/generate';
}

// Suggest which photo asset types are most relevant for a given idea so
// the Request detail panel can prompt the user "look for HEADSHOTs of
// {player}" instead of leaving the photo selection vague. Conservative
// — falls back to a generic ['HEADSHOT', 'ACTION'] when we can't infer
// anything more specific.
export function suggestAssetTypesForIdea(idea) {
  const t = String(idea?.templateId || '').toLowerCase();
  if (!t) return ['HEADSHOT', 'ACTION'];
  if (t.includes('news') || t.includes('player-stat') || t.includes('quote')) {
    return ['HEADSHOT', 'PORTRAIT', 'ACTION'];
  }
  if (t.includes('highlight') || t.includes('recap') || t.includes('moment')) {
    return ['ACTION', 'ACTION2', 'HIGHLIGHT'];
  }
  if (t.includes('team') || t.includes('schedule') || t.includes('matchup')) {
    return ['TEAMPHOTO', 'LOGO_PRIMARY', 'WORDMARK'];
  }
  return ['HEADSHOT', 'ACTION'];
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
