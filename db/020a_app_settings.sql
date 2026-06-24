-- ─── BLW Content Hub — app_settings table ───────────────────────────────────
-- v5 audit catch-up. api/app-settings.js upserts/reads a key/value app_settings
-- table that backs Drive config, the content calendar, per-team monthly post
-- targets, team socials, team header photos, hero headlines, AND per-team brand
-- voice (consumed by api/_brand-voice.js, api/captions.js, api/ideas.js) — but
-- no migration ever created it. Unlike content-ideas it has NO tableMissing
-- soft-fail, so GET/POST return a raw 500 if the table is absent. db/021 also
-- runs `UPDATE app_settings ...`.
--
-- Numbered 020a so a fresh apply creates the table BEFORE db/021's UPDATE.
-- Writes are master-only and go through the service-role API; reads are gated
-- there too — so RLS default-deny is the correct posture. Idempotent.
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
