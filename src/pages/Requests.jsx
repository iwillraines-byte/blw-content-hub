import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TEAMS, TEMPLATES, getTeam } from '../data';
import { Card, PageHeader, SectionHeading, TeamChip, StatusBadge, PriorityDot, RedButton, OutlineButton, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { getRequests, saveRequests, getComments, saveComments } from '../requests-store';

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
  const targetRequestId = searchParams.get('id');
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
    // Scroll + flash on the next tick once the row is rendered.
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

  const filtered = statusFilter === 'ALL'
    ? requests
    : requests.filter(r => r.status === statusFilter);

  const setStatusFilter = (status) => {
    const next = new URLSearchParams(searchParams);
    if (!status || status === 'ALL') next.delete('status');
    else next.set('status', status);
    setSearchParams(next, { replace: true });
  };

  const updateStatus = (id, status) => setRequests(rs => rs.map(r => r.id === id ? { ...r, status } : r));
  const toggleComments = (id) => setExpandedComments(prev => ({ ...prev, [id]: !prev[id] }));

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
      <PageHeader title="REQUESTS" subtitle="Content requests from athletes, owners, managers, and internal team">
        <OutlineButton onClick={() => setShowNew(!showNew)} style={showNew ? { background: '#FEE2E2', color: '#DC2626', borderColor: '#FECACA' } : {}}>
          {showNew ? 'Cancel' : '+ New Request'}
        </OutlineButton>
      </PageHeader>

      {/* Status filter chips — reflect / drive the ?status= URL param */}
      {requests.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { key: 'ALL', label: `All (${requests.length})` },
            ...['pending', 'in-progress', 'revision', 'approved', 'completed'].map(s => ({
              key: s,
              label: `${STATUS_LABELS[s]} (${requests.filter(r => r.status === s).length})`,
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
                  border: `1px solid ${active ? colors.red : colors.border}`,
                  borderRadius: radius.full, padding: '7px 16px',
                  fontFamily: fonts.condensed, fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >{chip.label}</button>
            );
          })}
        </div>
      )}

      {showNew && (
        <Card style={{ border: `1px solid ${colors.redBorder}` }}>
          <SectionHeading>New request</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.body, fontWeight: 600 }}>Team</label>
              <select value={newTeam} onChange={e => setNewTeam(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
                <option value="">Select...</option>
                {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.body, fontWeight: 600 }}>Type</label>
              <select value={newTemplate} onChange={e => setNewTemplate(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
                <option value="">Select...</option>
                {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.body, fontWeight: 600 }}>Priority</label>
              <select value={newPriority} onChange={e => setNewPriority(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Notes..." style={{ ...inputStyle, minHeight: 60, resize: 'vertical', marginBottom: 12 }} />
          <RedButton onClick={submit} disabled={!newTeam || !newTemplate}>Submit Request</RedButton>
        </Card>
      )}

      {filtered.length === 0 && !showNew && (
        <Card style={{ padding: 36, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.3 }}>☰</div>
          <div style={{ fontFamily: fonts.body, fontSize: 18, fontWeight: 700, color: colors.text, marginBottom: 4 }}>
            {statusFilter === 'ALL' ? 'No open requests' : `No ${(STATUS_LABELS[statusFilter] || statusFilter).toLowerCase()} requests`}
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 14 }}>
            {statusFilter === 'ALL'
              ? 'When athletes, owners, or team managers ask for content, their requests land here.'
              : `Nothing matching that status right now.`}
          </div>
          {statusFilter === 'ALL'
            ? <OutlineButton onClick={() => setShowNew(true)}>+ New Request</OutlineButton>
            : <OutlineButton onClick={() => setStatusFilter('ALL')}>Clear filter</OutlineButton>}
        </Card>
      )}

      {filtered.map(r => {
        const tp = TEMPLATES.find(t => t.id === r.template);
        const reqComments = comments.filter(c => c.requestId === r.id);
        const expanded = expandedComments[r.id];
        const isFlashing = flashingId === r.id;

        return (
          <div key={r.id} ref={node => { if (node) cardRefs.current[r.id] = node; }}>
            <Card style={{
              outline: isFlashing ? `3px solid ${colors.red}` : 'none',
              boxShadow: isFlashing ? '0 0 0 4px rgba(220,38,38,0.15)' : undefined,
              transition: 'outline 0.3s ease, box-shadow 0.3s ease',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <PriorityDot p={r.priority} />
              <TeamChip teamId={r.team} withLogo />
              <span style={{ fontSize: 16, fontWeight: 700, color: colors.text }}>{tp?.icon} {tp?.name || r.template}</span>
              <div style={{ flex: 1 }} />
              <StatusBadge status={r.status} />
            </div>

            <div style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 10, paddingLeft: 20, lineHeight: 1.5 }}>{r.note}</div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 20, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: colors.textMuted }}>{r.requester} · {r.date}</span>
              <div style={{ flex: 1 }} />

              <button onClick={() => toggleComments(r.id)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, color: colors.textSecondary,
                fontFamily: fonts.body, padding: '4px 8px',
              }}>
                {reqComments.length} comment{reqComments.length !== 1 ? 's' : ''}
              </button>

              {r.status === 'pending' && (
                <>
                  <button onClick={() => updateStatus(r.id, 'in-progress')} style={btnStyle('#3B82F6')}>Start</button>
                  <button onClick={() => updateStatus(r.id, 'approved')} style={btnStyle('#22C55E')}>Approve</button>
                </>
              )}
              {r.status === 'in-progress' && (
                <>
                  <button onClick={() => updateStatus(r.id, 'revision')} style={btnStyle('#EF4444')}>Revision</button>
                  <button onClick={() => updateStatus(r.id, 'completed')} style={btnStyle('#22C55E')}>Complete</button>
                </>
              )}
              {r.status === 'revision' && (
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
