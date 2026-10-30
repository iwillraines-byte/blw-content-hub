// api/_cc-ideas.js — contextual post ideas for one brand, for the Command Center.
//
// Each request builds a brief for ONE brand (a BLW team, the BLW league page,
// or WIFFLE®) from five sources, then asks Claude for ideas grounded only in
// that brief:
//   1. League state from Grand Slam Systems: final/regular standings,
//      postseason results, recent and upcoming games, stat leaders, OPWR movers
//   2. League narratives the master admin typed into BLW Studio (league_context)
//   3. The brand's voice guideline (app_settings brand-voice-{TEAMID})
//   4. Real assets from Shade (semantic search, folder paths, AI descriptions,
//      tagged team / player / content type), so ideas point at footage we have
//   5. Social performance from the dashboard itself (top posts, best formats,
//      growth, players driving traffic) plus what is already scheduled
//
// Env: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (optional),
//      SHADE_API_KEY (optional; ideas still work without assets)

import { TEAMS, BLW_BRAND, tzDate } from './_cc-core.js';
import { SCHEDULE } from '../src/schedule-data.js';
import { SHADE_BASE, DRIVE_ID, FIELD, KNOWN_COLLECTIONS, getOptionMaps, metaValue, previewUrlOf, shadeHeaders } from './shade.js';
import { clampVoice } from './_brand-voice.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const GSS = 'https://app.grandslamsystems.com/api';
const LEAGUE_ID = 3;
const SEASON_START = '2026-06-07';
const ABBR = { LA: 'LAN', AZ: 'AZS', SD: 'ATL', ATL: 'ATL', LV: 'LV', NY: 'NYG', BOS: 'BOS', DAL: 'DAL', PHI: 'PHI', CHI: 'CHI', MIA: 'MIA' };
const TEAM_NAME = { LAN: 'Los Angeles Naturals', AZS: 'Arizona Saguaros', ATL: 'Atlanta Ballers', LV: 'Las Vegas Scorpions', NYG: 'New York Green Apples', BOS: 'Boston Harbor Hawks', DAL: 'Dallas Pandas', PHI: 'Philadelphia Wiffle Club', CHI: 'Chicago Bats', MIA: 'Miami Mirage' };
const POST_DATES = new Set(SCHEDULE.filter(d => d.type === 'postseason').map(d => d.date));
const ROUND_BY_DATE_TEAMS = (() => {
  const m = {};
  for (const d of SCHEDULE) for (const g of d.games || []) if (g.round) m[`${d.date}|${[g.team1, g.team2].sort().join('-')}`] = g.round;
  return m;
})();

const memo = new Map();
async function remember(key, ttl, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await fn();
  memo.set(key, { at: Date.now(), value });
  return value;
}

