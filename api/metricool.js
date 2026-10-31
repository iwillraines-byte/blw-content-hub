// api/metricool.js — BLW Command Center data API (Vercel serverless function).
//
// Pulls live Metricool data server-side and returns computed metrics.
// Secrets come from env vars and are NEVER exposed to the browser:
//   METRICOOL_TOKEN     (server-only — like SUPABASE_SERVICE_ROLE_KEY)
//   METRICOOL_USER_ID
//   WIFFLE_BLOG_IDS     (optional) comma-separated Metricool brand ids for the
//                       WIFFLE® view. When unset the brand is found by name.
//
// Views (?view=):
//   league     (default) the nine BLW team accounts + the BLW league page
//   wiffle     the WIFFLE® brand, one row per connected social account
//   scheduled  every brand's scheduled posts, this week and next
//   ideas      POST — AI post ideas for one brand (see api/_cc-ideas.js)
//   planned    GET / POST — Command Center-only planned posts (api/_cc-planned.js)
//   config     PUBLIC — Supabase URL + anon key so the static page can run
//              the official auth client and refresh its own session
//
// Post counts are master-admin only. For every other role they are stripped
// here, server-side, so they never reach the browser (see redactLeague).
//
// Results are cached in this function instance for 5 minutes, keyed by view
// and query. Responses are private: they vary by role, so no shared CDN cache.
// The dashboard's Refresh button sends fresh=1 to skip the cache.

import { requireUser, requireRole } from './_supabase.js';
import { checkRateLimit } from './_rate-limit.js';
import {
  TZ, NETMAP, TEAMS, BLW_BRAND, round, sum, sumVals, sumPairs, cap, lastVal, nonEmpty,
  windowRange, makeApi, dsum, diffs, mergeDicts, carrySum, slist, fmtPairs, loadProfiles,
  pickMetric, SAVE_KEYS, SHARE_KEYS,
} from './_cc-core.js';
import { buildWiffle, redactWiffle } from './_cc-wiffle.js';
import { buildScheduled } from './_cc-schedule.js';
import { generateIdeas } from './_cc-ideas.js';
import { plannedHandler } from './_cc-planned.js';

export const maxDuration = 60;

