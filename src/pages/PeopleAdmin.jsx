// People admin card — master_admin only. Lists all profiles, invites new
// users, and changes roles/teams. Talks to /api/admin-people which
// enforces role guards server-side.
//
// Roles in the picker: master_admin, content, athlete. The "admin" tier
// is dormant — kept in the DB enum so a future operator can revive it,
// but never granted today (master_admin handles trades, bio import, and
// people management directly).

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Card, SectionHeading, Label, RedButton, OutlineButton, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { TEAMS, getTeam } from '../data';
import { useAuth, ROLE_LABELS, isAdminRole } from '../auth';
import { authedJson } from '../authed-fetch';
import { useToast } from '../toast';
import { getAllManualPlayers } from '../player-store';

// What a given admin tier is allowed to assign on invite. Master can
// assign any non-admin role (admin is omitted on purpose — see header
// comment). The legacy 'admin' tier is left in the map in case anyone
// still has it on their profile; they can only invite content/athlete.
// v4.8.0: 'fan' added — public signups default here via the SQL
// trigger, but master can also explicitly invite a fan-tier account
// (e.g. for a league sponsor, family member, or anyone who needs
// view-only access without going through self-signup).
const INVITABLE_ROLES_BY_ADMIN = {
  master_admin: ['master_admin', 'content', 'athlete', 'fan'],
  admin: ['content', 'athlete', 'fan'],
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

  // v4.7.12: Send the actual invite email to a silently-created profile.
  // Pairs with the "Stage silently" toggle on the invite modal — master
  // pre-stages 10 athletes, links them on their player pages, then
  // triggers invites in controlled batches.
  const sendInvite = useCallback(async (p) => {
    const ok = window.confirm(`Send invite email to ${p.email}? They'll receive a magic link to sign in.`);
    if (!ok) return;
    try {
      const res = await authedJson('/api/admin-people?action=send-invite', {
        method: 'POST',
        body: { id: p.id },
      });
      setProfiles(prev => prev.map(x => x.id === p.id ? { ...x, pending_invite: false } : x));
      toast.success(`Invite sent to ${p.email}`);
      // Surface the action_link as a fallback in case Supabase email
      // delivery is delayed — master can copy/paste it directly.
      if (res?.action_link) {
        console.log('[invite link, fallback]', res.action_link);
      }
    } catch (err) {
      toast.error('Send failed', { detail: err.message });
    }
  }, [toast]);

  // ── Pending athlete claims (v4.24.0) ──────────────────────────────────────
  // Profiles that self-identified as a player at signup. Master verifies the
  // name against the roster, then approves (→ athlete + linked) or denies.
  const pendingClaims = useMemo(
    () => profiles.filter(p => p.claim_status === 'pending'),
    [profiles]
  );
  const [claimRoster, setClaimRoster] = useState(null); // manual_players, lazy
  useEffect(() => {
    if (!pendingClaims.length || claimRoster) return;
    getAllManualPlayers().then(rows => setClaimRoster(rows || [])).catch(() => setClaimRoster([]));
  }, [pendingClaims.length, claimRoster]);

  const approveClaim = useCallback(async (p, linkPlayerId) => {
    try {
      const res = await authedJson('/api/admin-people', {
        method: 'PATCH',
        body: {
          id: p.id,
          role: 'athlete',
          team_id: p.claim_team || null,
          claim_status: 'approved',
          link_manual_player_id: linkPlayerId || null,
        },
      });
      setProfiles(prev => prev.map(x => x.id === p.id ? { ...x, ...(res.profile || {}) } : x));
      if (res?.link_warning) toast.error('Approved — link needs attention', { detail: res.link_warning });
      else toast.success('Approved — promoted to athlete');
    } catch (err) {
      toast.error('Approve failed', { detail: err.message });
      refresh();
    }
  }, [toast, refresh]);

  const denyClaim = useCallback((p) => patchRow(p.id, { claim_status: 'denied' }), [patchRow]);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <SectionHeading style={{ marginBottom: 0 }}>People</SectionHeading>
        <RedButton onClick={() => setInviteOpen(true)} style={{ padding: '6px 12px', fontSize: 11 }}>
          + Invite user
        </RedButton>
      </div>

      <p style={{ fontSize: 12, color: colors.textSecondary, margin: '0 0 14px', lineHeight: 1.5 }}>
        Send a magic-link invitation and set their role + team. Invited emails will receive a link that signs them in automatically. Pick <strong>Content</strong> for your social-media team and <strong>Athlete</strong> for players.
        {myTier === 'master_admin' && (
          <> Use <strong>Stage silently</strong> on the invite modal to pre-create accounts so you can link them on player pages before any emails go out — then trigger invites in batches with the <strong>Send invite</strong> button below.</>
        )}
      </p>

      {error && (
        <div style={{
          padding: 10, marginBottom: 10, borderRadius: radius.base,
          background: 'rgba(221,60,60,0.08)', color: '#991B1B',
          border: `1px solid rgba(221,60,60,0.3)`, fontSize: 12,
        }}>{error}</div>
      )}

      {pendingClaims.length > 0 && (
        <div style={{ marginBottom: 16, padding: 12, background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: radius.base }}>
          <div style={{ fontFamily: fonts.condensed, fontSize: 12, fontWeight: 800, letterSpacing: 0.5, color: '#92400E', textTransform: 'uppercase', marginBottom: 6 }}>
            Pending athlete claims · {pendingClaims.length}
          </div>
          <p style={{ fontSize: 11, color: colors.textSecondary, margin: '0 0 10px', lineHeight: 1.5 }}>
            These people signed up and said they're players. Check the name against the roster, then approve to promote them to athlete (and link their player record), or deny to keep them as a fan.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendingClaims.map(p => (
              <ClaimReviewRow
                key={p.id}
                p={p}
                roster={claimRoster}
                onApprove={(linkId) => approveClaim(p, linkId)}
                onDeny={() => denyClaim(p)}
              />
            ))}
          </div>
        </div>
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
              onSendInvite={() => sendInvite(p)}
            />
          ))}
        </div>
      )}

      <TeamJoinCodesPanel />

      {inviteOpen && (
        <InviteModal
          invitableRoles={invitableRoles}
          isMaster={myTier === 'master_admin'}
          onClose={() => setInviteOpen(false)}
          onSuccess={(opts) => {
            setInviteOpen(false);
            refresh();
            if (opts?.silent && opts?.linked) {
              toast.success('Staged + linked to player', {
                detail: 'Click "Send invite" on the People list when you\'re ready to email them.',
              });
            } else if (opts?.silent) {
              toast.success('Account staged — invite not yet sent', {
                detail: 'Click "Send invite" on the People list when you\'re ready to email them.',
              });
            } else if (opts?.linked) {
              toast.success('Invite sent + linked to player');
            } else {
              toast.success('Invitation sent');
            }
          }}
        />
      )}
    </Card>
  );
}

