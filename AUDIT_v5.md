# BLW Studio v5 — Production Audit (2026-06-23)

Multi-agent audit: 5 dimensions, 48 agents, every finding adversarially verified against the code. 40 confirmed, 3 false-positives dropped. Severities are post-verification (adjusted).

Migration drift check: run `db/_prod_migration_check.sql` in the Supabase SQL editor — one row per code-critical object, `present=false` = unrun/missing.

## HIGH

### [db] content_ideas table has NO migration file — only an inline CREATE TABLE comment
- **Where:** `api/content-ideas.js:18-38`
- **Issue:** The content_ideas table is defined only as a SQL comment in the api/content-ideas.js header; no numbered migration in db/ creates it. db/019 runs `ALTER TABLE content_ideas ADD COLUMN timeliness` and db/021 runs `UPDATE content_ideas SET team='ATL'` — both 500 if the table was never hand-created. content-ideas.js GET/POST soft-fail with tableMissing/503, and ideas.js persistIdeas soft-fails, so idea persistence silently no-ops on prod if the table is absent. Same silent-failure class as the profile-pic bug.
- **Fix:** Promote the comment SQL to a real migration (e.g. db/007 or db/024_content_ideas.sql) with CREATE TABLE IF NOT EXISTS + the 3 indexes + the timeliness column, and run it. Verify with the audit query row content_ideas.* — if present=false, run it before re-running db/019 and db/021.

### [db] app_settings table has NO migration file
- **Where:** `api/app-settings.js:52-95`
- **Issue:** app-settings.js upserts/reads an app_settings table (columns key, value, updated_at, updated_by) but no migration creates it. db/021 also UPDATEs app_settings.key. Unlike content-ideas/team-codes, app-settings.js has NO tableMissing soft-fail — GET and POST will return a raw 500 if the table is absent. app_settings backs Drive config, content-calendar marks, monthly post targets, team-socials, and brand voice (consumed by _brand-voice.js, captions.js, ideas.js).
- **Fix:** Add a migration creating app_settings (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ, updated_by UUID) with RLS enabled, and run it. Confirm via audit query rows app_settings.key/value/updated_by.

### [db] profiles.role_expires_at is read by code but created by no migration
- **Where:** `api/_supabase.js:89-104`
- **Issue:** _supabase.js, src/auth.jsx, api/cloud-sync.js and src/temp-access.jsx all reference profiles.role_expires_at, and db/012's WITH CHECK clause locks it — but NO migration ever runs `ALTER TABLE profiles ADD COLUMN role_expires_at`. db/012 contains a DO-block that DROPS its full security policy and recreates a weaker one (without the role_expires_at lock) whenever the column is absent, and _supabase.js/auth.jsx both have two-step fallbacks. Net effect on prod: the temporary elevated-access feature (temp-access.jsx) cannot persist an expiry, and the intended C1 security lock on role_expires_at is silently downgraded.
- **Fix:** Add a migration `ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role_expires_at TIMESTAMPTZ;` and run it, then re-run db/012 so the full WITH CHECK (including role_expires_at) is installed. Audit query row profiles.role_expires_at confirms presence.

### [db] generate_log.posted has no migration — 'posted?' toggle 500s and GET filter errors
- **Where:** `api/cloud-sync.js:5-12`
- **Issue:** generate_log.posted (BOOLEAN NOT NULL DEFAULT TRUE) is documented only as a comment. cloud-sync GET filters `.eq('posted', ...)` and the PATCH path writes `posted`; src/cloud-sync.js sends it. The PATCH tolerant-strip block maps only 'hidden' to a migration hint (MIGRATIONS_FOR_COLUMN), NOT 'posted' — so a 'posted?' toggle on a DB missing the column falls through to a generic 500 instead of the helpful 412. The GET `.eq('posted',...)`/`fields=...posted` query also errors when the column is absent (no posted-specific fallback like the hidden one).
- **Fix:** Add db migration `ALTER TABLE generate_log ADD COLUMN IF NOT EXISTS posted BOOLEAN NOT NULL DEFAULT TRUE;` (the exact SQL is in the cloud-sync.js header) and run it. Audit query row generate_log.posted confirms.

### [db] requests v4.4.0 columns have no migration — athlete request scoping breaks if unrun
- **Where:** `api/cloud-sync.js:14-31`
- **Issue:** requests.type, title, need_by, requester_email, requester_user_id, player_last_name, player_first_initial, notified_at (+ indexes idx_requests_user, idx_requests_type) are documented only as a comment. The upsert path is tolerant (silently strips unknown columns — so requester_user_id/email ownership is silently lost on write, mirroring the profile-pic bug), but the GET athlete-scoping path runs `.or('requester_user_id.eq.<uuid>,requester_email.eq.<email>')` which ERRORS outright if those columns don't exist — meaning athletes either see nothing or get a 500 on their own request list.
- **Fix:** Promote the cloud-sync.js header SQL to a real migration (ADD COLUMN IF NOT EXISTS for all 8 columns + the two indexes) and run it. Audit query rows requests.type/requester_user_id/requester_email/etc. flag which are missing.

