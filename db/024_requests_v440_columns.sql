-- ─── BLW Content Hub — requests v4.4.0 columns ──────────────────────────────
-- v5 audit catch-up. The v4.4.0 request makeover (request types, athlete
-- role-gating, email notifications) added eight columns to `requests` that were
-- documented only in the api/cloud-sync.js header, never as a migration. The
-- tolerant upsert silently strips them on write (so requester_user_id / email
-- ownership is lost), and worse, the athlete GET scoping runs
-- `.or('requester_user_id.eq.<uuid>,requester_email.eq.<email>')` which ERRORS
-- outright if those columns are absent — an athlete either sees nothing or 500s
-- on their own request list. (The v5 IDOR fix in api/cloud-sync.js also relies
-- on requester_user_id to enforce request ownership.)
--
-- Safe to run on an existing `requests` table; ADD COLUMN IF NOT EXISTS is a
-- no-op where the column already exists. Idempotent.
ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'content',
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS need_by DATE,
  ADD COLUMN IF NOT EXISTS requester_email TEXT,
  ADD COLUMN IF NOT EXISTS requester_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS player_last_name TEXT,
  ADD COLUMN IF NOT EXISTS player_first_initial TEXT,
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(requester_user_id);
CREATE INDEX IF NOT EXISTS idx_requests_type ON requests(type);
