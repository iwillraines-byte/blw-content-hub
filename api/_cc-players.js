// api/_cc-players.js — who is in a post, for the Player Heat Index, the post
// library and per-player lifetime pages on the Command Center.
//
// Sources, merged into one player directory:
//   * src/roster-2026.js — the canonical BLW roster and name aliases (the
//     same list BLW Studio uses), so names like "Nick Martinez" / "Myc Witty"
//     / "Vin Lea" match the way the league actually writes them
//   * manual_players in Supabase — each player's nickname and Instagram
//     handle, so "@jake.sullivan16" counts as Jake Sullivan
//   * extra aliases typed on the Command Center (stored with the post tags),
//     for nicknames like "K-VON"
//
// Matching rules:
//   * full name, alias, nickname, extra alias, or @handle anywhere in the caption
//   * last name alone only when it is unique across the league, at least 5
//     letters, and (on a team account) the player is on that team
//   * a name used as a CREDIT is not a feature: "shoutout X for the clip",
//     "filmed by X", "edit by X", "📸 X" and similar are skipped
//   * a manual tag on the Command Center always wins over all of the above

import { CANONICAL_ROSTER_2026, NAME_ALIASES_RAW } from '../src/roster-2026.js';

export const TEAM_NAME = { LAN: 'Los Angeles Naturals', AZS: 'Arizona Saguaros', ATL: 'Atlanta Ballers', LV: 'Las Vegas Scorpions', NYG: 'New York Green Apples', BOS: 'Boston Harbor Hawks', DAL: 'Dallas Pandas', PHI: 'Philadelphia Wiffle Club', CHI: 'Chicago Bats', MIA: 'Miami Mirage' };
export const TEAM_ACCENT = { AZS: '#C7F24E', ATL: '#9AD1FF', BOS: '#DAC79C', CHI: '#C0162B', DAL: '#E8B53A', LV: '#C4C9D2', LAN: '#2E63E8', MIA: '#79E6C2', PHI: '#34489E', NYG: '#8BD17C' };

const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
export function norm(s) {
  const parts = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  while (parts.length > 1 && SUFFIX.has(parts[parts.length - 1])) parts.pop();
  return parts.join(' ');
}
const COMMON = new Set(['the', 'big', 'king', 'ace', 'boss', 'chief', 'champ', 'goat', 'beast', 'kid', 'young']);

let _dir = null, _dirAt = 0;
async function manualPlayers(sb) {
  if (!sb) return [];
  try {
    const { data, error } = await sb.from('manual_players').select('first_name, last_name, team, nickname, instagram_handle');
    if (error) {
      // Older schema without the optional columns: retry with the basics.
      const r = await sb.from('manual_players').select('first_name, last_name, team');
      return r.data || [];
    }
    return data || [];
  } catch { return []; }
}

// extraAliases: { "Kyle Vonschleusingen": ["k-von", "@kyleslush"], ... }
export async function playerDirectory(sb, extraAliases = {}) {
  let base;
  if (_dir && Date.now() - _dirAt < 10 * 60 * 1000) base = _dir;
  else {
    const canon = CANONICAL_ROSTER_2026.map(p => ({ name: p.name, team: p.team, num: p.num || '' }));
    const byNorm = new Map(canon.map(p => [norm(p.name), p]));
    const aliasOf = {};
    for (const [alias, name] of Object.entries(NAME_ALIASES_RAW)) (aliasOf[name] = aliasOf[name] || []).push(norm(alias));
    for (const p of canon) { p.forms = new Set([norm(p.name), ...(aliasOf[p.name] || [])]); p.handles = new Set(); p.nickname = ''; p.handle = ''; }
    for (const m of await manualPlayers(sb)) {
      const full = norm(`${m.first_name || ''} ${m.last_name || ''}`);
      const canonName = NAME_ALIASES_RAW[full] || (byNorm.get(full) || {}).name;
      const p = canonName ? byNorm.get(norm(canonName)) : null;
      if (!p) continue;
      p.forms.add(full);
      const nick = norm(m.nickname);
      if (nick && nick.length >= 4 && !COMMON.has(nick)) { p.forms.add(nick); p.nickname = p.nickname || m.nickname; }
      const h = String(m.instagram_handle || '').trim().replace(/^@/, '').toLowerCase();
      if (h) { p.handles.add(h); p.handle = p.handle || h; }
    }
    const lastCount = {};
    for (const p of canon) { const l = norm(p.name).split(' ').pop(); lastCount[l] = (lastCount[l] || 0) + 1; }
    for (const p of canon) { p.last = norm(p.name).split(' ').pop(); p.lastOk = p.last.length >= 5 && lastCount[p.last] === 1; }
    base = canon; _dir = base; _dirAt = Date.now();
  }
  // Layer the Command Center's extra aliases on a copy so they always apply fresh.
  const extraByNorm = {};
  for (const [k, v] of Object.entries(extraAliases || {})) extraByNorm[norm(k)] = v;
  return base.map(p => {
    const extra = extraByNorm[norm(p.name)] || [];
    const forms = new Set(p.forms), handles = new Set(p.handles);
    for (const a of extra) {
      const s = String(a || '').trim();
      if (!s) continue;
      if (s.startsWith('@')) handles.add(s.slice(1).toLowerCase());
      else { const n = norm(s); if (n.length >= 2) forms.add(n); }
    }
    return { ...p, forms, handles, aliases: extra };
  });
}

