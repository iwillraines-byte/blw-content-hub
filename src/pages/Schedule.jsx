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
import { TEAMS, getTeam, getTeamAbbr, fetchGames, scoresByDateTime, fetchStandings, fetchPlayoffOdds, fetchClinchStatus, PLAYOFF_SPOTS } from '../data';
import { fetchLeagueSplits, splitLabel } from '../splits';
import SplitToggle from '../split-toggle';
import {
  SCHEDULE,
  getAllGameDays,
  formatGameTime,
  formatGameDayDate,
  toIsoDate,
} from '../schedule-data';

const CURRENT_SEASON = '2026';

// Postseason rounds, weakest to strongest. Used to work out how far each team
// got from the games themselves rather than hardcoding a bracket.
const ROUND_ORDER = ['Play-in', 'Semifinal', 'Championship'];

export default function Schedule() {
  const [teamFilter, setTeamFilter] = useState('');  // '' = all teams

  // Final scores, keyed by `${date}T${HH:MM}`, pulled live from the GSS games
  // feed. Completed games render their score + a FINAL tag; upcoming games keep
  // showing their start time. Null until loaded (schedule still renders).
  const [scores, setScores] = useState(null);
  // Records for all three splits. They all read the same cached games feed, so
  // computing three is no extra network cost — and it lets the toggle switch
  // instantly instead of refetching.
  const [standings, setStandings] = useState({ regular: null, postseason: null, total: null });
  const [odds, setOdds] = useState(null);
  // Exact clinch/elimination status when the remaining slate is small enough to
  // enumerate; null otherwise (→ StandingsTable falls back to the odds column).
  const [clinch, setClinch] = useState(null);

  // Which split the standings + team stats report. Regular season is the
  // default because "the 2026 standings" means the regular season.
  const [split, setSplit] = useState('regular');

  // Player-level game logs rolled up per team — the only source that separates
  // postseason from regular season (see src/splits.js). Loaded once, in the
  // background, because it fans out over every player in the league.
  const [teamSplits, setTeamSplits] = useState(null);
  const [splitsFailed, setSplitsFailed] = useState(false);

  useEffect(() => {
    // All share fetchGames()' cache, so this is a single network call.
    fetchGames().then(g => setScores(scoresByDateTime(g))).catch(() => {});
    Promise.all([
      fetchStandings('regular'),
      fetchStandings('postseason'),
      fetchStandings('total'),
    ]).then(([regular, postseason, total]) => setStandings({ regular, postseason, total }))
      .catch(() => {});
    fetchPlayoffOdds().then(setOdds).catch(() => {});
    fetchClinchStatus().then(setClinch).catch(() => {});
    fetchLeagueSplits()
      .then(r => { if (r?.teams?.size) setTeamSplits(r.teams); else setSplitsFailed(true); })
      .catch(() => setSplitsFailed(true));
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

  // How far each team got, worked out from the postseason results themselves.
  const postseasonResults = useMemo(() => computePostseasonResults(scores), [scores]);

  const regularDays = SCHEDULE.filter(d => d.season === CURRENT_SEASON && d.type !== 'postseason').length;
  const postDays = SCHEDULE.filter(d => d.season === CURRENT_SEASON && d.type === 'postseason').length;

  return (
    <div>
      <PageHeader
        title="Schedule"
        subtitle={`${CURRENT_SEASON} season · ${regularDays} regular season game day${regularDays === 1 ? '' : 's'}${postDays ? ` · ${postDays} postseason` : ''}`}
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

      {/* Records + team stats, both split three ways, beneath the schedule. */}
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <StandingsTable
          standings={standings[split]}
          odds={odds}
          clinch={clinch}
          split={split}
          onSplit={setSplit}
          results={postseasonResults}
        />
        <TeamStatsTable
          teamSplits={teamSplits}
          failed={splitsFailed}
          split={split}
          onSplit={setSplit}
        />
      </div>
    </div>
  );
}

// ─── Postseason results ────────────────────────────────────────────────────
// Derives each team's furthest round + outcome from the postseason slates and
// their live final scores, so the bracket isn't hardcoded anywhere. Best-of-
// three rounds resolve on games won, not on the last game played.

function computePostseasonResults(scores) {
  const byTeam = new Map(); // teamId → Map(round → { w, l })
  const bump = (teamId, round, won) => {
    if (!teamId || !round) return;
    if (!byTeam.has(teamId)) byTeam.set(teamId, new Map());
    const rounds = byTeam.get(teamId);
    if (!rounds.has(round)) rounds.set(round, { w: 0, l: 0 });
    const rec = rounds.get(round);
    if (won) rec.w++; else rec.l++;
  };

  for (const gd of SCHEDULE) {
    if (gd.type !== 'postseason') continue;
    for (const g of gd.games) {
      const sc = scoreFor(scores, gd.date, g);
      if (!sc) continue;
      if (sc.s1 === sc.s2) continue;   // no ties in the bracket
      bump(g.team1, g.round, sc.s1 > sc.s2);
      bump(g.team2, g.round, sc.s2 > sc.s1);
    }
  }

  const out = new Map();
  for (const [teamId, rounds] of byTeam) {
    // Furthest round the team actually appeared in.
    let deepest = null;
    for (const round of rounds.keys()) {
      if (deepest == null || ROUND_ORDER.indexOf(round) > ROUND_ORDER.indexOf(deepest)) deepest = round;
    }
    const rec = rounds.get(deepest);
    const wonRound = rec.w > rec.l;
    // Advancing past the deepest round played means the next round hasn't
    // happened yet — that's a pending finalist, not a completed run.
    const stillAlive = wonRound && ROUND_ORDER.indexOf(deepest) < ROUND_ORDER.length - 1;
    out.set(teamId, {
      round: deepest,
      record: `${rec.w}-${rec.l}`,
      label: stillAlive
        ? `Won ${deepest.toLowerCase()}`
        : wonRound ? 'Champion' : `Lost ${deepest.toLowerCase()}`,
      alive: stillAlive,
      won: wonRound,
    });
  }
  return out;
}

// Match one scheduled game to its live final, mapping home/away back onto the
// schedule's team1/team2 order. Returns null unless both teams line up, so a
// key collision can never surface a mismatched score.
function scoreFor(scores, date, g) {
  const raw = scores ? scores.get(`${date}T${g.time}`) : null;
  if (!raw || !raw.final) return null;
  if (raw.homeId === g.team1 && raw.awayId === g.team2) return { s1: raw.homeScore, s2: raw.awayScore };
  if (raw.awayId === g.team1 && raw.homeId === g.team2) return { s1: raw.awayScore, s2: raw.homeScore };
  return null;
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
  const isPostseason = gameDay.type === 'postseason';
  const games = gameDay.games.map(g => ({
    ...g,
    featuresFilter: !isFilteredOn || g.team1 === teamFilter || g.team2 === teamFilter,
    scoreInfo: scoreFor(scores, gameDay.date, g),
  }));

  return (
    <Card style={{
      opacity: dimmed ? 0.65 : 1,
      transition: 'opacity 160ms ease',
      // Postseason slates carry an accent edge so they read as a different
      // phase of the season at a glance.
      ...(isPostseason ? { borderLeft: `3px solid ${colors.red}` } : null),
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
        {isPostseason && (
          <span style={{
            fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
            color: colors.red, letterSpacing: 1, textTransform: 'uppercase',
          }}>Postseason</span>
        )}
        <div style={{
          fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
          color: colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase',
        }}>
          {gameDay.venue}{gameDay.venueCity ? ` · ${gameDay.venueCity}` : ''}
        </div>
        {gameDay.broadcast && <BroadcastChip text={gameDay.broadcast} primary />}
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
      display: 'flex', flexDirection: 'column', gap: 4,
      padding: '8px 10px',
      border: `1px solid ${colors.borderLight}`,
      borderRadius: radius.sm,
      background: colors.white,
      opacity: game.featuresFilter ? 1 : 0.4,
      transition: 'opacity 160ms ease',
      minWidth: 0,
    }}>
      {/* Postseason rows name their round (and which game of a series it is),
          so a three-game semifinal doesn't read as three unrelated matchups. */}
      {game.round && (
        <div style={{
          fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
          color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
        }}>
          {game.round}{game.gameNo ? ` · Game ${game.gameNo}` : ''}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
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

// Exact clinch status → label + color. Clinched green, Alive amber, Eliminated
// dimmed (the standard "out of it" treatment).
const CLINCH_LABEL = { clinched: 'Clinched', alive: 'Alive', eliminated: 'Eliminated' };
function clinchColor(status) {
  if (status === 'clinched') return colors.successText;
  if (status === 'alive') return colors.warningText;
  return colors.textMuted; // eliminated
}

function StandingsTable({ standings, odds, clinch, split, onSplit, results }) {
  const isRegular = split === 'regular';
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
      <SectionHeading style={{ margin: 0 }}>Records</SectionHeading>
      <SplitToggle value={split} onChange={onSplit} ariaLabel="Standings split" />
    </div>
  );

  if (!standings || !standings.ordered) {
    return (
      <Card>
        {header}
        <div style={{ padding: '14px 0', textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
          Standings updating…
        </div>
      </Card>
    );
  }

  // Outside the regular season, a team that never played is not 0-0 — it just
  // isn't in the field. Showing it would rank four eliminated teams alongside
  // six that actually played.
  const rows = isRegular ? standings.ordered : standings.ordered.filter(r => r.gp > 0);

  if (rows.length === 0) {
    return (
      <Card>
        {header}
        <div style={{ padding: '14px 0', textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
          No {splitLabel(split).toLowerCase()} games have been played yet.
        </div>
      </Card>
    );
  }

  // The playoff cut line only means something on the regular-season table.
  const cutLineAt = isRegular ? PLAYOFF_SPOTS : -1;
  const lastCol = isRegular ? (clinch ? 'Status' : 'Playoff') : 'Result';

  const numCell = { textAlign: 'right', fontFamily: fonts.mono, fontVariantNumeric: 'tabular-nums' };
  const th = { ...numCell, fontSize: 10, fontWeight: 600, letterSpacing: 0.4, color: colors.textMuted, textTransform: 'uppercase', padding: '0 8px 7px' };
  const td = { ...numCell, fontSize: 14, fontWeight: 700, color: colors.text, padding: '7px 8px' };

  return (
    <Card>
      {header}
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
              <th style={{ ...th, minWidth: 84 }}>{lastCol}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const o = odds ? odds.get(r.teamId) : null;
              const c = clinch ? clinch.get(r.teamId) : null;
              const res = results ? results.get(r.teamId) : null;
              const t = getTeam(r.teamId);
              return (
                <Fragment key={r.teamId}>
                  {i === cutLineAt && (
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
                    {/* Ranks are assigned across all ten teams. Once the
                        never-played teams are filtered out of a postseason or
                        total view, those numbers have gaps (PHI showing 9th of
                        a six-team field), so the visible list is renumbered. */}
                    <td style={{ ...td, textAlign: 'center', color: colors.textMuted }}>{isRegular ? (r.rank ?? '—') : i + 1}</td>
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
                    {!isRegular ? (
                      <td style={{ ...td, color: res?.won ? colors.successText : colors.textMuted, fontFamily: fonts.condensed, fontWeight: 800, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                        {res?.label || '—'}
                      </td>
                    ) : c ? (
                      <td style={{ ...td, color: clinchColor(c.status), fontFamily: fonts.condensed, fontWeight: 800, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                        {CLINCH_LABEL[c.status]}
                      </td>
                    ) : (
                      <td style={{ ...td, color: oddsColor(o) }}>{fmtOdds(o)}</td>
                    )}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: colors.textMuted, margin: '10px 2px 0', lineHeight: 1.5 }}>
        {!isRegular
          ? `${splitLabel(split)} records count only the teams that played. Ranking still uses the BLW tiebreakers — win %, then head-to-head, then fewest runs against — but seeding in a bracket is set by the regular season, so read this as a results table, not a standings table.`
          : clinch
            ? 'Regular season only — postseason games are excluded. Status is exact: every possible outcome of the remaining games is tested against the BLW tiebreakers — win %, then head-to-head, then fewest runs against. Clinched = in the top 6 no matter what; Eliminated = out no matter what; Alive = still in play.'
            : 'Regular season only — postseason games are excluded. Playoff odds simulate every remaining game 10,000 times from each team’s scoring strength, breaking ties by head-to-head, then fewest runs against (the BLW tiebreaker). Teams whose season is already complete show their locked-in odds.'}
      </p>
    </Card>
  );
}

// ─── Team stats, split three ways ──────────────────────────────────────────
// Rolled up from every player's game logs (src/splits.js) — the only feed that
// separates postseason from regular season. Rates come from team totals, not
// from averaging player rates.

const BATTING_COLS = [
  { key: 'games', label: 'G',   fmt: v => v },
  { key: 'pa',    label: 'PA',  fmt: v => v },
  { key: 'ab',    label: 'AB',  fmt: v => v },
  { key: 'runs',  label: 'R',   fmt: v => v },
  { key: 'hits',  label: 'H',   fmt: v => v },
  { key: 'hr',    label: 'HR',  fmt: v => v },
  { key: 'rbi',   label: 'RBI', fmt: v => v },
  { key: 'bb',    label: 'BB',  fmt: v => v },
  { key: 'k',     label: 'K',   fmt: v => v },
  { key: 'avg',   label: 'AVG', fmt: v => trimZero(v), strong: true },
  { key: 'obp',   label: 'OBP', fmt: v => trimZero(v) },
  { key: 'slg',   label: 'SLG', fmt: v => trimZero(v) },
  { key: 'ops',   label: 'OPS', fmt: v => trimZero(v), strong: true },
];

const PITCHING_COLS = [
  { key: 'games', label: 'APP',  fmt: v => v },
  { key: 'ip',    label: 'IP',   fmt: v => v },
  { key: 'hits',  label: 'H',    fmt: v => v },
  { key: 'runs',  label: 'R',    fmt: v => v },
  { key: 'hrAllowed', label: 'HR', fmt: v => v },
  { key: 'bb',    label: 'BB',   fmt: v => v },
  { key: 'k',     label: 'K',    fmt: v => v },
  { key: 'era',   label: 'ERA',  fmt: v => v, strong: true },
  { key: 'whip',  label: 'WHIP', fmt: v => v, strong: true },
  { key: 'k4',    label: 'K/3',  fmt: v => v },
];

// ".333" reads better than "0.333" for rate stats — matches the rest of the app.
function trimZero(v) {
  return typeof v === 'string' ? v.replace(/^0(?=\.)/, '') : v;
}

function TeamStatsTable({ teamSplits, failed, split, onSplit }) {
  const [disc, setDisc] = useState('batting');
  const cols = disc === 'batting' ? BATTING_COLS : PITCHING_COLS;

  const rows = useMemo(() => {
    if (!teamSplits) return null;
    return TEAMS
      .map(t => ({ team: t, line: teamSplits.get(t.id)?.[disc]?.[split] || null }))
      .filter(r => r.line)
      // Sort by the headline rate for the discipline: OPS high-to-low for
      // batting, ERA low-to-high for pitching.
      .sort((a, b) => (disc === 'batting'
        ? parseFloat(b.line.ops) - parseFloat(a.line.ops)
        : parseFloat(a.line.era) - parseFloat(b.line.era)));
  }, [teamSplits, disc, split]);

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <SectionHeading style={{ margin: 0 }}>Team stats</SectionHeading>
        <div style={{
          display: 'inline-flex', gap: 0, background: colors.muted,
          border: `1px solid ${colors.borderLight}`, borderRadius: radius.base, padding: 3,
        }}>
          {['batting', 'pitching'].map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setDisc(d)}
              aria-pressed={disc === d}
              style={{
                border: 'none', cursor: 'pointer',
                background: disc === d ? colors.white : 'transparent',
                color: disc === d ? colors.text : colors.textMuted,
                fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                letterSpacing: 0.3, padding: '4px 10px', borderRadius: radius.sm,
                textTransform: 'capitalize',
              }}
            >{d}</button>
          ))}
        </div>
      </div>
      <SplitToggle value={split} onChange={onSplit} ariaLabel="Team stats split" />
    </div>
  );

  if (failed) {
    return (
      <Card>
        {header}
        <div style={{ padding: '14px 0', textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
          Team stat splits couldn’t be loaded. Refresh to try again.
        </div>
      </Card>
    );
  }
  if (!rows) {
    return (
      <Card>
        {header}
        <div style={{ padding: '14px 0', textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
          Building splits from every player’s game log…
        </div>
      </Card>
    );
  }
  if (rows.length === 0) {
    return (
      <Card>
        {header}
        <div style={{ padding: '14px 0', textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
          No {splitLabel(split).toLowerCase()} {disc} data yet.
        </div>
      </Card>
    );
  }

  const numCell = { textAlign: 'right', fontFamily: fonts.mono, fontVariantNumeric: 'tabular-nums' };
  const th = { ...numCell, fontSize: 10, fontWeight: 600, letterSpacing: 0.4, color: colors.textMuted, textTransform: 'uppercase', padding: '0 7px 7px' };
  const td = { ...numCell, fontSize: 13, fontWeight: 600, color: colors.textSecondary, padding: '7px' };

  return (
    <Card>
      {header}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.divider}` }}>
              <th style={{ ...th, textAlign: 'left' }}>Team</th>
              {cols.map(c => <th key={c.key} style={th}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ team, line }, i) => (
              <tr key={team.id} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${colors.divider}` : 'none' }}>
                <td style={{ ...td, textAlign: 'left', padding: '7px' }}>
                  <Link to={`/teams/${team.slug}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none', color: colors.text }} title={team.name}>
                    <TeamLogo teamId={team.id} size={20} rounded="square" />
                    <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13 }}>{getTeamAbbr(team)}</span>
                  </Link>
                </td>
                {cols.map(c => (
                  <td key={c.key} style={c.strong ? { ...td, fontWeight: 800, color: colors.text } : td}>
                    {line[c.key] == null ? '—' : c.fmt(line[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: colors.textMuted, margin: '10px 2px 0', lineHeight: 1.5 }}>
        {splitLabel(split)} team totals, built from every player’s per-game log — the only place the league feed
        marks a game as postseason. Regular-season totals here match the league’s published team stats exactly.
        {disc === 'batting'
          ? ' G and APP count player-games, not team games. OPS+ and wRC+ are league-adjusted upstream and aren’t available per split, so they’re left out.'
          : ' APP counts pitcher appearances, not team games. ERA and K/3 are per three innings (one BLW game). FIP and ERA+ are league-adjusted upstream and aren’t available per split, so they’re left out.'}
      </p>
    </Card>
  );
}
