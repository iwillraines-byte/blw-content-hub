-- ============================================================================
-- BLW — Media integrity check (v5.2.0)
-- ============================================================================
-- Read-only diagnostics for the "profile photo shows on my device but is blank
-- on a new device" bug. A profile_media_id must point at a media row that has
-- a blob in storage (storage_path not null); anything else renders blank
-- elsewhere. The app exposes the same scan at GET /api/media-health and a
-- one-click "Repair unsynced media" button in Files; these queries let an
-- operator inspect the state directly in the Supabase SQL editor.
--
-- Nothing here mutates data. Section 4 is an OPTIONAL repair, commented out.
-- ============================================================================

-- 1) ORPHANED / BROKEN PINS — players whose pinned photo can't be shown
--    elsewhere. reason: 'media-missing' = no media row at all;
--    'no-blob' = row exists but was never uploaded to storage.
select
  mp.id                as manual_player_id,
  coalesce(mp.name, trim(coalesce(mp.first_name,'') || ' ' || coalesce(mp.last_name,''))) as player,
  mp.team,
  mp.num,
  mp.profile_media_id,
  case when m.id is null then 'media-missing'
       when m.storage_path is null then 'no-blob'
  end                  as reason
from public.manual_players mp
left join public.media m on m.id = mp.profile_media_id
where mp.profile_media_id is not null
  and (m.id is null or m.storage_path is null)
order by mp.team, mp.num, player;

-- 2) SUMMARY — how many pins are healthy vs broken.
select
  count(*) filter (where mp.profile_media_id is not null)                                        as total_pins,
  count(*) filter (where mp.profile_media_id is not null and m.id is not null and m.storage_path is not null) as healthy,
  count(*) filter (where mp.profile_media_id is not null and m.id is null)                        as media_missing,
  count(*) filter (where mp.profile_media_id is not null and m.id is not null and m.storage_path is null) as no_blob
from public.manual_players mp
left join public.media m on m.id = mp.profile_media_id;

-- 3) MEDIA ROWS WITH NO STORAGE — any media row whose blob never landed
--    (should be empty on a healthy DB, since storage_path is NOT NULL; a row
--    here means the column was manually altered nullable).
select id, name, team, "player", num, storage_path, created_at
from public.media
where storage_path is null
order by created_at desc;

-- 4) OPTIONAL REPAIR — unpin the broken references so the avatar falls back to
--    the default headshot heuristic instead of a permanent blank. Prefer the
--    in-app "Repair unsynced media" button first (it re-uploads the real blob
--    when it still exists locally). Only unpin the ones that can't be repaired.
-- update public.manual_players mp
-- set profile_media_id = null
-- from public.media m
-- where mp.profile_media_id is not null
--   and mp.profile_media_id = m.id
--   and m.storage_path is null;   -- (add: OR the row is missing — do that as a separate NOT EXISTS update)
