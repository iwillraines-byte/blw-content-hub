// api/_cc-core.js — shared Metricool plumbing for the Command Center.
//
// Underscore-prefixed so Vercel does not deploy it as its own function. Used by
// api/metricool.js (league view + router) and the _cc-* view modules (WIFFLE,
// scheduled feed, post ideas).

export const BASE = "https://app.metricool.com/api";
export const TZ = "America/Chicago";
export const NETMAP = { instagram: "ig", tiktok: "tt", facebook: "fb" };

export const TEAMS = [
  { blogId: 6201154, name: "Arizona Saguaros",         accent: "#C7F24E", teamId: "AZS" },
  { blogId: 6201162, name: "Atlanta Ballers",          accent: "#9AD1FF", teamId: "ATL" },
  { blogId: 6201165, name: "Boston Harbor Hawks",      accent: "#DAC79C", teamId: "BOS" },
  { blogId: 6201157, name: "Chicago Bats",             accent: "#C0162B", teamId: "CHI" },
  { blogId: 6201149, name: "Dallas Pandas",            accent: "#E8B53A", teamId: "DAL" },
  { blogId: 6201166, name: "Las Vegas Scorpions",      accent: "#C4C9D2", teamId: "LV"  },
  { blogId: 6201159, name: "Los Angeles Naturals",     accent: "#2E63E8", teamId: "LAN" },
  { blogId: 6200089, name: "Miami Mirage",             accent: "#79E6C2", teamId: "MIA" },
  { blogId: 6201828, name: "Philadelphia Wiffle Club", accent: "#34489E", teamId: "PHI" },
];
export const BLW_BRAND = { blogId: 6532945, name: "BLW League Page", accent: "#7CF1A8", handle: "blwwiffleball" };
export const WIFFLE_ACCENT = "#F3F3F1";

export function round(v, nd = 0) { const f = Math.pow(10, nd); return Math.round((Number(v) || 0) * f) / f; }
export const sum = a => a.reduce((x, y) => x + y, 0);
export const sumVals = d => Object.values(d).reduce((a, b) => a + b, 0);
export const sumPairs = a => a.reduce((x, p) => x + p[1], 0);
export const cap = s => { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); };
export const pad = n => String(n).padStart(2, "0");
export const lastVal = d => { const ks = Object.keys(d).sort(); return ks.length ? d[ks[ks.length - 1]] : 0; };
export const nonEmpty = d => d && Object.keys(d).length > 0;

export function offsetStr(d) {
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
export function tzParts(d) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}
export const tzDate = d => { const p = tzParts(d); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
export const isoUTC = d => d.toISOString().replace(/\.\d{3}Z$/, "+00:00");
const monLabel = (y, m) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 15)));

