// ─── Idea-generation context builders (v4.14.0) ─────────────────────────────
// Assembles the NEW data sources fed to /api/ideas alongside the stat tables:
//
//   buildRecentResults()  — final scores from the last 14 days (GSS feed)
//   buildUpcomingSlate()  — the next game day from the static schedule
//   buildPhotoInventory() — tagged-photo counts per player/team (media store)
//   buildPostingCadence() — days-since-last-post + monthly count per team
//
// Every builder soft-fails to null: the server prompt tolerates any missing
// block, so a feed outage degrades idea quality instead of breaking the
// Generate button. All four run client-side because that's where the caches
// already live (games feed, IndexedDB media, generate_log fetch helper).

import { fetchGames, SEASON_START, TEAMS } from './data';
import { SCHEDULE } from './schedule-data';
import { getAllMedia, parseFilename } from './media-store';
import { fetchRecentGenerates } from './cloud-sync';

const DAY_MS = 24 * 60 * 60 * 1000;

function todayLocalISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// SUBMITTED games from the last 14 days, newest first, capped at 12.
// Games within the last 7 days carry thisWeek: true so the prompt can
// rank them as the freshest storylines.
export async function buildRecentResults() {
  try {
    const games = await fetchGames();
    const cutoff = Date.now() - 14 * DAY_MS;
    const weekCutoff = Date.now() - 7 * DAY_MS;
    const finals = (games || [])
      .filter(g => g.status === 'SUBMITTED')
      .filter(g => (g.dateTime || '').slice(0, 10) >= SEASON_START)
      .filter(g => {
        const t = new Date(g.dateTime).getTime();
        return Number.isFinite(t) && t >= cutoff;
      })
      .filter(g => g.home?.teamId && g.away?.teamId) // BLW vs BLW only
      .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime))
      .slice(0, 12)
      .map(g => ({
        date: (g.dateTime || '').slice(0, 10),
        home: g.home.teamId, homeScore: g.home.score,
        away: g.away.teamId, awayScore: g.away.score,
        thisWeek: new Date(g.dateTime).getTime() >= weekCutoff,
      }));
    return finals.length ? finals : null;
  } catch { return null; }
}

// The next game day on/after today: date, days until, and the matchup list.
export function buildUpcomingSlate() {
  try {
    const today = todayLocalISO();
    const next = (SCHEDULE || []).find(day => day.date >= today);
    if (!next) return null;
    const daysUntil = Math.max(0, Math.round(
      (new Date(`${next.date}T00:00:00`) - new Date(`${today}T00:00:00`)) / DAY_MS
    ));
    return {
      date: next.date,
      daysUntil,
      venue: next.venue || '',
      games: (next.games || []).slice(0, 10).map(g => ({
        time: g.time, team1: g.team1, team2: g.team2,
      })),
    };
  } catch { return null; }
}

// Asset-type counts per player and per team, keyed the same way the server
// keys athlete voices (TEAM|FI|LASTNAME with a TEAM|LASTNAME fallback when
// no initial is in the filename; team-scoped assets land on TEAM|_team).
export async function buildPhotoInventory() {
  try {
    const all = await getAllMedia();
    if (!all?.length) return null;
    const inv = {};
    for (const m of all) {
      const p = parseFilename(m.name);
      if (!p?.team) continue;
      let key = null;
      if (p.scope === 'player' && p.player) {
        key = p.firstInitial
          ? `${p.team}|${p.firstInitial}|${p.player}`
          : `${p.team}|${p.player}`;
      } else if (p.scope === 'team') {
        key = `${p.team}|_team`;
      } else {
        continue; // league assets aren't useful for per-idea gating
      }
      const type = p.assetType || 'FILE';
      const bucket = (inv[key] = inv[key] || {});
      bucket[type] = (bucket[type] || 0) + 1;
    }
    return Object.keys(inv).length ? inv : null;
  } catch { return null; }
}

// Per-team posting cadence from the generate log: how many days since the
// team last had a posted graphic, and how many posts this calendar month.
// One round trip (the last 100 generates) covers all 10 teams.
export async function buildPostingCadence() {
  try {
    const posts = await fetchRecentGenerates(100);
    if (!posts) return null;
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const byTeam = new Map();
    for (const p of posts) {
      if (!p.team || !p.posted || !p.createdAt) continue;
      const t = p.createdAt.getTime?.() ?? new Date(p.createdAt).getTime();
      if (!Number.isFinite(t)) continue;
      const cur = byTeam.get(p.team) || { lastAt: 0, monthCount: 0 };
      if (t > cur.lastAt) cur.lastAt = t;
      if (t >= monthStart) cur.monthCount++;
      byTeam.set(p.team, cur);
    }
    const out = TEAMS.map(t => {
      const c = byTeam.get(t.id);
      return {
        team: t.id,
        daysSince: c?.lastAt ? Math.floor((Date.now() - c.lastAt) / DAY_MS) : null, // null = never posted
        monthCount: c?.monthCount || 0,
      };
    });
    return out;
  } catch { return null; }
}