const ROSTER = {
  6201154: ["Andrew Ledet","Paul Marshall","Will Marshall","Edward Martinez","Brice Clark","Cooper Ruckel","Jackson Richardson"],
  6201165: ["Randy Dalbey","Jake Sullivan","Ethan Winer","Jonathan Dalbey","Jim Balian","Tom Gannon","Kyle Vonschleusingen"],
  6201157: ["Keaton Kimmel","Justin Hall","Bryson Livingston","Ryan O'Rear","Drew Baalman","Jeff Lopes","Grant Miller"],
  6201149: ["Jaxson Blum","Carson Rose","Logan Rose","Luke Rose","Joey Jankowski","Caleb Jeter","Ben Dulin"],
  6201166: ["Dustin Staggs","Jaxen Pearson","Preston Kolm","Steven Hayden","Sawyer Behen","James Lee","Justin Lee"],
  6201159: ["Jordan Robles","Konner Jaso","Vincent Lea","Mychal Witty Jr.","Joaquin Jimenez","Bryan Owens","Dallas Allen"],
  6200089: ["Tommy Hernandez","Cam Smith","Jeremy Adams","Jackson Albers","John Paul Gunn","Mike Stiles","Sean Hornberger"],
  6201828: ["Josh Wheeler","Dominic Citrowske","Chandler Melton","Kaiden Rice","Spencer Foss","Brody Livingston","Jimmy Cole"],
};
export { ROSTER };
// Attribution for BLW-league-page posts. New York has no tracked account of its own
// but is included because league-page content is where its reach lives.
const ATTR_HANDLES = {
  arizonasaguaros: "Arizona Saguaros", "arizona.saguaros": "Arizona Saguaros",
  sdorcasblw: "Atlanta Ballers", atlantaballers: "Atlanta Ballers",
  harborhawksblw: "Boston Harbor Hawks", "boston.harbor.haw": "Boston Harbor Hawks",
  thechicagobats: "Chicago Bats", chicagobatsblw: "Chicago Bats",
  dallaspandasblw: "Dallas Pandas", dallaspandas: "Dallas Pandas",
  lvscorpionsblw: "Las Vegas Scorpions",
  lanaturalsblw: "Los Angeles Naturals",
  miamimirageblw: "Miami Mirage",
  philadelphiawiffleclub: "Philadelphia Wiffle Club", phillywiffleclubblw: "Philadelphia Wiffle Club",
};
const ATTR_WORDS = {
  "Arizona Saguaros": ["arizona", "saguaro"],
  "Atlanta Ballers": ["atlanta", "baller"],
  "Boston Harbor Hawks": ["boston", "harbor hawk"],
  "Chicago Bats": ["chicago", "bats"],
  "Dallas Pandas": ["dallas", "panda"],
  "Las Vegas Scorpions": ["vegas", "scorpion"],
  "Los Angeles Naturals": ["los angeles", "naturals"],
  "Miami Mirage": ["miami", "mirage"],
  "New York Green Apples": ["new york", "green apple"],
  "Philadelphia Wiffle Club": ["philadelphia", "philly", "wiffle club"],
};
const ATTR_ROSTER = {
  "Arizona Saguaros": ROSTER[6201154], "Boston Harbor Hawks": ROSTER[6201165],
  "Chicago Bats": ROSTER[6201157], "Dallas Pandas": ROSTER[6201149],
  "Las Vegas Scorpions": ROSTER[6201166], "Los Angeles Naturals": ROSTER[6201159],
  "Miami Mirage": ROSTER[6200089], "Philadelphia Wiffle Club": ROSTER[6201828],
  "Atlanta Ballers": ["Brett Caladie","Torin Roth","Jack Roth","Brandon Crone","Trevor Bauer","Cael Foreman","Connor Smith"],
  "New York Green Apples": ["Will Smithey","Gus Skibbe","Brendan Dudas","Reid Werner","Tyler Flakne","Sam Skibbe","James Kline"],
};
export { ATTR_ROSTER };
const SUFFIX = /\b(jr|sr|ii|iii|iv)\b/g;
const normText = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
const PLAYER_PAT = (() => {
  const lastCount = {};
  for (const arr of Object.values(ROSTER)) for (const nm of arr) { const l = normText(nm).split(" ").slice(-1)[0]; lastCount[l] = (lastCount[l] || 0) + 1; }
  const out = {};
  for (const [b, arr] of Object.entries(ROSTER)) out[b] = arr.map(nm => {
    const full = normText(nm); const collapsed = full.replace(/ /g, ""); const last = full.split(" ").slice(-1)[0];
    return { name: nm, full, collapsed, last, useLast: last.length >= 6 && lastCount[last] === 1 };
  });
  return out;
})();
function matchPlayers(text, pats) {
  const n = normText(text); if (!n) return [];
  const padded = " " + n + " ", collapsed = n.replace(/ /g, "");
  const hits = [];
  for (const p of pats) if (padded.includes(" " + p.full + " ") || collapsed.includes(p.collapsed) || (p.useLast && padded.includes(" " + p.last + " "))) hits.push(p.name);
  return hits;
}

function attributePost(text) {
  const t = " " + String(text || "").toLowerCase().replace(/\s+/g, " ") + " ";
  const found = new Map(); // name -> how
  for (const [hh, nm] of Object.entries(ATTR_HANDLES)) if (t.includes("@" + hh)) found.set(nm, "handle");
  for (const [nm, ws] of Object.entries(ATTR_WORDS)) if (!found.has(nm) && ws.some(w => t.includes(w))) found.set(nm, "name");
  for (const [nm, arr] of Object.entries(ATTR_ROSTER)) {
    if (found.has(nm) || !arr) continue;
    for (const pl of arr) { const f = String(pl).toLowerCase().replace(/[^a-z ]/g, ""); if (f.length > 5 && t.includes(" " + f + " ")) { found.set(nm, "player"); break; } }
  }
  return [...found.entries()].map(([team, via]) => ({ team, via }));
}

