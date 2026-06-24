-- ─── BLW Content Hub — generate_log.posted ──────────────────────────────────
-- v5 audit catch-up. The team-page "posted?" toggle and the monthly post
-- counter read/write generate_log.posted, documented only in the
-- api/cloud-sync.js header. Without the column the PATCH toggle 500s and the
-- GET `.eq('posted', ...)` filter errors. (The PATCH tolerant-strip block only
-- maps 'hidden' to a migration hint, not 'posted', so a missing column falls
-- through to a generic 500 rather than the helpful 412.)
--
-- Idempotent. The UI treats a null/absent value as "posted" (the column's
-- default), so adding it is behavior-preserving.
ALTER TABLE generate_log
  ADD COLUMN IF NOT EXISTS posted BOOLEAN NOT NULL DEFAULT TRUE;