export function windowRange(days, rng, custom) {
  const now = new Date();
  if (rng === "custom" && custom && /^\d{4}-\d{2}-\d{2}$/.test(custom.from) && /^\d{4}-\d{2}-\d{2}$/.test(custom.to)) {
    const [fy, fm, fd] = custom.from.split("-").map(Number);
    const [ty, tm, td] = custom.to.split("-").map(Number);
    const offS = offsetStr(new Date(Date.UTC(fy, fm - 1, fd, 6)));
    const offE = offsetStr(new Date(Date.UTC(ty, tm - 1, td, 6)));
    const fmtD = (y, m, d) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
    const sameYear = fy === ty;
    const label = fmtD(fy, fm, fd) + (sameYear ? "" : ", " + fy) + " to " + fmtD(ty, tm, td) + ", " + ty;
    return { from: `${custom.from}T00:00:00${offS}`, to: `${custom.to}T23:59:59${offE}`, label };
  }
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

// Parse a "YYYY-MM-DD" day out of whatever date shape Metricool hands back:
// ISO strings, "YYYYMMDD", epoch seconds or epoch milliseconds.
function dayOf(raw) {
  if (raw == null) return "";
  if (typeof raw === "number" || /^\d{10,13}$/.test(String(raw))) {
    const n = Number(raw); const ms = n < 1e12 ? n * 1000 : n;
    return tzDate(new Date(ms));
  }
  const s = String(raw);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s.slice(0, 10);
}

// Every Metricool call goes through here. `audit` records, per metric key,
// whether the call came back with data. The master-only Data check panel
// reads it so a wrong metric name shows up as "0 of 9 teams" instead of a
// silent zero on the dashboard.
export function makeApi(token, userId) {
  const audit = {};
  const note = (key, hasData) => {
    const a = audit[key] || (audit[key] = { calls: 0, withData: 0 });
    a.calls += 1; if (hasData) a.withData += 1;
  };
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
  // v2 timelines. `extra` carries network-specific params (metricType for
  // LinkedIn, postsType for YouTube).
  async function timeline(blogId, network, metric, from, to, subject, extra = {}) {
    const d = await api("/v2/analytics/timelines", blogId, { network, metric, from, to, timezone: TZ, subject, ...extra });
    const out = {};
    // Only the first series, same as the original implementation.
    const s = d && Array.isArray(d.data) ? d.data[0] : null;
    for (const v of (s && Array.isArray(s.values) ? s.values : [])) {
      const day = dayOf(v.dateTime || v.date); const val = Number(v.value);
      if (day && Number.isFinite(val)) out[day] = val;
    }
    note(`${network}:${metric}${subject ? "@" + subject : ""}`, nonEmpty(out));
    return out;
  }
  // Legacy /stats/timeline/{metric} — the only timeline X (Twitter) and
  // YouTube account metrics are served on. Dates are YYYYMMDD.
  async function legacyTimeline(blogId, network, metric, from, to) {
    const start = String(from).slice(0, 10).replace(/-/g, "");
    const end = String(to).slice(0, 10).replace(/-/g, "");
    const d = await api(`/stats/timeline/${metric}`, blogId, { start, end, timezone: TZ });
    const rows = Array.isArray(d) ? d : (d && Array.isArray(d.data) ? d.data : []);
    const out = {};
    for (const row of rows) {
      let day, val;
      if (Array.isArray(row)) { day = dayOf(row[0]); val = Number(row[1]); }
      else if (row && typeof row === "object") { day = dayOf(row.dateTime || row.date || row.day || row.x); val = Number(row.value ?? row.y); }
      if (day && Number.isFinite(val)) out[day] = val;
    }
    note(`${network}:${metric}`, nonEmpty(out));
    return out;
  }
  // First candidate that returns data wins. Each candidate is [metric, subject, extra?].
  async function firstTimeline(blogId, network, candidates, from, to) {
    for (const [metric, subject, extra] of candidates) {
      const d = await timeline(blogId, network, metric, from, to, subject, extra);
      if (nonEmpty(d)) return { data: d, used: `${metric}${subject ? "@" + subject : ""}` };
    }
    return { data: {}, used: null };
  }
  return { api, timeline, legacyTimeline, firstTimeline, audit, note };
}

export function dsum(...dicts) { const o = {}; for (const d of dicts) for (const k in d) o[k] = (o[k] || 0) + d[k]; return o; }
export function diffs(cum) { const ks = Object.keys(cum).sort(); const o = {}; for (let i = 1; i < ks.length; i++) o[ks[i]] = cum[ks[i]] - cum[ks[i - 1]]; return o; }
export function mergeDicts(dicts, how) {
  const keys = new Set(); dicts.forEach(d => Object.keys(d).forEach(k => keys.add(k)));
  const out = [];
  [...keys].sort().forEach(day => {
    const vals = dicts.filter(d => day in d).map(d => d[day]); if (!vals.length) return;
    out.push([day, how === "mean" ? sum(vals) / vals.length : sum(vals)]);
  });
  return out;
}
export function carrySum(dicts) {
  const keys = new Set(); dicts.forEach(d => Object.keys(d).forEach(k => keys.add(k)));
  const last = new Array(dicts.length).fill(null); const out = [];
  [...keys].sort().forEach(day => {
    let total = 0, seen = false;
    dicts.forEach((d, i) => { if (day in d) last[i] = d[day]; if (last[i] != null) { total += last[i]; seen = true; } });
    if (seen) out.push([day, total]);
  });
  return out;
}
export const slist = (d, nd = 0) => Object.keys(d).sort().map(k => ({ d: k, v: nd ? round(d[k], nd) : Math.round(d[k]) }));
export const fmtPairs = s => s.map(p => ({ d: p[0], v: round(p[1], 2) }));

// Per-post metric lookup that tolerates Metricool's key spellings.
export function pickMetric(m, keys) {
  for (const k of keys) if (m && m[k] != null && Number.isFinite(Number(m[k]))) return { has: true, v: Number(m[k]) };
  return { has: false, v: 0 };
}
export const SAVE_KEYS = ["SAVES", "SAVED", "SAVE", "saves", "saved"];
export const SHARE_KEYS = ["SHARES", "SHARE", "shares"];

// simpleProfiles key → our network name.
export const PROFILE_NETS = {
  instagram: "instagram", tiktok: "tiktok", facebook: "facebook", twitter: "twitter",
  linkedinCompany: "linkedin", linkedin: "linkedin", youtube: "youtube", threads: "threads",
  pinterest: "pinterest", bluesky: "bluesky",
};

export async function loadProfiles(api) {
  const data = await api("/admin/simpleProfiles", "", {});
  const prof = {}; const list = [];
  if (Array.isArray(data)) {
    for (const b of data) {
      const h = {}; for (const net of ["instagram", "tiktok", "facebook"]) if (b[net]) h[net] = b[net];
      const networks = {};
      for (const [k, net] of Object.entries(PROFILE_NETS)) if (b[k] && !networks[net]) networks[net] = typeof b[k] === "string" ? b[k] : (b[k].name || b[k].username || b[k].id || true);
      const label = b.label || b.name || b.title || b.blogName || "";
      prof[b.id] = { picture: b.picture || null, handles: h, networks, label };
      list.push({ id: b.id, label, picture: b.picture || null, networks });
    }
  }
  prof._list = list;
  return prof;
}
