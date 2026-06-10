-- 019: Server-side idea feedback + idea timeliness (v4.14.0).
--
-- Thumbs votes were localStorage-only — each device biased only its own
-- next generation. This table makes votes global: /api/ideas reads the
-- latest rows so EVERY user's feedback shapes generation for everyone.
--
-- Also adds content_ideas.timeliness ("this-week" | "evergreen") so the
-- dashboard can chip/filter ideas by freshness.

CREATE TABLE IF NOT EXISTS idea_feedback (
  idea_id    TEXT NOT NULL,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  vote       TEXT NOT NULL CHECK (vote IN ('up','down')),
  headline   TEXT,
  angle      TEXT,
  team       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (idea_id, user_id)
);

CREATE INDEX IF NOT EXISTS idea_feedback_created_idx
  ON idea_feedback (created_at DESC);

-- Service-role access only (all reads/writes go through /api endpoints
-- using the service client) — enable RLS with no public policies, matching
-- the pattern of the other api-managed tables.
ALTER TABLE idea_feedback ENABLE ROW LEVEL SECURITY;

ALTER TABLE content_ideas
  ADD COLUMN IF NOT EXISTS timeliness TEXT;
