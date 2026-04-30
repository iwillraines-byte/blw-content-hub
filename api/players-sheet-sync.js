// Admin endpoint for ingesting player bios from a CSV. Three input modes,
// in order of privacy:
//
//   1. csvText  — admin paste-CSV directly into the request body (most
//                 private, the data never sits on a public URL)
//   2. csvFile  — admin uploads a CSV file in the browser; the client
//                 reads it and sends contents as csvText
//   3. csvUrl   — server fetches a published Google Sheet CSV URL
//                 (CONVENIENT but the URL is a shared secret — anyone
//                 who learns it can read the whole sheet forever)
//
// Whichever path the admin uses, the server applies the same column
// auto-detect + PII deny-list + dry-run preview before any writes hit
// `manual_players`.
//
// Request body:
//   {
//     csvText?:    string,          // raw CSV — preferred input mode
//     csvUrl?:     string,          // public CSV URL — used only if csvText absent
//     columnMap?:  Record<string, string>,  // optional override of auto-detection
//     dryRun?:     boolean,         // preview only, no writes (default false)
//   }
//
// Response:
//   {
//     detectedMap:  { heightIn: 'Height', team: 'Team', ... },
//     headers:      ['Timestamp', 'First Name', ...],
//     summary: { processed, created, updated, skipped },
//     rows: [
//       { status: 'created' | 'updated' | 'skipped', reason?, record },
//       ...
//     ],
//   }
//
// Safety:
//   - Admin JWT required (requireAdmin)
//   - Data only written to the `manual_players` table — API stats + media
//     never touched.
//   - Upsert key: (team, last_name, COALESCE(nickname-safe first-initial))
//     so a row is matched by full-name equality rather than blindly
//     inserting dupes. See resolveExistingPlayer() below.

import { requireUser, requireAdmin } from './_supabase.js';

// Canonical BLW team mapping — matches src/data.js TEAMS. Values are the
// set of strings a sheet might contain for each team_id. Both 'LV' and
// the legacy 'LVS' resolve to LV after the rename.
const TEAM_ALIASES = {
  LAN: ['lan', 'la', 'la naturals', 'los angeles naturals', 'naturals'],
  AZS: ['azs', 'az', 'az saguaros', 'arizona saguaros', 'saguaros'],
  LV:  ['lv', 'lvs', 'lv scorpions', 'las vegas scorpions', 'scorpions'],
  NYG: ['nyg', 'ny', 'ny greenapples', 'ny green apples', 'new york green apples', 'green apples', 'greenapples'],
  DAL: ['dal', 'dal pandas', 'dallas pandas', 'pandas'],
  BOS: ['bos', 'bos harborhawks', 'bos harbor hawks', 'boston harbor hawks', 'harbor hawks', 'harborhawks'],
  PHI: ['phi', 'phi wiffleclub', 'philadelphia wiffle club', 'wiffle club', 'wiffleclub'],
  CHI: ['chi', 'chi bats', 'chicago bats', 'bats'],
  MIA: ['mia', 'mia mirage', 'miami mirage', 'mirage'],
  SDO: ['sdo', 'sd', 'sd orcas', 'san diego orcas', 'orcas'],
};

// Name aliases — same set as src/data.js NAME_ALIASES. Server-side
// duplicate so the bio importer can normalize before lookup. Keys are
// normalized; values are the canonical display name.
const NAME_ALIASES = {
  'mychal witty jr.': 'Myc Witty',
  'mychal witty jr':  'Myc Witty',
  'mychal witty':     'Myc Witty',
  'edward martinez':  'Nick Martinez',
  'eddie martinez':   'Nick Martinez',
  'ed martinez':      'Nick Martinez',
};
const _normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
function resolveCanonicalName(name) {
  return NAME_ALIASES[_normName(name)] || name;
}

// Header normaliser — used by the PII deny-list and the column matcher.
// Defined here (above any caller) so module load order never trips us up.
const norm = (s) => String(s || '').toLowerCase().replace(/[\s_\-.()/]+/g, '');

