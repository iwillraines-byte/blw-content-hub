import { useState } from 'react';
import { TEAMS, TEMPLATES, getTeam } from '../data';
import { Card, PageHeader, SectionHeading, TeamChip, StatusBadge, PriorityDot, RedButton, OutlineButton, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';

const INITIAL_REQUESTS = [
  { id: 1, team: 'DAL', template: 'gameday', status: 'pending', requester: 'Jake M. (Athlete)', date: 'Apr 14', priority: 'high', note: 'Need this for the Lone Star Showdown at RoughRiders park' },
  { id: 2, team: 'MIA', template: 'player-stat', status: 'in-progress', requester: 'Sarah K. (Team Mgr)', date: 'Apr 13', priority: 'medium', note: 'Tommy Hernandez batting .435 — needs a stat spotlight' },
  { id: 3, team: 'AZS', template: 'highlight-video', status: 'approved', requester: 'Mike R. (Admin)', date: 'Apr 12', priority: 'low', note: 'Top 5 plays from Scottsdale tournament' },
  { id: 4, team: 'NYG', template: 'ranking-change', status: 'pending', requester: 'Alex T. (Athlete)', date: 'Apr 14', priority: 'high', note: 'Climbed to 4th — Gary Vee wants this posted ASAP' },
  { id: 5, team: 'CHI', template: 'score', status: 'revision', requester: 'Auto (Admin)', date: 'Apr 13', priority: 'medium', note: 'Score graphic had wrong final — needs correction' },
  { id: 6, team: 'LAN', template: 'hype', status: 'completed', requester: 'Logan R. (Admin)', date: 'Apr 11', priority: 'low', note: '17-1 celebration post — Costner retweeted' },
  { id: 7, team: 'PHI', template: 'pitching-leaders', status: 'pending', requester: 'David Adelman (Owner)', date: 'Apr 14', priority: 'high', note: 'Josh Wheeler leading — need graphic' },
];

const INITIAL_COMMENTS = [
  { id: 1, requestId: 1, author: 'Jake M.', role: 'athlete', text: 'Can we make it 1080x1350 for IG feed?', time: 'Apr 14, 2:30 PM' },
  { id: 2, requestId: 1, author: 'Will R.', role: 'admin', text: 'Got it — will generate portrait format.', time: 'Apr 14, 3:15 PM' },
  { id: 3, requestId: 2, author: 'Sarah K.', role: 'team', text: 'His OPS+ is 236 — make sure that\'s front and center.', time: 'Apr 13, 11:00 AM' },
  { id: 4, requestId: 4, author: 'Alex T.', role: 'athlete', text: 'GaryVee wants it on his story too — need 1080x1920 version', time: 'Apr 14, 4:00 PM' },
  { id: 5, requestId: 5, author: 'Will R.', role: 'admin', text: 'Fixed — final was 3-2 not 3-1. Regenerating now.', time: 'Apr 13, 5:45 PM' },
];

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
