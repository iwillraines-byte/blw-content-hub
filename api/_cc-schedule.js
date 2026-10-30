// api/_cc-schedule.js — rolling 7-day scheduled-post feed for every brand.
//
// Reads Metricool's planner (GET /v2/scheduler/posts) for each BLW team, the
// BLW league page and the WIFFLE® brand(s), and returns one flat list sorted
// by publish time. The window is always "now through 7 days from now", so the
// feed rolls forward on its own; the page re-polls every few minutes.

import { TZ, TEAMS, BLW_BRAND, WIFFLE_ACCENT, makeApi, loadProfiles, tzDate } from './_cc-core.js';
import { findWiffleBrands } from './_cc-wiffle.js';

const NET_ALIAS = { x: "twitter", twitter: "twitter", linkedincompany: "linkedin", linkedin: "linkedin", instagram: "instagram", tiktok: "tiktok", facebook: "facebook", youtube: "youtube", threads: "threads", pinterest: "pinterest", bluesky: "bluesky", gmb: "gmb" };
const normNet = n => NET_ALIAS[String(n || "").toLowerCase()] || String(n || "").toLowerCase();

// Offset (minutes) of a timezone at a given instant.
function tzOffsetMin(tz, date) {
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return (asUTC - date.getTime()) / 60000;
  } catch { return 0; }
}
// "2026-11-02T09:30:00" wall-clock in `tz` → epoch ms.
export function zonedToMs(local, tz) {
  const m = String(local || "").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) { const t = Date.parse(local); return Number.isFinite(t) ? t : NaN; }
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(local)) return Date.parse(local);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  let ms = guess - tzOffsetMin(tz, new Date(guess)) * 60000;
  ms = guess - tzOffsetMin(tz, new Date(ms)) * 60000; // second pass settles DST edges
  return ms;
}

function mediaOf(p) {
  const raw = Array.isArray(p.media) ? p.media : [];
  const urls = raw.map(x => typeof x === "string" ? x : (x && (x.url || x.mediaUrl || x.thumbnailUrl || x.src))).filter(Boolean);
  const thumbs = [p.thumbnail, p.thumbnailUrl, p.picture, p.videoThumbnailUrl, ...(p.mediaThumbnails || [])].filter(x => typeof x === "string");
  const isVid = u => /\.(mp4|mov|m4v|webm)(\?|$)/i.test(u);
  const image = thumbs[0] || urls.find(u => !isVid(u)) || null;
  const isVideo = urls.some(isVid);
  return { image, isVideo, count: urls.length };
}

function typeOf(p, nets) {
  const t = (p.instagramData && p.instagramData.type) || (p.facebookData && p.facebookData.type) || (p.youtubeData && p.youtubeData.type) || "";
  if (t) return String(t).toUpperCase();
  if (nets.includes("tiktok")) return "VIDEO";
  return "POST";
}

export async function buildScheduled(token, userId) {
  const mc = makeApi(token, userId);
  const profiles = await loadProfiles(mc.api);
  const wiffle = findWiffleBrands(profiles);
  const brands = [
    ...TEAMS.map(t => ({ blogId: t.blogId, name: t.name, accent: t.accent, kind: "team", teamId: t.teamId })),
    { blogId: BLW_BRAND.blogId, name: BLW_BRAND.name, accent: BLW_BRAND.accent, kind: "league" },
    ...wiffle.map(w => ({ blogId: Number(w.id), name: w.label || "WIFFLE®", accent: WIFFLE_ACCENT, kind: "wiffle" })),
  ].map(b => ({ ...b, picture: (profiles[b.blogId] || {}).picture || null }));

  const now = Date.now();
  const endMs = now + 7 * 86400000;
  const startDay = tzDate(new Date(now));
  const endDay = tzDate(new Date(endMs));
  const items = [], errors = [];

  await Promise.all(brands.map(async br => {
    const resp = await mc.api("/v2/scheduler/posts", br.blogId, {
      start: `${startDay}T00:00:00`, end: `${endDay}T23:59:59`, timezone: TZ, extendedRange: "false",
    });
    if (resp && resp._error) { errors.push(br.name); return; }
    const list = Array.isArray(resp) ? resp : (resp && Array.isArray(resp.data) ? resp.data : (resp && Array.isArray(resp.posts) ? resp.posts : []));
    for (const p of list) {
      const pd = p.publicationDate || {};
      const local = pd.dateTime || p.dateTime || p.date || "";
      const ms = zonedToMs(local, pd.timezone || p.timezone || TZ);
      if (!Number.isFinite(ms) || ms < now - 15 * 60000 || ms > endMs) continue;
      const providers = Array.isArray(p.providers) ? p.providers : [];
      const nets = [...new Set(providers.map(x => normNet(x.network || x.provider)).filter(Boolean))];
      const statuses = providers.map(x => String(x.status || "").toUpperCase()).filter(Boolean);
      if (statuses.length && statuses.every(s => s === "PUBLISHED")) continue;
      const media = mediaOf(p);
      items.push({
        id: String(p.id || p.uuid || `${br.blogId}-${ms}`),
        blogId: br.blogId, brand: br.name, accent: br.accent, kind: br.kind,
        at: new Date(ms).toISOString(),
        networks: nets,
        type: typeOf(p, nets),
        text: String(p.text || "").slice(0, 280),
        image: media.image, isVideo: media.isVideo, mediaCount: media.count,
        draft: !!p.draft,
        failed: statuses.some(s => s === "ERROR" || s === "FAILED"),
      });
    }
  }));
  items.sort((a, b) => a.at.localeCompare(b.at));
  return {
    generatedAt: new Date().toISOString(), timezone: TZ,
    from: new Date(now).toISOString(), to: new Date(endMs).toISOString(),
    brands, items, errors,
    windowLabel: `${startDay} to ${endDay}`,
  };
}
