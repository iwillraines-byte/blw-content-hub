// Content calendar — renders a 4-week preview of the recommended posting
// cadence for a team. The baseline cadence is M/W/F. On weeks that contain
// a scheduled game, the cadence bumps to Mon / Fri / Sat / three posts on
// game day. The week after a game goes light (1 post, Wednesday).
//
// Each day that has a scheduled post is rendered as a colored dot. Clicking
// the dot deep-links to /generate pre-filled with a suggested template for
// that post type.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { SectionHeading } from './components';
import { colors, fonts, radius } from './theme';

// Heuristic for picking a readable text color on top of an arbitrary
// hex background. Used by the GAME badge and team-colored day chips
// so a dark team color (Boston navy, Vegas black) gets white text and
// a light team color (LA blue, AZ green) gets dark text.
function bestTextOn(hex) {
  if (!hex) return '#fff';
  const m = /^#?([a-f\d]{6})$/i.exec(String(hex).trim());
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  // Standard luminance — higher = lighter background.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#111827' : '#FFFFFF';
}

// ─── Date helpers (all local time) ──────────────────────────────────────────

function startOfWeek(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  // Align to Monday (getDay(): 0=Sun, 1=Mon...)
  const dow = out.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  out.setDate(out.getDate() + diff);
  return out;
}

function addDays(d, n) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function fmtShortDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDow(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
}

// ─── Post plan builder ──────────────────────────────────────────────────────
// Given a team + game list + a start date, returns 28 day slots each with:
// { date, posts: [{ type, label, templateId }] }
//
// `posts` is the recommended list for that day. `type` is one of:
//   'idea'     — general content idea (no specific template)
//   'preview'  — pre-game hype (gameday template)
//   'score'    — post-game recap (score template)
//   'highlight'— game day 2nd/3rd post (highlight template)
//   'leader'   — stats leader post (batting-leaders / pitching-leaders)
//   'standings'— standings post
function buildPostPlan(team, games, startDate = new Date(), weeks = 4) {
  const start = startOfWeek(startDate);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));

  // Team-specific games keyed by yyyy-mm-dd for fast lookup.
  const teamGames = games.filter(g => g.home?.teamId === team.id || g.away?.teamId === team.id);
  const gamesByDay = new Map();
  for (const g of teamGames) {
    const d = new Date(g.dateTime);
    const key = d.toISOString().slice(0, 10);
    if (!gamesByDay.has(key)) gamesByDay.set(key, []);
    gamesByDay.get(key).push(g);
  }

  // For each week, decide cadence: light (1 post), normal (M/W/F), or game-week.
  const weekPlans = [];
  for (let w = 0; w < weeks; w++) {
    const weekDays = days.slice(w * 7, w * 7 + 7);
    const weekHasGame = weekDays.some(d => gamesByDay.has(d.toISOString().slice(0, 10)));
    const prevWeekHadGame = w > 0 && weekPlans[w - 1]?.hadGame;

    weekPlans.push({
      hadGame: weekHasGame,
      light: prevWeekHadGame && !weekHasGame,
    });
  }

  return days.map((date, i) => {
    const key = date.toISOString().slice(0, 10);
    const dayGames = gamesByDay.get(key) || [];
    const weekIdx = Math.floor(i / 7);
    const plan = weekPlans[weekIdx];
    const dow = date.getDay(); // 0=Sun ... 6=Sat
    const posts = [];

    // Game day — 3 posts: preview-morning, live, post-game recap.
    if (dayGames.length > 0) {
      posts.push({ type: 'preview',   label: 'Matchup hype',    templateId: 'gameday' });
      posts.push({ type: 'highlight', label: 'Live highlight',  templateId: 'highlight' });
      posts.push({ type: 'score',     label: 'Final score',     templateId: 'score' });
    } else if (plan.light) {
      // Light post-game week — single Wednesday recap-style post.
      if (dow === 3) {
        posts.push({ type: 'highlight', label: 'Week recap', templateId: 'highlight' });
      }
    } else if (plan.hadGame) {
      // Game week (non-game day): M / F / Sat bumps — so four posts total on
      // non-game days in the week (Mon, Fri, Sat).
      if (dow === 1) posts.push({ type: 'preview', label: 'Pre-game hype',   templateId: 'gameday' });
      if (dow === 5) posts.push({ type: 'leader',  label: 'Week leaders',    templateId: 'batting-leaders' });
      if (dow === 6) posts.push({ type: 'idea',    label: 'Game day prep',   templateId: 'hype' });
    } else {
      // Normal week — baseline M / W / F cadence.
      if (dow === 1) posts.push({ type: 'idea',      label: 'Week start',       templateId: 'player-stat' });
      if (dow === 3) posts.push({ type: 'leader',    label: 'Stat spotlight',   templateId: 'batting-leaders' });
      if (dow === 5) posts.push({ type: 'standings', label: 'Weekend standings', templateId: 'standings' });
    }

    return { date, dayGames, posts };
  });
}

