-- 020: Two-way request threads + unread tracking (v4.15.0).
--
-- requests.decline_reason — structured decline reason (was only embedded in
--   a comment's text before; now the card can render it directly).
-- request_comments.kind — 'comment' (a human message), 'status' (system pill:
--   "Status → In progress"), 'decline' (structured decline w/ reason).
-- request_comments.author_user_id — who wrote it; drives "mine vs theirs"
--   thread bubbles and excludes your own messages from your unread count.
-- request_reads — per-user last-read marker per request. Stored server-side
--   (not localStorage) so reading on your phone clears the badge on your
--   laptop too.

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS decline_reason TEXT;

ALTER TABLE request_comments
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'comment';

ALTER TABLE request_comments
  ADD COLUMN IF NOT EXISTS author_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS request_reads (
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  request_id   TEXT NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, request_id)
);

-- Service-role access only (reads/writes go through /api/request-reads).
ALTER TABLE request_reads ENABLE ROW LEVEL SECURITY;
