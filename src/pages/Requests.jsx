import { Fragment, useState, useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TEAMS, TEMPLATES, getTeam, getAllPlayersDirectory, playerSlug } from '../data';
import { Card, PageHeader, SectionHeading, TeamChip, TeamLogo, StatusBadge, PriorityDot, RedButton, OutlineButton, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { getRequests, saveRequests, getComments, saveComments, extractIdeaFromNote, buildGenerateLinkFromIdea, suggestAssetTypesForIdea } from '../requests-store';
import { stashIdeaForGenerate } from '../idea-context-store';
import { useAuth } from '../auth';
import { REQUEST_TYPES, getRequestType, getPriority } from '../request-types';
import { RequestModal } from '../request-modal';

const STATUS_LABELS = {
  pending: 'Pending',
  'in-progress': 'In Progress',
  approved: 'Approved',
  revision: 'Revision',
  completed: 'Completed',
};

const roleColors = {
  admin: { bg: '#DBEAFE', text: '#1E40AF' },
  team: { bg: '#D1FAE5', text: '#065F46' },
  athlete: { bg: '#FEF3C7', text: '#92400E' },
  owner: { bg: '#EDE9FE', text: '#5B21B6' },
};

export default function Requests() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get('status') || 'ALL';
  const typeFilter = searchParams.get('type') || 'ALL';
  const targetRequestId = searchParams.get('id');
  const { user, role } = useAuth();
  const isAthlete = role === 'athlete';
  // v4.5.63: master_admin gets the "remove request" trash icon — needed
  // for cleaning spam/test rows out of the queue. Non-master staff can
  // still decline rows but not nuke them.
  const isMaster = role === 'master_admin';
  // Roster for the player picker in the modal — fetched once on mount.
  // The store hits IDB so this is fast even on first render.
  const [roster, setRoster] = useState([]);
  useEffect(() => {
    getAllPlayersDirectory().then(list => {
      setRoster(list.map(p => ({
        team: p.team,
        firstInitial: p.firstInitial || (p.firstName || '').charAt(0).toUpperCase(),
        firstName: p.firstName || '',
        lastName: p.lastName,
        num: p.num || '',
      })));
    });
  }, []);
  // Maps request id → DOM node so we can scroll the deep-linked request
  // into view once it's rendered. Ref bag pattern so refs survive re-renders.
  const cardRefs = useRef({});
  // Tracks when a highlight flash on the target request should fade out.
  const [flashingId, setFlashingId] = useState(null);

  // Requests + comments persisted in localStorage so they survive refreshes
  // and drive the dashboard "N pending" card.
  const [requests, setRequestsState] = useState(() => getRequests());
  const [comments, setCommentsState] = useState(() => getComments());
  const [showNew, setShowNew] = useState(false);
  // Detail-panel expansion is independent of the comments thread because
  // the two surfaces are visually different and serve different jobs:
  // detail = "what does the brief actually ask for", comments = "what
  // are we saying about it." Both default to closed; deep-linked
  // requests auto-open the detail panel on first paint.
  const [expandedDetail, setExpandedDetail] = useState({});
  const [expandedComments, setExpandedComments] = useState({});
  const [commentInputs, setCommentInputs] = useState({});
  const [newTeam, setNewTeam] = useState('');
  const [newTemplate, setNewTemplate] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newNote, setNewNote] = useState('');

  // Persist on every change
  useEffect(() => { saveRequests(requests); }, [requests]);
  useEffect(() => { saveComments(comments); }, [comments]);

  // Deep-link handler: when arriving with ?id=..., clear any non-matching
  // status filter, scroll the card into view, and flash a highlight for a
  // few seconds. Runs after requests have loaded so the DOM node exists.
  useEffect(() => {
    if (!targetRequestId) return;
    const match = requests.find(r => r.id === targetRequestId);
    if (!match) return;
    // If a filter is hiding the target, clear it so the user sees the card.
    if (statusFilter !== 'ALL' && statusFilter !== match.status) {
      const next = new URLSearchParams(searchParams);
      next.delete('status');
      setSearchParams(next, { replace: true });
    }
    // Scroll + flash on the next tick once the row is rendered. We
    // also auto-open the detail panel so the linked request lands
    // already-expanded (the user clicked an in-app deep-link, so they
    // very likely want to read the full brief, not just the headline).
    setExpandedDetail(prev => prev[targetRequestId] ? prev : { ...prev, [targetRequestId]: true });
    const t = setTimeout(() => {
      const node = cardRefs.current[targetRequestId];
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setFlashingId(targetRequestId);
        setTimeout(() => setFlashingId(null), 2800);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [targetRequestId, requests, statusFilter]);

  const setRequests = (updater) => setRequestsState(prev => typeof updater === 'function' ? updater(prev) : updater);
  const setComments = (updater) => setCommentsState(prev => typeof updater === 'function' ? updater(prev) : updater);

  // Athletes see only their own requests — server already enforces
  // this on cloud reads, but we double-check client-side so a stale
  // localStorage cache from a different user doesn't leak. We compare
  // on requesterUserId first (authoritative), then fall back to email
  // for legacy rows that pre-date the user-id column.
  const visibleRequests = useMemo(() => {
    if (!isAthlete) return requests;
    return requests.filter(r =>
      (user?.id && r.requesterUserId === user.id) ||
      (user?.email && r.requesterEmail === user.email)
    );
  }, [requests, isAthlete, user?.id, user?.email]);

  const filteredByStatus = statusFilter === 'ALL'
    ? visibleRequests
    : visibleRequests.filter(r => r.status === statusFilter);
  const filtered = typeFilter === 'ALL'
    ? filteredByStatus
    : filteredByStatus.filter(r => (r.type || 'content') === typeFilter);

  const setStatusFilter = (status) => {
    const next = new URLSearchParams(searchParams);
    if (!status || status === 'ALL') next.delete('status');
    else next.set('status', status);
    setSearchParams(next, { replace: true });
  };
  const setTypeFilter = (type) => {
    const next = new URLSearchParams(searchParams);
    if (!type || type === 'ALL') next.delete('type');
    else next.set('type', type);
    setSearchParams(next, { replace: true });
  };

  const updateStatus = (id, status) => setRequests(rs => rs.map(r => r.id === id ? { ...r, status } : r));
  // v4.5.63: deny-with-reason. Captures the reason as a comment on the
  // request (so the queue shows WHY it was declined, not just that it
  // was), flips status, and opens a mailto: pre-filled with the
  // reason so the master can fire the "sorry, here's why" email in
  // one click. Stamped notifiedAt the same way the complete-notify
  // flow does so the chip reads correctly.
  const denyRequest = (id) => {
    const r = requests.find(x => x.id === id);
    if (!r) return;
    const reason = window.prompt('Reason for declining this request? (Visible to the requester in the email + on the request card.)', '');
    if (reason == null) return; // cancelled
    const trimmed = reason.trim();
    if (!trimmed) return;
    setRequests(rs => rs.map(x => x.id === id ? { ...x, status: 'declined', declineReason: trimmed } : x));
    setComments(prev => [...prev, {
      id: crypto.randomUUID(), requestId: id, author: 'You', role: 'admin',
      text: `Declined — ${trimmed}`,
      time: 'just now', createdAt: new Date().toISOString(),
    }]);
    // Pre-fill a mailto so the master can send the decline email in
    // one click. We don't auto-open it — that's annoying — but the
    // notify-style button will surface on the now-declined row.
    if (r.requesterEmail) {
      const subject = encodeURIComponent(`Re: ${r.title || r.type || 'your request'}`);
      const body = encodeURIComponent(
        `Hey ${r.requester || 'there'},\n\n` +
        `Thanks for sending this in — we're not going to be able to move forward with it.\n\n` +
        `Reason: ${trimmed}\n\n` +
        `Happy to talk through alternatives.\n\n— BLW Studio`
      );
      try { window.open(`mailto:${r.requesterEmail}?subject=${subject}&body=${body}`, '_blank'); } catch { /* user-gesture only — ok to swallow */ }
    }
  };
  // v4.5.63: master-only hard remove. Filters the row out of local
  // state; the cloud-sync layer will push the delete on next flush.
  const removeRequest = (id) => {
    if (!window.confirm('Permanently remove this request? This action cannot be undone.')) return;
    setRequests(rs => rs.filter(r => r.id !== id));
  };
  const toggleComments = (id) => setExpandedComments(prev => ({ ...prev, [id]: !prev[id] }));
  const toggleDetail = (id) => setExpandedDetail(prev => ({ ...prev, [id]: !prev[id] }));

  const addComment = (requestId) => {
    const text = commentInputs[requestId]?.trim();
    if (!text) return;
    setComments(prev => [...prev, {
      id: crypto.randomUUID(), requestId, author: 'You', role: 'admin', text,
      time: new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    }]);
    setCommentInputs(prev => ({ ...prev, [requestId]: '' }));
  };

  const submit = () => {
    if (!newTeam || !newTemplate) return;
    const now = new Date();
    setRequests(rs => [{
      id: crypto.randomUUID(),
      team: newTeam, template: newTemplate,
      status: 'pending', requester: 'You (Admin)',
      date: now.toLocaleString(undefined, { month: 'short', day: 'numeric' }),
      createdAt: now.getTime(),
      priority: newPriority, note: newNote,
    }, ...rs]);
    setShowNew(false); setNewTeam(''); setNewTemplate(''); setNewNote('');
  };

  const btnStyle = (bg) => ({
    background: bg, color: '#fff', border: 'none', borderRadius: radius.sm,
    padding: '7px 16px', fontFamily: fonts.body, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="REQUESTS"
        subtitle={isAthlete
          ? 'Your requests — content, profile updates, bug reports, and feature ideas. We\'ll email you when they\'re done.'
          : 'Requests across the league — content, profile updates, bugs, templates, features.'}
      >
        <RedButton onClick={() => setShowNew(true)}>+ New request</RedButton>
      </PageHeader>

      {/* Type filter chips — first row. Drives ?type= URL param so a
          status × type combo is bookmarkable. Athletes see fewer chips
          since their queue is smaller and types they can't pick are
          filtered upstream. */}
      {visibleRequests.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { key: 'ALL', icon: '☰', label: `All (${visibleRequests.length})`, palette: null },
            ...REQUEST_TYPES
              .map(t => ({
                key: t.id,
                icon: t.icon,
                label: `${t.label} (${visibleRequests.filter(r => (r.type || 'content') === t.id).length})`,
                palette: t.palette,
              }))
              .filter(c => isAthlete ? c.label.match(/\(\s*[1-9]\d*\s*\)/) || c.key === 'ALL' : true),
          ].map(chip => {
            const active = typeFilter === chip.key;
            const palette = chip.palette;
            return (
              <button
                key={chip.key}
                onClick={() => setTypeFilter(chip.key)}
                style={{
                  background: active && palette ? palette.bg : (active ? colors.text : colors.white),
                  color: active && palette ? palette.fg : (active ? '#fff' : colors.textSecondary),
                  border: `1px solid ${active && palette ? palette.border : (active ? colors.text : colors.borderLight)}`,
                  borderRadius: radius.full, padding: '6px 12px',
                  fontFamily: fonts.condensed, fontSize: 12, fontWeight: 700,
                  letterSpacing: 0.4,
                  cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  transition: 'background 160ms ease, color 160ms ease',
                }}
              >
                <span aria-hidden="true">{chip.icon}</span>
                {chip.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Status filter chips — second row. Same UX, different axis. */}
      {visibleRequests.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { key: 'ALL', label: `All status` },
            ...['pending', 'in-progress', 'revision', 'approved', 'completed'].map(s => ({
              key: s,
              label: `${STATUS_LABELS[s]} (${visibleRequests.filter(r => r.status === s).length})`,
            })),
          ].map(chip => {
            const active = statusFilter === chip.key;
            return (
              <button
                key={chip.key}
                onClick={() => setStatusFilter(chip.key)}
                style={{
                  background: active ? colors.red : colors.white,
                  color: active ? '#fff' : colors.textSecondary,
                  border: `1px solid ${active ? colors.red : colors.borderLight}`,
                  borderRadius: radius.full, padding: '6px 12px',
                  fontFamily: fonts.condensed, fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >{chip.label}</button>
            );
          })}
        </div>
      )}

      {/* New request modal — replaces the inline form. Single
          progressive form with type picker at the top so the user
          sees the whole shape of what they're submitting at a glance. */}
      <RequestModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onSubmitted={(req) => setRequests(rs => [req, ...rs])}
        roster={roster}
      />

      {filtered.length === 0 && !showNew && (
        <Card style={{ padding: 36, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.3 }}>☰</div>
          <div style={{ fontFamily: fonts.body, fontSize: 18, fontWeight: 700, color: colors.text, marginBottom: 4 }}>
            {statusFilter === 'ALL' && typeFilter === 'ALL'
              ? (isAthlete ? 'No requests yet' : 'No open requests')
              : `No matching requests`}
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 14, maxWidth: '50ch', marginInline: 'auto' }}>
            {statusFilter === 'ALL' && typeFilter === 'ALL'
              ? (isAthlete
                  ? 'Submit a request — content you want made, a profile update, a bug, or a feature idea. You\'ll be emailed when it\'s done.'
                  : 'When athletes, owners, or staff ask for content, profile updates, bug fixes, or new features, their requests land here.')
              : 'Nothing matches that combo right now.'}
          </div>
          {statusFilter === 'ALL' && typeFilter === 'ALL'
            ? <RedButton onClick={() => setShowNew(true)}>+ New request</RedButton>
            : <OutlineButton onClick={() => { setStatusFilter('ALL'); setTypeFilter('ALL'); }}>Clear filters</OutlineButton>}
        </Card>
      )}

      {filtered.map(r => {
        const tp = TEMPLATES.find(t => t.id === r.template);
        const reqType = getRequestType(r.type || 'content');
        const priorityMeta = getPriority(r.priority);
        const reqComments = comments.filter(c => c.requestId === r.id);
        const expanded = expandedComments[r.id];
        const isFlashing = flashingId === r.id;
        // Pull the structured idea-payload out of the note (if any).
        // Old requests without a payload fall back to plain prose +
        // a degraded detail panel that just shows what we have.
        const { prose, idea } = extractIdeaFromNote(r.note);
        const detailOpen = !!expandedDetail[r.id];
        const teamMeta = getTeam(r.team);
        // needBy date relative to today — "5 days" / "tomorrow" / "OVERDUE"
        const needByLabel = (() => {
          if (!r.needBy) return null;
          const target = new Date(r.needBy);
          if (isNaN(target.getTime())) return null;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
          if (diffDays < 0) return { label: `Overdue by ${Math.abs(diffDays)}d`, color: '#991B1B' };
          if (diffDays === 0) return { label: 'Due today', color: '#92400E' };
          if (diffDays === 1) return { label: 'Due tomorrow', color: '#92400E' };
          if (diffDays <= 7) return { label: `Due in ${diffDays}d`, color: colors.textSecondary };
          return { label: `Due ${target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, color: colors.textMuted };
        })();
        // Build a /generate?... URL from the request. If we have the
        // structured idea, use it directly AND stash it for the brief
        // context drawer in Generate. Otherwise fall back to a partial
        // URL with whatever flat fields the request carries.
        const generateLink = idea
          ? buildGenerateLinkFromIdea({ ...idea, requestId: r.id })
          : buildGenerateLinkFromIdea({
              templateId: r.template,
              team: r.team,
              prefill: {},
              requestId: r.id,
            });
        // Stash on render so the next click into Generate has the
        // payload waiting in sessionStorage. Cheap — one
        // sessionStorage write per render of an open card.
        if (idea) stashIdeaForGenerate({ ...idea, requestId: r.id });

        return (
          <div key={r.id} ref={node => { if (node) cardRefs.current[r.id] = node; }}>
            <Card style={{
              outline: isFlashing ? `3px solid ${colors.red}` : 'none',
              boxShadow: isFlashing ? '0 0 0 4px rgba(220,38,38,0.15)' : undefined,
              transition: 'outline 0.3s ease, box-shadow 0.3s ease',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              {/* Type badge — anchored left so the eye reads category
                  before anything else. Tinted with the type's palette
                  so similar requests cluster visually. */}
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: reqType.palette.bg,
                color: reqType.palette.fg,
                border: `1px solid ${reqType.palette.border}`,
                padding: '3px 9px', borderRadius: radius.sm,
                fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
                letterSpacing: 0.5, textTransform: 'uppercase',
              }}>
                <span aria-hidden="true">{reqType.icon}</span>
                {reqType.label}
              </span>
              {/* Priority dot now reads against a critical-aware palette */}
              <span
                title={`${priorityMeta.label} priority — ${priorityMeta.description}`}
                style={{
                  display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                  background: priorityMeta.dotColor,
                }}
              />
              {/* Critical priority gets a literal label too — too consequential to encode in just a dot color */}
              {r.priority === 'critical' && (
                <span style={{
                  fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
                  letterSpacing: 0.6, color: '#7C2D12',
                  background: 'rgba(124, 45, 18, 0.10)',
                  border: '1px solid rgba(124, 45, 18, 0.30)',
                  padding: '2px 6px', borderRadius: radius.sm,
                  textTransform: 'uppercase',
                }}>CRITICAL</span>
              )}
              {r.team && r.team !== 'BLW' && <TeamChip teamId={r.team} withLogo />}
              {r.playerLastName && (
                <span style={{
                  fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                  color: colors.textSecondary, letterSpacing: 0.4,
                }}>
                  {r.playerFirstInitial && `${r.playerFirstInitial}.`}{r.playerLastName}
                </span>
              )}
              <div style={{ flex: 1 }} />
              {needByLabel && (
                <span style={{
                  fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                  color: needByLabel.color,
                  letterSpacing: 0.4,
                }}>{needByLabel.label}</span>
              )}
              <StatusBadge status={r.status} />
            </div>

            {/* Title — second line, headline weight. Falls back to the
                template name for legacy rows that pre-date the title
                column (every old row has a template field). */}
            <div style={{
              fontSize: 16, fontWeight: 700, color: colors.text,
              marginBottom: 6,
              display: 'flex', alignItems: 'baseline', gap: 6,
              flexWrap: 'wrap',
            }}>
              {r.title || (tp?.name ? `${tp?.icon || ''} ${tp.name}` : r.template || 'Untitled')}
              {tp && r.title && (
                <span style={{
                  fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                  color: colors.textMuted, letterSpacing: 0.4,
                }}>· {tp.icon} {tp.name}</span>
              )}
            </div>

            {/* Plain-prose summary — no JSON sentinel, no Prefill: line.
                Stays compact (3-line clamp) so the card preview reads
                like a brief, not a wall of metadata. The full detail
                lives in the disclosure below. */}
            {prose && (
              <div style={{
                fontSize: 14, color: colors.textSecondary,
                marginBottom: 10, paddingLeft: 20,
                lineHeight: 1.5,
                display: '-webkit-box',
                WebkitLineClamp: detailOpen ? 'unset' : 3,
                WebkitBoxOrient: 'vertical',
                overflow: detailOpen ? 'visible' : 'hidden',
                whiteSpace: 'pre-wrap',
              }}>{prose}</div>
            )}

            {/* Detail-panel disclosure — opens an editorial brief view:
                narrative, suggested template/photos, structured prefill,
                and a one-click jump back into Generate. */}
            <div style={{ paddingLeft: 20, marginBottom: detailOpen ? 12 : 6 }}>
              <button
                onClick={() => toggleDetail(r.id)}
                style={{
                  background: detailOpen ? colors.bg : 'transparent',
                  border: `1px solid ${detailOpen ? colors.border : 'transparent'}`,
                  borderRadius: radius.sm,
                  padding: '5px 10px',
                  fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                  letterSpacing: 0.5, textTransform: 'uppercase',
                  color: colors.textSecondary, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                {detailOpen ? '▾' : '▸'} {idea ? 'Brief details' : 'Details'}
                {idea?.aiGenerated && (
                  <span style={{
                    fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
                    background: 'rgba(124,58,237,0.10)',
                    color: '#7C3AED',
                    border: '1px solid rgba(124,58,237,0.30)',
                    padding: '1px 6px', borderRadius: radius.sm,
                    letterSpacing: 0.5,
                  }}>AI</span>
                )}
              </button>
            </div>

            {detailOpen && (
              <RequestDetailPanel
                request={r}
                idea={idea}
                template={tp}
                team={teamMeta}
                generateLink={generateLink}
              />
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 20, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: colors.textMuted }}>
                {r.requester} · {r.date}
                {r.requesterEmail && !isAthlete && <> · <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{r.requesterEmail}</span></>}
              </span>
              <div style={{ flex: 1 }} />

              {/* "Open in Generate" only renders for content requests —
                  bug / feature / template / integration requests don't
                  have a meaningful Generate target. Athletes never see
                  this since the Files / Generate flow is staff-side. */}
              {(r.type || 'content') === 'content' && !isAthlete && (
                <Link
                  to={generateLink}
                  style={{
                    background: colors.red, color: '#fff',
                    border: 'none', borderRadius: radius.sm,
                    padding: '7px 14px', textDecoration: 'none',
                    fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800,
                    letterSpacing: 0.6, textTransform: 'uppercase',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                  title={idea ? 'Open Generate with team, template, and all idea fields pre-filled' : 'Open Generate pre-selected to this team + template'}
                >Open in Generate →</Link>
              )}

              {/* Notify requester — surfaces ONLY when status='completed'
                  AND we have an email on the row AND the user isn't an
                  athlete (athletes see only their own requests, no need
                  to notify themselves). Opens a pre-filled mailto: so
                  the master can send the "your request is done" email
                  in one click. notified_at gets stamped when clicked so
                  duplicate sends are avoided. Real Resend/SendGrid
                  pipeline lands later. */}
              {!isAthlete && r.status === 'completed' && r.requesterEmail && (
                <NotifyButton
                  request={r}
                  onMarkNotified={() => setRequests(rs => rs.map(x => x.id === r.id ? { ...x, notifiedAt: new Date().toISOString() } : x))}
                />
              )}

              <button onClick={() => toggleComments(r.id)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, color: colors.textSecondary,
                fontFamily: fonts.body, padding: '4px 8px',
              }}>
                {reqComments.length} comment{reqComments.length !== 1 ? 's' : ''}
              </button>

              {/* Status-flip buttons — staff-only. Athletes see status
                  updates (via the badge above) but can't drive the
                  workflow forward themselves. */}
              {!isAthlete && r.status === 'pending' && (
                <>
                  <button onClick={() => updateStatus(r.id, 'in-progress')} style={btnStyle('#3B82F6')}>Start</button>
                  <button onClick={() => updateStatus(r.id, 'approved')} style={btnStyle('#22C55E')}>Approve</button>
                  {/* v4.5.63: Deny — prompts for a reason, captures it
                      as a comment, flips status to 'declined', and
                      opens a mailto so the requester gets the reason
                      directly in their inbox. */}
                  <button onClick={() => denyRequest(r.id)} style={btnStyle('#DC2626')}>Deny</button>
                </>
              )}
              {/* v4.5.63: master-only permanent remove. Sits all the way
                  to the right so it doesn't compete with the primary
                  status-flip CTAs on every row. */}
              {isMaster && (
                <button
                  onClick={() => removeRequest(r.id)}
                  title="Master admin — permanently remove this request"
                  style={{
                    ...btnStyle('#6B7280'),
                    marginLeft: 'auto',
                  }}
                >🗑 Remove</button>
              )}
              {!isAthlete && r.status === 'in-progress' && (
                <>
                  <button onClick={() => updateStatus(r.id, 'revision')} style={btnStyle('#EF4444')}>Revision</button>
                  <button onClick={() => updateStatus(r.id, 'completed')} style={btnStyle('#22C55E')}>Complete</button>
                </>
              )}
              {!isAthlete && r.status === 'revision' && (
                <button onClick={() => updateStatus(r.id, 'in-progress')} style={btnStyle('#3B82F6')}>Resume</button>
              )}
            </div>

            {expanded && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.divider}`, paddingLeft: 16 }}>
                {reqComments.length === 0 && (
                  <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 10 }}>No comments yet.</div>
                )}
                {reqComments.map(c => {
                  const rc = roleColors[c.role] || roleColors.admin;
                  // Thread-reply indent — structural, kept at 1px so it
                  // reads as a divider rather than an accent stripe.
                  return (
                    <div key={c.id} style={{ marginBottom: 10, paddingLeft: 12, borderLeft: `1px solid ${rc.bg}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>{c.author}</span>
                        <span style={{
                          fontSize: 11, fontFamily: fonts.condensed, fontWeight: 700,
                          padding: '3px 10px', borderRadius: radius.sm,
                          background: rc.bg, color: rc.text, textTransform: 'uppercase', letterSpacing: 0.4,
                        }}>{c.role}</span>
                        <span style={{ fontSize: 11, color: colors.textMuted }}>{c.time}</span>
                      </div>
                      <div style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 1.5 }}>{c.text}</div>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input
                    type="text"
                    value={commentInputs[r.id] || ''}
                    onChange={e => setCommentInputs(prev => ({ ...prev, [r.id]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && addComment(r.id)}
                    placeholder="Add a comment..."
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <RedButton onClick={() => addComment(r.id)} disabled={!commentInputs[r.id]?.trim()} style={{ padding: '8px 16px', fontSize: 12 }}>
                    Post
                  </RedButton>
                </div>
              </div>
            )}
            </Card>
          </div>
        );
      })}
    </div>
  );
}

// ─── Request detail panel ──────────────────────────────────────────────────
// Editorial brief view that opens when a request card's "Brief details"
// disclosure is expanded. Renders the structured idea (when one is
// embedded) as four readable sections: narrative, suggested template,
// suggested photo asset types, and the prefill that will land in
// Generate. Older requests without an embedded idea fall back to a
// minimal version that still lists the template + team.
function RequestDetailPanel({ request, idea, template, team, generateLink }) {
  const r = request;
  const i = idea;
  const teamColor = team?.color || colors.text;
  const teamDark  = team?.dark  || colors.text;

  // Player surfaced from the prefill (if any). Drives the "look for
  // photos of X" prompt below and a deep-link chip back to the player
  // page so the user can grab a stat refresher in one click.
  const playerName = i?.prefill?.playerName ? String(i.prefill.playerName).trim() : '';
  const playerLast = playerName ? playerName.split(/\s+/).pop() : '';
  const playerHref = (team?.slug && playerLast)
    ? `/teams/${team.slug}/players/${playerSlug({ name: playerName, lastName: playerLast })}`
    : null;

  // Asset-type suggestions: e.g. ['HEADSHOT','PORTRAIT','ACTION'].
  // Combined with the player chip below, this answers "what photos
  // should I be reaching for?" — the original ask from the user.
  const assetTypes = useMemo(() => suggestAssetTypesForIdea(i || { templateId: r.template }), [i, r.template]);

  // Stat pills — only present when the AI surfaced concrete numbers.
  const stats = Array.isArray(i?.dataPoints) ? i.dataPoints.filter(Boolean) : [];

  // Prefill key/value listing — power-user mode. Hidden when empty.
  const prefillEntries = i?.prefill && typeof i.prefill === 'object'
    ? Object.entries(i.prefill).filter(([, v]) => v != null && v !== '')
    : [];

  return (
    <div style={{
      margin: '0 0 14px 20px',
      padding: 14,
      background: colors.bg,
      border: `1px solid ${colors.borderLight}`,
      borderRadius: radius.base,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* Headline strip — only renders when the embedded idea has one.
          Tinted with the team color so the panel reads as "this is a
          brief about {team}." */}
      {i?.headline && (
        <div>
          <div style={{
            fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
            color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
            marginBottom: 4,
          }}>Headline</div>
          <div style={{
            fontFamily: fonts.heading, fontSize: 18, lineHeight: 1.25,
            color: teamDark,
            letterSpacing: 0.4,
          }}>{i.headline}</div>
        </div>
      )}

      {/* Narrative — the AI's reasoning for why this idea matters.
          Falls back to description when narrative is missing. */}
      {(i?.narrative || i?.description) && (
        <div>
          <div style={{
            fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
            color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
            marginBottom: 4,
          }}>Narrative</div>
          <div style={{
            fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary,
            lineHeight: 1.55, whiteSpace: 'pre-wrap', maxWidth: '70ch',
          }}>{i.narrative || i.description}</div>
        </div>
      )}

      {/* Stat pills — surface the data points the AI cited. Helpful
          context for whoever picks up the request days later. */}
      {stats.length > 0 && (
        <div>
          <div style={{
            fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
            color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
            marginBottom: 6,
          }}>Stats cited</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {stats.map((s, idx) => (
              <span
                key={idx}
                className="tnum"
                style={{
                  fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                  letterSpacing: 0.3, color: teamDark,
                  background: `${teamColor}1A`,
                  border: `1px solid ${teamColor}33`,
                  padding: '3px 8px', borderRadius: radius.sm,
                }}
              >{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions row — what to reach for. Three grouped suggestions:
          template, photos, player. Together these answer "what should
          I open in Generate, and which assets should I drop in?" */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 10,
      }}>
        {/* Template suggestion */}
        <div style={{
          background: colors.white,
          border: `1px solid ${colors.borderLight}`,
          borderRadius: radius.sm,
          padding: '10px 12px',
        }}>
          <div style={{
            fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
            color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
            marginBottom: 6,
          }}>Suggested template</div>
          {template ? (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: fonts.body, fontSize: 13, fontWeight: 700,
              color: colors.text,
            }}>
              <span aria-hidden="true">{template.icon}</span>
              {template.name}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic' }}>
              No template specified — pick one in Generate.
            </div>
          )}
        </div>

        {/* Photo-asset suggestion */}
        <div style={{
          background: colors.white,
          border: `1px solid ${colors.borderLight}`,
          borderRadius: radius.sm,
          padding: '10px 12px',
        }}>
          <div style={{
            fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
            color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
            marginBottom: 6,
          }}>Photos to reach for</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {assetTypes.map(t => (
              <span key={t} style={{
                fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
                letterSpacing: 0.6, textTransform: 'uppercase',
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                color: colors.textSecondary,
                padding: '2px 7px', borderRadius: radius.sm,
              }}>{t}</span>
            ))}
          </div>
          {playerLast && (
            <div style={{
              marginTop: 6, fontSize: 12, color: colors.textSecondary,
            }}>
              of <strong>{playerName}</strong>
            </div>
          )}
        </div>

        {/* Player suggestion (only when the idea targets a player) */}
        {playerLast && (
          <div style={{
            background: colors.white,
            border: `1px solid ${colors.borderLight}`,
            borderRadius: radius.sm,
            padding: '10px 12px',
          }}>
            <div style={{
              fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
              color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
              marginBottom: 6,
            }}>Featured player</div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              {team && <TeamLogo teamId={team.id} size={18} rounded="square" />}
              {playerHref ? (
                <Link to={playerHref} style={{
                  fontFamily: fonts.body, fontSize: 13, fontWeight: 700,
                  color: teamDark, textDecoration: 'none',
                  borderBottom: `1px dotted ${colors.border}`,
                }}>{playerName}</Link>
              ) : (
                <span style={{
                  fontFamily: fonts.body, fontSize: 13, fontWeight: 700,
                  color: colors.text,
                }}>{playerName}</span>
              )}
              {i?.prefill?.number && (
                <span style={{
                  fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                  color: colors.textMuted,
                }}>#{i.prefill.number}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Generate prefill — a flat key/value list so the user can see at
          a glance exactly what's about to land in the canvas fields.
          Power-user reassurance more than a primary surface. */}
      {prefillEntries.length > 0 && (
        <div>
          <div style={{
            fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
            color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase',
            marginBottom: 6,
          }}>Generate prefill</div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px',
            fontSize: 12,
          }}>
            {prefillEntries.map(([k, v]) => (
              <Fragment key={k}>
                <span style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  color: colors.textMuted, fontSize: 11,
                  paddingTop: 2,
                }}>{k}</span>
                <span style={{
                  fontFamily: fonts.body, color: colors.text,
                  fontWeight: 600, wordBreak: 'break-word',
                }}>{String(v)}</span>
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {/* CTA — the same primary action as the request card row, repeated
          in the panel so the user doesn't have to scroll back up to act.
          Caption "with prefill" only when we actually have one. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 4 }}>
        <Link
          to={generateLink}
          style={{
            background: colors.red, color: '#fff',
            border: 'none', borderRadius: radius.sm,
            padding: '8px 16px', textDecoration: 'none',
            fontFamily: fonts.condensed, fontSize: 12, fontWeight: 800,
            letterSpacing: 0.6, textTransform: 'uppercase',
          }}
        >
          {prefillEntries.length > 0 ? 'Open Generate (auto-populate)' : 'Open in Generate'} →
        </Link>
        <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.body }}>
          {prefillEntries.length > 0
            ? 'Team, template, and every prefill field will land pre-set on the canvas.'
            : 'Team and template will be pre-selected; fill in the rest yourself.'}
        </span>
      </div>
    </div>
  );
}

// ─── Notify requester button ───────────────────────────────────────────────
// Opens the user's default mail client with a pre-filled "Your request
// is done" email and stamps `notifiedAt` on the request so a follow-up
// click reads as "Re-notify" instead of fresh. Resend/SendGrid pipeline
// can land later; this gets the master admin a one-click path to the
// requester's inbox today.
function NotifyButton({ request, onMarkNotified }) {
  const r = request;
  const subject = encodeURIComponent(`✅ Your BLW Studio request is done — ${r.title || r.template || 'request'}`);
  const greeting = r.requester || 'there';
  const teamLine = r.team && r.team !== 'BLW' ? `\nTeam: ${r.team}` : '';
  const titleLine = r.title ? `\nWhat: ${r.title}` : '';
  const body = encodeURIComponent(
    `Hey ${greeting},\n\n` +
    `Your request is complete and live in the BLW Studio.\n` +
    teamLine + titleLine + `\n\n` +
    `Let me know if anything needs to be tweaked — happy to revise.\n\n` +
    `— BLW Studio`
  );
  const href = `mailto:${r.requesterEmail}?subject=${subject}&body=${body}`;
  const alreadyNotified = !!r.notifiedAt;
  return (
    <a
      href={href}
      onClick={() => onMarkNotified?.()}
      title={alreadyNotified
        ? `Already notified ${new Date(r.notifiedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} — click to send again`
        : `Open mail client to email ${r.requesterEmail}`}
      style={{
        background: alreadyNotified ? colors.bg : '#22C55E',
        color: alreadyNotified ? colors.textSecondary : '#fff',
        border: alreadyNotified ? `1px solid ${colors.border}` : 'none',
        borderRadius: radius.sm,
        padding: '7px 14px',
        textDecoration: 'none',
        fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800,
        letterSpacing: 0.6, textTransform: 'uppercase',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}
    >
      ✉ {alreadyNotified ? 'Re-notify' : 'Notify requester'}
    </a>
  );
}
