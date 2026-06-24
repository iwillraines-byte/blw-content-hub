// api/metricool.js — BLW Command Center data API (Vercel serverless function).
//
// Pulls live Metricool data server-side and returns computed league metrics.
// Secrets come from env vars and are NEVER exposed to the browser:
//   METRICOOL_TOKEN     (server-only — like SUPABASE_SERVICE_ROLE_KEY)
//   METRICOOL_USER_ID
//
// Response is cached at the edge for 5 min (s-maxage); the dashboard's
// Refresh button appends a cache-busting param to force a fresh pull.

import { requireUser, requireRole } from './_supabase.js';

const BASE = "https://app.metricool.com/api";
const TZ = "America/Chicago";
const NETMAP = { instagram: "ig", tiktok: "tt", facebook: "fb" };

const TEAMS = [
  { blogId: 6201154, name: "Arizona Saguaros",         accent: "#C7F24E" },
  { blogId: 6201162, name: "Atlanta Ballers",          accent: "#9AD1FF" },
  { blogId: 6201165, name: "Boston Harbor Hawks",      accent: "#DAC79C" },
  { blogId: 6201157, name: "Chicago Bats",             accent: "#C0162B" },
  { blogId: 6201149, name: "Dallas Pandas",            accent: "#E8B53A" },
  { blogId: 6201166, name: "Las Vegas Scorpions",      accent: "#C4C9D2" },
  { blogId: 6201159, name: "Los Angeles Naturals",     accent: "#2E63E8" },
  { blogId: 6200089, name: "Miami Mirage",             accent: "#79E6C2" },
  { blogId: 6201828, name: "Philadelphia Wiffle Club", accent: "#34489E" },
];

function round(v, nd = 0) { const f = Math.pow(10, nd); return Math.round((Number(v) || 0) * f) / f; }
const sum = a => a.reduce((x, y) => x + y, 0);
const sumVals = d => Object.values(d).reduce((a, b) => a + b, 0);
const sumPairs = a => a.reduce((x, p) => x + p[1], 0);
const cap = s => { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); };
const pad = n => String(n).padStart(2, "0");
const lastVal = d => { const ks = Object.keys(d).sort(); return ks.length ? d[ks[ks.length - 1]] : 0; };

function offsetStr(d) {
  try {
    const v = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
      .formatToParts(d).find(p => p.type === "timeZoneName").value;
    const m = v.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
    if (!m) return "+00:00";
    const sign = m[1][0];
    const hh = pad(Math.abs(parseInt(m[1], 10)));
    return `${sign}${hh}:${m[2] || "00"}`;
  } catch (e) { return "+00:00"; }
}
function tzParts(d) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}
const isoUTC = d => d.toISOString().replace(/\.\d{3}Z$/, "+00:00");
const monLabel = (y, m) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 15)));

function windowRange(days, rng) {
  const now = new Date();
  if (rng === "mtd") {
    const p = tzParts(now);
    const off = offsetStr(new Date(Date.UTC(p.y, p.m - 1, 1, 6)));
    return { from: `${p.y}-${pad(p.m)}-01T00:00:00${off}`, to: isoUTC(now), label: monLabel(p.y, p.m) + " MTD" };
  }
  if (rng === "prev_month") {
    const p = tzParts(now); let py = p.y, pm = p.m - 1; if (pm < 1) { pm = 12; py--; }
    const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    const offS = offsetStr(new Date(Date.UTC(py, pm - 1, 1, 6)));
    const offE = offsetStr(new Date(Date.UTC(py, pm - 1, lastDay, 6)));
    return { from: `${py}-${pad(pm)}-01T00:00:00${offS}`, to: `${py}-${pad(pm)}-${pad(lastDay)}T23:59:59${offE}`, label: monLabel(py, pm) };
  }
  const d = days || 30;
  return { from: isoUTC(new Date(Date.now() - d * 86400000)), to: isoUTC(now), label: d + "D" };
}

