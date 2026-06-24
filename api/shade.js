// api/shade.js — BLW Studio ↔ Shade DAM bridge for the Rapid Tag widget.
//
// Lets the master admin rapid-categorize onsite photos that live in Shade,
// writing Team / Player / Content Type straight back onto the Shade asset's
// custom metadata (Shade stays the source of truth — we don't import the raws).
//
// Actions (GET ?action= / POST {action}):
//   config       → { connected, collection, defaultCollectionId } — key set?
//   collections  → { collections:[{id,name,description}], source } — curated bins
//   folders      → { folders:[{path,name}], root }                 — raw intake folders
//   queue        → { assets:[{id,name,previewUrl,width,height}], hasMore, offset }
//                  (accepts collectionId OR folderPath to choose the source)
//   suggest      → { team, contentType, num, confidence, reasoning }  (Claude vision)
//   tag          → writes Team/Player/Content Type to a Shade asset
//
// Env vars (Vercel, server-only):
//   SHADE_API_KEY     — from Shade → Settings → API Keys (starts with sk_…)
//   ANTHROPIC_API_KEY — already used by /api/auto-tag for vision
//   ANTHROPIC_MODEL   — optional, defaults to claude-haiku-4-5
//
// All actions are master-admin only (this writes to the production DAM).

import { requireUser, requireRole } from './_supabase.js';

const SHADE_BASE = 'https://api.shade.inc';
const DRIVE_ID = '5a4eeaae-83e7-4ea0-b223-5edafa20909c';        // BLW ONSITE CONTENT DROP
const COLLECTION_ID = 'b293692d-98bd-45ec-be29-6a72a74b2c0c';   // 📸 BLW WEEK 1 ALL PHOTOS (auto-updating) — default queue
const INTAKE_ROOT = '/BLW ONSITE INTAKE';                       // where dated drop folders live (JUNE 14th DROP, …)

// Known collections in the BLW drive, used as a safety net if the live
// list endpoint shape differs from what we expect. The live fetch (when it
// works) supersedes this AND picks up newly-created collections — these are
// just so the picker never comes up empty. IDs are stable Shade UUIDs.
const KNOWN_COLLECTIONS = [
  { id: 'b293692d-98bd-45ec-be29-6a72a74b2c0c', name: '📸 BLW WEEK 1 ALL PHOTOS', description: 'Every Week 1 photo, auto-updating.' },
  { id: '2f28484d-2da7-4b44-9e8a-adc583bf5a2a', name: '🟢 Social Ready', description: 'Edited, delivery-ready stills.' },
  { id: 'd97f6abc-53e4-4b45-a637-9863f58e536a', name: 'JAMES LEE WEEK 1 SUPER CUT', description: "James Lee's Week 1 super cut." },
];

// Shade custom-metadata field ids (created via the Rapid Tag setup).
const FIELD = {
  team:   'c8c417f9-ad1d-42ba-b1c4-cd9831616dec',  // Teams        (multi_select)
  player: 'dcaf0f6a-9d80-4ede-8137-cd9cf8332598',  // Player       (single_select)
  type:   '6b37f9ed-ecd3-466f-b6f8-a9b6c90d070b',  // Content Type (single_select)
};

// Our internal team id → the option label that exists in Shade's Teams field.
const TEAM_TO_SHADE = {
  LAN: 'LA', AZS: 'AZ', LV: 'LV', NYG: 'NYK', DAL: 'DAL',
  BOS: 'BOS', PHI: 'PHI', CHI: 'CHI', MIA: 'MIA', ATL: 'ATL', SDO: 'ATL',
};

const DEFAULT_MODEL = 'claude-haiku-4-5';

function shadeHeaders(key) {
  // Shade wants the secret key directly in Authorization — no "Bearer" prefix.
  return { Authorization: key, 'content-type': 'application/json' };
}

function shadeKey() {
  return process.env.SHADE_API_KEY || '';
}

