-- ─── Migration 013 — API rate limiting table + RPC ─────────────────────────
-- v4.5.38 (security audit I2): per-user-per-endpoint hourly counter so
-- the AI endpoints (ideas, captions, auto-tag) can't be hammered by a
-- compromised account or an over-eager script. Each endpoint calls the
-- increment_rate_limit() RPC at the top of the handler and 429s when
-- the count exceeds the role-specific limit.
--
-- Bucket granularity is the hour (date_trunc('hour', now())) — a sliding
-- window would be more accurate but needs a heavier query per call. The
-- hour bucket is fine for 100-user scale: one missed limit at the hour
-- boundary is irrelevant when the whole point is "stop a runaway loop"
-- not "perfect throttling."
--
-- Storage cost: ~100 users × 3 endpoints × 24 buckets/day = 7200 rows
-- per day. Negligible. Cleanup is opportunistic — the RPC clears rows
-- older than 24 hours on a 1-in-1000 dice roll, so the table self-trims
-- without a cron dependency.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.api_rate_limit (
  user_id     UUID         NOT NULL,
  endpoint    TEXT         NOT NULL,
  hour_bucket TIMESTAMPTZ  NOT NULL,
  count       INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, endpoint, hour_bucket)
);

CREATE INDEX IF NOT EXISTS api_rate_limit_bucket_idx
  ON public.api_rate_limit (hour_bucket);

-- Default-deny RLS — only the service role (used by API endpoints)
-- can read/write this table. Browsers should never see it.
ALTER TABLE public.api_rate_limit ENABLE ROW LEVEL SECURITY;

-- ─── increment_rate_limit RPC ──────────────────────────────────────────────
-- Atomic increment. INSERT … ON CONFLICT … DO UPDATE returns the new
-- count, which the caller compares against the role-specific limit.
-- SECURITY DEFINER + search_path locked per Supabase best practice.
--
-- Returns INTEGER — the count for the current hour after this call.
-- Caller decides if that count exceeds their role's limit.

CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_user_id  UUID,
  p_endpoint TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket TIMESTAMPTZ := date_trunc('hour', now());
  v_count  INT;
BEGIN
  -- Opportunistic GC — 1 in 1000 calls trims rows older than 24h.
  -- Cheap because the index on hour_bucket makes the delete pass fast.
  IF random() < 0.001 THEN
    DELETE FROM public.api_rate_limit
      WHERE hour_bucket < now() - INTERVAL '24 hours';
  END IF;

  INSERT INTO public.api_rate_limit (user_id, endpoint, hour_bucket, count)
    VALUES (p_user_id, p_endpoint, v_bucket, 1)
  ON CONFLICT (user_id, endpoint, hour_bucket)
    DO UPDATE SET count = api_rate_limit.count + 1
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$$;

-- Allow the service role to call it. (Anon should NEVER call this — the
-- endpoint handlers gate by user.id from the JWT first.)
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(UUID, TEXT)
  TO service_role;