### [db] manual_players.athlete_voice and user_id exist only via the 018a catch-up — db/017 FK depends on user_id
- **Where:** `db/017_manual_players_user_fk.sql:37-50`
- **Issue:** manual_players.user_id and athlete_voice were never given a standalone migration (only code comments in cloud-sync.js and the 018a union). db/017 adds a FK on user_id and WILL FAIL with 'column user_id does not exist' if 018a (or the equivalent hand-SQL) hasn't run first. This is the same root-cause pattern that broke db/018. cloud-sync.js athlete write-gating reads manual_players.user_id to enforce 'edit only your own row' — if the column is absent the tolerant upsert strips it, so the OWN-row claim hardening (v4.8.14) is silently defeated.
- **Fix:** Ensure db/018a runs before db/017 and db/018. Audit query rows manual_players.user_id / manual_players.athlete_voice confirm presence. If user_id is missing on prod, the athlete claim/ownership security check is not actually enforced.

### [security] IDOR: athlete can delete any team generate-log row by id
- **Where:** `/Users/wraines/Documents/CLAUDE'S PLAYGROUND/blw-app/api/cloud-sync.js:560-573`
- **Issue:** ATHLETE_DELETABLE includes generate-log and delete runs delete().eq(id) with no check that owner_id==user.id or team==userTeamId, so an athlete can delete any other team generation-log entry and its storage thumbnail by passing any uuid. Gating restricts which kinds, not which rows; ids are exposed in GET responses.
- **Fix:** Fetch the row and require owner_id==user.id and/or team==userTeamId for athletes before deleting; 403 otherwise. Same for the composite-PK delete branch.

### [security] IDOR: athlete can hijack any request by supplying an existing id on upsert
- **Where:** `/Users/wraines/Documents/CLAUDE'S PLAYGROUND/blw-app/api/cloud-sync.js:464-478,601-609,676`
- **Issue:** request is ATHLETE_WRITABLE; the gate only checks record.team==userTeamId (475), not id ownership. With onConflict id, an athlete setting record.id to another team request id plus record.team to their own overwrites that request; 601-604 then reassign requester_user_id/email to the attacker, and athlete GET scoping (189) moves the hijacked request into the attacker list. manual-player has an OWN-row guard (486-540); request has none. The same id-ownership gap also lets athletes overwrite another team generate-log via upsert (464-478,590-593).
- **Fix:** On athlete request upsert with a supplied id, fetch the row and require requester_user_id==user.id (or new/null); 403 on cross-owner id reuse, mirroring manual-player. Apply the equivalent owner_id check to generate-log upsert.

### [Data-integrity & s] Client discards server's droppedColumns — every store reports success on a silently-stripped column
- **Where:** `src/cloud-sync.js:48-66`
- **Issue:** postSync() returns a bare {ok:true} for ANY res.ok response. The server (api/cloud-sync.js:695) returns HTTP 200 with body {ok:true, droppedColumns:[...]} when its tolerant upsert strips a missing column. The client never reads the JSON body on the success path, so droppedColumns is thrown away. Every caller — cloudAwait.syncManualPlayer/syncRequest/syncRequestComment/syncMedia, the backup runner, requests-store, field-overrides-store — therefore counts a partial write as a full success. This is the exact false-success class flagged for profile pics, but it is app-wide, not limited to the two PlayerPage paths that were patched.
- **Fix:** In postSync, on res.ok parse the JSON body and propagate droppedColumns: `const j = await res.json().catch(()=>({})); return { ok:true, droppedColumns:j.droppedColumns };`. Then have cloudAwait callers and the backup runner treat a non-empty droppedColumns as a partial failure (e.g. results.X.fail++ with a 'migration unrun: <cols>' error) rather than ok. Surface it everywhere the PlayerPage profile path already does.

### [Data-integrity & s] Player bio/vitals save ('Player info saved') is fire-and-forget with unconditional success toast
- **Where:** `src/pages/PlayerPage.jsx:2505-2540`
- **Issue:** The Edit-info form calls upsertManualPlayer({updates:{nickname,num,position,height_in,weight_lbs,birthdate,bats,throws,birthplace,status}}) without awaitCloud, then toast.success('Player info saved'). Any cloud failure or column drop (e.g. vitals columns from migration 004 unrun) is invisible; the edit persists only locally. Two staff editing the same player on different machines also silently overwrite each other (see last-write-wins finding).
- **Fix:** Use awaitCloud:true and gate the success toast on result.cloud.ok with droppedColumns empty; show an actionable error/migration hint otherwise. Mirror the position-save path already in this file (line ~1992-2007).