function makeApi(token, userId) {
  async function api(path, blogId, params = {}) {
    const q = new URLSearchParams({ userId: String(userId) });
    if (blogId !== "" && blogId != null) q.set("blogId", String(blogId));
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v);
    try {
      const r = await fetch(`${BASE}${path}?${q.toString()}`, { headers: { "X-Mc-Auth": token, "Accept": "application/json" } });
      if (!r.ok) return { _error: r.status };
      return await r.json();
    } catch (e) { return { _error: "ERR", _detail: String(e).slice(0, 200) }; }
  }
  async function timeline(blogId, network, metric, from, to, subject) {
    const d = await api("/v2/analytics/timelines", blogId, { network, metric, from, to, timezone: TZ, subject });
    const out = {};
    if (d && d.data && d.data[0] && Array.isArray(d.data[0].values)) {
      for (const v of d.data[0].values) {
        const day = (v.dateTime || "").slice(0, 10); const val = Number(v.value);
        if (day && Number.isFinite(val)) out[day] = val;
      }
    }
    return out;
  }
  return { api, timeline };
}

function dsum(...dicts) { const o = {}; for (const d of dicts) for (const k in d) o[k] = (o[k] || 0) + d[k]; return o; }
function diffs(cum) { const ks = Object.keys(cum).sort(); const o = {}; for (let i = 1; i < ks.length; i++) o[ks[i]] = cum[ks[i]] - cum[ks[i - 1]]; return o; }
function mergeDicts(dicts, how) {
  const keys = new Set(); dicts.forEach(d => Object.keys(d).forEach(k => keys.add(k)));
  const out = [];
  [...keys].sort().forEach(day => {
    const vals = dicts.filter(d => day in d).map(d => d[day]); if (!vals.length) return;
    out.push([day, how === "mean" ? sum(vals) / vals.length : sum(vals)]);
  });
  return out;
}
function carrySum(dicts) {
  const keys = new Set(); dicts.forEach(d => Object.keys(d).forEach(k => keys.add(k)));
  const last = new Array(dicts.length).fill(null); const out = [];
  [...keys].sort().forEach(day => {
    let total = 0, seen = false;
    dicts.forEach((d, i) => { if (day in d) last[i] = d[day]; if (last[i] != null) { total += last[i]; seen = true; } });
    if (seen) out.push([day, total]);
  });
  return out;
}
const slist = (d, nd = 0) => Object.keys(d).sort().map(k => ({ d: k, v: nd ? round(d[k], nd) : Math.round(d[k]) }));
const fmtPairs = s => s.map(p => ({ d: p[0], v: round(p[1], 2) }));

async function loadProfiles(api) {
  const data = await api("/admin/simpleProfiles", "", {});
  const prof = {};
  if (Array.isArray(data)) {
    for (const b of data) {
      const h = {}; for (const net of ["instagram", "tiktok", "facebook"]) if (b[net]) h[net] = b[net];
      prof[b.id] = { picture: b.picture || null, handles: h };
    }
  }
  return prof;
}

