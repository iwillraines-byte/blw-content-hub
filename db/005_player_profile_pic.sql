-- ─── BLW Content Hub — Player profile-picture override ─────────────────────
-- Adds `profile_media_id` to manual_players so an admin can pick any
-- uploaded asset as a player's profile circle, overriding the default
-- "first HEADSHOT/PORTRAIT match" heuristic.
--
-- NULL means "no override — use the default headshot match". Setting it
-- to a media.id lets admins point at an ACTION shot, a custom crop, etc.
--
-- Safe to re-run (IF NOT EXISTS).

ALTER TABLE public.manual_players
  ADD COLUMN IF NOT EXISTS profile_media_id UUID;

-- We don't add a foreign key constraint because media rows may be
-- deleted out-of-band (cascading deletes across IDB + cloud + storage
-- bucket are handled by application logic in saveMedia/deleteMedia).
-- A dangling profile_media_id just falls back to the default behavior.

CREATE INDEX IF NOT EXISTS manual_players_profile_media_idx
  ON public.manual_players (profile_media_id)
  WHERE profile_media_id IS NOT NULL;
