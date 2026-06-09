// api/shade.js — BLW Studio ↔ Shade DAM bridge for the Rapid Tag widget.
//
// Lets the master admin rapid-categorize onsite photos that live in Shade,
// writing Team / Player / Content Type straight back onto the Shade asset's
// custom metadata (Shade stays the source of truth — we don't import the raws).
//
// Actions (GET ?action= / POST {action}):
//   config   → { connected, collection, fields }           — is SHADE_API_KEY set?
//   queue    → { assets:[{id,name,previewUrl,width,height}], hasMore, offset }
//   suggest  → { team, contentType, num, confidence, reasoning }  (Claude vision)
//   tag      → writes Team/Player/Content Type to a Shade asset
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
const COLLECTION_ID = 'b293692d-98bd-45ec-be29-6a72a74b2c0c';   // 📸 BLW WEEK 1 ALL PHOTOS (auto-updating)

// Shade custom-metadata field ids (created via the Rapid Tag setup).
const FIELD = {
  team:   'c8c417f9-ad1d-42ba-b1c4-cd9831616dec',  // Teams        (multi_select)
  player: 'dcaf0f6a-9d80-4ede-8137-cd9cf8332598',  // Player       (single_select)
  type:   '6b37f9ed-ecd3-466f-b6f8-a9b6c90d070b',  // Content Type (single_select)
};

// Our internal team id → the option label that exists in Shade's Teams field.
const TEAM_TO_SHADE = {
  LAN: 'LA', AZS: 'AZ', LV: 'LV', NYG: 'NYK', DAL: 'DAL',
  BOS: 'BOS', PHI: 'PHI', CHI: 'CHI', MIA: 'MIA', SDO: 'ATL',
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

async function doQueue(key, body) {
  const limit = Math.min(Number(body.limit) || 24, 60);
  const offset = Number(body.offset) || 0;
  const search = {
    drive_id: DRIVE_ID,
    collection_id: COLLECTION_ID,
    limit,
    offset,
    // Server-side filter: only assets that haven't been categorized yet.
    // Content Type is the universal "processed" marker — every photo gets one
    // (a player type, "Team", or "N/A" for non-athletes), so it's a cleaner
    // queue gate than Player (which is empty for team/crowd/venue shots).
    filters: [{ id: FIELD.type, options: [], clause: 'is empty' }],
  };
  const r = await fetch(`${SHADE_BASE}/search`, {
    method: 'POST', headers: shadeHeaders(key), body: JSON.stringify(search),
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
- team: the BLW internal id (e.g. "LAN","SDO") or null if unsure
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

async function doPlayer(key, body) {
  const name = body.player;
  if (!name) throw new Error('player required');
  const { byPlayer } = await getTaggedIndex(key);
  const assets = (byPlayer[String(name).toLowerCase()] || []).filter(a => a.previewUrl);
  return { player: name, count: assets.length, assets };
}

export default async function handler(req, res) {
  const ctx = await requireUser(req, res);
  if (!ctx) return;

  let body = req.method === 'POST' ? req.body : req.query;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const action = body?.action || req.query?.action;

  // Reads (viewing a player's tagged photos) are open to staff; the
  // queue/suggest/tag mutations + diagnostics stay master-only.
  const READ_ACTIONS = new Set(['player', 'config']);
  const allowed = READ_ACTIONS.has(action) ? ['master_admin', 'admin', 'content'] : ['master_admin'];
  if (requireRole(res, ctx.profile, allowed)) return;

  const key = shadeKey();
  if (action === 'config') {
    res.status(200).json({
      connected: !!key,
      collection: 'BLW WEEK 1 ALL PHOTOS',
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
    if (action === 'queue')   { res.status(200).json(await doQueue(key, body || {})); return; }
    if (action === 'player')  { res.status(200).json(await doPlayer(key, body || {})); return; }
    if (action === 'suggest') { res.status(200).json(await doSuggest(key, body || {})); return; }
    if (action === 'tag')     { res.status(200).json(await doTag(key, body || {})); return; }
    res.status(400).json({ error: `unknown action: ${action}` });
  } catch (err) {
    res.status(502).json({ error: 'Shade bridge error', detail: err.message });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };
