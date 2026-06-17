// Settings → "Most-used media" (v4.20.0). Master-admin only.
//
// Ranks library photos by how often they've been downloaded ("saved to a
// device") and used in Studio (chosen as the background of an exported post).
// Reads the aggregated leaderboard from /api/media-usage?action=top. Counters
// started accumulating at the v4.20.0 deploy — no historical backfill.

import { useState, useEffect, useCallback } from 'react';
import { Card, SectionHeading, TeamChip } from '../components';
import { colors, fonts, radius } from '../theme';
import { fetchTopMedia } from '../media-usage';
import { timeAgo } from '../format-time';

export default function MediaUsageCard() {
  const [rows, setRows] = useState(null); // null = loading
  const [err, setErr] = useState(null);
  const [sortKey, setSortKey] = useState('total'); // total | download | studio

  const load = useCallback(() => {
    setErr(null);
    fetchTopMedia(50)
      .then(r => setRows(r || []))
      .catch(e => { setErr(e.message); setRows([]); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const sorted = (rows || []).slice().sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));

  const headStyle = { fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: colors.textMuted, textTransform: 'uppercase' };
  const numStyle = { fontFamily: fonts.condensed, fontSize: 13, fontWeight: 800, textAlign: 'right' };
  const sortBtn = (key, label) => (
    <button onClick={() => setSortKey(key)} style={{
      ...headStyle, cursor: 'pointer', background: 'transparent', border: 'none',
      color: sortKey === key ? colors.red : colors.textMuted, padding: 0,
    }}>{label}{sortKey === key ? ' ▾' : ''}</button>
  );

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
        <SectionHeading style={{ margin: 0 }}>Most-used media</SectionHeading>
        <span style={{ fontFamily: fonts.condensed, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: colors.textMuted }}>MASTER ADMIN</span>
      </div>
      <p style={{ fontSize: 12, color: colors.textSecondary, margin: '4px 0 14px', lineHeight: 1.5, maxWidth: '64ch' }}>
        Which photos get downloaded and used in Studio the most. <strong>Downloads</strong> = saved to a device from the Files library. <strong>Studio</strong> = used as the background of an exported post. Counts started tracking when this shipped.
      </p>

      {err && <div style={{ fontSize: 12, color: '#991B1B', marginBottom: 10 }}>⚠ {err}</div>}

      {rows === null ? (
        <div style={{ fontSize: 13, color: colors.textMuted, padding: '12px 0' }}>Loading usage…</div>
      ) : sorted.length === 0 ? (
        <div style={{ fontSize: 13, color: colors.textMuted, padding: '12px 0' }}>
          No usage tracked yet. As your team downloads photos and builds posts in Studio, the most-used files will rank here.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 64px 64px 64px 96px', gap: 8, alignItems: 'center', padding: '0 4px 8px', borderBottom: `1px solid ${colors.divider}` }}>
            <span style={headStyle}>#</span>
            <span style={headStyle}>File</span>
            <span style={{ ...headStyle, textAlign: 'right' }}>{sortBtn('download', 'Saves')}</span>
            <span style={{ ...headStyle, textAlign: 'right' }}>{sortBtn('studio', 'Studio')}</span>
            <span style={{ ...headStyle, textAlign: 'right' }}>{sortBtn('total', 'Total')}</span>
            <span style={{ ...headStyle, textAlign: 'right' }}>Last used</span>
          </div>
          {sorted.map((r, i) => (
            <div key={r.mediaId} style={{
              display: 'grid', gridTemplateColumns: '24px 1fr 64px 64px 64px 96px', gap: 8,
              alignItems: 'center', padding: '8px 4px',
              borderBottom: i < sorted.length - 1 ? `1px solid ${colors.divider}` : 'none',
            }}>
              <span style={{ fontFamily: fonts.condensed, fontSize: 12, fontWeight: 800, color: colors.textMuted }}>{i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {r.team && r.team !== 'BLW' && <TeamChip teamId={r.team} small />}
                  <span title={r.name} style={{ fontSize: 12.5, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                </div>
                {r.ownerName && (
                  <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.condensed, marginTop: 1 }}>↑ {r.ownerName}</div>
                )}
              </div>
              <span style={{ ...numStyle, color: colors.text }}>{r.download || 0}</span>
              <span style={{ ...numStyle, color: colors.text }}>{r.studio || 0}</span>
              <span style={{ ...numStyle, color: colors.red }}>{r.total || 0}</span>
              <span style={{ fontSize: 11, color: colors.textMuted, textAlign: 'right', fontFamily: fonts.condensed }}
                title={r.lastUserName ? `Last by ${r.lastUserName}` : ''}>
                {timeAgo(r.lastAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button onClick={load} style={{
          background: colors.bg, color: colors.textSecondary, border: `1px solid ${colors.border}`,
          borderRadius: radius.sm, padding: '6px 12px', cursor: 'pointer',
          fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
        }}>↻ Refresh</button>
      </div>
    </Card>
  );
}
