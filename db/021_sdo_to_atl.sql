-- 021: Full SDO → ATL team-id migration (v4.17.0).
--
-- The v4.8.3 Orcas → Ballers rebrand kept 'SDO' as the internal database
-- key with an 'ATL' display overlay. Atlanta is now the league's biggest
-- brand (~2.5k IG followers in month one) — the id migrates to match.
-- The app code (v4.17.0) reads both: 'SDO' resolves as a legacy alias of
-- 'ATL' everywhere, so it is safe to deploy the app and run this in
-- either order.
--
-- Run each block; all are idempotent (re-running matches zero rows).

-- Team-keyed content rows.
UPDATE requests       SET team = 'ATL' WHERE team = 'SDO';
UPDATE manual_players SET team = 'ATL' WHERE team = 'SDO';
UPDATE generate_log   SET team = 'ATL' WHERE team = 'SDO';
UPDATE content_ideas  SET team = 'ATL' WHERE team = 'SDO';
UPDATE media          SET team = 'ATL' WHERE team = 'SDO';
UPDATE overlays       SET team = 'ATL' WHERE team = 'SDO';

-- Athlete accounts pinned to the team.
UPDATE profiles SET team_id = 'ATL' WHERE team_id = 'SDO';

-- AI memory scoped to the team.
UPDATE ai_memory SET scope_id = 'ATL' WHERE scope = 'team' AND scope_id = 'SDO';

-- Idea feedback rows tagged with the team (db/019).
UPDATE idea_feedback SET team = 'ATL' WHERE team = 'SDO';

-- Content-calendar marks live under a per-team app_settings key.
UPDATE app_settings SET key = 'content-calendar-ATL'
WHERE key = 'content-calendar-SDO'
  AND NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'content-calendar-ATL');

-- Media FILENAMES that start with "SDO_" are intentionally left as-is:
-- the app canonicalizes the team prefix at parse time (parseFilename),
-- so old files keep matching ATL players without touching storage blobs.

-- Verify:
--   SELECT 'requests' AS t, count(*) FROM requests WHERE team='SDO'
--   UNION ALL SELECT 'manual_players', count(*) FROM manual_players WHERE team='SDO'
--   UNION ALL SELECT 'generate_log', count(*) FROM generate_log WHERE team='SDO'
--   UNION ALL SELECT 'content_ideas', count(*) FROM content_ideas WHERE team='SDO'
--   UNION ALL SELECT 'media', count(*) FROM media WHERE team='SDO'
--   UNION ALL SELECT 'profiles', count(*) FROM profiles WHERE team_id='SDO';
-- Every count should be 0.
