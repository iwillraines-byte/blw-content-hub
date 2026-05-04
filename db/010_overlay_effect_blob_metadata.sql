-- ─── BLW Content Hub — Overlay + Effect blob metadata ──────────────────────
-- v4.5.22: adds optional mime_type / size_bytes columns to the overlays
-- and effects tables so they line up with the media table schema.
--
-- The server-side cloud-sync handler in api/cloud-sync.js was force-
-- injecting `mime_type` for all three blob kinds (media, overlay,
-- effect), which broke writes on databases where these columns don't
-- exist on the overlays / effects tables. v4.5.22 also adds a tolerant
-- upsert that strips unknown columns, so this migration is OPTIONAL —
-- but running it lets us track blob metadata uniformly across all three
-- tables (useful for storage-quota dashboards and future thumbnailing).
--
-- Safe to re-run (IF NOT EXISTS). No data loss; nullable columns added.

ALTER TABLE public.overlays
  ADD COLUMN IF NOT EXISTS mime_type  TEXT,
  ADD COLUMN IF NOT EXISTS size_bytes BIGINT;

ALTER TABLE public.effects
  ADD COLUMN IF NOT EXISTS mime_type  TEXT,
  ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
