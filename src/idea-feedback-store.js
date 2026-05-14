// Per-idea thumbs feedback. Stored locally for now; the AI prompt
// pipeline can read getRecentFeedback() to bias future generations
// away from down-voted patterns and toward up-voted ones.
//
// Shape: { [ideaId]: { vote: 'up' | 'down', at: epoch_ms,
//                      headline: string, angle: string, team: string } }
//
// We snapshot the headline + angle + team alongside the vote so
// downstream consumers can build a "last 10 ups / downs" prompt
// without having to round-trip the original idea row.

const KEY = 'blw-idea-feedback-v1';

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeAll(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* quota / private mode */ }
}

export function getFeedback(ideaId) {
  if (!ideaId) return null;
  const map = readAll();
  return map[ideaId] || null;
}

export function setFeedback(idea, vote /* 'up' | 'down' | null */) {
  if (!idea?.id) return;
  const map = readAll();
  if (vote == null) {
    delete map[idea.id];
  } else {
    map[idea.id] = {
      vote,
      at: Date.now(),
      headline: idea.headline || '',
      angle: idea.angle || '',
      team: idea.team || '',
    };
  }
  writeAll(map);
}

// Recent feedback ordered newest-first. Used by the AI prompt to
// surface "what the user has been thumbsing recently."
export function getRecentFeedback(limit = 20) {
  const map = readAll();
  return Object.entries(map)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, limit);
}

// Aggregate counts for a quick stat readout (settings page eventually).
export function getFeedbackTotals() {
  const map = readAll();
  let up = 0, down = 0;
  for (const v of Object.values(map)) {
    if (v.vote === 'up') up++;
    else if (v.vote === 'down') down++;
  }
  return { up, down };
}
