-- 022: Media usage counters (v4.20.0).
--
-- Tracks how often each media file is "saved to a device" (downloaded from
-- the Files library) and "used in Studio" (chosen as the background of an
-- exported post). Powers the master-only "Most-used media" leaderboard in
-- Settings. Counters start accumulating at deploy — there is no historical
-- backfill (we never logged these events before).
--
-- One row per (media_id, kind) with a running count + last-used stamp.
-- Mirrors the api_rate_limit RPC pattern (db/013): an atomic
-- INSERT … ON CONFLICT … DO UPDATE increment so concurrent writes from
-- different users/devices don't clobber each other.

CREATE TABLE IF NOT EXISTS public.media_usage (
  media_id     UUID         NOT NULL,
  kind         TEXT         NOT NULL,          -- 'download' | 'studio'
  count        INT          NOT NULL DEFAULT 0,
  last_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_user_id UUID,
  PRIMARY KEY (media_id, kind)
);

CREATE INDEX IF NOT EXISTS media_usage_count_idx ON public.media_usage (count DESC);

-- Service-role only (all reads/writes go through /api/media-usage).
ALTER TABLE public.media_usage ENABLE ROW LEVEL SECURITY;

-- ─── increment_media_usage RPC ─────────────────────────────────────────────
-- Atomic per-(media, kind) increment, stamping who/when last used it.
-- Returns the new count. SECURITY DEFINER + locked search_path per Supabase
-- best practice.
CREATE OR REPLACE FUNCTION public.increment_media_usage(
  p_media_id UUID,
  p_kind     TEXT,
  p_user_id  UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  INSERT INTO public.media_usage (media_id, kind, count, last_at, last_user_id)
    VALUES (p_media_id, p_kind, 1, now(), p_user_id)
  ON CONFLICT (media_id, kind)
    DO UPDATE SET count = media_usage.count + 1,
                  last_at = now(),
                  last_user_id = p_user_id
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_media_usage(UUID, TEXT, UUID)
  TO service_role;
