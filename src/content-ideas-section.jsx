// ContentIdeasSection — drop-in renderer for a filtered list of saved
// content ideas. Used on both the team page (filtered by team) and the
// player page (filtered by team + last name).
//
// Owns its own queue + open-in-generate handlers so the host page only
// has to provide filters and an optional title — same UX as the
// dashboard, minus "More like this" (regen lives only on the dashboard
// where the full BLW context is in scope).

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, SectionHeading } from './components';
import { colors, fonts, radius } from './theme';
import { useContentIdeas } from './content-ideas-store';
import { useToast } from './toast';
import { getRequests, saveRequests } from './requests-store';
import IdeaCard from './idea-card';
import { useLeagueContext } from './league-context';

export function ContentIdeasSection({
  team = null,             // 'AZS' | null
  player = null,           // 'JASO' (lastname) | null
  title = 'Content ideas',
  emptyMessage = 'No content ideas yet. Generate fresh ideas from the dashboard and they\'ll show here.',
  limit = 12,
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const leagueCtx = useLeagueContext();
  const ideasStore = useContentIdeas({ team, player, limit });
  const ideas = ideasStore.ideas;

  // Per-card "queued" badge state — same shape as the dashboard's so the
  // IdeaCard renders the post-queue chip identically.
  const [queuedIdeas, setQueuedIdeas] = useState({});
  useEffect(() => {
    const keys = Object.keys(queuedIdeas);
    if (keys.length === 0) return;
    const t = setTimeout(() => setQueuedIdeas({}), 8000);
    return () => clearTimeout(t);
  }, [queuedIdeas]);

  const buildLink = useCallback((s) => {
    const params = new URLSearchParams();
    if (s.templateId) params.set('template', s.templateId);
    if (s.team && s.team !== 'BLW') params.set('team', s.team);
    if (s.prefill) {
      Object.entries(s.prefill).forEach(([k, v]) => { if (v) params.set(k, v); });
    }
    return `/generate?${params.toString()}`;
  }, []);

  const queueIdeaAsRequest = useCallback((s) => {
    const existing = getRequests();
    // Idempotent-ish: skip if same headline/team queued in the last 60s.
    const dup = existing.find(r =>
      r.note?.startsWith(s.headline) && r.team === (s.team || 'BLW') &&
      r.createdAt && (Date.now() - r.createdAt) < 60_000
    );
    if (dup) {
      setQueuedIdeas(prev => ({ ...prev, [s.id]: dup.id }));
      return;
    }
    const now = new Date();
    const noteLines = [
      s.headline,
      s.narrative || s.description,
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
    setQueuedIdeas(prev => ({ ...prev, [s.id]: newRequest.id }));
    toast.success('Request queued', {
      detail: s.headline,
      action: { label: 'VIEW', onClick: () => navigate(`/requests?id=${newRequest.id}`) },
    });
  }, [navigate, toast]);

  // Don't render the card at all if the section is empty AND we're on a
  // surface where empty is the boring default (player pages will have lots
  // of player-specific empties; we hide rather than nag). Team pages can
  // still benefit from showing the empty state since users are likely to
  // want to know.
  const hideWhenEmpty = !!player;
  if (ideasStore.loaded && ideas.length === 0 && hideWhenEmpty) return null;

  return (
    <Card>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10,
        flexWrap: 'wrap', marginBottom: 4,
      }}>
        <SectionHeading style={{ margin: 0 }}>{title}</SectionHeading>
        {ideas.length > 0 && (
          <span style={{
            fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
            color: colors.textMuted, letterSpacing: 0.5,
          }}>{ideas.length} · LAST 14 DAYS</span>
        )}
      </div>

      {!ideasStore.loaded && (
        <div style={{ padding: 20, color: colors.textMuted, fontSize: 12, fontFamily: fonts.condensed }}>
          Loading ideas…
        </div>
      )}

      {ideasStore.loaded && ideas.length === 0 && (
        <div style={{
          padding: '24px 20px', textAlign: 'center',
          background: colors.bg, borderRadius: radius.base,
          border: `1px dashed ${colors.borderLight}`,
          marginTop: 8,
        }}>
          <div style={{ fontSize: 24, marginBottom: 6 }}>✨</div>
          <div style={{
            fontSize: 13, color: colors.textSecondary,
            maxWidth: 360, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5,
          }}>{emptyMessage}</div>
        </div>
      )}

      {ideas.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
          {ideas.map(idea => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              queuedRequestId={queuedIdeas[idea.id]}
              ideasLoading={false}
              leagueContext={leagueCtx.notes || ''}
              onQueue={queueIdeaAsRequest}
              onOpenInGenerate={(i) => navigate(buildLink(i))}
              onIdeaUpdate={ideasStore.patchIdea}
              // Intentionally NO onMoreLikeThis — that's a dashboard-only
              // affordance (it needs the full BLW context to seed a regen).
            />
          ))}
        </div>
      )}
    </Card>
  );
}