async function buildTeam(t, from, to, profiles, api, tl) {
  const b = t.blogId;
  const [ig_f, ig_views, ig_eng, tt_f, tt_views, tt_eng, fb_f, fb_eng, fb_mv, fb_reels, resp] = await Promise.all([
    tl(b, "instagram", "Followers", from, to, "account"),
    tl(b, "instagram", "views", from, to, "account"),
    tl(b, "instagram", "engagement", from, to, "posts"),
    tl(b, "tiktok", "followers_count", from, to, "account"),
    tl(b, "tiktok", "views", from, to, "video"),
    tl(b, "tiktok", "engagement", from, to, "video"),
    tl(b, "facebook", "pageFollows", from, to, "account"),
    tl(b, "facebook", "engagement", from, to, undefined),
    tl(b, "facebook", "page_media_view", from, to, "account"),
    tl(b, "facebook", "blue_reels_play_count", from, to, undefined),
    api("/v2/analytics/brand-summary/posts", b, { from, to, timezone: TZ }),
  ]);
  const fb_views = dsum(fb_mv, fb_reels);
  const posts = (resp && Array.isArray(resp.data)) ? resp.data : [];

  const fol = { ig: lastVal(ig_f), tt: lastVal(tt_f), fb: lastVal(fb_f) };
  const followers_series = carrySum([ig_f, tt_f, fb_f]);
  const netnew_series = mergeDicts([diffs(ig_f), diffs(tt_f), diffs(fb_f)], "sum");
  const views_series = mergeDicts([ig_views, tt_views, fb_views], "sum");
  const eng_series = mergeDicts([ig_eng, tt_eng, fb_eng], "mean");

  const inter_by = { ig: 0, tt: 0, fb: 0 }, posts_by = { ig: 0, tt: 0, fb: 0 }, posts_daily = { ig: {}, tt: {}, fb: {} };
  const inter_daily = { ig: {}, tt: {}, fb: {} };
  const posts_list = { ig: [], tt: [], fb: [] };
  const ranked = [];
  for (const p of posts) {
    const net = NETMAP[p.network]; const m = p.metrics || {};
    const inter = Math.round(m.INTERACTIONS || 0);
    const dt = (p.publicationDate || {}).dateTime || "";
    if (net) {
      inter_by[net] += (m.INTERACTIONS || 0); posts_by[net] += 1;
      const day = dt.slice(0, 10);
      if (day) { posts_daily[net][day] = (posts_daily[net][day] || 0) + 1; inter_daily[net][day] = (inter_daily[net][day] || 0) + (m.INTERACTIONS || 0); }
      posts_list[net].push({ date: dt, text: (p.text || "").slice(0, 140), link: p.link, interactions: inter });
    }
    ranked.push({
      network: p.network, text: (p.text || "").slice(0, 160), link: p.link,
      date: dt,
      interactions: inter, engagement: round(m.ENGAGEMENT || 0, 2), impressions: Math.round(m.IMPRESSIONS || 0),
    });
  }
  for (const net of ["ig", "tt", "fb"]) posts_list[net].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  ranked.sort((a, b2) => (b2.interactions - a.interactions) || (b2.impressions - a.impressions));

  const prof = profiles[b] || {};
  return {
    blogId: b, name: t.name, accent: t.accent, picture: prof.picture || null, handles: prof.handles || {},
    followersNow: Math.round(fol.ig + fol.tt + fol.fb),
    followersByNetwork: { ig: Math.round(fol.ig), tt: Math.round(fol.tt), fb: Math.round(fol.fb) },
    netNew: Math.round(sumPairs(netnew_series)),
    views: Math.round(sumPairs(views_series)),
    engagementRate: eng_series.length ? round(sumPairs(eng_series) / eng_series.length, 2) : 0,
    interactions: Math.round(inter_by.ig + inter_by.tt + inter_by.fb),
    contentCount: posts.length,
    byPlatform: {
      followers: { ig: Math.round(fol.ig), tt: Math.round(fol.tt), fb: Math.round(fol.fb) },
      views: { ig: Math.round(sumVals(ig_views)), tt: Math.round(sumVals(tt_views)), fb: Math.round(sumVals(fb_views)) },
      interactions: { ig: Math.round(inter_by.ig), tt: Math.round(inter_by.tt), fb: Math.round(inter_by.fb) },
      posts: posts_by,
    },
    series: {
      followers: slist(Object.fromEntries(followers_series)),
      netNew: slist(Object.fromEntries(netnew_series)),
      views: slist(Object.fromEntries(views_series)),
      engagement: slist(Object.fromEntries(eng_series), 2),
    },
    seriesByPlatform: {
      followers: { ig: slist(ig_f), tt: slist(tt_f), fb: slist(fb_f) },
      views: { ig: slist(ig_views), tt: slist(tt_views), fb: slist(fb_views) },
      engagement: { ig: slist(ig_eng, 2), tt: slist(tt_eng, 2), fb: slist(fb_eng, 2) },
      interactions: { ig: slist(inter_daily.ig), tt: slist(inter_daily.tt), fb: slist(inter_daily.fb) },
      posts: { ig: slist(posts_daily.ig), tt: slist(posts_daily.tt), fb: slist(posts_daily.fb) },
    },
    postsList: posts_list,
    topPosts: ranked.slice(0, 3),
  };
}

