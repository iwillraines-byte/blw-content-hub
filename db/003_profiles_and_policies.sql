-- ─── BLW Content Hub — Phase 5b: Profiles + Roles ──────────────────────────
-- Run this ONCE in the Supabase SQL Editor after auth is live and at least
-- one user has been invited. It is safe to re-run.
--
-- What this creates:
--   • `profiles` table — one row per auth.users row
--   • Trigger so every new invited user gets a profile row (default role = 'athlete')
--   • Helper functions: current_role(), is_admin(), current_team_id()
--   • RLS policies so users can read their own profile and admins can read/update all
--
-- Note: the existing 8 data tables (media, overlays, effects, requests, ...)
-- keep their default-deny RLS. Our /api/cloud-* endpoints use the service_role
-- key which bypasses RLS entirely — enforcement is done server-side by
-- inspecting the JWT. Phase 5c may tighten this by adding per-table policies
-- and moving some reads to the browser anon client. For now, profiles are
-- the ONLY table reachable from the browser auth client.
--
-- ─── AFTER RUNNING THIS MIGRATION ─────────────────────────────────────────
-- Promote yourself to master_admin so you can manage everyone else. Replace
-- the email with your own, then run:
--
--   UPDATE public.profiles SET role = 'master_admin' WHERE email = 'you@example.com';
--
-- Then hard-refresh the app. The profile menu will show your role.
-- ────────────────────────────────────────────────────────────────────────────

-- ─── Profiles table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT,
  role          TEXT        NOT NULL DEFAULT 'athlete'
                CHECK (role IN ('master_admin','admin','content','athlete')),
  team_id       TEXT,                                  -- e.g. "LAN" — required for athletes, nullable otherwise
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles (email);
CREATE INDEX IF NOT EXISTS profiles_role_idx  ON public.profiles (role);

-- Role definitions (for reference):
--   master_admin  → you; can manage everyone including other admins
--   admin         → ops team; can manage content/athlete users but not other admins
--   content       → internal content creator; full app access except People tab
--   athlete       → player/coach; restricted to their team's content generation,
--                   but can view all stats, team pages, player pages

-- ─── Trigger: auto-create profile on new auth user ─────────────────────────
-- Runs as SECURITY DEFINER so it can INSERT even though the new user hasn't
-- got a session yet. `search_path = public` keeps it hardened against
-- search-path-hijacking attacks (Supabase best-practice).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'athlete')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill: profiles for anyone who was invited BEFORE this migration ran.
INSERT INTO public.profiles (id, email, role)
SELECT u.id, u.email, 'athlete'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

-- ─── Helper functions ──────────────────────────────────────────────────────
-- All STABLE + SECURITY DEFINER so policies can call them without recursion.

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_team_id()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT team_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('master_admin','admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_master_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'master_admin'
  );
$$;

-- ─── RLS policies on profiles ──────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read their own row OR any row if they're admin.
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin());

-- Users can update their own display_name / team_id (but NOT role).
-- The "role" column is write-locked via the WITH CHECK clause — users can
-- update their own row only if the new role equals the old role.
DROP POLICY IF EXISTS "profiles_update_own_nonrole" ON public.profiles;
CREATE POLICY "profiles_update_own_nonrole" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()));

-- Admins can update any profile (including role changes).
DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- INSERT goes through the trigger (SECURITY DEFINER) — no row-level INSERT
-- policy needed for the trigger. But DO add one for admin-initiated inserts
-- (if we later add a manual "create profile" admin action).
DROP POLICY IF EXISTS "profiles_insert_admin" ON public.profiles;
CREATE POLICY "profiles_insert_admin" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- No DELETE policy — only service_role can delete profiles, and that only
-- happens via the ON DELETE CASCADE when the underlying auth.users row is
-- removed.

-- ─── Keep updated_at fresh ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_touch_updated_at ON public.profiles;
CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
