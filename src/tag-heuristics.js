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
  ACTION:       ['action', 'batting', 'bat', 'hit', 'hitting', 'swing', 'pitch', 'pitching', 'throw', 'field', 'fielding', 'run', 'catch', 'gameaction'],
  HIGHLIGHT:    ['highlight', 'highlights', 'reel', 'clip'],
  INTERVIEW:    ['interview', 'mic', 'presser', 'press', 'talk'],
  TEAMPHOTO:    ['team', 'teamphoto', 'group', 'roster'],
  VENUE:        ['venue', 'stadium', 'field', 'ballpark', 'park'],
  LOGO_PRIMARY: ['logo', 'primary'],
  LOGO_DARK:    ['dark', 'logo-dark', 'logodark'],
  LOGO_LIGHT:   ['light', 'logo-light', 'logolight'],
  WORDMARK:     ['wordmark', 'text'],
};

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

// Find last name by matching against roster (provided as array of { lastName })
function matchLastName(tokens, roster) {
  if (!roster || roster.length === 0) return null;
  const nameSet = new Map();
  for (const p of roster) {
    if (p.lastName && p.lastName.length >= 3) {
      nameSet.set(p.lastName.toLowerCase(), p);
    }
  }
  for (const tok of tokens) {
    if (tok.length < 3) continue;
    const hit = nameSet.get(tok);
    if (hit) return { lastName: hit.lastName.toUpperCase(), player: hit, source: tok };
  }
  return null;
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
      lastNameMatch = { lastName: rosterHit.lastName.toUpperCase(), player: rosterHit, source: `jersey-lookup` };
      reasons.push(`player "${rosterHit.lastName}" looked up from team+jersey`);
    }
  }

  // Asset type
  const assetTypeMatch = matchAssetType(allTokens);
  if (assetTypeMatch) reasons.push(`asset type "${assetTypeMatch.assetType}" matched "${assetTypeMatch.source}"`);

  // Confidence heuristic
  let confidence = 'none';
  const parts = [team, jersey, lastNameMatch, assetTypeMatch].filter(Boolean).length;
  if (parts >= 3) confidence = 'high';
  else if (parts === 2) confidence = 'medium';
  else if (parts === 1) confidence = 'low';

  return {
    team: team?.team || null,
    num: jersey?.num || null,
    lastName: lastNameMatch?.lastName || null,
    assetType: assetTypeMatch?.assetType || null,
    confidence,
    reasons,
  };
}

// ─── Helper: check if an already-named file is "good enough" ────────────────
// If filename follows TEAM_##_LASTNAME_TYPE.ext convention, we skip tagging.
export function isAlreadyTagged(filename) {
  const parts = filename.replace(/\.[^.]+$/, '').split('_');
  if (parts.length < 4) return false;
  const teamOk = TEAMS.some(t => t.id === parts[0].toUpperCase());
  const numOk = /^\d{2}$/.test(parts[1]) || parts[1] === ''; // jersey can be blank
  return teamOk && numOk;
}