### [Data-integrity & s] Request submission shows 'Request sent' but write is fire-and-forget — staff may never receive it
- **Where:** `src/request-modal.jsx:126-131`
- **Issue:** handleSubmit calls saveRequests(next) (requests-store.js:25, which fires cloud.syncRequest fire-and-forget) and then unconditionally toast.success('Request sent'). If cloud-sync 401s (stale session), 403s (role/team gate), 500s, or drops the new request columns (type/title/need_by/requester_user_id), the request exists only in the athlete's localStorage. Staff never see it, the athlete believes it was delivered, and there is no retry or error surface. Worst case for a request workflow: silent total loss of the user's intent.
- **Fix:** Await the cloud write for request creation (add an awaitable path: postSync result) and only toast success on confirmed persistence; on failure keep the modal open / mark the request as 'not yet synced' and offer retry. At minimum, surface a warning toast when the write fails.

### [Frontend correctne] Two-way players never show pitching stats (roster card trio precedence) — KNOWN ISSUE, confirmed
- **Where:** `/Users/wraines/Documents/CLAUDE'S PLAYGROUND/blw-app/src/pages/TeamPage.jsx:1518-1522`
- **Issue:** statTrio = stats ? ((p.isBatter && stats.batting) ? stats.batting : (p.isPitcher && stats.pitching) ? stats.pitching : (stats.batting || stats.pitching)) : null. Because isBatter is tested first and most wiffle players are two-way (isBatter && isPitcher both true), the ternary always resolves to stats.batting; stats.pitching is unreachable for any two-way player. The statLabel just above (1501-1505) correctly renders 'Two-Way Player', so the label promises pitching context the single trio never delivers. Each card renders only ONE 3-stat trio, so there is no second pitching block to fall back to.
- **Fix:** Either render BOTH trios for two-way players (a batting trio and a pitching trio stacked), or make the single-trio selection deliberate (e.g. choose the discipline by a primaryRole/innings-vs-PA heuristic rather than declaration order). At minimum, flipping precedence is not a fix — it would just invert the bug and hide batting. Recommend showing two compact trios when isBatter && isPitcher.

