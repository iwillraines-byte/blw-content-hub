-- ─── Migration 011 — generate_log.hidden ──────────────────────────────────
-- v4.5.37: Master admin can hide a post from the dashboard "Recent posts"
-- strip and from every team / player page that surfaces a post grid.
-- Defaults to false so no existing rows change visibility.
--
-- Distinct from `posted` — `posted=false` means "wasn't actually posted to
-- a social account yet" (counter math), `hidden=true` means "permanently
-- excluded from app-wide display surfaces" (mistake, sensitive content,
-- duplicate). The two flags can coexist independently on a row.
--
-- Safe to re-run.

ALTER TABLE public.generate_log
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS generate_log_hidden_idx ON public.generate_log (hidden);