export function publicDirectory(dir) {
  return dir.map(p => ({ name: p.name, team: p.team, teamName: TEAM_NAME[p.team] || p.team, num: p.num, nickname: p.nickname || '', handle: p.handle || '', aliases: p.aliases || [] }));
}

// Unambiguous credit words right before the name...
const CREDIT_BEFORE = /(credits?( to)?|via|filmed by|shot by|clip by|clipped by|video by|edit(ed)? by|cut by|photo(graphy)? by|pics? by|captured by|footage by|📸|🎥|🎬|📹|cc:?)\s*:?\s*$/i;
// ...or a shoutout / thanks that is followed by "for the clip" and the like.
// ("Thank you Nick Martinez" on a farewell post is a feature, not a credit.)
const CREDIT_AFTER = /^\s*(for (the|this) (clip|video|edit|shot|pic|photo|film|footage|camera work|angle)|on (the )?(camera|clip|edit|sticks|lens))/i;

function isCredit(raw, idx, len) {
  const before = raw.slice(Math.max(0, idx - 32), idx);
  const after = raw.slice(idx + len, idx + len + 40);
  return CREDIT_BEFORE.test(before) || CREDIT_AFTER.test(after);
}

// Returns the canonical names featured in a caption.
export function matchPlayers(text, dir, teamId) {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  const lower = raw.toLowerCase();
  // A normalized copy with an index map back into the raw text, so credit
  // checks can look at the original words around a normalized match.
  const n = [], map = [];
  const src = raw.normalize('NFD');
  let prevSpace = true;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (/[̀-ͯ]/.test(ch)) continue;
    const c = ch.toLowerCase();
    if (/[a-z0-9]/.test(c)) { n.push(c); map.push(i); prevSpace = false; }
    else if (!prevSpace) { n.push(' '); map.push(i); prevSpace = true; }
  }
  const ntext = ' ' + n.join('') + ' ';
  const hits = [];
  for (const p of dir) {
    let featured = false, credited = false;
    const tryAt = (needle, inNorm) => {
      let from = 0;
      for (;;) {
        const at = inNorm ? ntext.indexOf(needle, from) : lower.indexOf(needle, from);
        if (at < 0) return;
        let rIdx, rLen;
        if (inNorm) { const s = at; const e = at + needle.length - 2; rIdx = map[s] ?? 0; rLen = (map[e - 1] ?? rIdx) - rIdx + 1; }
        else { rIdx = at; rLen = needle.length; }
        if (isCredit(raw, rIdx, rLen)) credited = true; else { featured = true; return; }
        from = at + 1;
      }
    };
    for (const f of p.forms) { if (featured) break; tryAt(' ' + f + ' ', true); }
    for (const h of p.handles) { if (featured) break; tryAt('@' + h, false); }
    if (!featured && !credited && p.lastOk && (!teamId || p.team === teamId)) tryAt(' ' + p.last + ' ', true);
    if (featured) hits.push(p.name);
  }
  return hits;
}
