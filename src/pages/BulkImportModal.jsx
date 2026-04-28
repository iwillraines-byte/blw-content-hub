// Bulk import modal — drag a folder (or click to pick one), watch the
// app run filename heuristics on every file in it, fix up the few that
// the heuristic isn't sure about, then commit the whole batch in one
// shot. Compresses on the way in so a folder of print-resolution
// originals doesn't blow through Supabase storage.
//
// The UX intent: turn "rename + drag-drop one file at a time" into
// "drop a folder, eyeball a checklist, click Import" so loading the
// league archive is an afternoon, not a week.

import { useState, useCallback, useMemo, useEffect } from 'react';
import { TEAMS } from '../data';
import { Card, SectionHeading, RedButton, OutlineButton, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { saveMedia, buildPlayerFilename, buildTeamFilename, buildLeagueFilename, TEAM_SCOPE_TYPES, LEAGUE_SCOPE_TYPES, LEAGUE_TEAM_CODE, blobToObjectURL } from '../media-store';
import { heuristicallyTag } from '../tag-heuristics';
import { compressImageBlob, getCompressPreference, formatSavings } from '../image-compress';
import { PreviewLightbox } from '../preview-lightbox';
import { downloadFileAsBlob } from '../drive-api';

const PLAYER_ASSET_TYPES = ['HEADSHOT', 'ACTION', 'ACTION2', 'PORTRAIT', 'HIGHLIGHT', 'HIGHLIGHT2', 'INTERVIEW'];
const TEAM_ASSET_TYPES = ['TEAMPHOTO', 'VENUE', 'LOGO_PRIMARY', 'LOGO_DARK', 'LOGO_LIGHT', 'LOGO_ICON', 'WORDMARK'];
const LEAGUE_ASSET_TYPES = ['ALLSTAR', 'EVENT', 'MULTI_TEAM', 'TROPHY', 'BANNER', 'BRANDING', 'LOGO_PRIMARY', 'LOGO_DARK', 'LOGO_LIGHT', 'LOGO_ICON', 'WORDMARK'];

// Walk a DataTransferItemList and yield all files inside any folders the
// user drops. Browsers expose this through the non-standard
// `webkitGetAsEntry` API, but every modern browser implements it.
async function readEntriesRecursive(entry) {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file(file => resolve([file]), () => resolve([]));
    });
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const all = [];
    // readEntries returns up to 100 entries per call, so loop until empty.
    while (true) {
      const batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
      if (!batch.length) break;
      for (const e of batch) {
        const files = await readEntriesRecursive(e);
        all.push(...files);
      }
    }
    return all;
  }
  return [];
}

async function filesFromDrop(dataTransfer) {
  const items = Array.from(dataTransfer.items || []);
  if (items.length === 0) return Array.from(dataTransfer.files || []);
  const collected = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      const files = await readEntriesRecursive(entry);
      collected.push(...files);
    } else if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) collected.push(f);
    }
  }
  return collected;
}

// Per-file row state. status:
//   'auto'   — heuristic confident; will use detected tags
//   'review' — needs user attention (low confidence or ambiguous)
//   'skip'   — user excluded this file
function buildRow(file, roster) {
  const guess = heuristicallyTag({ filename: file.name, roster });
  // We treat anything below 'high' confidence as needing review unless
  // the user has confirmed it. ambiguous always pushes to review.
  const needsReview = guess.confidence === 'low' || guess.confidence === 'none' || guess.ambiguous;
  return {
    id: crypto.randomUUID(),
    file,
    // Thumbnails: only generate object URLs for images. Videos get a
    // placeholder icon in the table; clicking still opens the lightbox
    // which uses a <video> element for full playback.
    previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    isVideo: file.type.startsWith('video/'),
    // Initial scope follows the heuristic — league hits trump everything
    // (a BLW_ALLSTAR.jpg shouldn't pull a team along), then team-scope
    // assetTypes, otherwise default to player.
    scope: guess.scope === 'league' ? 'league'
      : TEAM_SCOPE_TYPES.has(guess.assetType) ? 'team'
      : 'player',
    team: guess.scope === 'league' ? '' : (guess.team || ''),
    num: guess.num || '',
    firstInitial: guess.firstInitial || '',
    lastName: guess.lastName || '',
    assetType: guess.assetType || 'HEADSHOT',
    variant: '',
    confidence: guess.confidence,
    reasons: guess.reasons || [],
    status: needsReview ? 'review' : 'auto',
  };
}

