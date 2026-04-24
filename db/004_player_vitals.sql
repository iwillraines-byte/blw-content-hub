-- ─── BLW Content Hub — Player vitals ────────────────────────────────────────
-- Adds columns to manual_players for the information that shows up on the
-- player page header: height, weight, birthdate, bats/throws, birthplace.
--
-- These are nullable — the app still renders "—" when missing. Admins fill
-- them in manually for now; a future scraper + BLW API integration will
-- auto-populate from an external source.
--
-- Safe to re-run (IF NOT EXISTS).

ALTER TABLE public.manual_players
  ADD COLUMN IF NOT EXISTS height_in     INT,              -- total inches, e.g. 73 for 6'1"
  ADD COLUMN IF NOT EXISTS weight_lbs    INT,
  ADD COLUMN IF NOT EXISTS birthdate     DATE,
  ADD COLUMN IF NOT EXISTS bats          TEXT CHECK (bats IN ('R','L','S')),     -- Right / Left / Switch
  ADD COLUMN IF NOT EXISTS throws        TEXT CHECK (throws IN ('R','L')),
  ADD COLUMN IF NOT EXISTS birthplace    TEXT,
  ADD COLUMN IF NOT EXISTS status        TEXT DEFAULT 'active',                  -- active | injured | inactive
  ADD COLUMN IF NOT EXISTS nickname      TEXT;

-- Helpful indices for lookups by team + last name (already exists implicitly
-- via the table's usage pattern, but explicit makes it fast).
CREATE INDEX IF NOT EXISTS manual_players_team_last_idx
  ON public.manual_players (team, last_name);