async function buildBLW(from, to, profiles, api) {
  const b = BLW_BRAND.blogId;
  const resp = await api("/v2/analytics/brand-summary/posts", b, { from, to, timezone: TZ });
  const posts = (resp && Array.isArray(resp.data)) ? resp.data : [];
  const fmt = {}, agg = {};
  let imp = 0, inter = 0, engSum = 0;
  const ranked = [];
  let unattributed = 0, unattImp = 0;
  for (const p of posts) {
    const m = p.metrics || {};
    const i = Math.round(m.IMPRESSIONS || 0), x = Math.round(m.INTERACTIONS || 0), e = Number(m.ENGAGEMENT) || 0;
    const ty = String(p.type || "OTHER").toUpperCase();
    const dt = (p.publicationDate || {}).dateTime || "";
    imp += i; inter += x; engSum += e;
    fmt[ty] = fmt[ty] || { count: 0, inter: 0, imp: 0, engSum: 0 };
    fmt[ty].count += 1; fmt[ty].inter += x; fmt[ty].imp += i; fmt[ty].engSum += e;
    const hits = attributePost(p.text);
    if (!hits.length) { unattributed += 1; unattImp += i; }
    for (const hh of hits) {
      const a = agg[hh.team] || (agg[hh.team] = { team: hh.team, posts: 0, impressions: 0, interactions: 0, engSum: 0, via: { handle: 0, name: 0, player: 0 } });
      a.posts += 1; a.impressions += i; a.interactions += x; a.engSum += e; a.via[hh.via] += 1;
    }
    ranked.push({ network: p.network, type: ty, text: (p.text || "").slice(0, 140), link: p.link, picture: p.picture || null, date: dt, impressions: i, interactions: x, engagement: round(e, 2), teams: hits.map(z => z.team) });
  }
  ranked.sort((a, b2) => (b2.interactions - a.interactions) || (b2.impressions - a.impressions));
  const attribution = Object.values(agg).map(a => ({ team: a.team, posts: a.posts, impressions: a.impressions, interactions: a.interactions, engAvg: round(a.engSum / a.posts, 2), via: a.via })).sort((a, b2) => b2.impressions - a.impressions);
  const prof = profiles[b] || {};
  const formatBreakdown = Object.entries(fmt).map(([type, f]) => ({ type, count: f.count, interactions: f.inter, impressions: f.imp, avgInteractions: round(f.inter / f.count, 1), avgEngagement: round(f.engSum / f.count, 2) })).sort((a, b2) => b2.avgInteractions - a.avgInteractions);
  return {
    blogId: b, name: BLW_BRAND.name, accent: BLW_BRAND.accent, picture: prof.picture || null,
    handles: prof.handles || { instagram: BLW_BRAND.handle },
    contentCount: posts.length, impressions: imp, interactions: inter,
    engagementRatePost: posts.length ? round(engSum / posts.length, 2) : 0,
    attribution, unattributed, unattributedImpressions: unattImp,
    unattributedPct: posts.length ? Math.round(unattributed / posts.length * 100) : 0,
    formatBreakdown, topPosts: ranked.slice(0, 12),
  };
}

// Which platforms are behind on cross-posting, by name only. Safe to send to
// every role (no numbers); the master view still gets the raw counts too.
function behindOf(counts) {
  const max = Math.max(counts.ig, counts.tt, counts.fb);
  if (!max) return [];
  return ["ig", "tt", "fb"].filter(k => counts[k] < max);
}

