-- ─── BLW Content Hub — Profile picture pan/zoom positioning ───────────────
-- Adds three columns to manual_players so an admin can pan and zoom the
-- chosen profile photo. Values are stored as small floats:
--   profile_offset_x  : -1.0 to 1.0 (fraction of available pan range)
--   profile_offset_y  : -1.0 to 1.0
--   profile_zoom      :  1.0 to 4.0 (multiplier on cover-crop)
--
-- All NULL/0 defaults mean "identity" — the avatar renders exactly as it
-- did before this migration. Safe to re-run (IF NOT EXISTS).

ALTER TABLE public.manual_players
  ADD COLUMN IF NOT EXISTS profile_offset_x REAL,
  ADD COLUMN IF NOT EXISTS profile_offset_y REAL,
  ADD COLUMN IF NOT EXISTS profile_zoom     REAL;

-- No index needed — these are read alongside the rest of the row, never
-- queried independently.