function ProfileRow({ p, isSelf, myTier, onChangeRole, onChangeTeam, onSendInvite }) {
  // Figure out what this admin is allowed to do on this row.
  // - master_admin: can edit anyone (but the server still blocks self-demotion)
  // - admin: can only edit content/athlete rows
  const canEdit = myTier === 'master_admin'
    ? true
    : myTier === 'admin' && !['master_admin', 'admin'].includes(p.role);

  // Master gets master/content/athlete/fan; legacy 'admin' tier (if
  // anyone still has it) gets content/athlete/fan. Plain 'admin' is
  // intentionally not assignable from the UI — see header comment.
  const roleOptions = myTier === 'master_admin'
    ? ['master_admin', 'content', 'athlete', 'fan']
    : ['content', 'athlete', 'fan'];

  // v4.7.12: silently-staged accounts get a chip + a "Send invite" CTA
  // so master can fire the email when they're ready (e.g. after linking
  // the athlete on their player page).
  const isPending = !!p.pending_invite;
  const canSendInvite = myTier === 'master_admin' && isPending;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) 130px 110px auto',
      gap: 8, alignItems: 'center',
      padding: 10, borderRadius: radius.base,
      border: `1px solid ${isPending ? colors.warningBorder || colors.borderLight : colors.borderLight}`,
      background: isSelf ? colors.redLight : (isPending ? (colors.warningBg || colors.white) : colors.white),
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.email || '(no email)'}
          {isSelf && (
            <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: colors.red, letterSpacing: 0.5 }}>YOU</span>
          )}
          {isPending && (
            <span
              title="Account staged silently — invite email not yet sent. Click 'Send invite' when ready."
              style={{
                marginLeft: 6,
                fontFamily: fonts.condensed,
                fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
                color: '#92400E',
                background: '#FEF3C7',
                border: '1px solid #FCD34D',
                padding: '2px 6px',
                borderRadius: radius.sm,
              }}
            >⏳ NOT INVITED</span>
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
        {canSendInvite && (
          <button
            type="button"
            onClick={onSendInvite}
            title="Email the magic-link invite now"
            style={{
              padding: '5px 10px',
              fontSize: 11,
              fontFamily: fonts.condensed,
              fontWeight: 800,
              letterSpacing: 0.5,
              color: colors.white,
              background: colors.red,
              border: 'none',
              borderRadius: radius.sm,
              cursor: 'pointer',
            }}
          >SEND INVITE</button>
        )}
        <div style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 0.3 }}>
          {p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}
        </div>
      </div>
    </div>
  );
}

