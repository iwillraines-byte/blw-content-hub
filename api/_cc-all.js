// "All BLW" view: the nine team accounts and the BLW league page on one
// scoreboard. Built from the same cached league and league-page payloads the
// other tabs use, so the numbers always match what those tabs show.
import { round, sum, carrySum, mergeDicts, fmtPairs } from './_cc-core.js';

// The league page's own green sits too close to Miami's teal in a stacked
// chart, so it gets a color no team uses.
export const ALL_LEAGUE_COLOR = "#FF6FCF";

const dictOf = arr => Object.fromEntries((arr || []).map(p => [p.d, p.v]));

export function buildAll(L, B) {
  const page = B && B.configured ? B : null;
  // Per-platform numbers for every brand, so All BLW can show Instagram,
  // TikTok and Facebook side by side.
  const NETK = { instagram: "ig", tiktok: "tt", facebook: "fb" };
  const teamPlat = t => Object.fromEntries(["ig", "tt", "fb"].map(k => [k, {
    followers: (t.followersByNetwork || {})[k] || 0, views: ((t.byPlatform || {}).views || {})[k] || 0,
    interactions: ((t.byPlatform || {}).interactions || {})[k] || 0, impressions: (t.impressionsByPlatform || {})[k] || 0,
  }]));
  const pagePlat = accts => { const o = { ig: null, tt: null, fb: null };
    for (const a of accts || []) { const k = NETK[a.network]; if (!k) continue; o[k] = { followers: a.followersNow || 0, views: a.views || 0, interactions: a.interactions || 0, impressions: a.impressions || 0 }; }
    for (const k of Object.keys(o)) if (!o[k]) o[k] = { followers: 0, views: 0, interactions: 0, impressions: 0, missing: true };
    return o; };
  const teams = L.teams.map(t => ({
    platforms: teamPlat(t),
    key: String(t.blogId), kind: "team", blogId: t.blogId, name: t.name, accent: t.accent, picture: t.picture || null,
    followers: t.followersNow || 0, netNew: t.netNew || 0, views: t.views || 0, interactions: t.interactions || 0,
    impressions: t.impressions || 0, saves: t.saves || 0, shares: t.shares || 0,
    series: { followers: t.series.followers, netNew: t.series.netNew, views: t.series.views },
  }));
  const brands = [...teams];
  if (page) {
    const T = page.totals;
    brands.push({
      platforms: pagePlat(page.accounts),
      key: "blw", kind: "league", blogId: (page.brands[0] || {}).blogId || null, name: "BLW League Page", accent: ALL_LEAGUE_COLOR,
      picture: (page.brands[0] || {}).picture || (L.blw && L.blw.picture) || null,
      followers: T.followers || 0, netNew: T.netNew || 0, views: T.views || 0, interactions: T.interactions || 0,
      impressions: T.impressions || 0, saves: T.saves || 0, shares: T.shares || 0,
      series: { followers: page.network.followers, netNew: page.network.netNew, views: page.network.views },
    });
  }
  const tot = list => ({
    followers: sum(list.map(b => b.followers)), netNew: sum(list.map(b => b.netNew)), views: sum(list.map(b => b.views)),
    interactions: sum(list.map(b => b.interactions)), impressions: sum(list.map(b => b.impressions)),
    saves: sum(list.map(b => b.saves)), shares: sum(list.map(b => b.shares)),
  });
  const totals = tot(brands);
  const platTot = list => Object.fromEntries(["ig", "tt", "fb"].map(k => [k, Object.fromEntries(["followers", "views", "interactions", "impressions"].map(m => [m, sum(list.map(b => b.platforms[k][m]))]))]));
  const platforms = { all: platTot(brands), teams: platTot(teams), league: page ? platTot(brands.slice(teams.length)) : null };
  const split = { teams: tot(teams), league: page ? tot(brands.slice(teams.length)) : null };

  const sd = k => brands.map(b => dictOf(b.series[k]));
  const network = {
    followers: fmtPairs(carrySum(sd("followers"))),
    netNew: fmtPairs(mergeDicts(sd("netNew"), "sum")),
    views: fmtPairs(mergeDicts(sd("views"), "sum")),
  };

  // Top posts across every brand.
  const teamPics = Object.fromEntries(teams.map(t => [t.blogId, t.picture]));
  const leagueTop = (L.leaderboard || []).map(p => ({ ...p, brandKey: String(p.blogId), brandName: p.team, brandAccent: p.accent, brandPicture: teamPics[p.blogId] || null }));
  const pageTop = page ? (page.leaderboard || []).map(p => ({ ...p, brandKey: "blw", brandName: "BLW League Page", brandAccent: ALL_LEAGUE_COLOR, brandPicture: brands[brands.length - 1].picture, accent: ALL_LEAGUE_COLOR })) : [];
  const leaderboard = [...leagueTop, ...pageTop].filter(p => p.interactions > 0 || p.impressions > 0)
    .sort((a, b) => (b.interactions - a.interactions) || (b.impressions - a.impressions)).slice(0, 12);

  // Formats across every brand, weighted by post count (counts are stripped
  // before this leaves the server for non-masters).
  const fmt = {};
  const addFmt = list => (list || []).forEach(f => {
    if (!f.count) return;
    const o = fmt[f.type] || (fmt[f.type] = { count: 0, inter: 0, engSum: 0 });
    o.count += f.count; o.inter += f.interactions != null ? f.interactions : f.avgInteractions * f.count;
    o.engSum += (f.avgEngagement || 0) * f.count;
  });
  addFmt(L.formatBreakdown);
  if (page) addFmt(page.formatBreakdown);
  const fTot = sum(Object.values(fmt).map(f => f.count)) || 1;
  const formatBreakdown = Object.entries(fmt).map(([type, f]) => ({
    type, count: f.count, share: round(f.count / fTot * 100, 1), enough: f.count >= 2,
    avgInteractions: round(f.inter / f.count, 1), avgEngagement: round(f.engSum / f.count, 2),
  })).sort((a, b) => b.avgInteractions - a.avgInteractions);

  // Each team's own posts plus the league-page posts credited to it.
  const attr = Object.fromEntries(((L.blw && L.blw.attribution) || []).map(a => [a.team, a]));
  const credit = teams.map(t => {
    const a = attr[t.name] || { impressions: 0, interactions: 0 };
    return { key: t.key, blogId: t.blogId, name: t.name, accent: t.accent, picture: t.picture,
      own: { impressions: t.impressions, interactions: t.interactions },
      credited: { impressions: a.impressions || 0, interactions: a.interactions || 0 } };
  }).sort((a, b) => (b.own.impressions + b.credited.impressions) - (a.own.impressions + a.credited.impressions));

  return {
    generatedAt: new Date().toISOString(), from: L.from, to: L.to, label: L.label, days: L.days, range: L.range,
    configured: true, leaguePage: !!page, leagueColor: ALL_LEAGUE_COLOR,
    brands, totals, split, platforms, network, leaderboard, formatBreakdown, credit,
    leagueCredit: L.blw ? { unattributedPct: L.blw.unattributedPct || 0, impressions: L.blw.impressions || 0, interactions: L.blw.interactions || 0 } : null,
  };
}

export function redactAll(src) {
  const d = structuredClone(src);
  d.formatBreakdown = (d.formatBreakdown || []).map(({ count, ...f }) => f);
  d.viewer = { isMaster: false };
  return d;
}
