// People admin card — rendered inside Settings for admin-level roles.
// Handles listing all profiles, inviting new users, and changing roles /
// teams. Talks to /api/admin-people which enforces role guards server-side.
//
// Two distinct admin tiers:
//   - master_admin: can create/edit ANY role, including other admins
//   - admin: can only create/edit content + athlete roles
// (Server rejects disallowed actions with 403 — UI mirrors this by disabling
// inputs we know will fail.)

import { useState, useEffect, useCallback } from 'react';
import { Card, SectionHeading, Label, RedButton, OutlineButton, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { TEAMS } from '../data';
import { useAuth, ROLE_LABELS, isAdminRole } from '../auth';
import { authedJson } from '../authed-fetch';
import { useToast } from '../toast';

const INVITABLE_ROLES_BY_ADMIN = {
  master_admin: ['master_admin', 'admin', 'content', 'athlete'],
  admin: ['content', 'athlete'],
};

export default function PeopleAdminCard() {
  const toast = useToast();
  const { user: currentUser, role: myRole, refreshProfile } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const myTier = isAdminRole(myRole) ? myRole : null;
  const invitableRoles = INVITABLE_ROLES_BY_ADMIN[myTier] || [];

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await authedJson('/api/admin-people');
      setProfiles(data.profiles || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Local row-level updates so the UI feels instant while the PATCH flies.
  const patchRow = useCallback(async (id, changes) => {
    try {
      const res = await authedJson('/api/admin-people', {
        method: 'PATCH',
        body: { id, ...changes },
      });
      setProfiles(prev => prev.map(p => p.id === id ? { ...p, ...(res.profile || changes) } : p));
      toast.success('Updated');
      // If the admin just updated their own row, re-fetch their profile so the UI reflects it.
      if (id === currentUser?.id) refreshProfile?.();
    } catch (err) {
      toast.error('Update failed', { detail: err.message });
      // Re-fetch so we don't show a stale optimistic value.
      refresh();
    }
  }, [toast, currentUser?.id, refreshProfile, refresh]);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <SectionHeading style={{ marginBottom: 0 }}>People</SectionHeading>
        <RedButton onClick={() => setInviteOpen(true)} style={{ padding: '6px 12px', fontSize: 11 }}>
          + Invite user
        </RedButton>
      </div>

      <p style={{ fontSize: 12, color: colors.textSecondary, margin: '0 0 14px', lineHeight: 1.5 }}>
        Send a magic-link invitation and set their role + team. Invited emails will receive a link that takes them to the login page and signs them in automatically.
        {myTier === 'admin' && (
          <span style={{ display: 'block', marginTop: 4 }}>
            As an <strong>admin</strong>, you can manage content creators and athletes. Only <strong>master_admin</strong> can manage other admins.
          </span>
        )}
      </p>

      {error && (
        <div style={{
          padding: 10, marginBottom: 10, borderRadius: radius.base,
          background: 'rgba(221,60,60,0.08)', color: '#991B1B',
          border: `1px solid rgba(221,60,60,0.3)`, fontSize: 12,
        }}>{error}</div>
      )}

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: colors.textSecondary, fontSize: 13 }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {profiles.length === 0 && (
            <div style={{ padding: 14, color: colors.textSecondary, fontSize: 13 }}>
              No profiles yet. Click "+ Invite user" to add the first teammate.
            </div>
          )}
          {profiles.map(p => (
            <ProfileRow
              key={p.id}
              p={p}
              isSelf={p.id === currentUser?.id}
              myTier={myTier}
              onChangeRole={(role) => patchRow(p.id, { role })}
              onChangeTeam={(team_id) => patchRow(p.id, { team_id })}
            />
          ))}
        </div>
      )}

      {inviteOpen && (
        <InviteModal
          invitableRoles={invitableRoles}
          onClose={() => setInviteOpen(false)}
          onSuccess={() => { setInviteOpen(false); refresh(); toast.success('Invitation sent'); }}
        />
      )}
    </Card>
  );
}