// One pending self-claim: shows who the email says they are + a roster picker
// (auto-matched to the claimed name) so master can approve+link in one click.
function ClaimReviewRow({ p, roster, onApprove, onDeny }) {
  const [linkId, setLinkId] = useState('');
  const [busy, setBusy] = useState(false);
  const team = p.claim_team ? getTeam(p.claim_team) : null;

  const teamPlayers = useMemo(() => {
    if (!p.claim_team || !roster) return [];
    return roster
      .filter(x => x.team === p.claim_team)
      .sort((a, b) => (Number(!!a.userId) - Number(!!b.userId)) || String(a.lastName || '').localeCompare(String(b.lastName || '')));
  }, [roster, p.claim_team]);

  // Best match for the claimed name (exact full name, else surname contained),
  // preferring still-unlinked records.
  useEffect(() => {
    if (linkId || !p.claim_name || !teamPlayers.length) return;
    const cn = p.claim_name.trim().toLowerCase();
    const full = (x) => `${x.firstName || ''} ${x.lastName || ''}`.trim().toLowerCase();
    const pick = teamPlayers.find(x => !x.userId && full(x) === cn)
      || teamPlayers.find(x => !x.userId && x.lastName && cn.includes(String(x.lastName).toLowerCase()));
    if (pick) setLinkId(pick.id);
  }, [teamPlayers, p.claim_name, linkId]);

  const run = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <div style={{ background: colors.white, border: `1px solid ${colors.borderLight}`, borderRadius: radius.base, padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.email}</div>
        {p.claim_verified ? (
          <span style={{ fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: '#15803D', background: '#DCFCE7', border: '1px solid #86EFAC', padding: '2px 6px', borderRadius: radius.sm }}>✓ CODE VERIFIED</span>
        ) : (
          <span title="They didn't enter a valid team join code — confirm their identity another way before approving." style={{ fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: '#92400E', background: '#FEF3C7', border: '1px solid #FCD34D', padding: '2px 6px', borderRadius: radius.sm }}>⚠ UNVERIFIED</span>
        )}
      </div>
      <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
        Claims: <strong>{p.claim_name || '(no name)'}</strong>
        {p.claim_num ? ` · #${p.claim_num}` : ''}
        {' · '}{team ? team.name : (p.claim_team || 'no team')}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <select
          value={linkId}
          onChange={e => setLinkId(e.target.value)}
          style={{ ...selectStyle, flex: 1, minWidth: 180, padding: '5px 6px', fontSize: 11 }}
        >
          <option value="">— Link to player later —</option>
          {teamPlayers.map(x => {
            const linked = !!x.userId;
            const num = x.num != null && x.num !== '' ? `#${x.num} ` : '';
            const name = `${x.firstName || ''} ${x.lastName || ''}`.trim() || '(unnamed)';
            return <option key={x.id} value={x.id} disabled={linked}>{num}{name}{linked ? ' · linked' : ''}</option>;
          })}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => onApprove(linkId))}
          style={{ padding: '6px 12px', fontSize: 11, fontFamily: fonts.condensed, fontWeight: 800, letterSpacing: 0.5, color: colors.white, background: colors.success || '#15803D', border: 'none', borderRadius: radius.sm, cursor: busy ? 'wait' : 'pointer' }}
        >APPROVE</button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(onDeny)}
          style={{ padding: '6px 12px', fontSize: 11, fontFamily: fonts.condensed, fontWeight: 800, letterSpacing: 0.5, color: colors.textSecondary, background: colors.white, border: `1px solid ${colors.border}`, borderRadius: radius.sm, cursor: busy ? 'wait' : 'pointer' }}
        >DENY</button>
      </div>
    </div>
  );
}

