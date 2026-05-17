-- v4.7.12: Silent-create athlete accounts.
--
-- Adds a `pending_invite` flag to profiles so master_admin can pre-stage
-- athlete accounts (create the auth user + profile row WITHOUT sending
-- the magic-link email) and then send the invite later in batches.
--
-- Workflow this unlocks:
--   1. Silent-create 10 athletes → profiles appear with pending_invite=true
--   2. Master goes to each player page and links the user via the
--      AthleteVoiceCard picker (the new accounts are eligible because
--      they exist as auth users with role='athlete')
--   3. When ready (Monday 9am, batches of 3, whatever), master clicks
--      "Send invite" on each row → Supabase emails the magic link →
--      pending_invite flips to false
--
-- The trigger from migration 003 still creates the profile row on
-- auth.users insert; we don't need to change that. Default for the
-- new column is FALSE so existing rows + the normal invite path stay
-- exactly as they are.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pending_invite BOOLEAN NOT NULL DEFAULT FALSE;

-- No RLS change needed — pending_invite reads through the same SELECT
-- policy as the rest of the profile columns. Only master_admin can flip
-- it (enforced server-side in api/admin-people.js).
