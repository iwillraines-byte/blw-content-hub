// ─── Layer 1 — Heuristic tag inference from filename + folder context ───────
// Zero-cost, instant, no API calls. Tries to extract team/jersey#/lastName/
// assetType from filename and (optionally) the Drive parent folder name.
//
// Returns { team, num, lastName, assetType, confidence, reasons } where any
// field may be null if no confident signal was found.

import { TEAMS } from './data';

// ─── Team matching — include common nickname variants ───────────────────────
// Some BLW teams are commonly referred to by their city or nickname in the
// filename. We normalize these to our internal IDs.
const TEAM_ALIASES = {};
for (const t of TEAMS) {
  TEAM_ALIASES[t.id.toLowerCase()] = t.id;          // "lan" → LAN
  TEAM_ALIASES[t.apiAbbr.toLowerCase()] = t.id;     // "la" → LAN
  TEAM_ALIASES[t.slug.toLowerCase()] = t.id;        // "la-naturals" → LAN
  // Last word of team name is usually the nickname (e.g. "Naturals")
  const nickname = t.name.split(' ').pop().toLowerCase();
  if (nickname.length >= 4) TEAM_ALIASES[nickname] = t.id;
  // Hyphenated nickname (e.g. "greenapples" for "Green Apples")
  const hyphenless = t.name.replace(/\s+/g, '').toLowerCase();
  TEAM_ALIASES[hyphenless] = t.id;
  // Also just the city portion
  const city = t.city.toLowerCase();
  TEAM_ALIASES[city] = t.id;
  TEAM_ALIASES[city.replace(/\s+/g, '')] = t.id;
}

const ASSET_TYPE_KEYWORDS = {
  HEADSHOT:     ['headshot', 'headshots', 'portrait', 'profile', 'mugshot', 'photo'],
  // Split the old "ACTION" bucket: hitting-flavored words go to HITTING,
  // pitching-flavored words go to PITCHING. "Action" alone is ambiguous —
  // we route it to HITTING by default since most action shots in our
  // corpus are batting. Filenames carrying both still resolve to the
  // first match in the iteration order, which is HITTING.
  HITTING:      ['hitting', 'batting', 'bat', 'hit', 'swing', 'gameaction', 'action', 'field', 'fielding', 'run', 'catch'],
  PITCHING:     ['pitching', 'pitch', 'pitcher', 'mound', 'throw'],
  HIGHLIGHT:    ['highlight', 'highlights', 'reel', 'clip'],
  // HYPE replaces HIGHLIGHT2 — short hero/intro/walkup-vibe assets.
  HYPE:         ['hype', 'intro', 'hero', 'walkup', 'walk-up'],
  INTERVIEW:    ['interview', 'mic', 'presser', 'press', 'talk'],
  // GROUP — multi-player shots scoped to a player record (e.g. infield
  // group, position-group photos). TEAMPHOTO covers full-roster shots
  // and stays team-scoped.
  GROUP:        ['group', 'squad', 'crew', 'duo', 'trio'],
  TEAMPHOTO:    ['team', 'teamphoto', 'roster'],
  VENUE:        ['venue', 'stadium', 'ballpark', 'park'],
  LOGO_PRIMARY: ['logo', 'primary'],
  LOGO_DARK:    ['dark', 'logo-dark', 'logodark'],
  LOGO_LIGHT:   ['light', 'logo-light', 'logolight'],
  WORDMARK:     ['wordmark', 'text'],
  // League-scoped types — only meaningful when the team prefix is BLW
  // (or the filename otherwise indicates a multi-team / league event).
  ALLSTAR:      ['allstar', 'all-star', 'asg'],
  EVENT:        ['event', 'opening', 'closing', 'launch', 'gala', 'banquet'],
  TROPHY:       ['trophy', 'championship', 'champion', 'award', 'mvp', 'final', 'finals'],
  MULTI_TEAM:   ['multiteam', 'multi-team', 'mixed'],
  BANNER:       ['banner', 'header', 'hero'],
  BRANDING:     ['branding', 'brand'],
};

