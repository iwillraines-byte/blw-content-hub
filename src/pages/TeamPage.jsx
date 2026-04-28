import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TEAMS, getTeam, slugify, playerSlug, fetchAllData, fetchTeamRosterFromApi, fetchGames, BATTING_LEADERS, PITCHING_LEADERS, isOnActiveRoster, canonicalTeamOf, canonicalNumOf, resolveCanonicalName, CANONICAL_ROSTER_2026, applyCanonicalToStats } from '../data';
import { BattingTable, PitchingTable } from '../stats-tables';
import { TierBadge } from '../tier-badges';
import { ContentCalendar } from '../content-calendar';
import { Card, PageHeader, SectionHeading, RedButton, OutlineButton, TeamLogo, PositionedAvatar, inputStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { findTeamMedia, getAllMedia, resolvePlayerAvatar, blobToObjectURL } from '../media-store';
import { getManualPlayersByTeam, getAllManualPlayers, savePlayer, deletePlayer } from '../player-store';

export default function TeamPage() {
  const { slug } = useParams();
  const team = getTeam(slug);

  const [media, setMedia] = useState([]);
  const [roster, setRoster] = useState([]);
  const [manualPlayers, setManualPlayers] = useState([]);
  // Live batting + pitching — populated by fetchAllData() below so the
  // team-filtered stats tables don't have to hit the API twice.
  const [batting, setBatting] = useState([]);
  const [pitching, setPitching] = useState([]);
  const [rankings, setRankings] = useState([]);
  const [games, setGames] = useState([]);
  // Avatars keyed by "FI|LASTNAME" (e.g. "C|ROSE") so same-lastname players
  // each get their own headshot. Legacy records without a firstInitial are
  // keyed by "|LASTNAME" and used as a fallback.
  const [rosterAvatars, setRosterAvatars] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayerFirst, setNewPlayerFirst] = useState('');
  const [newPlayerLast, setNewPlayerLast] = useState('');
  const [newPlayerNum, setNewPlayerNum] = useState('');
  const [newPlayerPosition, setNewPlayerPosition] = useState('');

  const rebuildRoster = useCallback((apiRoster, teamMedia, manualList, allManual = manualList) => {
    // Identity key: "FI|LASTNAME" (uppercase) — lets Logan Rose and Carson Rose
    // coexist on the same roster. Legacy records without a firstInitial use "|LASTNAME".
    const identityKey = (fi, ln) => `${String(fi || '').toUpperCase()}|${String(ln || '').toUpperCase()}`;

    // Cross-team override index — a manual_players row whose team !== this
    // team means the player has been TRADED away (or otherwise reassigned)
    // and shouldn't appear in this team's roster even if they're still in
    // the API's apiRoster for this team. Build a Set keyed by identity.
    const tradedAwayKeys = new Set();
    for (const p of allManual) {
      if (!p?.team || p.team === team.id) continue;
      const fi = (p.firstName || '').charAt(0).toUpperCase();
      tradedAwayKeys.add(identityKey(fi, p.lastName));
      tradedAwayKeys.add(identityKey('', p.lastName));  // legacy/fallback
    }

    // Only consider player-scoped media when building the roster.
    const playerMedia = teamMedia.filter(m => (m.scope || 'player') === 'player');

    // Jersey lookup from media filenames — prefer (initial + lastname) key;
    // fall back to lastname-only for legacy records.
    const jerseyByKey = {};
    for (const m of playerMedia) {
      if (!m.player || !m.num) continue;
      const key = identityKey(m.firstInitial, m.player);
      if (!jerseyByKey[key]) jerseyByKey[key] = m.num;
      const legacyKey = identityKey('', m.player);
      if (!jerseyByKey[legacyKey]) jerseyByKey[legacyKey] = m.num;
    }
    for (const p of manualList) {
      const fi = (p.firstName || '').charAt(0).toUpperCase();
      const k = identityKey(fi, p.lastName);
      if (p.num && !jerseyByKey[k]) jerseyByKey[k] = p.num;
    }

    const taken = new Set();
    const entries = [];

    // API roster — use first-initial for identity so duplicates don't collide.
    // Skip anyone who's been traded away via a manual override OR isn't on
    // the canonical 2026 active roster (filters out FAs + dev-league
    // residue that the API still surfaces).
    for (const p of apiRoster) {
      const fi = (p.firstName || '').charAt(0).toUpperCase();
      const key = identityKey(fi, p.lastName);
      const legacyKey = identityKey('', p.lastName);
      if (tradedAwayKeys.has(key) || tradedAwayKeys.has(legacyKey)) continue;
      const fullName = p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim();
      if (!isOnActiveRoster(fullName)) continue;
      // If the canonical roster puts them on a DIFFERENT team than the
      // API + no override exists, defer to canonical (skip here, the
      // canonical-team holder will pick them up).
      const canonTeam = canonicalTeamOf(fullName);
      if (canonTeam && canonTeam !== team.id) continue;
      taken.add(key);
      // Canonical num wins over media-derived num because the
      // jerseyByKey map collides on FI+lastname (Logan/Luke Rose
      // both key to "L|ROSE"). Canonical roster is the single
      // source of truth for jersey numbers; the rest are fillers.
      entries.push({
        ...p,
        firstInitial: fi,
        num: canonicalNumOf(fullName) || p.num || jerseyByKey[key] || jerseyByKey[legacyKey] || '',
        source: 'api',
      });
    }

    // Players the canonical roster places on THIS team but the API
    // doesn't (e.g. Konnor Jaso → LV) come through via the manualList
    // loop below — the trades preset creates manual_players rows for
    // every override, so the canonical-team-mismatch case is covered.

    // Manual players not already represented in the API roster.
    // Strictly canonical-only: a manual_players row for someone who
    // ISN'T on the canonical active roster (e.g. cut player whose
    // Supabase row never got removed, leftover bio-CSV import) must
    // not surface on a team page. This is what filters out Braden
    // Eberhardt + Gabriel Carr (MIA), Dan Whitener (LV), and any
    // similar stragglers that pre-date the canonical authority model.
    for (const p of manualList) {
      const fi = (p.firstName || '').charAt(0).toUpperCase();
      const key = identityKey(fi, p.lastName);
      if (taken.has(key)) continue;
      const fullName = p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim();
      if (!isOnActiveRoster(fullName)) continue;
      taken.add(key);
      entries.push({
        manualId: p.id,
        playerId: null,
        name: p.name,
        firstName: p.firstName,
        firstInitial: fi,
        lastName: p.lastName,
        team: p.team,
        // Canonical num overrides any stale manual_players value.
        num: canonicalNumOf(fullName) || p.num || '',
        position: p.position,
        isPitcher: /p/i.test(p.position),
        isBatter: /b|h|c|of|if/i.test(p.position),
        manual: true,
        source: 'manual',
      });
    }

    // Media-only players (not in API, not manually added). Filtered against
    // the canonical lastname set so a media file tagged for a free-agent
    // doesn't conjure them onto the roster.
    const canonicalLastNames = new Set();
    for (const e of entries) canonicalLastNames.add(e.lastName.toUpperCase());
    for (const m of playerMedia) {
      if (!m.player || m.player === 'TEAM' || m.player === 'LEAGUE') continue;
      const fi = (m.firstInitial || '').toUpperCase();
      const key = identityKey(fi, m.player);
      if (taken.has(key)) continue;
      // Drop media tagged for a lastname that isn't on this team's
      // already-built roster (which respects canonical + overrides).
      if (!canonicalLastNames.has(String(m.player).toUpperCase())) continue;
      // Don't create a media-only player if the same lastname already exists
      // via API under a *different* initial — that's likely the same person
      // whose file was tagged before the initial convention existed.
      const lastnameAlreadyInRoster = entries.some(
        e => e.lastName.toUpperCase() === m.player && (!fi || !e.firstInitial || e.firstInitial === fi)
      );
      if (lastnameAlreadyInRoster && !fi) continue;
      taken.add(key);
      const pretty = m.player.charAt(0) + m.player.slice(1).toLowerCase();
      entries.push({
        playerId: null,
        name: fi ? `${fi}. ${pretty}` : pretty,
        firstName: fi,
        firstInitial: fi,
        lastName: pretty,
        team: team.id,
        num: m.num || '',
        isPitcher: false, isBatter: false, mediaOnly: true, source: 'media',
      });
    }

    // Canonical roster injection — guarantee every league-confirmed
    // player on this team appears, even if no API stats / no media yet.
    // Dedup by FULL NAME (not FI + lastname) — same-FI cousins
    // (Justin + James Lee on LV both have FI 'J', the three Roses
    // on DAL, all Skibbes / Dalbeys / Marshalls etc.) need their own
    // entry. Composite-key dedup misses these.
    const fullNameSeen = new Set(
      entries.map(e => `${e.firstName || ''} ${e.lastName || ''}`.trim().toLowerCase())
    );
    for (const c of CANONICAL_ROSTER_2026) {
      if (c.team !== team.id) continue;
      const lastName = c.name.split(' ').pop();
      const firstName = c.name.split(' ').slice(0, -1).join(' ');
      const fi = firstName.charAt(0).toUpperCase();
      const fullKey = c.name.toLowerCase();
      if (fullNameSeen.has(fullKey)) continue;
      fullNameSeen.add(fullKey);
      entries.push({
        playerId: null,
        name: c.name,
        firstName,
        firstInitial: fi,
        lastName,
        team: team.id,
        // Surface the canonical jersey number when it's set on the
        // entry (Logan #08, Luke #05, etc). Without this, every
        // canonical-only injection rendered as "no jersey".
        num: c.num || '',
        isPitcher: false,
        isBatter: false,
        canonical: true,
        source: 'canonical',
      });
    }

    // Defensive dedup — belt-and-braces in case sources overlap. Use
    // full-name match (firstName + lastName) so two players sharing
    // BOTH first initial and last name (Justin Lee + James Lee) don't
    // collapse into one. Falls back to FI + lastName when firstName
    // is missing (legacy media-only entries).
    const seen = new Set();
    const deduped = entries.filter(p => {
      const fullName = `${p.firstName || ''} ${p.lastName || ''}`.trim().toLowerCase();
      const key = fullName || identityKey(p.firstInitial, p.lastName);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const onlyThisTeam = deduped.filter(p => !p.team || p.team === team.id);
    return onlyThisTeam.sort((a, b) => a.lastName.localeCompare(b.lastName));
  }, [team?.id]);

  useEffect(() => {
    let cancel = false;
    if (!team?.id) return;

    // Clear previous team's data immediately so the user never sees the wrong roster
    setRoster([]);
    setMedia([]);
    setManualPlayers([]);
    setRosterAvatars({});
    setLoaded(false);

    Promise.all([
      fetchAllData(),
      fetchTeamRosterFromApi(team.id),
      findTeamMedia(team.id),
      // Pull EVERY manual_players row, not just this team's, so trade
      // overrides resolve correctly (a Livingston traded to PHI needs
      // to be EXCLUDED from DAL's roster while still in batting cache).
      getAllManualPlayers(),
      fetchGames(),
      // Pull every media record so an admin-picked profile pic can be
      // used as the roster avatar even when the chosen photo lives in
      // another team's bucket (e.g. a HEADSHOT carried over from a
      // previous team after a trade).
      getAllMedia(),
    ]).then(([liveData, apiRoster, teamMedia, allManual, gameList, allMedia]) => {
      if (cancel) return;
      // Filter the manual list to just this team for the existing
      // rebuildRoster signature (it expects per-team rows). The cross-
      // team filter happens inside the rebuild now (see updates below).
      const manualList = allManual.filter(p => p.team === team.id);
      setMedia(teamMedia);
      setManualPlayers(manualList);
      setBatting(liveData?.batting || []);
      setPitching(liveData?.pitching || []);
      setRankings(liveData?.rankings || []);
      setGames(gameList || []);

      const fullRoster = rebuildRoster(apiRoster, teamMedia, manualList, allManual);
      setRoster(fullRoster);

      // Avatar lookup — delegated to resolvePlayerAvatar in
      // media-store.js so the team-page roster card and player-page
      // hero always pick the same photo. The resolver handles the
      // four-tier priority (override → FI+num+type → FI+type → legacy):
      //   1. Admin-picked override (manual_players.profile_media_id) —
      //      always wins, looked up against the global media pool so
      //      overrides pointing at media in another team's bucket
      //      resolve correctly (e.g. carried over after a trade).
      //   2. Same first-initial + jersey-number match — strongest
      //      automatic signal. Disambiguates cousin pairs like Paul
      //      Marshall (#02) vs Will Marshall (#22) when their media
      //      filenames carry the number but no first-initial.
      //   3. Same first-initial HEADSHOT/PORTRAIT/ACTION — typical
      //      case for a uniquely-initialed player.
      //   4. Legacy lastname-only match — but ONLY when no other
      //      player on this team shares the lastname. Without that
      //      guard, two cousins sharing a lastname both pull the
      //      same legacy file, which is why Will Marshall was
      //      ending up with Paul's photo.
      const urls = {};
      // Build a name → manual_players row lookup so we can pass the
      // profile_media_id override per entry. Keyed by full name lowercase
      // because that's the only field guaranteed to be unique even
      // among same-FI cousins.
      const manualByFullName = new Map();
      for (const m of manualList) {
        const fullName = (m.name || `${m.firstName || ''} ${m.lastName || ''}`.trim()).toLowerCase();
        if (fullName) manualByFullName.set(fullName, m);
      }
      // Count how many roster entries share each lastname so the
      // resolver knows whether the legacy lastname-only fallback is
      // safe (only one player on the team carries that surname).
      const lastnameCount = new Map();
      for (const p of fullRoster) {
        const ln = p.lastName.toUpperCase();
        lastnameCount.set(ln, (lastnameCount.get(ln) || 0) + 1);
      }
      for (const p of fullRoster) {
        const LN = p.lastName.toUpperCase();
        const FI = (p.firstInitial || (p.firstName || '').charAt(0)).toUpperCase();
        const fullName = (p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim()).toLowerCase();
        const manualRow = manualByFullName.get(fullName);
        const overrideId = manualRow?.profile_media_id || manualRow?.profileMediaId || null;
        const headshot = resolvePlayerAvatar(p, allMedia, {
          profileMediaId: overrideId,
          lastnameUnique: lastnameCount.get(LN) === 1,
        });
        if (headshot?.blob) {
          urls[`${FI}|${LN}`] = {
            url: blobToObjectURL(headshot.blob),
            // Per-player pan/zoom — pulled from the manual_players row so
            // the team roster card matches what the player page hero shows.
            offsetX: manualRow?.profile_offset_x ?? manualRow?.profileOffsetX ?? 0,
            offsetY: manualRow?.profile_offset_y ?? manualRow?.profileOffsetY ?? 0,
            zoom:    manualRow?.profile_zoom ?? manualRow?.profileZoom ?? 1,
          };
        }
      }
      setRosterAvatars(urls);
      setLoaded(true);
    });
    return () => { cancel = true; };
  }, [team?.id, rebuildRoster]);

  const handleAddPlayer = async () => {
    if (!newPlayerLast.trim()) return;
    const record = await savePlayer({
      firstName: newPlayerFirst.trim(),
      lastName: newPlayerLast.trim(),
      team: team.id,
      num: newPlayerNum.trim(),
      position: newPlayerPosition.trim(),
    });
    const updated = [...manualPlayers, record];
    setManualPlayers(updated);
    // Rebuild roster — pass allManual so cross-team trade overrides
    // continue to apply when we re-render after a local edit.
    const [apiRoster, teamMedia, allManual] = await Promise.all([
      fetchTeamRosterFromApi(team.id),
      findTeamMedia(team.id),
      getAllManualPlayers(),
    ]);
    setRoster(rebuildRoster(apiRoster, teamMedia, updated, allManual));
    // Reset form
    setNewPlayerFirst(''); setNewPlayerLast(''); setNewPlayerNum(''); setNewPlayerPosition('');
    setShowAddPlayer(false);
  };

  const handleDeleteManualPlayer = async (manualId) => {
    await deletePlayer(manualId);
    const updated = manualPlayers.filter(p => p.id !== manualId);
    setManualPlayers(updated);
    const [apiRoster, teamMedia, allManual] = await Promise.all([
      fetchTeamRosterFromApi(team.id),
      findTeamMedia(team.id),
      getAllManualPlayers(),
    ]);
    setRoster(rebuildRoster(apiRoster, teamMedia, updated, allManual));
  };

  if (!team) {
    return (
      <Card style={{ textAlign: 'center', padding: 40 }}>
        <SectionHeading>Team not found</SectionHeading>
        <Link to="/studio" style={{ color: colors.accent, textDecoration: 'none' }}>← Back to Dashboard</Link>
      </Card>
    );
  }

  // Prefer live batting/pitching when it's loaded; fall back to the
  // static leaders list pre-fetch. Apply canonical-team overlay so a
  // traded player like Jaso (API still says LAN, canonical says LV)
  // is excluded from LAN's filter and shows up under LV instead.
  const liveBatting = (batting && batting.length > 0) ? batting : BATTING_LEADERS;
  const livePitching = (pitching && pitching.length > 0) ? pitching : PITCHING_LEADERS;
  const teamBatters = applyCanonicalToStats(liveBatting)
    .filter(p => p.team === team.id)
    .sort((a, b) => (b.ops_plus || 0) - (a.ops_plus || 0));
  const teamPitchers = applyCanonicalToStats(livePitching)
    .filter(p => p.team === team.id)
    .sort((a, b) => (a.fip || 0) - (b.fip || 0)); // lower FIP is better
  const topBatter = teamBatters[0];
  const topPitcher = teamPitchers[0];
  const hrLeader = [...teamBatters].sort((a, b) => (b.hr || 0) - (a.hr || 0))[0];

  // Combined team aggregates — computed from live batting + pitching so they
  // update as the season progresses. Weighted where it matters (AVG by AB,
  // ERA / K-rates by innings pitched) so they reflect real team performance.
  const teamAggregates = useMemo(() => {
    // Apply canonical-team overlay before filtering so traded players
    // count toward the right team's aggregates (Jaso → LV, Brody → PHI).
    const teamBat = applyCanonicalToStats(batting).filter(p => p.team === team.id);
    const teamPit = applyCanonicalToStats(pitching).filter(p => p.team === team.id);
    if (teamBat.length === 0 && teamPit.length === 0) return null;

    const sumAb = teamBat.reduce((s, p) => s + (p.ab || 0), 0);
    const sumHits = teamBat.reduce((s, p) => s + (p.hits || 0), 0);
    const sumHr = teamBat.reduce((s, p) => s + (p.hr || 0), 0);
    const sumRbi = teamBat.reduce((s, p) => s + (p.rbi || 0), 0);
    const avgOpsPlus = teamBat.length
      ? teamBat.reduce((s, p) => s + (p.ops_plus || 0), 0) / teamBat.length
      : 0;

    // Weighted ERA: (sum of ER) / IP * 9 — but we don't have ER cleanly.
    // Use avg of player ERAs weighted by IP as a good approximation.
    const sumIp = teamPit.reduce((s, p) => s + parseFloat(p.ip || 0), 0);
    const weightedEra = sumIp > 0
      ? teamPit.reduce((s, p) => s + parseFloat(p.era || 0) * parseFloat(p.ip || 0), 0) / sumIp
      : 0;
    const weightedK4 = sumIp > 0
      ? teamPit.reduce((s, p) => s + parseFloat(p.k4 || 0) * parseFloat(p.ip || 0), 0) / sumIp
      : 0;

    return {
      avg: sumAb > 0 ? (sumHits / sumAb).toFixed(3) : '.000',
      hr: sumHr,
      rbi: sumRbi,
      opsPlus: Math.round(avgOpsPlus),
      era: weightedEra.toFixed(2),
      k4: weightedK4.toFixed(2),
      ip: sumIp.toFixed(1),
    };
  }, [batting, pitching, team?.id]);

  // Rank lookup for roster tiles. Uses the composite rankings list (joined by
  // name since rankings include all BLW players, not just this team).
  const rankByName = useMemo(() => {
    const m = new Map();
    for (const r of rankings) {
      if (r.name && r.currentRank != null) m.set(r.name.toLowerCase(), r.currentRank);
    }
    return m;
  }, [rankings]);

  const thumbUrls = useMemo(() => {
    const urls = {};
    for (const m of media) if (m.blob) urls[m.id] = blobToObjectURL(m.blob);
    return urls;
  }, [media]);

  const teamScopedMedia = useMemo(
    () => media.filter(m => (m.scope || 'player') === 'team'),
    [media]
  );
  const playerScopedMedia = useMemo(
    () => media.filter(m => (m.scope || 'player') === 'player'),
    [media]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Team Header — matches the PlayerPage hero treatment.
          White card with a team-colored left-accent border + a soft team-
          colored wash behind the logo pane. Info is split across columns:
          [logo + identity + owner] [record/pct/diff + rank] [aggregates card] */}
      <div style={{
        background: colors.white,
        // Full-bleed border tinted toward the team color replaces the prior
        // 4px left side-stripe. The team logo at left, the soft team-color
        // gradient wash behind the logo column, and the team-color rank
        // pill carry the brand signal — the side-stripe was redundant.
        border: `1px solid ${team.color}33`,
        borderRadius: radius.lg,
        // Subtle two-layer drop shadow — matches PlayerHero so the two
        // pages share a visual weight. Outer layer is ambient, inner is
        // an edge sharpener.
        boxShadow: '0 8px 24px rgba(17,24,39,0.08), 0 2px 6px rgba(17,24,39,0.05)',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* Soft team wash behind the logo column */}
        <div style={{
          position: 'absolute', top: 0, left: 0, width: 260, height: '100%',
          background: `linear-gradient(135deg, ${team.color}18, ${team.color}04 75%, transparent)`,
          pointerEvents: 'none',
        }} />
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 24,
          padding: 22, alignItems: 'center', position: 'relative',
        }}>
          {/* Col 1 — Logo + identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: '2 1 320px', minWidth: 280 }}>
            <div style={{
              background: colors.white,
              borderRadius: radius.base,
              padding: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
              border: `2px solid ${team.color}`,
              flexShrink: 0,
            }}>
              <TeamLogo teamId={team.id} size={88} rounded="square" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                color: colors.textSecondary, letterSpacing: 1.5, textTransform: 'uppercase',
              }}>
                {team.city}
              </div>
              <div style={{
                fontFamily: fonts.heading, fontSize: 40, lineHeight: 0.95,
                color: colors.text, letterSpacing: 'var(--font-heading-tracking, 1.5px)',
                margin: '3px 0 8px', textTransform: 'uppercase',
              }}>
                {team.name}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {team.rank != null && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: `${team.color}15`, color: team.color,
                    border: `1px solid ${team.color}40`,
                    padding: '3px 10px', borderRadius: 999,
                    fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800, letterSpacing: 1,
                  }}>
                    <span style={{ fontFamily: fonts.heading, fontSize: 13, lineHeight: 1 }}>#{team.rank}</span>
                    <span>COMPOSITE</span>
                  </span>
                )}
                {team.owner && (
                  <span style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textSecondary }}>
                    <span style={{
                      fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                      color: colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase',
                      marginRight: 4,
                    }}>Owner</span>
                    {team.owner}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Col 2 — Record / PCT / Diff mini stats */}
          <div style={{ display: 'flex', gap: 20, flex: '1 1 240px', minWidth: 240, justifyContent: 'space-around' }}>
            {[
              { label: 'RECORD', value: team.record, color: colors.text },
              { label: 'PCT',    value: team.pct,    color: colors.text },
              {
                label: 'DIFF',
                value: team.diff,
                color: team.diff?.startsWith('+') && team.diff !== '0'
                  ? '#15803D'
                  : team.diff === '0' ? colors.textSecondary : '#991B1B',
              },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{
                  fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                  color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
                }}>{s.label}</div>
                <div style={{
                  fontFamily: fonts.heading, fontSize: 28, lineHeight: 1,
                  color: s.color, letterSpacing: 0.4, marginTop: 2,
                }}>{s.value || '—'}</div>
              </div>
            ))}
          </div>

          {/* Col 3 — Combined team aggregates card */}
          {teamAggregates && (
            <div style={{
              minWidth: 240, flex: '1 1 240px',
              background: colors.white,
              border: `1px solid ${colors.borderLight}`,
              borderRadius: radius.base,
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              <div style={{
                background: `linear-gradient(135deg, ${team.color}, ${team.dark})`,
                color: '#fff',
                padding: '8px 12px',
                fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                letterSpacing: 1.2, textAlign: 'center', textTransform: 'uppercase',
              }}>
                Team Aggregates
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
                padding: '10px 4px', gap: 2,
              }}>
                {[
                  { label: 'AVG',  value: teamAggregates.avg },
                  { label: 'HR',   value: teamAggregates.hr,  highlight: true },
                  { label: 'ERA',  value: teamAggregates.era },
                  { label: 'K/4',  value: teamAggregates.k4  },
                ].map(t => (
                  <div key={t.label} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                    padding: '4px 2px',
                  }}>
                    <div style={{
                      fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                      color: colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase',
                    }}>{t.label}</div>
                    <div style={{
                      fontFamily: fonts.heading, fontSize: 22,
                      color: t.highlight ? team.color : colors.text,
                      lineHeight: 1, letterSpacing: 0.5,
                    }}>{t.value ?? '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Team Stats Summary */}
      {(topBatter || topPitcher) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {/* Stat-leader cards — full hairline border tinted toward team
              color. Team identity carried by the tint; the bold metric and
              player name carry the focus. */}
          {topBatter && (
            <Card style={{ border: `1px solid ${team.color}33` }}>
              <div style={{ fontFamily: fonts.condensed, fontSize: 10, letterSpacing: 1, color: colors.textMuted, marginBottom: 4 }}>TOP BATTER · OPS+</div>
              <div style={{ fontFamily: fonts.heading, fontSize: 22, color: colors.text, letterSpacing: 0.5 }}>{topBatter.name}</div>
              <div style={{ fontFamily: fonts.heading, fontSize: 32, color: colors.accent, letterSpacing: 1 }}>{topBatter.ops_plus}</div>
              <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                {topBatter.avg} AVG · {topBatter.hr} HR · {topBatter.obp} OBP
              </div>
            </Card>
          )}
          {topPitcher && (
            <Card style={{ border: `1px solid ${team.color}33` }}>
              <div style={{ fontFamily: fonts.condensed, fontSize: 10, letterSpacing: 1, color: colors.textMuted, marginBottom: 4 }}>TOP PITCHER · FIP</div>
              <div style={{ fontFamily: fonts.heading, fontSize: 22, color: colors.text, letterSpacing: 0.5 }}>{topPitcher.name}</div>
              <div style={{ fontFamily: fonts.heading, fontSize: 32, color: colors.accent, letterSpacing: 1 }}>
                {typeof topPitcher.fip === 'number' ? topPitcher.fip.toFixed(2) : topPitcher.fip}
              </div>
              <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                {topPitcher.era} ERA · {topPitcher.w}-{topPitcher.l} · {topPitcher.ip} IP
              </div>
            </Card>
          )}
          {hrLeader && hrLeader.hr > 0 && hrLeader !== topBatter && (
            <Card style={{ border: `1px solid ${team.color}33` }}>
              <div style={{ fontFamily: fonts.condensed, fontSize: 10, letterSpacing: 1, color: colors.textMuted, marginBottom: 4 }}>HR LEADER</div>
              <div style={{ fontFamily: fonts.heading, fontSize: 22, color: colors.text, letterSpacing: 0.5 }}>{hrLeader.name}</div>
              <div style={{ fontFamily: fonts.heading, fontSize: 32, color: colors.accent, letterSpacing: 1 }}>{hrLeader.hr}</div>
              <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                {hrLeader.avg} AVG · {hrLeader.slg} SLG
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Roster */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
          <SectionHeading style={{ margin: 0 }}>Roster</SectionHeading>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontFamily: fonts.condensed, fontSize: 11, color: colors.textMuted }}>
              {roster.length} PLAYER{roster.length !== 1 ? 'S' : ''}
            </span>
            <button onClick={() => setShowAddPlayer(!showAddPlayer)} style={{
              background: showAddPlayer ? colors.bg : colors.accentSoft,
              border: `1px solid ${showAddPlayer ? colors.border : colors.accentBorder}`,
              color: showAddPlayer ? colors.textSecondary : colors.accent,
              borderRadius: radius.sm, padding: '4px 10px',
              fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}>{showAddPlayer ? '✕ Cancel' : '+ Add Player'}</button>
          </div>
        </div>

        {showAddPlayer && (
          <div style={{
            background: colors.bg, border: `1px solid ${colors.border}`,
            borderRadius: radius.base, padding: 12, marginBottom: 12,
          }}>
            <div style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, color: colors.textMuted, letterSpacing: 0.8, marginBottom: 8 }}>
              ADD PLAYER TO {team.id}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px 120px', gap: 8, marginBottom: 10 }}>
              <input type="text" value={newPlayerFirst} onChange={e => setNewPlayerFirst(e.target.value)}
                placeholder="First name" style={{ ...inputStyle, fontSize: 12 }} />
              <input type="text" value={newPlayerLast} onChange={e => setNewPlayerLast(e.target.value)}
                placeholder="Last name *" style={{ ...inputStyle, fontSize: 12 }} />
              <input type="text" value={newPlayerNum} onChange={e => setNewPlayerNum(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder="#" maxLength={2} style={{ ...inputStyle, fontSize: 12, textAlign: 'center' }} />
              <input type="text" value={newPlayerPosition} onChange={e => setNewPlayerPosition(e.target.value)}
                placeholder="Position" style={{ ...inputStyle, fontSize: 12 }} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <RedButton onClick={handleAddPlayer} disabled={!newPlayerLast.trim()} style={{ padding: '8px 16px', fontSize: 12 }}>
                Add Player
              </RedButton>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.condensed, alignSelf: 'center' }}>
                Adds to local roster · Position examples: P, C, IF, OF, 2-way
              </div>
            </div>
          </div>
        )}

        {!loaded && <div style={{ padding: 20, textAlign: 'center', color: colors.textMuted }}>Loading roster…</div>}
        {loaded && roster.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
            No roster data yet. Upload media files or click "+ Add Player" to start.
          </div>
        )}
        {loaded && roster.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {roster.map((p, idx) => {
              const FI = (p.firstInitial || (p.firstName || '').charAt(0)).toUpperCase();
              const avatar = rosterAvatars[`${FI}|${p.lastName.toUpperCase()}`];
              const statLabel = p.isBatter && p.isPitcher
                ? 'Two-Way Player'
                : p.isBatter ? 'Batter'
                : p.isPitcher ? 'Pitcher'
                : p.mediaOnly ? 'Roster' : 'Roster';
              // Composite key — with first-initial + lastname, Logan Rose and
              // Carson Rose each get a stable unique key.
              const rowKey = `${p.playerId || p.manualId || p.source || 'row'}-${FI}-${p.lastName}-${idx}`;
              // Disambiguated slug: "c-rose" beats "rose".
              const slug = playerSlug(p);
              // Composite rank for this player — powers the tier badge on the
              // right edge of the tile. Null for players not yet ranked.
              const playerRank = rankByName.get((p.name || '').toLowerCase());
              return (
                <div key={rowKey} style={{ position: 'relative' }}>
                  <Link
                    to={`/teams/${team.slug}/players/${slug}`}
                    style={{
                      textDecoration: 'none', color: colors.text,
                      padding: 12, borderRadius: radius.base,
                      background: colors.white, border: `1px solid ${colors.border}`,
                      display: 'flex', alignItems: 'center', gap: 10,
                      transition: 'all 0.15s',
                    }}
                  >
                    <PositionedAvatar
                      src={avatar?.url}
                      offsetX={avatar?.offsetX}
                      offsetY={avatar?.offsetY}
                      zoom={avatar?.zoom}
                      size={48}
                      borderColor={team.color}
                      fallbackBg={`linear-gradient(135deg, ${team.color}, ${team.dark})`}
                      fallback={
                        <span style={{
                          color: team.accent,
                          fontFamily: fonts.heading, fontSize: 16, letterSpacing: 0.5,
                        }}>
                          {p.lastName.slice(0, 2).toUpperCase()}
                        </span>
                      }
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        {p.num && (
                          <span style={{
                            fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                            padding: '1px 6px', borderRadius: 3,
                            background: team.color, color: team.accent,
                          }}>#{p.num}</span>
                        )}
                        <span style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted }}>
                          {statLabel}{p.manual ? ' · Manual' : ''}
                        </span>
                      </div>
                    </div>
                    {playerRank != null && (
                      <div style={{ flexShrink: 0, marginLeft: 4 }}>
                        <TierBadge rank={playerRank} size={36} />
                      </div>
                    )}
                  </Link>
                  {p.manual && p.manualId && (
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteManualPlayer(p.manualId); }}
                      title="Remove manual player"
                      style={{
                        position: 'absolute', top: 4, right: 4, width: 18, height: 18,
                        borderRadius: '50%', background: 'rgba(0,0,0,0.1)', color: colors.textMuted,
                        border: 'none', fontSize: 10, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >✕</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Team Photos — team-scoped assets (TEAMPHOTO, VENUE, LOGO_*, WORDMARK) */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionHeading style={{ margin: 0 }}>Team photos</SectionHeading>
          <Link to="/files" style={{ fontSize: 11, fontFamily: fonts.condensed, fontWeight: 600, color: colors.accent, textDecoration: 'none' }}>
            Go to Files →
          </Link>
        </div>
        {teamScopedMedia.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
            No team-wide photos yet. Upload a group shot, venue pic, or logo in Files. Tag it as <strong>TEAMPHOTO</strong>, <strong>VENUE</strong>, <strong>LOGO</strong>, or <strong>WORDMARK</strong>.
          </div>
        )}
        {teamScopedMedia.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {teamScopedMedia.slice(0, 12).map(m => (
              <div key={m.id} style={{
                borderRadius: radius.base, overflow: 'hidden',
                border: `1px solid ${colors.borderLight}`,
              }}>
                <div style={{
                  width: '100%', height: 110,
                  background: thumbUrls[m.id] ? `url(${thumbUrls[m.id]}) center/cover` : `linear-gradient(135deg, ${team.color}22, ${team.color}08)`,
                }} />
                <div style={{ padding: 8 }}>
                  <div style={{ fontSize: 10, fontFamily: fonts.condensed, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.name}
                  </div>
                  <div style={{ fontSize: 9, color: colors.textMuted, fontFamily: fonts.condensed, marginTop: 2 }}>
                    {m.assetType}{m.variant ? ` · ${m.variant}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Team-filtered stat tables — same components the Game Center uses so
          percentile shading, tooltips, rank columns, and clickable player links
          all stay consistent. Percentiles are still computed against the full
          league population, so these cells show each player's standing across
          BLW, not just within the team. */}
      {/* Team stat tables — apply canonical team overlay so traded
          players (Jaso → LV) appear under their actual current team
          and the original team no longer claims them. */}
      {(() => {
        const battingCanonical = applyCanonicalToStats(batting);
        const pitchingCanonical = applyCanonicalToStats(pitching);
        const teamBat = battingCanonical.filter(p => p.team === team.id);
        const teamPit = pitchingCanonical.filter(p => p.team === team.id);
        // Pad both tables with the team's full canonical roster so every
        // page reads as a 7-player roster view. Players with no stats yet
        // (rookies, late signings) appear with em-dash cells; their zeros
        // do not affect heatmap colors because percentile shading is
        // computed from the full BLW population (populationRows), which
        // only contains stat-bearing rows from the league endpoints.
        const teamCanonical = CANONICAL_ROSTER_2026.filter(c => c.team === team.id);
        const presentBat = new Set(teamBat.map(p => (p.name || '').toLowerCase()));
        const presentPit = new Set(teamPit.map(p => (p.name || '').toLowerCase()));
        const presentAnywhere = new Set([...presentBat, ...presentPit]);
        const noStats = teamCanonical.filter(c => !presentAnywhere.has(c.name.toLowerCase()));
        const noStatsBatRows = noStats.map(c => ({
          name: c.name, team: c.team,
          ab: 0, hits: 0, hr: 0, rbi: 0,
          avg: '—', obp: '—', slg: '—', ops: '—', ops_plus: null,
          noStats: true,
        }));
        const noStatsPitRows = noStats.map(c => ({
          name: c.name, team: c.team,
          ip: 0, w: 0, l: 0,
          era: '—', whip: '—', fip: null, k4: '—', bb4: '—',
          noStats: true,
        }));
        const teamBatFull = [...teamBat, ...noStatsBatRows];
        const teamPitFull = [...teamPit, ...noStatsPitRows];
        return (
          <>
            {teamBatFull.length > 0 && (
              <BattingTable
                rows={teamBatFull}
                populationRows={battingCanonical}
                title={`${team.name} · Batting`}
                showSearch={false}
                emptyMessage="No batting data for this team yet."
              />
            )}
            {teamPitFull.length > 0 && (
              <PitchingTable
                rows={teamPitFull}
                populationRows={pitchingCanonical}
                title={`${team.name} · Pitching`}
                showSearch={false}
                showLegend={false}
                emptyMessage="No pitching data for this team yet."
              />
            )}
          </>
        );
      })()}

      {/* Recently Uploaded Player Media */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionHeading style={{ margin: 0 }}>Recent player media</SectionHeading>
          <Link to="/files" style={{ fontSize: 11, fontFamily: fonts.condensed, fontWeight: 600, color: colors.accent, textDecoration: 'none' }}>
            Go to Files →
          </Link>
        </div>
        {playerScopedMedia.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
            No player media uploaded for this team yet.{' '}
            <Link to="/files" style={{ color: colors.accent }}>Upload in Files</Link>
          </div>
        )}
        {playerScopedMedia.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {playerScopedMedia.slice(0, 12).map(m => (
              <div key={m.id} style={{
                borderRadius: radius.base, overflow: 'hidden',
                border: `1px solid ${colors.borderLight}`,
              }}>
                <div style={{
                  width: '100%', height: 100,
                  background: thumbUrls[m.id] ? `url(${thumbUrls[m.id]}) center/cover` : `linear-gradient(135deg, ${team.color}22, ${team.color}08)`,
                }} />
                <div style={{ padding: 8 }}>
                  <div style={{ fontSize: 10, fontFamily: fonts.condensed, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.name}
                  </div>
                  <div style={{ fontSize: 9, color: colors.textMuted, fontFamily: fonts.condensed, marginTop: 2 }}>
                    {m.assetType || 'FILE'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Content calendar — 4-week posting cadence. Baseline M/W/F; game weeks
          bump to game-day × 3 posts; the week after goes light. Pulls games
          from Grand Slam Systems /games (already proxied via /api/gss). */}
      <ContentCalendar team={team} games={games} />
    </div>
  );
}
