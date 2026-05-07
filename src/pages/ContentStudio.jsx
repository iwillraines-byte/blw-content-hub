import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TEAMS, generateContentSuggestions, fetchAllData, getTeam, API_CONFIG, applyCanonicalToStats } from '../data';
import { getAllManualPlayers } from '../player-store';
import { Card, PageHeader, SectionHeading, TeamLogo } from '../components';
import { BattingTable, PitchingTable } from '../stats-tables';
import { colors, fonts, radius } from '../theme';
import { getRequests, saveRequests, countByStatus, oldestPendingDays, embedIdeaInNote, buildGenerateLinkFromIdea } from '../requests-store';
import { stashIdeaForGenerate } from '../idea-context-store';
import { getAllMedia } from '../media-store';
import { isAlreadyTagged } from '../tag-heuristics';
import { getUsageToday, recordUsage } from '../ai-usage-store';
import { useToast } from '../toast';
import { fetchRecentGenerates, setGenerateLogHidden } from '../cloud-sync';
import { useAuth } from '../auth';
import { formatPostName } from '../template-config';
import { authedFetch } from '../authed-fetch';
import IdeaCard from '../idea-card';
import { Pager, useIdeaPagination, IDEAS_PAGE_SIZE } from '../idea-pager';
import { useLeagueContext, LeagueContextCard } from '../league-context';
import { ViewAsPicker } from '../view-as';
import { useContentIdeas } from '../content-ideas-store';

