import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getTeam, getPlayerByTeamLastName, fetchAllData, fetchTeamRosterFromApi } from '../data';
import { Card, SectionHeading, RedButton, OutlineButton, TeamLogo } from '../components';
import { colors, fonts, radius } from '../theme';
import { findPlayerMedia, findTeamMedia, blobToObjectURL } from '../media-store';
import { getManualPlayersByTeam, upsertManualPlayer } from '../player-store';
import { TierBadge } from '../tier-badges';
import { useAuth, isAdminRole } from '../auth';
import { useToast } from '../toast';

function buildStatLine(player) {
  if (player.batting) {
    const b = player.batting;
    return `OPS+ ${b.ops_plus} | AVG ${b.avg} | HR ${b.hr} | OBP ${b.obp}`;
  }
  if (player.pitching) {
    const p = player.pitching;
    const fip = typeof p.fip === 'number' ? p.fip.toFixed(2) : p.fip;
    return `FIP ${fip} | IP ${p.ip} | W ${p.w} | K/4 ${p.k4}`;
  }
  return '';
}


// ─── League rank helpers ────────────────────────────────────────────────────
// Compute a player's 1-indexed rank for a given numeric stat across the list.
// `direction`: "desc" means higher is better (rank 1 = highest), "asc" = lower better.
function rankOf(list, playerName, statKey, direction = 'desc', toNumber = parseFloat) {
  if (!Array.isArray(list) || list.length === 0 || !playerName) return null;
  const cleaned = list
    .map(p => ({ name: p.name, v: toNumber(p[statKey]) }))
    .filter(x => x.name && !isNaN(x.v));
  cleaned.sort((a, b) => direction === 'asc' ? a.v - b.v : b.v - a.v);
  const idx = cleaned.findIndex(x => x.name === playerName);
  return idx === -1 ? null : idx + 1;
}

// Colored pill showing a rank across BLW for a given stat.
function RankChip({ rank, total }) {
  if (!rank) {
    return <span style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.condensed, fontWeight: 600 }}>—</span>;
  }
  // Use a muted team-neutral style; tier colors only on the big tier badge
  const palette = rank <= 3
    ? { bg: '#FEF3C7', fg: '#92400E' }        // gold-ish for top 3
    : rank <= 10
      ? { bg: 'rgba(37,99,235,0.1)', fg: '#1E40AF' }
      : rank <= 25
        ? { bg: 'rgba(22,163,74,0.1)', fg: '#15803D' }
        : { bg: colors.bg, fg: colors.textSecondary };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      background: palette.bg, color: palette.fg,
      padding: '2px 8px', borderRadius: 999,
      fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
    }}>
      #{rank}{total ? ` / ${total}` : ''} BLW
    </span>
  );
}

// ─── PlayerHero — ESPN-style header card ───────────────────────────────────
// Renders:
//   [profile circle]  [name + team/number + position + CTA]   [vitals column]   [season stats card]
// Vitals sourced from manual_players.* — we read player.vitals if present
// (stored under that shape client-side after migration 004 lands + app
// reads them). Missing fields render a neutral "—".

function formatHeight(totalInches) {
  if (!totalInches || Number.isNaN(Number(totalInches))) return null;
  const n = Number(totalInches);
  const ft = Math.floor(n / 12);
  const inch = n % 12;
  return `${ft}' ${inch}"`;
}

function formatBirthdate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const age = Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    return `${d.toLocaleDateString('en-US')}${age ? ` (${age})` : ''}`;
  } catch { return null; }
}

