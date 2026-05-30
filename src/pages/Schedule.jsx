// Schedule page — full league schedule view for the current season.
//
// v4.8.6 (Phase 1 of season-aware): renders every game day in the 2026
// regular season as a stacked card list, matching the master's source-
// of-truth document. Each game day card shows date + venue + broadcast
// info, then a row per game with two team chips and the start time.
//
// Filter strip at the top scopes the view to a single team — picking
// "Atlanta Ballers" hides game days where ATL doesn't appear and
// fades games within remaining days that don't feature ATL. "All
// teams" (default) shows everything.
//
// Past game days dim slightly so the user's eye lands on what's
// upcoming. A separator strip breaks PAST and UPCOMING groups when
// both exist on screen.
//
// Phase 2 work (not in this release): season switcher dropdown,
// click-game-to-open-Studio-with-matchup-prefilled, score columns
// once games complete.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, PageHeader, SectionHeading, TeamLogo } from '../components';
import { colors, fonts, radius } from '../theme';
import { TEAMS, getTeam, getTeamAbbr } from '../data';
import {
  SCHEDULE,
  getAllGameDays,
  formatGameTime,
  formatGameDayDate,
  toIsoDate,
} from '../schedule-data';

const CURRENT_SEASON = '2026';

export default function Schedule() {
  const [teamFilter, setTeamFilter] = useState('');  // '' = all teams

  // Sort all game days ascending. Past/upcoming split is computed below
  // so the same render code handles both groups identically.
  const allDays = useMemo(() => getAllGameDays(CURRENT_SEASON), []);
  const todayKey = toIsoDate(new Date());

  // Apply the team filter — when set, hide game days the team doesn't
  // appear on at all. Days where the team appears stay visible, but
  // games NOT featuring the team get a "muted" treatment so the user
  // can still see the full game day context.
  const visibleDays = useMemo(() => {
    if (!teamFilter) return allDays;
    return allDays.filter(gd =>
      gd.games.some(g => g.team1 === teamFilter || g.team2 === teamFilter)
    );
  }, [allDays, teamFilter]);

  const pastDays = visibleDays.filter(gd => gd.date < todayKey);
  const upcomingDays = visibleDays.filter(gd => gd.date >= todayKey);

  return (
    <div>
      <PageHeader
        title="Schedule"
        subtitle={`${CURRENT_SEASON} BLW regular season · ${SCHEDULE.length} game days · all at Assembly Studios, Atlanta GA`}
      />

      {/* Team filter strip — chip per team, "All teams" first. */}
      <Card style={{ marginBottom: 14 }}>
        <SectionHeading style={{ marginBottom: 8 }}>Filter by team</SectionHeading>
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6,
        }}>
          <FilterChip
            active={!teamFilter}
            onClick={() => setTeamFilter('')}
            label="All teams"
          />
          {TEAMS.map(t => (
            <FilterChip
              key={t.id}
              active={teamFilter === t.id}
              onClick={() => setTeamFilter(teamFilter === t.id ? '' : t.id)}
              label={getTeamAbbr(t)}
              teamId={t.id}
            />
          ))}
        </div>
      </Card>

      {visibleDays.length === 0 && (
        <Card>
          <div style={{
            padding: 24, textAlign: 'center', color: colors.textSecondary,
            fontSize: 13, fontFamily: fonts.body,
          }}>
            No game days for that team yet. Try "All teams" to see the full schedule.
          </div>
        </Card>
      )}

      {/* PAST group — only renders if there are past days AND the user
          isn't currently filtered to only-future. */}
      {pastDays.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <GroupHeading label={`Past · ${pastDays.length} game day${pastDays.length === 1 ? '' : 's'}`} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pastDays.map(gd => (
              <GameDayCard key={gd.id} gameDay={gd} teamFilter={teamFilter} dimmed />
            ))}
          </div>
        </div>
      )}

      {/* UPCOMING group — the eye-magnet. */}
      {upcomingDays.length > 0 && (
        <div>
          {pastDays.length > 0 && (
            <GroupHeading label={`Upcoming · ${upcomingDays.length} game day${upcomingDays.length === 1 ? '' : 's'}`} />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {upcomingDays.map(gd => (
              <GameDayCard key={gd.id} gameDay={gd} teamFilter={teamFilter} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Filter chip — team-tinted with active/inactive states ─────────────────

function FilterChip({ active, onClick, label, teamId }) {
  const t = teamId ? getTeam(teamId) : null;
  const bg = active
    ? (t?.chipBg || t?.color || colors.red)
    : colors.white;
  const fg = active
    ? (t?.chipText || t?.accent || colors.white)
    : colors.text;
  const border = active
    ? (t?.chipBg || t?.color || colors.red)
    : colors.borderLight;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: bg, color: fg,
        border: `1px solid ${border}`,
        borderRadius: radius.sm,
        padding: '5px 10px',
        fontSize: 11, fontFamily: fonts.condensed,
        fontWeight: 700, letterSpacing: 0.5,
        cursor: 'pointer',
        transition: 'background 160ms ease, border-color 160ms ease',
      }}
    >
      {teamId && <TeamLogo teamId={teamId} size={14} rounded="square" />}
      {label}
    </button>
  );
}

// ─── Section group heading (PAST / UPCOMING) ───────────────────────────────

function GroupHeading({ label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 8px',
    }}>
      <div style={{
        fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
        color: colors.textMuted, letterSpacing: 1.2,
        textTransform: 'uppercase', whiteSpace: 'nowrap',
      }}>{label}</div>
      <div style={{ flex: 1, height: 1, background: colors.borderLight }} />
    </div>
  );
}

// ─── Game day card — date header + list of games ───────────────────────────

function GameDayCard({ gameDay, teamFilter, dimmed = false }) {
  // Tag every game with whether it features the active team filter.
  // When a filter is on, off-team games render faded but visible, so
  // the user gets full context without losing focus.
  const isFilteredOn = !!teamFilter;
  const games = gameDay.games.map(g => ({
    ...g,
    featuresFilter: !isFilteredOn || g.team1 === teamFilter || g.team2 === teamFilter,
  }));

  return (
    <Card style={{
      opacity: dimmed ? 0.65 : 1,
      transition: 'opacity 160ms ease',
    }}>
      {/* Header strip: date · venue · broadcast */}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10,
        flexWrap: 'wrap', marginBottom: 12,
      }}>
        <div style={{
          fontFamily: fonts.heading, fontSize: 18,
          letterSpacing: 1, color: colors.text,
        }}>
          {formatGameDayDate(gameDay.date)}
        </div>
        <div style={{
          fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
          color: colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase',
        }}>
          {gameDay.venue}{gameDay.venueCity ? ` · ${gameDay.venueCity}` : ''}
        </div>
        <BroadcastChip text={gameDay.broadcast} primary />
        {gameDay.firstSlateAlso && (
          <BroadcastChip text={`First slate also: ${gameDay.firstSlateAlso}`} />
        )}
      </div>

      {/* Games list — one row per matchup */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 8,
      }}>
        {games.map((g, i) => (
          <GameRow key={`${gameDay.id}-${i}`} game={g} />
        ))}
      </div>
    </Card>
  );
}

