// api/emv-public.js — PUBLIC, read-only EMV summary for dashboard embeds
// (e.g. a ClickUp dashboard card).
//
// This is the ONLY unauthenticated endpoint that touches Metricool data, so it
// is deliberately narrow:
//   * Requires ?key= matching EMV_EMBED_KEY (server-only env var, unguessable).
//   * Returns ONLY aggregate EMV figures. No post text, no links, no follower
//     series, no Metricool credentials, nothing per-person.
//   * Anyone holding the link can read these numbers. Treat the key as a
//     secret; rotate it by changing EMV_EMBED_KEY in Vercel.
//
// EMV formula matches Socialpruf exactly:  (views / 1000) * CPM + interactions * rate
// Socialpruf's own benchmark is $20 CPM, $0.25/like, $1.25/comment. Metricool
// returns interactions combined, so we use one per-interaction rate ($0.25).
// Deliberately excludes followers and the saves/shares premium — those are
// additions beyond Socialpruf and would make this number stop reconciling.
//
// Env vars:  EMV_EMBED_KEY, METRICOOL_TOKEN, METRICOOL_USER_ID
//            EMV_CPM (optional, default 20), EMV_PER_INTERACTION (optional, default 0.25)

const BASE = "https://app.metricool.com/api";
const TZ = "America/Chicago";

const TEAMS = [
  { blogId: 6201154, name: "Arizona Saguaros", accent: "#C7F24E" },
  { blogId: 6201162, name: "Atlanta Ballers", accent: "#9AD1FF" },
  { blogId: 6201165, name: "Boston Harbor Hawks", accent: "#DAC79C" },
  { blogId: 6201157, name: "Chicago Bats", accent: "#C0162B" },
  { blogId: 6201149, name: "Dallas Pandas", accent: "#E8B53A" },
  { blogId: 6201166, name: "Las Vegas Scorpions", accent: "#C4C9D2" },
  { blogId: 6201159, name: "Los Angeles Naturals", accent: "#2E63E8" },
  { blogId: 6200089, name: "Miami Mirage", accent: "#79E6C2" },
  { blogId: 6201828, name: "Philadelphia Wiffle Club", accent: "#34489E" },
];
const BLW = { blogId: 6532945, name: "BLW League Page", accent: "#7CF1A8" };

const pad = (n) => String(n).padStart(2, "0");
const isoUTC = (d) => d.toISOString().replace(/\.\d{3}Z$/, "+00:00");

function tzParts(d) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}
function offsetStr(d) {
  try {
    const v = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
      .formatToParts(d).find((p) => p.type === "timeZoneName").value;
    const m = v.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
    if (!m) return "+00:00";
    return `${m[1][0]}${pad(Math.abs(parseInt(m[1], 10)))}:${m[2] || "00"}`;
  } catch { return "+00:00"; }
}
const monLabel = (y, m) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" })
    .format(new Date(Date.UTC(y, m - 1, 15)));

function windows() {
  const now = new Date();
  const p = tzParts(now);
  const mtdOff = offsetStr(new Date(Date.UTC(p.y, p.m - 1, 1, 6)));
  const mtd = {
    id: "mtd",
    label: "Month to date",
    sub: monLabel(p.y, p.m),
    from: `${p.y}-${pad(p.m)}-01T00:00:00${mtdOff}`,
    to: isoUTC(now),
  };
  let py = p.y, pm = p.m - 1;
  if (pm < 1) { pm = 12; py--; }
  const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const prev = {
    id: "prev_month",
    label: "Last month",
    sub: monLabel(py, pm),
    from: `${py}-${pad(pm)}-01T00:00:00${offsetStr(new Date(Date.UTC(py, pm - 1, 1, 6)))}`,
    to: `${py}-${pad(pm)}-${pad(lastDay)}T23:59:59${offsetStr(new Date(Date.UTC(py, pm - 1, lastDay, 6)))}`,
  };
  const q = {
    id: "last90",
    label: "Last 3 months",
    sub: "rolling 90 days",
    from: isoUTC(new Date(Date.now() - 90 * 86400000)),
    to: isoUTC(now),
  };
  return [mtd, prev, q];
}

async function posts(blogId, from, to, token, userId) {
  const q = new URLSearchParams({ userId: String(userId), blogId: String(blogId), from, to, timezone: TZ });
  try {
    const r = await fetch(`${BASE}/v2/analytics/brand-summary/posts?${q}`, {
      headers: { "X-Mc-Auth": token, Accept: "application/json" },
    });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d?.data) ? d.data : [];
  } catch { return []; }
}

function tally(list) {
  let views = 0, interactions = 0;
  for (const p of list) {
    const m = p.metrics || {};
    views += Math.round(m.IMPRESSIONS || 0);
    interactions += Math.round(m.INTERACTIONS || 0);
  }
  return { views, interactions, posts: list.length };
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  const expected = process.env.EMV_EMBED_KEY;
  if (!expected || String(expected).length < 16) {
    res.status(503).json({ error: "EMV_EMBED_KEY not configured on the server" });
    return;
  }
  const given = String(req.query?.key || "");
  // Constant-time-ish compare: equal length check first, then char accumulation.
  let ok = given.length === expected.length;
  for (let i = 0; i < expected.length; i++) ok = ok && given[i] === expected[i];
  if (!ok) {
    res.status(403).json({ error: "Invalid key" });
    return;
  }

  const token = process.env.METRICOOL_TOKEN;
  const userId = process.env.METRICOOL_USER_ID;
  if (!token || !userId) {
    res.status(500).json({ error: "Metricool credentials not configured" });
    return;
  }

  const CPM = Number(process.env.EMV_CPM || 20);
  const PER = Number(process.env.EMV_PER_INTERACTION || 0.25);
  const emv = (v, i) => v / 1000 * CPM + i * PER;

  try {
    const wins = windows();
    const out = [];
    for (const w of wins) {
      const teamLists = await Promise.all(TEAMS.map((t) => posts(t.blogId, w.from, w.to, token, userId)));
      const blwList = await posts(BLW.blogId, w.from, w.to, token, userId);

      const teams = TEAMS.map((t, i) => {
        const s = tally(teamLists[i]);
        return { name: t.name, accent: t.accent, views: s.views, interactions: s.interactions, posts: s.posts, emv: Math.round(emv(s.views, s.interactions)) };
      }).sort((a, b) => b.emv - a.emv);

      const bs = tally(blwList);
      const blw = { name: BLW.name, accent: BLW.accent, views: bs.views, interactions: bs.interactions, posts: bs.posts, emv: Math.round(emv(bs.views, bs.interactions)) };
      const teamsTotal = teams.reduce((a, t) => a + t.emv, 0);

      out.push({
        id: w.id, label: w.label, sub: w.sub,
        blw, teams,
        totals: {
          emv: teamsTotal + blw.emv,
          teamsEmv: teamsTotal,
          blwEmv: blw.emv,
          views: teams.reduce((a, t) => a + t.views, 0) + blw.views,
          posts: teams.reduce((a, t) => a + t.posts, 0) + blw.posts,
        },
      });
    }
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
    res.status(200).send(JSON.stringify({
      generatedAt: new Date().toISOString(),
      rates: { cpm: CPM, perInteraction: PER, basis: "Socialpruf: (views / 1000) x CPM + interactions x rate" },
      windows: out,
    }));
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
