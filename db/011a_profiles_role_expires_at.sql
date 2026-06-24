-- ─── BLW Content Hub — profiles.role_expires_at ─────────────────────────────
-- v5 audit catch-up. The time-boxed elevated-access feature (temp-access.jsx,
-- api/_supabase.js, src/auth.jsx) reads profiles.role_expires_at, and db/012's
-- WITH CHECK locks it — but no migration ever CREATED the column. db/012 has a
-- DO-block fallback that silently installs a WEAKER self-update policy (without
-- the role_expires_at lock) when the column is absent. So on any DB that never
-- hand-added this column, the intended C1 security lock is downgraded and a
-- temp elevation cannot persist an expiry.
--
-- Numbered 011a so a fresh apply runs it BEFORE db/012, letting 012 install its
-- full WITH CHECK. On an existing DB: run this, THEN RE-RUN db/012 so the
-- strong self-update policy (locking team_id, email, role, role_expires_at) is
-- (re)installed. Idempotent.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role_expires_at TIMESTAMPTZ;