function buildInsights(teams, label) {
  const out = [];
  const top = [...teams].sort((a, b) => b.netNew - a.netNew)[0];
  out.push({ kind: "Double down", team: top.name, accent: top.accent, title: "Double down on " + top.name,
    detail: `Biggest grower in ${label}: +${top.netNew.toLocaleString()} net followers, about ${Math.round(top.mom)}% of its base. It is converting attention into follows faster than the league, so it earns more weekly slots and budget.` });

  const allposts = []; teams.forEach(tm => tm.topPosts.forEach(p => { if (p.interactions) allposts.push([tm, p]); }));
  let best = null;
  if (allposts.length) {
    best = allposts.reduce((a, b) => (b[1].interactions > a[1].interactions || (b[1].interactions === a[1].interactions && b[1].impressions > a[1].impressions)) ? b : a);
    const tm = best[0], p = best[1];
    out.push({ kind: "Amplify", team: tm.name, accent: tm.accent, title: tm.name + "'s top post is the format to repeat",
      detail: `Best post in ${label}: ${p.interactions.toLocaleString()} interactions on ${p.impressions.toLocaleString()} impressions (${cap(p.network)}). This hook is working, so put paid behind it.`,
      post: { text: p.text, link: p.link, network: p.network } });
  }
  const laggards = teams.filter(t => t.netNew <= 0 || t.mom < 5);
  if (best) {
    const bt = best[0]; const nlag = laggards.length || (teams.length - 1);
    out.push({ kind: "Repurpose", team: bt.name, accent: "#FF6FCF", title: "Turn the breakout into Reels + Shorts for the rest",
      detail: `Re-cut ${bt.name}'s winning angle into 15-30s vertical clips for the ${nlag} teams without a hit this period. Add bold on-screen captions; most social video is watched on mute.` });
  }
  const engPool = teams.filter(t => t.engagementRate > 0 && t.contentCount >= 5);
  if (engPool.length) {
    const low = engPool.reduce((a, b) => b.engagementRate < a.engagementRate ? b : a);
    out.push({ kind: "Hook test", team: low.name, accent: low.accent, title: "Fix " + low.name + " with a stronger hook",
      detail: `Reach is fine but engagement lags at ${low.engagementRate.toFixed(2)}% on ${low.contentCount} posts. Test a curiosity hook ('The real reason ...') or a question CTA in the first line to lift comments, which weigh more than likes.` });
    const high = engPool.reduce((a, b) => b.engagementRate > a.engagementRate ? b : a);
    out.push({ kind: "Model it", team: high.name, accent: high.accent, title: high.name + " is the engagement benchmark",
      detail: `Top engagement rate in the league at ${high.engagementRate.toFixed(2)}%. Reverse-engineer its hooks and post structure and templatize them for the other eight teams.` });
  }
  const lowC = teams.reduce((a, b) => b.contentCount < a.contentCount ? b : a);
  out.push({ kind: "Cadence", team: lowC.name, accent: lowC.accent, title: lowC.name + " is under-posting",
    detail: `Only ${lowC.contentCount} posts in ${label}, the thinnest cadence in the league. For accounts this early, volume is the cheapest growth lever, so batch a week of content and aim for 1-2 posts/day before any spend.` });

  const arr = [["Facebook", sum(teams.map(t => t.byPlatform.posts.fb))], ["Instagram", sum(teams.map(t => t.byPlatform.posts.ig))], ["TikTok", sum(teams.map(t => t.byPlatform.posts.tt))]];
  const thin = arr.reduce((a, b) => b[1] < a[1] ? b : a), fat = arr.reduce((a, b) => b[1] > a[1] ? b : a);
  if (fat[1] && thin[1] < fat[1]) {
    out.push({ kind: "Cross-post", team: "League", accent: "#5B8DEF", title: `Close the ${thin[0]} gap`,
      detail: `Across the league this window: ${fat[1]} posts on ${fat[0]} vs only ${thin[1]} on ${thin[0]}. Mirror the top ${fat[0]} cuts to ${thin[0]} to reclaim that reach for free.` });
  }
  return out;
}

