// Tiny session-scoped cache for handing the FULL idea payload across a
// route hop into Generate. The dashboard, player-page modal, and
// Requests detail panel all link to /generate?ideaId=X (or
// ?fromRequest=Y for request-derived ones); Generate reads the stash
// here on mount so it can surface a "Brief context" drawer with the
// idea's narrative + captions next to the canvas.
//
// Why sessionStorage and not URL params:
//   - Captions and narrative are 100s–1000s of characters; URL bloat.
//   - Survives a refresh of /generate (sessionStorage is tab-scoped).
//   - Cleared on tab close — no cross-session leakage.
//
// Why not localStorage:
//   - localStorage would persist across tabs / sessions and would
//     accumulate stale ideas indefinitely. Session scope matches the
//     "I just clicked an idea, take me to the canvas" intent exactly.
//
// We bound the cache at 8 entries (LRU-ish) so a long content-creation
// session doesn't unboundedly fill sessionStorage. Eight covers more
// than any realistic "in-flight ideas" count without bloat.

const KEY = 'blw_idea_context_v1';
const MAX = 8;

function readMap() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function writeMap(map) {
  try {
    // LRU trim: keep the 8 most-recently-stashed entries by `_stashedAt`.
    const entries = Object.entries(map);
    if (entries.length > MAX) {
      entries.sort((a, b) => (b[1]?._stashedAt || 0) - (a[1]?._stashedAt || 0));
      const trimmed = Object.fromEntries(entries.slice(0, MAX));
      sessionStorage.setItem(KEY, JSON.stringify(trimmed));
    } else {
      sessionStorage.setItem(KEY, JSON.stringify(map));
    }
  } catch {
    // sessionStorage might be disabled (private browsing on some
    // engines). The drawer just won't render — Generate falls back to
    // its existing prefill flow exactly as before.
  }
}

export function stashIdeaForGenerate(idea) {
  if (!idea?.id) return;
  const map = readMap();
  map[idea.id] = { ...idea, _stashedAt: Date.now() };
  writeMap(map);
}

export function readStashedIdea(id) {
  if (!id) return null;
  const map = readMap();
  return map[id] || null;
}

// Convenience for callers that want to clear the slot once they've
// shown the drawer. Optional — leaving entries in place is fine since
// the LRU trim handles bloat.
export function clearStashedIdea(id) {
  if (!id) return;
  const map = readMap();
  if (!map[id]) return;
  delete map[id];
  writeMap(map);
}