// League-rank row — uses the same VitalRow layout but injects a movement
// indicator (▲3 / ▼2 / —) when we know the rank delta. rankChange > 0
// means the player MOVED UP (lower rank number = better), so a green
// up-arrow. < 0 = moved down = red down-arrow. 0 = steady (gray dash).
function LeagueRankRow({ ranking }) {
  const rank = ranking?.currentRank || null;
  const change = typeof ranking?.rankChange === 'number' ? ranking.rankChange : 0;
  if (!rank) {
    return <VitalRow label="League Rank" value={null} />;
  }
  const arrow = change > 0 ? '▲' : change < 0 ? '▼' : '—';
  const arrowColor = change > 0 ? '#15803D' : change < 0 ? '#991B1B' : colors.textMuted;
  const compositePts = typeof ranking?.compositePoints === 'number'
    ? ranking.compositePoints.toLocaleString()
    : null;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0', borderBottom: `1px solid ${colors.divider}` }}>
      <div style={{
        fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
        color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
        width: 76, flexShrink: 0,
      }}>League Rank</div>
      <div style={{
        fontFamily: fonts.body, fontSize: 13, color: colors.text, fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontFamily: fonts.heading, fontSize: 18, lineHeight: 1, letterSpacing: 0.5 }}>
          #{rank}
        </span>
        {change !== 0 && (
          <span title={change > 0 ? `Up ${change} from last week` : `Down ${Math.abs(change)} from last week`} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
            color: arrowColor,
          }}>
            <span style={{ fontSize: 10 }}>{arrow}</span>
            {Math.abs(change)}
          </span>
        )}
        {compositePts && (
          <span style={{
            fontFamily: fonts.condensed, fontSize: 10, fontWeight: 600,
            color: colors.textMuted, letterSpacing: 0.3,
          }}>
            {compositePts} PTS
          </span>
        )}
      </div>
    </div>
  );
}

