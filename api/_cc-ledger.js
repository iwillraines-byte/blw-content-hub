// One post, one owner.
//
// Every post-level number in the Command Center (post views, interactions,
// saves, shares, EMV, top posts, formats, heat) is built from Metricool's
// per-account post lists. If the same platform post ever shows up under two
// accounts (an Instagram collab between BLW and a team, or two teams), adding
// those lists together would count it twice. This module finds those shared
// posts by their platform ID (Instagram shortcode, TikTok video ID, and so on)
// and gives each one to a single owner account:
//   1. the owner set by hand in Data check, if any
//   2. otherwise the account that published it first
//   3. on a tie (a collab is one post, so both copies carry the same time),
//      the BLW league page if it is one of the accounts, else the first team
//      in league order
// The other copies are dropped before anything is summed.
//
// Account-level numbers (followers, account views) come from each platform as
// one total per account and cannot be split by post; they are never used for
// EMV and are labeled as overlapping in combined views.
import { TEAMS, BLW_BRAND, TZ, makeApi } from './_cc-core.js';

const NET_ALIAS = { x: 'twitter', twitter: 'twitter', linkedincompany: 'linkedin', linkedin: 'linkedin', instagram: 'instagram', tiktok: 'tiktok', facebook: 'facebook', youtube: 'youtube', threads: 'threads' };
const normNet = n => NET_ALIAS[String(n || '').toLowerCase()] || String(n || '').toLowerCase();