function ProfileRow({ p, isSelf, myTier, onChangeRole, onChangeTeam }) {
  // Figure out what this admin is allowed to do on this row.
  // - master_admin: can edit anyone (but the server still blocks self-demotion)
  // - admin: can only edit content/athlete rows
  const canEdit = myTier === 'master_admin'
    ? true
    : myTier === 'admin' && !['master_admin', 'admin'].includes(p.role);

  const roleOptions = myTier === 'master_admin'
    ? ['master_admin', 'admin', 'content', 'athlete']
    : ['content', 'athlete'];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) 130px 110px auto',
      gap: 8, alignItems: 'center',
      padding: 10, borderRadius: radius.base,
      border: `1px solid ${colors.borderLight}`,
      background: isSelf ? colors.redLight : colors.white,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.email || '(no email)'}
          {isSelf && (
            <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: colors.red, letterSpacing: 0.5 }}>YOU</span>
          )}
        </div>
        {p.display_name && (
          <div style={{ fontSize: 11, color: colors.textSecondary }}>{p.display_name}</div>
        )}
      </div>

      <select
        value={p.role}
        onChange={e => onChangeRole(e.target.value)}
        disabled={!canEdit}
        style={{ ...selectStyle, padding: '5px 6px', fontSize: 11, opacity: canEdit ? 1 : 0.6, cursor: canEdit ? 'pointer' : 'not-allowed' }}
      >
        {/* If the current role isn't in our dropdown options (e.g. admin viewing
            a master_admin they can't change), still show it so the value is preserved. */}
        {!roleOptions.includes(p.role) && <option value={p.role}>{ROLE_LABELS[p.role] || p.role}</option>}
        {roleOptions.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
      </select>

      <select
        value={p.team_id || ''}
        onChange={e => onChangeTeam(e.target.value || null)}
        disabled={!canEdit}
        style={{ ...selectStyle, padding: '5px 6px', fontSize: 11, opacity: canEdit ? 1 : 0.6, cursor: canEdit ? 'pointer' : 'not-allowed' }}
      >
        <option value="">No team</option>
        {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
      </select>

      <div style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 0.3 }}>
        {p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}
      </div>
    </div>
  );
}

function InviteModal({ invitableRoles, onClose, onSuccess }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(invitableRoles.includes('athlete') ? 'athlete' : invitableRoles[0]);
  const [teamId, setTeamId] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');

  const send = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setErr('');
    try {
      await authedJson('/api/admin-people', {
        method: 'POST',
        body: { email: email.trim(), role, team_id: teamId || null },
      });
      onSuccess?.();
    } catch (e2) {
      setErr(e2.message || 'Failed to send invitation');
      toast.error('Invite failed', { detail: e2.message?.slice(0, 100) });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <form
        onSubmit={send}
        onClick={e => e.stopPropagation()}
        style={{
          background: colors.white, borderRadius: radius.lg, padding: 24,
          width: '100%', maxWidth: 400,
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        }}
      >
        <h2 style={{ fontFamily: fonts.heading, fontSize: 24, color: colors.text, margin: 0, letterSpacing: 1.2, fontWeight: 400 }}>
          Invite a user
        </h2>
        <p style={{ fontSize: 12, color: colors.textSecondary, margin: '6px 0 16px', lineHeight: 1.5 }}>
          They'll receive a magic-link email. Clicking it signs them in instantly. No password needed.
        </p>

        <Label>Email</Label>
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="teammate@example.com"
          style={inputStyle}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <Label>Role</Label>
            <select value={role} onChange={e => setRole(e.target.value)} style={selectStyle}>
              {invitableRoles.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <Label>Team {role === 'athlete' && <span style={{ color: colors.red }}>*</span>}</Label>
            <select value={teamId} onChange={e => setTeamId(e.target.value)} style={selectStyle}>
              <option value="">None</option>
              {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id} · {t.name}</option>)}
            </select>
          </div>
        </div>
        {role === 'athlete' && !teamId && (
          <div style={{ fontSize: 11, color: colors.warning, marginTop: 4 }}>
            Athletes need a team so they can generate content. You can set it later from the People list too.
          </div>
        )}

        {err && (
          <div style={{
            marginTop: 10, padding: 8, borderRadius: radius.base,
            background: 'rgba(221,60,60,0.08)', color: '#991B1B',
            border: `1px solid rgba(221,60,60,0.3)`, fontSize: 12,
          }}>{err}</div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <OutlineButton type="button" onClick={onClose} style={{ flex: 1 }}>Cancel</OutlineButton>
          <RedButton type="submit" disabled={sending || !email.trim()} style={{ flex: 1 }}>
            {sending ? 'Sending…' : 'Send invitation'}
          </RedButton>
        </div>
      </form>
    </div>
  );
}
