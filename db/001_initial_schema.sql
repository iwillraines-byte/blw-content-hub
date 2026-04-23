-- ─── BLW Content Hub — Initial Cloud Schema ────────────────────────────────
-- Run this ONCE in the Supabase SQL Editor (Dashboard → SQL Editor → New
-- Query → paste → Run). It is safe to re-run: every statement uses
-- IF NOT EXISTS / CREATE OR REPLACE so nothing breaks on repeat.
--
-- What this creates:
--   • 7 tables mirroring the app's local stores (media, overlays, effects,
--     requests, request_comments, manual_players, field_overrides)
--   • 1 table for AI usage telemetry
--   • 3 Storage buckets (media, overlays, effects) for binary files
--   • RLS enabled on every table with a default-deny policy (service_role
--     bypasses RLS; Phase 5 will add per-user/per-role policies)
--
-- Naming: `owner_id UUID NULL` columns are future-proofing for Phase 5.
-- Stay null today; backfilled when auth lands.

-- ─── Extensions ──────────────────────────────────────────────────────────────
-- `uuid-ossp` gives us gen_random_uuid() if we ever want server-generated ids.
-- (We currently generate UUIDs client-side so records keep the same id in
-- localStorage/IndexedDB and the cloud.)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── MEDIA — player + team assets ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.media (
  id            UUID        PRIMARY KEY,
  owner_id      UUID        NULL,                  -- phase 5 fills this
  name          TEXT        NOT NULL,
  storage_path  TEXT        NOT NULL,              -- e.g. "media/<uuid>.jpg"
  mime_type     TEXT,
  width         INT,
  height        INT,
  size_bytes    BIGINT,
  team          TEXT,                              -- "LAN", "AZS", ...
  player        TEXT,                              -- uppercase last name
  first_initial TEXT,                              -- "C" for C.ROSE
  num           TEXT,                              -- jersey, as displayed
  asset_type    TEXT,                              -- HEADSHOT / ACTION / LOGO_PRIMARY / ...
  scope         TEXT        NOT NULL DEFAULT 'player',  -- 'player' | 'team'
  variant       TEXT,                              -- free-form sub-tag
  drive_file_id TEXT,                              -- if sourced from Drive
  source        TEXT,                              -- 'upload' | 'drive' | 'ai-tag'
  tags          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_team_idx ON public.media (team);
CREATE INDEX IF NOT EXISTS media_player_idx ON public.media (team, player);
CREATE INDEX IF NOT EXISTS media_scope_idx ON public.media (scope);

-- ─── OVERLAYS — uploaded PNG overlays (not the bundled presets) ──────────────
CREATE TABLE IF NOT EXISTS public.overlays (
  id            UUID        PRIMARY KEY,
  owner_id      UUID        NULL,
  name          TEXT        NOT NULL,
  storage_path  TEXT        NOT NULL,
  type          TEXT,                              -- template type key
  team          TEXT,
  platform      TEXT,                              -- feed / portrait / story / landscape
  width         INT,
  height        INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS overlays_type_team_idx ON public.overlays (type, team);

-- ─── EFFECTS — uploaded effect PNGs (grain, leaks, etc) ──────────────────────
CREATE TABLE IF NOT EXISTS public.effects (
  id            UUID        PRIMARY KEY,
  owner_id      UUID        NULL,
  name          TEXT        NOT NULL,
  storage_path  TEXT        NOT NULL,
  width         INT,
  height        INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── REQUESTS — tracked content requests ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.requests (
  id          UUID        PRIMARY KEY,
  owner_id    UUID        NULL,
  team        TEXT        NOT NULL,
  template    TEXT,
  status      TEXT        NOT NULL DEFAULT 'pending',
  priority    TEXT        NOT NULL DEFAULT 'medium',
  requester   TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS requests_status_idx ON public.requests (status);
CREATE INDEX IF NOT EXISTS requests_team_idx ON public.requests (team);

-- ─── REQUEST_COMMENTS — threaded comments on a request ───────────────────────
CREATE TABLE IF NOT EXISTS public.request_comments (
  id          UUID        PRIMARY KEY,
  request_id  UUID        NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  owner_id    UUID        NULL,
  author      TEXT,
  role        TEXT,
  text        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_comments_req_idx ON public.request_comments (request_id);

-- ─── MANUAL_PLAYERS — roster additions made by hand ──────────────────────────
CREATE TABLE IF NOT EXISTS public.manual_players (
  id          UUID        PRIMARY KEY,
  owner_id    UUID        NULL,
  first_name  TEXT,
  last_name   TEXT        NOT NULL,
  team        TEXT        NOT NULL,
  num         TEXT,
  position    TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manual_players_team_idx ON public.manual_players (team);

-- ─── FIELD_OVERRIDES — layout customisations for Generate templates ─────────
-- One row per template+platform+field triple. Composite PK so upsert is clean.
CREATE TABLE IF NOT EXISTS public.field_overrides (
  owner_id       UUID        NULL,
  template_type  TEXT        NOT NULL,
  platform       TEXT        NOT NULL,
  field_key      TEXT        NOT NULL,
  x              INT,
  y              INT,
  font_size      INT,
  font           TEXT,
  color          TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (template_type, platform, field_key)
);

-- ─── AI_USAGE — daily counters (ideas, auto-tag, etc) ───────────────────────
CREATE TABLE IF NOT EXISTS public.ai_usage (
  owner_id     UUID        NULL,
  day          DATE        NOT NULL,
  kind         TEXT        NOT NULL,               -- 'ideas' | 'ideasCalls' | 'autoTag' | ...
  count        INT         NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, kind)
);

-- ─── RLS — default-deny everywhere ───────────────────────────────────────────
-- service_role bypasses RLS, so our /api/ endpoints still work. The anon key
-- used from the browser gets no access until Phase 5 adds policies.
ALTER TABLE public.media             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overlays          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.effects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requests          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_comments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_players    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_overrides   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage          ENABLE ROW LEVEL SECURITY;

-- ─── Storage buckets ────────────────────────────────────────────────────────
-- Three private buckets. Our /api/ endpoints upload/download via service_role;
-- when Phase 5 lands we'll add signed URLs for direct browser access.
INSERT INTO storage.buckets (id, name, public)
  VALUES ('media',    'media',    false)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public)
  VALUES ('overlays', 'overlays', false)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public)
  VALUES ('effects',  'effects',  false)
  ON CONFLICT (id) DO NOTHING;

-- ─── Done ───────────────────────────────────────────────────────────────────
-- Expected output: "Success. No rows returned" (or similar). If you see an
-- error, check: are you in the right project? Does the Supabase free tier
-- allow this many tables? (It does — 500-row limit is per-table, not table
-- count.)