// Platform-level identity of a post, from its permalink. Two accounts can only
// share a post if this matches; separate uploads of the same creative get
// different IDs and are (correctly) counted as separate posts.
export function platformPostId(p) {
  const net = normNet(p && p.network);
  const l = String((p && p.link) || '');
  if (!l) return null;
  let m;
  if (net === 'instagram' && (m = l.match(/instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i))) return 'ig:' + m[1];
  if (net === 'tiktok' && (m = l.match(/\/(?:video|photo)\/(\d+)/))) return 'tt:' + m[1];
  if (net === 'youtube' && (m = l.match(/(?:[?&]v=|shorts\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/))) return 'yt:' + m[1];
  if (net === 'facebook' && (m = l.match(/(?:story_fbid=|fbid=|\/posts\/|\/videos\/|\/reel\/|\/permalink\/)([0-9A-Za-z_-]{6,})/))) return 'fb:' + m[1];
  return net + ':' + l.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
}

const msOf = p => { const dt = ((p && p.publicationDate) || {}).dateTime || (p && p.date) || ''; return Date.parse(dt.length === 19 ? dt + 'Z' : dt) || 0; };
const ORDER = Object.fromEntries(TEAMS.map((t, i) => [String(t.blogId), i + 1]));

// A few top-level fields that differ between the copies, so a real collab can
// show which copy is the original (Metricool's field names are not documented).
function diffFields(list) {
  const out = [];
  const keys = new Set(list.flatMap(e => Object.keys(e.raw || {})));
  for (const k of keys) {
    if (k === 'metrics' || k === 'publicationDate') continue;
    const vals = list.map(e => (e.raw || {})[k]);
    if (vals.every(v => v == null || typeof v !== 'object') && new Set(vals.map(v => JSON.stringify(v))).size > 1) {
      out.push({ field: k, values: vals.map(v => String(v == null ? '' : v).slice(0, 60)) });
      if (out.length >= 6) break;
    }
  }
  return out;
}

// entries: [{ blogId, raw }] -> { owners: {cid: "blogId"}, shared: [...] }
export function chooseOwners(entries, { manual = {}, leagueId = BLW_BRAND.blogId } = {}) {
  const by = {};
  for (const e of entries) {
    const cid = e.cid || platformPostId(e.raw);
    if (!cid) continue;
    (by[cid] = by[cid] || []).push({ ...e, cid, ms: msOf(e.raw) });
  }
  const owners = {}, shared = [];
  const rank = e => String(e.blogId) === String(leagueId) ? 0 : (ORDER[String(e.blogId)] || 99);
  for (const [cid, list] of Object.entries(by)) {
    const blogs = [...new Set(list.map(e => String(e.blogId)))];
    if (blogs.length < 2) continue;
    let owner = manual[cid] && blogs.includes(String(manual[cid])) ? String(manual[cid]) : null;
    let reason = owner ? 'manual' : '';
    if (!owner) {
      const sorted = [...list].sort((a, b) => (a.ms - b.ms) || (rank(a) - rank(b)));
      const tie = sorted.filter(e => Math.abs(e.ms - sorted[0].ms) < 60000);
      if (new Set(tie.map(e => String(e.blogId))).size > 1) { owner = String(tie.sort((a, b) => rank(a) - rank(b))[0].blogId); reason = 'tie'; }
      else { owner = String(sorted[0].blogId); reason = 'first'; }
    }
    owners[cid] = owner;
    const r0 = list[0].raw || {};
    shared.push({
      cid, owner: Number(owner), reason, network: normNet(r0.network), link: r0.link || null,
      text: String(r0.text || '').slice(0, 140), date: ((r0.publicationDate || {}).dateTime) || '',
      copies: blogs.map(b => { const m = ((list.find(x => String(x.blogId) === b) || {}).raw || {}).metrics || {}; return { blogId: Number(b), impressions: Math.round(m.IMPRESSIONS || 0), interactions: Math.round(m.INTERACTIONS || 0) }; }),
      diff: diffFields(list),
    });
  }
  shared.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { owners, shared };
}

export const ownsPost = (owners, p, blogId) => {
  const cid = platformPostId(p);
  return !cid || !(cid in owners) || owners[cid] === String(blogId);
};

// Drop non-owner copies across several accounts' raw post lists, in place of
// a shared ledger (used where one builder already has every account's posts).
export function dedupeLists(postsByBlog, opts) {
  const entries = Object.entries(postsByBlog).flatMap(([blogId, list]) => (list || []).map(raw => ({ blogId, raw })));
  const { owners, shared } = chooseOwners(entries, opts);
  const out = {};
  for (const [blogId, list] of Object.entries(postsByBlog)) out[blogId] = (list || []).filter(p => ownsPost(owners, p, blogId));
  return { postsByBlog: out, owners, shared };
}

// ── The shared ledger for BLW (nine teams + league page) ────────────────────
// Built once per window and reused by the league, league-page and All BLW
// views, so all three agree on who owns a shared post, and Metricool's post
// lists are fetched once instead of per view.
const LEDGER_TTL = 5 * 60 * 1000;
const LEDGER = new Map();
export function clearLedgerCache() { LEDGER.clear(); }
export async function getLedger(win, token, userId, { fresh = false, manual = {} } = {}) {
  const key = `${String(win.from).slice(0, 13)}|${String(win.to).slice(0, 13)}|${JSON.stringify(manual)}`;
  const hit = LEDGER.get(key);
  if (!fresh && hit && Date.now() - hit.at < LEDGER_TTL) return hit.p;
  const p = (async () => {
    const mc = makeApi(token, userId);
    const ids = [...TEAMS.map(t => t.blogId), BLW_BRAND.blogId];
    const lists = await Promise.all(ids.map(b => mc.api('/v2/analytics/brand-summary/posts', b, { from: win.from, to: win.to, timezone: TZ })));
    const raw = {};
    ids.forEach((b, i) => { const r = lists[i]; raw[b] = r && Array.isArray(r.data) ? r.data : null; });
    const ok = Object.fromEntries(Object.entries(raw).filter(([, v]) => v));
    const { postsByBlog, shared } = dedupeLists(ok, { manual });
    return { from: win.from, to: win.to, postsByBlog, shared, accounts: Object.keys(ok).length, posts: Object.values(ok).reduce((a, l) => a + l.length, 0) };
  })();
  LEDGER.set(key, { at: Date.now(), p });
  p.catch(() => LEDGER.delete(key));
  if (LEDGER.size > 40) LEDGER.delete(LEDGER.keys().next().value);
  return p;
}
// Owned posts for one account from the ledger, or null if the ledger doesn't
// cover that account (then the caller fetches as before).
export function ledgerPosts(ledger, blogId) {
  if (!ledger || !ledger.postsByBlog) return null;
  const l = ledger.postsByBlog[blogId] || ledger.postsByBlog[String(blogId)];
  return Array.isArray(l) ? l : null;
}
