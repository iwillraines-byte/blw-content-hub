-- ============================================================================
-- BLW — Cousin profile-photo cleanup  (companion to app fix v5.1.6)
-- ============================================================================
-- Context: Logan Rose & Luke Rose (and James Lee & Justin Lee) share team +
-- last name + first initial, so collapsed manual_players rows caused one
-- cousin's profile photo to overwrite the other's.
--
-- The APP now self-heals: the next time you set each cousin's profile photo
-- on their player page, the write lands on / creates the correct per-cousin
-- row (keyed by jersey number) and backfills the name. So this SQL is
-- OPTIONAL — run it to inspect and clean the data immediately instead of
-- waiting for the next photo save.
--
-- Cousins (share team + last name + initial; DISTINCT jersey #):
--   DAL: Logan Rose #08, Luke Rose #05
--   LV : James Lee #05,  Justin Lee #18
-- Carson Rose (#06, "C. Rose") is a DIFFERENT initial and was never affected.
-- ============================================================================

-- ── 1) DIAGNOSTIC: every Rose/Lee manual_players row + its photo pin ─────────
select id, name, first_name, last_name, team, num, profile_media_id, user_id
from public.manual_players
where (team = 'DAL' and lower(last_name) = 'rose')
   or (team = 'LV'  and lower(last_name) = 'lee')
order by team, num nulls last, name;

-- ── 2) SAFE BACKFILL by jersey number ───────────────────────────────────────
-- Fills first_name/name ONLY on rows that already carry the correct jersey
-- number but have a blank or initial-only first name ("", "L", "L."). Never
-- overwrites an existing full first name. This resolves the common case where
-- two rows exist (one per number) but neither had a first name.
update public.manual_players m
set first_name = c.first_name,
    name       = c.first_name || ' ' || c.last_name
from (values
    ('DAL','rose','8','Logan','Rose'),
    ('DAL','rose','5','Luke','Rose'),
    ('LV','lee','5','James','Lee'),
    ('LV','lee','18','Justin','Lee')
) as c(team, ln, num, first_name, last_name)
where m.team = c.team
  and lower(m.last_name) = c.ln
  and regexp_replace(coalesce(m.num,''), '^0+', '') = c.num
  and (m.first_name is null or m.first_name = '' or m.first_name ~ '^[A-Za-z]\.?$');

-- ── 3) DETECT a fully-collapsed shared row (no jersey number) ────────────────
-- If this returns a Rose/Lee row, both cousins may be sharing it. A no-number
-- row can't be auto-split (we can't tell whose photo is on it), so handle it
-- manually with 3a, OR just re-set each cousin's photo in the app afterward.
select id, name, first_name, last_name, team, num, profile_media_id
from public.manual_players
where ((team = 'DAL' and lower(last_name) = 'rose')
    or (team = 'LV'  and lower(last_name) = 'lee'))
  and (num is null or num = '' or num = '00');

-- ── 3a) OPTIONAL manual split of a shared no-number row ──────────────────────
-- Decide which cousin the CURRENTLY-PINNED photo (profile_media_id) belongs
-- to, claim the row for that cousin, and let the other cousin get a fresh row
-- on their next photo save in the app. Example (uncomment + set the id):
-- update public.manual_players
-- set num = '08', first_name = 'Logan', name = 'Logan Rose'
-- where id = '<paste the shared row id from query 3>';

-- ── 4) GENERIC AUDIT: any other potential same-initial collapse ──────────────
-- Surfaces every team/last name with 2+ manual rows that share a first initial
-- but have blank/initial-only first names — future cousin-collision candidates.
select team, last_name,
       count(*)                                             as rows,
       array_agg(coalesce(nullif(first_name,''), '∅') order by num) as first_names,
       array_agg(coalesce(num, '∅')                   order by num) as nums
from public.manual_players
group by team, last_name
having count(*) > 1
   and count(*) filter (
     where first_name is null or first_name = '' or first_name ~ '^[A-Za-z]\.?$'
   ) > 0
order by team, last_name;
