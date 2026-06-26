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

import { useEffect, useMemo, useState, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { Card, PageHeader, SectionHeading, TeamLogo } from '../components';
import { colors, fonts, radius } from '../theme';
import { Icon } from '../icon';
import { TEAMS, getTeam, getTeamAbbr, fetchGames, scoresByDateTime, fetchStandings, fetchPlayoffOdds, PLAYOFF_SPOTS } from '../data';
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

  // Final scores, keyed by `${date}T${HH:MM}`, pulled live from the GSS games
  // feed. Completed games render their score + a FINAL tag; upcoming games keep
  // showing their start time. Null until loaded (schedule still renders).
  const [scores, setScores] = useState(null);
  const [standings, setStandings] = useState(null);
  const [odds, setOdds] = useState(null);
  useEffect(() => {
    // All three share fetchGames()' cache, so this is a single network call.
    fetchGames().then(g => setScores(scoresByDateTime(g))).catch(() => {});
    fetchStandings().then(setStandings).catch(() => {});
    fetchPlayoffOdds().then(setOdds).catch(() => {});
  }, []);

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
        subtitle={`${CURRENT_SEASON} regular season · ${SCHEDULE.length} game days`}
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
              <GameDayCard key={gd.id} gameDay={gd} teamFilter={teamFilter} scores={scores} dimmed />
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
              <GameDayCard key={gd.id} gameDay={gd} teamFilter={teamFilter} scores={scores} />
            ))}
          </div>
        </div>
      )}

      {/* Full standings + playoff odds — beneath the schedule. */}
      <div style={{ marginTop: 20 }}>
        <StandingsTable standings={standings} odds={odds} />
      </div>
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

function GameDayCard({ gameDay, teamFilter, scores, dimmed = false }) {
  // Tag every game with whether it features the active team filter.
  // When a filter is on, off-team games render faded but visible, so
  // the user gets full context without losing focus.
  const isFilteredOn = !!teamFilter;
  const games = gameDay.games.map(g => {
    // Match this scheduled game to its live final score by date+time, then
    // map home/away scores back onto team1/team2 order. Only attach when both
    // teams line up, so a key collision can never show a mismatched score.
    const raw = scores ? scores.get(`${gameDay.date}T${g.time}`) : null;
    let scoreInfo = null;
    if (raw && raw.final) {
      if (raw.homeId === g.team1 && raw.awayId === g.team2) {
        scoreInfo = { s1: raw.homeScore, s2: raw.awayScore };
      } else if (raw.awayId === g.team1 && raw.homeId === g.team2) {
        scoreInfo = { s1: raw.awayScore, s2: raw.homeScore };
      }
    }
    return {
      ...g,
      featuresFilter: !isFilteredOn || g.team1 === teamFilter || g.team2 === teamFilter,
      scoreInfo,
    };
  });

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
          fontFamily: fonts.heading, fontSize: 18, fontWeight: 700,
          letterSpacing: 0, color: colors.text,
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
  const sc = game.scoreInfo;
  const final = !!sc;
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
        fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
        color: final ? colors.red : colors.textSecondary, letterSpacing: 0.5,
        minWidth: 64, whiteSpace: 'nowrap',
      }}>
        {final ? 'FINAL' : formatGameTime(game.time)}
      </div>
      <TeamSlot teamId={game.team1} winner={final && sc.s1 > sc.s2} loser={final && sc.s1 < sc.s2} />
      <div style={{
        fontFamily: final ? fonts.mono : fonts.condensed,
        fontSize: final ? 15 : 10, fontWeight: 800,
        color: final ? colors.text : colors.textMuted,
        letterSpacing: final ? 0 : 1, padding: '0 2px',
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>{final ? `${sc.s1}–${sc.s2}` : 'VS'}</div>
      <TeamSlot teamId={game.team2} winner={final && sc.s2 > sc.s1} loser={final && sc.s2 < sc.s1} />
    </div>
  );
}

// Team slot — logo + abbr + linked to team page. When a game is final the
// winner's abbr bolds and the loser dims, so a glance reads the result.
function TeamSlot({ teamId, winner = false, loser = false }) {
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
        opacity: loser ? 0.5 : 1,
      }}
      title={t.name}
    >
      <TeamLogo teamId={t.id} size={18} rounded="square" />
      <span style={{
        fontFamily: fonts.body, fontSize: 12, fontWeight: winner ? 800 : 600,
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
      {primary && <Icon name="broadcast" size={12} />}
      {text}
    </span>
  );
}

