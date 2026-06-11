-- 018a: manual_players column catch-up. RUN THIS BEFORE 018.
--
-- Discovered 2026-06-11: running 018 failed with "column
-- canon.profile_media_id does not exist" — meaning db/005 (and possibly
-- 004/006/009) was never run against this Supabase project. The app's
-- tolerant cloud-sync has been silently STRIPPING these fields from every
-- write rather than erroring, which is the true root cause of "profile
-- images don't save globally": the photo pick never landed in the cloud
-- at all, on any row.
--
-- This file is the union of every manual_players column the app writes
-- (004 vitals, 005 profile pic, 006 socials/rookie, 009 pan/zoom, plus
-- athlete_voice + user_id from v4.4.x which only lived in code comments).
-- Every statement is IF NOT EXISTS — safe to run no matter which subset
-- of the older migrations actually ran.
--
-- OPTIONAL STEP 0 — see exactly what you have today:
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'manual_players' ORDER BY column_name;

ALTER TABLE public.manual_players
  -- 004: vitals
  ADD COLUMN IF NOT EXISTS height_in   INTEGER,
  ADD COLUMN IF NOT EXISTS weight_lbs  INTEGER,
  ADD COLUMN IF NOT EXISTS birthdate   DATE,
  ADD COLUMN IF NOT EXISTS bats        TEXT,
  ADD COLUMN IF NOT EXISTS throws      TEXT,
  ADD COLUMN IF NOT EXISTS birthplace  TEXT,
  ADD COLUMN IF NOT EXISTS status      TEXT,
  ADD COLUMN IF NOT EXISTS nickname    TEXT,
  -- 005: profile-pic override
  ADD COLUMN IF NOT EXISTS profile_media_id UUID,
  -- 006: socials + rookie
  ADD COLUMN IF NOT EXISTS instagram_handle TEXT,
  ADD COLUMN IF NOT EXISTS fun_facts        TEXT,
  ADD COLUMN IF NOT EXISTS is_rookie        BOOLEAN,
  -- 009: profile-pic pan/zoom
  ADD COLUMN IF NOT EXISTS profile_offset_x REAL,
  ADD COLUMN IF NOT EXISTS profile_offset_y REAL,
  ADD COLUMN IF NOT EXISTS profile_zoom     REAL,
  -- v4.4.x code-comment-only columns
  ADD COLUMN IF NOT EXISTS athlete_voice JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS user_id UUID;

CREATE INDEX IF NOT EXISTS manual_players_profile_media_idx
  ON public.manual_players (profile_media_id)
  WHERE profile_media_id IS NOT NULL;

-- AFTER running this: re-run db/018_merge_mike_stiles.sql (inspect-first
-- SELECT, then the merge transaction).
--
-- THEN, in the app: re-pick the profile photos you set before today.
-- The columns existed nowhere in the cloud, so there is no historical
-- photo data to backfill — but with v4.13.0's verified writes, every new
-- pick gets a confirmed cloud write and shows up on all devices.