async function buildTeam(t, from, to, profiles, mc) {
  const b = t.blogId;
  const { api, timeline: tl, firstTimeline: ft } = mc;
  const [ig_fR, ig_views, ig_eng, tt_f, tt_viewsR, tt_engR, fb_f, fb_engR, fb_mv,
    ig_saves_p, ig_saved_r, ig_shares_p, ig_shares_r, tt_sharesR, fb_shares_p,
    fb_vwatch, fb_vtime, resp] = await Promise.all([
    // Metricool's catalog spells this "followers"; the original "Followers"
    // is tried first because it is what this dashboard has always used.
    ft(b, "instagram", [["Followers", "account"], ["followers", "account"]], from, to),
    tl(b, "instagram", "views", from, to, "account"),
    tl(b, "instagram", "engagement", from, to, "posts"),
    tl(b, "tiktok", "followers_count", from, to, "account"),
    ft(b, "tiktok", [["views", "video"], ["views", undefined]], from, to),
    ft(b, "tiktok", [["engagement", "video"], ["engagement", undefined]], from, to),
    tl(b, "facebook", "pageFollows", from, to, "account"),
    ft(b, "facebook", [["engagement", "posts"], ["engagement", undefined]], from, to),
    // Facebook "Views" (page_media_view) already counts reels plays. The old
    // code added blue_reels_play_count on top, which double-counted every
    // reel view. Reels plays are now only used as a fallback (below).
    tl(b, "facebook", "page_media_view", from, to, "account"),
    // Instagram saves: feed posts report "saves", reels report "saved". The
    // old code asked for "saved" on posts, which is not a posts metric, and
    // never asked reels at all, so most saves were missing.
    tl(b, "instagram", "saves", from, to, "posts"),
    tl(b, "instagram", "saved", from, to, "reels"),
    // Instagram shares: posts AND reels (reels were missing before).
    tl(b, "instagram", "shares", from, to, "posts"),
    tl(b, "instagram", "shares", from, to, "reels"),
    ft(b, "tiktok", [["shares", "video"], ["shares", undefined]], from, to),
    // Facebook does expose post shares; the old code hard-coded them to 0.
    tl(b, "facebook", "shares", from, to, "posts"),
    tl(b, "facebook", "post_video_avg_time_watched", from, to, undefined),
    tl(b, "facebook", "post_video_view_time", from, to, undefined),
    api("/v2/analytics/brand-summary/posts", b, { from, to, timezone: TZ }),
  ]);
  const ig_f = ig_fR.data, tt_views = tt_viewsR.data, tt_eng = tt_engR.data, fb_eng = fb_engR.data, tt_shares = tt_sharesR.data;
  let fb_views = fb_mv, fbViewsSource = "page_media_view";
  if (!nonEmpty(fb_mv)) {
    const [reels, imps] = await Promise.all([
      tl(b, "facebook", "blue_reels_play_count", from, to, "reels"),
      tl(b, "facebook", "page_posts_impressions", from, to, "account"),
    ]);
    fb_views = dsum(reels, imps);
    fbViewsSource = nonEmpty(fb_views) ? "reels plays + post impressions (fallback)" : "none";
  }
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
  const eng_by = { ig: [], tt: [], fb: [] }, imp_by = { ig: 0, tt: 0, fb: 0 };
  // Per-post saves/shares. Used whenever Metricool's per-post payload carries
  // them, because they line up with the per-post impressions and interactions
  // the rest of this page (and EMV) is built on.
  const pp = { saves: { ig: 0, tt: 0, fb: 0 }, shares: { ig: 0, tt: 0, fb: 0 }, hasSave: { ig: false, tt: false, fb: false }, hasShare: { ig: false, tt: false, fb: false } };
  const ppDaily = {};
  const metricKeys = new Set();
  const fmt = {};
  const pats = PLAYER_PAT[b] || [], pAgg = {};
  for (const p of posts) {
    const net = NETMAP[p.network]; const m = p.metrics || {};
    Object.keys(m).forEach(k => metricKeys.add(k));
    const inter = Math.round(m.INTERACTIONS || 0);
    const imp = Math.round(m.IMPRESSIONS || 0);
    const eng = Number(m.ENGAGEMENT) || 0;
    const ty = String(p.type || "OTHER").toUpperCase();
    const dt = (p.publicationDate || {}).dateTime || "";
    fmt[ty] = fmt[ty] || { count: 0, inter: 0, imp: 0, engSum: 0 };
    fmt[ty].count += 1; fmt[ty].inter += inter; fmt[ty].imp += imp; fmt[ty].engSum += eng;
    if (pats.length) for (const nm of matchPlayers(p.text, pats)) {
      const a = pAgg[nm] || (pAgg[nm] = { name: nm, posts: 0, interactions: 0, impressions: 0, engSum: 0, items: [] });
      a.posts += 1; a.interactions += inter; a.impressions += imp; a.engSum += eng;
      a.items.push({ network: p.network, type: ty, interactions: inter, impressions: imp, link: p.link, picture: p.picture || null, date: dt });
    }
    if (net) {
      inter_by[net] += (m.INTERACTIONS || 0); posts_by[net] += 1;
      eng_by[net].push(eng); imp_by[net] += imp;
      const day = dt.slice(0, 10);
      if (day) { posts_daily[net][day] = (posts_daily[net][day] || 0) + 1; inter_daily[net][day] = (inter_daily[net][day] || 0) + (m.INTERACTIONS || 0); }
      posts_list[net].push({ date: dt, text: (p.text || "").slice(0, 140), link: p.link, interactions: inter, type: ty });
      const sv = pickMetric(m, SAVE_KEYS), sh = pickMetric(m, SHARE_KEYS);
      if (sv.has) { pp.hasSave[net] = true; pp.saves[net] += sv.v; }
      if (sh.has) { pp.hasShare[net] = true; pp.shares[net] += sh.v; }
      if (day && (sv.has || sh.has)) { ppDaily[net] = ppDaily[net] || {}; ppDaily[net][day] = (ppDaily[net][day] || 0) + sv.v + sh.v; }
    }
    ranked.push({
      team: t.name, accent: t.accent, blogId: b, network: p.network, type: ty,
      text: (p.text || "").slice(0, 140), link: p.link, picture: p.picture || null, date: dt,
      interactions: inter, engagement: round(eng, 2), impressions: imp,
    });
  }
  for (const net of ["ig", "tt", "fb"]) posts_list[net].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  ranked.sort((a, b2) => (b2.interactions - a.interactions) || (b2.impressions - a.impressions));

  // Saves / shares: per-post when available for that platform, otherwise the
  // corrected timelines.
  const tlSaves = { ig: sumVals(ig_saves_p) + sumVals(ig_saved_r), tt: 0, fb: 0 };
  const tlShares = { ig: sumVals(ig_shares_p) + sumVals(ig_shares_r), tt: sumVals(tt_shares), fb: sumVals(fb_shares_p) };
  const tlDaily = { ig: dsum(ig_saves_p, ig_saved_r, ig_shares_p, ig_shares_r), tt: tt_shares, fb: fb_shares_p };
  const savesByPlatform = {}, sharesByPlatform = {}, ssSource = { saves: {}, shares: {} };
  const dailyParts = [];
  for (const net of ["ig", "tt", "fb"]) {
    savesByPlatform[net] = Math.round(pp.hasSave[net] ? pp.saves[net] : tlSaves[net]);
    sharesByPlatform[net] = Math.round(pp.hasShare[net] ? pp.shares[net] : tlShares[net]);
    ssSource.saves[net] = pp.hasSave[net] ? "per-post" : (tlSaves[net] ? "timeline" : "none");
    ssSource.shares[net] = pp.hasShare[net] ? "per-post" : (tlShares[net] ? "timeline" : "none");
    dailyParts.push((pp.hasSave[net] || pp.hasShare[net]) ? (ppDaily[net] || {}) : (tlDaily[net] || {}));
  }

  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const engRateByPlatform = { ig: round(mean(eng_by.ig), 2), tt: round(mean(eng_by.tt), 2), fb: round(mean(eng_by.fb), 2) };
  const engAgg = { ig: { s: sum(eng_by.ig), n: eng_by.ig.length }, tt: { s: sum(eng_by.tt), n: eng_by.tt.length }, fb: { s: sum(eng_by.fb), n: eng_by.fb.length } };
  const engRate = round(mean([...eng_by.ig, ...eng_by.tt, ...eng_by.fb]), 2);
  const players = Object.values(pAgg).map(a => ({ name: a.name, posts: a.posts, interactions: a.interactions, impressions: a.impressions, engAvg: round(a.engSum / a.posts, 2), items: a.items.sort((x, y) => y.interactions - x.interactions).slice(0, 6) })).sort((a, b) => b.interactions - a.interactions);
  const watchDays = Object.values(fb_vwatch).filter(v => v > 0);
  const watch = { avgSec: watchDays.length ? round(watchDays.reduce((a, b) => a + b, 0) / watchDays.length / 1000, 1) : 0, totalHrs: round(sumVals(fb_vtime) / 3.6e6, 1), days: watchDays.length };

  const prof = profiles[b] || {};
  return {
    blogId: b, name: t.name, accent: t.accent, teamId: t.teamId, picture: prof.picture || null, handles: prof.handles || {},
    followersNow: Math.round(fol.ig + fol.tt + fol.fb),
    followersByNetwork: { ig: Math.round(fol.ig), tt: Math.round(fol.tt), fb: Math.round(fol.fb) },
    netNew: Math.round(sumPairs(netnew_series)),
    views: Math.round(sumPairs(views_series)),
    engagementRate: eng_series.length ? round(sumPairs(eng_series) / eng_series.length, 2) : 0,
    interactions: Math.round(inter_by.ig + inter_by.tt + inter_by.fb),
    contentCount: posts.length,
    parity: { behind: behindOf(posts_by) },
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
    engagementRatePost: engRate,
    engRateByPlatform,
    engAgg,
    impressions: Math.round(imp_by.ig + imp_by.tt + imp_by.fb),
    impressionsByPlatform: { ig: imp_by.ig, tt: imp_by.tt, fb: imp_by.fb },
    saves: savesByPlatform.ig + savesByPlatform.tt + savesByPlatform.fb,
    shares: sharesByPlatform.ig + sharesByPlatform.tt + sharesByPlatform.fb,
    savesByPlatform, sharesByPlatform,
    seriesSavesShares: slist(dsum(...dailyParts)),
    formats: fmt,
    players,
    watch,
    postsList: posts_list,
    topPosts: ranked.slice(0, 3),
    rankedTop: ranked.slice(0, 8),
    _audit: { fbViews: fbViewsSource, igFollowers: ig_fR.used, ss: ssSource, metricKeys: [...metricKeys] },
  };
}

