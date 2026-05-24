-- v4.8.0: Password auth + open registration + fan tier
--
-- Three changes packaged together because they're inseparable for
-- the mass-launch shift:
--
--   1. Add 'fan' to the role enum. Public registration defaults new
--      signups to this tier (browse-only access to standings, rosters,
--      player pages, recent posts). Master can promote a fan → athlete
--      later via the People list, same flow as today.
--
--   2. Add `needs_password_setup` flag to profiles. Existing users
--      (created via magic-link invite or silent createUser) have NO
--      password in auth.users.encrypted_password. They'll be force-
--      redirected to a "Set your password" page on next sign-in. Users
--      who registered via the new password-signup flow get false.
--
--   3. Update the new-user trigger to:
--      - Default role to 'fan' for self-signups (no email_confirmed_at
--        on insert means they came through signUp not invite, but
--        Supabase always sets email_confirmed_at on invite users too
--        so we use the encrypted_password check instead).
--      - Set needs_password_setup based on whether the user has a
--        password set in auth.users.
--      - Preserve 'athlete' default for silent-create + invite paths
--        (which is still what we want — master pre-creating an athlete
--        account expects role=athlete, then links them on the player
--        page).
--
-- NOTE: this migration is additive + idempotent. It doesn't delete or
-- rename anything; existing profiles keep their current role, and
-- legacy magic-link sign-in continues to work alongside passwords.

-- ─── 1. Extend the role check constraint to include 'fan' ─────────────────
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('master_admin', 'admin', 'content', 'athlete', 'fan'));

-- ─── 2. Add needs_password_setup flag ─────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS needs_password_setup BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: any existing auth user WITHOUT a password (i.e. they only
-- ever signed in via magic link or were created silently) needs to set
-- one. Skip users who already have encrypted_password set (the rare
-- pre-launch tester who manually set a password through Supabase Auth UI).
UPDATE public.profiles p
SET needs_password_setup = TRUE
FROM auth.users u
WHERE p.id = u.id
  AND (u.encrypted_password IS NULL OR u.encrypted_password = '');

-- ─── 3. Update the new-user trigger ───────────────────────────────────────
-- Two behaviors:
--   - User created via supabase.auth.signUp(email, password) from the
--     /register page → encrypted_password IS NOT NULL → role='fan',
--     needs_password_setup=false. They self-served.
--   - User created via inviteUserByEmail OR admin.createUser without
--     a password → encrypted_password IS NULL → role='athlete' (the
--     legacy default for master-created accounts), needs_password_setup
--     = true (they'll be force-set on first sign-in).
--
-- This preserves the master-invites-athlete flow without code changes
-- in /api/admin-people, AND defaults open self-signups to the fan tier.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_password BOOLEAN;
BEGIN
  has_password := (NEW.encrypted_password IS NOT NULL AND NEW.encrypted_password <> '');

  INSERT INTO public.profiles (id, email, role, needs_password_setup)
  VALUES (
    NEW.id,
    NEW.email,
    CASE WHEN has_password THEN 'fan' ELSE 'athlete' END,
    NOT has_password
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Trigger itself is unchanged (still AFTER INSERT ON auth.users) — only
-- the function body changed. Re-declare to be explicit + idempotent.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── 4. Allow profiles to update needs_password_setup themselves ──────────
-- The existing profiles_update_own_nonrole policy WITH CHECK clause
-- prevents users from changing their own role (good). It also gates
-- on `id = auth.uid()`, which is exactly what we want for clearing
-- the needs_password_setup flag after a successful password set. The
-- WITH CHECK still requires the role stay the same, so this column
-- piggy-backs on the existing policy without a new one.

-- ─── 5. Fan-tier read access (RLS) ────────────────────────────────────────
-- Most reads in the app currently go through /api/cloud-read which
-- uses the service role (bypasses RLS). Fan-tier reads will use the
-- same endpoint — we don't need to grant table-level SELECT to fan
-- accounts. The endpoint code in /api/cloud-read already returns
-- anything any authenticated user requests (no role check) because
-- the data it surfaces (teams, stats, players, posts) was already
-- public-facing within the app. Phase 5b RLS will tighten this later
-- if needed.
--
-- Profiles is the one table fans hit directly via the auth client.
-- The existing profiles_select_own_or_admin policy already lets fans
-- read their own row. No further policy change needed today.