// ─── Single game row: time + team1 vs team2 ───────────────────────────────

function GameRow({ game }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 10px',
      border: `1px solid ${colors.borderLight}`,
      borderRadius: radius.sm,
      background: colors.white,
      opacity: game.featuresFilter ? 1 : 0.4,
      transition: 'opacity 160ms ease',
      minWidth: 0,
    }}>
      <div style={{
        fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800,
        color: colors.textSecondary, letterSpacing: 0.5,
        minWidth: 64, whiteSpace: 'nowrap',
      }}>
        {formatGameTime(game.time)}
      </div>
      <TeamSlot teamId={game.team1} />
      <div style={{
        fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
        color: colors.textMuted, letterSpacing: 1, padding: '0 2px',
      }}>VS</div>
      <TeamSlot teamId={game.team2} />
    </div>
  );
}

// Team slot — logo + abbr + linked to team page.
function TeamSlot({ teamId }) {
  const t = getTeam(teamId);
  if (!t) {
    return (
      <span style={{ fontFamily: fonts.condensed, fontSize: 12, fontWeight: 800, color: colors.textMuted }}>
        {teamId}
      </span>
    );
  }
  return (
    <Link
      to={`/teams/${t.slug}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        textDecoration: 'none', color: colors.text,
        minWidth: 0, flex: 1,
      }}
      title={t.name}
    >
      <TeamLogo teamId={t.id} size={18} rounded="square" />
      <span style={{
        fontFamily: fonts.body, fontSize: 12, fontWeight: 600,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{getTeamAbbr(t)}</span>
    </Link>
  );
}

// Broadcast chip — small pill for broadcast info.
function BroadcastChip({ text, primary }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: primary ? colors.bg : 'transparent',
      color: primary ? colors.text : colors.textMuted,
      border: `1px solid ${primary ? colors.borderLight : 'transparent'}`,
      borderRadius: radius.sm,
      padding: '2px 8px',
      fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
      letterSpacing: 0.5,
    }}>
      {primary && <span style={{ fontSize: 10 }}>📺</span>}
      {text}
    </span>
  );
}