### [Frontend correctne] colors.warning (amber #F59E0B) used directly as text — fails AA (previously flagged pattern, still live)
- **Where:** `/Users/wraines/Documents/CLAUDE'S PLAYGROUND/blw-app/src/pages/Files.jsx:1465`
- **Issue:** <span style={{ ... color: colors.warning, fontWeight: 600 }}>{untagged.length} untagged</span> sits on the page background. colors.warning is the saturated amber mid-tone (#F59E0B) which fails WCAG AA as body text on light surfaces and is the exact case the warningText token (#92400E) was introduced to fix. Line 1461 similarly uses colors.success (#22C55E green) as text, which is also borderline/failing. Same defect recurs outside the focus set at PeopleAdmin.jsx:632, PlayerBioImportCard.jsx:612, league-context.jsx:267.
- **Fix:** Swap to colors.warningText / colors.successText for any saturated status color used as text (reserve the mid-tone for dot fills, focus rings, and borders). Worth a repo-wide grep for `color:.*colors\.(warning|success)\b` excluding the *Text variants.

### [Production-readine] Vision/AI endpoints auto-tag.js, shade.js, ai-memory.js have no maxDuration — default ~10s timeout, can 504 in prod
- **Where:** `api/auto-tag.js, api/shade.js, api/ai-memory.js:auto-tag.js:40, shade.js:408, ai-memory.js:68 (handlers; no top-level maxDuration export)`
- **Issue:** ideas.js:720 and captions.js:255 correctly export maxDuration=60. But auto-tag.js, shade.js (suggest action), and ai-memory.js are ALSO endpoints that call api.anthropic.com — auto-tag and shade do Claude VISION on full-size images, which is the slowest call type. With no maxDuration export they fall back to Vercel's default function timeout (10s on the older default, 15s on newer), and a vision call on a large photo routinely takes longer, producing an opaque 504 that looks like a flaky failure. There is also no AbortController anywhere, so a hung upstream is bounded only by the function timeout. This is exactly the failure-mode family as the prior maxDuration mistake, just by omission instead of misplacement.
- **Fix:** Add `export const maxDuration = 60;` (top-level, NOT inside the config object) to api/auto-tag.js, api/shade.js, and api/ai-memory.js. Optionally wrap the Anthropic fetch in an AbortController with a ~50s timeout so a stuck upstream returns a clean 504 with a message instead of a raw gateway timeout.

## MEDIUM

### [db] Ordering hazards: 018a before 018/017; 021 after content_ideas+app_settings+ai_memory; 016/023 trigger last-writer-wins
- **Where:** `db/018_merge_mike_stiles.sql:30-60`
- **Issue:** (1) db/018 references profile_media_id/profile_offset_*/athlete_voice/user_id and fails unless 005/009/018a ran — 018a is numbered AFTER 018 but its own header says 'RUN THIS BEFORE 018'. (2) db/021 UPDATEs content_ideas, idea_feedback, app_settings, ai_memory and fails if any of those tables don't exist (content_ideas + app_settings have no creating migration; ai_memory is db/014, idea_feedback is db/019). (3) handle_new_user() is rewritten three times — db/003, db/016, db/023 — last one run wins; if 023 ran but a later re-run of 003/016 happens, claim capture silently breaks. The manual-apply model makes all of these easy to get wrong since filename order != safe-run order.
- **Fix:** Document an explicit run order (001,002,003,004,005,006,008,009,010,011,012,013,014,015,016,018a,017,018,019,020,021,022,023 + the three no-migration tables/columns before 019/021). Verify handle_new_user body matches db/023 via: SELECT prosrc FROM pg_proc WHERE proname='handle_new_user'.

### [security] Unauthenticated proxies: drive.js and gss.js lack the requireUser gate
- **Where:** `/Users/wraines/Documents/CLAUDE'S PLAYGROUND/blw-app/api/drive.js + api/gss.js:drive.js:15-32; gss.js:9-22`
- **Issue:** drive.js fetches Google Drive bytes for anyone passing fileId+apiKey (anonymous relay; SSRF limited by fixed Google host) and is inconsistent with the staff-only Drive config in app-settings. gss.js concatenates path from req.query into the upstream URL with no encoding (only rest params encoded, line 19), enabling upstream path traversal and query/fragment injection; it is unauthenticated and unrate-limited. players-sheet-sync.js:461-474 shows the correct host-allowlist pattern both lack. Lower-severity extras: ideas.js/captions.js (75-80, 62-65) lack requireRole so a fan can invoke paid Anthropic generation at the 50/hr DEFAULT_FALLBACK (fan absent from _rate-limit.js LIMITS); and _rate-limit.js checkRateLimit (94-105) fails open on RPC error while shade.js doSuggest (452) has no rate limit (master-only).
- **Fix:** Add requireUser to both proxies (staff-only for drive; validate fileId and prefer a server-held key). For gss allowlist/normalize path and strip dotdot, leading slashes, and ?/# separators. Add requireRole to ideas/captions to exclude fan, add a fan LIMITS entry, and consider fail-closed rate-limiting for athlete/fan plus a limit on shade doSuggest.

### [Data-integrity & s] Athlete About-me (athlete_voice) save shows success without confirming the cloud write
- **Where:** `src/pages/PlayerPage.jsx:3135-3145`
- **Issue:** AthleteVoiceCard.save() calls upsertManualPlayer({updates:{athleteVoice:voice}}) WITHOUT awaitCloud:true, then unconditionally toast.success('About-me saved'). Because the call is fire-and-forget (player-store.js:185 cloud.syncManualPlayer), a 401/403/500/network error — or a silently-dropped athlete_voice column on an unrun db/004 migration — never reaches the user. The athlete believes their free-form content (which feeds the AI ideas prompt) is saved league-wide when it lives only in their browser's IndexedDB. This is the athlete's primary self-authored content and is in the unprotected set even though the sibling profile-photo path in the same file is protected.
- **Fix:** Pass awaitCloud:true and inspect result.cloud: if !ok or droppedColumns present, downgrade the toast to a warning naming the failure / migration (reuse droppedColMigrationHint, extended with athlete_voice → db/004). Only toast.success when the cloud write truly succeeded.

### [Data-integrity & s] Request thread messages render optimistically but persist fire-and-forget — undelivered messages look sent
- **Where:** `src/request-thread.jsx:30-35`
- **Issue:** send() calls onSend(text) then immediately setDraft(''). The handler routes through saveComments (requests-store.js:52) → cloud.syncRequestComment fire-and-forget. The bubble appears in the sender's thread instantly. If the cloud write fails or drops kind/author_user_id (db/020 unrun), the recipient never sees the message and the sender has no indication. Two-way conversation silently becomes one-way. Combined with the athlete-scoped read filter (cloud-sync.js:200-212), a comment whose author_user_id was dropped also mis-renders mine-vs-theirs and breaks unread counts.
- **Fix:** Make comment send awaitable; show a per-message 'sending…/failed — retry' state instead of assuming delivery. Gate the optimistic bubble's 'delivered' affordance on a confirmed cloud ok with no dropped columns.

### [Data-integrity & s] manual_players writes are last-write-wins against a stale LOCAL copy — concurrent edits silently clobber
- **Where:** `src/player-store.js:169-190`
- **Issue:** upsertManualPlayer merges updates onto `match` from the local IndexedDB snapshot (`{...match, ...updates}`) and sends the FULL row through a cloud upsert (onConflict:id). It never reads the current cloud row first. If device A sets athlete_voice and device B (with a stale local copy lacking A's change) later saves a profile photo, B's full-row upsert overwrites athlete_voice back to its stale value. Same hazard for vitals vs voice vs photo edited from different surfaces/sessions. No conflict detection, no merge, no warning. Invisible field-level data loss on the app's richest user-content table.
- **Fix:** Either (a) switch these writes to PATCH-style partial updates that only send changed columns (the PATCH endpoint already exists for generate-log/request — extend allow-list to manual_players fields), or (b) read-modify-write against the cloud row with an updated_at/version guard and reject/merge on conflict. Full-row upsert from a local snapshot should be reserved for the initial backup, not live edits.

### [Data-integrity & s] requests-store and field-overrides writes are fire-and-forget full-row upserts (last-write-wins, no error surface)
- **Where:** `src/requests-store.js:25-43`
- **Issue:** saveRequests/saveComments persist the whole list to localStorage, diff against the prior LOCAL list, and fire cloud.syncRequest/syncRequestComment for any changed row — none awaited, none surfaced. A staff member changing status/priority and an athlete posting a comment near-simultaneously each push a full row built from their own stale local view, so a concurrent status flip can be reverted by the other party's save. field-overrides-store.js:46-63 has the same fire-and-forget full-write shape. Failures only reach console.warn.
- **Fix:** Route status/priority changes through the existing PATCH endpoint (single-column update, already allow-listed at cloud-sync.js:352) instead of full-row upsert, and await + surface failures on user-initiated actions. For field overrides, accept the lower stakes but log to a visible sync-status indicator rather than only console.

### [Data-integrity & s] Backup runner counts tolerant-stripped writes as successes
- **Where:** `src/cloud-backup.js:74-77`
- **Issue:** Each `if (res.ok) results.X.ok++` treats a {ok:true} from cloudAwait as a clean upload. Because postSync hides droppedColumns (see critical finding), the 'Back up library to cloud' summary will report e.g. 'manual players 40/40 ok' even when every row silently dropped athlete_voice/profile_media_id/user_id due to an unrun migration. The operator gets false confidence that the cloud backup is complete and faithful.
- **Fix:** Once postSync propagates droppedColumns, treat res.droppedColumns?.length as a partial failure in every block here — push an error like `${name}: dropped ${cols}` and increment fail (or a new 'partial' bucket) so the summary tells the operator which migration to run.

### [Frontend correctne] No error boundary anywhere — any render throw white-screens the entire app
- **Where:** `/Users/wraines/Documents/CLAUDE'S PLAYGROUND/blw-app/src/main.jsx:20-26`
- **Issue:** grep for ErrorBoundary / componentDidCatch / getDerivedStateFromError across src returns nothing, and there is no React.lazy/Suspense fallback. The root renders <BrowserRouter><App/></BrowserRouter> with no boundary. These pages are large and data-driven (TeamPage 125KB, PlayerPage 167KB, Files 119KB, Generate 178KB); a single undefined-access during render (e.g. a malformed roster/media/stats record) takes down the whole SPA with a blank screen and no recovery path.
- **Fix:** Add a top-level ErrorBoundary around <App/> (or per-route around the heavy page elements) that renders a fallback with a reload/sign-out affordance, and ideally a finer-grained boundary around the route outlet so one page crashing doesn't kill the shell/nav.

### [Production-readine] Invite magic-link (an auth credential) is written to the browser console in PeopleAdmin
- **Where:** `src/pages/PeopleAdmin.jsx:94`
- **Issue:** console.log('[invite link, fallback]', res.action_link) logs the Supabase action_link — a magic-link sign-in URL that grants authentication to the invited account — to the browser devtools console. This is the only console.log in all of src/ (everything else in api/ is console.warn/error with no secrets). It is gated to master-admin (only they can send invites) so blast radius is small, but it is a real auth-token-in-logs issue: anyone with access to that admin's console/session-recording/extension could redeem the link.
- **Fix:** Remove the console.log, or gate it behind import.meta.env.DEV so it never runs in production. If a copy-paste fallback is genuinely wanted, surface the link in the UI behind an explicit 'Copy invite link' action (which is intentional and visible) rather than silently in the console.

### [Production-readine] Eager-loaded changelog.js (183KB) and data.js (95KB) bloat the main bundle to 637KB
- **Where:** `src/App.jsx:9 (import ChangelogModal) and 3 (import from './data')`
- **Issue:** All page components are correctly lazy-loaded (App.jsx:21-31). But ChangelogModal is a static import (App.jsx:9), which pulls src/changelog.js (183,914 bytes — the largest source file) into the eager main chunk even though the modal only renders on a footer click. data.js (95KB) is also statically imported. The build confirms the main index chunk is 637KB / 204KB gzipped and contains the 'BLW Studio v5' changelog string. Not a correctness bug, but it's the bulk of first-paint JS for a 'premium' product, and changelog content is never needed until interaction.
- **Fix:** Lazy-load ChangelogModal (const ChangelogModal = lazy(() => import('./changelog-modal'))) and render it in a Suspense boundary only when changelogOpen is true. That alone moves ~183KB off the critical path. data.js is harder to defer (App reads TEAMS/API_CONFIG at top level) and is lower priority.

## LOW

### [db] ai_memory write policy grants admin too, contradicting 'master_admin only' intent
- **Where:** `db/014_ai_memory.sql:50-55`
- **Issue:** The header comment says 'Write: master_admin only. (admin tier exists in the enum but isn't granted today)'. The actual policy ai_memory_write uses `role IN ('master_admin','admin')`, so any future 'admin' account could write AI memory. _supabase.js documents that the live model collapses admin->master_admin, so this is dormant today, but the policy is broader than the stated intent and broader than the UI gating.
- **Fix:** If admin is meant to be dormant, tighten the policy to `role = 'master_admin'` (USING and WITH CHECK), or update the comment to reflect that admin is intentionally allowed. Low risk while no admin accounts exist.

### [db] db/018a re-adds bats/throws without the CHECK constraints db/004 defined
- **Where:** `db/018a_manual_players_columns_catchup.sql:27-28`
- **Issue:** db/004 defines bats with CHECK (bats IN ('R','L','S')) and throws with CHECK (throws IN ('R','L')). The 018a catch-up adds bats/throws as plain TEXT (ADD COLUMN IF NOT EXISTS), so on any prod DB where 004 never ran and 018a created these columns, the value constraints are absent. Mild data-integrity gap, not a break.
- **Fix:** Acceptable if relying on app-level validation, but for parity add the CHECK constraints conditionally (DO block / NOT VALID) after 018a, or note that bats/throws are unconstrained on catch-up DBs.

### [Data-integrity & s] generate-log delete leaks the thumbnail blob (wrong storage path column)
- **Where:** `api/cloud-sync.js:566-571`
- **Issue:** The blob-delete branch reads `existing.storage_path` and removes from BUCKET_FOR[kind]. generate-log stores its blob path in `thumbnail_storage_path` (STORAGE_PATH_COL map, line 97), not storage_path, and uses bucket 'generate-thumbs'. So deleting a generate-log entry (athletes can delete their own — ATHLETE_DELETABLE) leaves the thumbnail orphaned in storage. Not user-visible data loss, but an accumulating storage leak and an inconsistency the delete path silently ignores (the select returns undefined storage_path, the remove is skipped with no error).
- **Fix:** Use STORAGE_PATH_COL[kind] and BUCKET_FOR[kind] in the delete branch the same way the upsert branch does, selecting the correct column and removing from the correct bucket.

### [Frontend correctne] Hardcoded status-text hexes don't adapt to dark mode (Settings / ContentStudio status rows)
- **Where:** `/Users/wraines/Documents/CLAUDE'S PLAYGROUND/blw-app/src/pages/Settings.jsx:259, 294-297, 370-373, 409`
- **Issue:** Status text is hardcoded to fixed dark hexes (#15803D, #92400E, #991B1B, #065F46, #0369A1) on tinted backgrounds that DO flip (colors.successBg/warningBg etc. are CSS vars). In dark mode the tinted surface darkens but the text hex stays the same dark green/amber/red, degrading contrast. ContentStudio.jsx mirrors this at lines 259-equivalent 875 (#15803D/#92400E) and the purple usage chip 554 (#7C3AED on rgba(124,58,237,0.10)) and timeliness chips 575 (#B45309). These exactly duplicate the values already exported as colors.successText/warningText/dangerText/infoText.
- **Fix:** Route every hardcoded status-text hex through the matching *Text token (successText/warningText/infoText/dangerText). For the purple/amber chips, add an accent-on-tint token or use the existing status tokens so the dark-mode flip reaches them.

### [Frontend correctne] Sticky quick-stats ticker overlaps ProfileSetupBanner (topbar-h omits the banner)
- **Where:** `/Users/wraines/Documents/CLAUDE'S PLAYGROUND/blw-app/src/quick-stats-ticker.jsx:142-150`
- **Issue:** The sticky variant pins at top: var(--topbar-h, 60px) and cancels main padding via marginTop: calc(-1 * var(--main-pad)). --topbar-h is measured from topbarRef only (App.jsx:447-456). When ProfileSetupBanner renders (App.jsx:1053) it inserts a ~33px non-sticky banner BETWEEN the top bar and <main>, but --topbar-h does not include it. At scroll-top the sticky ticker therefore pins under the top bar and overlaps the banner instead of sitting below it. Also --main-pad is published on <main> (App.jsx:1058) while the ticker reads it from an ancestor sticky wrapper — it resolves through inheritance only because the wrapper is inside <main>, which is fragile if the tree changes.
- **Fix:** Either include the banner height in --topbar-h (measure a wrapper around topbar+banner) or make the banner sticky and stack offsets. The banner is admin-only/transient, so severity is moderate, but the overlap is visible whenever a profile row is missing.

### [Frontend correctne] ProfileSetupBanner hardcodes light-amber palette (no dark-mode flip)
- **Where:** `/Users/wraines/Documents/CLAUDE'S PLAYGROUND/blw-app/src/App.jsx:965-966`
- **Issue:** background: '#FEF3C7', color: '#92400E', borderBottom: '1px solid #FDE68A' are raw hexes, so in dark mode the banner stays a light-amber strip across the top — inconsistent with the themed chrome. Admin/setup-only state, hence low severity, but it's a clear dark-mode regression.
- **Fix:** Use colors.warningBg / colors.warningText / colors.warningBorder so the banner adapts with the theme.

### [Frontend correctne] Teams sidebar expander missing aria-expanded
- **Where:** `/Users/wraines/Documents/CLAUDE'S PLAYGROUND/blw-app/src/App.jsx:139-150`
- **Issue:** The collapsible 'Teams' nav button toggles a submenu via setExpanded but exposes no aria-expanded state to assistive tech (it does manage is-active class and an onTeamRoute style). The ThemeToggle (App.jsx:410-413) is correctly labeled, so this is the lone gap on the interactive toggles reviewed.
- **Fix:** Add aria-expanded={expanded} (and aria-controls pointing at the submenu container) to the Teams toggle button.

### [Frontend correctne] Generate background/overlay preview object URLs replaced without revoking the prior URL
- **Where:** `/Users/wraines/Documents/CLAUDE'S PLAYGROUND/blw-app/src/pages/Generate.jsx:1373, 1385, 1527, 1541`
- **Issue:** handleBgDrop/handleBgFileInput call setBgUrl(URL.createObjectURL(file)) and handleOverlayFile/handleOverlayDrop call setUploadPreview(URL.createObjectURL(files[0])) without revoking the URL they overwrite. Each re-drop/re-pick leaks the previous blob URL for the session. Generate.jsx is outside the named focus list and these are small per-action leaks (not per-render), so low severity — noted for completeness. Contrast PlayerPage.jsx:1906-1910 and TeamPage.jsx:1177/992, which DO revoke correctly, and preview-lightbox.jsx:236 / Files.jsx:54 which revoke on cleanup.
- **Fix:** Track the current preview URL and URL.revokeObjectURL it before assigning a new one (or revoke in a cleanup effect keyed on the URL).

### [Production-readine] 22 serverless functions in api/ — exceeds Vercel Hobby's 12-function hard limit (deploy-blocking if not on Pro)
- **Where:** `api/:directory (22 non-underscore .js handlers)`
- **Issue:** There are 22 endpoint files in api/ (28 total minus 4 _-prefixed helpers minus 2 that are helpers: _ai-memory, _brand-voice, _rate-limit, _supabase). Vercel's Hobby plan caps a deployment at 12 Serverless Functions; exceeding it fails the build with 'No more than 12 Serverless Functions'. Since v5 'just launched live', the project is presumably on Pro (limit is far higher), in which case this is a non-issue — but it is the single most likely thing to hard-block a future deploy or a fork/preview on a Hobby-scoped account, and it is invisible until the build fails. Verify the team plan (savant-media-irl) is Pro.
- **Fix:** Confirm the Vercel project is on a Pro plan. If there's any risk of Hobby, consolidate low-traffic endpoints behind an action-router pattern (several already use ?action= — e.g. shade.js, admin-people.js — so merging admin-player-trades/team-codes/idea-feedback/request-reads into fewer multiplexed handlers is straightforward).

### [Production-readine] DEFERRED GAP: media thumbnails are not stored — every grid tile loads the full-size blob from IndexedDB
- **Where:** `src/pages/TeamPage.jsx (and src/media-store.js):TeamPage.jsx:1169-1179 (thumbUrls = createObjectURL(m.blob) for each item)`
- **Issue:** Thumbnails are generated at render time via URL.createObjectURL(m.blob) on the FULL-resolution blob held in IndexedDB; there is no separate stored/downsized thumbnail. On a team with many media items this decodes many full-size images just to paint small grid tiles, costing memory and main-thread time. URLs are revoked on change/unmount (good, no leak), so this is purely a perf gap, not a bug — and it matches the 'stored thumbnails missing' item you flagged as deferred-but-shipped.
- **Fix:** Acceptable for launch. When addressed: generate and persist a small (e.g. 320px) thumbnail blob alongside the original at upload time (image-compress.js already exists) and render tiles from the thumbnail, falling back to the full blob only in the lightbox.

### [Production-readine] .env.example omits the majority of consumed env vars
- **Where:** `.env.example:whole file`
- **Issue:** The template documents VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and commented RESEND_API_KEY/NOTIFY_EMAIL, but the code reads 8 more: ANTHROPIC_API_KEY, ANTHROPIC_MODEL, ANTHROPIC_IDEAS_MODEL, METRICOOL_TOKEN, METRICOOL_USER_ID, SHADE_API_KEY, RESEND_FROM, SUPABASE_STORAGE_LIMIT_BYTES. A deployer following only the template would ship with AI generation, the new v5 Brand Command Center reporting, Rapid Tag, and signup emails all dark — and each only reveals itself as a 500 at feature-use time.
- **Fix:** Add the missing vars to .env.example (commented, grouped by feature) so the prod env checklist is complete. Especially call out ANTHROPIC_API_KEY and METRICOOL_TOKEN/USER_ID since AI + the Command Center are headline v5 features.

## INFO

### [db] No migration 007 in the sequence (numbering gap)
- **Where:** `db/008_lvs_to_lv.sql:1`
- **Issue:** Files jump 006 -> 008; there is no 007_*.sql. Not inherently a problem (no code references a 007), but in a manually-applied scheme a gap can mask a migration that was drafted, intended, and never committed/run. Worth confirming nothing was lost.
- **Fix:** Confirm 007 was intentionally skipped (or folded into another file). If a 007 ever existed, reconcile it. No action needed if the gap is deliberate.

### [Data-integrity & s] owner_id silently relies on Postgres ignoring unknown column for field_overrides/ai_usage
- **Where:** `api/cloud-sync.js:586-593`
- **Issue:** Comment at 588-589 asserts tables without owner_id 'will silently ignore the extra field via Postgres strict-column behavior.' In practice PostgREST raises PGRST204 for unknown columns on upsert (the very behavior the tolerant retry below handles), not a silent ignore. owner_id is only added for HAS_OWNER kinds, so this is currently harmless, but the stated rationale is wrong and could mislead a future edit that adds owner_id to a table lacking the column, triggering a strip-retry rather than a silent no-op.
- **Fix:** Correct the comment to reflect that the tolerant-upsert retry (not Postgres) is what would absorb an unknown owner_id, and keep owner_id strictly gated by HAS_OWNER. No code change required today.

### [Frontend correctne] MoveBadge / stats-table movers use hardcoded green/red text on tinted pills
- **Where:** `/Users/wraines/Documents/CLAUDE'S PLAYGROUND/blw-app/src/stats-tables.jsx:149`
- **Issue:** color: up ? '#16A34A' : '#DC2626' on background rgba(34,197,94,0.12)/rgba(220,38,38,0.12). The tinted pill background is a fixed rgba (doesn't flip), and the text hexes are fixed too, so the pill renders consistently across modes — but it's off-token and won't track any future palette change. The quick-stats-ticker RISING tag (#047857) at quick-stats-ticker.jsx:86 is the same off-token pattern. Cosmetic/consistency, not a contrast failure.
- **Fix:** Optionally migrate to success/danger tokens (or successText/dangerText) for consistency; functionally acceptable as-is.

### [Production-readine] DEFERRED GAP: Files page is browser-only when Supabase isn't configured; media blobs are device-local
- **Where:** `src/pages/Files.jsx:1459 (subtitle 'files persist in your browser'), 1708-1714 (browser-only warning), 1726-1749 (local/cloud gap banner)`
- **Issue:** Media binaries live in IndexedDB per-device; only metadata syncs to Supabase. When Supabase is unconfigured a yellow 'Files are currently stored in your browser' card is shown (1708), and when the cloud has more media rows than the local device a 'N files in cloud not yet on this device' banner appears (1743), including a cloudBlobMissing retry hint. This is the 'Files page browser-only warning' you flagged — it is implemented and user-communicated, so it's working as intended, just a known architectural limitation (a new device/browser sees metadata but must re-download or re-upload blobs).
- **Fix:** No action needed for launch — the warnings are present and honest. Longer-term, moving blob storage to Supabase Storage (storage-presign.js already exists) would make Files truly cross-device.

### [Production-readine] No dead/orphaned code of concern; MyStats.jsx is intentionally retained
- **Where:** `src/pages/MyStats.jsx:whole file`
- **Issue:** A full import-graph scan (resolving from main.jsx across src/ + api/ + index.html) found exactly one un-imported JS/JSX file: src/pages/MyStats.jsx. It is deliberate, not accidental dead code — changelog 5.0.0 (changelog.js:415) states the /my-stats route now redirects to /dashboard but 'the MyStats component itself stays in the file tree for now'. No orphaned imports elsewhere. Note also that src/cloud-sync.js and api/cloud-sync.js are NOT duplicates — the src one is the client sync module (imported by media-store, player-store, etc.), the api one is the serverless handler.
- **Fix:** No action. If you want a truly clean tree you could delete MyStats.jsx and its redirect handling in a later cleanup, but it's harmless (it's not even in the eager bundle since pages are lazy-loaded and nothing routes to it).

