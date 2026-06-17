-- v4.24.0: Self-service athlete claims + per-team join-code verification
--
-- Public /register signups default to the 'fan' tier (db/016). This adds a way
-- for a registrant to SAY who they are at signup — "I'm a player on <team>, my
-- name is <name>, jersey #<num>" — so the master can verify and promote them to
-- 'athlete' from People Admin instead of guessing from an email address alone.
--
-- The claim is captured client-side and passed through
-- supabase.auth.signUp({ options: { data: { claim_team, claim_name, claim_num }}})
-- which lands in auth.users.raw_user_meta_data. The new-user trigger copies it
-- onto the profile and flags claim_status='pending' for fan self-signups that
-- included a claim. Master approves/denies in the People list.
--
-- Additive + idempotent. Accounts without a claim get NULLs; invite/silent
-- (athlete) accounts are unaffected. Profiles are read/written by the admin
-- endpoints via the service role, so no RLS policy change is needed.

-- ─── 1. Claim columns on profiles ─────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS claim_team   TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS claim_name   TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS claim_num    TEXT;
-- claim_status: NULL (no claim) | 'pending' | 'approved' | 'denied'
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS claim_status TEXT;
-- claim_verified: did they enter the correct team join code at signup?
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS claim_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── 2. Per-team join codes (service-role only) ───────────────────────────
-- Master shares each team's code through that team's private channel; a
-- registrant who enters the right code gets their claim flagged verified.
-- Codes never reach the client except via the master's admin endpoint, and
-- the SECURITY DEFINER trigger below reads them regardless of RLS.
CREATE TABLE IF NOT EXISTS public.team_join_codes (
  team_id    TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.team_join_codes ENABLE ROW LEVEL SECURITY;
-- (no policy = service-role only)

-- ─── 3. Teach the new-user trigger to record + verify the claim ───────────
-- Extends db/016's handle_new_user(): same role logic (password signup →
-- 'fan', invite/silent → 'athlete'), now also copying any claim metadata,
-- marking it 'pending' when a fan self-signup named themselves, and checking
-- the team join code to set claim_verified.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_password BOOLEAN;
  c_team TEXT;
  c_name TEXT;
  c_num  TEXT;
  c_code TEXT;
  is_verified BOOLEAN := FALSE;
BEGIN
  has_password := (NEW.encrypted_password IS NOT NULL AND NEW.encrypted_password <> '');
  c_team := NULLIF(NEW.raw_user_meta_data->>'claim_team', '');
  c_name := NULLIF(NEW.raw_user_meta_data->>'claim_name', '');
  c_num  := NULLIF(NEW.raw_user_meta_data->>'claim_num', '');
  c_code := NULLIF(NEW.raw_user_meta_data->>'claim_code', '');

  IF c_code IS NOT NULL AND c_team IS NOT NULL THEN
    is_verified := EXISTS (
      SELECT 1 FROM public.team_join_codes j
      WHERE j.team_id = c_team AND upper(trim(j.code)) = upper(trim(c_code))
    );
  END IF;

  INSERT INTO public.profiles (id, email, role, needs_password_setup,
                               claim_team, claim_name, claim_num, claim_status, claim_verified)
  VALUES (
    NEW.id,
    NEW.email,
    CASE WHEN has_password THEN 'fan' ELSE 'athlete' END,
    NOT has_password,
    c_team,
    c_name,
    c_num,
    CASE WHEN has_password AND c_name IS NOT NULL THEN 'pending' ELSE NULL END,
    is_verified
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Re-declare the trigger (function body changed only) — idempotent.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
