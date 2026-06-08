// ─── Built-in Canvas Effects ────────────────────────────────────────────────
// Each effect has an id, label, and render(ctx, w, h, opacity, teamColor?) function.
// Effects render on top of background + overlay, below text.

// Cached noise pattern — generated once then reused (expensive to build per frame)
let _noiseCache = null;
function getNoisePattern(ctx, w, h) {
  if (_noiseCache && _noiseCache.width === w && _noiseCache.height === h) {
    return _noiseCache;
  }
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');
  const imgData = octx.createImageData(w, h);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  octx.putImageData(imgData, 0, 0);
  _noiseCache = off;
  return off;
}

function hexToRgb(hex) {
  const m = hex.replace('#', '').match(/.{1,2}/g) || ['0', '0', '0'];
  return { r: parseInt(m[0], 16), g: parseInt(m[1], 16), b: parseInt(m[2], 16) };
}

// Unsharp mask — the engine behind both Clarity and Texture. Snapshots the
// pixels already drawn (the background photo, since effects render before the
// overlay), builds a Gaussian-blurred copy, and adds the high-frequency
// difference back: out = src + (src - blur) * amount. A LARGE blur radius
// boosts mid-tone local contrast (Clarity / punch); a SMALL radius sharpens
// fine detail (Texture / crispness). Operates in DEVICE pixels (ctx.canvas.*)
// so it covers the whole frame even on the 2x-scaled export canvas, where the
// 2D transform would otherwise make a logical-width getImageData grab only a
// corner. No-ops on a tainted canvas (cross-origin photo) rather than throwing.
function applyUnsharp(ctx, radius, amount) {
  if (amount <= 0) return;
  const w = ctx.canvas.width, h = ctx.canvas.height;
  if (!w || !h) return;
  let src;
  try { src = ctx.getImageData(0, 0, w, h); }
  catch { return; } // tainted canvas — skip silently
  // Blurred copy via the GPU-accelerated canvas blur filter.
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = w; blurCanvas.height = h;
  const bctx = blurCanvas.getContext('2d');
  if (!bctx) return;
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = w; srcCanvas.height = h;
  srcCanvas.getContext('2d').putImageData(src, 0, 0);
  bctx.filter = `blur(${radius}px)`;
  bctx.drawImage(srcCanvas, 0, 0);
  const blur = bctx.getImageData(0, 0, w, h).data;
  const s = src.data;
  const out = ctx.createImageData(w, h);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const detail = s[i + c] - blur[i + c];
      const v = s[i + c] + detail * amount;
      d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    d[i + 3] = s[i + 3]; // preserve alpha
  }
  ctx.putImageData(out, 0, 0);
}

export const BUILT_IN_EFFECTS = [
  {
    id: 'vignette',
    label: 'Vignette',
    icon: '◉',
    description: 'Darkens edges, focuses center',
    render(ctx, w, h, opacity) {
      ctx.save();
      const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
      grad.addColorStop(0, `rgba(0,0,0,0)`);
      grad.addColorStop(1, `rgba(0,0,0,${opacity})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    },
  },
  {
    id: 'grain',
    label: 'Film Grain',
    icon: '▨',
    description: 'Subtle noise texture',
    render(ctx, w, h, opacity) {
      ctx.save();
      ctx.globalAlpha = opacity * 0.25; // grain maxes at ~25% even at full slider
      ctx.globalCompositeOperation = 'overlay';
      const noise = getNoisePattern(ctx, w, h);
      ctx.drawImage(noise, 0, 0, w, h);
      ctx.restore();
    },
  },
  {
    // Lightroom-style "Texture": sharpens fine, high-frequency detail (skin,
    // fabric weave, stitching, grass) with a tight 1px unsharp radius. Adds
    // crispness without the haloing a heavy sharpen causes. Doubles as a fix
    // for soft/blurry exports.
    id: 'texture',
    label: 'Texture',
    icon: '▦',
    description: 'Crisp fine detail',
    render(ctx, w, h, opacity) {
      applyUnsharp(ctx, 1, opacity * 0.9);
    },
  },
  {
    // Lightroom-style "Clarity": boosts mid-tone LOCAL contrast with a wide
    // unsharp radius (scaled to the frame), giving photos punch and depth.
    // Subtle at low slider, dramatic near 100%.
    id: 'clarity',
    label: 'Clarity',
    icon: '◐',
    description: 'Punchy local contrast',
    render(ctx, w, h, opacity) {
      const radius = Math.max(2, Math.round(Math.min(ctx.canvas.width, ctx.canvas.height) / 110));
      applyUnsharp(ctx, radius, opacity * 0.7);
    },
  },
  {
    // v4.5.20: Replaced 'team-duotone' (multiply blend, looked muddy on
    // most photos) with a clean bottom-fade in the team's primary
    // color. Same idea as 'gradient-bottom' but tinted to brand —
    // designers reach for this every time the next text block needs to
    // sit on the lower third of a photo. Slider drives final alpha
    // 0–1; we hard-cap the floor opacity so even at 100% the photo
    // remains readable behind the fade.
    id: 'team-gradient',
    label: 'Team Fade',
    icon: '▼',
    description: 'Bottom-half fade in the team\'s primary color',
    usesTeamColor: true,
    // v4.5.37: Constrained to the bottom HALF of the canvas (was full
    // height in v4.5.20–4.5.36). The fade now starts dead-clear at the
    // vertical midpoint and ramps to the team color at the bottom edge —
    // the top half of the photo is untouched. Designers were finding the
    // full-height fade muddied athlete portraits; restricting it
    // preserves the face/upper-body composition while still giving text
    // a colored runway to sit on along the lower third.
    render(ctx, w, h, opacity, teamColor) {
      ctx.save();
      const rgb = hexToRgb(teamColor || '#151C28');
      const top = h * 0.5; // start at midpoint
      const grad = ctx.createLinearGradient(0, top, 0, h);
      grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
      grad.addColorStop(0.55, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity * 0.55})`);
      grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity * 0.95})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, top, w, h - top);
      ctx.restore();
    },
  },
];

// Helper to find an effect by ID
export function getBuiltInEffect(id) {
  return BUILT_IN_EFFECTS.find(e => e.id === id);
}