// PII deny-list — even if an admin tries to manually map one of these
// headers to a target field via columnMap, we refuse. Better to be a
// dumb-no than a smart-yes for personal data we have no business storing.
//
// Matched against the NORMALIZED header (lowercase, no punct/spaces).
// Substring match — so "email", "your email", "email address",
// "contactemail" all get blocked.
const PII_DENY = [
  'email',
  'mail',
  'phone',
  'mobile',
  'cell',
  'tel',
  'address',
  'street',
  'zip',
  'zipcode',
  'postal',
  'ssn',
  'socialsecurity',
  'dl',          // driver's license
  'driverlicense',
  'passport',
  // Instagram intentionally NOT in this list — it's an explicit
  // opt-in field (instagramHandle). Other socials stay blocked unless
  // a master_admin allow-lists them via the override flow.
  'twitter',
  'tiktok',
  'snapchat',
  'discord',
  'venmo',
  'cashapp',
  'paypal',
  'emergencycontact',
  'guardian',
  'parent',
];
function isPiiHeader(header) {
  const n = norm(header);
  return PII_DENY.some(p => n.includes(p));
}

// Aliases for each target field — header matching is case + space +
// punctuation insensitive. Longer keys are tried first so "first name"
// matches before falling back to bare "name".
const FIELD_ALIASES = {
  team:       ['team', 'teamid', 'teamabbreviation', 'teamabbr', 'club'],
  lastName:   ['lastname', 'last', 'surname', 'familyname'],
  firstName:  ['firstname', 'first', 'givenname', 'fname'],
  fullName:   ['fullname', 'name', 'playername'],   // will be split if present
  num:        ['num', 'number', 'jerseynumber', 'jersey', 'jersey#', '#'],
  position:   ['position', 'pos', 'primaryposition'],
  heightIn:   ['height', 'heightinches', 'heightin', 'ht', 'heightft', 'heightftin'],
  weightLbs:  ['weight', 'weightlbs', 'weightpounds', 'wt', 'lbs'],
  birthdate:  ['birthdate', 'dateofbirth', 'dob', 'birthday'],
  bats:       ['bats', 'battinghand', 'batside', 'b'],
  throws:     ['throws', 'throwinghand', 'throwside', 't'],
  birthplace: ['birthplace', 'hometown', 'home', 'from', 'bornin'],
  nickname:   ['nickname', 'alias', 'nickname(s)'],
  // Player-facing extras — surfaced on the PlayerHero. Intentional
  // opt-in fields, not PII.
  instagramHandle: ['instagram', 'instagramhandle', 'ighandle', 'iginsta', 'ig', 'insta', 'igusername'],
  funFacts:        ['funfacts', 'funfact', 'aboutme', 'bio', 'tellusaboutyou', 'tellusaboutyourself', 'aboutyou', 'tellusabout'],
  isRookie:        ['rookie', 'isrookie', 'firstyear', 'firstseason', 'rookieyear', 'rookieseason'],
};

// Minimal RFC-4180 CSV parser. Handles quoted fields, "" escapes, \r\n.
// Sheets' published CSVs are well-formed so we don't need Papa Parse.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

// Fuzzy-match every header to a known field. Returns
// { heightIn: 'Height (in inches)', team: 'Team', ... }
// PII headers are excluded from consideration via the `piiCheck` predicate
// passed in (the handler wires this up so master_admin's allow-list can
// unblock specific columns).
function autoDetectColumns(headers, piiCheck = isPiiHeader) {
  const map = {};
  const used = new Set();
  const eligible = headers.map(h => ({ raw: h, n: norm(h), pii: piiCheck(h) }))
    .filter(h => !h.pii);
  // Greedy: for each field, try its aliases in order; first unused match wins.
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const a = norm(alias);
      const hit = eligible.find(h => !used.has(h.raw) && h.n === a);
      if (hit) {
        map[field] = hit.raw;
        used.add(hit.raw);
        break;
      }
    }
    // Substring fallback — e.g. "Your height (inches)" matches "height"
    if (!map[field]) {
      for (const alias of aliases) {
        const a = norm(alias);
        const hit = eligible.find(h => !used.has(h.raw) && h.n.includes(a));
        if (hit) {
          map[field] = hit.raw;
          used.add(hit.raw);
          break;
        }
      }
    }
  }
  return map;
}

