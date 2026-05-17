// Admin People management endpoint — list profiles, invite users, update roles.
//
// GET  /api/admin-people                  — list all profiles (admin+)
// POST /api/admin-people                  — invite OR silent-create a user.
//                                           Body: { email, role?, team_id?, silent? }
//                                           silent=true → create the auth user WITHOUT
//                                           sending an email. Pairs with the
//                                           "Send invite" button to ship the invite
//                                           later in a controlled batch. (v4.7.12)
// POST /api/admin-people?action=send-invite
//                                         — email an invite to a silently-created
//                                           profile. Body: { id }
// PATCH /api/admin-people                 — update role/team_id for a profile.
//                                           Body: { id, role?, team_id?, display_name? }
//
// Gating rules:
//   - All routes require role ∈ {master_admin, admin}
//   - Only master_admin can create/update other admins or master_admins
//   - Admins can only manage content/athlete roles
//   - You cannot demote yourself (prevents accidental lockout)

import { requireUser, requireAdmin } from './_supabase.js';

const VALID_ROLES = ['master_admin', 'admin', 'content', 'athlete'];

// Graceful select — older deploys may not have run migration 015 yet,
// in which case `pending_invite` doesn't exist on profiles. Mirror the
// fallback pattern from _supabase.js so a deploy-before-migrate doesn't
// 500 the People list.
async function selectProfiles(sb) {
  let { data, error } = await sb
    .from('profiles')
    .select('id, email, role, team_id, display_name, created_at, updated_at, pending_invite')
    .order('created_at', { ascending: false });
  if (error && /pending_invite/i.test(error.message || '')) {
    const fallback = await sb
      .from('profiles')
      .select('id, email, role, team_id, display_name, created_at, updated_at')
      .order('created_at', { ascending: false });
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;
  return data || [];
}

export default async function handler(req, res) {
  const ctx = await requireUser(req, res);
  if (!ctx) return;
  if (requireAdmin(res, ctx.profile)) return;
  const { user, profile, sb } = ctx;

  try {
    if (req.method === 'GET') {
      const profiles = await selectProfiles(sb);
      return res.status(200).json({ profiles });
    }

    if (req.method === 'POST') {
      // Route on ?action= so we can ship "send-invite" without a separate
      // file. The default POST is still create-or-invite.
      const action = (req.query?.action || '').toLowerCase();

      // ─── Send invite to an existing silently-created user ────────────
      if (action === 'send-invite') {
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id is required' });

        // Look up the email — we trust the profiles table since it's
        // server-side and tied to the auth user via the trigger.
        const { data: target, error: getErr } = await sb
          .from('profiles')
          .select('id, email, pending_invite')
          .eq('id', id)
          .maybeSingle();
        if (getErr) throw getErr;
        if (!target) return res.status(404).json({ error: 'profile not found' });
        if (!target.email) return res.status(400).json({ error: 'profile has no email on file' });

        // generateLink({ type: 'invite' }) creates a sign-up link AND
        // (when SMTP is configured on the Supabase project) sends the
        // email automatically. The returned action_link is also useful
        // as a fallback for the master to copy/paste if email delivery
        // fails or they want to send through a different channel.
        const origin = req.headers.origin || `https://${req.headers.host}`;
        const redirectTo = `${origin}/auth/callback`;
        const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
          type: 'invite',
          email: target.email,
          options: { redirectTo },
        });
        if (linkErr) {
          // Most common failure: user is already confirmed (clicked a previous
          // invite). In that case, fall back to magiclink which works for
          // any user. We still surface the link in the response.
          if (/already/i.test(linkErr.message || '')) {
            const { data: magicData, error: magicErr } = await sb.auth.admin.generateLink({
              type: 'magiclink',
              email: target.email,
              options: { redirectTo },
            });
            if (magicErr) {
              return res.status(400).json({ error: magicErr.message || 'Failed to generate invite link' });
            }
            // Flip the flag — they've now been sent something.
            await sb.from('profiles').update({ pending_invite: false }).eq('id', id);
            return res.status(200).json({
              sent: true,
              kind: 'magiclink',
              action_link: magicData?.properties?.action_link || null,
            });
          }
          return res.status(400).json({ error: linkErr.message || 'Failed to send invite' });
        }

        // Mark as no-longer-pending. If the column doesn't exist yet,
        // swallow the error (migration 015 not run) — the invite itself
        // still went through, which is what the user cares about.
        try {
          await sb.from('profiles').update({ pending_invite: false }).eq('id', id);
        } catch { /* migration 015 not yet applied — no-op */ }

        return res.status(200).json({
          sent: true,
          kind: 'invite',
          action_link: linkData?.properties?.action_link || null,
        });
      }

      // ─── Default POST: invite or silent-create a new user ────────────
      const { email, role, team_id, display_name, silent } = req.body || {};
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'email is required' });
      }
      const requestedRole = role || 'athlete';
      if (!VALID_ROLES.includes(requestedRole)) {
        return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
      }
      // Only master_admin can create admins or master_admins.
      if (['master_admin', 'admin'].includes(requestedRole) && profile.role !== 'master_admin') {
        return res.status(403).json({ error: 'Only master_admin can create admin-level users' });
      }
      // Silent create is master-only — admins can't pre-stage accounts.
      if (silent && profile.role !== 'master_admin') {
        return res.status(403).json({ error: 'Only master_admin can silently create users' });
      }

      let createdId = null;

      if (silent) {
        // createUser with email_confirm:false creates the auth user
        // without sending an invite email. Later, "Send invite" calls
        // generateLink to actually email them. We never set a password —
        // the magic-link invite is what bootstraps their first session.
        const { data: created, error: createErr } = await sb.auth.admin.createUser({
          email,
          email_confirm: false,
          // Sets a tag in user_metadata so we can debug origin of accounts.
          user_metadata: { created_via: 'silent_stage', staged_at: new Date().toISOString() },
        });
        if (createErr) {
          const msg = createErr.message || 'Failed to create user';
          const status = msg.toLowerCase().includes('already') ? 409 : 400;
          return res.status(status).json({ error: msg });
        }
        createdId = created?.user?.id || null;
      } else {
        // Normal path — send the invite email immediately.
        const origin = req.headers.origin || `https://${req.headers.host}`;
        const redirectTo = `${origin}/auth/callback`;
        const { data: invited, error: inviteErr } = await sb.auth.admin.inviteUserByEmail(email, {
          redirectTo,
        });
        if (inviteErr) {
          const msg = inviteErr.message || 'Failed to send invitation';
          const status = msg.toLowerCase().includes('already') ? 409 : 400;
          return res.status(status).json({ error: msg });
        }
        createdId = invited?.user?.id || null;
      }

      // The trigger in migration 003 already created a profile row with
      // role='athlete'. Upsert to apply the requested role/team_id and
      // (for silent creates) flip pending_invite=true so the UI can show
      // the "Send invite" button.
      if (createdId) {
        const updates = {
          role: requestedRole,
          team_id: team_id || null,
          display_name: display_name || null,
        };
        if (silent) updates.pending_invite = true;
        try {
          await sb.from('profiles').update(updates).eq('id', createdId);
        } catch (err) {
          // If pending_invite column is missing, retry without it. The
          // account was still created — just won't be visually tagged.
          if (silent && /pending_invite/i.test(err?.message || '')) {
            delete updates.pending_invite;
            await sb.from('profiles').update(updates).eq('id', createdId);
          } else {
            throw err;
          }
        }
      }

      return res.status(200).json({
        invited: {
          id: createdId,
          email,
          role: requestedRole,
          team_id: team_id || null,
          silent: !!silent,
        },
      });
    }

    if (req.method === 'PATCH') {
      const { id, role, team_id, display_name } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });

      // Fetch the target so we can check what role they currently have.
      const { data: target, error: getErr } = await sb
        .from('profiles')
        .select('id, role, email')
        .eq('id', id)
        .maybeSingle();
      if (getErr) throw getErr;
      if (!target) return res.status(404).json({ error: 'profile not found' });

      const updates = {};
      if (typeof role === 'string') {
        if (!VALID_ROLES.includes(role)) {
          return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
        }
        // Non-master admins can't touch admin-level users or create them.
        if (profile.role !== 'master_admin') {
          if (['master_admin', 'admin'].includes(target.role) || ['master_admin', 'admin'].includes(role)) {
            return res.status(403).json({ error: 'Only master_admin can change admin-level roles' });
          }
        }
        // Prevent accidental self-demotion out of master_admin.
        if (target.id === user.id && profile.role === 'master_admin' && role !== 'master_admin') {
          return res.status(400).json({ error: "You can't demote yourself. Ask another master_admin to do it." });
        }
        updates.role = role;
      }
      if (team_id !== undefined) updates.team_id = team_id || null;
      if (typeof display_name === 'string') updates.display_name = display_name || null;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      const { data: updated, error: updErr } = await sb
        .from('profiles')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (updErr) throw updErr;
      return res.status(200).json({ profile: updated });
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[admin-people]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