const PLAT_NAME = { ig: "Instagram", tt: "TikTok", fb: "Facebook" };

function buildInsights(teams, label, isMaster) {
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
      detail: `Reach is fine but engagement lags at ${low.engagementRate.toFixed(2)}%${isMaster ? ` on ${low.contentCount} posts` : ""}. Test a curiosity hook ('The real reason ...') or a question CTA in the first line to lift comments, which weigh more than likes.` });
    const high = engPool.reduce((a, b) => b.engagementRate > a.engagementRate ? b : a);
    out.push({ kind: "Model it", team: high.name, accent: high.accent, title: high.name + " is the engagement benchmark",
      detail: `Top engagement rate in the league at ${high.engagementRate.toFixed(2)}%. Reverse-engineer its hooks and post structure and templatize them for the other eight teams.` });
  }
  const lowC = teams.reduce((a, b) => b.contentCount < a.contentCount ? b : a);
  out.push({ kind: "Cadence", team: lowC.name, accent: lowC.accent, title: lowC.name + " is under-posting",
    detail: isMaster
      ? `Only ${lowC.contentCount} posts in ${label}, the thinnest cadence in the league. For accounts this early, volume is the cheapest growth lever, so batch a week of content and aim for 1-2 posts/day before any spend.`
      : `The thinnest posting cadence in the league in ${label}. For accounts this early, volume is the cheapest growth lever, so batch a week of content and aim for 1-2 posts/day before any spend.` });

  const arr = [["Facebook", sum(teams.map(t => t.byPlatform.posts.fb))], ["Instagram", sum(teams.map(t => t.byPlatform.posts.ig))], ["TikTok", sum(teams.map(t => t.byPlatform.posts.tt))]];
  const thin = arr.reduce((a, b) => b[1] < a[1] ? b : a), fat = arr.reduce((a, b) => b[1] > a[1] ? b : a);
  if (fat[1] && thin[1] < fat[1]) {
    out.push({ kind: "Cross-post", team: "League", accent: "#5B8DEF", title: `Close the ${thin[0]} gap`,
      detail: isMaster
        ? `Across the league this window: ${fat[1]} posts on ${fat[0]} vs only ${thin[1]} on ${thin[0]}. Mirror the top ${fat[0]} cuts to ${thin[0]} to reclaim that reach for free.`
        : `${thin[0]} is running behind ${fat[0]} across the league this window. Mirror the top ${fat[0]} cuts to ${thin[0]} to reclaim that reach for free.` });
  }
  return out;
}

