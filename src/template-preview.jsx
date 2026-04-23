// Layout-style thumbnail for each template type. Instead of trying to render
// a full composition (which would require sample media + fake stats + etc),
// each thumbnail shows the template's FIELD LAYOUT as labeled dashed boxes
// against a dark canvas background. Designers and users can instantly see
// where the player name, stat line, dates, etc. live in that template.
//
// Tiny and deterministic — the preview rebuilds whenever the template or
// platform changes. No network calls, no media dependencies.

import { useRef, useEffect } from 'react';
import { TEMPLATE_TYPES, getFieldConfig } from './template-config';
import { PLATFORMS, getTeam } from './data';
import { colors } from './theme';

export function TemplatePreview({ templateKey, platform = 'feed', team, width = 96, height = 96 }) {
  const ref = useRef(null);
  const tObj = TEMPLATE_TYPES[templateKey];
  const plat = PLATFORMS[platform] || PLATFORMS.feed;
  const teamObj = team ? getTeam(team) : null;
  // Scale fit inside the requested box while preserving aspect ratio.
  const aspect = plat.h / plat.w;
  const drawW = width;
  const drawH = Math.min(height, Math.round(width * aspect));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !tObj) return;
    canvas.width = drawW * 2;   // 2x for crisp thumbs on retina
    canvas.height = drawH * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    // Background gradient — team colors if available, else neutral.
    const grad = ctx.createLinearGradient(0, 0, drawW, drawH);
    if (teamObj) {
      grad.addColorStop(0, teamObj.color || '#1A1A22');
      grad.addColorStop(1, teamObj.dark || '#0B0D10');
    } else {
      grad.addColorStop(0, '#1F2937');
      grad.addColorStop(1, '#111827');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, drawW, drawH);

    // Fine-grain diagonal stripes to hint "overlay goes here"
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    for (let i = -drawH; i < drawW + drawH; i += 6) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i + drawH, drawH);
      ctx.stroke();
    }
    ctx.restore();

    // Per-field dashed rectangles — positioned at scaled-down coordinates.
    const fields = getFieldConfig(templateKey, platform) || [];
    const sx = drawW / plat.w;
    const sy = drawH / plat.h;
    ctx.setLineDash([2, 2]);
    ctx.lineWidth = 1;
    for (const f of fields) {
      const fx = (f.x || 0) * sx;
      const fy = (f.y || 0) * sy;
      const fw = Math.max(18, ((f.maxWidth || 300) * sx * 0.65));
      const fh = Math.max(6, ((f.fontSize || 24) * sy * 0.9));
      // Anchor correction to match textAlign
      const rx = f.align === 'center' ? fx - fw / 2 : f.align === 'right' ? fx - fw : fx;
      const ry = fy - fh / 2;
      // Box
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.strokeRect(rx, ry, fw, fh);
      // Fill tint
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(rx, ry, fw, fh);
    }
    ctx.setLineDash([]);
  }, [templateKey, platform, teamObj?.id, drawW, drawH, tObj]);

  if (!tObj) return null;

  return (
    <canvas
      ref={ref}
      style={{
        width: drawW, height: drawH,
        borderRadius: 4,
        display: 'block',
      }}
      aria-label={`${tObj.name} template layout`}
    />
  );
}
