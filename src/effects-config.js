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
    id: 'gradient-top',
    label: 'Top Fade',
    icon: '▽',
    description: 'Dark gradient from top',
    render(ctx, w, h, opacity) {
      ctx.save();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `rgba(0,0,0,${opacity})`);
      grad.addColorStop(0.5, `rgba(0,0,0,${opacity * 0.3})`);
      grad.addColorStop(1, `rgba(0,0,0,0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    },
  },
  {
    id: 'gradient-bottom',
    label: 'Bottom Fade',
    icon: '△',
    description: 'Dark gradient from bottom',
    render(ctx, w, h, opacity) {
      ctx.save();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `rgba(0,0,0,0)`);
      grad.addColorStop(0.5, `rgba(0,0,0,${opacity * 0.3})`);
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
    id: 'light-leak',
    label: 'Light Leak',
    icon: '✦',
    description: 'Warm orange glow corner',
    render(ctx, w, h, opacity) {
      ctx.save();
      const grad = ctx.createRadialGradient(w * 0.85, h * 0.15, 0, w * 0.85, h * 0.15, Math.max(w, h) * 0.6);
      grad.addColorStop(0, `rgba(255, 165, 80, ${opacity * 0.9})`);
      grad.addColorStop(0.4, `rgba(221, 60, 60, ${opacity * 0.3})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.globalCompositeOperation = 'screen';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
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
    description: 'Bottom-up gradient in the team\'s primary color',
    usesTeamColor: true,
    render(ctx, w, h, opacity, teamColor) {
      ctx.save();
      const rgb = hexToRgb(teamColor || '#151C28');
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
      grad.addColorStop(0.55, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity * 0.55})`);
      grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity * 0.95})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    },
  },
];

// Helper to find an effect by ID
export function getBuiltInEffect(id) {
  return BUILT_IN_EFFECTS.find(e => e.id === id);
}