async function getJSON(url, init) {
  try {
    const r = await fetch(url, { ...(init || {}), headers: { Accept: 'application/json', 'User-Agent': 'BLW-Command-Center/1.0', ...((init && init.headers) || {}) } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── 1. League brief from GSS ───────────────────────────────────────────────
async function leagueBrief(rosterByTeamName) {
  return remember('league', 15 * 60 * 1000, async () => {
    const [gamesRaw, bat, pit, ranks] = await Promise.all([
      getJSON(`${GSS}/leagues/${LEAGUE_ID}/games?pageSize=500&page=1`),
      getJSON(`${GSS}/leagues/${LEAGUE_ID}/batting-stats?showAll=true`),
      getJSON(`${GSS}/leagues/${LEAGUE_ID}/pitching-stats?showAll=true`),
      getJSON(`${GSS}/rankings/0?showAll=true`),
    ]);
    const games = (gamesRaw && Array.isArray(gamesRaw.items) ? gamesRaw.items : []).map(g => ({
      date: String(g.dateTime || '').slice(0, 10), dateTime: g.dateTime, status: String(g.status || ''),
      home: ABBR[String(g.homeAbbreviation || '').toUpperCase()] || null, away: ABBR[String(g.awayAbbreviation || '').toUpperCase()] || null,
      hs: g.homeScore, as: g.awayScore,
    })).filter(g => g.home && g.away && g.date >= SEASON_START);
    const done = games.filter(g => g.status === 'SUBMITTED' && g.hs != null && g.as != null);
    const rec = {};
    for (const g of done.filter(x => !POST_DATES.has(x.date))) {
      for (const [me, op, rs, ra] of [[g.home, g.away, g.hs, g.as], [g.away, g.home, g.as, g.hs]]) {
        const r = rec[me] || (rec[me] = { w: 0, l: 0, rs: 0, ra: 0 });
        r.rs += rs; r.ra += ra; if (rs > ra) r.w++; else if (ra > rs) r.l++;
      }
    }
    const standings = Object.entries(rec).map(([id, r]) => ({ id, ...r, pct: r.w + r.l ? r.w / (r.w + r.l) : 0 }))
      .sort((a, b) => b.pct - a.pct || (b.rs - b.ra) - (a.rs - a.ra));
    const post = done.filter(x => POST_DATES.has(x.date)).sort((a, b) => a.dateTime.localeCompare(b.dateTime)).map(g => ({
      ...g, round: ROUND_BY_DATE_TEAMS[`${g.date}|${[g.home, g.away].sort().join('-')}`] || 'Postseason',
    }));
    const recent = [...done].sort((a, b) => b.dateTime.localeCompare(a.dateTime)).slice(0, 10);
    const today = tzDate(new Date());
    const upcoming = games.filter(g => g.status !== 'SUBMITTED' && g.date >= today).sort((a, b) => a.dateTime.localeCompare(b.dateTime)).slice(0, 10);
    const nextSlate = SCHEDULE.filter(d => d.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] || null;

    const blwNames = new Set(Object.values(rosterByTeamName || {}).flat().map(n => String(n).toLowerCase()));
    const batting = (bat && Array.isArray(bat.statistics) ? bat.statistics : []).map(p => ({
      name: p.playerName, team: ABBR[String(p.team?.abbreviation || '').toUpperCase()] || null,
      pa: p.plateAppearances || 0, hr: p.homeruns || 0, avg: p.battingAverage, ops: p.ops, opsPlus: p.opsPlus || 0, rbi: p.rbi || 0, bwar: p.bwar,
    })).filter(p => p.pa >= 8);
    const pitching = (pit && Array.isArray(pit.statistics) ? pit.statistics : []).map(p => ({
      name: p.playerName, team: ABBR[String(p.team?.abbreviation || '').toUpperCase()] || null,
      ip: parseFloat(p.inningsPitched) || 0, era: p.era, fip: p.fip, k: p.strikeouts ?? p.strikeoutsThrown ?? 0, w: p.wins || 0, l: p.losses || 0, whip: p.whip,
    })).filter(p => p.ip >= 3);
    const movers = (Array.isArray(ranks) ? ranks : []).map(p => ({ name: `${p.firstName} ${p.lastName}`, rank: p.currentRank, change: (p.previousRank || 0) - (p.currentRank || 0) }))
      .filter(p => blwNames.size === 0 || blwNames.has(p.name.toLowerCase()))
      .filter(p => p.rank && Math.abs(p.change) >= 5).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 8);
    return { standings, post, recent, upcoming, nextSlate, batting, pitching, movers, today, ok: !!gamesRaw };
  });
}

const f3 = v => (v == null || !Number.isFinite(Number(v))) ? '-' : Number(v).toFixed(3).replace(/^0\./, '.');
const f2 = v => (v == null || !Number.isFinite(Number(v))) ? '-' : Number(v).toFixed(2);
const tn = id => TEAM_NAME[id] || id;

function leagueText(L, focusTeamId) {
  if (!L || !L.ok) return 'League feed unavailable right now. Do not invent standings, scores or stats.';
  const lines = [];
  const lastGame = L.recent[0];
  const inSeason = L.upcoming.length > 0 || (lastGame && (Date.parse(L.today) - Date.parse(lastGame.date)) / 86400000 < 10);
  lines.push(`TODAY: ${L.today}. ${inSeason ? 'The BLW season is active.' : `The BLW season is OVER (last game ${lastGame ? lastGame.date : 'unknown'}). This is the offseason: no games to preview. Lean on recaps, anniversaries, player stories, offseason moves, and the road to next season.`}`);
  if (L.standings.length) lines.push('REGULAR-SEASON STANDINGS: ' + L.standings.map((s, i) => `${i + 1}. ${tn(s.id)} ${s.w}-${s.l} (run diff ${s.rs - s.ra >= 0 ? '+' : ''}${s.rs - s.ra})`).join('; '));
  if (L.post.length) lines.push('POSTSEASON RESULTS: ' + L.post.map(g => `${g.date} ${g.round}: ${tn(g.home)} ${g.hs}, ${tn(g.away)} ${g.as}`).join('; '));
  if (L.upcoming.length) lines.push('UPCOMING GAMES: ' + L.upcoming.map(g => `${g.dateTime} ${tn(g.away)} at ${tn(g.home)}`).join('; '));
  else if (L.nextSlate) lines.push(`NEXT SCHEDULED SLATE: ${L.nextSlate.date} at ${L.nextSlate.venue || 'TBD'}`);
  if (L.recent.length && inSeason) lines.push('RECENT RESULTS: ' + L.recent.slice(0, 6).map(g => `${g.date} ${tn(g.home)} ${g.hs}, ${tn(g.away)} ${g.as}`).join('; '));
  const topBat = [...L.batting].sort((a, b) => b.opsPlus - a.opsPlus).slice(0, 6);
  if (topBat.length) lines.push('LEAGUE BATTING LEADERS (OPS+): ' + topBat.map(p => `${p.name} (${p.team}) OPS+ ${Math.round(p.opsPlus)}, ${f3(p.avg)} AVG, ${p.hr} HR`).join('; '));
  const hrLead = [...L.batting].sort((a, b) => b.hr - a.hr).slice(0, 3);
  if (hrLead.length && hrLead[0].hr) lines.push('HOME RUN LEADERS: ' + hrLead.map(p => `${p.name} (${p.team}) ${p.hr}`).join('; '));
  const topPit = [...L.pitching].sort((a, b) => (a.fip ?? 99) - (b.fip ?? 99)).slice(0, 5);
  if (topPit.length) lines.push('LEAGUE PITCHING LEADERS (FIP): ' + topPit.map(p => `${p.name} (${p.team}) ${f2(p.fip)} FIP, ${f2(p.era)} ERA, ${p.k} K, ${p.w}-${p.l}`).join('; '));
  if (L.movers.length) lines.push('OPWR RANK MOVERS: ' + L.movers.map(m => `${m.name} ${m.change > 0 ? 'up' : 'down'} ${Math.abs(m.change)} to #${m.rank}`).join('; '));
  if (focusTeamId) {
    const st = L.standings.findIndex(s => s.id === focusTeamId);
    const s = L.standings[st];
    const tb = L.batting.filter(p => p.team === focusTeamId).sort((a, b) => b.opsPlus - a.opsPlus).slice(0, 4);
    const tp = L.pitching.filter(p => p.team === focusTeamId).sort((a, b) => (a.fip ?? 99) - (b.fip ?? 99)).slice(0, 3);
    const tpost = L.post.filter(g => g.home === focusTeamId || g.away === focusTeamId);
    lines.push(`FOCUS TEAM ${tn(focusTeamId)}: ${s ? `finished #${st + 1} at ${s.w}-${s.l}, run diff ${s.rs - s.ra >= 0 ? '+' : ''}${s.rs - s.ra}` : 'no record found'}.`);
    if (tpost.length) lines.push(`  Postseason: ${tpost.map(g => `${g.round} ${tn(g.home)} ${g.hs}, ${tn(g.away)} ${g.as}`).join('; ')}`);
    else if (s) lines.push('  Did not play in the postseason.');
    if (tb.length) lines.push('  Top hitters: ' + tb.map(p => `${p.name} OPS+ ${Math.round(p.opsPlus)}, ${f3(p.avg)} AVG, ${p.hr} HR, ${p.rbi} RBI`).join('; '));
    if (tp.length) lines.push('  Top arms: ' + tp.map(p => `${p.name} ${f2(p.fip)} FIP, ${f2(p.era)} ERA, ${p.k} K in ${p.ip} IP`).join('; '));
  }
  return lines.join('\n');
}

// ── 2/3. League narratives + brand voice from Supabase ──────────────────────
async function supabaseContext(sb, voiceKey) {
  if (!sb) return { notes: '', voice: '' };
  const [ctx, voice] = await Promise.all([
    sb.from('league_context').select('notes, updated_at').eq('id', 1).maybeSingle().then(r => r.data || null, () => null),
    voiceKey ? sb.from('app_settings').select('key, value').eq('key', voiceKey).maybeSingle().then(r => r.data || null, () => null) : null,
  ]);
  const v = voice && voice.value;
  const vText = typeof v === 'string' ? v : (v && (v.text || v.voice)) || '';
  return { notes: String((ctx && ctx.notes) || '').slice(0, 5000), notesUpdated: ctx && ctx.updated_at, voice: clampVoice(vText) };
}

// ── 4. Shade assets ────────────────────────────────────────────────────────
const UUIDish = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
function pickStr(...vals) { for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim(); return ''; }
function folderOf(path) { const p = String(path || ''); const i = p.lastIndexOf('/'); return i > 0 ? p.slice(0, i) : ''; }

function mapAsset(a, maps) {
  const idToName = {};
  for (const which of ['team', 'player', 'type']) for (const [name, id] of Object.entries((maps && maps[which]) || {})) idToName[String(id).toLowerCase()] = name;
  const resolve = v => {
    const arr = Array.isArray(v) ? v : (v == null ? [] : [v]);
    return arr.map(x => (x && typeof x === 'object') ? (x.name || x.label || x.value || '') : String(x)).map(x => idToName[x.toLowerCase()] || x).filter(x => x && !UUIDish.test(x));
  };
  const md = a.custom_metadata || a.metadata || {};
  const extra = [];
  for (const [k, v] of Object.entries(md)) {
    if ([FIELD.team, FIELD.player, FIELD.type, 'Teams', 'Player', 'Content Type'].includes(k)) continue;
    const vals = resolve(v); if (vals.length && !UUIDish.test(k) && vals.join('').length < 60) extra.push(`${k}: ${vals.join(', ')}`);
  }
  const path = pickStr(a.path, a.full_path, a.fullPath, a.file_path);
  return {
    id: a.id || a.asset_id,
    name: pickStr(a.name, a.filename, a.file_name),
    folder: folderOf(path),
    kind: pickStr(a.type, a.asset_type, a.file_type, a.mime_type).toUpperCase().replace(/\/.*/, '') || (/\.(mp4|mov|m4v)$/i.test(a.name || '') ? 'VIDEO' : 'IMAGE'),
    created: pickStr(a.created_at, a.createdAt, a.created).slice(0, 10),
    teams: resolve(metaValue(a, FIELD.team, 'Teams')),
    player: resolve(metaValue(a, FIELD.player, 'Player'))[0] || '',
    contentType: resolve(metaValue(a, FIELD.type, 'Content Type'))[0] || '',
    description: pickStr(a.ai_description, a.aiDescription, a.description, a.summary, a.caption).slice(0, 220),
    tags: extra.slice(0, 4),
    previewUrl: previewUrlOf(a),
  };
}

async function shadeSearch(key, payload, url = `${SHADE_BASE}/search`) {
  const raw = await getJSON(url, { method: 'POST', headers: shadeHeaders(key), body: JSON.stringify(payload) });
  if (!raw) return [];
  return Array.isArray(raw) ? raw : (raw.assets || raw.results || raw.data || raw.items || []);
}

async function shadeAssets(brand, players) {
  const key = process.env.SHADE_API_KEY || '';
  if (!key) return { assets: [], note: 'SHADE_API_KEY not set' };
  return remember(`shade|${brand.key}`, 10 * 60 * 1000, async () => {
    let maps = null; try { maps = await getOptionMaps(key); } catch { maps = null; }
    const queries = brand.kind === 'wiffle'
      ? ['WIFFLE ball backyard', 'vintage WIFFLE commercial', 'Shelton Connecticut WIFFLE factory']
      : brand.kind === 'league'
        ? ['BLW championship celebration', 'BLW playoffs highlight', 'pregame interview']
        : [`${brand.name}`, ...(players || []).slice(0, 2).map(p => `${p} ${brand.name}`)];
    const found = [];
    for (const q of queries) found.push(...await shadeSearch(key, { drive_id: DRIVE_ID, query: q, limit: 25 }));
    if (brand.kind === 'wiffle') found.push(...await shadeSearch(key, { drive_id: DRIVE_ID, path: '/WIFFLE INC DROPS', recursive: true, limit: 60, offset: 0 }, `${SHADE_BASE}/search/files`));
    if (!found.length && brand.kind !== 'wiffle') {
      // Semantic search unavailable: fall back to the curated collections and
      // keep assets tagged with this team.
      for (const c of KNOWN_COLLECTIONS.slice(0, 2)) found.push(...await shadeSearch(key, { drive_id: DRIVE_ID, collection_id: c.id, limit: 120, offset: 0 }));
    }
    const seen = new Set(), perFolder = {}, out = [];
    const want = String(brand.shadeTeam || '').toLowerCase();
    for (const a of found) {
      const m = mapAsset(a, maps);
      if (!m.id || seen.has(m.id)) continue;
      // Team and league ideas should not pull WIFFLE® brand drops.
      if (brand.kind !== 'wiffle' && /wiffle inc/i.test(m.folder)) continue;
      if (brand.kind === 'team' && want && m.teams.length && !m.teams.some(t => t.toLowerCase() === want) && !m.folder.toLowerCase().includes(brand.name.toLowerCase().split(' ').pop())) continue;
      seen.add(m.id);
      const f = m.folder || '/'; perFolder[f] = (perFolder[f] || 0) + 1;
      if (perFolder[f] > 4) continue; // spread suggestions across shoots
      out.push(m);
      if (out.length >= 24) break;
    }
    return { assets: out, note: out.length ? '' : 'no matching Shade assets' };
  });
}

// ── Prompt + call ──────────────────────────────────────────────────────────
function clip(s, n) { return String(s || '').replace(/\s+/g, ' ').slice(0, n); }

function perfText(perf) {
  if (!perf || typeof perf !== 'object') return '(no performance data sent)';
  const lines = [];
  if (perf.window) lines.push(`Window: ${clip(perf.window, 40)}`);
  if (perf.followers != null) lines.push(`Followers: ${Math.round(perf.followers)} (${perf.netNew >= 0 ? '+' : ''}${Math.round(perf.netNew || 0)} in window, ${Number(perf.mom || 0).toFixed(1)}% of base)`);
  if (perf.engagementRate != null) lines.push(`Avg engagement per post: ${Number(perf.engagementRate).toFixed(2)}% (league avg ${Number(perf.leagueEngagement || 0).toFixed(2)}%)`);
  if (Array.isArray(perf.byPlatform)) lines.push('By platform: ' + perf.byPlatform.slice(0, 7).map(p => `${clip(p.name, 20)} ${Math.round(p.followers || 0)} followers, ${Math.round(p.views || 0)} views`).join('; '));
  if (Array.isArray(perf.formats) && perf.formats.length) lines.push('Format performance (avg interactions/post): ' + perf.formats.slice(0, 6).map(f => `${clip(f.type, 14)} ${Math.round(f.avgInteractions || 0)}`).join('; '));
  if (Array.isArray(perf.topPosts) && perf.topPosts.length) lines.push('Top posts this window:\n' + perf.topPosts.slice(0, 5).map(p => `- [${clip(p.network, 10)} ${clip(p.type, 10)}, ${Math.round(p.interactions || 0)} interactions, ${Math.round(p.impressions || 0)} views, ${clip(p.date, 10)}] "${clip(p.text, 140)}"`).join('\n'));
  if (Array.isArray(perf.players) && perf.players.length) lines.push('Players driving traffic (caption mentions): ' + perf.players.slice(0, 6).map(p => `${clip(p.name, 30)} (${Math.round(p.interactions || 0)} interactions)`).join('; '));
  if (Array.isArray(perf.scheduled) && perf.scheduled.length) lines.push('ALREADY SCHEDULED in the next 7 days (do not duplicate these):\n' + perf.scheduled.slice(0, 12).map(s => `- ${clip(s.at, 16)} ${clip((s.networks || []).join('/'), 30)}: "${clip(s.text, 120)}"`).join('\n'));
  else lines.push('Nothing is scheduled for this brand in the next 7 days.');
  return lines.join('\n');
}

function assetText(assets) {
  if (!assets.length) return '(no Shade assets available; suggest what to shoot or pull instead)';
  return assets.map(a => `- id ${a.id} | ${a.kind} | ${a.name} | folder: ${a.folder || '/'}${a.created ? ` | added ${a.created}` : ''}${a.teams.length ? ` | teams: ${a.teams.join(', ')}` : ''}${a.player ? ` | player: ${a.player}` : ''}${a.contentType ? ` | type: ${a.contentType}` : ''}${a.tags.length ? ` | ${a.tags.join('; ')}` : ''}${a.description ? ` | AI: ${a.description}` : ''}`).join('\n');
}

function parseIdeas(text) {
  const t = String(text || '').replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  const tryParse = s => { try { return JSON.parse(s); } catch { return null; } };
  let v = tryParse(t);
  if (!v) { const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) v = tryParse(t.slice(a, b + 1)); }
  const ideas = v && Array.isArray(v.ideas) ? v.ideas : (Array.isArray(v) ? v : []);
  return ideas.filter(i => i && i.title);
}

export async function generateIdeas(body, { sb, roster }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'ANTHROPIC_API_KEY not configured in Vercel', status: 500 };
  const brandKey = String(body.brand || '');
  const team = TEAMS.find(t => String(t.blogId) === brandKey);
  const SHADE_LABEL = { LAN: 'LA', AZS: 'AZ', LV: 'LV', NYG: 'NYK', DAL: 'DAL', BOS: 'BOS', PHI: 'PHI', CHI: 'CHI', MIA: 'MIA', ATL: 'ATL' };
  const brand = team
    ? { key: brandKey, kind: 'team', name: team.name, teamId: team.teamId, shadeTeam: SHADE_LABEL[team.teamId], voiceKey: `brand-voice-${team.teamId}` }
    : brandKey === 'wiffle'
      ? { key: 'wiffle', kind: 'wiffle', name: 'WIFFLE®', voiceKey: 'brand-voice-WIFFLE' }
      : brandKey === String(BLW_BRAND.blogId) || brandKey === 'blw'
        ? { key: 'blw', kind: 'league', name: 'Big League Wiffle Ball (league page)', voiceKey: 'brand-voice-BLW' }
        : null;
  if (!brand) return { error: 'Unknown brand', status: 400 };
  const count = Math.max(3, Math.min(6, Number(body.count) || 5));
  const perf = body.perf || {};

  const playerNames = (Array.isArray(perf.players) ? perf.players : []).map(p => p.name).filter(Boolean);
  const [L, sbc, shade] = await Promise.all([
    leagueBrief(roster).catch(() => null),
    supabaseContext(sb, brand.voiceKey).catch(() => ({ notes: '', voice: '' })),
    shadeAssets(brand, playerNames).catch(e => ({ assets: [], note: String(e.message || e) })),
  ]);

  const brandBrief = brand.kind === 'wiffle'
    ? 'WIFFLE® is the 70-year-old wiffle ball brand from Shelton, Connecticut, recently acquired alongside BLW. Its social accounts relaunched in October 2026. Positioning: nostalgia first, backyard lifestyle, and the sport as a whole (BLW is only one part). Most people who know WIFFLE® do not know wiffle ball is a competitive sport. Goals: brand growth, product sales, and being the central home of the sport.'
    : brand.kind === 'league'
      ? 'The Big League Wiffle Ball league page (@blwwiffleball): the league-wide account. Content spans all ten franchises, the championship, stat leaders and the league itself.'
      : `${brand.name}, one of ten BLW franchises. Ideas must be for this team's own accounts, about this team, its players and its season.`;

  const system = `You are the social content strategist for Big League Wiffle Ball (BLW) and the WIFFLE® brand, working inside the BLW Command Center. You write post ideas a contractor can execute today.

RULES
- Ground every idea in the BRIEF below. Each idea must cite 1-3 concrete signals from it (a standing, a score, a stat line, a top post, a scheduled gap, a Shade asset). Never invent scores, stats, records, quotes or events.
- Respect the calendar: if the brief says the season is over, do not write game previews or "tonight" posts.
- Prefer ideas we can make from assets that already exist in Shade. Reference assets ONLY by ids from the SHADE ASSETS list. If nothing fits, leave assetIds empty and say in assetNote what to shoot or pull.
- Do not repeat anything already scheduled. Fill gaps instead (platforms or days with nothing scheduled).
- Use what the performance data says works (best formats, top posts, players driving traffic).
- Mix formats and platforms across the set. At least one quick-turn idea (under an hour to make).
- Copy style: punchy, specific, no em dashes, no hashtag walls (max 3 hashtags), no emoji spam.
- Return ONLY JSON: {"ideas":[{"title":"","format":"Reel|TikTok|Carousel|Static|Story|X post|Thread|Short","platforms":["instagram","tiktok","facebook","twitter","youtube","linkedin","threads"],"whyNow":"one sentence tying it to a specific signal","hook":"first line or on-screen text","beats":["3-5 short shot or slide beats"],"caption":"ready-to-post caption","assetIds":["shade asset ids"],"assetNote":"how to use the assets or what to shoot","signals":["the brief facts this rests on"],"timing":"best day/time in Central time","effort":"quick|medium|big"}]}`;

  const brief = `BRAND: ${brand.name}
${brandBrief}
${sbc.voice ? `\nBRAND VOICE (authored by the team, follow it):\n${sbc.voice}\n` : ''}
LEAGUE STATE (live from Grand Slam Systems):
${leagueText(L, brand.teamId)}
${sbc.notes ? `\nLEAGUE NARRATIVES (typed by the league admin; treat as true):\n${sbc.notes}\n` : ''}
SOCIAL PERFORMANCE (from Metricool):
${perfText(perf)}

SHADE ASSETS (real files in the BLW content library):
${assetText(shade.assets || [])}`;

  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  let data, txt;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 3800,
        system,
        messages: [{ role: 'user', content: `${brief}\n\nWrite ${count} post ideas for ${brand.name}. Return the JSON only.` }],
      }),
    });
    txt = await resp.text();
    try { data = JSON.parse(txt); } catch { data = null; }
    if (!resp.ok) return { error: (data && data.error && data.error.message) || `Anthropic HTTP ${resp.status}`, status: 502 };
  } catch (e) {
    return { error: `Anthropic request failed: ${e.message}`, status: 502 };
  }
  const textBlock = ((data && data.content) || []).find(c => c.type === 'text');
  const ideas = parseIdeas(textBlock && textBlock.text);
  if (!ideas.length) return { error: 'The model returned no usable ideas. Try again.', status: 502 };
  const byId = Object.fromEntries((shade.assets || []).map(a => [a.id, a]));
  return {
    brand: brand.key, brandName: brand.name, generatedAt: new Date().toISOString(), model,
    ideas: ideas.slice(0, count).map(i => ({
      title: clip(i.title, 120), format: clip(i.format, 30),
      platforms: (Array.isArray(i.platforms) ? i.platforms : []).map(p => clip(p, 20).toLowerCase()).slice(0, 5),
      whyNow: clip(i.whyNow, 300), hook: clip(i.hook, 200),
      beats: (Array.isArray(i.beats) ? i.beats : []).map(b => clip(b, 160)).slice(0, 6),
      caption: String(i.caption || '').slice(0, 900),
      assets: (Array.isArray(i.assetIds) ? i.assetIds : []).map(id => byId[id]).filter(Boolean).slice(0, 4)
        .map(a => ({ id: a.id, name: a.name, folder: a.folder, kind: a.kind, previewUrl: a.previewUrl })),
      assetNote: clip(i.assetNote, 300),
      signals: (Array.isArray(i.signals) ? i.signals : []).map(s => clip(s, 160)).slice(0, 4),
      timing: clip(i.timing, 60), effort: clip(i.effort, 10).toLowerCase(),
    })),
    sources: {
      league: !!(L && L.ok), leagueNotes: !!sbc.notes, voice: !!sbc.voice,
      shadeAssets: (shade.assets || []).length, shadeNote: shade.note || '',
      scheduledConsidered: Array.isArray(perf.scheduled),
    },
  };
}