// Union of what each Metricool call returned across the nine teams, for the
// master-only Data check panel.
function summarizeAudit(mc, teams) {
  const metrics = Object.entries(mc.audit).map(([key, a]) => ({ key, calls: a.calls, withData: a.withData })).sort((a, b) => a.key.localeCompare(b.key));
  const keys = new Set(); teams.forEach(t => (t._audit.metricKeys || []).forEach(k => keys.add(k)));
  const tally = (pick) => { const o = {}; teams.forEach(t => { const v = pick(t); o[v] = (o[v] || 0) + 1; }); return o; };
  return {
    metrics,
    postMetricKeys: [...keys].sort(),
    fbViews: tally(t => t._audit.fbViews),
    igFollowers: tally(t => t._audit.igFollowers || "none"),
    saves: { ig: tally(t => t._audit.ss.saves.ig), tt: tally(t => t._audit.ss.saves.tt), fb: tally(t => t._audit.ss.saves.fb) },
    shares: { ig: tally(t => t._audit.ss.shares.ig), tt: tally(t => t._audit.ss.shares.tt), fb: tally(t => t._audit.ss.shares.fb) },
    teams: teams.length,
  };
}

export async function compute(days, rng, token, userId, custom) {
  const { from, to, label } = windowRange(days, rng, custom);
  const mc = makeApi(token, userId);
  const profiles = await loadProfiles(mc.api);
  const [teams, blw] = await Promise.all([
    Promise.all(TEAMS.map(t => buildTeam(t, from, to, profiles, mc))),
    buildBLW(from, to, profiles, mc.api),
  ]);
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

  const leaderboard = teams.flatMap(t => t.rankedTop).filter(p => p.interactions > 0 || p.impressions > 0)
    .sort((a, b) => (b.interactions - a.interactions) || (b.impressions - a.impressions)).slice(0, 15);
  const fmtAll = {};
  for (const t of teams) for (const [ty, f] of Object.entries(t.formats)) {
    fmtAll[ty] = fmtAll[ty] || { count: 0, inter: 0, imp: 0, engSum: 0 };
    fmtAll[ty].count += f.count; fmtAll[ty].inter += f.inter; fmtAll[ty].imp += f.imp; fmtAll[ty].engSum += f.engSum;
  }
  const fmtTotal = sum(Object.values(fmtAll).map(f => f.count)) || 1;
  const formatBreakdown = Object.entries(fmtAll).map(([type, f]) => ({
    type, count: f.count, share: round(f.count / fmtTotal * 100, 1), enough: f.count >= 2,
    interactions: f.inter, impressions: f.imp,
    avgInteractions: round(f.inter / f.count, 1), avgEngagement: round(f.engSum / f.count, 2),
  })).sort((a, b) => b.avgInteractions - a.avgInteractions);
  const engL = { ig: { s: 0, n: 0 }, tt: { s: 0, n: 0 }, fb: { s: 0, n: 0 } };
  for (const t of teams) for (const net of ["ig", "tt", "fb"]) { engL[net].s += t.engAgg[net].s; engL[net].n += t.engAgg[net].n; }
  const engRateByPlatform = { ig: round(engL.ig.n ? engL.ig.s / engL.ig.n : 0, 2), tt: round(engL.tt.n ? engL.tt.s / engL.tt.n : 0, 2), fb: round(engL.fb.n ? engL.fb.s / engL.fb.n : 0, 2) };
  const engRate = round((engL.ig.s + engL.tt.s + engL.fb.s) / Math.max(1, engL.ig.n + engL.tt.n + engL.fb.n), 2);
  const impByPlat = { ig: sum(teams.map(t => t.impressionsByPlatform.ig)), tt: sum(teams.map(t => t.impressionsByPlatform.tt)), fb: sum(teams.map(t => t.impressionsByPlatform.fb)) };
  const savesByPlat = { ig: sum(teams.map(t => t.savesByPlatform.ig)), tt: sum(teams.map(t => t.savesByPlatform.tt)), fb: sum(teams.map(t => t.savesByPlatform.fb)) };
  const sharesByPlat = { ig: sum(teams.map(t => t.sharesByPlatform.ig)), tt: sum(teams.map(t => t.sharesByPlatform.tt)), fb: sum(teams.map(t => t.sharesByPlatform.fb)) };
  const playersAll = teams.flatMap(t => (t.players || []).map(pl => ({ ...pl, team: t.name, accent: t.accent, blogId: t.blogId, amp: t.followersNow ? round(pl.impressions / t.followersNow, 1) : 0 })));
  const nz = arr => { const mx = Math.max(1, ...arr); return arr.map(v => v / mx); };
  const pI = nz(playersAll.map(x => x.interactions)), pP = nz(playersAll.map(x => x.impressions)), pE = nz(playersAll.map(x => x.engAvg));
  playersAll.forEach((x, i) => { x.heat = Math.round(100 * (0.55 * pI[i] + 0.30 * pP[i] + 0.15 * pE[i])); });
  const playerLeaderboard = playersAll.sort((a, b) => b.interactions - a.interactions).slice(0, 20);
  const rosterCoverage = { withRoster: teams.filter(t => (ROSTER[t.blogId] || []).length).length, total: teams.length, missing: teams.filter(t => !(ROSTER[t.blogId] || []).length).map(t => t.name), untracked: ["New York Green Apples", "San Diego Orcas"] };
  const wTeams = teams.filter(t => t.watch.days > 0);
  const watchLeague = { totalHrs: round(sum(teams.map(t => t.watch.totalHrs)), 1), avgSec: wTeams.length ? round(sum(wTeams.map(t => t.watch.avgSec)) / wTeams.length, 1) : 0, teamsWithData: wTeams.length, platform: "facebook" };
  const parityBehind = behindOf(totals_platform.posts);
  const dataAudit = summarizeAudit(mc, teams);
  teams.forEach(t => { delete t._audit; });

  return {
    generatedAt: new Date().toISOString(), from, to, label, days, range: rng, timezone: TZ,
    totals: {
      followers: sum(teams.map(t => t.followersNow)), views: sum(teams.map(t => t.views)),
      interactions: sum(teams.map(t => t.interactions)), content: sum(teams.map(t => t.contentCount)),
      engagementRate: engRate, impressions: sum(teams.map(t => t.impressions)),
      saves: sum(teams.map(t => t.saves)), shares: sum(teams.map(t => t.shares)),
    },
    leaderboard, formatBreakdown, watch: watchLeague, playerLeaderboard, rosterCoverage, blw,
    engRateByPlatform, impressionsByPlatform: impByPlat, savesByPlatform: savesByPlat, sharesByPlatform: sharesByPlat,
    totalsByPlatform: totals_platform, parityBehind,
    network: {
      followers: fmtPairs(carrySum(sd("followers"))), views: fmtPairs(mergeDicts(sd("views"), "sum")),
      netNew: fmtPairs(mergeDicts(sd("netNew"), "sum")), engagement: fmtPairs(mergeDicts(sd("engagement"), "mean")),
      postsByPlatform: dailyByPlat(posts_by_platform),
      viewsByPlatform: dailyByPlat(views_by_platform),
      interactionsByPlatform: dailyByPlat(inter_by_platform),
    },
    teams,
    insights: buildInsights(teams, label, true),
    insightsPublic: buildInsights(teams, label, false),
    dataAudit,
  };
}