// ─── Dot / chip rendering ───────────────────────────────────────────────────

function colorForPostType(type, teamColor) {
  switch (type) {
    case 'preview':   return teamColor || colors.red;
    case 'highlight': return '#7C3AED';  // violet — live moment
    case 'score':     return '#DC2626';  // red — final
    case 'leader':    return '#F59E0B';  // amber — stats
    case 'standings': return '#0EA5E9';  // sky — standings
    case 'idea':
    default:          return colors.textMuted;
  }
}

// ─── Main component ─────────────────────────────────────────────────────────

export function ContentCalendar({ team, games }) {
  const today = new Date();
  const plan = useMemo(() => buildPostPlan(team, games, today, 4), [team, games]);

  // Group 28 days back into rows of 7.
  const weeks = [];
  for (let i = 0; i < 4; i++) weeks.push(plan.slice(i * 7, i * 7 + 7));

  const hasAnyPosts = plan.some(d => d.posts.length > 0);
  const hasAnyGames = plan.some(d => d.dayGames.length > 0);

  // Pre-compute color treatments. team.color is the hero shade, team.dark
  // is a deeper version, team.accent is the "secondary" (often white-ish
  // or a contrast color). Falls back to existing greys when a team has
  // limited palette data so this component stays drop-in safe.
  const teamColor  = team?.color  || colors.red;
  const teamDark   = team?.dark   || teamColor;
  const teamAccent = team?.accent || '#FFFFFF';
  const onTeamText = bestTextOn(teamColor);
  const todayBg = `${teamColor}1A`;          // ~10% alpha
  const todayBorder = `${teamColor}66`;       // ~40% alpha
  const gameBg = `${teamColor}14`;            // ~8% alpha — slightly darker than before
  const gameBorder = teamColor;

  return (
    <div style={{
      background: colors.white,
      borderRadius: radius.lg,
      border: `1px solid ${colors.borderLight}`,
      borderLeft: `4px solid ${teamColor}`,
      boxShadow: '0 8px 24px rgba(17,24,39,0.06), 0 2px 6px rgba(17,24,39,0.04)',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Team-branded header band — gradient from the team color into a
          softer wash, with the team logo + name. Mirrors the visual
          language of PlayerHero so the team page reads as a unified
          surface rather than a stack of disconnected cards. */}
      <div style={{
        position: 'relative',
        padding: '14px 18px 12px',
        background: `linear-gradient(135deg, ${teamColor} 0%, ${teamDark} 100%)`,
        color: onTeamText,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        {team?.logo && (
          <img
            src={team.logo}
            alt={team.name}
            style={{
              width: 36, height: 36, objectFit: 'contain',
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
              flexShrink: 0,
            }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <SectionHeading style={{
            margin: 0, color: onTeamText,
            textShadow: onTeamText === '#FFFFFF' ? '0 1px 2px rgba(0,0,0,0.2)' : 'none',
          }}>Content calendar</SectionHeading>
          <div style={{
            fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
            letterSpacing: 0.6, opacity: 0.85, marginTop: 2,
          }}>
            {(team?.name || 'TEAM').toUpperCase()} · NEXT 4 WEEKS · {hasAnyGames ? 'GAMES SCHEDULED' : 'NO GAMES YET'}
          </div>
        </div>
      </div>

      {/* Calendar body */}
      <div style={{ padding: 14 }}>
        {/* Weekday header */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6,
          marginBottom: 6, paddingBottom: 6,
          borderBottom: `1px solid ${teamColor}22`,
        }}>
          {['MON','TUE','WED','THU','FRI','SAT','SUN'].map(d => (
            <div key={d} style={{
              fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
              color: teamDark, letterSpacing: 0.9, textAlign: 'center',
              opacity: 0.65,
            }}>{d}</div>
          ))}
        </div>

        {/* Week rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{
              display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6,
            }}>
              {week.map((d, di) => {
                const isToday = isSameDay(d.date, today);
                const isPast = d.date < today && !isToday;
                const hasGame = d.dayGames.length > 0;
                return (
                  <div key={di} style={{
                    background: hasGame ? gameBg : (isToday ? todayBg : colors.bg),
                    border: `1px solid ${
                      isToday ? todayBorder : (hasGame ? `${teamColor}33` : colors.borderLight)
                    }`,
                    borderLeft: hasGame ? `3px solid ${gameBorder}` : `1px solid ${colors.borderLight}`,
                    borderRadius: radius.sm,
                    padding: 6,
                    minHeight: 72,
                    opacity: isPast ? 0.5 : 1,
                    display: 'flex', flexDirection: 'column', gap: 3,
                    transition: 'background 0.15s',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{
                        fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
                        color: isToday ? teamDark : colors.textSecondary,
                      }}>
                        {d.date.getDate()}
                      </span>
                      {hasGame && (
                        <span title="Game scheduled" style={{
                          fontFamily: fonts.condensed, fontSize: 8, fontWeight: 800,
                          background: teamColor, color: onTeamText,
                          padding: '1px 5px', borderRadius: 2, letterSpacing: 0.6,
                        }}>GAME</span>
                      )}
                    </div>
                    {d.posts.map((post, pi) => (
                      <Link
                        key={pi}
                        to={`/generate?template=${post.templateId}&team=${team.id}`}
                        title={`${post.label} → open Generate`}
                        style={{ textDecoration: 'none' }}
                      >
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          fontFamily: fonts.condensed, fontSize: 9, fontWeight: 600,
                          color: colors.textSecondary, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                        }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: colorForPostType(post.type, teamColor),
                            flexShrink: 0,
                          }} />
                          {post.label}
                        </div>
                      </Link>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 12, paddingTop: 10,
          borderTop: `1px solid ${teamColor}22`,
        }}>
          {[
            { type: 'preview',   label: 'Matchup hype' },
            { type: 'highlight', label: 'Live / recap' },
            { type: 'score',     label: 'Final score' },
            { type: 'leader',    label: 'Stat leader' },
            { type: 'standings', label: 'Standings' },
            { type: 'idea',      label: 'Idea / prep' },
          ].map(l => (
            <span key={l.type} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontFamily: fonts.condensed, fontSize: 10, fontWeight: 600, color: colors.textMuted,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: colorForPostType(l.type, teamColor) }} />
              {l.label}
            </span>
          ))}
        </div>

        {!hasAnyPosts && (
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 10, fontStyle: 'italic' }}>
            Default M/W/F cadence shown. Add games via Grand Slam Systems and this calendar bumps to game-week cadence automatically.
          </div>
        )}
      </div>
    </div>
  );
}
