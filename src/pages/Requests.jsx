import { useState } from 'react';
import { TEAMS, TEMPLATES, getTeam } from '../data';
import { Card, PageHeader, SectionHeading, TeamChip, StatusBadge, PriorityDot, RedButton, OutlineButton, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';

// Requests and comments start empty — real requests are created via the UI.
const INITIAL_REQUESTS = [];
const INITIAL_COMMENTS = [];

const roleColors = {
  admin: { bg: '#DBEAFE', text: '#1E40AF' },
  team: { bg: '#D1FAE5', text: '#065F46' },
  athlete: { bg: '#FEF3C7', text: '#92400E' },
  owner: { bg: '#EDE9FE', text: '#5B21B6' },
};

export default function Requests({ teamFilter }) {
  const [requests, setRequests] = useState(INITIAL_REQUESTS);
  const [comments, setComments] = useState(INITIAL_COMMENTS);
  const [showNew, setShowNew] = useState(false);
  const [expandedComments, setExpandedComments] = useState({});
  const [commentInputs, setCommentInputs] = useState({});
  const [newTeam, setNewTeam] = useState('');
  const [newTemplate, setNewTemplate] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newNote, setNewNote] = useState('');

  const filtered = requests.filter(r => teamFilter === 'ALL' || r.team === teamFilter);
  const updateStatus = (id, status) => setRequests(rs => rs.map(r => r.id === id ? { ...r, status } : r));
  const toggleComments = (id) => setExpandedComments(prev => ({ ...prev, [id]: !prev[id] }));

  const addComment = (requestId) => {
    const text = commentInputs[requestId]?.trim();
    if (!text) return;
    setComments(prev => [...prev, {
      id: prev.length + 1, requestId, author: 'You', role: 'admin', text, time: 'Just now',
    }]);
    setCommentInputs(prev => ({ ...prev, [requestId]: '' }));
  };

  const submit = () => {
    if (!newTeam || !newTemplate) return;
    setRequests(rs => [{
      id: rs.length + 1, team: newTeam, template: newTemplate,
      status: 'pending', requester: 'You (Admin)', date: 'Apr 17',
      priority: newPriority, note: newNote,
    }, ...rs]);
    setShowNew(false); setNewTeam(''); setNewTemplate(''); setNewNote('');
  };

  const btnStyle = (bg) => ({
    background: bg, color: '#fff', border: 'none', borderRadius: radius.sm,
    padding: '5px 12px', fontFamily: fonts.body, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader title="REQUESTS" subtitle="Content requests from athletes, owners, managers, and internal team">
        <OutlineButton onClick={() => setShowNew(!showNew)} style={showNew ? { background: '#FEE2E2', color: '#DC2626', borderColor: '#FECACA' } : {}}>
          {showNew ? 'Cancel' : '+ New Request'}
        </OutlineButton>
      </PageHeader>

      {showNew && (
        <Card style={{ border: `1px solid ${colors.redBorder}` }}>
          <SectionHeading>NEW REQUEST</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, fontWeight: 600, textTransform: 'uppercase' }}>Team</label>
              <select value={newTeam} onChange={e => setNewTeam(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
                <option value="">Select...</option>
                {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, fontWeight: 600, textTransform: 'uppercase' }}>Type</label>
              <select value={newTemplate} onChange={e => setNewTemplate(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
                <option value="">Select...</option>
                {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, fontWeight: 600, textTransform: 'uppercase' }}>Priority</label>
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
          <div style={{ fontFamily: fonts.heading, fontSize: 20, color: colors.text, letterSpacing: 1, marginBottom: 4 }}>NO OPEN REQUESTS</div>
          <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 14 }}>
            {teamFilter === 'ALL'
              ? 'When athletes, owners, or team managers ask for content, their requests land here.'
              : `No active requests for this team.`}
          </div>
          <OutlineButton onClick={() => setShowNew(true)}>+ New Request</OutlineButton>
        </Card>
      )}

      {filtered.map(r => {
        const tp = TEMPLATES.find(t => t.id === r.template);
        const reqComments = comments.filter(c => c.requestId === r.id);
        const expanded = expandedComments[r.id];

        return (
          <Card key={r.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <PriorityDot p={r.priority} />
              <TeamChip teamId={r.team} small withLogo />
              <span style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>{tp?.icon} {tp?.name || r.template}</span>
              <div style={{ flex: 1 }} />
              <StatusBadge status={r.status} />
            </div>

            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 8, paddingLeft: 16 }}>{r.note}</div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 16 }}>
              <span style={{ fontSize: 11, color: colors.textMuted }}>{r.requester} · {r.date}</span>
              <div style={{ flex: 1 }} />

              <button onClick={() => toggleComments(r.id)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 600, color: colors.textSecondary,
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
                  return (
                    <div key={c.id} style={{ marginBottom: 10, paddingLeft: 12, borderLeft: `2px solid ${rc.bg}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: colors.text }}>{c.author}</span>
                        <span style={{
                          fontSize: 9, fontFamily: fonts.condensed, fontWeight: 600,
                          padding: '1px 6px', borderRadius: radius.sm,
                          background: rc.bg, color: rc.text, textTransform: 'uppercase',
                        }}>{c.role}</span>
                        <span style={{ fontSize: 10, color: colors.textMuted }}>{c.time}</span>
                      </div>
                      <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.5 }}>{c.text}</div>
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
        );
      })}
    </div>
  );
}