// Strip every post count before the payload leaves the server for a
// non-master viewer. Works on a deep copy so the cached original keeps them.
export function redactLeague(src) {
  const d = structuredClone(src);
  delete d.totals.content;
  delete d.totalsByPlatform.posts;
  delete d.network.postsByPlatform;
  d.insights = d.insightsPublic;
  delete d.insightsPublic;
  delete d.dataAudit;
  d.formatBreakdown = d.formatBreakdown.map(({ count, ...f }) => f);
  d.playerLeaderboard = d.playerLeaderboard.map(({ posts, ...p }) => p);
  for (const t of d.teams) {
    delete t.contentCount;
    delete t.byPlatform.posts;
    delete t.seriesByPlatform.posts;
    delete t.formats;
    t.players = (t.players || []).map(({ posts, ...p }) => p);
  }
  if (d.blw) {
    delete d.blw.contentCount;
    delete d.blw.unattributed;
    d.blw.attribution = (d.blw.attribution || []).map(({ posts, ...a }) => a);
    d.blw.formatBreakdown = (d.blw.formatBreakdown || []).map(({ count, ...f }) => f);
  }
  d.viewer = { isMaster: false };
  return d;
}
function masterLeague(src) {
  const d = { ...src };
  delete d.insightsPublic;
  d.viewer = { isMaster: true };
  return d;
}