// Compact "HT/WT" style stat row with bold value on the right.
function VitalRow({ label, value, dot }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0', borderBottom: `1px solid ${colors.divider}` }}>
      <div style={{
        fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
        color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
        width: 76, flexShrink: 0,
      }}>{label}</div>
      <div style={{
        fontFamily: fonts.body, fontSize: 13, color: colors.text, fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {dot && <span style={{
          width: 8, height: 8, borderRadius: '50%', background: dot,
        }} />}
        {value || <span style={{ color: colors.textMuted, fontWeight: 400 }}>—</span>}
      </div>
    </div>
  );
}

// Season stats compact card — 4 KPIs with tiny league-rank labels.
function SeasonStatsCard({ player, team, battingRanks, pitchingRanks, bTotal, pTotal }) {
  // Pick 4 headline stats + ranks — batting first if they hit, else pitching.
  const isPitcher = !!player.pitching && !player.batting;
  const tiles = isPitcher
    ? [
        { label: 'ERA',  value: player.pitching?.era,  rank: pitchingRanks?.era,  total: pTotal },
        { label: 'WHIP', value: player.pitching?.whip, rank: pitchingRanks?.whip, total: pTotal },
        { label: 'K/4',  value: player.pitching?.k4,   rank: pitchingRanks?.k4,   total: pTotal, highlight: true },
        { label: 'BB/4', value: player.pitching?.bb4,  rank: pitchingRanks?.bb4,  total: pTotal },
      ]
    : [
        { label: 'AVG',  value: player.batting?.avg,      rank: battingRanks?.avg,      total: bTotal },
        { label: 'HR',   value: player.batting?.hr,       rank: battingRanks?.hr,       total: bTotal },
        { label: 'RBI',  value: player.batting?.rbi,      rank: battingRanks?.rbi,      total: bTotal },
        { label: 'OPS+', value: player.batting?.ops_plus, rank: battingRanks?.ops_plus, total: bTotal, highlight: true },
      ];

  return (
    <div style={{
      // Now that the tier-badge column is gone, the stats card gets the
      // breathing room. Larger min-width + flex basis so it can expand
      // into what used to be column 4.
      minWidth: 280,
      flex: '1 1 280px',
      background: colors.white,
      border: `1px solid ${colors.borderLight}`,
      borderRadius: radius.base,
      overflow: 'hidden',
      boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
    }}>
      <div style={{
        background: `linear-gradient(135deg, ${team.color}, ${team.dark})`,
        color: '#fff',
        padding: '10px 14px',
        fontFamily: fonts.condensed, fontSize: 12, fontWeight: 700,
        letterSpacing: 1.4, textAlign: 'center', textTransform: 'uppercase',
      }}>
        2026 Season Stats
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        padding: '16px 8px', gap: 4,
      }}>
        {tiles.map(t => (
          <div key={t.label} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: '2px 4px',
          }}>
            <div style={{
              fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
              color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
            }}>{t.label}</div>
            <div style={{
              fontFamily: fonts.heading, fontSize: 34,
              color: t.highlight ? colors.red : colors.text,
              lineHeight: 1, letterSpacing: 0.5,
            }}>{t.value ?? '—'}</div>
            <div style={{
              fontFamily: fonts.condensed, fontSize: 10, fontWeight: 600,
              color: colors.textMuted, letterSpacing: 0.4,
            }}>
              {t.rank ? `#${t.rank} / ${t.total}` : '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Admin-only photo picker modal. Renders every piece of media for the
// team in a grid so the admin can click any asset — headshot, action
// shot, even a team photo — as this player's profile circle. "Reset to
// default" clears the override so the default HEADSHOT heuristic
// resumes. Closes on background click, ESC, or after a successful pick.
function PhotoPicker({ team, teamMedia, mediaUrls, currentId, onClose, onPick, saving }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Split media by asset-type group so the picker reads "Headshots on
  // top, action shots, then team photos" — easier to scan at a glance.
  const groups = {};
  for (const m of teamMedia) {
    const k = m.assetType || 'FILE';
    (groups[k] = groups[k] || []).push(m);
  }
  // Preferred order so headshots surface first
  const orderedKeys = ['HEADSHOT', 'PORTRAIT', 'ACTION', 'ACTION2', 'HIGHLIGHT', 'HIGHLIGHT2', 'INTERVIEW', 'TEAMPHOTO', 'VENUE', 'LOGO_PRIMARY', 'LOGO_DARK', 'LOGO_LIGHT', 'LOGO_ICON', 'WORDMARK', 'FILE'];
  const sortedKeys = [
    ...orderedKeys.filter(k => groups[k]?.length),
    ...Object.keys(groups).filter(k => !orderedKeys.includes(k)),
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 820, maxHeight: '85vh',
          background: colors.white, borderRadius: radius.lg,
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: 18, borderBottom: `1px solid ${colors.borderLight}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <TeamLogo teamId={team.id} size={28} rounded="square" />
          <div style={{ flex: 1 }}>
            <h2 style={{ fontFamily: fonts.heading, fontSize: 22, margin: 0, letterSpacing: 1.2, fontWeight: 400 }}>
              Choose profile photo
            </h2>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
              Pick any asset uploaded for {team.name}. Click outside or press ESC to cancel.
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 22, color: colors.textSecondary, padding: '2px 6px',
          }}>✕</button>
        </div>

        {/* Grid */}
        <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
          {teamMedia.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: colors.textSecondary, fontSize: 13 }}>
              No media uploaded for {team.name} yet. Go to <strong>Files</strong> to add some.
            </div>
          )}
          {sortedKeys.map(key => (
            <div key={key} style={{ marginBottom: 20 }}>
              <div style={{
                fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
                marginBottom: 8,
              }}>
                {key} ({groups[key].length})
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8,
              }}>
                {groups[key].map(m => {
                  const url = mediaUrls[m.id];
                  const active = m.id === currentId;
                  return (
                    <button
                      key={m.id}
                      onClick={() => !saving && onPick(m.id)}
                      disabled={saving}
                      title={m.name}
                      style={{
                        display: 'flex', flexDirection: 'column',
                        padding: 0, border: `2px solid ${active ? colors.red : colors.borderLight}`,
                        borderRadius: radius.base, overflow: 'hidden',
                        background: colors.white, cursor: saving ? 'wait' : 'pointer',
                        boxShadow: active ? `0 0 0 2px ${colors.redBorder}` : 'none',
                        transition: 'all 0.12s',
                      }}
                    >
                      <div style={{
                        width: '100%', aspectRatio: '1 / 1',
                        background: url
                          ? `url(${url}) center/cover`
                          : `linear-gradient(135deg, ${team.color}30, ${team.color}10)`,
                      }} />
                      <div style={{
                        padding: '4px 6px', fontSize: 10, fontFamily: fonts.condensed,
                        color: colors.text, textAlign: 'left',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{m.name}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: 14, borderTop: `1px solid ${colors.borderLight}`,
          display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          <OutlineButton onClick={() => !saving && onPick(null)} disabled={saving}>
            Reset to default
          </OutlineButton>
          <OutlineButton onClick={onClose} disabled={saving}>
            Cancel
          </OutlineButton>
        </div>
      </div>
    </div>
  );
}

function PlayerHero({ player, team, avatarUrl, playerRank, battingRanks, pitchingRanks, bTotal, pTotal, generateHref, canEditPhoto, onEditPhoto }) {
  // Vitals — pull from whatever the merged player object carries. All optional.
  const v = player.vitals || {};
  const height = formatHeight(v.heightIn);
  const weight = v.weightLbs ? `${v.weightLbs} lbs` : null;
  const htWt = height && weight ? `${height}, ${weight}` : height || weight || null;
  const birth = formatBirthdate(v.birthdate);
  const bats = v.bats ? ({ R: 'Right', L: 'Left', S: 'Switch' }[v.bats] || v.bats) : null;
  const throws = v.throws ? ({ R: 'Right', L: 'Left' }[v.throws] || v.throws) : null;
  const batThrow = bats && throws ? `${bats}/${throws}` : (bats || throws || null);
  const birthplace = v.birthplace || null;
  const status = v.status || 'active';
  const statusColor = status === 'active' ? colors.success : status === 'injured' ? colors.warning : colors.textMuted;
  const statusLabel = status === 'active' ? 'Active' : status === 'injured' ? 'Injured' : 'Inactive';

  const position = player.batting && player.pitching
    ? 'Two-Way Player'
    : player.batting ? 'Batter'
    : player.pitching ? 'Pitcher'
    : (player.position || '—');

  // Split "Josh Jung" → first name + last name for stacked layout. If we
  // only got a last name (roster-only records), show just the lastName.
  const parts = (player.name || player.lastName || '').split(/\s+/);
  const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
  const lastNameDisplay = parts.length > 1 ? parts[parts.length - 1] : parts[0];

  return (
    <div style={{
      background: colors.white,
      border: `1px solid ${colors.borderLight}`,
      borderLeft: `4px solid ${team.color}`,
      borderRadius: radius.lg,
      // Subtle two-layer drop shadow — gives the hero card a bit of lift
      // off the page without going full Material-raised. The wider, softer
      // outer layer does the ambient feel; the tighter inner layer sharpens
      // the edge on the sides of the card.
      boxShadow: '0 8px 24px rgba(17,24,39,0.08), 0 2px 6px rgba(17,24,39,0.05)',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Subtle team gradient wash on the left pane */}
      <div style={{
        position: 'absolute', top: 0, left: 0, width: 240, height: '100%',
        background: `linear-gradient(135deg, ${team.color}18, ${team.color}04 70%, transparent)`,
        pointerEvents: 'none',
      }} />
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 24,
        padding: 22,
        alignItems: 'center',
        position: 'relative',
      }}>
        {/* Col 1 — Profile + name + team chip. flex:1 so name breathes if there's space. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flex: '2 1 300px', minWidth: 260 }}>
          {/* Profile circle — wrapped in position:relative so the tier
              badge can overlay on the bottom-right. Circle bumped to
              128px to give the 80px tier badge more landing room without
              eating too much of the photo/initials. */}
          <div style={{ position: 'relative', flexShrink: 0, width: 128, height: 128 }}>
            <div style={{
              width: 128, height: 128, borderRadius: radius.full,
              background: avatarUrl
                ? `url(${avatarUrl}) center/cover`
                : `linear-gradient(135deg, ${team.color}, ${team.dark})`,
              color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: fonts.heading, fontSize: 46, letterSpacing: 1,
              border: `3px solid ${team.color}`,
              boxShadow: '0 4px 14px rgba(0,0,0,0.14)',
            }}>
              {!avatarUrl && (player.lastName || '??').slice(0, 2).toUpperCase()}
            </div>
            {/* Admin-only pencil icon at top-left of the circle. Opens
                the photo picker modal. Tier badge sits at bottom-right,
                so these two never collide. */}
            {canEditPhoto && (
              <button
                onClick={onEditPhoto}
                title="Change profile photo"
                style={{
                  position: 'absolute',
                  top: -4, left: -4,
                  width: 32, height: 32, borderRadius: radius.full,
                  background: colors.white,
                  border: `2px solid ${team.color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                  fontSize: 14, lineHeight: 1,
                  padding: 0,
                }}
              >
                ✎
              </button>
            )}
            {/* Tier badge — overlaid at the 4:30 perimeter point.
                Geometry: circle 128 (radius 64), badge 96. Its CENTER
                sits on the circle perimeter at 45° which is (cos45° × 64,
                sin45° × 64) ≈ (45, 45) from the circle center. So the
                badge top-left offsets (64 + 45 − 48, 64 + 45 − 48) ≈
                (61, 61), i.e. bottom: -29, right: -29 from the 128px
                wrapper. Drop shadow lifts it off either a photo or a
                colored gradient. */}
            {playerRank && (
              <div style={{
                position: 'absolute',
                bottom: -29, right: -29,
                filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.28))',
                pointerEvents: 'none',
              }}>
                <TierBadge rank={playerRank} size={96} />
              </div>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            {firstName && (
              <div style={{
                fontFamily: fonts.heading,
                fontSize: 30, lineHeight: 0.9,
                color: colors.text, letterSpacing: 'var(--font-heading-tracking, 1.5px)',
                textTransform: 'uppercase',
              }}>{firstName}</div>
            )}
            <div style={{
              fontFamily: fonts.heading,
              fontSize: 38, lineHeight: 0.9,
              color: colors.text, letterSpacing: 'var(--font-heading-tracking, 1.5px)',
              textTransform: 'uppercase',
              marginTop: firstName ? 2 : 0,
            }}>{lastNameDisplay}</div>

            {/* Team + jersey + position row */}
            <div style={{
              marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            }}>
              <TeamLogo teamId={team.id} size={18} rounded="square" />
              <span style={{
                fontFamily: fonts.body, fontSize: 12, color: colors.text, fontWeight: 700,
              }}>{team.name}</span>
              <span style={{ color: colors.textMuted, fontSize: 11 }}>·</span>
              <span style={{
                fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                color: colors.textSecondary, letterSpacing: 0.5,
              }}>
                {player.num ? `#${player.num}` : 'NO #'}
              </span>
              <span style={{ color: colors.textMuted, fontSize: 11 }}>·</span>
              <span style={{
                fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                color: colors.textSecondary, letterSpacing: 0.5,
              }}>{position}</span>
              {/* Composite rank chip — pulls from the league-wide composite
                  rankings feed. Surfaces the number right next to the tier
                  badge's visual tier so a scanner can read "OH, they're
                  #19 league-wide, that's the real context." */}
              {playerRank && (
                <>
                  <span style={{ color: colors.textMuted, fontSize: 11 }}>·</span>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800, letterSpacing: 0.8,
                    padding: '2px 8px', borderRadius: radius.full,
                    background: `${team.color}18`, color: team.color,
                    border: `1px solid ${team.color}40`,
                    textTransform: 'uppercase',
                  }}>
                    <span style={{ fontFamily: fonts.heading, fontSize: 12, lineHeight: 1 }}>
                      #{playerRank}
                    </span>
                    <span>Composite</span>
                  </span>
                </>
              )}
            </div>

            {/* Generate CTA */}
            <div style={{ marginTop: 12 }}>
              <Link to={generateHref} style={{ textDecoration: 'none' }}>
                <RedButton style={{ padding: '8px 16px', fontSize: 12 }}>
                  ✦ Generate Stat Post
                </RedButton>
              </Link>
            </div>
          </div>
        </div>

        {/* Col 2 — Vital stats */}
        <div style={{ flex: '1 1 200px', minWidth: 200 }}>
          <VitalRow label="HT/WT" value={htWt} />
          <VitalRow label="Birthdate" value={birth} />
          <VitalRow label="Bat/Thr" value={batThrow} />
          <VitalRow label="Birthplace" value={birthplace} />
          <VitalRow label="Status" value={statusLabel} dot={statusColor} />
          {/* League rank — shown prominently in vitals so a viewer
              sees composite standing alongside physical profile.
              Renders arrow + delta when rank changed this week. */}
          <LeagueRankRow ranking={player.ranking} />
        </div>

        {/* Col 3 — Season stats */}
        <SeasonStatsCard
          player={player} team={team}
          battingRanks={battingRanks} pitchingRanks={pitchingRanks}
          bTotal={bTotal} pTotal={pTotal}
        />

      </div>
    </div>
  );
}

