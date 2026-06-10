-- 018: Merge the duplicate "Mike Stiles" manual_players row into the
-- canonical "Michael Stiles" row (MIA).
--
-- Background: the player goes by Michael; "Mike Stiles" is a legacy spelling.
-- upsertManualPlayer matches on exact first name, so edits made on the legacy
-- /mike-stiles page (profile photo, bio, etc.) landed on a SEPARATE row from
-- the one the canonical /michael-stiles page reads. v4.13.0 canonicalizes the
-- slug client-side so no NEW legacy writes can happen; this migration merges
-- the data the duplicate already collected and removes it.
--
-- STEP 1 — INSPECT FIRST. Run this alone and eyeball both rows so you know
-- what is about to be merged:
--
--   SELECT id, first_name, last_name, team, num, profile_media_id,
--          profile_offset_x, profile_offset_y, profile_zoom,
--          athlete_voice, user_id, notes, nickname, instagram_handle,
--          fun_facts, is_rookie
--   FROM manual_players
--   WHERE team = 'MIA' AND lower(last_name) = 'stiles';
--
-- If only ONE row comes back (first_name = 'Michael'), there is no duplicate
-- — skip the rest of this file.
--
-- STEP 2 — MERGE + DELETE. Copies any value the canonical row is missing
-- from the duplicate, then deletes the duplicate. Transactional: all or
-- nothing.

BEGIN;

UPDATE manual_players AS canon SET
  num               = COALESCE(NULLIF(canon.num, ''), dup.num),
  position          = COALESCE(NULLIF(canon.position, ''), dup.position),
  notes             = COALESCE(NULLIF(canon.notes, ''), dup.notes),
  height_in         = COALESCE(canon.height_in, dup.height_in),
  weight_lbs        = COALESCE(canon.weight_lbs, dup.weight_lbs),
  birthdate         = COALESCE(canon.birthdate, dup.birthdate),
  bats              = COALESCE(NULLIF(canon.bats, ''), dup.bats),
  throws            = COALESCE(NULLIF(canon.throws, ''), dup.throws),
  birthplace        = COALESCE(NULLIF(canon.birthplace, ''), dup.birthplace),
  status            = COALESCE(NULLIF(canon.status, ''), dup.status),
  nickname          = COALESCE(NULLIF(canon.nickname, ''), dup.nickname),
  profile_media_id  = COALESCE(canon.profile_media_id, dup.profile_media_id),
  profile_offset_x  = COALESCE(canon.profile_offset_x, dup.profile_offset_x),
  profile_offset_y  = COALESCE(canon.profile_offset_y, dup.profile_offset_y),
  profile_zoom      = COALESCE(canon.profile_zoom, dup.profile_zoom),
  instagram_handle  = COALESCE(NULLIF(canon.instagram_handle, ''), dup.instagram_handle),
  fun_facts         = COALESCE(NULLIF(canon.fun_facts, ''), dup.fun_facts),
  is_rookie         = COALESCE(canon.is_rookie, dup.is_rookie),
  athlete_voice     = CASE
                        WHEN canon.athlete_voice IS NULL
                          OR canon.athlete_voice::text IN ('{}', 'null', '')
                        THEN dup.athlete_voice
                        ELSE canon.athlete_voice
                      END,
  user_id           = COALESCE(canon.user_id, dup.user_id)
FROM manual_players AS dup
WHERE canon.team = 'MIA' AND lower(canon.last_name) = 'stiles'
  AND canon.first_name = 'Michael'
  AND dup.team = 'MIA' AND lower(dup.last_name) = 'stiles'
  AND dup.first_name = 'Mike';

DELETE FROM manual_players
WHERE team = 'MIA' AND lower(last_name) = 'stiles' AND first_name = 'Mike';

COMMIT;

-- STEP 3 — VERIFY. Re-run the STEP 1 SELECT: exactly one row, first_name
-- 'Michael', carrying whichever profile_media_id / voice / vitals existed
-- on either row. The app cleans stale device caches automatically: the next
-- hydrate deletes local rows whose id no longer exists in the cloud.
