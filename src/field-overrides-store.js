// Per-browser field layout overrides for the Generate page. Designers can
// nudge where each dynamic text field lands (x/y), its font size, and its
// font family without touching the baked-in template-config.js defaults.
//
// Overrides are keyed by `{templateType}:{platform}` so the same template
// can have different layouts for feed vs portrait vs story. Reverting to
// defaults is a single call per combo.
//
// Storage: localStorage. Multi-user lift to Supabase is planned — when that
// lands, the same shape moves server-side and gets scoped by user or team.

import { cloud } from './cloud-sync';

const LS_KEY = 'blw_field_overrides_v1';

// ─── Base I/O ────────────────────────────────────────────────────────────────

function readAll() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeAll(all) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(all || {})); }
  catch {}
}

function comboKey(templateType, platform) {
  return `${templateType || 'unknown'}:${platform || 'feed'}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

// Returns a `{ fieldKey: overrideObj }` map for the requested combo, or {}.
// overrideObj may contain any subset of { x, y, fontSize, font, color }.
export function getOverrides(templateType, platform) {
  const all = readAll();
  return all[comboKey(templateType, platform)] || {};
}

// Patch a single field's override. Pass `partial` like { x: 540, fontSize: 64 }.
// Only the keys you pass are touched — other overrides stay as they were.
// Pass `null` or {} to clear overrides for this field.
export function setFieldOverride(templateType, platform, fieldKey, partial) {
  const all = readAll();
  const key = comboKey(templateType, platform);
  const combo = { ...(all[key] || {}) };
  if (partial === null || (partial && Object.keys(partial).length === 0 && !partial.clear)) {
    delete combo[fieldKey];
    cloud.deleteFieldOverride(templateType, platform, fieldKey);
  } else {
    combo[fieldKey] = { ...(combo[fieldKey] || {}), ...partial };
    cloud.syncFieldOverride(templateType, platform, fieldKey, combo[fieldKey]);
  }
  if (Object.keys(combo).length === 0) {
    delete all[key];
  } else {
    all[key] = combo;
  }
  writeAll(all);
}

// Reset all overrides for a template/platform combo back to defaults.
export function resetOverrides(templateType, platform) {
  const all = readAll();
  const combo = all[comboKey(templateType, platform)] || {};
  // Delete each field override from the cloud before wiping locally so the
  // cloud matches the reset-to-defaults state.
  for (const fieldKey of Object.keys(combo)) {
    cloud.deleteFieldOverride(templateType, platform, fieldKey);
  }
  delete all[comboKey(templateType, platform)];
  writeAll(all);
}

// Reset every override stored in this browser. Useful for dev / "wipe" UX.
export function resetAllOverrides() {
  writeAll({});
}

// ─── Merge helper ────────────────────────────────────────────────────────────
// Wraps template-config.js field arrays: takes the default array, looks up
// overrides for the combo, and returns a new array with per-field merges
// applied. Unknown override keys are ignored. Callers don't need to care
// whether overrides exist — if none, the default array is returned unchanged.
export function applyOverrides(defaultFields, templateType, platform) {
  const overrides = getOverrides(templateType, platform);
  if (!overrides || Object.keys(overrides).length === 0) return defaultFields;
  return defaultFields.map(f => {
    const o = overrides[f.key];
    if (!o) return f;
    return {
      ...f,
      x: o.x != null ? o.x : f.x,
      y: o.y != null ? o.y : f.y,
      fontSize: o.fontSize != null ? o.fontSize : f.fontSize,
      font: o.font != null ? o.font : f.font,
      color: o.color != null ? o.color : f.color,
    };
  });
}