// Single stat tile: value on top, label + league rank chip below
function StatTile({ label, value, rank, total, highlight }) {
  return (
    <div style={{
      padding: '12px 10px',
      background: colors.bg,
      borderRadius: radius.sm,
      border: highlight ? `1px solid ${colors.redBorder}` : `1px solid ${colors.borderLight}`,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{
        fontFamily: fonts.heading, fontSize: 26, letterSpacing: 0.5,
        color: highlight ? colors.red : colors.text, lineHeight: 1,
      }}>{value ?? '—'}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700, color: colors.textMuted, letterSpacing: 0.8 }}>{label}</span>
        <RankChip rank={rank} total={total} />
      </div>
    </div>
  );
}

export default function PlayerPage() {
  const { slug, lastName } = useParams();
  const team = getTeam(slug);
  const toast = useToast();
  const { role } = useAuth();
  const isAdmin = isAdminRole(role);

  const [player, setPlayer] = useState(null);
  const [media, setMedia] = useState([]);
  // Full team media (all players + team-scoped assets) for the photo picker.
  // Lazy-loaded the first time the picker opens, then kept in state.
  const [teamMedia, setTeamMedia] = useState([]);
  const [battingLeaders, setBattingLeaders] = useState([]);
  const [pitchingLeaders, setPitchingLeaders] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);

  useEffect(() => {
    let cancel = false;
    if (!team?.id) return;
    // Load stats AND team roster AND manual players in parallel
    Promise.all([fetchAllData(), fetchTeamRosterFromApi(team.id), getManualPlayersByTeam(team.id)])
      .then(async ([allData, , manualList]) => {
        if (cancel) return;
        setBattingLeaders(allData.batting || []);
        setPitchingLeaders(allData.pitching || []);
        const p = getPlayerByTeamLastName(team.id, lastName, manualList);
        if (p) {
          // Media match uses team + lastName, disambiguated by first initial
          // when the player has one (handles Logan Rose vs Carson Rose). Legacy
          // records with no firstInitial still surface — see findPlayerMedia.
          const m = await findPlayerMedia(team.id, p.lastName, {
            firstInitial: p.firstInitial,
          });
          if (cancel) return;
          // Source jersey from first uploaded media file if available
          const mediaJersey = m.find(x => x.num)?.num || '';
          setPlayer({ ...p, num: p.num || mediaJersey });
          setMedia(m);
        } else {
          setPlayer(null);
        }
        setLoaded(true);
      });
    return () => { cancel = true; };
  }, [team?.id, lastName]);

  // Blob URLs for BOTH player-scoped media AND any team media that was
  // loaded for the photo picker. Dedup by id so a single url cache
  // serves every render (profile circle, gallery, picker tile).
  const mediaUrls = useMemo(() => {
    const urls = {};
    const seen = new Set();
    const addAll = (list) => {
      for (const m of list) {
        if (!m || seen.has(m.id)) continue;
        seen.add(m.id);
        if (m.blob) urls[m.id] = blobToObjectURL(m.blob);
      }
    };
    addAll(media);
    addAll(teamMedia);
    return urls;
  }, [media, teamMedia]);

  if (!team) {
    return (
      <Card style={{ textAlign: 'center', padding: 40 }}>
        <SectionHeading>Team not found</SectionHeading>
        <Link to="/studio" style={{ color: colors.red, textDecoration: 'none' }}>← Back to Dashboard</Link>
      </Card>
    );
  }

  if (!loaded) {
    return <Card style={{ padding: 30, textAlign: 'center', color: colors.textMuted }}>Loading player…</Card>;
  }

  if (!player) {
    return (
      <Card style={{ textAlign: 'center', padding: 40 }}>
        <SectionHeading>Player not found</SectionHeading>
        <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12 }}>
          No stats or roster data for "{lastName}" on {team.name}.
        </div>
        <Link to={`/teams/${team.slug}`} style={{ color: colors.red, textDecoration: 'none' }}>
          ← Back to {team.name}
        </Link>
      </Card>
    );
  }

  // Legacy slug resolved but multiple players share this lastname — warn so
  // the user knows to use the new first-initial link on the team page.
  const ambiguityBanner = player.ambiguous ? (
    <div style={{
      background: '#FEF3C7', color: '#92400E',
      border: '1px solid #FDE68A', borderRadius: radius.sm,
      padding: '10px 14px', fontSize: 13, fontFamily: fonts.body,
    }}>
      ⚠︎ {player.candidateCount} players on {team.name} share the lastname "{player.lastName}". Showing <strong>{player.name}</strong> — use the roster on the team page for a direct link to each player.
    </div>
  ) : null;

  // Group media by asset type
  const grouped = media.reduce((acc, m) => {
    const k = m.assetType || 'FILE';
    (acc[k] = acc[k] || []).push(m);
    return acc;
  }, {});

  // Build Generate CTA URL with pre-filled fields
  const generateParams = new URLSearchParams();
  generateParams.set('template', 'player-stat');
  generateParams.set('team', team.id);
  generateParams.set('platform', 'feed');
  generateParams.set('playerName', player.name);
  if (player.num) generateParams.set('number', player.num);
  const statLine = buildStatLine(player);
  if (statLine) generateParams.set('statLine', statLine);

  // Avatar resolution: admin-picked override wins (player.profileMediaId
  // points at a specific media.id from THIS or ANY team asset). Fall
  // back to the first HEADSHOT/PORTRAIT in this player's media set.
  const overrideMedia = player.profileMediaId
    ? ([...media, ...teamMedia].find(m => m.id === player.profileMediaId) || null)
    : null;
  const headshot = overrideMedia
    || media.find(m => m.assetType === 'HEADSHOT' || m.assetType === 'PORTRAIT');
  const avatarUrl = headshot ? mediaUrls[headshot.id] : null;

  // Open the photo picker — lazy-load the team's media the first time so
  // we don't fetch every team's blobs on every player page view.
  const openPhotoPicker = useCallback(async () => {
    if (teamMedia.length === 0) {
      try {
        const tm = await findTeamMedia(team.id);
        setTeamMedia(tm || []);
      } catch (err) {
        console.warn('findTeamMedia failed', err);
      }
    }
    setPhotoPickerOpen(true);
  }, [team?.id, teamMedia.length]);

  // Write the profile_media_id override and update local state so the
  // new avatar renders immediately without a round-trip refetch.
  const choosePhoto = useCallback(async (mediaId) => {
    if (!team?.id || !player?.lastName) return;
    setSavingPhoto(true);
    try {
      await upsertManualPlayer({
        team: team.id,
        lastName: player.lastName,
        firstInitial: player.firstInitial,
        firstName: player.firstName,
        num: player.num,
        updates: { profile_media_id: mediaId || null },
      });
      setPlayer(prev => prev ? { ...prev, profileMediaId: mediaId || null } : prev);
      toast.success(mediaId ? 'Profile photo updated' : 'Profile photo reset');
      setPhotoPickerOpen(false);
    } catch (err) {
      toast.error('Failed to save', { detail: err.message?.slice(0, 80) });
    } finally {
      setSavingPhoto(false);
    }
  }, [team?.id, player?.lastName, player?.firstInitial, player?.firstName, player?.num, toast]);

  // ─── Per-stat league-rank lookups ────────────────────────────────────────
  // Rank this player against all BLW batters/pitchers for each displayed stat
  const bTotal = battingLeaders.length;
  const pTotal = pitchingLeaders.length;
  const pn = player.name;
  const battingRanks = player.batting ? {
    avg:      rankOf(battingLeaders, pn, 'avg',      'desc', parseFloat),
    hits:     rankOf(battingLeaders, pn, 'hits',     'desc', Number),
    hr:       rankOf(battingLeaders, pn, 'hr',       'desc', Number),
    rbi:      rankOf(battingLeaders, pn, 'rbi',      'desc', Number),
    obp:      rankOf(battingLeaders, pn, 'obp',      'desc', parseFloat),
    ops_plus: rankOf(battingLeaders, pn, 'ops_plus', 'desc', Number),
  } : null;
  const pitchingRanks = player.pitching ? {
    era:  rankOf(pitchingLeaders, pn, 'era',  'asc',  parseFloat),
    whip: rankOf(pitchingLeaders, pn, 'whip', 'asc',  parseFloat),
    k4:   rankOf(pitchingLeaders, pn, 'k4',   'desc', parseFloat),
    bb4:  rankOf(pitchingLeaders, pn, 'bb4',  'asc',  parseFloat),
  } : null;

  const playerRank = player.ranking?.currentRank || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {ambiguityBanner}

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: fonts.condensed }}>
        <Link to={`/teams/${team.slug}`} style={{
          color: colors.red, textDecoration: 'none', fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          <span>←</span>
          <TeamLogo teamId={team.id} size={20} rounded="square" />
          {team.name.toUpperCase()}
        </Link>
      </div>

      {/* Player Header — ESPN-style 4-column layout.
          Left: profile circle + name + team chip + position
          Middle: vitals (HT/WT, birthdate, bats/throws, birthplace, status)
          Right: season stats card with league ranks
          Tier badge floats at top-right of the name column. */}
      <PlayerHero
        player={player}
        team={team}
        avatarUrl={avatarUrl}
        playerRank={playerRank}
        battingRanks={battingRanks}
        pitchingRanks={pitchingRanks}
        bTotal={bTotal}
        pTotal={pTotal}
        generateHref={`/generate?${generateParams.toString()}`}
        canEditPhoto={isAdmin}
        onEditPhoto={openPhotoPicker}
      />

      {/* Admin-only profile-picture picker modal. Shows the full set of
          team media with the current selection highlighted. "Reset" goes
          back to the default headshot heuristic. */}
      {photoPickerOpen && (
        <PhotoPicker
          team={team}
          teamMedia={teamMedia}
          mediaUrls={mediaUrls}
          currentId={player.profileMediaId || headshot?.id || null}
          onClose={() => !savingPhoto && setPhotoPickerOpen(false)}
          onPick={choosePhoto}
          saving={savingPhoto}
        />
      )}

      {/* Stats Cards — curated set with per-stat league rank */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        {player.batting && (
          <Card>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
              <SectionHeading style={{ margin: 0 }}>Batting</SectionHeading>
              <span style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 0.5 }}>
                Rank across {bTotal} BLW batters
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <StatTile label="AVG"  value={player.batting.avg}       rank={battingRanks?.avg}      total={bTotal} />
              <StatTile label="H"    value={player.batting.hits}      rank={battingRanks?.hits}     total={bTotal} />
              <StatTile label="HR"   value={player.batting.hr}        rank={battingRanks?.hr}       total={bTotal} />
              <StatTile label="RBI"  value={player.batting.rbi}       rank={battingRanks?.rbi}      total={bTotal} />
              <StatTile label="OBP"  value={player.batting.obp}       rank={battingRanks?.obp}      total={bTotal} />
              <StatTile label="OPS+" value={player.batting.ops_plus}  rank={battingRanks?.ops_plus} total={bTotal} highlight />
            </div>
          </Card>
        )}
        {player.pitching && (
          <Card>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
              <SectionHeading style={{ margin: 0 }}>Pitching</SectionHeading>
              <span style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 0.5 }}>
                Rank across {pTotal} BLW pitchers
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              <StatTile label="ERA"  value={player.pitching.era}  rank={pitchingRanks?.era}  total={pTotal} />
              <StatTile label="WHIP" value={player.pitching.whip} rank={pitchingRanks?.whip} total={pTotal} />
              <StatTile label="K/4"  value={player.pitching.k4}   rank={pitchingRanks?.k4}   total={pTotal} highlight />
              <StatTile label="BB/4" value={player.pitching.bb4}  rank={pitchingRanks?.bb4}  total={pTotal} />
            </div>
          </Card>
        )}
      </div>

      {/* Media Gallery */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionHeading style={{ margin: 0 }}>Media</SectionHeading>
          <span style={{ fontFamily: fonts.condensed, fontSize: 11, color: colors.textMuted }}>
            {media.length} ASSET{media.length !== 1 ? 'S' : ''}
          </span>
        </div>
        {media.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
            No media uploaded for {player.name} yet.
            <br />
            <Link to="/files" style={{ color: colors.red, textDecoration: 'none', fontWeight: 700 }}>
              Upload in Files →
            </Link>
          </div>
        )}
        {media.length > 0 && Object.entries(grouped).map(([type, items]) => (
          <div key={type} style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, color: colors.textMuted, letterSpacing: 1, marginBottom: 6 }}>
              {type} ({items.length})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
              {items.map(m => (
                <div key={m.id} style={{
                  borderRadius: radius.base, overflow: 'hidden',
                  border: `1px solid ${colors.borderLight}`,
                }}>
                  <div style={{
                    width: '100%', height: 120,
                    background: mediaUrls[m.id] ? `url(${mediaUrls[m.id]}) center/cover` : `linear-gradient(135deg, ${team.color}22, ${team.color}08)`,
                  }} />
                  <div style={{
                    padding: 6, fontSize: 10, fontFamily: fonts.condensed,
                    color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{m.name}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