// ─── Drive metadata schema cache (field option name → option id) ────────────
let _maps = null;
let _mapsAt = 0;
async function getOptionMaps(key) {
  if (_maps && Date.now() - _mapsAt < 5 * 60 * 1000) return _maps;
  const r = await fetch(`${SHADE_BASE}/workspaces/drives/${DRIVE_ID}/metadata`, { headers: shadeHeaders(key) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Shade schema HTTP ${r.status}: ${text.slice(0, 200)}`);
  let parsed; try { parsed = JSON.parse(text); } catch { throw new Error('Shade schema response was not JSON'); }
  // Tolerate a top-level array OR a wrapped object.
  const fields = Array.isArray(parsed)
    ? parsed
    : (parsed.metadata || parsed.fields || parsed.attributes || parsed.data || parsed.results || []);
  const maps = { team: {}, player: {}, type: {} };
  const counts = { team: 0, player: 0, type: 0 };
  for (const f of (Array.isArray(fields) ? fields : [])) {
    const fid = f.id || f.metadata_id || f.attribute_id || f.metadataId;
    const which = fid === FIELD.team ? 'team' : fid === FIELD.player ? 'player' : fid === FIELD.type ? 'type' : null;
    if (!which) continue;
    for (const o of (f.options || f.values || f.choices || [])) {
      const oid = o.id || o.option_id || o.optionId || o.value;
      const oname = o.name || o.label || o.value;
      if (oname && oid) { maps[which][String(oname).toLowerCase()] = oid; counts[which]++; }
    }
  }
  maps._counts = counts;
  maps._fieldCount = Array.isArray(fields) ? fields.length : 0;
  _maps = maps;
  _mapsAt = Date.now();
  return maps;
}

// Read a custom-metadata value off a /search asset, tolerant of whether Shade
// keys custom_metadata by field id or field name.
function metaValue(asset, fieldId, fieldName) {
  const m = asset?.custom_metadata || asset?.metadata || {};
  if (m[fieldId] != null) return m[fieldId];
  if (fieldName && m[fieldName] != null) return m[fieldName];
  return null;
}

function previewUrlOf(asset) {
  const frames = asset?.preview_images || asset?.previews || [];
  return frames[0]?.signed_url || frames[0]?.url || asset?.thumbnail || null;
}

// ─── Actions ────────────────────────────────────────────────────────────────

// List the drive's collections so the user can pick which folder to tag from.
// Tries the live endpoint (a couple candidate paths, since the exact shape
// isn't documented), tolerant-parses, and falls back to the known list so the
// picker always has options.
async function doCollections(key) {
  // Documented endpoint: GET /collections?drive_id=… . The others are kept as
  // tolerant fallbacks; the hardcoded list guarantees the picker never empties.
  const candidates = [
    `${SHADE_BASE}/collections?drive_id=${DRIVE_ID}`,
    `${SHADE_BASE}/workspaces/drives/${DRIVE_ID}/collections`,
    `${SHADE_BASE}/drives/${DRIVE_ID}/collections`,
  ];
  for (const url of candidates) {
    try {
      const r = await fetch(url, { headers: shadeHeaders(key) });
      if (!r.ok) continue;
      const text = await r.text();
      let parsed; try { parsed = JSON.parse(text); } catch { continue; }
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed.collections || parsed.results || parsed.data || parsed.items || []);
      const list = (Array.isArray(arr) ? arr : [])
        .map(c => ({
          id: c.id || c.collection_id || c.collectionId || c.uuid,
          name: c.name || c.title || c.label || 'Untitled collection',
          description: c.description || c.desc || '',
          count: c.asset_count ?? c.assetCount ?? c.count ?? null,
        }))
        .filter(c => c.id);
      if (list.length) return { collections: list, source: 'live' };
    } catch { /* try next candidate */ }
  }
  return { collections: KNOWN_COLLECTIONS.map(c => ({ ...c, count: null })), source: 'fallback' };
}

// List the dated drop folders under the intake root. Response is documented
// as a JSON array of path strings; tolerate an object wrapper or path objects.
// Template/system folders (leading "_") are hidden.
async function doFolders(key, body) {
  const root = body.path || INTAKE_ROOT;
  const url = `${SHADE_BASE}/search/folders?drive_id=${DRIVE_ID}&path=${encodeURIComponent(root)}`;
  const r = await fetch(url, { headers: shadeHeaders(key) });
  if (!r.ok) return { folders: [], root, error: `HTTP ${r.status}` };
  const text = await r.text();
  let parsed; try { parsed = JSON.parse(text); } catch { return { folders: [], root }; }
  const arr = Array.isArray(parsed) ? parsed : (parsed.folders || parsed.results || parsed.data || parsed.paths || []);
  const folders = (Array.isArray(arr) ? arr : [])
    .map(f => {
      const path = typeof f === 'string' ? f : (f.path || f.full_path || f.fullPath || f.name);
      if (!path) return null;
      const name = String(path).replace(/\/+$/, '').split('/').filter(Boolean).pop() || String(path);
      return { path: String(path), name };
    })
    .filter(Boolean)
    .filter(f => !f.name.startsWith('_'));
  return { folders, root };
}

async function doQueue(key, body) {
  const limit = Math.min(Number(body.limit) || 24, 60);
  const offset = Number(body.offset) || 0;
  // Only assets that haven't been categorized yet. Content Type is the
  // universal "processed" marker — every photo gets one (a player type,
  // "Team", or "N/A"), so it's a cleaner gate than Player (empty for team/
  // crowd/venue shots). Same filter applies to collection AND folder sources.
  const filters = [{ id: FIELD.type, options: [], clause: 'is empty' }];

  // Folder source → POST /search/files with a path (recursive catches the
  // per-photographer subfolders inside each dated drop). Collection source →
  // POST /search with collection_id (default behavior).
  const folderPath = body.folderPath || null;
  let url, payload;
  if (folderPath) {
    url = `${SHADE_BASE}/search/files`;
    payload = { drive_id: DRIVE_ID, path: folderPath, recursive: true, limit, offset, filters };
  } else {
    url = `${SHADE_BASE}/search`;
    payload = { drive_id: DRIVE_ID, collection_id: body.collectionId || COLLECTION_ID, limit, offset, filters };
  }
  const r = await fetch(url, {
    method: 'POST', headers: shadeHeaders(key), body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Shade search HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const raw = await r.json();
  const list = Array.isArray(raw) ? raw : (raw.assets || raw.results || []);
  // Belt-and-suspenders: even if the server ignores the filter, only surface
  // assets that haven't been given a Content Type yet.
  const assets = list
    .filter(a => !metaValue(a, FIELD.type, 'Content Type'))
    .map(a => ({
      id: a.id,
      name: a.name,
      previewUrl: previewUrlOf(a),
      width: a.width || a.Width || null,
      height: a.height || a.Height || null,
    }))
    .filter(a => a.previewUrl);
  return { assets, offset, hasMore: list.length >= limit };
}

async function doSuggest(key, body) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'ANTHROPIC_API_KEY not configured' };
  const previewUrl = body.previewUrl;
  if (!previewUrl) return { error: 'previewUrl required' };

  // Fetch the Shade preview server-side (avoids browser CORS to the CDN).
  let b64, mediaType;
  try {
    const img = await fetch(previewUrl);
    if (!img.ok) throw new Error(`preview HTTP ${img.status}`);
    const buf = Buffer.from(await img.arrayBuffer());
    const ct = img.headers.get('content-type') || 'image/jpeg';
    mediaType = ct.startsWith('image/') ? ct : 'image/jpeg';
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)) mediaType = 'image/jpeg';
    b64 = buf.toString('base64');
  } catch (e) {
    return { error: `Failed to load preview: ${e.message}` };
  }

  const teams = Array.isArray(body.teams) ? body.teams : [];
  const teamLines = teams.map(t => `- ${t.id} (${t.name}): primary ${t.color}, accent ${t.accent}`).join('\n');

  const system = `You are a Big League Wiffle Ball (BLW) photo categorizer. Return ONLY strict JSON, no prose.

TEAMS (internal id, name, colors) — match by jersey/cap colors, logos, uniforms:
${teamLines}

CONTENT TYPES — pick the single best fit:
- Headshot   (tight portrait of one player's face)
- Action     (general in-game action, fielding, running, generic play)
- Hitting    (a batter: stance, swing, contact, follow-through)
- Pitching   (a pitcher: windup, release, mound)
- Celebration(celebrating, dugout hype, post-play emotion)
- Candid     (off-field, bench, warmups, behind-the-scenes)
- Hype       (stylized hero/intro look, dramatic lighting)
- Team       (group/team photo, multiple players posed)

YOUR TASK — return:
- team: the BLW internal id (e.g. "LAN","ATL") or null if unsure
- contentType: one label from the list above or null
- num: the most prominent jersey NUMBER as a 2-digit string (e.g. "03") or null. OCR it from chest/back/cap even if small; 0-pad single digits.
- confidence: "high" | "medium" | "low"
- reasoning: one short sentence.

Return ONLY: {"team":"LAN"|null,"contentType":"Action"|null,"num":"03"|null,"confidence":"high"|"medium"|"low","reasoning":"..."}`;

  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 200,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text: 'Categorize this photo. Return the JSON.' },
        ],
      }],
    }),
  });
  const txt = await resp.text();
  let data; try { data = JSON.parse(txt); } catch { data = null; }
  if (!resp.ok) return { error: data?.error?.message || `Anthropic HTTP ${resp.status}` };
  const block = (data.content || []).find(c => c.type === 'text');
  let parsed = {};
  try {
    parsed = JSON.parse((block?.text || '{}').trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, ''));
  } catch { parsed = {}; }
  return {
    team: parsed.team || null,
    contentType: parsed.contentType || null,
    num: parsed.num ? String(parsed.num).padStart(2, '0') : null,
    confidence: parsed.confidence || 'low',
    reasoning: parsed.reasoning || '',
  };
}

async function doTag(key, body) {
  const { assetId, team, player, contentType } = body;
  if (!assetId) throw new Error('assetId required');
  const maps = await getOptionMaps(key);

  const writes = [];
  const unresolved = [];
  // Team → multi_select (array of option ids)
  if (team) {
    const shadeLabel = TEAM_TO_SHADE[team] || team;
    const optId = maps.team[String(shadeLabel).toLowerCase()];
    if (optId) writes.push({ metaId: FIELD.team, value: [optId] }); else unresolved.push(`team "${team}"→"${shadeLabel}"`);
  }
  // Player → single_select (option id)
  if (player) {
    const optId = maps.player[String(player).toLowerCase()];
    if (optId) writes.push({ metaId: FIELD.player, value: optId }); else unresolved.push(`player "${player}"`);
  }
  // Content Type → single_select (option id)
  if (contentType) {
    const optId = maps.type[String(contentType).toLowerCase()];
    if (optId) writes.push({ metaId: FIELD.type, value: optId }); else unresolved.push(`type "${contentType}"`);
  }
  // Fail LOUD — never report success when nothing was written.
  if (!writes.length) {
    throw new Error(`No metadata written. Unresolved: ${unresolved.join(', ') || '(none provided)'}. Option counts loaded: ${JSON.stringify(maps._counts)} (fields seen: ${maps._fieldCount}).`);
  }

  for (const w of writes) {
    const r = await fetch(`${SHADE_BASE}/assets/${assetId}/metadata/${w.metaId}/value`, {
      method: 'PUT',
      headers: shadeHeaders(key),
      body: JSON.stringify({ drive_id: DRIVE_ID, metadata_attribute_value: w.value }),
    });
    if (!r.ok) {
      throw new Error(`Shade write failed (HTTP ${r.status}) on field ${w.metaId}: ${(await r.text()).slice(0, 200)}`);
    }
  }
  _index = null; // bust the player-gallery index so a freshly tagged photo shows immediately
  return { ok: true, written: writes.length, unresolved };
}

// ─── Player gallery: index the collection's tagged assets by player ─────────
// One cached pass over the collection groups every tagged asset under its
// Player, so any player's photos resolve without depending on the exact
// "equals" filter-clause syntax. Tolerant of however Shade returns the value
// (option id, name, object, or array).
let _index = null;
let _indexAt = 0;
function playerNameFromValue(v, idToName) {
  let s = Array.isArray(v) ? v[0] : v;
  if (s && typeof s === 'object') s = s.name || s.id || s.value;
  if (s == null) return null;
  const low = String(s).toLowerCase();
  return idToName[low] || String(s); // resolve option id → name, else it's already the name
}
async function getTaggedIndex(key) {
  if (_index && Date.now() - _indexAt < 5 * 60 * 1000) return _index;
  const maps = await getOptionMaps(key);
  const idToName = {};
  for (const [name, id] of Object.entries(maps.player)) idToName[String(id).toLowerCase()] = name;
  const byPlayer = {}; // lowercased player name → [{id,name,previewUrl}]
  let offset = 0;
  for (let page = 0; page < 20; page++) { // safety cap (≈4000 assets)
    const r = await fetch(`${SHADE_BASE}/search`, {
      method: 'POST', headers: shadeHeaders(key),
      body: JSON.stringify({ drive_id: DRIVE_ID, collection_id: COLLECTION_ID, limit: 200, offset }),
    });
    if (!r.ok) throw new Error(`Shade search HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const raw = await r.json();
    const list = Array.isArray(raw) ? raw : (raw.assets || raw.results || []);
    for (const a of list) {
      const name = playerNameFromValue(metaValue(a, FIELD.player, 'Player'), idToName);
      if (!name) continue;
      const k = name.toLowerCase();
      (byPlayer[k] = byPlayer[k] || []).push({ id: a.id, name: a.name, previewUrl: previewUrlOf(a) });
    }
    if (list.length < 200) break;
    offset += list.length;
  }
  _index = { byPlayer, builtAt: Date.now() };
  _indexAt = Date.now();
  return _index;
}

// Return a signed URL to the asset's ORIGINAL full-resolution file. The
// browser fetches it directly (the R2 URLs send Access-Control-Allow-Origin: *),
// compresses it client-side, and saves it into BLW Media like a normal upload.
async function doDownload(key, body) {
  const { assetId } = body;
  if (!assetId) throw new Error('assetId required');
  const r = await fetch(`${SHADE_BASE}/assets/${assetId}/download?drive_id=${DRIVE_ID}&origin_type=SOURCE`, {
    headers: shadeHeaders(key),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Shade download HTTP ${r.status}: ${text.slice(0, 200)}`);
  // Response may be a bare URL string, a JSON-quoted string, or an object.
  let url = text.trim();
  try {
    const j = JSON.parse(text);
    url = typeof j === 'string' ? j : (j.url || j.signed_url || j.download_url || j.signedUrl || url);
  } catch { /* plain string */ }
  url = String(url).replace(/^"|"$/g, '');
  if (!/^https?:\/\//.test(url)) throw new Error(`Shade download returned no URL: ${text.slice(0, 120)}`);
  return { url };
}

async function doPlayer(key, body) {
  const name = body.player;
  if (!name) throw new Error('player required');
  const { byPlayer } = await getTaggedIndex(key);
  const assets = (byPlayer[String(name).toLowerCase()] || []).filter(a => a.previewUrl);
  return { player: name, count: assets.length, assets };
}

// Vision suggest-action can run long on full-size images; raise from the
// ~10s default so it doesn't 504. TOP-LEVEL export (not nested in `config`).
export const maxDuration = 60;

export default async function handler(req, res) {
  const ctx = await requireUser(req, res);
  if (!ctx) return;

  let body = req.method === 'POST' ? req.body : req.query;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const action = body?.action || req.query?.action;

  // Reads (viewing a player's tagged photos) are open to staff; the
  // queue/suggest/tag mutations + diagnostics stay master-only.
  const READ_ACTIONS = new Set(['player', 'config', 'collections', 'folders']);
  const allowed = READ_ACTIONS.has(action) ? ['master_admin', 'admin', 'content'] : ['master_admin'];
  if (requireRole(res, ctx.profile, allowed)) return;

  const key = shadeKey();
  if (action === 'config') {
    res.status(200).json({
      connected: !!key,
      collection: '📸 BLW WEEK 1 ALL PHOTOS',
      defaultCollectionId: COLLECTION_ID,
      driveId: DRIVE_ID,
    });
    return;
  }

  if (!key) {
    res.status(503).json({ error: 'Shade not configured', detail: 'SHADE_API_KEY is missing from the server environment.' });
    return;
  }

  try {
    if (action === 'diag') {
      const maps = await getOptionMaps(key);
      res.status(200).json({
        ok: true, fieldsSeen: maps._fieldCount, counts: maps._counts,
        teams: Object.keys(maps.team), types: Object.keys(maps.type), playerCount: Object.keys(maps.player).length,
      });
      return;
    }
    if (action === 'collections') { res.status(200).json(await doCollections(key)); return; }
    if (action === 'folders') { res.status(200).json(await doFolders(key, body || {})); return; }
    if (action === 'queue')   { res.status(200).json(await doQueue(key, body || {})); return; }
    if (action === 'player')  { res.status(200).json(await doPlayer(key, body || {})); return; }
    if (action === 'download'){ res.status(200).json(await doDownload(key, body || {})); return; }
    if (action === 'suggest') { res.status(200).json(await doSuggest(key, body || {})); return; }
    if (action === 'tag')     { res.status(200).json(await doTag(key, body || {})); return; }
    res.status(400).json({ error: `unknown action: ${action}` });
  } catch (err) {
    res.status(502).json({ error: 'Shade bridge error', detail: err.message });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };
