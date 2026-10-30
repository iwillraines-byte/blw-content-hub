// api/_cc-wiffle.js — the WIFFLE® view of the Command Center.
//
// WIFFLE® is tracked apart from the BLW team pages. Instead of one row per
// team, every connected social account (Instagram, TikTok, Facebook, X,
// LinkedIn, YouTube, Threads) is its own row with its own follower, views and
// interactions series.
//
// Which Metricool brand(s) count as WIFFLE®:
//   1. WIFFLE_BLOG_IDS env var (comma-separated), if set
//   2. otherwise any brand whose label contains "wiffle" that is not one of
//      the BLW teams or the BLW league page

import {
  TZ, TEAMS, BLW_BRAND, round, sum, sumVals, sumPairs, lastVal, nonEmpty,
  makeApi, dsum, diffs, mergeDicts, carrySum, slist, fmtPairs, loadProfiles,
  pickMetric, SAVE_KEYS, SHARE_KEYS,
} from './_cc-core.js';

export const WIFFLE_NETS = ["instagram", "tiktok", "facebook", "twitter", "linkedin", "youtube", "threads"];
export const NET_COLOR = { instagram: "#FF6FCF", tiktok: "#5CE0E0", facebook: "#5B8DEF", twitter: "#D7D9DE", linkedin: "#4FA3FF", youtube: "#FF5A5A", threads: "#B8A6FF" };
export const NET_LABEL = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", twitter: "X", linkedin: "LinkedIn", youtube: "YouTube", threads: "Threads" };
const NET_ALIAS = { x: "twitter", twitter: "twitter", linkedincompany: "linkedin", linkedin: "linkedin", instagram: "instagram", tiktok: "tiktok", facebook: "facebook", youtube: "youtube", threads: "threads" };
const normNet = n => NET_ALIAS[String(n || "").toLowerCase()] || String(n || "").toLowerCase();

export function findWiffleBrands(profiles) {
  const list = profiles._list || [];
  const envIds = String(process.env.WIFFLE_BLOG_IDS || "").split(/[,\s]+/).map(Number).filter(Boolean);
  if (envIds.length) {
    return envIds.map(id => {
      const b = list.find(x => Number(x.id) === id);
      // Unknown networks: try them all and drop the ones with no data.
      return b ? { ...b, guessNetworks: !Object.keys(b.networks || {}).length } : { id, label: "WIFFLE®", picture: null, networks: {}, guessNetworks: true };
    });
  }
  const exclude = new Set([...TEAMS.map(t => t.blogId), BLW_BRAND.blogId]);
  const teamWords = /big league|\bblw\b|wiffle club|saguaro|baller|harbor hawk|bats|panda|scorpion|naturals|mirage|green apple|orcas/i;
  return list.filter(b => !exclude.has(Number(b.id)) && /wiffle/i.test(b.label || "") && !teamWords.test(b.label || ""));
}

async function accountSeries(mc, b, net, from, to) {
  const { timeline: tl, firstTimeline: ft, legacyTimeline: lt } = mc;
  switch (net) {
    case "instagram": {
      const [f, v] = await Promise.all([ft(b, net, [["Followers", "account"], ["followers", "account"]], from, to), tl(b, net, "views", from, to, "account")]);
      return { followers: f.data, views: v };
    }
    case "tiktok": {
      const [f, v] = await Promise.all([tl(b, net, "followers_count", from, to, "account"), ft(b, net, [["views", "video"], ["views", undefined]], from, to)]);
      return { followers: f, views: v.data };
    }
    case "facebook": {
      const [f, v] = await Promise.all([tl(b, net, "pageFollows", from, to, "account"), tl(b, net, "page_media_view", from, to, "account")]);
      let views = v;
      if (!nonEmpty(v)) { const [r, i] = await Promise.all([tl(b, net, "blue_reels_play_count", from, to, "reels"), tl(b, net, "page_posts_impressions", from, to, "account")]); views = dsum(r, i); }
      return { followers: f, views };
    }
    case "twitter": {
      const [f, v] = await Promise.all([lt(b, net, "twitterFollowers", from, to), lt(b, net, "twImpressions", from, to)]);
      return { followers: f, views: v };
    }
    case "linkedin": {
      const [f, v] = await Promise.all([
        tl(b, net, "followers", from, to, undefined, { metricType: "account" }),
        tl(b, net, "companyImpressions", from, to, undefined, { metricType: "account" }),
      ]);
      return { followers: f, views: v };
    }
    case "youtube": {
      const [f, v] = await Promise.all([lt(b, net, "yttotalSubscribers", from, to), tl(b, net, "views", from, to, undefined, { postsType: "publishedInRange" })]);
      return { followers: f, views: v };
    }
    case "threads": {
      const [f, v] = await Promise.all([tl(b, net, "followers_count", from, to, "account"), tl(b, net, "views", from, to, "posts")]);
      return { followers: f, views: v };
    }
    default: return { followers: {}, views: {} };
  }
}