export default function ContentStudio() {
  const navigate = useNavigate();
  const toast = useToast();
  // The league-context hook fetches once on mount. Master admins see the
  // editing card; everyone benefits from the value being passed into AI calls.
  const leagueCtx = useLeagueContext();
  const [suggestions, setSuggestions] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [requests, setRequests] = useState([]);
  const [mediaStats, setMediaStats] = useState({ total: 0, untagged: 0 });
  // Live batting + pitching for the Stats Leaders teaser at the bottom of the
  // dashboard. Shares the same fetchAllData() call so nothing hits twice.
  const [batting, setBatting] = useState([]);
  const [pitching, setPitching] = useState([]);
  const [rankings, setRankings] = useState([]);
  // Scope for new generations + the displayed list. null = league-wide.
  // Setting a team locks the next Generate batch to that team AND filters
  // the visible ideas list so the dashboard reflects the active scope.
  // Persisted in localStorage so a refresh keeps the user's last filter.
  const [targetTeam, setTargetTeamState] = useState(() => {
    try { return localStorage.getItem('blw_dashboard_target_team') || null; }
    catch { return null; }
  });
  const setTargetTeam = (next) => {
    setTargetTeamState(next || null);
    try {
      if (next) localStorage.setItem('blw_dashboard_target_team', next);
      else localStorage.removeItem('blw_dashboard_target_team');
    } catch {}
  };

  // AI-generated content ideas — persisted server-side via /api/content-ideas
  // and fetched here. The store handles fetch/refetch/patch/dismiss with
  // optimistic updates. Filtered by `targetTeam` so picking a team in the
  // dropdown above scopes both new generations AND the visible list.
  const ideasStore = useContentIdeas({ team: targetTeam, limit: 24 });
  const aiIdeas = ideasStore.ideas;
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasError, setIdeasError] = useState(null);
  // Most recently queued idea id → request id. Flashes a "✓ Queued" state
  // on that card's button for a few seconds and surfaces a "View request →"
  // link so the user can jump straight to the newly-created request.
  const [queuedIdeas, setQueuedIdeas] = useState({}); // { [ideaId]: requestId }
  // Public recent-posts strip — last 12 downloads across all teams.
  // Populates asynchronously; renders ALWAYS (with empty state) so the
  // surface is visible from a cold install — the previous "hide when
  // empty" behavior made the strip disappear on fresh tenants and the
  // user thought we'd dropped the feature. Unposted (master-admin
  // toggled) entries render greyscale + carry a "DRAFT" tag, mirroring
  // the team carousel for visual consistency.
  const [recentPosts, setRecentPosts] = useState([]);
  const [recentPostsLoaded, setRecentPostsLoaded] = useState(false);
  useEffect(() => {
    fetchRecentGenerates(12).then(list => {
      setRecentPosts(list);
      setRecentPostsLoaded(true);
    });
  }, []);

  // Athlete voices keyed by "{TEAM}|{LASTNAME}" so the AI can pull a
  // self-authored vibe / references / fun-facts block for any player
  // it picks for a content idea. Loaded once on mount; payload is
  // small (most players have empty voice blocks). Sent to /api/ideas
  // as `context.athleteVoices`.
  const [athleteVoices, setAthleteVoices] = useState({});
  useEffect(() => {
    getAllManualPlayers().then(list => {
      // v4.5.30: Cousin-pair fix. Keys are now TEAM|FI|LASTNAME so
      // Paul Marshall (AZS|P|MARSHALL) and Will Marshall
      // (AZS|W|MARSHALL) get distinct voice slots — previous lastname-
      // only key collapsed them into one and whoever was last in the
      // iteration order won, which is why "content created for Paul"
      // was pulling Will's voice. We also write a TEAM|LASTNAME fallback
      // ONLY when there's exactly one cousin on the team with that
      // lastname, so legacy callers that don't know FI still hit the
      // right entry.
      const byTeamLast = {};
      for (const p of list) {
        if (!p?.team || !p?.lastName) continue;
        const k = `${p.team.toUpperCase()}|${p.lastName.toUpperCase()}`;
        (byTeamLast[k] = byTeamLast[k] || []).push(p);
      }
      const map = {};
      for (const p of list) {
        const v = p.athleteVoice || p.athlete_voice;
        if (!v || typeof v !== 'object') continue;
        const hasContent = Object.values(v).some(x => x && String(x).trim());
        if (!hasContent) continue;
        const team = (p.team || '').toUpperCase();
        const last = (p.lastName || '').toUpperCase();
        if (!team || !last) continue;
        const fi = String(p.firstInitial || (p.firstName || '').charAt(0) || '').toUpperCase();
        // Composite key — always written, always cousin-safe.
        if (fi) map[`${team}|${fi}|${last}`] = v;
        // Lastname-only key — only when there's one cousin to overwrite.
        const sameLast = byTeamLast[`${team}|${last}`] || [];
        if (sameLast.length <= 1) map[`${team}|${last}`] = v;
      }
      setAthleteVoices(map);
    }).catch(() => {});
  }, []);
  // Daily usage counter surfaced in the Content Ideas header so the user
  // has a running tally of AI calls today (cost proxy). Re-read whenever
  // aiIdeas changes so increments after a request reflect right away.
  const [usageToday, setUsageToday] = useState(() => getUsageToday());
  useEffect(() => {
    const keys = Object.keys(queuedIdeas);
    if (keys.length === 0) return;
    const t = setTimeout(() => setQueuedIdeas({}), 8000);
    return () => clearTimeout(t);
  }, [queuedIdeas]);

  useEffect(() => {
    fetchAllData().then(({ batting: b, pitching: p, rankings: r }) => {
      // Overlay canonical team + name on every stat so post-trade
      // players (Konnor Jaso → LV, Preston Kolm → LAN) show their real
      // current team chip in the dashboard's stat tables, not the API
      // team they had stats under previously.
      const bCanon = applyCanonicalToStats(b || []);
      const pCanon = applyCanonicalToStats(p || []);
      setSuggestions(generateContentSuggestions(bCanon, pCanon, r));
      setBatting(bCanon);
      setPitching(pCanon);
      setRankings(r || []);
      setDataLoaded(true);
    });
    setRequests(getRequests());
    getAllMedia().then(all => {
      const total = all.length;
      const untagged = all.filter(m => !isAlreadyTagged(m.name)).length;
      setMediaStats({ total, untagged });
    });
  }, []);

  // Kick off an ideas request. `seedIdea` is optional — passed through to the
  // API as the "more like this" seed. Results PREpend to aiIdeas so newer
  // batches bubble to the top of the list. Generation requests a single page
  // worth (IDEAS_PAGE_SIZE) per click; older batches stay paginated below.
  const requestIdeas = async (seedIdea = null, count = IDEAS_PAGE_SIZE) => {
    setIdeasLoading(true);
    setIdeasError(null);
    try {
      // v4.5.52: was plain fetch — broke after v4.5.37 added requireUser
      // to /api/ideas. authedFetch attaches the JWT.
      const res = await authedFetch('/api/ideas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          context: {
            teams: TEAMS.map(t => ({ id: t.id, name: t.name, record: t.record, rank: t.rank, color: t.color, accent: t.accent })),
            // Send the FULL stat tables so the API can stratify (top + mid +
            // sleeper). Server slices/randomises from this pool.
            batting: batting.slice(0, 60),
            pitching: pitching.slice(0, 60),
            rankings: rankings.slice(0, 60),
            // Per-player self-authored vibe / references / content prefs.
            // Keyed by "{TEAM}|{LASTNAME}" so the server can match on
            // whichever players it samples. Empty object skips the
            // ATHLETE VOICE block in the prompt entirely.
            athleteVoices,
          },
          count,
          seedIdea,
          // Master-admin notes — trades, draft, storylines. Empty string is
          // fine; the server prompt handles the no-context case.
          leagueContext: leagueCtx.notes || '',
          // Top-level team scope from the dashboard's team picker. When
          // set, /api/ideas locks every generated idea to that team and
          // waives the spread-across-4-teams rule. Ignored when seedIdea
          // is set (seed scoping takes precedence — they collapse to the
          // same intent in practice).
          team: targetTeam || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      // Server now stamps id + aiGenerated; we only normalise defensively.
      const tagged = (data.ideas || []).map((i, idx) => ({
        ...i,
        id: i.id || `ai-${Date.now()}-${idx}`,
        aiGenerated: true,
      }));
      // Optimistic prepend — the server has already persisted these, so
      // the dashboard reflects them immediately and a refresh will see
      // the same list from /api/content-ideas.
      ideasStore.prependIdeas(tagged);
      // One AI call generated N ideas — track both so the counter reflects
      // reality. `ideas` is the headline number; `ideasCalls` is invocations
      // (useful if you want to reason about API spend later).
      recordUsage('ideas', tagged.length);
      recordUsage('ideasCalls', 1);
      setUsageToday(getUsageToday());
      toast.success(seedIdea ? 'Generated more ideas' : `${tagged.length} fresh ideas`, {
        detail: seedIdea ? `Seeded from "${seedIdea.headline}"` : 'Scroll down in Content ideas to see them',
      });
    } catch (err) {
      setIdeasError(err.message || 'Failed to fetch ideas');
      toast.error('Couldn\'t fetch AI ideas', { detail: err.message?.slice(0, 80) });
    } finally {
      setIdeasLoading(false);
    }
  };

  // Hand-off to Generate. Stashes the FULL idea (headline, narrative,
  // captions, dataPoints) in sessionStorage so Generate can render its
  // "Brief context" drawer next to the canvas. URL still carries the
  // flat prefill so deep-link bookmarks keep working without the stash.
  const buildLink = (s) => {
    stashIdeaForGenerate(s);
    return buildGenerateLinkFromIdea(s);
  };

  // "Send to Requests" — turns a content idea into a tracked pending request.
  // Idempotent-ish: if the same idea was just added (same headline + team)
  // in the last 60 seconds, skip so double-click doesn't create duplicates.
  const queueIdeaAsRequest = (s) => {
    const existing = getRequests();
    const duplicate = existing.find(r =>
      r.note?.startsWith(s.headline) &&
      r.team === (s.team || 'BLW') &&
      r.createdAt && (Date.now() - r.createdAt) < 60_000
    );
    if (duplicate) {
      setQueuedIdeas(prev => ({ ...prev, [s.id]: duplicate.id }));
      return;
    }
    const now = new Date();
    // Human-readable prose at the top of the note. Below it (separated
    // by the idea-payload sentinel) we stash a JSON copy of the FULL
    // idea so the Requests detail panel can render the full context
    // (narrative, captions, prefill) and offer a one-click jump back
    // into Generate with everything pre-populated.
    const prose = [
      s.headline,
      s.description,
      s.aiGenerated ? 'Source: ✨ AI content idea' : 'Source: Dashboard content idea',
    ].filter(Boolean).join('\n');
    const requestId = crypto.randomUUID();
    // Stamp the requestId on the embedded payload too so deep-links from
    // Requests → Generate carry a `?fromRequest=...` tag. Useful for
    // future surfaces (e.g., showing a "filed under request 1234" hint
    // on the canvas) and harmless if nothing reads it.
    const ideaWithRequestId = { ...s, requestId };
    const newRequest = {
      id: requestId,
      team: s.team && s.team !== 'BLW' ? s.team : 'BLW',
      template: s.templateId || '',
      status: 'pending',
      requester: 'You (Admin)',
      date: now.toLocaleString(undefined, { month: 'short', day: 'numeric' }),
      createdAt: now.getTime(),
      priority: 'medium',
      note: embedIdeaInNote(prose, ideaWithRequestId),
    };
    const updated = [newRequest, ...existing];
    saveRequests(updated);
    setRequests(updated);
    setQueuedIdeas(prev => ({ ...prev, [s.id]: newRequest.id }));
    // Toast with a one-click View Request action.
    toast.success('Request queued', {
      detail: s.headline,
      action: { label: 'VIEW', onClick: () => navigate(`/requests?id=${newRequest.id}`) },
    });
  };

  // Patch a single idea's fields (e.g., when /api/captions returns drafts).
  // For AI ideas (in the persistent store), the store handles optimistic
  // local update + cloud PATCH. For deterministic suggestions (local-only),
  // we patch the suggestions array directly.
  const patchIdea = (ideaId, patch) => {
    if (aiIdeas.some(i => i.id === ideaId)) {
      ideasStore.patchIdea(ideaId, patch);
      return;
    }
    setSuggestions(prev => prev.map(i => i.id === ideaId ? { ...i, ...patch } : i));
  };

  // ─── Live-state card data ─────────────────────────────────────────────────
  const pendingCount     = countByStatus(requests, 'pending');
  const inProgressCount  = countByStatus(requests, 'in-progress');
  const completedCount   = countByStatus(requests, 'completed');
  const oldestDays       = oldestPendingDays(requests);
  const topSuggestion    = suggestions[0];

  // v4.5.20: Filter + shuffle layer between the raw list and the
  // pager. The user's complaint was that the static feed felt stale
  // — search lets you fish for a specific player/topic, shuffle
  // re-orders existing ideas so a refresh feels alive without
  // burning AI tokens on a regenerate.
  const [ideasFilter, setIdeasFilter] = useState('');
  const [ideasShuffleSeed, setIdeasShuffleSeed] = useState(0);
  const ideasListBase = aiIdeas.length > 0 ? aiIdeas : suggestions;
  const ideasList = useMemo(() => {
    let list = ideasListBase;
    const q = ideasFilter.trim().toLowerCase();
    if (q) {
      list = list.filter(s => {
        const hay = [
          s.headline, s.narrative, s.playerName, s.team,
          s.prefill?.playerName, s.prefill?.statLine, s.prefill?.subtitle,
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    if (ideasShuffleSeed > 0) {
      // Deterministic shuffle keyed off seed so re-renders during a
      // single shuffle pass don't reshuffle. New shuffle = bump seed.
      const arr = [...list];
      let s = ideasShuffleSeed;
      for (let i = arr.length - 1; i > 0; i--) {
        s = (s * 9301 + 49297) % 233280;
        const j = Math.floor((s / 233280) * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      list = arr;
    }
    return list;
  }, [ideasListBase, ideasFilter, ideasShuffleSeed]);
  const { pageItems: ideasPageItems, pagerProps: ideasPagerProps } = useIdeaPagination(ideasList);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="Dashboard" subtitle="Draft, design, and track BLW content across every team" />

      {/* v4.5.42: First-run welcome card. Renders once per user, scoped
          to the staff tier ('admin' / 'content' — not master-admin who
          built the place, not athletes who land on /my-stats). Dismiss
          stamp lives in localStorage keyed by user.id so the card
          stays gone after the first visit. */}
      <FirstRunWelcomeCard />

      {/* Live-state cards — each reflects current state, not just a nav shortcut */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <LiveCard
          icon="✦"
          label="Generate"
          primary={dataLoaded ? `${suggestions.length} idea${suggestions.length === 1 ? '' : 's'} ready` : 'Loading ideas…'}
          secondary={topSuggestion ? `Top: ${truncate(topSuggestion.headline, 40)}` : 'No suggestions yet'}
          to={topSuggestion ? buildLink(topSuggestion) : '/generate'}
          cta={topSuggestion ? 'Create top idea →' : 'Open Generate →'}
        />
        <LiveCard
          icon="☰"
          label="Requests"
          primary={pendingCount === 0
            ? 'No open requests'
            : `${pendingCount} pending`}
          secondary={pendingCount === 0
            ? 'Click to file a new one'
            : oldestDays != null && oldestDays > 0
              ? `Oldest: ${oldestDays} day${oldestDays === 1 ? '' : 's'} ago`
              : 'Created today'}
          to={pendingCount > 0 ? '/requests?status=pending' : '/requests'}
          cta={pendingCount > 0 ? 'Review pending →' : '+ New Request'}
          warn={oldestDays != null && oldestDays > 3}
        />
        <LiveCard
          icon="◫"
          label="Files"
          primary={`${mediaStats.total} file${mediaStats.total === 1 ? '' : 's'} in library`}
          secondary={mediaStats.untagged === 0
            ? 'All files tagged ✓'
            : `${mediaStats.untagged} need${mediaStats.untagged === 1 ? 's' : ''} tagging`}
          to="/files"
          cta={mediaStats.untagged > 0 ? 'Tag untagged →' : 'Open Files →'}
          warn={mediaStats.untagged > 0}
        />
      </div>

      {/* League context — master admin only. Returns null for everyone else,
          so it's safe to always render. The hook still fetches the value so
          we can forward it to /api/ideas for ALL users (admins set the
          context; everyone benefits from grounded AI output). */}
      <LeagueContextCard ctx={leagueCtx} />

      {/* View as — master admin only. Lets you preview the dashboard from
          any athlete's seat (or as a content user). Returns null for
          everyone else. Pairs with the ImpersonationBanner mounted at the
          top of AppShell so the active impersonation is always visible. */}
      <ViewAsPicker />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* LEFT — Content Suggestions */}
        <div style={{ flex: '1 1 500px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
              <SectionHeading style={{ margin: 0 }}>Content ideas</SectionHeading>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {(usageToday.ideas || 0) > 0 && (
                  <span
                    title={`${usageToday.ideas} ideas generated in ${usageToday.ideasCalls || 1} call${(usageToday.ideasCalls || 1) === 1 ? '' : 's'} today. Resets at local midnight.`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      background: 'rgba(124,58,237,0.10)', color: '#7C3AED',
                      borderRadius: 999, padding: '3px 9px',
                      fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
                      letterSpacing: 0.6,
                    }}
                  >
                    ✨ {usageToday.ideas} TODAY
                  </span>
                )}
                {/* Team scope picker — drives both the generation request
                    and the visible list filter. Background drifts to the
                    selected team's color when set, so the user has a
                    persistent visual cue that the dashboard is in a
                    scoped view (vs. league-wide). */}
                {(() => {
                  const t = targetTeam ? getTeam(targetTeam) : null;
                  const tinted = !!t;
                  return (
                    <select
                      value={targetTeam || 'ALL'}
                      onChange={(e) => setTargetTeam(e.target.value === 'ALL' ? null : e.target.value)}
                      title="Scope generation + visible list to one team. Pick a team to lock the next batch and filter the cards below."
                      style={{
                        background: tinted ? `${t.color}14` : colors.white,
                        color: tinted ? t.dark || t.color : colors.text,
                        border: `1px solid ${tinted ? `${t.color}55` : colors.border}`,
                        borderRadius: radius.sm,
                        padding: '5px 10px',
                        fontFamily: fonts.condensed,
                        fontSize: 11, fontWeight: 800,
                        letterSpacing: 0.5,
                        cursor: 'pointer', outline: 'none',
                        transition: 'background 160ms ease, border-color 160ms ease, color 160ms ease',
                      }}
                    >
                      <option value="ALL">ALL TEAMS</option>
                      {TEAMS.map(t => (
                        <option key={t.id} value={t.id}>{t.id} · {t.name}</option>
                      ))}
                    </select>
                  );
                })()}
                <button
                  onClick={() => requestIdeas(null)}
                  disabled={ideasLoading || !dataLoaded}
                  title={
                    targetTeam
                      ? `Generate a fresh batch of AI ideas scoped to ${getTeam(targetTeam)?.name || targetTeam}`
                      : 'Generate a fresh batch of AI-powered content ideas using the current BLW state'
                  }
                  style={{
                    background: ideasLoading ? colors.bg : colors.redLight,
                    border: `1px solid ${ideasLoading ? colors.border : colors.redBorder}`,
                    color: ideasLoading ? colors.textMuted : colors.red,
                    borderRadius: radius.sm, padding: '5px 12px',
                    fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800,
                    cursor: ideasLoading || !dataLoaded ? 'wait' : 'pointer',
                    letterSpacing: 0.6,
                  }}
                >
                  {ideasLoading
                    ? '…THINKING'
                    : aiIdeas.length
                      ? (targetTeam ? `✨ REGENERATE ${targetTeam}` : '✨ REGENERATE')
                      : (targetTeam ? `✨ GENERATE ${targetTeam} IDEAS` : '✨ GENERATE IDEAS')}
                </button>
              </div>
            </div>
            <p style={{ fontSize: 12, color: colors.textMuted, margin: '0 0 14px', fontFamily: fonts.condensed }}>
              {aiIdeas.length > 0
                ? 'Each idea ships a story, the supporting numbers, and ready-to-post captions. Click a card to draft.'
                : 'Auto-generated from prowiffleball.com stats. Hit Draft Captions on any card to write copy.'}
            </p>
            {ideasError && (
              <div style={{
                background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B',
                padding: '8px 12px', borderRadius: radius.sm, fontSize: 12, marginBottom: 10,
              }}>
                Couldn't fetch AI ideas: {ideasError}
                {ideasError.includes('ANTHROPIC_API_KEY') && <div style={{ fontSize: 11, marginTop: 4, opacity: 0.8 }}>
                  Set ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables and redeploy.
                </div>}
              </div>
            )}
            {/* v4.5.20: Search + shuffle row. Search narrows by
                player/team/headline/narrative; shuffle reorders the
                visible deck so the same list feels different on each
                visit. Both clear with a single click. */}
            {ideasListBase.length > 1 && (
              <div style={{
                display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12,
                flexWrap: 'wrap',
              }}>
                <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 200 }}>
                  <input
                    type="search"
                    value={ideasFilter}
                    onChange={(e) => setIdeasFilter(e.target.value)}
                    placeholder="Search ideas — player, team, headline…"
                    style={{
                      width: '100%', padding: '7px 30px 7px 30px',
                      border: `1px solid ${colors.border}`, borderRadius: radius.sm,
                      background: colors.white, color: colors.text,
                      fontFamily: fonts.body, fontSize: 12,
                      outline: 'none',
                    }}
                  />
                  <span style={{
                    position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                    color: colors.textMuted, fontSize: 13, pointerEvents: 'none',
                  }}>⌕</span>
                  {ideasFilter && (
                    <button
                      onClick={() => setIdeasFilter('')}
                      title="Clear search"
                      style={{
                        position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: colors.textMuted, fontSize: 14, padding: '4px 8px',
                      }}
                    >✕</button>
                  )}
                </div>
                <button
                  onClick={() => setIdeasShuffleSeed(s => (s + 1) || 1)}
                  title="Reorder the visible cards"
                  style={{
                    background: ideasShuffleSeed ? colors.accentSoft : colors.bg,
                    border: `1px solid ${ideasShuffleSeed ? colors.accentBorder : colors.border}`,
                    color: ideasShuffleSeed ? colors.accent : colors.textSecondary,
                    borderRadius: radius.sm, padding: '7px 12px',
                    fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >⤬ SHUFFLE</button>
                {(ideasFilter || ideasShuffleSeed > 0) && (
                  <span style={{
                    fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, fontWeight: 700, letterSpacing: 0.5,
                  }}>
                    {ideasList.length} of {ideasListBase.length}
                  </span>
                )}
              </div>
            )}

            {/* Paginated view — shows IDEAS_PAGE_SIZE cards at a time with
                ‹ / › arrows when the rolling 14-day store has more. The
                pager hook auto-resets to page 1 when fresh ideas are
                prepended (so "More about Jaso" actually shows the new
                ones, not whatever page you were idling on).
                v4.5.26: pager renders both above AND below the cards so
                you can paginate from a stable top position without
                chasing the bottom one as card heights vary. */}
            <Pager {...ideasPagerProps} position="top" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {ideasPageItems.map(s => {
                // v4.5.17: pass the spotlit player's athleteVoice (if any)
                // so /api/captions grounds the copy in their actual
                // self-authored vibe / references / fun facts.
                // v4.5.30: Try the cousin-safe TEAM|FI|LASTNAME key
                // first; fall back to TEAM|LASTNAME for non-cousin
                // lookups. Without this, Paul Marshall ideas pulled
                // Will Marshall's voice (whoever was last in the
                // map's iteration order won the lastname-only key).
                const playerName = s.prefill?.playerName || s.playerName || '';
                const nameParts = playerName ? playerName.trim().split(/\s+/) : [];
                const lastName = nameParts.length ? nameParts[nameParts.length - 1] : '';
                const firstInitial = nameParts.length > 1 ? (nameParts[0] || '').charAt(0).toUpperCase() : '';
                const teamUp = (s.team || '').toUpperCase();
                const lnUp = lastName.toUpperCase();
                const athleteVoice = (firstInitial && teamUp && lnUp
                  ? athleteVoices[`${teamUp}|${firstInitial}|${lnUp}`]
                  : null
                ) || (teamUp && lnUp ? athleteVoices[`${teamUp}|${lnUp}`] : null) || null;
                return (
                <IdeaCard
                  key={s.id}
                  idea={s}
                  queuedRequestId={queuedIdeas[s.id]}
                  ideasLoading={ideasLoading}
                  leagueContext={leagueCtx.notes || ''}
                  athleteVoice={athleteVoice}
                  onQueue={queueIdeaAsRequest}
                  onOpenInGenerate={(idea) => navigate(buildLink(idea))}
                  onMoreLikeThis={(idea) => requestIdeas(idea, 3)}
                  onIdeaUpdate={patchIdea}
                />
                );
              })}
            </div>
            <Pager {...ideasPagerProps} />
            {dataLoaded && suggestions.length === 0 && aiIdeas.length === 0 && (
              /* Empty state — gives the user one clear next action plus
                 context about what populates this list automatically. */
              <div style={{
                padding: '32px 20px', textAlign: 'center',
                background: colors.bg, borderRadius: radius.base,
                border: `1px dashed ${colors.borderLight}`,
                marginTop: 12,
              }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✨</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: colors.text, marginBottom: 4 }}>
                  No content ideas yet
                </div>
                <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 14, maxWidth: 280, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
                  Generate a fresh AI batch, or wait for live stats to seed this list once games start.
                </div>
                <button
                  onClick={() => requestIdeas(null)}
                  className="btn-primary"
                  style={{
                    border: 'none', borderRadius: radius.base,
                    padding: '8px 20px', fontFamily: fonts.body,
                    fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
                    cursor: 'pointer',
                  }}
                >
                  Generate ideas
                </button>
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT — Queue + Standings.
            v4.5.20: flex changed from `0 1 340px` to `1 1 340px` — the
            old basis kept the column locked at 340px on mobile, so
            the cards looked stranded on the left half of the screen
            with empty space pushing them right. Letting it grow fills
            the wrapped row edge-to-edge while keeping the desktop
            two-column layout (the left column's `1 1 500px` still
            wins the available real estate). */}
        <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Request Queue */}
          <Card>
            <SectionHeading>Request queue</SectionHeading>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { label: 'Pending', count: pendingCount, color: '#F59E0B', status: 'pending' },
                { label: 'In Progress', count: inProgressCount, color: '#3B82F6', status: 'in-progress' },
                { label: 'Completed', count: completedCount, color: '#22C55E', status: 'completed' },
              ].map((s, i) => (
                <Link
                  key={i}
                  to={`/requests?status=${s.status}`}
                  style={{ textDecoration: 'none', flex: 1 }}
                >
                  <div style={{
                    textAlign: 'center', padding: '10px 8px',
                    borderRadius: radius.base, background: `${s.color}08`,
                    border: `1px solid ${s.color}20`, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = `${s.color}14`}
                  onMouseLeave={e => e.currentTarget.style.background = `${s.color}08`}
                  >
                    <div style={{ fontSize: 22, fontFamily: fonts.heading, color: s.color }}>{s.count}</div>
                    <div style={{ fontSize: 10, fontFamily: fonts.condensed, fontWeight: 600, color: colors.textMuted }}>{s.label}</div>
                  </div>
                </Link>
              ))}
            </div>
          </Card>

          {/* Data Status */}
          <Card>
            <SectionHeading>Data status</SectionHeading>
            <div style={{
              padding: 12, borderRadius: radius.base,
              background: API_CONFIG.isLive ? colors.successBg : colors.warningBg,
              border: `1px solid ${API_CONFIG.isLive ? colors.successBorder : colors.warningBorder}`,
              marginBottom: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: API_CONFIG.isLive ? colors.success : colors.warning }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: dataLoaded ? '#15803D' : '#92400E' }}>
                  {dataLoaded ? 'Live · Grand Slam Systems' : 'Loading...'}
                </span>
              </div>
              <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 4 }}>
                app.grandslamsystems.com · Auto-refreshes every 5 min
              </div>
            </div>
          </Card>

          {/* Compact Standings — row clicks go to team page; hover reveals "Create graphic" action */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <SectionHeading style={{ margin: 0 }}>Standings</SectionHeading>
              <Link to="/game-center" style={{ fontSize: 11, fontFamily: fonts.condensed, fontWeight: 600, color: colors.red, textDecoration: 'none' }}>View Full →</Link>
            </div>
            {TEAMS.map(t => (
              <StandingsRow key={t.id} team={t} navigate={navigate} />
            ))}
          </Card>
        </div>
      </div>

      {/* Stats Leaders — top 10 batters + top 10 pitchers, percentile shading
          computed across the full BLW population. A teaser of the Game Center. */}
      {dataLoaded && (batting.length > 0 || pitching.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionHeading style={{ margin: 0 }}>Stats Leaders</SectionHeading>
            <Link to="/game-center" style={{ fontSize: 12, fontFamily: fonts.condensed, fontWeight: 700, color: colors.red, textDecoration: 'none' }}>
              View full leaderboards →
            </Link>
          </div>
          {batting.length > 0 && (
            <BattingTable
              rows={batting}
              populationRows={batting}
              title="Top 10 Batters"
              showSearch={false}
              limit={10}
            />
          )}
          {pitching.length > 0 && (
            <PitchingTable
              rows={pitching}
              populationRows={pitching}
              title="Top 10 Pitchers"
              showSearch={false}
              showLegend={false}
              limit={10}
            />
          )}
        </div>
      )}

      {/* Recent posts — public feed of the last N downloads across the
          team. Click a thumbnail to re-open Generate with the same
          composition. Lives at the bottom of the dashboard, below the
          Top-10 leaderboards, so it reads as the closing "what's been
          shipping" row instead of competing with the live-state cards
          and content ideas at the top of the page. Empty state hides
          the whole row until someone has actually posted. */}
      <RecentPostsStrip
        posts={recentPosts}
        loaded={recentPostsLoaded}
        onHide={(id) => {
          // v4.5.37: master-admin only — server PATCH sets hidden=true,
          // local state drops the post immediately so the strip
          // reflects the change without a re-fetch round trip.
          // v4.5.40: surface the server's actual error detail (e.g.
          // "run db/011 migration") in the toast so the master admin
          // knows exactly what to do instead of seeing a generic
          // "server rejected the change."
          setGenerateLogHidden(id, true).then(result => {
            if (result.ok) {
              setRecentPosts(list => list.filter(p => p.id !== id));
              toast.success('Post hidden', { detail: 'Removed from public feeds across the app.' });
            } else if (result.status === 412) {
              // Schema migration needed — be specific.
              toast.error('Schema migration required', {
                detail: result.detail || 'Run db/011_generate_log_hidden.sql in the Supabase SQL editor.',
              });
            } else {
              toast.error('Couldn\'t hide post', {
                detail: result.detail || result.error || 'Try again — server rejected the change.',
              });
            }
          });
        }}
      />
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncate(str, n) {
  if (!str) return '';
  return str.length <= n ? str : str.slice(0, n - 1) + '…';
}

// v4.5.42: First-run welcome card for non-master staff. The first time
// a freshly-onboarded admin or content-tier user lands on the
// dashboard we show a brief role-aware orientation block — what they
// can do, where to go first, where to file questions. Dismiss stamp
// stamps localStorage so it never fires again for that user.
//
// Master admin doesn't see this (they built the system). Athletes
// don't see it because they default-route to /my-stats not the
// dashboard. The card is purely "you're in, here's the lay of the
// land" for the people who'll be the bulk of the next 100 users.
function FirstRunWelcomeCard() {
  const { user, role, profile } = useAuth();
  const [dismissed, setDismissed] = useState(true); // start true to avoid flash before localStorage check

  useEffect(() => {
    if (!user?.id) return;
    const key = `blw-welcome-dismissed-${user.id}`;
    setDismissed(!!localStorage.getItem(key));
  }, [user?.id]);

  // Master-admin built the system; athletes route to /my-stats. Card is
  // for the new admin / content tier who'll arrive in the wave of 100.
  if (role !== 'admin' && role !== 'content') return null;
  if (dismissed) return null;
  if (!user?.id) return null;

  const dismiss = () => {
    try { localStorage.setItem(`blw-welcome-dismissed-${user.id}`, String(Date.now())); } catch { /* private mode */ }
    setDismissed(true);
  };

  // Role-specific orientation — what they CAN do, framed positively,
  // with a single concrete first action. Keep this short; the full
  // permissions reference lives in Resources.
  const roleCopy = role === 'admin'
    ? {
        title: 'Welcome — you\'re in as ADMIN',
        body: 'You have full access to Studio, Files, Requests, every team page, and player editing — basically everything except Drive API key edits and a handful of master-only diagnostics.',
        firstStep: { label: 'Open the Studio →', to: '/generate' },
      }
    : {
        title: 'Welcome — you\'re in as CONTENT',
        body: 'You can browse every team and player, generate posts in the Studio, upload media in Files, and pick up requests. Master-admin tools (People & Roles, trades, raw API inspector) stay hidden — that\'s expected.',
        firstStep: { label: 'Open the Studio →', to: '/generate' },
      };

  return (
    <Card style={{
      padding: 18,
      background: `linear-gradient(135deg, ${colors.accent}10 0%, ${colors.accent}04 100%)`,
      border: `1px solid ${colors.accent}30`,
      position: 'relative',
    }}>
      <button
        onClick={dismiss}
        title="Got it — don't show this again"
        style={{
          position: 'absolute', top: 10, right: 10,
          width: 28, height: 28, borderRadius: '50%',
          background: 'rgba(255,255,255,0.6)', border: `1px solid ${colors.borderLight}`,
          color: colors.textMuted, cursor: 'pointer',
          fontSize: 13, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >✕</button>
      <div style={{
        fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
        letterSpacing: 0.8, color: colors.accent,
        textTransform: 'uppercase', marginBottom: 6,
      }}>NEW HERE · ONE-TIME WELCOME</div>
      <SectionHeading style={{ margin: 0, marginBottom: 8 }}>{roleCopy.title}</SectionHeading>
      <p style={{
        fontSize: 14, lineHeight: 1.6, color: colors.textSecondary,
        margin: '0 0 14px', maxWidth: '70ch',
      }}>{roleCopy.body}</p>
      <p style={{
        fontSize: 13, lineHeight: 1.6, color: colors.textSecondary,
        margin: '0 0 14px', maxWidth: '70ch',
      }}>
        Stuck on anything? Use{' '}
        <Link to="/requests" style={{ color: colors.accent, fontWeight: 600 }}>Requests</Link>
        {' '}to ping the master admin. The full role reference + how-tos live in{' '}
        <Link to="/resources" style={{ color: colors.accent, fontWeight: 600 }}>Resources</Link>.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link
          to={roleCopy.firstStep.to}
          style={{
            background: colors.accent, color: '#FFFFFF',
            padding: '8px 14px', borderRadius: radius.full,
            fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800,
            letterSpacing: 0.6, textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >{roleCopy.firstStep.label}</Link>
        <Link
          to="/resources"
          style={{
            background: 'transparent', color: colors.textSecondary,
            padding: '8px 14px', borderRadius: radius.full,
            border: `1px solid ${colors.border}`,
            fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
            letterSpacing: 0.5, textDecoration: 'none',
          }}
        >Read the Resources →</Link>
      </div>
      <div style={{
        fontSize: 11, color: colors.textMuted, marginTop: 12, fontStyle: 'italic',
        fontFamily: fonts.body,
      }}>
        Signed in as <strong>{profile?.display_name || user?.email}</strong>{profile?.team_id ? ` · team ${profile.team_id}` : ''}.
      </div>
    </Card>
  );
}

// Single live-state card at the top of the dashboard
// Public recent-posts feed — the last 12 downloads across all teams,
// rendered as a thumbnail grid. Clicking a thumbnail restores its
// composition in Generate. Unposted entries (master-admin toggled) are
// rendered greyscale with a "DRAFT" tag so the dashboard tells the
// truth about which posts actually shipped vs. which are sitting on
// the shelf. Always renders, even when empty — the empty state is the
// indicator that the surface exists for users on cold installs.
function RecentPostsStrip({ posts, loaded, onHide }) {
  const { role } = useAuth();
  const isMaster = role === 'master_admin';
  const timeAgo = (d) => {
    if (!d) return '';
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'Just now';
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  // Restore a download by dropping its snapshot back into Generate's URL params.
  const buildRegenerateLink = (post) => {
    const params = new URLSearchParams();
    if (post.templateType) params.set('template', post.templateType);
    if (post.team) params.set('team', post.team);
    if (post.settings?.fields) {
      for (const [k, v] of Object.entries(post.settings.fields)) {
        if (v != null && v !== '') params.set(k, v);
      }
    }
    return `/generate?${params.toString()}`;
  };

  const postedCount = posts.filter(p => p.posted !== false).length;
  const draftCount = posts.length - postedCount;

  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <SectionHeading style={{ margin: 0 }}>Recent posts</SectionHeading>
        <span style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, color: colors.textMuted, letterSpacing: 0.5 }}>
          {posts.length === 0
            ? (loaded ? 'NO POSTS YET · PUBLIC' : 'LOADING…')
            : `LAST ${posts.length} · PUBLIC${draftCount ? ` · ${draftCount} DRAFT` : ''}`}
        </span>
      </div>
      {posts.length === 0 ? (
        <div style={{
          padding: 28, textAlign: 'center',
          color: colors.textMuted, fontFamily: fonts.condensed, fontSize: 12,
          letterSpacing: 0.4,
        }}>
          {loaded
            ? 'Generate any template and download the PNG — it\'ll show up here for the whole team to see.'
            : ' '}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 10,
        }}>
          {posts.map(post => {
            const team = post.team ? getTeam(post.team) : null;
            const dimmed = post.posted === false;
            return (
              <div key={post.id} style={{ position: 'relative' }}>
              {/* v4.5.37: master-admin hide-from-feed button. Sits in
                  the corner of every recent-posts tile. Click confirms,
                  then PATCHes hidden=true so the post disappears from
                  the dashboard, team page carousel, and player page
                  feeds for every viewer. */}
              {isMaster && onHide && (
                <button
                  onClick={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (window.confirm('Hide this post from the dashboard, team pages, and player pages? Master admin only.')) {
                      onHide(post.id);
                    }
                  }}
                  title="Hide this post from public feeds (master admin)"
                  style={{
                    position: 'absolute', top: 4, right: 4, zIndex: 2,
                    width: 22, height: 22, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.6)', color: '#fff',
                    border: '1px solid rgba(255,255,255,0.25)',
                    cursor: 'pointer', fontSize: 11, fontWeight: 800,
                    lineHeight: 1, padding: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >✕</button>
              )}
              <Link
                to={buildRegenerateLink(post)}
                title={`${post.team || 'BLW'} · ${post.templateType || 'template'} · ${post.platform || ''}${dimmed ? ' · marked NOT POSTED' : ''} · click to re-open in Generate`}
                style={{
                  textDecoration: 'none', display: 'block',
                  opacity: dimmed ? 0.55 : 1,
                  transition: 'opacity 200ms ease',
                }}
              >
                <div style={{
                  borderRadius: radius.base, overflow: 'hidden',
                  border: `1px solid ${colors.borderLight}`,
                  background: '#1A1A22',
                  aspectRatio: '1 / 1',
                  position: 'relative',
                }}>
                  {post.thumbnailUrl ? (
                    <img
                      src={post.thumbnailUrl}
                      alt=""
                      style={{
                        width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                        // Same desaturation as the team carousel for
                        // visual consistency between surfaces.
                        filter: dimmed ? 'grayscale(0.85) brightness(0.85)' : 'none',
                        transition: 'filter 240ms ease',
                      }}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : (
                    <div style={{
                      width: '100%', height: '100%',
                      background: team ? `linear-gradient(135deg, ${team.color}, ${team.dark})` : colors.bg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: fonts.heading, fontSize: 24, color: team?.accent || colors.textMuted,
                      letterSpacing: 1,
                    }}>{post.team || '—'}</div>
                  )}
                  {team && (
                    <span style={{
                      position: 'absolute', top: 6, left: 6,
                      background: team.color, color: team.accent,
                      padding: '2px 6px', borderRadius: 3,
                      fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
                    }}>{team.id}</span>
                  )}
                  {dimmed && (
                    <span style={{
                      position: 'absolute', top: 6, right: 6,
                      background: 'rgba(0,0,0,0.65)', color: '#fff',
                      padding: '2px 6px', borderRadius: 3,
                      fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
                    }}>DRAFT</span>
                  )}
                </div>
                <div style={{ padding: '6px 2px 0' }}>
                  <div
                    title={formatPostName(post, getTeam)}
                    style={{ fontSize: 11, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {formatPostName(post, getTeam) || post.templateType || 'post'}
                  </div>
                  <div style={{ fontSize: 10, fontFamily: fonts.condensed, color: colors.textMuted, letterSpacing: 0.3, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{post.platform || '—'}</span>
                    <span>{timeAgo(post.createdAt)}</span>
                  </div>
                </div>
              </Link>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function LiveCard({ icon, label, primary, secondary, to, cta, warn }) {
  return (
    <Link to={to} style={{ textDecoration: 'none' }}>
      <Card style={{
        padding: 20, cursor: 'pointer',
        // Severity / brand cue handled by the leading icon + the colored CTA
        // label at the bottom; the side-stripe is redundant.
        display: 'flex', flexDirection: 'column', gap: 4,
        height: '100%', boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <span style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: 600, color: colors.textSecondary }}>{label}</span>
        </div>
        <div style={{ fontFamily: fonts.body, fontSize: 18, fontWeight: 700, color: colors.text, lineHeight: 1.2 }}>
          {primary}
        </div>
        <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 6 }}>{secondary}</div>
        <div style={{ fontFamily: fonts.body, fontSize: 12, fontWeight: 700, color: colors.red }}>
          {cta}
        </div>
      </Card>
    </Link>
  );
}

// Standings row — primary click goes to team page; hover reveals a secondary
// "Create graphic →" action that deep-links to Generate with the standings
// template pre-selected.
function StandingsRow({ team, navigate }) {
  const [hovering, setHovering] = useState(false);
  const goTeam = () => navigate(`/teams/${team.slug}`);
  const goGen  = (e) => {
    e.preventDefault(); e.stopPropagation();
    navigate(`/generate?template=standings&team=${team.id}`);
  };
  return (
    <div
      onClick={goTeam}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
        borderRadius: radius.sm, cursor: 'pointer',
        marginBottom: 2, transition: 'background 0.15s',
        background: hovering ? colors.bg : 'transparent',
      }}
    >
      <span style={{
        width: 18, height: 18, borderRadius: radius.full,
        background: colors.bg, border: `1px solid ${colors.borderLight}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: fonts.condensed, fontSize: 9, fontWeight: 700, color: colors.textSecondary,
        flexShrink: 0,
      }}>{team.rank}</span>
      <TeamLogo teamId={team.id} size={22} rounded="square" />
      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>
      {hovering ? (
        <button
          onClick={goGen}
          style={{
            background: colors.red, color: '#fff', border: 'none',
            borderRadius: radius.sm, padding: '3px 8px',
            fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}
          title="Generate a standings graphic featuring this team"
        >Create →</button>
      ) : (
        <span style={{ fontSize: 12, fontWeight: 700, color: colors.textSecondary, fontVariantNumeric: 'tabular-nums', fontFamily: fonts.condensed }}>{team.record}</span>
      )}
    </div>
  );
}
