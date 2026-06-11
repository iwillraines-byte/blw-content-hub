// ─── Quick-stats ticker (v4.16.0) ────────────────────────────────────────────
// A slim, auto-scrolling strip of live league numbers across the top of the
// dashboard: standings leader, latest final, batting + pitching leaders,
// rank movers, next game day. Built entirely from data the dashboard already
// loads (plus the cached games feed via the idea-context builders), so it
// costs no extra round trips beyond what the page makes anyway.
//
// Implementation: classic duplicated-content marquee. The track renders the
// item list twice and animates translateX(-50%); since the two halves are
// identical the loop point is invisible. Pauses on hover so numbers can be
// read. translateX is GPU-composited — no layout-property animation.

import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getTeam } from './data';
import { colors, fonts } from './theme';
import { buildRecentResults, buildUpcomingSlate } from './idea-context-builders';

const tickerKeyframes = `
@keyframes blw-ticker-scroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
.blw-ticker-track { animation: blw-ticker-scroll var(--ticker-duration, 45s) linear infinite; will-change: transform; }
.blw-ticker:hover .blw-ticker-track { animation-play-state: paused; }
`;

function Item({ tag, tagColor, children, to }) {
  const body = (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      whiteSpace: 'nowrap',
    }}>
      <span style={{
        fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
        letterSpacing: 0.8, color: tagColor || colors.red,
        textTransform: 'uppercase',
      }}>{tag}</span>
      <span className="tnum" style={{
        fontFamily: fonts.condensed, fontSize: 12.5, fontWeight: 700,
        color: colors.text, letterSpacing: 0.3,
      }}>{children}</span>
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {to ? <Link to={to} style={{ textDecoration: 'none' }}>{body}</Link> : body}
      <span aria-hidden="true" style={{ margin: '0 18px', color: colors.borderLight, fontSize: 10 }}>◆</span>
    </span>
  );
}

export function QuickStatsTicker({ batting = [], pitching = [], standings = null, rankings = [] }) {
  const [recentResults, setRecentResults] = useState(null);
  const [slate] = useState(() => buildUpcomingSlate());
  useEffect(() => {
    let cancel = false;
    buildRecentResults().then(r => { if (!cancel) setRecentResults(r); });
    return () => { cancel = true; };
  }, []);

  const items = useMemo(() => {
    const out = [];
    const ordered = standings?.ordered || [];
    // Standings: top three records, in rank order.
    for (const row of ordered.slice(0, 3)) {
      const t = getTeam(row.teamId);
      if (t && row.gp > 0) out.push({ tag: `#${row.rank} ${t.id}`, tagColor: t.color, text: `${row.record} · ${row.pct}`, to: '/game-center' });
    }
    // Latest final score.
    const latest = recentResults?.[0];
    if (latest) {
      out.push({ tag: 'FINAL', text: `${latest.home} ${latest.homeScore}–${latest.awayScore} ${latest.away}`, to: '/schedule' });
    }
    // Batting + pitching leaders.
    const topBat = batting[0];
    if (topBat) out.push({ tag: 'OPS+ LEADER', text: `${topBat.name} · ${topBat.ops_plus}`, to: '/game-center' });
    const topArm = pitching[0];
    if (topArm) {
      const fip = typeof topArm.fip === 'number' ? topArm.fip.toFixed(2) : topArm.fip;
      out.push({ tag: 'FIP LEADER', text: `${topArm.name} · ${fip}`, to: '/game-center' });
    }
    // Biggest rank climber this week.
    const mover = [...(rankings || [])].filter(r => (r.rankChange || 0) >= 3)
      .sort((a, b) => (b.rankChange || 0) - (a.rankChange || 0))[0];
    if (mover) out.push({ tag: 'RISING', tagColor: '#047857', text: `${mover.name} ▲${mover.rankChange} → #${mover.currentRank}` });
    // HR leader, for some power flavor.
    const hrLeader = [...batting].sort((a, b) => (b.hr || 0) - (a.hr || 0))[0];
    if (hrLeader?.hr > 0) out.push({ tag: 'HR LEADER', text: `${hrLeader.name} · ${hrLeader.hr} HR`, to: '/game-center' });
    // Next game day.
    if (slate) {
      const when = slate.daysUntil === 0 ? 'TODAY' : slate.daysUntil === 1 ? 'TOMORROW' : `IN ${slate.daysUntil} DAYS`;
      out.push({ tag: 'NEXT GAMES', text: `${when} · ${slate.games.length} matchups`, to: '/schedule' });
    }
    return out;
  }, [batting, pitching, standings, rankings, recentResults, slate]);

  if (items.length < 3) return null; // not enough signal to be worth the chrome

  // ~4.5s of travel per item keeps the pace readable regardless of count.
  const duration = `${Math.max(30, items.length * 4.5)}s`;

  const half = (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {items.map((it, i) => (
        <Item key={i} tag={it.tag} tagColor={it.tagColor} to={it.to}>{it.text}</Item>
      ))}
    </span>
  );

  return (
    <div
      className="blw-ticker"
      style={{
        overflow: 'hidden',
        background: colors.white,
        border: `1px solid ${colors.borderLight}`,
        borderRadius: 10,
        padding: '8px 0',
        position: 'relative',
        // Soft fade at both edges so items slide in/out instead of clipping.
        maskImage: 'linear-gradient(to right, transparent, black 4%, black 96%, transparent)',
        WebkitMaskImage: 'linear-gradient(to right, transparent, black 4%, black 96%, transparent)',
      }}
    >
      <style>{tickerKeyframes}</style>
      <div
        className="blw-ticker-track"
        style={{ display: 'inline-flex', alignItems: 'center', '--ticker-duration': duration }}
      >
        {half}
        {half}
      </div>
    </div>
  );
}
