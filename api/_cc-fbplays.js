// Facebook reel views, counted the way Facebook counts them.
//
// Metricool's cross-network post list (brand-summary/posts) reports a Facebook
// reel's views as 3-second plays, so a reel the Facebook app shows at 828k
// arrives as ~451k. Metricool's Facebook Reels list carries Facebook's own
// play count (blueReelsPlayCount: every play of 1ms or more, which is what the
// app shows). This swaps that number in for every Facebook reel, keeping the
// 3-second figure alongside it. Non-reel Facebook posts are unchanged.
import { TZ } from './_cc-core.js';

const reelIdOf = s => { const m = String(s || '').match(/\/reels?\/(\d{6,})/) || String(s || '').match(/[?&](?:v|video_id)=(\d{6,})/) || String(s || '').match(/\/videos\/(\d{6,})/); return m ? m[1] : null; };

// blogId -> Map(reelId -> plays), memoized per api instance and window.
const MEMO = new WeakMap();
async function reelPlays(mc, blogId, from, to) {
  let byApi = MEMO.get(mc); if (!byApi) { byApi = new Map(); MEMO.set(mc, byApi); }
  const key = `${blogId}|${String(from).slice(0, 13)}|${String(to).slice(0, 13)}`;
  if (!byApi.has(key)) byApi.set(key, (async () => {
    const out = new Map();
    try {
      const r = await mc.api('/v2/analytics/reels/facebook', blogId, { from, to, timezone: TZ });
      const list = Array.isArray(r) ? r : (r && Array.isArray(r.data) ? r.data : []);
      for (const x of list) {
        const plays = Number(x.blueReelsPlayCount ?? x.fbReelsTotalPlays ?? x.plays);
        if (!Number.isFinite(plays)) continue;
        const ids = [x.reelId, x.postId, x.videoId, reelIdOf(x.reelUrl), reelIdOf(x.videoUrl)].filter(Boolean).map(String);
        for (const id of ids) out.set(id, plays);
      }
    } catch (e) { /* keep Metricool's numbers if the reels list fails */ }
    return out;
  })());
  return byApi.get(key);
}

const isFbReel = p => String(p.network || '').toLowerCase() === 'facebook' && (/REEL/i.test(String(p.type || '')) || /\/reels?\//.test(String(p.link || '')));

// Returns a copy of a brand's raw post list with Facebook reel views replaced
// by Facebook's play count where Metricool has it. metrics.IMPRESSIONS_3S
// keeps the original 3-second number; metrics.FB_PLAYS marks the swap.
export async function withFbPlays(mc, blogId, list, from, to) {
  if (!Array.isArray(list) || !list.some(isFbReel)) return list;
  const plays = await reelPlays(mc, blogId, from, to);
  if (!plays.size) return list;
  return list.map(p => {
    if (!isFbReel(p)) return p;
    const id = reelIdOf(p.link) || (p.id != null ? String(p.id) : null);
    const v = id != null ? plays.get(id) : undefined;
    if (v == null) return p;
    const m = p.metrics || {};
    return { ...p, metrics: { ...m, IMPRESSIONS_3S: m.IMPRESSIONS, IMPRESSIONS: Math.max(v, Number(m.IMPRESSIONS) || 0), FB_PLAYS: v } };
  });
}

// Fetch a brand's posts from brand-summary/posts with Facebook reels already
// counted as plays. Drop-in for the plain api call.
export async function fetchPosts(mc, blogId, from, to) {
  const r = await mc.api('/v2/analytics/brand-summary/posts', blogId, { from, to, timezone: TZ });
  const list = r && Array.isArray(r.data) ? r.data : [];
  return { ...(r || {}), data: await withFbPlays(mc, blogId, list, from, to) };
}