// ── Per-instance cache ──────────────────────────────────────────────────────
const CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000;
async function cached(key, ttl, fresh, fn) {
  const hit = CACHE.get(key);
  if (!fresh && hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await fn();
  CACHE.set(key, { at: Date.now(), value });
  if (CACHE.size > 40) CACHE.delete(CACHE.keys().next().value);
  return value;
}

function parseWindow(q) {
  const rng = q.range || null;
  const days = rng ? null : (parseInt(q.days, 10) || 30);
  const custom = rng === "custom" ? { from: String(q.from || ""), to: String(q.to || "") } : null;
  return { rng, days, custom };
}

function readBody(req) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}

export default async function handler(req, res) {
  const q = req.query || {};
  const view = String(q.view || "league");

  // Public: the Supabase project URL + anon key. Both are already shipped in
  // the BLW Studio bundle; the static Command Center page needs them to run
  // the official auth client, which refreshes expired sessions on its own.
  if (view === "config") {
    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json({ supabaseUrl: url, anonKey });
    return;
  }

  // Gated to the content team and up: master_admin / admin / content accounts
  // may read league data. (Athletes and fans cannot — this is internal
  // cross-property reporting, not athlete-facing.)
  const ctx = await requireUser(req, res);
  if (!ctx) return; // 401 already sent
  if (requireRole(res, ctx.profile, ['master_admin', 'admin', 'content'])) return; // 403 already sent
  const isMaster = ctx.profile?.role === "master_admin";

  // Planned posts never touch Metricool, so they work even without its env vars.
  if (view === "planned") { res.setHeader("Cache-Control", "private, no-store"); await plannedHandler(req, res, ctx); return; }

  const token = process.env.METRICOOL_TOKEN, userId = process.env.METRICOOL_USER_ID;
  if (!token || !userId) {
    res.status(500).json({ error: "METRICOOL_TOKEN / METRICOOL_USER_ID not set in Vercel env vars" });
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "application/json");
  const fresh = q.fresh === "1";
  try {
    if (view === "league") {
      const { rng, days, custom } = parseWindow(q);
      if (rng === "custom" && !(custom.from && custom.to)) { res.status(400).json({ error: "custom range needs from and to as YYYY-MM-DD" }); return; }
      const key = `league|${rng || days}|${custom ? custom.from + ":" + custom.to : ""}`;
      const data = await cached(key, CACHE_TTL, fresh, () => compute(days, rng, token, userId, custom));
      res.status(200).send(JSON.stringify(isMaster ? masterLeague(data) : redactLeague(data)));
      return;
    }
    if (view === "wiffle") {
      const { rng, days, custom } = parseWindow(q);
      if (rng === "custom" && !(custom.from && custom.to)) { res.status(400).json({ error: "custom range needs from and to as YYYY-MM-DD" }); return; }
      const key = `wiffle|${rng || days}|${custom ? custom.from + ":" + custom.to : ""}`;
      const data = await cached(key, CACHE_TTL, fresh, () => buildWiffle(windowRange(days, rng, custom), token, userId));
      res.status(200).send(JSON.stringify(isMaster ? { ...data, viewer: { isMaster: true } } : redactWiffle(data)));
      return;
    }
    if (view === "scheduled") {
      const data = await cached("scheduled", 2 * 60 * 1000, fresh, () => buildScheduled(token, userId));
      res.status(200).send(JSON.stringify({ ...data, viewer: { isMaster } }));
      return;
    }
    if (view === "ideas") {
      if (req.method !== "POST") { res.status(405).json({ error: "POST required" }); return; }
      if (await checkRateLimit(ctx, 'ideas', res)) return;
      const body = readBody(req);
      const out = await generateIdeas(body, { sb: ctx.sb, roster: ATTR_ROSTER });
      res.status(out.error ? (out.status || 500) : 200).send(JSON.stringify(out));
      return;
    }
    res.status(400).json({ error: "Unknown view" });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