// Categorize every header into one of four buckets. Used for transparency
// in the response — never the source of truth for write logic.
//   - mapped:     getting written to a target field this run
//   - piiBlocked: PII pattern matched, NOT in master-admin allow-list, refused
//   - piiAllowed: PII pattern matched but master-admin explicitly allowed
//                 (may be mapped or not — the override + mapping are
//                 independent so an allowed col can still sit unmapped)
//   - unmapped:   non-PII, not auto-detected, not manually mapped
function categorizeHeaders(headers, finalMap, allowSet) {
  const mappedRawSet = new Set(Object.values(finalMap));
  const out = { mapped: [], piiBlocked: [], piiAllowed: [], unmapped: [] };
  for (const h of headers) {
    const pii = isPiiHeader(h);
    const isMapped = mappedRawSet.has(h);
    // Mapped headers always show as "mapped" (including allowed-PII that
    // got pointed at a target field). Unmapped allowed-PII sits in its
    // own bucket so the admin sees "this is unblocked but you still need
    // to map it to a field." Unallowed PII stays refused.
    if (isMapped)                out.mapped.push(h);
    else if (pii && allowSet.has(h)) out.piiAllowed.push(h);
    else if (pii)                out.piiBlocked.push(h);
    else                          out.unmapped.push(h);
  }
  return out;
}

// Normalize a team string to a canonical id like "LAN". Returns null if
// nothing plausible matched.
function resolveTeamId(raw) {
  const n = norm(raw);
  if (!n) return null;
  for (const [id, aliases] of Object.entries(TEAM_ALIASES)) {
    if (n === norm(id) || aliases.some(a => norm(a) === n)) return id;
  }
  // substring fallback
  for (const [id, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.some(a => n.includes(norm(a)) || norm(a).includes(n))) return id;
  }
  return null;
}