// ─── Full standings table + playoff odds ───────────────────────────────────

function fmtOdds(o) {
  if (!o) return '—';
  const p = o.odds * 100;
  if (p >= 99.5) return '99%+';   // a sampled sim can't prove a true clinch
  if (p < 0.5) return '<1%';      // ...or a true elimination
  return `${Math.round(p)}%`;
}

function oddsColor(o) {
  if (!o) return colors.textMuted;
  if (o.odds >= 0.66) return colors.successText;
  if (o.odds >= 0.33) return colors.warningText;
  if (o.odds >= 0.005) return colors.dangerText;
  return colors.textMuted;
}

function StandingsTable({ standings, odds }) {
  if (!standings || !standings.ordered) {
    return (
      <Card>
        <SectionHeading style={{ margin: '0 0 4px' }}>Standings</SectionHeading>
        <div style={{ padding: '14px 0', textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
          Standings updating…
        </div>
      </Card>
    );
  }
  const rows = standings.ordered;
  const numCell = { textAlign: 'right', fontFamily: fonts.mono, fontVariantNumeric: 'tabular-nums' };
  const th = { ...numCell, fontSize: 10, fontWeight: 600, letterSpacing: 0.4, color: colors.textMuted, textTransform: 'uppercase', padding: '0 8px 7px' };
  const td = { ...numCell, fontSize: 14, fontWeight: 700, color: colors.text, padding: '7px 8px' };

  return (
    <Card>
      <SectionHeading style={{ margin: '0 0 8px' }}>Standings</SectionHeading>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.divider}` }}>
              <th style={{ ...th, textAlign: 'center', width: 34 }}>#</th>
              <th style={{ ...th, textAlign: 'left' }}>Team</th>
              <th style={th}>GP</th>
              <th style={th}>W</th>
              <th style={th}>L</th>
              <th style={th}>PCT</th>
              <th style={th}>RF</th>
              <th style={th}>RA</th>
              <th style={th}>DIFF</th>
              <th style={{ ...th, minWidth: 76 }}>Playoff</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const o = odds ? odds.get(r.teamId) : null;
              const t = getTeam(r.teamId);
              return (
                <Fragment key={r.teamId}>
                  {i === PLAYOFF_SPOTS && (
                    <tr aria-hidden="true">
                      <td colSpan={10} style={{ padding: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
                          <div style={{ flex: 1, height: 2, background: colors.red, opacity: 0.45, borderRadius: 1 }} />
                          <span style={{ fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800, letterSpacing: 1, color: colors.red, textTransform: 'uppercase' }}>Playoff line</span>
                          <div style={{ flex: 1, height: 2, background: colors.red, opacity: 0.45, borderRadius: 1 }} />
                        </div>
                      </td>
                    </tr>
                  )}
                  <tr style={{ borderBottom: i < rows.length - 1 ? `1px solid ${colors.divider}` : 'none' }}>
                    <td style={{ ...td, textAlign: 'center', color: colors.textMuted }}>{r.rank ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'left' }}>
                      {t ? (
                        <Link to={`/teams/${t.slug}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none', color: colors.text }} title={t.name}>
                          <TeamLogo teamId={t.id} size={20} rounded="square" />
                          <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13 }}>{getTeamAbbr(t)}</span>
                        </Link>
                      ) : r.teamId}
                    </td>
                    <td style={{ ...td, fontWeight: 600, color: colors.textSecondary }}>{r.gp}</td>
                    <td style={td}>{r.w}</td>
                    <td style={td}>{r.l}</td>
                    <td style={{ ...td, color: colors.red }}>{r.pct}</td>
                    <td style={{ ...td, fontWeight: 600, color: colors.textSecondary }}>{r.rf}</td>
                    <td style={{ ...td, fontWeight: 600, color: colors.textSecondary }}>{r.ra}</td>
                    <td style={{ ...td, color: r.diffNum > 0 ? colors.successText : r.diffNum < 0 ? colors.dangerText : colors.textSecondary }}>{r.diff}</td>
                    <td style={{ ...td, color: oddsColor(o) }}>{fmtOdds(o)}</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: colors.textMuted, margin: '10px 2px 0', lineHeight: 1.5 }}>
        Playoff odds simulate every remaining game 10,000 times from each team's scoring strength, breaking ties by fewest runs against (the BLW tiebreaker). Teams whose season is already complete show their locked-in odds.
      </p>
    </Card>
  );
}
