// api/_cc-player-page.js — lifetime content stats + career stats for one player.
//
// Content: every post on every tracked brand (the nine team accounts, the BLW
// league page, WIFFLE®) since tracking began (CC_LIFETIME_START, default
// 2026-01-01) that features the player — by manual tag from the post library
// first, caption matching otherwise. Rolled up by platform, by account and by
// month, with the top posts.
//
// Career: the player's season lines from Grand Slam Systems, the same source
// as BLW Studio's player pages.

import { norm, matchPlayers, TEAM_NAME, TEAM_ACCENT } from './_cc-players.js';
import { NAME_ALIASES_RAW } from '../src/roster-2026.js';
import { round } from './_cc-core.js';

const GSS = 'https://app.grandslamsystems.com/api';
const LEAGUE_ID = 3;

export function lifetimeStart() {
  const s = String(process.env.CC_LIFETIME_START || '2026-01-01');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '2026-01-01';
}

async function getJSON(url) {
  try { const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'BLW-Command-Center/1.0' } }); return r.ok ? await r.json() : null; } catch { return null; }
}
const careerMemo = { at: 0, seasons: null, stats: new Map() };
async function seasonStats() {
  if (careerMemo.seasons && Date.now() - careerMemo.at < 6 * 3600 * 1000) return careerMemo;
  const seasons = ((await getJSON(`${GSS}/leagues/${LEAGUE_ID}/seasons`)) || []).filter(s => s && s.id != null && s.year != null).sort((a, b) => b.year - a.year);
  const stats = new Map();
  await Promise.all(seasons.map(async s => {
    const [bat, pit] = await Promise.all([
      getJSON(`${GSS}/leagues/${LEAGUE_ID}/batting-stats?showAll=true&seasonId=${s.id}`),
      getJSON(`${GSS}/leagues/${LEAGUE_ID}/pitching-stats?showAll=true&seasonId=${s.id}`),
    ]);
    stats.set(s.id, { batting: (bat && bat.statistics) || [], pitching: (pit && pit.statistics) || [] });
  }));
  careerMemo.seasons = seasons; careerMemo.stats = stats; careerMemo.at = Date.now();
  return careerMemo;
}
async function career(name) {
  const wanted = new Set([norm(name)]);
  for (const [alias, canon] of Object.entries(NAME_ALIASES_RAW)) if (norm(canon) === norm(name)) wanted.add(norm(alias));
  const { seasons, stats } = await seasonStats();
  const out = [];
  for (const s of seasons || []) {
    const st = stats.get(s.id) || { batting: [], pitching: [] };
    const b = st.batting.find(r => wanted.has(norm(r.playerName)));
    const p = st.pitching.find(r => wanted.has(norm(r.playerName)));
    if (!b && !p) continue;
    out.push({
      year: s.year, active: !!s.isActive,
      batting: b ? { g: b.games, pa: b.plateAppearances, avg: b.battingAverage, obp: b.onBasePercentage, slg: b.sluggingPercentage, ops: b.ops, opsPlus: b.opsPlus, hr: b.homeruns || 0, rbi: b.rbi || 0, team: b.team && b.team.abbreviation } : null,
      pitching: p ? { g: p.games, ip: p.inningsPitched, era: p.era, fip: p.fip, whip: p.whip, k: p.strikeouts ?? p.strikeoutsThrown ?? 0, w: p.wins || 0, l: p.losses || 0, team: p.team && p.team.abbreviation } : null,
    });
  }
  return out;
}

export async function playerLifetime(name, lib, dir, tags) {
  const p = dir.find(x => norm(x.name) === norm(name));
  if (!p) return { error: 'Unknown player', status: 404 };
  const tp = tags.players || {};
  const bById = Object.fromEntries((lib.brands || []).map(b => [String(b.blogId), b]));
  const posts = (lib.posts || []).filter(post => (tp[post.key] || matchPlayers(post.text, dir, post.teamId)).includes(p.name));
  const byNet = {}, byBrand = {}, monthly = {};
  let views = 0, inter = 0, engSum = 0;
  for (const post of posts) {
    views += post.impressions; inter += post.interactions; engSum += post.engagement || 0;
    const n = byNet[post.network] || (byNet[post.network] = { views: 0, interactions: 0 }); n.views += post.impressions; n.interactions += post.interactions;
    const br = bById[String(post.blogId)] || { name: '?', accent: '#888' };
    const b = byBrand[br.name] || (byBrand[br.name] = { name: br.name, accent: br.accent, picture: br.picture || null, views: 0, interactions: 0 }); b.views += post.impressions; b.interactions += post.interactions;
    const m = (post.date || '').slice(0, 7); if (m) { const mm = monthly[m] || (monthly[m] = { m, views: 0, interactions: 0 }); mm.views += post.impressions; mm.interactions += post.interactions; }
  }
  // Best platform per creative, so a cross-posted clip shows once.
  const seenGroup = new Set();
  const top = [...posts].sort((a, b) => (b.interactions - a.interactions) || (b.impressions - a.impressions))
    .filter(post => { const g = post.autoGroup || post.key; if (seenGroup.has(g)) return false; seenGroup.add(g); return true; })
    .slice(0, 8).map(post => {
    const br = bById[String(post.blogId)] || {};
    return { network: post.network, type: post.type, text: post.text.slice(0, 160), link: post.link, picture: post.picture, date: post.date, impressions: post.impressions, interactions: post.interactions, engagement: post.engagement, brand: br.name, accent: br.accent, brandPicture: br.picture || null };
  });
  return {
    player: { name: p.name, team: p.team, teamName: TEAM_NAME[p.team] || p.team, accent: TEAM_ACCENT[p.team] || '#C4C9D2', num: p.num, nickname: p.nickname || '', handle: p.handle || '', aliases: p.aliases || [] },
    window: { from: lib.from, to: lib.to, start: lifetimeStart() },
    content: {
      views, interactions: inter, engagement: posts.length ? round(engSum / posts.length, 2) : 0,
      byPlatform: byNet,
      byAccount: Object.values(byBrand).sort((a, b) => b.views - a.views),
      monthly: Object.values(monthly).sort((a, b) => a.m.localeCompare(b.m)),
      topPosts: top,
      featured: posts.length > 0,
    },
    career: await career(p.name),
  };
}