// Master-only manager for the per-team signup codes. Collapsed by default;
// fetches current codes on first open and lets master generate/rotate/copy.
const miniBtn = {
  padding: '4px 10px', fontSize: 11, fontFamily: fonts.condensed, fontWeight: 800,
  letterSpacing: 0.5, color: colors.textSecondary, background: colors.white,
  border: `1px solid ${colors.border}`, borderRadius: radius.sm, cursor: 'pointer',
};

function TeamJoinCodesPanel() {
  const toast = useToast();
  const [codes, setCodes] = useState(null); // null = not loaded; else { teamId: code }
  const [busyTeam, setBusyTeam] = useState('');
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await authedJson('/api/team-codes');
      const map = {};
      (data.codes || []).forEach(c => { map[c.team_id] = c.code; });
      setCodes(map);
    } catch { setCodes({}); }
  }, []);
  useEffect(() => { if (open && codes === null) load(); }, [open, codes, load]);

  const generate = useCallback(async (teamId) => {
    setBusyTeam(teamId);
    try {
      const res = await authedJson('/api/team-codes', { method: 'POST', body: { team_id: teamId } });
      setCodes(prev => ({ ...(prev || {}), [teamId]: res.code?.code }));
      toast.success(`New code for ${teamId}`);
    } catch (e) {
      toast.error('Failed to set code', { detail: e.message });
    } finally {
      setBusyTeam('');
    }
  }, [toast]);

  const copy = useCallback((code) => {
    try { navigator.clipboard.writeText(code); toast.success('Code copied'); } catch { /* clipboard blocked */ }
  }, [toast]);

  return (
    <div style={{ marginTop: 16, borderTop: `1px solid ${colors.borderLight}`, paddingTop: 12 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <span style={{ fontSize: 10, color: colors.textMuted, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
        <SectionHeading style={{ margin: 0, fontSize: 15 }}>Team join codes</SectionHeading>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 11, color: colors.textSecondary, margin: '0 0 12px', lineHeight: 1.5 }}>
            Share each team's code privately with that team (Discord, GroupMe, in person). When a player enters it at signup, their claim shows <strong>✓ Code verified</strong>. Rotate anytime — the old code stops working immediately.
          </p>
          {codes === null ? (
            <div style={{ fontSize: 12, color: colors.textMuted, padding: 8 }}>Loading…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {TEAMS.map(t => {
                const code = codes[t.id];
                return (
                  <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 8, alignItems: 'center', padding: '6px 8px', border: `1px solid ${colors.borderLight}`, borderRadius: radius.base }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: colors.text }}>{t.id}</span>
                    <span style={{ fontFamily: fonts.condensed, fontSize: 14, fontWeight: 800, letterSpacing: 2, color: code ? colors.text : colors.textMuted }}>
                      {code || '— not set —'}
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {code && <button type="button" onClick={() => copy(code)} style={miniBtn}>Copy</button>}
                      <button type="button" disabled={busyTeam === t.id} onClick={() => generate(t.id)} style={{ ...miniBtn, cursor: busyTeam === t.id ? 'wait' : 'pointer' }}>
                        {busyTeam === t.id ? '…' : (code ? 'Rotate' : 'Generate')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InviteModal({ invitableRoles, isMaster, onClose, onSuccess }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(invitableRoles.includes('athlete') ? 'athlete' : invitableRoles[0]);
  const [teamId, setTeamId] = useState('');
  // v4.7.12: silent staging — master can pre-create accounts without
  // emailing them, so they can be linked on player pages first and
  // invited in controlled batches later. Only available to master_admin.
  const [silent, setSilent] = useState(false);
  // v4.7.13: link the new account to a manual_players row in the same
  // POST. Eliminates the "create user → navigate to player page → link"
  // choreography. Only relevant when role=athlete + team is picked.
  const [linkPlayerId, setLinkPlayerId] = useState('');
  const [allPlayers, setAllPlayers] = useState(null); // null = loading
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');

  // Pull the roster cache once when the modal mounts. getAllManualPlayers
  // reads from IndexedDB so this is fast (already populated by the rest
  // of the app). If it fails, the picker just renders empty and the
  // master can still create the account without linking.
  useEffect(() => {
    let cancel = false;
    getAllManualPlayers()
      .then(rows => { if (!cancel) setAllPlayers(rows || []); })
      .catch(() => { if (!cancel) setAllPlayers([]); });
    return () => { cancel = true; };
  }, []);

  // Filter to the picked team + sort unlinked first, then alphabetical
  // by lastName. Already-linked players are still shown but disabled,
  // so master can see "this player is already taken by someone else."
  const teamPlayers = useMemo(() => {
    if (!teamId || !allPlayers) return [];
    const list = allPlayers.filter(p => p.team === teamId);
    return list.sort((a, b) => {
      const aLinked = !!a.userId;
      const bLinked = !!b.userId;
      if (aLinked !== bLinked) return aLinked ? 1 : -1;
      return String(a.lastName || '').localeCompare(String(b.lastName || ''));
    });
  }, [allPlayers, teamId]);

  // Reset the player pick whenever team changes — a player from the old
  // team would be invalid for the new team.
  useEffect(() => { setLinkPlayerId(''); }, [teamId]);

  const send = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setErr('');
    try {
      const res = await authedJson('/api/admin-people', {
        method: 'POST',
        body: {
          email: email.trim(),
          role,
          team_id: teamId || null,
          silent: silent && isMaster,
          link_manual_player_id: (role === 'athlete' && linkPlayerId) ? linkPlayerId : null,
        },
      });
      // Account itself always succeeds first; link is best-effort. Surface
      // a warning toast if the link couldn't be made so master knows to
      // bind manually on the player page.
      if (res?.link_warning) {
        toast.error('Linked failed — account created', { detail: res.link_warning });
      }
      onSuccess?.({ silent: silent && isMaster, linked: !!res?.invited?.linked_player_id });
    } catch (e2) {
      setErr(e2.message || 'Failed to send invitation');
      toast.error(silent ? 'Stage failed' : 'Invite failed', { detail: e2.message?.slice(0, 100) });
    } finally {
      setSending(false);
    }
  };

  // v4.5.55: Portal to document.body — see BulkImportModal for the
  // full explainer on the .route-enter containing-block trap.
  const overlay = (
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

        {/* v4.7.13: link-to-player picker. Only shown when role=athlete +
            team picked. Lets master bind the new account to a specific
            manual_players row in the SAME submit, skipping the trip to
            the player page. */}
        {role === 'athlete' && teamId && (
          <div style={{ marginTop: 12 }}>
            <Label>Link to player (optional)</Label>
            {allPlayers === null ? (
              <div style={{ fontSize: 11, color: colors.textMuted, padding: 6 }}>Loading roster…</div>
            ) : teamPlayers.length === 0 ? (
              <div style={{ fontSize: 11, color: colors.textMuted, padding: 6 }}>
                No player records on this team yet. You can link later from the player page.
              </div>
            ) : (
              <select
                value={linkPlayerId}
                onChange={e => setLinkPlayerId(e.target.value)}
                style={selectStyle}
              >
                <option value="">— Don't link now (set later on player page) —</option>
                {teamPlayers.map(p => {
                  const linked = !!p.userId;
                  const num = p.num != null && p.num !== '' ? `#${p.num} ` : '';
                  const name = `${p.firstName || ''} ${p.lastName || ''}`.trim() || '(unnamed)';
                  return (
                    <option key={p.id} value={p.id} disabled={linked}>
                      {num}{name}{linked ? ' · already linked' : ''}
                    </option>
                  );
                })}
              </select>
            )}
            {linkPlayerId && (
              <div style={{ fontSize: 11, color: colors.success, marginTop: 4, fontFamily: fonts.condensed, letterSpacing: 0.3 }}>
                ✓ This account will own that player's record on first login (or immediately, for silent staging).
              </div>
            )}
          </div>
        )}

        {isMaster && (
          <label
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              marginTop: 14, padding: 10,
              background: silent ? '#FEF3C7' : colors.bg,
              border: `1px solid ${silent ? '#FCD34D' : colors.borderLight}`,
              borderRadius: radius.sm,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={silent}
              onChange={e => setSilent(e.target.checked)}
              style={{ marginTop: 2, cursor: 'pointer' }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: colors.text }}>
                Stage silently (don't email yet)
              </div>
              <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2, lineHeight: 1.4 }}>
                Creates the account so you can link it on a player page, but holds the invite email until you click <strong>Send invite</strong> on the People list. Useful for staged rollouts.
              </div>
            </div>
          </label>
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
            {sending
              ? (silent ? 'Staging…' : 'Sending…')
              : (silent ? 'Stage account' : 'Send invitation')}
          </RedButton>
        </div>
      </form>
    </div>
  );

  return createPortal(overlay, document.body);
}
