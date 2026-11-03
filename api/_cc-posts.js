// api/_cc-posts.js — the Command Center post library.
//
// view=posts      every post published in the window, for every brand (the
//                 nine teams, the BLW league page, WIFFLE®), with an automatic
//                 "creative" grouping: the same piece of content cross-posted
//                 to several platforms is grouped into one creative.
// view=posttags   GET / POST — contractor list, which contractor made each
//                 post, and manual grouping fixes. Stored in app_settings
//                 ("cc-post-tags"), so no migration is needed.
//
// Automatic grouping rules (per brand):
//   * posts on DIFFERENT platforms, published within 72 hours of each other
//   * captions match: after dropping hashtags, links, @handles, emoji and
//     punctuation, the word overlap is at least 50%, or one caption's
//     opening words appear in the other
//   * at most one post per platform in a creative
//   * posts with no caption only group if published within 30 minutes
// Anything the rules get wrong can be fixed by hand on the page (group /
// ungroup); those fixes are stored as overrides and win over the rules.

import { TZ, TEAMS, BLW_BRAND, WIFFLE_ACCENT, round, makeApi, loadProfiles, pickMetric, SAVE_KEYS, SHARE_KEYS } from './_cc-core.js';
import { findWiffleBrands } from './_cc-wiffle.js';

const NET_ALIAS = { x: 'twitter', twitter: 'twitter', linkedincompany: 'linkedin', linkedin: 'linkedin', instagram: 'instagram', tiktok: 'tiktok', facebook: 'facebook', youtube: 'youtube', threads: 'threads' };
const normNet = n => NET_ALIAS[String(n || '').toLowerCase()] || String(n || '').toLowerCase();

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'it', 'this', 'that', 'with', 'at', 'by', 'be', 'are', 'was', 'from', 'up', 'out', 'we', 'you', 'our', 'your', 'i', 'my', 'me']);
export function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#@][\w.]+/g, ' ')
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/).filter(w => w && !STOP.has(w));
}
export function similar(a, b) {
  if (!a.length || !b.length) return 0;
  const A = new Set(a), B = new Set(b);
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  const jac = inter / (A.size + B.size - inter);
  // opening words of the shorter caption appear, in order, in the longer one
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  const head = s.slice(0, Math.min(6, s.length)).join(' ');
  const prefix = s.length >= 3 && l.join(' ').includes(head) ? 0.9 : 0;
  return Math.max(jac, prefix);
}

// Greedy grouping inside one brand. Returns post key -> group key.
export function autoGroup(posts) {
  const out = {};
  const byBrand = {};
  for (const p of posts) (byBrand[p.blogId] = byBrand[p.blogId] || []).push(p);
  for (const list of Object.values(byBrand)) {
    list.sort((a, b) => a.ms - b.ms);
    const groups = []; // { key, nets:Set, first, last, toks }
    for (const p of list) {
      const toks = p._toks;
      let best = null, bestScore = 0;
      for (const g of groups) {
        if (g.nets.has(p.network)) continue;
        if (p.ms - g.first > 72 * 3600000) continue;
        let score;
        if (!toks.length || !g.toks.length) score = (!toks.length && !g.toks.length && Math.abs(p.ms - g.last) <= 30 * 60000) ? 0.6 : 0;
        else score = similar(toks, g.toks);
        if (score >= 0.5 && score > bestScore) { best = g; bestScore = score; }
      }
      if (best) { best.nets.add(p.network); best.last = p.ms; if (toks.length > best.toks.length) best.toks = toks; out[p.key] = best.key; }
      else { const g = { key: p.key, nets: new Set([p.network]), first: p.ms, last: p.ms, toks }; groups.push(g); out[p.key] = g.key; }
    }
  }
  return out;
}

export async function buildPostLibrary(win, token, userId) {
  const { from, to, label } = win;
  const mc = makeApi(token, userId);
  const profiles = await loadProfiles(mc.api);
  const brands = [
    ...TEAMS.map(t => ({ blogId: t.blogId, name: t.name, accent: t.accent, kind: 'team' })),
    { blogId: BLW_BRAND.blogId, name: BLW_BRAND.name, accent: BLW_BRAND.accent, kind: 'league' },
    ...findWiffleBrands(profiles).map(w => ({ blogId: Number(w.id), name: w.label || 'WIFFLE®', accent: WIFFLE_ACCENT, kind: 'wiffle' })),
  ].map(b => ({ ...b, picture: (profiles[b.blogId] || {}).picture || null }));

  const posts = [];
  await Promise.all(brands.map(async br => {
    const resp = await mc.api('/v2/analytics/brand-summary/posts', br.blogId, { from, to, timezone: TZ });
    const list = resp && Array.isArray(resp.data) ? resp.data : [];
    list.forEach((p, i) => {
      const m = p.metrics || {};
      const network = normNet(p.network);
      const dt = (p.publicationDate || {}).dateTime || '';
      const ms = Date.parse(dt.length === 19 ? dt + 'Z' : dt) || 0; // ordering only; same offset for every post
      const id = p.id || p.postId || p.mediaId || p.link || `${dt}#${i}`;
      const sv = pickMetric(m, SAVE_KEYS), sh = pickMetric(m, SHARE_KEYS);
      posts.push({
        key: `${br.blogId}:${network}:${id}`,
        blogId: br.blogId, kind: br.kind, network,
        type: String(p.type || 'OTHER').toUpperCase(),
        date: dt, ms,
        text: String(p.text || '').slice(0, 600),
        link: p.link || null, picture: p.picture || null,
        impressions: Math.round(m.IMPRESSIONS || 0), interactions: Math.round(m.INTERACTIONS || 0),
        engagement: round(Number(m.ENGAGEMENT) || 0, 2),
        saves: sv.has ? Math.round(sv.v) : null, shares: sh.has ? Math.round(sh.v) : null,
        _toks: tokens(p.text),
      });
    });
  }));
  const groups = autoGroup(posts);
  posts.forEach(p => { p.autoGroup = groups[p.key]; delete p._toks; delete p.ms; });
  posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { generatedAt: new Date().toISOString(), from, to, label, brands, posts };
}

