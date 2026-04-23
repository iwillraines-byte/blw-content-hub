// Lightweight daily AI usage counter — persisted to localStorage so a page
// refresh doesn't wipe the running tally. Resets at midnight local time.
// Today this only tracks /api/ideas calls (the dashboard content ideas
// button), but the shape is a Map<string, number> so auto-tag + any future
// endpoints can share it later.
//
// Cost ballpark at today's Haiku 4.5 pricing:
//   - First ideas call of the day:  ~$0.003 (cache miss)
//   - Cached subsequent calls:     ~$0.0005 (prompt cache hit)
//   - Auto-tag per image:          ~$0.002
// So a counter of 50 ideas + 100 auto-tags ≈ $0.25/day.

const LS_KEY = 'blw_ai_usage_v1';

function todayKey() {
  // Local-time day bucket — YYYY-MM-DD
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readAll() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeAll(all) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(all || {})); }
  catch {}
}

// Returns today's counter map { ideas: N, autoTag: N, ... }. Missing keys = 0.
export function getUsageToday() {
  const all = readAll();
  return all[todayKey()] || {};
}

// Increment a usage key by `n` (default 1). Safe to call anywhere.
export function recordUsage(kind, n = 1) {
  if (!kind || n <= 0) return;
  const all = readAll();
  const key = todayKey();
  const today = all[key] || {};
  today[kind] = (today[kind] || 0) + n;
  all[key] = today;
  // Keep only the last 14 days of records so this never grows unbounded.
  const keys = Object.keys(all).sort();
  while (keys.length > 14) {
    delete all[keys.shift()];
  }
  writeAll(all);
}

// Sum of all counts today — handy for a single "AI calls today" chip.
export function totalUsageToday() {
  const today = getUsageToday();
  return Object.values(today).reduce((a, b) => a + (b || 0), 0);
}