export async function buildWiffle(win, token, userId) {
  const { from, to, label } = win;
  const mc = makeApi(token, userId);
  const profiles = await loadProfiles(mc.api);
  const brands = findWiffleBrands(profiles);
  const base = { generatedAt: new Date().toISOString(), from, to, label, timezone: TZ };
  if (!brands.length) {
    return { ...base, configured: false, accounts: [], brandsSeen: (profiles._list || []).map(b => ({ id: b.id, label: b.label })) };
  }

  const accounts = [];
  await Promise.all(brands.map(async br => {
    const nets = br.guessNetworks ? WIFFLE_NETS : WIFFLE_NETS.filter(n => br.networks && br.networks[n]);
    const [resp, ...series] = await Promise.all([
      mc.api("/v2/analytics/brand-summary/posts", br.id, { from, to, timezone: TZ }),
      ...nets.map(n => accountSeries(mc, br.id, n, from, to)),
    ]);
    const posts = (resp && Array.isArray(resp.data)) ? resp.data : [];
    const byNet = {};
    for (const p of posts) (byNet[normNet(p.network)] = byNet[normNet(p.network)] || []).push(p);
    nets.forEach((net, i) => {
      const s = series[i];
      const list = byNet[net] || [];
      if (br.guessNetworks && !nonEmpty(s.followers) && !list.length) return;
      let inter = 0, imp = 0, engSum = 0, saves = 0, shares = 0;
      const interDaily = {}; const ranked = []; const fmt = {};
      for (const p of list) {
        const m = p.metrics || {};
        const x = Math.round(m.INTERACTIONS || 0), im = Math.round(m.IMPRESSIONS || 0), e = Number(m.ENGAGEMENT) || 0;
        const ty = String(p.type || "OTHER").toUpperCase();
        const dt = (p.publicationDate || {}).dateTime || "";
        inter += x; imp += im; engSum += e;
        saves += pickMetric(m, SAVE_KEYS).v; shares += pickMetric(m, SHARE_KEYS).v;
        const day = dt.slice(0, 10); if (day) interDaily[day] = (interDaily[day] || 0) + x;
        fmt[ty] = fmt[ty] || { count: 0, inter: 0, imp: 0, engSum: 0 };
        fmt[ty].count += 1; fmt[ty].inter += x; fmt[ty].imp += im; fmt[ty].engSum += e;
        ranked.push({ network: net, type: ty, text: (p.text || "").slice(0, 140), link: p.link, picture: p.picture || null, date: dt, interactions: x, impressions: im, engagement: round(e, 2) });
      }
      ranked.sort((a, b) => (b.interactions - a.interactions) || (b.impressions - a.impressions));
      const netNewSeries = diffs(s.followers);
      const followersNow = Math.round(lastVal(s.followers));
      const netNew = Math.round(sumVals(netNewSeries));
      const handle = br.networks && typeof br.networks[net] === "string" ? br.networks[net] : "";
      accounts.push({
        key: `${br.id}:${net}`, blogId: br.id, brandLabel: br.label || "WIFFLE®", network: net,
        name: NET_LABEL[net] || net, handle, color: NET_COLOR[net] || "#C4C9D2", picture: br.picture || null,
        followersNow, netNew, mom: followersNow ? round(netNew / followersNow * 100, 1) : 0,
        views: Math.round(sumVals(s.views)), interactions: inter, impressions: imp,
        engagementRate: list.length ? round(engSum / list.length, 2) : 0,
        saves: Math.round(saves), shares: Math.round(shares),
        contentCount: list.length,
        series: { followers: slist(s.followers), netNew: slist(netNewSeries), views: slist(s.views), interactions: slist(interDaily) },
        formats: fmt,
        topPosts: ranked.slice(0, 6).map(p => ({ ...p, accountKey: `${br.id}:${net}`, accent: NET_COLOR[net], account: NET_LABEL[net] })),
      });
    });
  }));
  accounts.sort((a, b) => b.followersNow - a.followersNow);

  const dict = (a, k) => Object.fromEntries(a.series[k].map(p => [p.d, p.v]));
  const fmtAll = {};
  for (const a of accounts) for (const [ty, f] of Object.entries(a.formats)) {
    const o = fmtAll[ty] || (fmtAll[ty] = { count: 0, inter: 0, imp: 0, engSum: 0 });
    o.count += f.count; o.inter += f.inter; o.imp += f.imp; o.engSum += f.engSum;
  }
  const fmtTotal = sum(Object.values(fmtAll).map(f => f.count)) || 1;
  const formatBreakdown = Object.entries(fmtAll).map(([type, f]) => ({
    type, count: f.count, share: round(f.count / fmtTotal * 100, 1), enough: f.count >= 2,
    avgInteractions: round(f.inter / f.count, 1), avgEngagement: round(f.engSum / f.count, 2),
  })).sort((a, b) => b.avgInteractions - a.avgInteractions);
  accounts.forEach(a => { delete a.formats; });

  const leaderboard = accounts.flatMap(a => a.topPosts).filter(p => p.interactions > 0 || p.impressions > 0)
    .sort((a, b) => (b.interactions - a.interactions) || (b.impressions - a.impressions)).slice(0, 12);

  return {
    ...base, configured: true,
    brands: brands.map(b => ({ blogId: b.id, label: b.label || "WIFFLE®", picture: b.picture || null })),
    accounts,
    totals: {
      followers: sum(accounts.map(a => a.followersNow)), netNew: sum(accounts.map(a => a.netNew)),
      views: sum(accounts.map(a => a.views)), interactions: sum(accounts.map(a => a.interactions)),
      impressions: sum(accounts.map(a => a.impressions)), content: sum(accounts.map(a => a.contentCount)),
      saves: sum(accounts.map(a => a.saves)), shares: sum(accounts.map(a => a.shares)),
    },
    network: {
      followers: fmtPairs(carrySum(accounts.map(a => dict(a, "followers")))),
      netNew: fmtPairs(mergeDicts(accounts.map(a => dict(a, "netNew")), "sum")),
      views: fmtPairs(mergeDicts(accounts.map(a => dict(a, "views")), "sum")),
    },
    leaderboard, formatBreakdown,
    dataAudit: { metrics: Object.entries(mc.audit).map(([key, a]) => ({ key, calls: a.calls, withData: a.withData })).sort((a, b) => a.key.localeCompare(b.key)) },
  };
}

export function redactWiffle(src) {
  const d = structuredClone(src);
  if (d.totals) delete d.totals.content;
  (d.accounts || []).forEach(a => { delete a.contentCount; });
  d.formatBreakdown = (d.formatBreakdown || []).map(({ count, ...f }) => f);
  delete d.dataAudit;
  delete d.brandsSeen;
  d.viewer = { isMaster: false };
  return d;
}
