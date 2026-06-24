-- ─── BLW Content Hub — content_ideas table ──────────────────────────────────
-- v5 audit catch-up. api/content-ideas.js (the cross-user AI idea store powering
-- the dashboard / team / player idea rails) defined this table only as a comment
-- in its header — no migration ever created it. db/019 then runs
-- `ALTER TABLE content_ideas ADD COLUMN timeliness` and db/021 runs
-- `UPDATE content_ideas SET team='ATL'`, both of which 500 on a DB where the
-- table was never hand-created. api/content-ideas.js + api/ideas.js soft-fail
-- (503 / silent no-op) so idea persistence just silently stops working.
--
-- Numbered 018b so a fresh apply creates the table BEFORE db/019's ALTER and
-- db/021's UPDATE. Includes `timeliness` up front (db/019 re-adds it IF NOT
-- EXISTS — no conflict). Idempotent.
CREATE TABLE IF NOT EXISTS content_ideas (
  id                   TEXT PRIMARY KEY,
  headline             TEXT NOT NULL,
  narrative            TEXT,
  description          TEXT,
  team                 TEXT NOT NULL,
  player_last_name     TEXT,
  player_first_initial TEXT,
  template_id          TEXT,
  angle                TEXT,
  data_points          JSONB DEFAULT '[]'::jsonb,
  captions             JSONB DEFAULT '{}'::jsonb,
  prefill              JSONB DEFAULT '{}'::jsonb,
  source               TEXT NOT NULL DEFAULT 'ai',
  timeliness           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by           TEXT
);
CREATE INDEX IF NOT EXISTS content_ideas_team_idx        ON content_ideas (team);
CREATE INDEX IF NOT EXISTS content_ideas_team_player_idx ON content_ideas (team, player_last_name);
CREATE INDEX IF NOT EXISTS content_ideas_created_at_idx  ON content_ideas (created_at DESC);

-- Service-role API is the only accessor (api/content-ideas.js gates via
-- requireUser then reads with the service client). Enable RLS default-deny to
-- block any direct anon/client access, matching the db/001 posture.
ALTER TABLE content_ideas ENABLE ROW LEVEL SECURITY;
