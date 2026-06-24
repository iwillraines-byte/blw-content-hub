-- ============================================================================
-- BLW Studio v5 — migration drift audit. Paste into Supabase SQL editor, Run.
-- One row per code-critical object. present=false => migration unrun / object
-- missing. Ordered so missing objects bubble to the top, then by migration #.
-- ============================================================================
WITH expected_columns (mig, tbl, col) AS (
  VALUES
    -- 001 core tables (spot-check a column each; table existence covered below)
    ('001','media','storage_path'),
    ('001','manual_players','last_name'),
    ('001','field_overrides','template_type'),
    ('001','ai_usage','kind'),
    -- 002
    ('002','generate_log','settings'),
    ('002','generate_log','thumbnail_storage_path'),
    -- 003 profiles
    ('003','profiles','role'),
    ('003','profiles','team_id'),
    -- 004 vitals
    ('004','manual_players','height_in'),
    ('004','manual_players','weight_lbs'),
    ('004','manual_players','birthdate'),
    ('004','manual_players','bats'),
    ('004','manual_players','throws'),
    ('004','manual_players','birthplace'),
    ('004','manual_players','status'),
    ('004','manual_players','nickname'),
    -- 005 profile pic  (CONFIRMED UNRUN ON PROD)
    ('005','manual_players','profile_media_id'),
    -- 006 socials/rookie
    ('006','manual_players','instagram_handle'),
    ('006','manual_players','fun_facts'),
    ('006','manual_players','is_rookie'),
    -- 009 profile pan/zoom (CONFIRMED UNRUN ON PROD)
    ('009','manual_players','profile_offset_x'),
    ('009','manual_players','profile_offset_y'),
    ('009','manual_players','profile_zoom'),
    -- 010 overlay/effect blob meta (optional)
    ('010','overlays','mime_type'),
    ('010','overlays','size_bytes'),
    ('010','effects','mime_type'),
    ('010','effects','size_bytes'),
    -- 011 generate_log.hidden
    ('011','generate_log','hidden'),
    -- 015
    ('015','profiles','pending_invite'),
    -- 016 password auth + fan
    ('016','profiles','needs_password_setup'),
    -- 018a / v4.4.x manual_players catch-up (athlete_voice + user_id)
    ('018a','manual_players','athlete_voice'),
    ('018a','manual_players','user_id'),
    -- 019 content_ideas.timeliness
    ('019','content_ideas','timeliness'),
    -- 020 request threads
    ('020','requests','decline_reason'),
    ('020','request_comments','kind'),
    ('020','request_comments','author_user_id'),
    -- 023 athlete claims
    ('023','profiles','claim_team'),
    ('023','profiles','claim_name'),
    ('023','profiles','claim_num'),
    ('023','profiles','claim_status'),
    ('023','profiles','claim_verified'),
    -- NO-MIGRATION columns the code depends on (highest risk):
    ('NONE-requests-v4.4.0','requests','type'),
    ('NONE-requests-v4.4.0','requests','title'),
    ('NONE-requests-v4.4.0','requests','need_by'),
    ('NONE-requests-v4.4.0','requests','requester_email'),
    ('NONE-requests-v4.4.0','requests','requester_user_id'),
    ('NONE-requests-v4.4.0','requests','player_last_name'),
    ('NONE-requests-v4.4.0','requests','player_first_initial'),
    ('NONE-requests-v4.4.0','requests','notified_at'),
    ('NONE-generate_log-posted','generate_log','posted'),
    ('NONE-profiles-role_expires_at','profiles','role_expires_at'),
    -- content_ideas / app_settings columns (tables have no migration at all):
    ('NONE-content_ideas','content_ideas','id'),
    ('NONE-content_ideas','content_ideas','data_points'),
    ('NONE-app_settings','app_settings','key'),
    ('NONE-app_settings','app_settings','value'),
    ('NONE-app_settings','app_settings','updated_by')
),
col_check AS (
  SELECT 'column' AS object_kind, e.mig, (e.tbl || '.' || e.col) AS object_name,
         EXISTS (
           SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema='public' AND c.table_name=e.tbl AND c.column_name=e.col
         ) AS present
  FROM expected_columns e
),
expected_tables (mig, tbl) AS (
  VALUES
    ('001','media'),('001','overlays'),('001','effects'),('001','requests'),
    ('001','request_comments'),('001','manual_players'),('001','field_overrides'),('001','ai_usage'),
    ('002','generate_log'),('003','profiles'),('013','api_rate_limit'),('014','ai_memory'),
    ('019','idea_feedback'),('020','request_reads'),('022','media_usage'),('023','team_join_codes'),
    ('NONE','content_ideas'),('NONE','app_settings')
),
table_check AS (
  SELECT 'table' AS object_kind, t.mig, t.tbl AS object_name,
         EXISTS (
           SELECT 1 FROM information_schema.tables x
           WHERE x.table_schema='public' AND x.table_name=t.tbl
         ) AS present
  FROM expected_tables t
),
expected_functions (mig, fn) AS (
  VALUES
    ('003','handle_new_user'),('003','current_role'),('003','current_team_id'),
    ('003','is_admin'),('003','is_master_admin'),('003','touch_updated_at'),
    ('013','increment_rate_limit'),('014','tg_ai_memory_touch_updated_at'),
    ('022','increment_media_usage')
),
fn_check AS (
  SELECT 'function' AS object_kind, f.mig, f.fn AS object_name,
         EXISTS (
           SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname=f.fn
         ) AS present
  FROM expected_functions f
),
expected_policies (mig, tbl, pol) AS (
  VALUES
    ('003','profiles','profiles_select_own_or_admin'),
    ('003','profiles','profiles_update_admin'),
    ('003','profiles','profiles_insert_admin'),
    ('012','profiles','profiles_update_own_nonrole'),
    ('014','ai_memory','ai_memory_read'),
    ('014','ai_memory','ai_memory_write')
),
pol_check AS (
  SELECT 'policy' AS object_kind, pe.mig, (pe.tbl || ':' || pe.pol) AS object_name,
         EXISTS (
           SELECT 1 FROM pg_policies pp
           WHERE pp.schemaname='public' AND pp.tablename=pe.tbl AND pp.policyname=pe.pol
         ) AS present
  FROM expected_policies pe
),
expected_triggers (mig, tbl, trg) AS (
  VALUES
    ('003','users','on_auth_user_created'),
    ('003','profiles','profiles_touch_updated_at'),
    ('014','ai_memory','ai_memory_touch_updated_at')
),
trg_check AS (
  SELECT 'trigger' AS object_kind, tg.mig, (tg.tbl || ':' || tg.trg) AS object_name,
         EXISTS (
           SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
           WHERE c.relname=tg.tbl AND t.tgname=tg.trg AND NOT t.tgisinternal
         ) AS present
  FROM expected_triggers tg
)
SELECT object_kind, mig, object_name, present
FROM (
  SELECT * FROM table_check
  UNION ALL SELECT * FROM col_check
  UNION ALL SELECT * FROM fn_check
  UNION ALL SELECT * FROM pol_check
  UNION ALL SELECT * FROM trg_check
) all_checks
ORDER BY present ASC,                         -- missing objects first
         (mig LIKE 'NONE%') DESC,             -- no-migration objects next
         mig, object_kind, object_name;