// Keywords that indicate the file is league-scoped regardless of any
// team token also present (e.g. "blw-allstar-game01.png" mentions BLW
// AND we want league scope, not Boston via "blw"→none collision).
const LEAGUE_SCOPE_KEYWORDS = new Set([
  'blw', 'allstar', 'all-star', 'asg', 'championship', 'finals',
  'mvp', 'opening', 'banquet',
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

// Strip file extension and split into tokens by non-alphanumeric characters
function tokenize(str) {
  return str
    .replace(/\.[^.]+$/, '') // drop extension
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Check if any token matches a team alias
function matchTeam(tokens) {
  for (const tok of tokens) {
    if (TEAM_ALIASES[tok]) return { team: TEAM_ALIASES[tok], source: tok };
  }
  // Also try concatenated pairs (e.g. "greenapples" split into "green" + "apples")
  for (let i = 0; i < tokens.length - 1; i++) {
    const combo = tokens[i] + tokens[i + 1];
    if (TEAM_ALIASES[combo]) return { team: TEAM_ALIASES[combo], source: combo };
  }
  return null;
}

// Find 1-2 digit jersey number tokens (not part of a year or timestamp)
function matchJersey(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (/^\d{1,2}$/.test(tok)) {
      const n = parseInt(tok, 10);
      // Filter obvious false positives — years, dates
      if (n > 99) continue;
      // Skip tokens that look like minutes/seconds next to an hour (e.g. 12_34_56)
      const prev = tokens[i - 1];
      if (prev && /^\d{1,2}$/.test(prev) && parseInt(prev, 10) > 23) continue;
      return { num: tok.padStart(2, '0'), source: tok };
    }
  }
  return null;
}

// Find last name by matching against roster (provided as array of { lastName }).
// Returns the matched player plus a `candidates` array of all roster entries
// sharing that lastname on the same team — callers use this to detect when a
// first-initial disambiguator is needed.
function matchLastName(tokens, roster) {
  if (!roster || roster.length === 0) return null;
  const byName = new Map(); // lowercase lastName → [players]
  for (const p of roster) {
    if (p.lastName && p.lastName.length >= 3) {
      const k = p.lastName.toLowerCase();
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(p);
    }
  }
  for (const tok of tokens) {
    if (tok.length < 3) continue;
    const hits = byName.get(tok);
    if (hits && hits.length > 0) {
      // Prefer a player whose team matches another matched team token, if any.
      const hit = hits[0];
      return {
        lastName: hit.lastName.toUpperCase(),
        player: hit,
        candidates: hits,
        source: tok,
      };
    }
  }
  return null;
}

// Given the matched player + all same-lastname candidates + tokens from the
// filename, pick a first-initial if one is clearly present in the filename.
// Returns '' when ambiguous or unavailable.
function matchFirstInitial(tokens, lastNameMatch) {
  if (!lastNameMatch) return '';
  const { player, candidates, source } = lastNameMatch;
  // Only bother when there's a name collision to resolve.
  if (!candidates || candidates.length <= 1) {
    return (player.firstName || '').charAt(0).toUpperCase();
  }
  // Look for an explicit F.LAST token in the filename — e.g. "c.rose".
  const dotRe = new RegExp(`^([a-z])\\.${source}$`, 'i');
  for (const tok of tokens) {
    const m = dotRe.exec(tok);
    if (m) return m[1].toUpperCase();
  }
  // Fall back: if any candidate's firstName appears as its own token, use that.
  for (const cand of candidates) {
    const fn = (cand.firstName || '').toLowerCase();
    if (fn && tokens.includes(fn)) return fn.charAt(0).toUpperCase();
  }
  // Still ambiguous — return empty so the UI prompts for input.
  return '';
}

// Find asset type from keyword match
function matchAssetType(tokens) {
  for (const [type, keywords] of Object.entries(ASSET_TYPE_KEYWORDS)) {
    for (const kw of keywords) {
      if (tokens.includes(kw)) return { assetType: type, source: kw };
    }
  }
  return null;
}

// ─── Main export ────────────────────────────────────────────────────────────
//
// filename:   e.g. "IMG_2934.jpg", "LAN_03_JASO_HEADSHOT.png", "jaso_batting.jpg"
// folderName: e.g. "LA Naturals - Game 14", "Headshots 2026", "" if unknown
// roster:     array of { team, lastName, num } — combined across all teams
//             (you can scope to one team if you know it upfront)
//
// Returns:
// {
//   team:       "LAN" | null,
//   num:        "03"  | null,
//   lastName:   "JASO" | null,
//   assetType:  "HEADSHOT" | null,
//   confidence: "high" | "medium" | "low" | "none",
//   reasons:    ["team matched 'lan' in filename", ...],
// }
export function heuristicallyTag({ filename, folderName = '', roster = [] }) {
  const filenameTokens = tokenize(filename);
  const folderTokens   = tokenize(folderName);
  // Check filename first (higher signal), then folder
  const allTokens = [...filenameTokens, ...folderTokens];

  const reasons = [];

  // Team — prefer filename match, fall back to folder
  let team = matchTeam(filenameTokens);
  if (team) reasons.push(`team "${team.team}" matched "${team.source}" in filename`);
  if (!team) {
    team = matchTeam(folderTokens);
    if (team) reasons.push(`team "${team.team}" matched "${team.source}" in folder`);
  }

  // Jersey — only look in filename (folders rarely have jersey#)
  const jersey = matchJersey(filenameTokens);
  if (jersey) reasons.push(`jersey #${jersey.num} parsed from filename`);

  // Last name — scope roster to matched team if known, for higher precision
  const scopedRoster = team
    ? roster.filter(p => p.team === team.team)
    : roster;
  let lastNameMatch = matchLastName(filenameTokens, scopedRoster);
  if (!lastNameMatch && !team) {
    // If we didn't match team yet, try to match lastName across the full roster
    // — this might reveal the team indirectly
    lastNameMatch = matchLastName(filenameTokens, roster);
    if (lastNameMatch && !team) {
      team = { team: lastNameMatch.player.team, source: `inferred from "${lastNameMatch.source}"` };
      reasons.push(`team "${team.team}" inferred from player "${lastNameMatch.lastName}"`);
    }
  }
  if (lastNameMatch) reasons.push(`last name "${lastNameMatch.lastName}" matched "${lastNameMatch.source}"`);

  // Also cross-verify jersey against roster — if we have team + jersey, does a roster entry exist?
  if (team && jersey && !lastNameMatch) {
    const rosterHit = roster.find(p =>
      p.team === team.team && p.num && p.num.padStart(2, '0') === jersey.num
    );
    if (rosterHit) {
      lastNameMatch = {
        lastName: rosterHit.lastName.toUpperCase(),
        player: rosterHit,
        candidates: [rosterHit],
        source: `jersey-lookup`,
      };
      reasons.push(`player "${rosterHit.lastName}" looked up from team+jersey`);
    }
  }

  // First initial — if the filename explicitly encodes F.LAST (e.g. "c.rose"),
  // prefer that. Otherwise infer from the matched player (useful even when
  // the lastname isn't ambiguous — makes saved files disambiguation-ready).
  let firstInitial = '';
  let ambiguous = false;
  if (lastNameMatch) {
    // Look for an explicit F.LASTNAME literal in the raw filename.
    const ln = lastNameMatch.source;
    if (ln && /^[a-z]+$/i.test(ln)) {
      const explicitRe = new RegExp(`(?:^|[^a-z0-9])([a-z])\\.${ln}(?:$|[^a-z0-9])`, 'i');
      const m = explicitRe.exec(String(filename).toLowerCase());
      if (m) {
        firstInitial = m[1].toUpperCase();
        reasons.push(`first initial "${firstInitial}" parsed from F.LAST form`);
      }
    }
    if (!firstInitial) {
      const cands = lastNameMatch.candidates || [lastNameMatch.player];
      if (cands.length > 1) {
        // Multiple candidates — try to use firstName tokens, else flag ambiguous.
        for (const cand of cands) {
          const fn = (cand.firstName || '').toLowerCase();
          if (fn && filenameTokens.includes(fn)) {
            firstInitial = fn.charAt(0).toUpperCase();
            reasons.push(`first initial "${firstInitial}" inferred from first-name token`);
            break;
          }
        }
        if (!firstInitial) {
          ambiguous = true;
          reasons.push(`ambiguous: ${cands.length} players share lastname "${lastNameMatch.lastName}" — need first initial`);
        }
      } else {
        firstInitial = (lastNameMatch.player.firstName || '').charAt(0).toUpperCase();
      }
    }
  }

  // Asset type
  const assetTypeMatch = matchAssetType(allTokens);
  if (assetTypeMatch) reasons.push(`asset type "${assetTypeMatch.assetType}" matched "${assetTypeMatch.source}"`);

  // League-scope detection. The first token being literally "blw" is the
  // strongest signal (it's the prefix our buildLeagueFilename produces).
  // Otherwise fall back to keyword hits — "all-star", "championship",
  // "trophy", etc. — which can promote a no-team file to league scope
  // even when the user's filename doesn't carry the BLW prefix yet.
  const blwPrefix = filenameTokens[0] === 'blw';
  const leagueKeywordHit = allTokens.some(t => LEAGUE_SCOPE_KEYWORDS.has(t));
  const isLeague = blwPrefix || (leagueKeywordHit && !team);
  if (isLeague) {
    reasons.push(blwPrefix ? 'league scope from "BLW" prefix' : 'league scope inferred from keyword');
  }

  // Confidence heuristic
  let confidence = 'none';
  const parts = [team, jersey, lastNameMatch, assetTypeMatch].filter(Boolean).length;
  if (parts >= 3) confidence = 'high';
  else if (parts === 2) confidence = 'medium';
  else if (parts === 1) confidence = 'low';
  // League-scope hits are confident on their own — a "BLW_ALLSTAR.jpg"
  // file shouldn't show as low-confidence just because no team or
  // jersey could be parsed (there isn't one to parse).
  if (isLeague && assetTypeMatch) confidence = 'high';
  else if (isLeague) confidence = 'medium';
  // Knock down confidence when the lastname is ambiguous and we couldn't pick
  // an initial — the user needs to confirm which player this is.
  if (ambiguous && confidence === 'high') confidence = 'medium';
  else if (ambiguous && confidence === 'medium') confidence = 'low';

  return {
    team: isLeague ? null : (team?.team || null),
    num: isLeague ? null : (jersey?.num || null),
    lastName: isLeague ? null : (lastNameMatch?.lastName || null),
    firstInitial: isLeague ? null : (firstInitial || null),
    ambiguous: isLeague ? false : ambiguous,
    assetType: assetTypeMatch?.assetType || (isLeague ? 'EVENT' : null),
    scope: isLeague ? 'league' : null,
    confidence,
    reasons,
  };
}

// ─── Helper: check if an already-named file is "good enough" ────────────────
// Accepts any of:
//   TEAM_##_F.LASTNAME_TYPE.ext     (preferred — player-scoped with initial)
//   TEAM_##_LASTNAME_TYPE.ext       (legacy — player-scoped, no initial)
//   TEAM_TEAMPHOTO[_variant].ext    (team-scoped)
//   TEAM_VENUE[_variant].ext
//   TEAM_LOGO_* / TEAM_WORDMARK[_variant].ext
const TEAM_SCOPE_PREFIXES = new Set([
  'TEAMPHOTO', 'VENUE', 'WORDMARK',
  'LOGO_PRIMARY', 'LOGO_DARK', 'LOGO_LIGHT', 'LOGO_ICON',
  'LOGO',
]);
// League-scoped types that round-trip a BLW_* filename through the parser.
const LEAGUE_SCOPE_PREFIXES = new Set([
  'ALLSTAR', 'EVENT', 'MULTI_TEAM', 'TROPHY', 'BANNER', 'BRANDING',
  'TEAMPHOTO', 'VENUE', 'WORDMARK',
  'LOGO_PRIMARY', 'LOGO_DARK', 'LOGO_LIGHT', 'LOGO_ICON', 'LOGO',
]);

export function isAlreadyTagged(filename) {
  const parts = filename.replace(/\.[^.]+$/, '').split('_');
  if (parts.length < 2) return false;
  const prefix = parts[0].toUpperCase();

  // League-scoped: BLW_{TYPE}[_VARIANT]
  if (prefix === 'BLW') {
    const t1 = (parts[1] || '').toUpperCase();
    const t1t2 = (parts[2] || '').toUpperCase() ? `${t1}_${(parts[2] || '').toUpperCase()}` : t1;
    return LEAGUE_SCOPE_PREFIXES.has(t1) || LEAGUE_SCOPE_PREFIXES.has(t1t2);
  }

  const teamOk = TEAMS.some(t => t.id === prefix);
  if (!teamOk) return false;

  // Team-scoped: TEAM_{TYPE}[_VARIANT]
  const t1 = (parts[1] || '').toUpperCase();
  const t1t2 = (parts[2] || '').toUpperCase() ? `${t1}_${(parts[2] || '').toUpperCase()}` : t1;
  if (TEAM_SCOPE_PREFIXES.has(t1) || TEAM_SCOPE_PREFIXES.has(t1t2)) return true;

  // Player-scoped: needs 4 segments with jersey # in slot [1]
  if (parts.length < 4) return false;
  const numOk = /^\d{2}$/.test(parts[1]) || parts[1] === '';
  return numOk;
}
