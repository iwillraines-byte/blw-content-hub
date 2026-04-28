// ─── IndexedDB Store for Media Files (Photos/Assets) ────────────────────────
// Shared between Files page and Generate page for player-media matching.
//
// Filename conventions supported:
//   Player-scoped (preferred):  {TEAM}_{##}_{F.LASTNAME}_{TYPE}.ext
//     e.g.  LAN_03_C.ROSE_HEADSHOT.png
//   Player-scoped (legacy):     {TEAM}_{##}_{LASTNAME}_{TYPE}.ext
//     e.g.  LAN_03_ROSE_HEADSHOT.png
//   Team-scoped:                {TEAM}_{TYPE}[_VARIANT].ext
//     e.g.  LAN_TEAMPHOTO.jpg, LAN_VENUE_DUGOUT.jpg, LAN_LOGO_PRIMARY.png
//   League-scoped:              BLW_{TYPE}[_VARIANT].ext
//     e.g.  BLW_ALLSTAR_2026.jpg, BLW_TROPHY.png, BLW_LOGO_PRIMARY.png
//
// League-scoped records use the literal "BLW" prefix (the league code).
// They have no team affiliation, so they show up across every team's
// surfaces and live in a "League photos" bucket on the Files page.

import { cloud } from './cloud-sync';

const DB_NAME = 'blw-content-hub';
const DB_VERSION = 3; // Must match overlay-store.js
const STORE_NAME = 'media';

// Sentinel used in the team field for league-wide assets. NOT one of the
// 10 BLW team codes — those are LAN, AZS, LV, NYG, DAL, BOS, PHI, CHI,
// MIA, SDO. "BLW" denotes the league itself.
export const LEAGUE_TEAM_CODE = 'BLW';

// Asset types that belong to the team itself, not any one player.
export const TEAM_SCOPE_TYPES = new Set([
  'TEAMPHOTO', 'VENUE',
  'LOGO_PRIMARY', 'LOGO_DARK', 'LOGO_LIGHT', 'LOGO_ICON',
  'WORDMARK',
]);

// Asset types that belong to the league as a whole. ALLSTAR / EVENT /
// MULTI_TEAM cover the typical league-wide photography use cases; the
// LOGO_* + WORDMARK + BANNER + BRANDING bucket lets us store league
// branding alongside team branding without name collisions.
export const LEAGUE_SCOPE_TYPES = new Set([
  'ALLSTAR', 'EVENT', 'MULTI_TEAM', 'TROPHY',
  'BANNER', 'BRANDING',
  'LOGO_PRIMARY', 'LOGO_DARK', 'LOGO_LIGHT', 'LOGO_ICON',
  'WORDMARK',
]);

// Infer scope from team code + asset type.
//   - team === 'BLW'        → league
//   - assetType ∈ TEAM_SCOPE → team
//   - else                   → player
// Without the team-code peek a league-scoped LOGO_PRIMARY would collide
// with the team-scoped LOGO_PRIMARY check below.
export function inferScope(assetType, teamCode = '') {
  if (String(teamCode || '').toUpperCase() === LEAGUE_TEAM_CODE) return 'league';
  return TEAM_SCOPE_TYPES.has(String(assetType || '').toUpperCase())
    ? 'team'
    : 'player';
}

