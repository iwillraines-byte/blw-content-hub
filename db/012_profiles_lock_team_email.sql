-- ─── Migration 012 — Lock team_id + email on self-update ────────────────────
-- v4.5.38 (security audit C1): the existing `profiles_update_own_nonrole`
-- policy only locked `role` on self-edits. `team_id` was wide open, which
-- meant an athlete could:
--
--   await supabase.from('profiles').update({ team_id: 'LAN' }).eq('id', uid);
--
-- ...and instantly become a member of any team. From there they could write
-- requests / media / generate_log scoped to that team via the cloud-sync
-- API's athlete write path, bypassing every team check.
--
-- This migration tightens the policy so a self-update can only change
-- `display_name` (and the timestamp triggers). `role`, `team_id`, and
-- `email` are now write-locked from the user's own session — they can
-- still be changed by master/admin via the existing `profiles_update_admin`
-- policy (which uses is_admin()), or by the server via service_role.
--
-- Email lock prevents an "identity-spoof" attack: a user changes their
-- email to match an admin's, then if any code path matches by email
-- (legacy fallbacks in cloud-sync.js for older request rows) they
-- inherit the admin's request visibility. Belt-and-suspenders — the
-- primary auth check is on user.id (UUID) — but cheap to lock down.
--
-- Safe to re-run.

DROP POLICY IF EXISTS "profiles_update_own_nonrole" ON public.profiles;

CREATE POLICY "profiles_update_own_nonrole" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role     = (SELECT role     FROM public.profiles WHERE id = auth.uid())
    AND team_id  IS NOT DISTINCT FROM (SELECT team_id  FROM public.profiles WHERE id = auth.uid())
    AND email    IS NOT DISTINCT FROM (SELECT email    FROM public.profiles WHERE id = auth.uid())
    AND role_expires_at IS NOT DISTINCT FROM (SELECT role_expires_at FROM public.profiles WHERE id = auth.uid())
  );

-- v4.5.38 also explicitly tolerates the `role_expires_at` column not
-- existing on pre-v4.5.7 schemas. If the column is absent the
-- IS NOT DISTINCT FROM clause errors at policy-creation time. Wrap in
-- a DO block so the migration partially-applies cleanly on either schema.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role_expires_at'
  ) THEN
    -- Drop and recreate without the role_expires_at clause.
    DROP POLICY IF EXISTS "profiles_update_own_nonrole" ON public.profiles;
    CREATE POLICY "profiles_update_own_nonrole" ON public.profiles
      FOR UPDATE TO authenticated
      USING (id = auth.uid())
      WITH CHECK (
        id = auth.uid()
        AND role     = (SELECT role     FROM public.profiles WHERE id = auth.uid())
        AND team_id  IS NOT DISTINCT FROM (SELECT team_id  FROM public.profiles WHERE id = auth.uid())
        AND email    IS NOT DISTINCT FROM (SELECT email    FROM public.profiles WHERE id = auth.uid())
      );
  END IF;
END $$;