// Parse a height string into total inches. Accepts 73, "6'1", "6'1\"",
// "6 ft 1 in", "6 1", etc. Returns null if unparseable.
function parseHeightInches(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw > 0 && raw < 120 ? raw : null;
  const s = String(raw).trim();
  // Pure inches
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n > 0 && n < 120 ? Math.round(n) : null;
  }
  // Feet+inches — common formats
  const m = s.match(/^(\d+)\s*['’´]\s*(\d+(?:\.\d+)?)?\s*["”]?$/)
         || s.match(/^(\d+)\s*(?:ft|foot|feet)\s*(\d+(?:\.\d+)?)?\s*(?:in|inch|inches|")?$/i)
         || s.match(/^(\d+)\s+(\d+(?:\.\d+)?)$/);
  if (m) {
    const ft = Number(m[1]);
    const inch = m[2] ? Number(m[2]) : 0;
    const total = ft * 12 + inch;
    return total > 0 && total < 120 ? Math.round(total) : null;
  }
  return null;
}

function parseWeightLbs(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw > 0 && raw < 600 ? Math.round(raw) : null;
  const s = String(raw).replace(/[^\d.]/g, '');
  if (!s) return null;
  const n = Number(s);
  return n > 0 && n < 600 ? Math.round(n) : null;
}

// Parse "R" | "Right" | "right-handed" → "R". Unknown → null.
function parseHand(raw, allowSwitch = false) {
  if (!raw) return null;
  const n = norm(raw);
  if (n === 'r' || n.startsWith('right')) return 'R';
  if (n === 'l' || n.startsWith('left'))  return 'L';
  if (allowSwitch && (n === 's' || n.startsWith('switch') || n.startsWith('both'))) return 'S';
  return null;
}

// Parse into an ISO date (YYYY-MM-DD) or null.
function parseBirthdate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // MM/DD/YYYY or M/D/YYYY
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const [, mm, dd, yy] = m;
    const year = yy.length === 2 ? (Number(yy) > 30 ? 1900 + Number(yy) : 2000 + Number(yy)) : Number(yy);
    return `${String(year).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  // Fallback: try Date parse
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getUTCFullYear();
    if (y > 1900 && y < 2100) {
      return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
  }
  return null;
}

// Strip leading @, URL prefix, trailing slashes, etc. Returns the bare
// handle. Refuses anything with whitespace inside (likely a paragraph
// of text rather than a real handle).
function parseInstagramHandle(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Strip URL forms
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '');
  s = s.replace(/\/+$/, '');
  s = s.replace(/^@+/, '');
  // Reject if there's whitespace inside or it's empty after stripping
  if (!s || /\s/.test(s)) return null;
  // Cap length — IG handles are <= 30 chars
  if (s.length > 30) s = s.slice(0, 30);
  return s;
}

// Boolean parser — accepts Y/N, yes/no, true/false, 1/0. Empty → null
// (so we don't overwrite an existing row's value with a blank).
function parseBoolean(raw) {
  if (raw == null || raw === '') return null;
  const n = String(raw).trim().toLowerCase();
  if (['y', 'yes', 'true', '1', 't', 'rookie'].includes(n)) return true;
  if (['n', 'no', 'false', '0', 'f', 'veteran', 'returning'].includes(n)) return false;
  return null;
}

// Find an existing manual_players row matching (team, lastName, firstName).
// Disambiguation hierarchy:
//   1. exact full-name match (case-insensitive on first_name) — handles
//      cousin pairs like Logan vs Luke Rose where both share initial 'L'
//      and the old "first initial only" check would collide them into a
//      single row, overwriting one cousin's bio with the other's.
//   2. lone match by lastname — ONLY when the existing row has no
//      first_name at all (legacy data-shape quirk). Previously this
//      fired whenever there was a single row, which meant a CSV row for
//      Logan Rose would overwrite Carson's record if Carson was the
//      only existing Rose. v4.5.3: tightened to mirror the client-side
//      fix in getPlayerByTeamLastName.
//   3. first initial match — multi-row case only, when full-name didn't
//      hit (CSV said "Logan" but DB has "Logan A." or similar variant).
//   4. nothing — caller will INSERT a new row.
async function resolveExistingPlayer(sb, teamId, lastName, firstName) {
  const { data, error } = await sb.from('manual_players')
    .select('id, first_name, last_name, team')
    .eq('team', teamId)
    .ilike('last_name', lastName);
  if (error) throw error;
  if (!data || data.length === 0) return null;

  const fnLower = String(firstName || '').trim().toLowerCase();
  if (fnLower) {
    // Exact firstName match wins — Logan stays Logan, Luke stays Luke.
    const exact = data.find(r => (r.first_name || '').trim().toLowerCase() === fnLower);
    if (exact) return exact;
  }

  // Single row + no first_name on existing row → legacy quirk fallback.
  // Without the firstName check this used to overwrite whoever happened
  // to be the only DAL Rose in the table whenever a CSV row landed for
  // a different Rose. With the check, the only way this fires is if the
  // existing row genuinely has no firstName — the data-shape case the
  // fallback was intended for.
  if (data.length === 1) {
    const onlyHasFn = data[0].first_name && String(data[0].first_name).trim();
    if (!onlyHasFn) return data[0];
  }

  // Multiple rows AND no full-name match: try first-initial as last
  // resort. This is what the old code did unconditionally; now it's
  // a fallback only.
  const fi = fnLower.charAt(0).toUpperCase();
  if (fi) {
    const initialHit = data.find(r => (r.first_name || '').charAt(0).toUpperCase() === fi);
    if (initialHit) return initialHit;
  }

  // Multiple rows, no firstName signal — return null so caller creates
  // a NEW row instead of arbitrarily overwriting one of the cousins.
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = await requireUser(req, res);
  if (!ctx) return;
  if (requireAdmin(res, ctx.profile)) return;
  const sb = ctx.sb;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const {
    csvText: bodyCsv,
    csvUrl,
    columnMap: overrideMap,
    dryRun = false,
    // Headers the admin has explicitly allowed despite matching the PII
    // deny-list. ONLY honored when the requester is master_admin — admin
    // and content roles can't bypass the deny-list.
    piiOverrideAllow,
  } = body;
  const isMasterAdmin = ctx.profile?.role === 'master_admin';
  const allowSet = new Set(
    (isMasterAdmin && Array.isArray(piiOverrideAllow))
      ? piiOverrideAllow.filter(h => typeof h === 'string')
      : []
  );
  // The "is this header off-limits" test now factors in the allow-list.
  const piiBlocked = (header) => isPiiHeader(header) && !allowSet.has(header);

  // Pick the input mode. Direct text wins — it's the most private path
  // and the admin literally just sent us the data, so there's no reason
  // to also fetch a URL.
  let csvText = null;
  let inputMode = null;
  if (bodyCsv && typeof bodyCsv === 'string' && bodyCsv.trim().length > 0) {
    csvText = bodyCsv;
    inputMode = 'text';
  } else if (csvUrl && typeof csvUrl === 'string') {
    if (!/^https?:\/\//i.test(csvUrl)) {
      return res.status(400).json({ error: 'csvUrl must be an http(s) URL' });
    }
    inputMode = 'url';
    try {
      const upstream = await fetch(csvUrl, {
        headers: { 'Accept': 'text/csv,*/*' },
        redirect: 'follow',
      });
      if (!upstream.ok) {
        return res.status(502).json({ error: `Sheet fetch failed: ${upstream.status} ${upstream.statusText}` });
      }
      csvText = await upstream.text();
    } catch (err) {
      return res.status(502).json({ error: 'Sheet fetch failed', detail: err.message });
    }
  } else {
    return res.status(400).json({ error: 'Provide either csvText (preferred) or csvUrl' });
  }

  // Parse + detect columns
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return res.status(400).json({ error: 'Sheet has fewer than 2 rows (need header + at least one data row)' });
  }
  const headers = rows[0].map(h => String(h || '').trim());
  const detectedMap = autoDetectColumns(headers, piiBlocked);

  // Strip any override-map entries that point at a still-blocked PII header.
  // Headers in the master_admin allow-list are no longer "blocked" so they
  // can be mapped freely. Empty-string overrides explicitly UNMAP a field
  // even when auto-detect found it.
  const cleanOverride = {};
  const blockedOverrides = [];
  const explicitlyUnmappedFields = new Set();
  for (const [field, header] of Object.entries(overrideMap || {})) {
    if (header === '' || header == null) {
      explicitlyUnmappedFields.add(field);
    } else if (piiBlocked(header)) {
      blockedOverrides.push({ field, header });
    } else {
      cleanOverride[field] = header;
    }
  }
  // Build the final map: auto-detect + cleaned overrides, minus any
  // fields the admin has explicitly chosen to ignore.
  const map = { ...detectedMap, ...cleanOverride };
  for (const f of explicitlyUnmappedFields) delete map[f];

  const headerCategories = categorizeHeaders(headers, map, allowSet);

  // Column → index lookup for fast access
  const colIdx = {};
  for (const [field, header] of Object.entries(map)) {
    const idx = headers.indexOf(header);
    if (idx !== -1) colIdx[field] = idx;
  }

  // Must have team + lastName columns to be useful
  if (colIdx.team == null) {
    return res.status(400).json({
      error: 'Could not detect a TEAM column. Please add a mapping override.',
      headers, detectedMap,
    });
  }
  if (colIdx.lastName == null && colIdx.fullName == null) {
    return res.status(400).json({
      error: 'Could not detect a NAME column (need "Last Name" or "Full Name").',
      headers, detectedMap,
    });
  }

  const summary = { processed: 0, created: 0, updated: 0, skipped: 0 };
  const resultRows = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const raw = {};
    for (const [field, idx] of Object.entries(colIdx)) {
      raw[field] = row[idx];
    }

    summary.processed++;

    // Resolve team
    const teamId = resolveTeamId(raw.team);
    if (!teamId) {
      summary.skipped++;
      resultRows.push({ row: r + 1, status: 'skipped', reason: `Unknown team "${raw.team}"`, record: raw });
      continue;
    }

    // Resolve name — prefer explicit lastName; otherwise split fullName
    let firstName = raw.firstName ? String(raw.firstName).trim() : '';
    let lastName = raw.lastName ? String(raw.lastName).trim() : '';
    if ((!firstName || !lastName) && raw.fullName) {
      const parts = String(raw.fullName).trim().split(/\s+/);
      if (!lastName && parts.length > 0) lastName = parts[parts.length - 1];
      if (!firstName && parts.length > 1) firstName = parts.slice(0, -1).join(' ');
    }
    if (!lastName) {
      summary.skipped++;
      resultRows.push({ row: r + 1, status: 'skipped', reason: 'No last name', record: raw });
      continue;
    }
    // Canonical-name resolution — "Mychal Witty Jr." in the sheet should
    // resolve to "Myc Witty" so it merges with his existing manual_players
    // row + the API stats keyed under the canonical name.
    const fullNameRaw = `${firstName} ${lastName}`.trim();
    const canonicalFull = resolveCanonicalName(fullNameRaw);
    if (canonicalFull !== fullNameRaw) {
      const parts = canonicalFull.split(/\s+/);
      lastName = parts[parts.length - 1];
      firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
    }
    const firstInitial = firstName.charAt(0).toUpperCase();

    // Build the update payload. Only include fields whose columns exist
    // and whose parsed values are non-null — we don't want to wipe
    // previously-entered data with a blank from a partially-filled row.
    const updates = {};
    if (firstName) updates.first_name = firstName;
    updates.last_name = lastName;
    updates.team = teamId;
    if (colIdx.num != null) {
      const n = String(raw.num || '').trim();
      if (n) updates.num = n;
    }
    if (colIdx.position != null) {
      const p = String(raw.position || '').trim();
      if (p) updates.position = p;
    }
    if (colIdx.heightIn != null) {
      const h = parseHeightInches(raw.heightIn);
      if (h != null) updates.height_in = h;
    }
    if (colIdx.weightLbs != null) {
      const w = parseWeightLbs(raw.weightLbs);
      if (w != null) updates.weight_lbs = w;
    }
    if (colIdx.birthdate != null) {
      const d = parseBirthdate(raw.birthdate);
      if (d) updates.birthdate = d;
    }
    if (colIdx.bats != null) {
      const b = parseHand(raw.bats, true);
      if (b) updates.bats = b;
    }
    if (colIdx.throws != null) {
      const t = parseHand(raw.throws, false);
      if (t) updates.throws = t;
    }
    if (colIdx.birthplace != null) {
      const p = String(raw.birthplace || '').trim();
      if (p) updates.birthplace = p;
    }
    if (colIdx.nickname != null) {
      const nn = String(raw.nickname || '').trim();
      if (nn) updates.nickname = nn;
    }
    if (colIdx.instagramHandle != null) {
      const ig = parseInstagramHandle(raw.instagramHandle);
      if (ig) updates.instagram_handle = ig;
    }
    if (colIdx.funFacts != null) {
      const ff = String(raw.funFacts || '').trim();
      if (ff) updates.fun_facts = ff;
    }
    if (colIdx.isRookie != null) {
      const r = parseBoolean(raw.isRookie);
      if (r != null) updates.is_rookie = r;
    }

    // Upsert
    try {
      // Pass full firstName so cousins (Logan vs Luke Rose) resolve to
      // their own rows instead of colliding on shared first initial.
      const existing = await resolveExistingPlayer(sb, teamId, lastName, firstName);
      if (existing) {
        if (!dryRun) {
          const { error } = await sb.from('manual_players').update(updates).eq('id', existing.id);
          if (error) throw error;
        }
        summary.updated++;
        resultRows.push({ row: r + 1, status: 'updated', id: existing.id, record: updates });
      } else {
        const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const newRow = { id, ...updates };
        if (!dryRun) {
          const { error } = await sb.from('manual_players').insert(newRow);
          if (error) throw error;
        }
        summary.created++;
        resultRows.push({ row: r + 1, status: 'created', id, record: newRow });
      }
    } catch (err) {
      summary.skipped++;
      resultRows.push({ row: r + 1, status: 'skipped', reason: err.message, record: updates });
    }
  }

  return res.status(200).json({
    inputMode,                  // 'text' or 'url' — for the UI to confirm what got used
    requesterRole: ctx.profile?.role || null, // so UI can show master-admin overrides
    detectedMap,
    headers,
    headerCategories,           // { mapped, piiBlocked, piiAllowed, unmapped }
    blockedOverrides,           // entries the admin tried to map but were refused
    piiAllowApplied: [...allowSet], // which headers the admin allowed for THIS run
    rowsInSheet: rows.length - 1,
    summary,
    rows: resultRows.slice(0, 200),  // cap response size
    dryRun,
  });
}

// Allow larger request bodies — pasted CSVs for ~250 players can run
// 50–80 KB, well under Vercel's defaults but worth being explicit.
export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
};