// Parse a filename into {team, num, firstInitial, player, assetType}.
// Handles both player-scoped and team-scoped conventions, plus the legacy
// lastname-only form. Fields may be empty if the filename doesn't conform.
export function parseFilename(name) {
  const base = String(name || '').replace(/\.[^.]+$/, '');
  const parts = base.split('_');
  const team = (parts[0] || '').toUpperCase();

  // League-scoped form: BLW_{TYPE}[_VARIANT]
  // Recognised when the prefix is the literal league code "BLW".
  if (team === LEAGUE_TEAM_CODE) {
    const maybeType = (parts[1] || '').toUpperCase();
    const variant = (parts[2] || '').toUpperCase();
    const combined = maybeType + (variant ? '_' + variant : '');
    // Compound types like LOGO_PRIMARY span positions [1]+[2].
    const isCompound = LEAGUE_SCOPE_TYPES.has(combined);
    const assetType = isCompound ? combined : maybeType;
    const extraVariant = isCompound ? (parts[3] || '').toUpperCase() : variant;
    return {
      team: LEAGUE_TEAM_CODE,
      num: '',
      firstInitial: '',
      player: '',
      assetType: assetType || 'EVENT',
      variant: extraVariant,
      scope: 'league',
    };
  }

  // Team-scoped form: {TEAM}_{TYPE}[_VARIANT]
  // Recognised when the second segment is a known team-scope asset type.
  const maybeType = (parts[1] || '').toUpperCase();
  if (TEAM_SCOPE_TYPES.has(maybeType)) {
    const variant = (parts[2] || '').toUpperCase();
    // LOGO_PRIMARY / LOGO_DARK / WORDMARK etc. have a compound type in
    // positions [1] + [2]; only treat [2] as variant if the combined form
    // isn't itself a team-scope type.
    const combined = maybeType + (variant ? '_' + variant : '');
    const assetType = TEAM_SCOPE_TYPES.has(combined) ? combined : maybeType;
    const extraVariant = TEAM_SCOPE_TYPES.has(combined)
      ? (parts[3] || '').toUpperCase()
      : variant;
    return {
      team,
      num: '',
      firstInitial: '',
      player: '',
      assetType,
      variant: extraVariant,
      scope: 'team',
    };
  }

  // Player-scoped form: {TEAM}_{##}_{F.LASTNAME or LASTNAME}_{TYPE}
  const num = parts[1] || '';
  const playerRaw = (parts[2] || '').toUpperCase();
  const assetTypePart = (parts[3] || 'FILE').toUpperCase();
  let firstInitial = '';
  let player = playerRaw;
  // Recognise "F.LASTNAME" form — single-letter initial, dot, lastname.
  const dotMatch = /^([A-Z])\.([A-Z][A-Z'-]*)$/.exec(playerRaw);
  if (dotMatch) {
    firstInitial = dotMatch[1];
    player = dotMatch[2];
  }

  return {
    team,
    num,
    firstInitial,
    player,
    assetType: assetTypePart,
    variant: '',
    scope: inferScope(assetTypePart),
  };
}

// Build a player-scoped filename. Uses F.LASTNAME form when firstInitial is
// provided, otherwise falls back to legacy lastname-only form.
export function buildPlayerFilename({ team, num, firstInitial, lastName, assetType, ext }) {
  const T = (team || 'UNK').toUpperCase();
  const N = (num || '00').toString().padStart(2, '0');
  const LN = (lastName || 'UNKNOWN').toUpperCase();
  const FI = (firstInitial || '').toUpperCase().slice(0, 1);
  const nameSegment = FI ? `${FI}.${LN}` : LN;
  const AT = (assetType || 'FILE').toUpperCase();
  const E = (ext || 'jpg').replace(/^\./, '');
  return `${T}_${N}_${nameSegment}_${AT}.${E}`;
}

// Build a team-scoped filename.
export function buildTeamFilename({ team, assetType, variant, ext }) {
  const T = (team || 'UNK').toUpperCase();
  const AT = (assetType || 'TEAMPHOTO').toUpperCase();
  const V = (variant || '').toUpperCase();
  const E = (ext || 'jpg').replace(/^\./, '');
  return V ? `${T}_${AT}_${V}.${E}` : `${T}_${AT}.${E}`;
}

// Build a league-scoped filename. Always prefixed with the literal
// "BLW" so parseFilename routes the record to the league bucket.
export function buildLeagueFilename({ assetType, variant, ext }) {
  const AT = (assetType || 'EVENT').toUpperCase();
  const V = (variant || '').toUpperCase();
  const E = (ext || 'jpg').replace(/^\./, '');
  return V ? `${LEAGUE_TEAM_CODE}_${AT}_${V}.${E}` : `${LEAGUE_TEAM_CODE}_${AT}.${E}`;
}

// Normalise a record — sets scope + fills firstInitial when missing.
// Used to backfill legacy records on read (no IndexedDB migration needed).
function normaliseRecord(r) {
  if (!r) return r;
  const out = { ...r };
  // Backfill scope — pass team so legacy BLW_* records get scope='league'
  // even though their stored row predates the league-scope feature.
  if (!out.scope) out.scope = inferScope(out.assetType, out.team);
  // Backfill firstInitial from the stored name if we can parse one
  if (out.firstInitial == null) {
    const parsed = parseFilename(out.name || '');
    out.firstInitial = parsed.firstInitial || '';
  }
  return out;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('overlays')) {
        db.createObjectStore('overlays', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('effects')) {
        db.createObjectStore('effects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('players')) {
        db.createObjectStore('players', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMedia({ name, blob, width, height, driveFileId, source }) {
  const db = await openDB();
  const id = crypto.randomUUID();
  const parsed = parseFilename(name);

  const record = {
    id, name, blob, width, height,
    team: parsed.team,
    num: parsed.num,
    firstInitial: parsed.firstInitial,
    player: parsed.player,
    assetType: parsed.assetType,
    variant: parsed.variant,
    scope: parsed.scope,
    createdAt: Date.now(),
    driveFileId: driveFileId || null,
    source: source || 'local',
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => { cloud.syncMedia(record); resolve(record); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllMedia() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result || []).map(normaliseRecord));
    req.onerror = () => reject(req.error);
  });
}

export async function updateMedia(id, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) { reject(new Error('Not found')); return; }
      const updated = { ...existing, ...updates };
      // Re-parse naming convention from new name
      if (updates.name) {
        const parsed = parseFilename(updates.name);
        updated.team = parsed.team;
        updated.num = parsed.num;
        updated.firstInitial = parsed.firstInitial;
        updated.player = parsed.player;
        updated.assetType = parsed.assetType;
        updated.variant = parsed.variant;
        updated.scope = parsed.scope;
      }
      store.put(updated);
      tx.oncomplete = () => { cloud.syncMedia(updated); resolve(updated); };
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteMedia(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => { cloud.deleteMedia(id); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Player-Media Matching ──────────────────────────────────────────────────
// Primary match is TEAM + LASTNAME. Disambiguation when two players on a team
// share a lastname uses (in priority order): jersey #, first initial.
//
// Legacy records (no firstInitial) still resolve when the lastname is
// unambiguous or when the caller doesn't supply a firstInitial.
//
// Signature is backward-compatible: the old third arg `jerseyNum` still works.
// New callers can pass an options object: { firstInitial, jerseyNum }.

export async function findPlayerMedia(team, lastName, optsOrJersey = null) {
  const all = await getAllMedia();
  const T = String(team || '').toUpperCase();
  const LN = String(lastName || '').toUpperCase();

  // Normalise options (back-compat with the old positional jerseyNum arg)
  const opts = (optsOrJersey && typeof optsOrJersey === 'object')
    ? optsOrJersey
    : { jerseyNum: optsOrJersey };
  const wantInitial = (opts.firstInitial || '').toUpperCase().slice(0, 1);
  const wantNum = opts.jerseyNum;

  // Exclude team-scoped records from player matches.
  const playerRecords = all.filter(f => f.scope !== 'team');

  // Lastname-match across ALL teams. Players who get traded keep their
  // existing media (the file is tagged with the team they were on at
  // upload time); we want it to follow them.
  const matchesByLastName = (f) => {
    if ((f.player || '').toUpperCase() === LN) return true;
    const parts = String(f.name || '').replace(/\.[^.]+$/, '').split('_');
    return parts.some(p => p.toUpperCase() === LN);
  };
  const allByName = playerRecords.filter(matchesByLastName);

  // Disambiguate by first-initial when the caller provides one.
  // If any record carries a firstInitial we restrict to matches; if
  // none of the matches have an initial we keep the lastname set
  // (legacy records, no way to disambiguate).
  let matches = allByName;
  if (wantInitial) {
    const withInitial = matches.filter(f => (f.firstInitial || '').toUpperCase() === wantInitial);
    const anyHaveInitial = matches.some(f => f.firstInitial);
    if (withInitial.length) matches = withInitial;
    else if (anyHaveInitial) matches = [];
  }

  // Disambiguate by jersey number when supplied. Strongest signal so
  // it overrides all else.
  if (wantNum != null && wantNum !== '') {
    const padded = String(wantNum).padStart(2, '0');
    const byNum = matches.filter(f => f.num === padded || f.num === String(wantNum));
    if (byNum.length) matches = byNum;
  }

  // Sort: prefer media tagged for the requested team first (typical case
  // — player still on their original team), then everything else (the
  // traded-player fallback). Same-team-first keeps the historical
  // ordering stable.
  matches.sort((a, b) => {
    const aOnTeam = (a.team || '').toUpperCase() === T ? 0 : 1;
    const bOnTeam = (b.team || '').toUpperCase() === T ? 0 : 1;
    return aOnTeam - bOnTeam;
  });

  return matches;
}

// All media for a team (any player), sorted by most recent first.
// By default returns both player- and team-scoped records — pass
// { scope: 'team' } or { scope: 'player' } to filter.
export async function findTeamMedia(team, opts = {}) {
  const all = await getAllMedia();
  const T = String(team || '').toUpperCase();
  let filtered = all.filter(f => (f.team || '').toUpperCase() === T);
  if (opts.scope) {
    filtered = filtered.filter(f => (f.scope || inferScope(f.assetType, f.team)) === opts.scope);
  }
  if (opts.assetType) {
    const wantType = String(opts.assetType).toUpperCase();
    filtered = filtered.filter(f => (f.assetType || '').toUpperCase() === wantType);
  }
  return filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// All league-scoped media (BLW_*), sorted most-recent-first. Optional
// assetType filter so consumers can ask for, say, only ALLSTAR photos.
export async function findLeagueMedia(opts = {}) {
  const all = await getAllMedia();
  let filtered = all.filter(f =>
    (f.scope || inferScope(f.assetType, f.team)) === 'league'
  );
  if (opts.assetType) {
    const wantType = String(opts.assetType).toUpperCase();
    filtered = filtered.filter(f => (f.assetType || '').toUpperCase() === wantType);
  }
  return filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// ─── Avatar resolution — single source of truth ─────────────────────────────
//
// Used by PlayerPage hero, TeamPage roster cards, and anywhere else we
// render a player's "face" thumbnail. Before this lived in two separate
// implementations with different inclusion lists (PlayerPage took only
// HEADSHOT/PORTRAIT; TeamPage took HEADSHOT/PORTRAIT/ACTION) and different
// ordering rules, so the same player would surface different photos in
// different surfaces. This function is the canonical resolver — call it
// from every avatar consumer.
//
// Resolution order (highest priority first):
//   1. profile_media_id override — admin's explicit pick.
//   2. Same FI + jersey number HEADSHOT — strongest auto signal,
//      disambiguates cousins (Paul #02 vs Will #22 Marshall).
//   3. Same FI + jersey number PORTRAIT.
//   4. Same FI + jersey number ACTION (back of jersey is better than nothing).
//   5. Same FI HEADSHOT.
//   6. Same FI PORTRAIT.
//   7. Same FI ACTION.
//   8. Lastname-only legacy match HEADSHOT, PORTRAIT, then ACTION —
//      ONLY when the lastname is unique among the candidate roster
//      (otherwise we'd hand the same file to multiple cousins).
//
// Inputs:
//   player:     { team, lastName, firstInitial, num }   — required
//   allMedia:   array of media records (typically getAllMedia() result)
//   opts.profileMediaId    — admin override (manual_players.profile_media_id)
//   opts.lastnameUnique    — bool: true if no other roster entry shares
//                            this lastname on this team. Defaults to true
//                            for safety on single-player calls.
//
// Returns the media record (or null). Caller is responsible for
// generating an object URL from .blob if it needs a string URL.
export const AVATAR_ASSET_TYPES_PRIORITY = ['HEADSHOT', 'PORTRAIT', 'ACTION'];

export function resolvePlayerAvatar(player, allMedia, opts = {}) {
  if (!player || !Array.isArray(allMedia)) return null;
  const LN = String(player.lastName || '').toUpperCase();
  const FI = String(player.firstInitial || (player.firstName || '').charAt(0)).toUpperCase();
  const NUM = String(player.num || '').padStart(2, '0');
  const lastnameUnique = opts.lastnameUnique !== false;

  // 1. Admin-picked override — wins everything else.
  if (opts.profileMediaId) {
    const override = allMedia.find(m => m.id === opts.profileMediaId);
    if (override) return override;
  }

  // Player-scoped only — team logos, league branding, etc. don't qualify
  // as a player avatar even if their filename happens to match.
  const playerOnly = allMedia.filter(m =>
    (m.scope || inferScope(m.assetType, m.team)) === 'player'
  );
  const lastnameMatches = playerOnly.filter(m => (m.player || '').toUpperCase() === LN);

  const padNum = (n) => String(n || '').padStart(2, '0');
  const matchesFI = (m) => (m.firstInitial || '').toUpperCase() === FI;
  const matchesNum = (m) => NUM && padNum(m.num) === NUM;
  const isType = (m, t) => (m.assetType || '').toUpperCase() === t;

  // 2-4. Same FI + jersey number, in priority order.
  if (FI && NUM) {
    for (const t of AVATAR_ASSET_TYPES_PRIORITY) {
      const hit = lastnameMatches.find(m => matchesFI(m) && matchesNum(m) && isType(m, t));
      if (hit) return hit;
    }
  }
  // 5-7. Same FI alone, in priority order.
  if (FI) {
    for (const t of AVATAR_ASSET_TYPES_PRIORITY) {
      const hit = lastnameMatches.find(m => matchesFI(m) && isType(m, t));
      if (hit) return hit;
    }
  }
  // 8. Legacy lastname-only — but only when the lastname doesn't
  //    overlap with another roster entry. Marshall on AZS has Paul
  //    AND Will, so neither cousin should fall back to a generic
  //    Marshall file (that's how Will ended up with Paul's photo).
  if (lastnameUnique) {
    for (const t of AVATAR_ASSET_TYPES_PRIORITY) {
      const hit = lastnameMatches.find(m => !m.firstInitial && isType(m, t));
      if (hit) return hit;
    }
  }
  return null;
}

export function blobToObjectURL(blob) {
  return URL.createObjectURL(blob);
}

export function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}
