// Single source of truth for "N ago" relative timestamps.
//
// Accepts an ISO string, a Date, or epoch milliseconds — so the same helper
// serves the download log (Date objects) and the media-usage leaderboard
// (ISO strings) without each caller hand-rolling its own copy. Output casing
// is normalized to lowercase ("just now").
export function timeAgo(value) {
  if (value == null || value === '') return '';
  const t = value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : new Date(value).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
