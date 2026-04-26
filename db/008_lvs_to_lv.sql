-- ─── BLW Content Hub — Rename team LVS → LV ─────────────────────────────────
-- The Las Vegas Scorpions team id changes from "LVS" to "LV" everywhere,
-- including in the application code. This migration fixes any rows that
-- already exist in Supabase so they don't orphan after the code change.
-- Safe to re-run.

UPDATE public.manual_players  SET team    = 'LV' WHERE team    = 'LVS';
UPDATE public.media           SET team    = 'LV' WHERE team    = 'LVS';
UPDATE public.requests        SET team    = 'LV' WHERE team    = 'LVS';
UPDATE public.generate_log    SET team    = 'LV' WHERE team    = 'LVS';
UPDATE public.overlays        SET team    = 'LV' WHERE team    = 'LVS';
UPDATE public.profiles        SET team_id = 'LV' WHERE team_id = 'LVS';
