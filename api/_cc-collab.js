// Collab views go to the account that posted the video.
//
// When BLW and a team share an Instagram collab, Instagram lists the post only
// under the account that posted it (so post views are already counted once),
// but it adds the post's views to BOTH accounts' account-level "views" from
// the moment the collaborator joins. Metricool reports account views as one
// daily total per account, so that overlap can't be read off directly.
//
// This finds it the only way the data allows: a day where an account's
// Instagram views far exceed what its own posts can explain, while another
// BLW account published an Instagram post big enough to account for it. The
// smaller of the two (the unexplained views, or that post's views) is taken
// off the collaborator's account views for those days, so the views stay with
// the original poster only. Every adjustment is listed in Data check, where
// it can be dismissed if it isn't a collab.
import { platformPostId } from './_cc-ledger.js';

const median = a => { const s = [...a].sort((x, y) => x - y); if (!s.length) return 0; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const addDay = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dayOf = p => String(((p && p.publicationDate) || {}).dateTime || '').slice(0, 10);

// Instagram posts from the ledger: [{ blogId, day, views, cid, text, link }]
export function igPostsFromLedger(ledger) {
  const out = [];
  for (const [blogId, list] of Object.entries((ledger && ledger.postsByBlog) || {})) {
    for (const p of list || []) {
      if (String(p.network || '').toLowerCase() !== 'instagram') continue;
      const day = dayOf(p); if (!day) continue;
      out.push({ blogId: Number(blogId), day, views: Math.round(((p.metrics || {}).IMPRESSIONS) || 0), cid: platformPostId(p), text: String(p.text || '').slice(0, 120), link: p.link || null });
    }
  }
  return out;
}

// accounts: [{ blogId, name, daily: [{ d, v }] }]  (Instagram account views)
// posts:    igPostsFromLedger(...)
// flags:    { [findingId]: "dismissed" }
export function detectCollabViews(accounts, posts, flags = {}, names = {}) {
  const findings = [];
  for (const acct of accounts) {
    const daily = (acct.daily || []).filter(p => Number.isFinite(p.v));
    if (daily.length < 3) continue;
    const base = median(daily.map(p => p.v));
    const own = posts.filter(p => p.blogId === Number(acct.blogId));
    // Views this account's own posts could explain on a day: posts from that
    // day and the two before, at their full lifetime views (generous on purpose).
    const ownOn = d => own.filter(p => p.day <= d && p.day >= addDay(d, -2)).reduce((a, p) => a + p.views, 0);
    const excess = daily.map(p => ({ d: p.d, x: Math.max(0, p.v - base - ownOn(p.d)) }));
    // Only clear jumps: at least 100k and ten normal days' worth. Smaller
    // wobbles are left alone rather than guessed at.
    const floor = Math.max(100000, base * 10);
    // Group consecutive big days into episodes.
    let ep = null; const eps = [];
    for (const e of excess) {
      if (e.x >= floor) { if (ep && addDay(ep.end, 1) === e.d) { ep.end = e.d; ep.days.push(e); ep.x += e.x; } else { ep = { start: e.d, end: e.d, days: [e], x: e.x }; eps.push(ep); } }
      else ep = null;
    }
    for (const e of eps) {
      // Another BLW account's Instagram post from up to 2 days before through
      // the episode, big enough to explain at least a third of it.
      // Best match: published closest to when the jump started, with views
      // closest to the unexplained amount.
      const gap = d => Math.abs((Date.parse(e.start + 'T12:00:00Z') - Date.parse(d + 'T12:00:00Z')) / 86400000);
      const score = p => gap(p.day) + Math.abs(Math.log(p.views / e.x));
      const cands = posts.filter(p => p.blogId !== Number(acct.blogId) && p.day >= addDay(e.start, -2) && p.day <= e.end && p.views >= e.x / 2)
        .sort((a, b) => score(a) - score(b));
      if (!cands.length) continue;
      const c = cands[0];
      // A collab can't add views before its post existed.
      const days = e.days.filter(d => d.d >= c.day);
      const x = days.reduce((a, d) => a + d.x, 0);
      if (x < floor) continue;
      const overlap = Math.round(Math.min(x, c.views));
      const id = `${acct.blogId}:${days[0].d}:${c.cid || c.day}`;
      findings.push({
        id, blogId: Number(acct.blogId), name: acct.name, start: days[0].d, end: days[days.length - 1].d,
        reportedOnDays: Math.round(days.reduce((a, d) => a + (daily.find(p => p.d === d.d) || {}).v, 0)),
        baseline: Math.round(base), unexplained: Math.round(x), overlap,
        share: Object.fromEntries(days.map(d => [d.d, d.x / x])),
        post: { blogId: c.blogId, owner: names[c.blogId] || String(c.blogId), cid: c.cid, day: c.day, views: c.views, text: c.text, link: c.link },
        status: flags[id] === 'dismissed' ? 'dismissed' : 'applied',
      });
    }
  }
  return findings;
}

// Take applied findings off a daily series ({d,v}[]), spread over each
// episode's days in proportion to that day's unexplained views.
export function adjustDaily(daily, findings) {
  const cut = {};
  for (const f of findings) if (f.status === 'applied') for (const [d, s] of Object.entries(f.share)) cut[d] = (cut[d] || 0) + f.overlap * s;
  return (daily || []).map(p => ({ d: p.d, v: Math.max(0, Math.round(p.v - (cut[p.d] || 0))) }));
}
export const appliedOverlap = findings => findings.filter(f => f.status === 'applied').reduce((a, f) => a + f.overlap, 0);
