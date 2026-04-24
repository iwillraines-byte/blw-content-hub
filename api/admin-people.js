// Admin People management endpoint — list profiles, invite users, update roles.
//
// GET  /api/admin-people        — list all profiles (admin+)
// POST /api/admin-people        — invite a new user. Body: { email, role?, team_id? }
//                                 (Uses Supabase admin.inviteUserByEmail which sends
//                                  a signup magic-link. Requires service_role.)
// PATCH /api/admin-people       — update role/team_id for a profile.
//                                 Body: { id, role?, team_id?, display_name? }
//
// Gating rules:
//   - All routes require role ∈ {master_admin, admin}
//   - Only master_admin can create/update other admins or master_admins
//   - Admins can only manage content/athlete roles
//   - You cannot demote yourself (prevents accidental lockout)

import { requireUser, requireAdmin } from './_supabase.js';

const VALID_ROLES = ['master_admin', 'admin', 'content', 'athlete'];

export default async function handler(req, res) {
  const ctx = await requireUser(req, res);
  if (!ctx) return;
  if (requireAdmin(res, ctx.profile)) return;
  const { user, profile, sb } = ctx;

  try {
    if (req.method === 'GET') {
      const { data, error } = await sb
        .from('profiles')
        .select('id, email, role, team_id, display_name, created_at, updated_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ profiles: data || [] });
    }

    if (req.method === 'POST') {
      const { email, role, team_id, display_name } = req.body || {};
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

      // Send the invite email via Supabase Auth admin API.
      // Any origin that will receive the magic-link redirect must be in the
      // Supabase Auth "Redirect URLs" allow-list.
      const origin = req.headers.origin || `https://${req.headers.host}`;
      const redirectTo = `${origin}/auth/callback`;
      const { data: invited, error: inviteErr } = await sb.auth.admin.inviteUserByEmail(email, {
        redirectTo,
      });
      if (inviteErr) {
        // Common case: user already exists — return a clearer message.
        const msg = inviteErr.message || 'Failed to send invitation';
        const status = msg.toLowerCase().includes('already') ? 409 : 400;
        return res.status(status).json({ error: msg });
      }

      // The trigger in migration 003 already created a profile row with
      // role='athlete'. Upsert to apply the requested role/team_id.
      if (invited?.user?.id) {
        await sb.from('profiles')
          .update({ role: requestedRole, team_id: team_id || null, display_name: display_name || null })
          .eq('id', invited.user.id);
      }

      return res.status(200).json({
        invited: {
          id: invited?.user?.id || null,
          email,
          role: requestedRole,
          team_id: team_id || null,
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