export default function BulkImportModal({ open, onClose, roster, onImported, driveSeed = null }) {
  // Stages: idle (dropzone) → downloading (Drive only) → analyzing → preview → importing → done
  const [stage, setStage] = useState('idle');
  const [rows, setRows] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState(null);
  // Filter for the preview table.
  const [filter, setFilter] = useState('all'); // all | review | auto | skip
  // Lightbox: which row's image is currently being viewed at full size.
  // Null when closed.
  const [lightboxRowId, setLightboxRowId] = useState(null);
  // Row selection — drives the "bulk apply" bar above the table. We keep
  // a Set of row ids so toggling is O(1) and the persisted state across
  // filter switches is intuitive (selecting in 'review' filter, switching
  // to 'all', selections stay).
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // Bulk-edit fields. The user types/picks values here, then hits
  // "Apply to N selected" to stamp them onto every selected row. Empty
  // fields are treated as "don't touch this column", so partial apply
  // (e.g. just set the player but leave asset-type alone) is one click.
  const [bulkPatch, setBulkPatch] = useState({
    team: '', scope: '', num: '', firstInitial: '', lastName: '', assetType: '',
  });

  // Reset modal state whenever it (re)opens. Keeps Cancel from leaving
  // stale rows around for the next session.
  useEffect(() => {
    if (open) {
      setStage('idle');
      setRows(prev => {
        // Revoke any object URLs from a previous session before clearing.
        for (const r of prev) if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
        return [];
      });
      setLightboxRowId(null);
      setProgress({ done: 0, total: 0 });
      setResults(null);
      setFilter('all');
      setSelectedIds(new Set());
      setBulkPatch({ team: '', scope: '', num: '', firstInitial: '', lastName: '', assetType: '' });
    }
  }, [open]);

  // Revoke preview URLs when the modal unmounts entirely (e.g. user
  // navigates away from Files page mid-session). Without this every
  // dropped folder leaks a stack of blob: URLs.
  useEffect(() => {
    return () => {
      setRows(prev => {
        for (const r of prev) if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
        return prev;
      });
    };
  }, []);

  const ingest = useCallback(async (files) => {
    setStage('analyzing');
    // Filter to images + videos. Fold async heuristic-tag (synchronous,
    // but huge folders make us yield to the event loop).
    const usable = files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    const out = [];
    for (let i = 0; i < usable.length; i++) {
      out.push(buildRow(usable[i], roster));
      // Yield every 50 so the UI thread isn't frozen for big folders.
      if (i % 50 === 49) await new Promise(r => setTimeout(r, 0));
    }
    setRows(out);
    setStage('preview');
  }, [roster]);

  // Drive ingest — pulls each Drive file as a Blob with capped concurrency,
  // then runs the resulting File-like objects through the same heuristic
  // pipeline as a local folder drop. The driveFileId is preserved on each
  // row so the resulting media records can be cross-referenced with the
  // Drive folder browser ("already imported" badge etc.).
  const ingestDriveFiles = useCallback(async (driveFiles) => {
    setStage('downloading');
    setProgress({ done: 0, total: driveFiles.length });
    const concurrency = 4;
    let cursor = 0;
    const results = new Array(driveFiles.length);
    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= driveFiles.length) return;
        const df = driveFiles[i];
        try {
          const blob = await downloadFileAsBlob(df.id);
          // Wrap the blob as a File so the rest of the pipeline (which
          // reads .name and .type) treats it identically to a local file.
          // Some browsers don't preserve mime on File construction —
          // fall back to the Drive-supplied mimeType when needed.
          const mime = blob.type || df.mimeType || 'application/octet-stream';
          const file = new File([blob], df.name, { type: mime });
          // Tag the file with its Drive id so saveMedia can carry it
          // through and the Drive panel knows it's been imported.
          file.driveFileId = df.id;
          results[i] = file;
        } catch (err) {
          console.warn(`Drive download failed for ${df.name}:`, err);
          results[i] = null;
        }
        setProgress({ done: cursor, total: driveFiles.length });
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, driveFiles.length) }, worker));
    const usable = results.filter(Boolean);
    await ingest(usable);
  }, [ingest]);

  // When the modal is opened with a Drive seed, kick off the download
  // pipeline. Effect runs only after the open-reset effect above so we
  // don't race the state clears.
  useEffect(() => {
    if (!open || !driveSeed?.driveFiles?.length) return;
    if (stage !== 'idle') return;
    ingestDriveFiles(driveSeed.driveFiles);
    // We intentionally do NOT depend on stage — that change is what we
    // are causing, and re-running would loop. eslint-disabled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, driveSeed, ingestDriveFiles]);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = await filesFromDrop(e.dataTransfer);
    if (files.length) ingest(files);
  }, [ingest]);

  const handleFolderInput = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) ingest(files);
  }, [ingest]);

  const updateRow = useCallback((id, patch) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }, []);

  const setRowStatus = useCallback((id, status) => updateRow(id, { status }), [updateRow]);

  const counts = useMemo(() => {
    const c = { all: rows.length, auto: 0, review: 0, skip: 0 };
    for (const r of rows) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [rows]);

  const importable = useMemo(() => rows.filter(r => r.status !== 'skip'), [rows]);

  const visible = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter(r => r.status === filter);
  }, [rows, filter]);

  // Selection helpers. All ops work against the visible set so toggling
  // "Select all" inside a filtered view (say "Needs review") only marks
  // the rows the user can actually see.
  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const selectAllVisible = useCallback(() => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const r of visible) next.add(r.id);
      return next;
    });
  }, [visible]);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const visibleSelectedCount = useMemo(
    () => visible.reduce((acc, r) => acc + (selectedIds.has(r.id) ? 1 : 0), 0),
    [visible, selectedIds]
  );
  const allVisibleSelected = visible.length > 0 && visibleSelectedCount === visible.length;

  // Apply the bulk-patch fields to a target set of rows. Empty patch
  // fields are skipped — stamping just the player name without touching
  // asset type is a single Apply press.
  const applyBulkPatch = useCallback((targetIds) => {
    setRows(prev => prev.map(r => {
      if (!targetIds.has(r.id)) return r;
      const patch = {};
      // Scope first because changing it affects which other fields are
      // valid on the target row. When stamping a player onto a row that
      // was previously league-scoped, force the scope back to 'player'.
      if (bulkPatch.scope) patch.scope = bulkPatch.scope;
      if (bulkPatch.team) patch.team = bulkPatch.team;
      if (bulkPatch.num) patch.num = bulkPatch.num;
      if (bulkPatch.firstInitial) patch.firstInitial = bulkPatch.firstInitial;
      if (bulkPatch.lastName) patch.lastName = bulkPatch.lastName;
      if (bulkPatch.assetType) patch.assetType = bulkPatch.assetType;
      // Stamping a player implicitly promotes the row to 'auto' (it's
      // no longer a low-confidence guess — the user just confirmed it).
      if (bulkPatch.lastName || bulkPatch.team) {
        if (r.status === 'review') patch.status = 'auto';
      }
      return { ...r, ...patch };
    }));
  }, [bulkPatch]);
  const applyBulkToSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    applyBulkPatch(selectedIds);
  }, [applyBulkPatch, selectedIds]);
  // "Stamp this row's tags onto every visible row" — the one-shot
  // shortcut for "I just dropped 30 photos of one player." Click on
  // any well-tagged row and every visible row inherits its team /
  // player / asset-type fields.
  const stampRowOnVisible = useCallback((sourceRow) => {
    const targetIds = new Set(visible.map(v => v.id).filter(id => id !== sourceRow.id));
    setRows(prev => prev.map(r => {
      if (!targetIds.has(r.id)) return r;
      return {
        ...r,
        scope: sourceRow.scope,
        team: sourceRow.team,
        num: sourceRow.num,
        firstInitial: sourceRow.firstInitial,
        lastName: sourceRow.lastName,
        // Don't overwrite assetType — different photos of the same
        // player are usually different types (HEADSHOT vs ACTION).
        // Leave the heuristic's per-file guess in place.
        status: r.status === 'review' ? 'auto' : r.status,
      };
    }));
  }, [visible]);

  // Build the canonical filename from the resolved tags so parseFilename
  // (and every downstream lookup) treats the import as already-tagged.
  const buildName = (r) => {
    const ext = (r.file.name.match(/\.[^.]+$/) || ['.jpg'])[0].slice(1);
    if (r.scope === 'league') {
      return buildLeagueFilename({ assetType: r.assetType, variant: r.variant, ext });
    }
    if (r.scope === 'team') {
      return buildTeamFilename({ team: r.team, assetType: r.assetType, variant: r.variant, ext });
    }
    return buildPlayerFilename({
      team: r.team, num: r.num, firstInitial: r.firstInitial,
      lastName: r.lastName, assetType: r.assetType, ext,
    });
  };

  const runImport = useCallback(async () => {
    setStage('importing');
    const compressOn = getCompressPreference();
    const todo = importable;
    setProgress({ done: 0, total: todo.length });
    let ok = 0, fail = 0, savedBytes = 0;
    const records = [];
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      try {
        // Skip if the row is missing required fields — the user picked
        // 'auto' but the heuristic actually had nothing. Belt + braces.
        if (r.scope !== 'league' && !r.team) { fail++; continue; }
        if (r.scope === 'player' && !r.lastName) { fail++; continue; }
        if (r.scope === 'league' && !r.assetType) { fail++; continue; }

        let blob = r.file;
        let width = 0, height = 0;
        if (compressOn && r.file.type.startsWith('image/')) {
          try {
            const result = await compressImageBlob(r.file);
            blob = result.blob;
            width = result.width; height = result.height;
            savedBytes += (result.originalBytes - result.finalBytes);
          } catch {
            blob = r.file;
          }
        }
        const newName = buildName(r);
        const rec = await saveMedia({
          name: newName, blob, width, height,
          // Preserve Drive provenance when the row originated from a Drive
          // download so the Drive folder browser can mark it imported.
          driveFileId: r.file.driveFileId || null,
          source: r.file.driveFileId ? 'gdrive' : 'local',
        });
        records.push(rec);
        ok++;
      } catch (e) {
        console.warn('bulk import row failed', r.file.name, e);
        fail++;
      }
      setProgress({ done: i + 1, total: todo.length });
    }
    setResults({ ok, fail, skipped: rows.length - todo.length, savedBytes, records });
    setStage('done');
    if (onImported) onImported(records);
  }, [importable, rows.length, onImported]);

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200, padding: 16,
    }} onClick={(e) => { if (e.target === e.currentTarget && stage !== 'importing') onClose(); }}>
      <Card style={{
        width: '100%', maxWidth: 1100, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <SectionHeading style={{ margin: 0 }}>Bulk import</SectionHeading>
          <button onClick={onClose} disabled={stage === 'importing'} style={{
            background: 'transparent', border: 'none', cursor: stage === 'importing' ? 'not-allowed' : 'pointer',
            fontSize: 22, lineHeight: 1, color: colors.textMuted, padding: 4,
          }}>×</button>
        </div>

        {stage === 'idle' && (
          <DropZone
            dragOver={dragOver}
            onDragEnter={() => setDragOver(true)}
            onDragLeave={() => setDragOver(false)}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDrop={handleDrop}
            onFolderInput={handleFolderInput}
          />
        )}

        {stage === 'downloading' && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontFamily: fonts.condensed, color: colors.textSecondary, marginBottom: 12, letterSpacing: 0.5 }}>
              Downloading from Google Drive · {progress.done} / {progress.total}
            </div>
            <div style={{ width: '100%', height: 8, background: colors.bg, borderRadius: 999, overflow: 'hidden' }}>
              <div style={{
                width: `${(progress.done / Math.max(1, progress.total)) * 100}%`,
                height: '100%', background: '#34A853', transition: 'width 0.2s ease',
              }} />
            </div>
          </div>
        )}

        {stage === 'analyzing' && (
          <div style={{ padding: 40, textAlign: 'center', color: colors.textSecondary, fontSize: 13 }}>
            Reading folder + analyzing filenames…
          </div>
        )}

        {stage === 'preview' && (
          <PreviewBody
            rows={visible}
            counts={counts}
            filter={filter}
            setFilter={setFilter}
            updateRow={updateRow}
            setRowStatus={setRowStatus}
            onOpenLightbox={setLightboxRowId}
            selectedIds={selectedIds}
            toggleSelect={toggleSelect}
            selectAllVisible={selectAllVisible}
            clearSelection={clearSelection}
            allVisibleSelected={allVisibleSelected}
            visibleSelectedCount={visibleSelectedCount}
            bulkPatch={bulkPatch}
            setBulkPatch={setBulkPatch}
            applyBulkToSelected={applyBulkToSelected}
            stampRowOnVisible={stampRowOnVisible}
          />
        )}

        {stage === 'importing' && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontFamily: fonts.condensed, color: colors.textSecondary, marginBottom: 12, letterSpacing: 0.5 }}>
              Uploading {progress.done} / {progress.total}
            </div>
            <div style={{ width: '100%', height: 8, background: colors.bg, borderRadius: 999, overflow: 'hidden' }}>
              <div style={{
                width: `${(progress.done / Math.max(1, progress.total)) * 100}%`,
                height: '100%', background: colors.red, transition: 'width 0.2s ease',
              }} />
            </div>
          </div>
        )}

        {stage === 'done' && results && (
          <ResultsBody results={results} onClose={onClose} />
        )}

        {stage === 'preview' && (
          <div style={{
            padding: '12px 18px', borderTop: `1px solid ${colors.border}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
          }}>
            <div style={{ fontSize: 11, color: colors.textSecondary, fontFamily: fonts.condensed, letterSpacing: 0.4 }}>
              {importable.length} ready to import · {counts.review} need review · {counts.skip} skipped
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <OutlineButton onClick={onClose}>Cancel</OutlineButton>
              <RedButton onClick={runImport} disabled={importable.length === 0}>
                Import {importable.length} {importable.length === 1 ? 'file' : 'files'}
              </RedButton>
            </div>
          </div>
        )}
      </Card>

      {/* Lightbox — full-size preview of whichever row the user clicked.
          Edits made here flow back into the row state so the user can
          fix tags while looking at the photo. */}
      {lightboxRowId && (() => {
        const idx = visible.findIndex(r => r.id === lightboxRowId);
        const row = idx >= 0 ? visible[idx] : null;
        if (!row) return null;
        const goPrev = () => setLightboxRowId(visible[(idx - 1 + visible.length) % visible.length].id);
        const goNext = () => setLightboxRowId(visible[(idx + 1) % visible.length].id);
        return (
          <PreviewLightbox
            open={true}
            url={row.previewUrl}
            blob={!row.previewUrl ? row.file : null}
            isVideo={row.isVideo}
            position={`${idx + 1} / ${visible.length}`}
            onClose={() => setLightboxRowId(null)}
            onPrev={visible.length > 1 ? goPrev : null}
            onNext={visible.length > 1 ? goNext : null}
            sidebar={
              <LightboxEditPanel
                row={row}
                updateRow={updateRow}
                setRowStatus={setRowStatus}
              />
            }
          />
        );
      })()}
    </div>
  );
}

function DropZone({ dragOver, onDragEnter, onDragLeave, onDragOver, onDrop, onFolderInput }) {
  return (
    <div
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        margin: 18,
        padding: 40,
        textAlign: 'center',
        border: `2px dashed ${dragOver ? colors.red : colors.border}`,
        background: dragOver ? 'rgba(220,38,38,0.05)' : colors.bg,
        borderRadius: radius.base,
        transition: 'all 0.15s',
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
      <div style={{ fontFamily: fonts.heading, fontSize: 18, marginBottom: 6 }}>
        Drop a folder here
      </div>
      <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 16, lineHeight: 1.5 }}>
        We'll read every image and video inside (and any sub-folders), run the filename heuristic,<br />
        and let you eyeball + fix anything before committing the batch.
      </div>
      <label style={{
        display: 'inline-block',
        padding: '8px 16px',
        background: colors.red, color: '#fff',
        borderRadius: radius.sm, cursor: 'pointer',
        fontFamily: fonts.condensed, fontSize: 12, fontWeight: 700,
        letterSpacing: 0.5, textTransform: 'uppercase',
      }}>
        Or pick a folder…
        <input
          type="file"
          // webkitdirectory is non-standard but all major browsers support it.
          // eslint-disable-next-line react/no-unknown-property
          webkitdirectory=""
          // eslint-disable-next-line react/no-unknown-property
          directory=""
          multiple
          accept="image/*,video/*"
          onChange={onFolderInput}
          style={{ display: 'none' }}
        />
      </label>
    </div>
  );
}

function PreviewBody({
  rows, counts, filter, setFilter, updateRow, setRowStatus, onOpenLightbox,
  selectedIds, toggleSelect, selectAllVisible, clearSelection,
  allVisibleSelected, visibleSelectedCount,
  bulkPatch, setBulkPatch, applyBulkToSelected, stampRowOnVisible,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{
        padding: '10px 18px', borderBottom: `1px solid ${colors.borderLight}`,
        display: 'flex', gap: 6, alignItems: 'center',
      }}>
        {[
          { id: 'all',    label: `All (${counts.all})` },
          { id: 'review', label: `Needs review (${counts.review})` },
          { id: 'auto',   label: `Auto-tagged (${counts.auto})` },
          { id: 'skip',   label: `Skipped (${counts.skip})` },
        ].map(t => (
          <button key={t.id} onClick={() => setFilter(t.id)} style={{
            padding: '5px 10px', borderRadius: radius.sm,
            fontSize: 11, fontWeight: 700, fontFamily: fonts.condensed, letterSpacing: 0.4, textTransform: 'uppercase',
            background: filter === t.id ? colors.red : 'transparent',
            color: filter === t.id ? '#fff' : colors.textSecondary,
            border: `1px solid ${filter === t.id ? colors.red : colors.border}`,
            cursor: 'pointer',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Bulk-apply bar — fill values any time, then pick the rows
          (or use "Select all visible" right inside the bar). Empty
          fields are skipped on apply, so partial apply works. */}
      <BulkApplyBar
        bulkPatch={bulkPatch}
        setBulkPatch={setBulkPatch}
        selectedCount={selectedIds.size}
        applyBulkToSelected={applyBulkToSelected}
        clearSelection={clearSelection}
        selectAllVisible={selectAllVisible}
        allVisibleSelected={allVisibleSelected}
        visibleCount={rows.length}
      />

      <div style={{ overflow: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: colors.bg, zIndex: 1 }}>
            <tr>
              <Th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={() => allVisibleSelected ? clearSelection() : selectAllVisible()}
                  title={allVisibleSelected ? 'Clear selection' : 'Select all visible rows'}
                  style={{ cursor: 'pointer' }}
                />
              </Th>
              <Th style={{ width: 60 }}>Preview</Th>
              <Th style={{ width: 80 }}>Status</Th>
              <Th>Original filename</Th>
              <Th style={{ width: 100 }}>Team</Th>
              <Th style={{ width: 80 }}>Scope</Th>
              <Th style={{ width: 80 }}>Number</Th>
              <Th style={{ width: 120 }}>Last name</Th>
              <Th style={{ width: 150 }}>Asset type</Th>
              <Th style={{ width: 130 }}></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isSelected = selectedIds.has(r.id);
              return (
              <tr key={r.id} style={{
                borderTop: `1px solid ${colors.divider}`,
                opacity: r.status === 'skip' ? 0.5 : 1,
                background: isSelected
                  ? 'rgba(220,38,38,0.06)'
                  : r.status === 'review' ? 'rgba(245,158,11,0.06)' : 'transparent',
              }}>
                <Td>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(r.id)}
                    style={{ cursor: 'pointer' }}
                  />
                </Td>
                <Td>
                  <button
                    onClick={() => onOpenLightbox(r.id)}
                    title="Click to view at full size"
                    style={{
                      width: 44, height: 44, padding: 0,
                      borderRadius: radius.sm, overflow: 'hidden',
                      border: `1px solid ${colors.borderLight}`,
                      background: r.previewUrl ? `url(${r.previewUrl}) center/cover` : colors.bg,
                      cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {!r.previewUrl && (
                      <span style={{ fontSize: 18, opacity: 0.6 }}>{r.isVideo ? '🎬' : '📄'}</span>
                    )}
                  </button>
                </Td>
                <Td>
                  <StatusChip status={r.status} confidence={r.confidence} />
                </Td>
                <Td><div title={r.reasons.join(' · ')} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{r.file.name}</div></Td>
                <Td>
                  {r.scope === 'league' ? (
                    <span style={{
                      padding: '3px 8px', borderRadius: radius.sm,
                      background: colors.redLight, color: colors.red,
                      fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                      border: `1px solid ${colors.red}33`,
                    }}>BLW</span>
                  ) : (
                    <select value={r.team} onChange={e => updateRow(r.id, { team: e.target.value })} style={{ ...selectStyle, fontSize: 11, padding: '3px 6px' }}>
                      <option value="">—</option>
                      {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
                    </select>
                  )}
                </Td>
                <Td>
                  <select value={r.scope} onChange={e => {
                    const next = e.target.value;
                    const defaultType =
                      next === 'team'   ? 'TEAMPHOTO' :
                      next === 'league' ? 'EVENT'     :
                                          'HEADSHOT';
                    // Switching INTO league wipes team — there's no team for league assets.
                    const teamPatch = next === 'league' ? { team: '' } : {};
                    updateRow(r.id, { scope: next, assetType: defaultType, ...teamPatch });
                  }} style={{ ...selectStyle, fontSize: 11, padding: '3px 6px' }}>
                    <option value="player">player</option>
                    <option value="team">team</option>
                    <option value="league">league</option>
                  </select>
                </Td>
                <Td>
                  {r.scope === 'player' ? (
                    <input value={r.num} onChange={e => updateRow(r.id, { num: e.target.value })} style={{ ...inputStyle, fontSize: 11, padding: '3px 6px', width: 60 }} />
                  ) : <span style={{ color: colors.textMuted }}>—</span>}
                </Td>
                <Td>
                  {r.scope === 'player' ? (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input value={r.firstInitial} onChange={e => updateRow(r.id, { firstInitial: e.target.value.toUpperCase().slice(0, 1) })}
                        placeholder="FI" style={{ ...inputStyle, fontSize: 11, padding: '3px 6px', width: 32, textAlign: 'center' }} />
                      <input value={r.lastName} onChange={e => updateRow(r.id, { lastName: e.target.value.toUpperCase() })}
                        placeholder="Last" style={{ ...inputStyle, fontSize: 11, padding: '3px 6px', width: 80 }} />
                    </div>
                  ) : <span style={{ color: colors.textMuted }}>—</span>}
                </Td>
                <Td>
                  <select value={r.assetType} onChange={e => updateRow(r.id, { assetType: e.target.value })} style={{ ...selectStyle, fontSize: 11, padding: '3px 6px', maxWidth: 140 }}>
                    {(
                      r.scope === 'team'   ? TEAM_ASSET_TYPES :
                      r.scope === 'league' ? LEAGUE_ASSET_TYPES :
                                             PLAYER_ASSET_TYPES
                    ).map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </Td>
                <Td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {r.status === 'skip' ? (
                      <button onClick={() => setRowStatus(r.id, 'review')} style={miniBtn(colors.text)}>Restore</button>
                    ) : (
                      <button onClick={() => setRowStatus(r.id, 'skip')} style={miniBtn(colors.textMuted)}>Skip</button>
                    )}
                    {/* "Stamp this row's tags onto every other visible row"
                        — the one-click shortcut for "I just dropped 30
                        photos of the same player." Disabled if this row
                        doesn't have enough info to stamp. */}
                    {(r.scope === 'league' ? r.assetType : (r.team && (r.scope === 'team' || r.lastName))) && (
                      <button
                        onClick={() => stampRowOnVisible(r)}
                        title="Stamp this row's team / player onto every visible row (asset type left as detected per-file)"
                        style={miniBtn('#15803D')}
                      >📌 To all</button>
                    )}
                  </div>
                </Td>
              </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: colors.textMuted, fontStyle: 'italic' }}>
                No rows in this filter.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Bulk apply bar — one-shot way to stamp the same player onto a whole
// batch of selected rows. Empty fields are no-ops, so partial apply
// works ("just set Konnor Jaso, leave asset types as auto-detected").
//
// Form fields are always editable so you can fill them out FIRST and
// THEN pick rows; only the Apply button gates on having a selection.
// "Select all visible" lives in the bar so the typical flow (fill →
// select all → apply) is two clicks plus typing.
function BulkApplyBar({
  bulkPatch, setBulkPatch,
  selectedCount, applyBulkToSelected, clearSelection,
  selectAllVisible, allVisibleSelected, visibleCount,
}) {
  const noSelection = selectedCount === 0;
  const set = (patch) => setBulkPatch(prev => ({ ...prev, ...patch }));
  // Choose asset-type list based on the chosen scope (defaults to player
  // when scope is left blank — the most common case).
  const types =
    bulkPatch.scope === 'team'   ? TEAM_ASSET_TYPES :
    bulkPatch.scope === 'league' ? LEAGUE_ASSET_TYPES :
                                   PLAYER_ASSET_TYPES;
  return (
    <div style={{
      padding: '10px 18px',
      borderBottom: `1px solid ${colors.borderLight}`,
      background: 'rgba(220,38,38,0.04)',
      display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end',
      transition: 'background 0.15s',
    }}>
      <div style={{
        fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
        letterSpacing: 0.5, textTransform: 'uppercase',
        color: colors.red,
        flexBasis: '100%',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>
          Bulk apply{noSelection
            ? ` · fill values then pick rows (or use "Select all" below)`
            : ` · ${selectedCount} row${selectedCount === 1 ? '' : 's'} selected`}
        </span>
        <button
          onClick={() => allVisibleSelected ? clearSelection() : selectAllVisible()}
          style={{
            padding: '3px 10px', borderRadius: radius.sm,
            background: 'transparent', color: colors.red,
            border: `1px solid ${colors.red}55`,
            fontSize: 10, fontFamily: fonts.condensed, fontWeight: 700,
            letterSpacing: 0.4, textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >{allVisibleSelected
          ? `Clear selection (${selectedCount})`
          : `Select all visible (${visibleCount})`}
        </button>
      </div>
      <BulkField label="Scope">
        <select value={bulkPatch.scope} onChange={e => {
          const next = e.target.value;
          // Switching scope through the bulk bar resets defaults that
          // don't apply in the new mode (e.g. moving to league clears
          // team / player fields so the apply doesn't mix them in).
          const reset = next === 'league'
            ? { team: '', num: '', firstInitial: '', lastName: '' }
            : {};
          set({ scope: next, ...reset });
        }} style={{ ...selectStyle, fontSize: 11, padding: '4px 8px' }}>
          <option value="">— don't change</option>
          <option value="player">player</option>
          <option value="team">team</option>
          <option value="league">league</option>
        </select>
      </BulkField>
      <BulkField label="Team">
        {bulkPatch.scope === 'league' ? (
          <span style={{
            padding: '4px 10px', borderRadius: radius.sm,
            background: colors.redLight, color: colors.red,
            fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
            border: `1px solid ${colors.red}33`, display: 'inline-block',
          }}>BLW</span>
        ) : (
          <select value={bulkPatch.team} onChange={e => set({ team: e.target.value })}
            style={{ ...selectStyle, fontSize: 11, padding: '4px 8px' }}>
            <option value="">— don't change</option>
            {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
          </select>
        )}
      </BulkField>
      {bulkPatch.scope !== 'team' && bulkPatch.scope !== 'league' && (
        <>
          <BulkField label="#">
            <input value={bulkPatch.num}
              onChange={e => set({ num: e.target.value.replace(/\D/g, '').slice(0, 2) })}
              placeholder="##"
              style={{ ...inputStyle, fontSize: 11, padding: '4px 8px', width: 50, textAlign: 'center' }} />
          </BulkField>
          <BulkField label="FI">
            <input value={bulkPatch.firstInitial}
              onChange={e => set({ firstInitial: e.target.value.toUpperCase().slice(0, 1) })}
              placeholder="F"
              style={{ ...inputStyle, fontSize: 11, padding: '4px 8px', width: 38, textAlign: 'center' }} />
          </BulkField>
          <BulkField label="Last name">
            <input value={bulkPatch.lastName}
              onChange={e => set({ lastName: e.target.value.toUpperCase() })}
              placeholder="LASTNAME"
              style={{ ...inputStyle, fontSize: 11, padding: '4px 8px', width: 130 }} />
          </BulkField>
        </>
      )}
      <BulkField label="Asset type">
        <select value={bulkPatch.assetType} onChange={e => set({ assetType: e.target.value })}
          style={{ ...selectStyle, fontSize: 11, padding: '4px 8px' }}>
          <option value="">— don't change</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </BulkField>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        <button onClick={clearSelection} disabled={noSelection} style={{
          padding: '6px 12px', borderRadius: radius.sm,
          background: 'transparent', color: noSelection ? colors.textMuted : colors.textSecondary,
          border: `1px solid ${colors.border}`,
          fontSize: 11, fontFamily: fonts.condensed, fontWeight: 700,
          letterSpacing: 0.4, textTransform: 'uppercase',
          cursor: noSelection ? 'not-allowed' : 'pointer',
        }}>Clear sel.</button>
        <button onClick={applyBulkToSelected} disabled={noSelection} style={{
          padding: '6px 14px', borderRadius: radius.sm,
          background: noSelection ? colors.border : colors.red,
          color: '#fff', border: 'none',
          fontSize: 11, fontFamily: fonts.condensed, fontWeight: 700,
          letterSpacing: 0.5, textTransform: 'uppercase',
          cursor: noSelection ? 'not-allowed' : 'pointer',
        }}>Apply to {selectedCount} row{selectedCount === 1 ? '' : 's'}</button>
      </div>
    </div>
  );
}

const BulkField = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span style={{
      fontFamily: fonts.condensed, fontSize: 9, fontWeight: 700,
      letterSpacing: 0.5, textTransform: 'uppercase', color: colors.textSecondary,
    }}>{label}</span>
    {children}
  </label>
);

function StatusChip({ status, confidence }) {
  const palette = {
    auto:   { bg: 'rgba(34,197,94,0.12)', fg: '#15803D', label: confidence === 'high' ? 'Auto · high' : 'Auto' },
    review: { bg: 'rgba(245,158,11,0.12)', fg: '#92400E', label: 'Review' },
    skip:   { bg: 'rgba(107,114,128,0.12)', fg: '#374151', label: 'Skip' },
  }[status] || { bg: colors.bg, fg: colors.textSecondary, label: status };
  return (
    <span style={{
      padding: '2px 6px', borderRadius: radius.full,
      background: palette.bg, color: palette.fg,
      fontFamily: fonts.condensed, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
    }}>{palette.label}</span>
  );
}

// Edit panel rendered as the lightbox sidebar — same fields as the
// row in the table, but visible while the photo is on screen so
// retagging from sight doesn't require closing → editing → reopening.
function LightboxEditPanel({ row, updateRow, setRowStatus }) {
  return (
    <div style={{
      width: '100%', maxWidth: 920,
      background: 'rgba(255,255,255,0.96)',
      borderRadius: radius.base, padding: 12,
      display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
      fontFamily: fonts.body, fontSize: 12, color: colors.text,
      boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
    }}>
      <div style={{
        fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11,
        flexBasis: '100%', color: colors.textSecondary,
      }} title={row.reasons.join(' · ')}>
        {row.file.name}
      </div>
      <LightboxField label="Team">
        {row.scope === 'league' ? (
          <span style={{
            padding: '4px 10px', borderRadius: radius.sm,
            background: colors.redLight, color: colors.red,
            fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
            border: `1px solid ${colors.red}33`, display: 'inline-block',
          }}>BLW</span>
        ) : (
          <select value={row.team} onChange={e => updateRow(row.id, { team: e.target.value })}
            style={{ ...selectStyle, fontSize: 11, padding: '4px 8px' }}>
            <option value="">—</option>
            {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
          </select>
        )}
      </LightboxField>
      <LightboxField label="Scope">
        <select value={row.scope} onChange={e => {
          const next = e.target.value;
          const defaultType =
            next === 'team'   ? 'TEAMPHOTO' :
            next === 'league' ? 'EVENT'     :
                                'HEADSHOT';
          const teamPatch = next === 'league' ? { team: '' } : {};
          updateRow(row.id, { scope: next, assetType: defaultType, ...teamPatch });
        }} style={{ ...selectStyle, fontSize: 11, padding: '4px 8px' }}>
          <option value="player">player</option>
          <option value="team">team</option>
          <option value="league">league</option>
        </select>
      </LightboxField>
      {row.scope === 'player' && (
        <>
          <LightboxField label="#">
            <input value={row.num} onChange={e => updateRow(row.id, { num: e.target.value })}
              style={{ ...inputStyle, fontSize: 11, padding: '4px 8px', width: 60 }} />
          </LightboxField>
          <LightboxField label="FI">
            <input value={row.firstInitial} onChange={e => updateRow(row.id, { firstInitial: e.target.value.toUpperCase().slice(0, 1) })}
              style={{ ...inputStyle, fontSize: 11, padding: '4px 8px', width: 40, textAlign: 'center' }} />
          </LightboxField>
          <LightboxField label="Last name">
            <input value={row.lastName} onChange={e => updateRow(row.id, { lastName: e.target.value.toUpperCase() })}
              style={{ ...inputStyle, fontSize: 11, padding: '4px 8px', width: 120 }} />
          </LightboxField>
        </>
      )}
      <LightboxField label="Asset type">
        <select value={row.assetType} onChange={e => updateRow(row.id, { assetType: e.target.value })}
          style={{ ...selectStyle, fontSize: 11, padding: '4px 8px' }}>
          {(
            row.scope === 'team'   ? TEAM_ASSET_TYPES :
            row.scope === 'league' ? LEAGUE_ASSET_TYPES :
                                     PLAYER_ASSET_TYPES
          ).map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </LightboxField>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        {row.status === 'skip' ? (
          <button onClick={() => setRowStatus(row.id, 'review')} style={miniBtn(colors.text)}>Restore</button>
        ) : (
          <button onClick={() => setRowStatus(row.id, 'skip')} style={miniBtn(colors.textMuted)}>Skip</button>
        )}
        <button onClick={() => setRowStatus(row.id, 'auto')} style={miniBtn('#15803D')} title="Mark this row as confirmed/auto">
          ✓ Confirm
        </button>
      </div>
    </div>
  );
}

const LightboxField = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span style={{
      fontFamily: fonts.condensed, fontSize: 9, fontWeight: 700,
      letterSpacing: 0.5, textTransform: 'uppercase', color: colors.textSecondary,
    }}>{label}</span>
    {children}
  </label>
);

function ResultsBody({ results, onClose }) {
  const fmt = (n) => n < 1024 ? `${n} B`
    : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB`
    : n < 1024 ** 3 ? `${(n / (1024 ** 2)).toFixed(1)} MB`
    : `${(n / (1024 ** 3)).toFixed(2)} GB`;
  return (
    <div style={{ padding: 30, textAlign: 'center' }}>
      <div style={{ fontSize: 38, marginBottom: 8 }}>{results.fail === 0 ? '✓' : '⚠'}</div>
      <div style={{ fontFamily: fonts.heading, fontSize: 18, marginBottom: 6 }}>
        Imported {results.ok} {results.ok === 1 ? 'file' : 'files'}
      </div>
      <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.6 }}>
        {results.fail > 0 && <div style={{ color: '#92400E' }}>{results.fail} failed (missing team/lastname tags)</div>}
        {results.skipped > 0 && <div>{results.skipped} skipped by you</div>}
        {results.savedBytes > 0 && <div>Compression saved <strong>{fmt(results.savedBytes)}</strong> of storage</div>}
      </div>
      <div style={{ marginTop: 20 }}>
        <RedButton onClick={onClose}>Done</RedButton>
      </div>
    </div>
  );
}

const Th = ({ children, style }) => (
  <th style={{
    padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap',
    fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
    color: colors.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase',
    ...style,
  }}>{children}</th>
);
const Td = ({ children, style }) => (
  <td style={{ padding: '6px 10px', verticalAlign: 'middle', ...style }}>{children}</td>
);
const miniBtn = (color) => ({
  padding: '3px 8px', borderRadius: radius.sm,
  background: 'transparent', color,
  border: `1px solid ${color}33`,
  fontSize: 10, fontFamily: fonts.condensed, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
  cursor: 'pointer',
});