// ── Tags: contractors, who made what, manual grouping ───────────────────────
const KEY = 'cc-post-tags';
const DEFAULT_CONTRACTORS = [
  { id: 'c_will', name: 'Will (Savant)', color: '#F3F3F1' },
  { id: 'c_ethan', name: 'Ethan Winer', color: '#5CE0E0' },
  { id: 'c_taylor', name: 'Taylor Cortez', color: '#FF6FCF' },
  { id: 'c_matt', name: 'Matt', color: '#FFB13C' },
  { id: 'c_cam', name: 'Cam', color: '#7CF1A8' },
];
const PALETTE = ['#5CE0E0', '#FF6FCF', '#FFB13C', '#7CF1A8', '#9AD1FF', '#C7F24E', '#B8A6FF', '#FF8A8A', '#DAC79C'];

async function readTags(sb) {
  const { data, error } = await sb.from('app_settings').select('value').eq('key', KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const v = (data && data.value) || {};
  return {
    contractors: Array.isArray(v.contractors) ? v.contractors : DEFAULT_CONTRACTORS,
    assign: v.assign && typeof v.assign === 'object' ? v.assign : {},
    groups: v.groups && typeof v.groups === 'object' ? v.groups : {},
  };
}

const keysOf = b => (Array.isArray(b.postKeys) ? b.postKeys : []).map(String).filter(k => k.length < 400).slice(0, 200);

export async function postTagsHandler(req, res, ctx) {
  const sb = ctx.sb;
  if (!sb) { res.status(503).json({ error: 'Supabase not configured' }); return; }
  try {
    if (req.method === 'GET') { res.status(200).json(await readTags(sb)); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'GET or POST' }); return; }
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const t = await readTags(sb);
    const op = String(body.op || '');
    if (op === 'contractors') {
      const list = (Array.isArray(body.contractors) ? body.contractors : []).slice(0, 40).map((c, i) => ({
        id: /^c_[a-z0-9_]{1,40}$/.test(String(c.id || '')) ? String(c.id) : `c_${Date.now().toString(36)}${i}`,
        name: String(c.name || '').trim().slice(0, 60),
        color: /^#[0-9a-f]{6}$/i.test(String(c.color || '')) ? c.color : PALETTE[i % PALETTE.length],
      })).filter(c => c.name);
      const ids = new Set(list.map(c => c.id));
      for (const k of Object.keys(t.assign)) if (!ids.has(t.assign[k])) delete t.assign[k]; // removed contractor: untag
      t.contractors = list;
    } else if (op === 'assign') {
      const cid = body.contractorId ? String(body.contractorId) : null;
      if (cid && !t.contractors.some(c => c.id === cid)) { res.status(400).json({ error: 'Unknown contractor' }); return; }
      for (const k of keysOf(body)) { if (cid) t.assign[k] = cid; else delete t.assign[k]; }
    } else if (op === 'group') {
      const keys = keysOf(body); const anchor = String(body.anchor || keys[0] || '');
      if (keys.length < 2 || !anchor) { res.status(400).json({ error: 'Pick at least two posts to group' }); return; }
      for (const k of keys) t.groups[k] = anchor;
    } else if (op === 'ungroup') {
      for (const k of keysOf(body)) t.groups[k] = 'solo';
    } else if (op === 'reset') {
      for (const k of keysOf(body)) delete t.groups[k];
    } else { res.status(400).json({ error: 'Unknown op' }); return; }
    const { error } = await sb.from('app_settings').upsert(
      { key: KEY, value: t, updated_at: new Date().toISOString(), updated_by: ctx.user.id }, { onConflict: 'key' });
    if (error) throw new Error(error.message);
    res.status(200).json(t);
  } catch (e) {
    res.status(400).json({ error: String((e && e.message) || e) });
  }
}
