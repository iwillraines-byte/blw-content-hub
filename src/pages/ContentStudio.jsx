import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TEAMS, generateContentSuggestions, fetchAllData, getTeam, API_CONFIG, applyCanonicalToStats } from '../data';
import { Card, PageHeader, SectionHeading, TeamLogo } from '../components';
import { BattingTable, PitchingTable } from '../stats-tables';
import { colors, fonts, radius } from '../theme';
import { getRequests, saveRequests, countByStatus, oldestPendingDays } from '../requests-store';
import { getAllMedia } from '../media-store';
import { isAlreadyTagged } from '../tag-heuristics';
import { getUsageToday, recordUsage } from '../ai-usage-store';
import { useToast } from '../toast';
import { fetchRecentGenerates } from '../cloud-sync';
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
  // AI-generated content ideas — persisted server-side via /api/content-ideas
  // and fetched here. The store handles fetch/refetch/patch/dismiss with
  // optimistic updates. Falls back to the deterministic `suggestions` list
  // when empty so the dashboard still works without the Anthropic key.
  const ideasStore = useContentIdeas({ team: null, limit: 24 });
  const aiIdeas = ideasStore.ideas;
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasError, setIdeasError] = useState(null);
  // Most recently queued idea id → request id. Flashes a "✓ Queued" state
  // on that card's button for a few seconds and surfaces a "View request →"
  // link so the user can jump straight to the newly-created request.
  const [queuedIdeas, setQueuedIdeas] = useState({}); // { [ideaId]: requestId }
  // Public recent-posts strip — last 10 downloads across all users. Populates
  // asynchronously; stays empty until someone generates something.
  const [recentPosts, setRecentPosts] = useState([]);
  useEffect(() => {
    fetchRecentGenerates(10).then(setRecentPosts);
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
      const res = await fetch('/api/ideas', {
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
          },
          count,
          seedIdea,
          // Master-admin notes — trades, draft, storylines. Empty string is
          // fine; the server prompt handles the no-context case.
          leagueContext: leagueCtx.notes || '',
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

  const buildLink = (s) => {
    const params = new URLSearchParams();
    params.set('template', s.templateId);
    if (s.team && s.team !== 'BLW') params.set('team', s.team);
    if (s.prefill) {
      Object.entries(s.prefill).forEach(([k, v]) => { if (v) params.set(k, v); });
    }
    return `/generate?${params.toString()}`;
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
    const noteLines = [
      s.headline,
      s.description,
      s.templateId ? `Template: ${s.templateId}` : null,
      s.prefill && Object.keys(s.prefill).length > 0
        ? `Prefill: ${Object.entries(s.prefill).map(([k, v]) => `${k}=${v}`).join(' · ')}`
        : null,
      s.aiGenerated ? 'Source: ✨ AI content idea' : 'Source: Dashboard content idea',
    ].filter(Boolean).join('\n');
    const newRequest = {
      id: crypto.randomUUID(),
      team: s.team && s.team !== 'BLW' ? s.team : 'BLW',
      template: s.templateId || '',
      status: 'pending',
      requester: 'You (Admin)',
      date: now.toLocaleString(undefined, { month: 'short', day: 'numeric' }),
      createdAt: now.getTime(),
      priority: 'medium',
      note: noteLines,
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

  // Pagination — applied to whichever list is currently displayed
  // (aiIdeas wins; deterministic suggestions fall through if empty).
  const ideasList = aiIdeas.length > 0 ? aiIdeas : suggestions;
  const { pageItems: ideasPageItems, pagerProps: ideasPagerProps } = useIdeaPagination(ideasList);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="Dashboard" subtitle="Draft, design, and track BLW content across every team" />

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

      {/* Recent posts — public feed of the last 10 downloads across the team.
          Click a thumbnail to re-open Generate with the same composition.
          Empty state hides the whole row until someone has actually posted. */}
      {recentPosts.length > 0 && (
        <RecentPostsStrip posts={recentPosts} />
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* LEFT — Content Suggestions */}
        <div style={{ flex: '1 1 500px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
              <SectionHeading style={{ margin: 0 }}>Content ideas</SectionHeading>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                <button
                  onClick={() => requestIdeas(null)}
                  disabled={ideasLoading || !dataLoaded}
                  title="Generate a fresh batch of AI-powered content ideas using the current BLW state"
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
                  {ideasLoading ? '…THINKING' : aiIdeas.length ? '✨ REGENERATE' : '✨ GENERATE IDEAS'}
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
            {/* Paginated view — shows IDEAS_PAGE_SIZE cards at a time with
                ‹ / › arrows when the rolling 14-day store has more. The
                pager hook auto-resets to page 1 when fresh ideas are
                prepended (so "More about Jaso" actually shows the new
                ones, not whatever page you were idling on). */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {ideasPageItems.map(s => (
                <IdeaCard
                  key={s.id}
                  idea={s}
                  queuedRequestId={queuedIdeas[s.id]}
                  ideasLoading={ideasLoading}
                  leagueContext={leagueCtx.notes || ''}
                  onQueue={queueIdeaAsRequest}
                  onOpenInGenerate={(idea) => navigate(buildLink(idea))}
                  onMoreLikeThis={(idea) => requestIdeas(idea, 3)}
                  onIdeaUpdate={patchIdea}
                />
              ))}
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

        {/* RIGHT — Queue + Standings */}
        <div style={{ flex: '0 1 340px', display: 'flex', flexDirection: 'column', gap: 16 }}>
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
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncate(str, n) {
  if (!str) return '';
  return str.length <= n ? str : str.slice(0, n - 1) + '…';
}

// Single live-state card at the top of the dashboard
// Public recent-posts feed — the last 10 downloads rendered as a horizontal
// thumbnail strip. Clicking a thumbnail restores its composition in Generate.
function RecentPostsStrip({ posts }) {
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

  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <SectionHeading style={{ margin: 0 }}>Recent posts</SectionHeading>
        <span style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, color: colors.textMuted, letterSpacing: 0.5 }}>
          LAST {posts.length} · PUBLIC
        </span>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 10,
      }}>
        {posts.map(post => {
          const team = post.team ? getTeam(post.team) : null;
          return (
            <Link
              key={post.id}
              to={buildRegenerateLink(post)}
              title={`${post.team || 'BLW'} · ${post.templateType || 'template'} · ${post.platform || ''} · click to re-open in Generate`}
              style={{ textDecoration: 'none', display: 'block' }}
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
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
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
              </div>
              <div style={{ padding: '6px 2px 0' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {post.templateType || 'post'}
                </div>
                <div style={{ fontSize: 10, fontFamily: fonts.condensed, color: colors.textMuted, letterSpacing: 0.3, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{post.platform || '—'}</span>
                  <span>{timeAgo(post.createdAt)}</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
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
