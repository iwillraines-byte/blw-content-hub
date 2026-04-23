// Preset overlay registry — auto-built from src/assets/overlays/**/*.png via
// Vite's import.meta.glob. Designers drop PNGs in the right folder, commit,
// deploy — no manifest edits, no code changes. See assets/overlays/README.md
// for the folder/naming convention.
//
// Shape of each preset:
//   { id, teamId, templateType, name, filename, url }
//
// `id` is stable across builds (derived from the path), so selection state
// in the picker survives hot reload / redeploys.

// Glob all PNGs under the overlays tree. Vite resolves these at build time
// to hashed static asset URLs — zero runtime cost.
const modules = import.meta.glob('./assets/overlays/**/*.png', {
  eager: true,
  import: 'default',
});

// ─── Parse paths into typed records ─────────────────────────────────────────
// Example input: './assets/overlays/lan/player-stat/hero-portrait.png'
function parsePresetPath(path, url) {
  // Drop the common prefix, then split into [teamId, templateType, filename].
  const rel = path.replace(/^\.\/assets\/overlays\//, '');
  const parts = rel.split('/');
  if (parts.length !== 3) return null;
  const [teamIdRaw, templateType, fileRaw] = parts;
  const teamId = teamIdRaw.toLowerCase();
  const filename = fileRaw.replace(/\.png$/i, '');
  // Prettified label for the picker — replace dashes with spaces, title-case.
  const name = filename
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  return {
    id: `preset:${teamId}:${templateType}:${filename}`,
    teamId,
    templateType,
    name,
    filename: fileRaw,
    url,
  };
}

const PRESETS = Object.entries(modules)
  .map(([path, url]) => parsePresetPath(path, url))
  .filter(Boolean);

// ─── Query API ──────────────────────────────────────────────────────────────
// `teamId` is BLW id ("LAN"), which we lowercase to match folder convention.
// League-wide presets live under `all/` — they surface for every team.
export function getPresetOverlays(teamId, templateType) {
  const team = (teamId || '').toLowerCase();
  const type = templateType || '';
  return PRESETS.filter(p =>
    (p.teamId === team || p.teamId === 'all') &&
    p.templateType === type
  ).sort((a, b) => {
    // Team-specific presets first, then league-wide
    if (a.teamId === 'all' && b.teamId !== 'all') return 1;
    if (b.teamId === 'all' && a.teamId !== 'all') return -1;
    return a.name.localeCompare(b.name);
  });
}

// Load a preset's image as an HTMLImageElement, ready for canvas compositing.
// Cached so repeated selections don't re-fetch the same asset.
const _presetImageCache = new Map();
export function loadPresetImage(preset) {
  if (!preset?.url) return Promise.resolve(null);
  if (_presetImageCache.has(preset.url)) return _presetImageCache.get(preset.url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = preset.url;
  });
  _presetImageCache.set(preset.url, p);
  return p;
}

// Useful for diagnostics / the Files page
export function getAllPresets() {
  return PRESETS.slice();
}