export async function compute(days, rng, token, userId) {
  const { from, to, label } = windowRange(days, rng);
  const { api, timeline } = makeApi(token, userId);
  const profiles = await loadProfiles(api);
  const teams = await Promise.all(TEAMS.map(t => buildTeam(t, from, to, profiles, api, timeline)));
  teams.forEach(tm => { tm.mom = tm.followersNow ? round(tm.netNew / tm.followersNow * 100, 1) : 0; });

  const sd = key => teams.map(tm => Object.fromEntries(tm.series[key].map(p => [p.d, p.v])));
  const posts_by_platform = { ig: {}, tt: {}, fb: {} };
  const views_by_platform = { ig: {}, tt: {}, fb: {} };
  const inter_by_platform = { ig: {}, tt: {}, fb: {} };
  const totals_platform = { followers: { ig: 0, tt: 0, fb: 0 }, views: { ig: 0, tt: 0, fb: 0 }, interactions: { ig: 0, tt: 0, fb: 0 }, posts: { ig: 0, tt: 0, fb: 0 } };
  for (const tm of teams) {
    for (const net of ["ig", "tt", "fb"]) {
      for (const p of tm.seriesByPlatform.posts[net]) posts_by_platform[net][p.d] = (posts_by_platform[net][p.d] || 0) + p.v;
      for (const p of tm.seriesByPlatform.views[net]) views_by_platform[net][p.d] = (views_by_platform[net][p.d] || 0) + p.v;
      for (const p of tm.seriesByPlatform.interactions[net]) inter_by_platform[net][p.d] = (inter_by_platform[net][p.d] || 0) + p.v;
      for (const m of ["followers", "views", "interactions", "posts"]) totals_platform[m][net] += tm.byPlatform[m][net];
    }
  }
  const dailyByPlat = obj => Object.fromEntries(["ig", "tt", "fb"].map(net => [net, Object.keys(obj[net]).sort().map(k => ({ d: k, v: obj[net][k] }))]));
  return {
    generatedAt: new Date().toISOString(), from, to, label, days, range: rng, timezone: TZ,
    totals: {
      followers: sum(teams.map(t => t.followersNow)), views: sum(teams.map(t => t.views)),
      interactions: sum(teams.map(t => t.interactions)), content: sum(teams.map(t => t.contentCount)),
    },
    totalsByPlatform: totals_platform,
    network: {
      followers: fmtPairs(carrySum(sd("followers"))), views: fmtPairs(mergeDicts(sd("views"), "sum")),
      netNew: fmtPairs(mergeDicts(sd("netNew"), "sum")), engagement: fmtPairs(mergeDicts(sd("engagement"), "mean")),
      postsByPlatform: dailyByPlat(posts_by_platform),
      viewsByPlatform: dailyByPlat(views_by_platform),
      interactionsByPlatform: dailyByPlat(inter_by_platform),
    },
    teams,
    insights: buildInsights(teams, label),
  };
}

export default async function handler(req, res) {
  // Gated to the content team and up: master_admin / admin / content accounts
  // may read league data. (Athletes and fans cannot — this is internal
  // cross-property reporting, not athlete-facing.)
  const ctx = await requireUser(req, res);
  if (!ctx) return; // 401 already sent
  if (requireRole(res, ctx.profile, ['master_admin', 'admin', 'content'])) return; // 403 already sent

  const token = process.env.METRICOOL_TOKEN, userId = process.env.METRICOOL_USER_ID;
  if (!token || !userId) {
    res.status(500).json({ error: "METRICOOL_TOKEN / METRICOOL_USER_ID not set in Vercel env vars" });
    return;
  }
  try {
    const q = req.query || {};
    const rng = q.range || null;
    const days = rng ? null : (parseInt(q.days, 10) || 30);
    const data = await compute(days, rng, token, userId);
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.setHeader("Content-Type", "application/json");
    res.status(200).send(JSON.stringify(data));
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
