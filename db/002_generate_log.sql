-- ─── Migration 002 — generate_log ──────────────────────────────────────────
-- Tracks every Generate download so the dashboard can show recent posts
-- and Settings can show a personal download history. Each entry stores the
-- full settings snapshot so clicking a history item re-opens Generate with
-- the same composition ready to tweak.
--
-- The thumbnail is stored in a dedicated bucket ('generate-thumbs') as a
-- small PNG (~400 px wide) — cheap for the dashboard to preview.
--
-- Safe to re-run: every statement is IF NOT EXISTS / ON CONFLICT DO NOTHING.

CREATE TABLE IF NOT EXISTS public.generate_log (
  id            UUID        PRIMARY KEY,
  owner_id      UUID        NULL,                 -- phase 5 fills this
  team          TEXT,                             -- "LAN", "AZS", ...
  template_type TEXT,                             -- "player-stat", "gameday", ...
  platform      TEXT,                             -- "feed", "portrait", ...
  settings      JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- snapshot of custom fields, player, etc
  thumbnail_storage_path TEXT,                    -- "generate-thumbs/<id>.png"
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generate_log_created_idx ON public.generate_log (created_at DESC);
CREATE INDEX IF NOT EXISTS generate_log_owner_idx ON public.generate_log (owner_id);

ALTER TABLE public.generate_log ENABLE ROW LEVEL SECURITY;

-- Dedicated bucket for thumbnails. Private — served via signed URLs from
-- our API. When Phase 5 lands we can flip this to public if we want
-- link-sharable history entries.
INSERT INTO storage.buckets (id, name, public)
  VALUES ('generate-thumbs', 'generate-thumbs', false)
  ON CONFLICT (id) DO NOTHING;
