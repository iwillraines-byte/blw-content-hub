-- v4.8.2: Auto-unlink player records when their auth user is deleted.
--
-- Background: `manual_players.user_id` was added in v4.4.1 as a plain
-- UUID column (no foreign-key constraint). When the master deletes an
-- auth.users row through the Supabase dashboard (e.g. an athlete who
-- never registered, an account that needs a hard reset), the
-- manual_players.user_id stays pointing at the now-dead UUID. The link
-- picker in PeopleAdmin can't surface a dropdown option for the dead
-- user, so the row appears "stuck linked" and master has to either
-- manually unlink via the picker (one player at a time) or run an
-- UPDATE statement to clear orphans.
--
-- Fix: add a real FK with ON DELETE SET NULL. Now when an auth user is
-- deleted, every manual_players row that referenced them auto-clears
-- to NULL — making the player records immediately available for a new
-- athlete to claim via the v4.7.13 link picker.
--
-- Idempotent. Safe to re-run. Safe to run alongside or before/after
-- migration 016.

-- ─── 1. Clear any existing orphans before adding the constraint ──────────
-- If there's a stale user_id pointing at a deleted auth user, ADD
-- CONSTRAINT below would fail. Clear first so the migration completes
-- even on databases where master has deleted users in the past.
UPDATE public.manual_players mp
SET user_id = NULL
WHERE user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = mp.user_id
  );

-- ─── 2. Drop the column's existing constraint (if any) before re-adding ─
-- IF EXISTS on the drop, plus the deterministic constraint name pattern,
-- makes this safe to run multiple times. Postgres auto-names FKs as
-- `<table>_<column>_fkey` when none is provided, so we drop that exact
-- name; if it's not there, the DROP is a no-op.
ALTER TABLE public.manual_players
  DROP CONSTRAINT IF EXISTS manual_players_user_id_fkey;

-- ─── 3. Add the FK with cascade-to-null semantics ───────────────────────
-- ON DELETE SET NULL: deleting the referenced auth user clears the
-- link, leaving the player record intact + claimable. NOT VALID would
-- skip the up-front check for existing data, but step 1 already
-- guarantees no orphans, so a normal (immediate-check) constraint is
-- safe and simpler.
ALTER TABLE public.manual_players
  ADD CONSTRAINT manual_players_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;

-- The existing idx_manual_players_user index (added v4.4.1) covers
-- lookups by user_id, so the FK's deletion check is fast. No new
-- index needed.
