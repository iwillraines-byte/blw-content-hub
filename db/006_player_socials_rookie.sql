-- ─── BLW Content Hub — Instagram + fun facts + rookie flag ─────────────────
-- Player profiles surface a small dropdown badge with their Instagram
-- handle + a short fun-facts blurb, plus a tiny "ROOKIE" chip next to
-- the name when applicable. All three fields are intentionally surfaced
-- to authenticated viewers (the app is gated by login).
--
-- Instagram is treated as opt-in self-promotion rather than PII — players
-- explicitly submit it via the Google Form. The server-side PII
-- deny-list still blocks personal email/phone/address by default.
--
-- Safe to re-run.

ALTER TABLE public.manual_players
  ADD COLUMN IF NOT EXISTS instagram_handle TEXT,        -- without the leading @
  ADD COLUMN IF NOT EXISTS fun_facts        TEXT,        -- free-form, shows in dropdown
  ADD COLUMN IF NOT EXISTS is_rookie        BOOLEAN DEFAULT FALSE;
