import { useState, useCallback, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { TEAMS, getTeam } from '../data';
import { Card, PageHeader, SectionHeading, Label, RedButton, OutlineButton, TeamChip, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { saveMedia, getAllMedia, deleteMedia, updateMedia, blobToObjectURL, TEAM_SCOPE_TYPES, LEAGUE_SCOPE_TYPES, LEAGUE_TEAM_CODE, buildLeagueFilename } from '../media-store';
import {
  getApiKey, getSavedFolders, saveFolder, removeFolder, renameFolder,
  extractFolderId, listFolderFiles, downloadFileAsBlob,
} from '../drive-api';
import { heuristicallyTag, isAlreadyTagged } from '../tag-heuristics';
import { autoTagBlob } from '../auto-tag-api';
import { getAllPlayersDirectory } from '../data';
import { supabaseConfigured } from '../supabase-client';
import { backupLibraryToCloud } from '../cloud-backup';
import { refreshFromCloud } from '../cloud-reader';
import { useToast } from '../toast';
import { authedFetch } from '../authed-fetch';
import { compressImageBlob, getCompressPreference, setCompressPreference, formatSavings } from '../image-compress';
import BulkImportModal from './BulkImportModal';
import { PreviewLightbox } from '../preview-lightbox';

const PLAYER_ASSET_TYPES = ['HEADSHOT', 'ACTION', 'ACTION2', 'PORTRAIT', 'HIGHLIGHT', 'HIGHLIGHT2', 'INTERVIEW'];
const TEAM_ASSET_TYPES = ['TEAMPHOTO', 'VENUE', 'LOGO_PRIMARY', 'LOGO_DARK', 'LOGO_LIGHT', 'LOGO_ICON', 'WORDMARK'];
// League-scoped asset types — for BLW-wide media that doesn't belong
// to any one team (All-Star events, championships, multi-team photos,
// league branding). Stored under the literal "BLW" team prefix.
const LEAGUE_ASSET_TYPES = ['ALLSTAR', 'EVENT', 'MULTI_TEAM', 'TROPHY', 'BANNER', 'BRANDING', 'LOGO_PRIMARY', 'LOGO_DARK', 'LOGO_LIGHT', 'LOGO_ICON', 'WORDMARK'];
const ASSET_TYPES = [...PLAYER_ASSET_TYPES, ...TEAM_ASSET_TYPES, ...LEAGUE_ASSET_TYPES];
const typeIcons = { HEADSHOT: '👤', ACTION: '📸', ACTION2: '📸', HIGHLIGHT: '🎬', HIGHLIGHT2: '🎬', LOGO_PRIMARY: '🎨', LOGO_DARK: '🎨', LOGO_LIGHT: '🎨', LOGO_ICON: '🎨', PORTRAIT: '🖼️', INTERVIEW: '🎤', WORDMARK: '✏️', TEAMPHOTO: '👥', VENUE: '🏟️', ALLSTAR: '⭐', EVENT: '🎉', MULTI_TEAM: '🏟️', TROPHY: '🏆', BANNER: '🎌', BRANDING: '🎨', FILE: '📄', LINK: '🔗' };
const sourceLabels = { local: 'Local', gdrive: 'Google Drive' };
const sourceColors = { local: colors.red, gdrive: '#34A853' };

// A file is considered properly named if it matches any of the conventions
// that the parser recognises (player-scoped w/ or w/o initial, team-scoped).
// Delegates to isAlreadyTagged so the rules live in one place.
function isProperlyNamed(name) {
  return isAlreadyTagged(name);
}

// TagRow — single untagged file row with:
//   - Layer 1 heuristic auto-fill on mount (filename + folder matching, free/instant)
//   - Layer 2 AI auto-tag button (vision AI via /api/auto-tag, costs pennies)
//   - Manual dropdown overrides so user can correct AI guesses before Apply
// The parent may also push an AI result via `tagHint` prop (used for bulk runs).
function TagRow({ file, thumbUrl, blobRef, roster, tagHint, onUpdate, onDelete, onRequestAiTag, aiBusy, onPreview }) {
  const [tagScope, setTagScope] = useState('player'); // 'player' | 'team' | 'league'
  const [tagTeam, setTagTeam] = useState('');
  const [tagNum, setTagNum] = useState('');
  const [tagInitial, setTagInitial] = useState('');
  const [tagName, setTagName] = useState('');
  const [tagType, setTagType] = useState('HEADSHOT');
  const [tagVariant, setTagVariant] = useState('');
  const [saving, setSaving] = useState(false);
  const [hintSource, setHintSource] = useState(''); // "heuristic" | "ai" | "" (none)
  const [confidence, setConfidence] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [ambiguous, setAmbiguous] = useState(false);

  // Switching scope clears inputs that don't apply in the other mode so the
  // preview doesn't retain stale data.
  const switchScope = (next) => {
    if (next === tagScope) return;
    setTagScope(next);
    if (next === 'team') {
      setTagNum(''); setTagInitial(''); setTagName('');
      // Default team-scoped type
      if (!TEAM_SCOPE_TYPES.has(tagType)) setTagType('TEAMPHOTO');
    } else if (next === 'league') {
      // League-scoped clears team + player fields entirely. The "team"
      // is the league sentinel BLW; we set it implicitly at apply time.
      setTagNum(''); setTagInitial(''); setTagName(''); setTagTeam('');
      if (!LEAGUE_SCOPE_TYPES.has(tagType)) setTagType('EVENT');
    } else {
      setTagVariant('');
      if (TEAM_SCOPE_TYPES.has(tagType) || LEAGUE_SCOPE_TYPES.has(tagType)) setTagType('HEADSHOT');
    }
  };

  // Layer 1 — run once on mount to pre-fill fields from filename heuristics
  useEffect(() => {
    if (!roster || roster.length === 0) return;
    if (hintSource === 'ai') return; // AI already provided tags; don't overwrite
    const guess = heuristicallyTag({ filename: file.name, roster });
    if (guess.confidence === 'none') return;
    // League-scope detection trumps team / player guesses entirely —
    // a BLW_ALLSTAR.jpg shouldn't pull a team or jersey number along for the ride.
    if (guess.scope === 'league') setTagScope('league');
    if (guess.team && !tagTeam && guess.scope !== 'league') setTagTeam(guess.team);
    if (guess.assetType) {
      setTagType(guess.assetType);
      if (guess.scope === 'league') {
        // Already set scope above; nothing more to do.
      } else if (TEAM_SCOPE_TYPES.has(guess.assetType)) {
        setTagScope('team');
      }
    }
    if (guess.num && !tagNum) setTagNum(guess.num);
    if (guess.lastName && !tagName) setTagName(guess.lastName);
    if (guess.firstInitial && !tagInitial) setTagInitial(guess.firstInitial);
    if (guess.ambiguous) setAmbiguous(true);
    if (!hintSource) {
      setHintSource('heuristic');
      setConfidence(guess.confidence);
      setReasoning(guess.reasons.join(' · '));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster?.length]);

  // When the parent provides an AI hint (from bulk run or parent-initiated call),
  // sync the inputs to it. Always overrides whatever heuristic found.
  useEffect(() => {
    if (!tagHint) return;
    if (tagHint.error) {
      setHintSource('ai');
      setConfidence('error');
      setReasoning(tagHint.error);
      return;
    }
    if (tagHint.team) setTagTeam(tagHint.team);
    if (tagHint.assetType) {
      setTagType(tagHint.assetType);
      if (TEAM_SCOPE_TYPES.has(tagHint.assetType)) setTagScope('team');
    }
    if (tagHint.num) setTagNum(tagHint.num);
    if (tagHint.lastName) setTagName(tagHint.lastName);
    if (tagHint.firstInitial) setTagInitial(tagHint.firstInitial);
    setAmbiguous(Boolean(tagHint.ambiguous));
    setHintSource('ai');
    setConfidence(tagHint.confidence || 'low');
    setReasoning(tagHint.reasoning || '');
  }, [tagHint]);

  const runAiTag = () => {
    if (onRequestAiTag) onRequestAiTag(file.id);
  };

  const ext = file.name.split('.').pop() || 'png';
  let preview = null;
  if (tagScope === 'team' && tagTeam) {
    const type = TEAM_SCOPE_TYPES.has(tagType) ? tagType : 'TEAMPHOTO';
    const v = tagVariant.toUpperCase().replace(/[^A-Z0-9]/g, '');
    preview = v
      ? `${tagTeam}_${type}_${v}.${ext}`
      : `${tagTeam}_${type}.${ext}`;
  } else if (tagScope === 'player' && tagTeam && tagName) {
    const FI = (tagInitial || '').toUpperCase().slice(0, 1);
    const nameSeg = FI ? `${FI}.${tagName.toUpperCase()}` : tagName.toUpperCase();
    preview = `${tagTeam}_${(tagNum || '00').padStart(2, '0')}_${nameSeg}_${tagType}.${ext}`;
  } else if (tagScope === 'league') {
    const type = LEAGUE_SCOPE_TYPES.has(tagType) ? tagType : 'EVENT';
    const v = tagVariant.toUpperCase().replace(/[^A-Z0-9]/g, '');
    preview = buildLeagueFilename({ assetType: type, variant: v, ext });
  }

  const apply = async () => {
    if (!preview) return;
    setSaving(true);
    await onUpdate(file.id, preview);
    setSaving(false);
  };

  const compact = { fontSize: 12, padding: '5px 8px', fontFamily: fonts.body };
  const confidenceBg = confidence === 'high' ? colors.successBg : confidence === 'medium' ? '#FEF3C7' : confidence === 'error' ? '#FEE2E2' : '#FEE2E2';
  const confidenceColor = confidence === 'high' ? '#15803D' : confidence === 'medium' ? '#92400E' : '#991B1B';
  const aiError = confidence === 'error' ? reasoning : '';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
      background: colors.white, border: `1px solid ${hintSource ? confidenceColor + '40' : colors.border}`,
      borderRadius: radius.base, marginBottom: 6,
    }}>
      {/* Thumbnail — click to open at full size so you can identify
          who's in the photo before tagging. */}
      <button
        type="button"
        onClick={() => onPreview && thumbUrl && onPreview(file.id)}
        title={thumbUrl ? 'Click to view at full size' : ''}
        style={{
          width: 48, height: 48, borderRadius: radius.sm, flexShrink: 0,
          background: thumbUrl ? `url(${thumbUrl}) center/cover` : colors.bg,
          border: `1px solid ${colors.borderLight}`,
          padding: 0, cursor: thumbUrl && onPreview ? 'zoom-in' : 'default',
        }}
      />

      {/* Original name + hint badge */}
      <div style={{ minWidth: 120, maxWidth: 180, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.condensed }}>ORIGINAL</div>
          {hintSource && (
            <span
              title={reasoning}
              style={{
                background: confidenceBg, color: confidenceColor,
                padding: '1px 5px', borderRadius: 3, fontSize: 9,
                fontFamily: fonts.condensed, fontWeight: 700, letterSpacing: 0.3,
              }}
            >
              {hintSource === 'ai' ? '✨ AI' : 'AUTO'} · {confidence.toUpperCase()}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.name}>{file.name}</div>
      </div>

      {/* Scope toggle — Player / Team / League. Team & League hide
          jersey# + lastname; League also hides the team picker. */}
      <div style={{ display: 'inline-flex', border: `1px solid ${colors.border}`, borderRadius: radius.sm, overflow: 'hidden', flexShrink: 0 }}>
        {['player', 'team', 'league'].map(s => (
          <button
            key={s}
            onClick={() => switchScope(s)}
            style={{
              background: tagScope === s ? colors.red : colors.white,
              color: tagScope === s ? '#fff' : colors.textSecondary,
              border: 'none', padding: '4px 8px',
              fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
              letterSpacing: 0.5, cursor: 'pointer',
            }}
            title={
              s === 'team'   ? 'Team-wide asset (no player)' :
              s === 'league' ? 'BLW-wide asset — All-Star, championships, multi-team, league branding' :
                               'Tagged to a specific player'
            }
          >{s.toUpperCase()}</button>
        ))}
      </div>

      {/* Tag inputs — team picker hidden for league scope, since
          league assets carry the BLW prefix instead of any team code. */}
      {tagScope !== 'league' && (
        <select value={tagTeam} onChange={e => { setTagTeam(e.target.value); setHintSource(''); }} style={{ ...selectStyle, ...compact, width: 80 }}>
          <option value="">Team</option>
          {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
        </select>
      )}
      {tagScope === 'league' && (
        <span style={{
          padding: '4px 8px', borderRadius: radius.sm,
          background: colors.redLight, color: colors.red,
          fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
          border: `1px solid ${colors.red}33`,
        }} title="League-wide asset — visible across every team">BLW</span>
      )}

      {tagScope === 'player' && (
        <>
          <input type="text" value={tagNum} onChange={e => { setTagNum(e.target.value.replace(/\D/g, '').slice(0, 2)); setHintSource(''); }}
            placeholder="##" maxLength={2} style={{ ...inputStyle, ...compact, width: 44, textAlign: 'center' }} />

          <input type="text" value={tagInitial}
            onChange={e => {
              const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1);
              setTagInitial(v); setHintSource(''); if (v) setAmbiguous(false);
            }}
            placeholder="F"
            title={ambiguous ? 'Two players share this lastname — first initial required' : 'First initial (optional but recommended)'}
            maxLength={1}
            style={{
              ...inputStyle, ...compact, width: 34, textAlign: 'center',
              borderColor: ambiguous && !tagInitial ? '#D97706' : inputStyle.borderColor,
              background: ambiguous && !tagInitial ? '#FEF3C7' : inputStyle.background,
            }}
          />

          <input type="text" value={tagName} onChange={e => { setTagName(e.target.value.toUpperCase().replace(/[^A-Z]/g, '')); setHintSource(''); }}
            placeholder="LASTNAME" style={{ ...inputStyle, ...compact, width: 100 }} />
        </>
      )}

      {(tagScope === 'team' || tagScope === 'league') && (
        <input type="text" value={tagVariant}
          onChange={e => { setTagVariant(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); setHintSource(''); }}
          placeholder="Variant (optional)"
          title='Optional variant suffix, e.g. "DUGOUT", "FIELD", "2026", "GAME01"'
          style={{ ...inputStyle, ...compact, width: 178 }} />
      )}

      <select value={tagType} onChange={e => setTagType(e.target.value)} style={{ ...selectStyle, ...compact, width: 130 }}>
        {(
          tagScope === 'team' ? TEAM_ASSET_TYPES :
          tagScope === 'league' ? LEAGUE_ASSET_TYPES :
          PLAYER_ASSET_TYPES
        ).map(t => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      {/* Preview / error */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {aiError ? (
          <div style={{ fontSize: 10, color: '#991B1B', fontFamily: fonts.condensed, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={aiError}>
            AI: {aiError}
          </div>
        ) : preview ? (
          <div style={{
            fontSize: 10, fontFamily: fonts.condensed, fontWeight: 600,
            color: ambiguous && !tagInitial ? '#92400E' : colors.success,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={ambiguous && !tagInitial ? 'Add a first initial — two players share this lastname' : preview}>
            {ambiguous && !tagInitial ? '⚠︎ ' : '→ '}{preview}
          </div>
        ) : null}
      </div>

      {/* AI auto-tag button */}
      <button onClick={runAiTag} disabled={aiBusy || !blobRef} title="Auto-tag with AI vision" style={{
        background: aiBusy ? colors.border : '#EEF2FF', color: '#6366F1',
        border: `1px solid ${aiBusy ? colors.border : '#C7D2FE'}`, borderRadius: radius.sm,
        padding: '5px 10px', fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
        cursor: aiBusy || !blobRef ? 'default' : 'pointer', whiteSpace: 'nowrap',
        opacity: blobRef ? 1 : 0.5,
      }}>{aiBusy ? '...' : '✨'}</button>

      <button onClick={apply} disabled={!preview || saving} style={{
        background: preview ? colors.red : colors.border, color: '#fff',
        border: 'none', borderRadius: radius.sm, padding: '5px 12px',
        fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
        cursor: preview ? 'pointer' : 'default', opacity: preview ? 1 : 0.4,
        whiteSpace: 'nowrap',
      }}>{saving ? '...' : 'Apply'}</button>

      <button onClick={() => onDelete(file.id)} style={{
        background: 'none', border: 'none', color: colors.textMuted,
        cursor: 'pointer', fontSize: 14, padding: '0 4px',
      }}>✕</button>
    </div>
  );
}

// ─── Drive Folder Browser ───────────────────────────────────────────────────
// Shows files inside one publicly-shared Drive folder as an expandable panel,
// lets user selectively or bulk-import them into the local media store.
function DriveFolderPanel({ folder, importedFileIds, onImport, onRemove, onRename, onBulkImport }) {
  const [expanded, setExpanded] = useState(true);
  const [files, setFiles] = useState(null); // null = not loaded, [] = empty folder
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [importingIds, setImportingIds] = useState(new Set());
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(folder.name);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listFolderFiles(folder.folderId);
      setFiles(list);
    } catch (err) {
      setError(err.message || String(err));
      setFiles(null);
    } finally {
      setLoading(false);
    }
  }, [folder.folderId]);

  useEffect(() => {
    if (expanded && files === null) load();
  }, [expanded, files, load]);

  const notImported = (files || []).filter(f => !importedFileIds.has(f.id));
  const imported = (files || []).filter(f => importedFileIds.has(f.id));

  const toggleSelect = (fileId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const selectAllNew = () => {
    setSelected(new Set(notImported.map(f => f.id)));
  };
  const clearSelection = () => setSelected(new Set());

  const importOne = async (file) => {
    setImportingIds(prev => new Set(prev).add(file.id));
    try {
      await onImport(file);
    } finally {
      setImportingIds(prev => { const n = new Set(prev); n.delete(file.id); return n; });
    }
  };

  const importSelected = async () => {
    const targets = (files || []).filter(f => selected.has(f.id));
    for (const file of targets) {
      if (importedFileIds.has(file.id)) continue;
      setImportingIds(prev => new Set(prev).add(file.id));
      try { await onImport(file); }
      catch (err) { console.error(`Failed to import ${file.name}:`, err); }
      finally {
        setImportingIds(prev => { const n = new Set(prev); n.delete(file.id); return n; });
      }
    }
    setSelected(new Set());
  };

  const importAllNew = async () => {
    for (const file of notImported) {
      setImportingIds(prev => new Set(prev).add(file.id));
      try { await onImport(file); }
      catch (err) { console.error(`Failed to import ${file.name}:`, err); }
      finally {
        setImportingIds(prev => { const n = new Set(prev); n.delete(file.id); return n; });
      }
    }
  };

  const saveRename = () => {
    if (newName.trim() && newName !== folder.name) {
      onRename(folder.folderId, newName.trim());
    }
    setRenaming(false);
  };

  return (
    <div style={{
      border: `1px solid ${colors.border}`, borderRadius: radius.base,
      background: colors.white, marginBottom: 10,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        borderBottom: expanded ? `1px solid ${colors.borderLight}` : 'none',
        cursor: 'pointer', background: colors.bg,
        borderTopLeftRadius: radius.base, borderTopRightRadius: radius.base,
        borderBottomLeftRadius: expanded ? 0 : radius.base,
        borderBottomRightRadius: expanded ? 0 : radius.base,
      }} onClick={() => setExpanded(!expanded)}>
        <span style={{ fontSize: 14, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', color: colors.textSecondary, width: 10 }}>▶</span>
        <span style={{ fontSize: 16 }}>📁</span>
        {renaming ? (
          <input
            type="text" value={newName}
            onChange={e => setNewName(e.target.value)}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') { setNewName(folder.name); setRenaming(false); } }}
            onBlur={saveRename} autoFocus
            style={{ ...inputStyle, fontSize: 13, fontWeight: 700, padding: '3px 8px', flex: 1, maxWidth: 280 }}
          />
        ) : (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              onDoubleClick={e => { e.stopPropagation(); setRenaming(true); }}
              title="Double-click to rename"
            >
              {folder.name}
            </div>
            <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.condensed }}>
              {files === null ? (loading ? 'Loading…' : 'Click to load') : `${files.length} file${files.length === 1 ? '' : 's'}`}
              {imported.length > 0 && ` · ${imported.length} imported`}
            </div>
          </div>
        )}
        <button onClick={(e) => { e.stopPropagation(); load(); }} disabled={loading} style={{
          background: 'none', border: `1px solid ${colors.border}`, borderRadius: radius.sm,
          padding: '4px 10px', fontSize: 10, fontFamily: fonts.condensed, fontWeight: 700,
          cursor: loading ? 'default' : 'pointer', color: colors.textSecondary,
        }}>{loading ? '…' : 'Refresh'}</button>
        <a href={folder.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{
          fontSize: 10, color: colors.textMuted, textDecoration: 'none', fontFamily: fonts.condensed, fontWeight: 700,
        }}>Open in Drive ↗</a>
        <button onClick={(e) => { e.stopPropagation(); if (confirm(`Remove folder "${folder.name}" from this list? Already-imported files stay in your library.`)) onRemove(folder.folderId); }} style={{
          background: 'none', border: 'none', color: colors.textMuted,
          cursor: 'pointer', fontSize: 14, padding: '0 4px',
        }}>✕</button>
      </div>

      {/* Body */}
      {expanded && (
        <div style={{ padding: 12 }}>
          {loading && <div style={{ padding: 20, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>Loading folder…</div>}

          {error && (
            <div style={{ padding: 12, background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: radius.base, color: '#991B1B', fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {error}
            </div>
          )}

          {!loading && !error && files !== null && files.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
              No images or videos in this folder.
            </div>
          )}

          {!loading && !error && files && files.length > 0 && (
            <>
              {/* Bulk action bar */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                background: colors.bg, borderRadius: radius.sm, marginBottom: 10, flexWrap: 'wrap',
              }}>
                <button onClick={selectAllNew} disabled={notImported.length === 0} style={{
                  background: 'none', border: `1px solid ${colors.border}`, borderRadius: 4,
                  padding: '3px 10px', fontSize: 11, fontFamily: fonts.condensed, fontWeight: 700,
                  cursor: notImported.length ? 'pointer' : 'default',
                  color: notImported.length ? colors.text : colors.textMuted,
                }}>Select all new</button>
                {selected.size > 0 && (
                  <button onClick={clearSelection} style={{
                    background: 'none', border: `1px solid ${colors.border}`, borderRadius: 4,
                    padding: '3px 10px', fontSize: 11, fontFamily: fonts.condensed, fontWeight: 700,
                    cursor: 'pointer', color: colors.textSecondary,
                  }}>Clear ({selected.size})</button>
                )}
                <div style={{ flex: 1 }} />
                {selected.size > 0 && (
                  <RedButton onClick={importSelected} style={{ padding: '4px 14px', fontSize: 12 }}>
                    Import selected ({selected.size})
                  </RedButton>
                )}
                {notImported.length > 0 && selected.size === 0 && (
                  <RedButton onClick={importAllNew} style={{ padding: '4px 14px', fontSize: 12 }}>
                    Import all new ({notImported.length})
                  </RedButton>
                )}
                {/* Bulk import — opens the pre-flight checklist modal
                    against the selected files (or all new files if none
                    selected). Hands the Drive metadata over and the
                    modal handles downloads + heuristic tagging in batch. */}
                {(selected.size > 0 || notImported.length > 0) && onBulkImport && (
                  <OutlineButton
                    onClick={() => {
                      const targets = selected.size > 0
                        ? (files || []).filter(f => selected.has(f.id))
                        : notImported;
                      if (targets.length) onBulkImport(targets);
                    }}
                    style={{ padding: '4px 14px', fontSize: 12 }}
                    title="Open bulk import preview — heuristic-tag everything, then commit in one shot"
                  >
                    📁 Bulk import ({selected.size > 0 ? selected.size : notImported.length})
                  </OutlineButton>
                )}
              </div>

              {/* File grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                {files.map(f => {
                  const isImported = importedFileIds.has(f.id);
                  const isImporting = importingIds.has(f.id);
                  const isSelected = selected.has(f.id);
                  const isVideo = (f.mimeType || '').startsWith('video/');
                  return (
                    <div key={f.id} style={{
                      border: `2px solid ${isSelected ? colors.red : isImported ? colors.success : colors.borderLight}`,
                      borderRadius: radius.base, padding: 8, background: colors.white,
                      opacity: isImporting ? 0.5 : 1,
                      display: 'flex', flexDirection: 'column', gap: 6,
                    }}>
                      <div
                        onClick={() => !isImported && toggleSelect(f.id)}
                        style={{
                          width: '100%', height: 110, borderRadius: radius.sm,
                          background: f.thumbnailLink
                            ? `url(${f.thumbnailLink}) center/cover`
                            : colors.bg,
                          position: 'relative', cursor: isImported ? 'default' : 'pointer',
                          border: `1px solid ${colors.borderLight}`,
                        }}
                      >
                        {!f.thumbnailLink && (
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>
                            {isVideo ? '🎬' : '🖼️'}
                          </div>
                        )}
                        {isVideo && f.thumbnailLink && (
                          <div style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '1px 5px', borderRadius: 3, fontSize: 9, fontFamily: fonts.condensed, fontWeight: 700 }}>▶ VIDEO</div>
                        )}
                        {isImported && (
                          <div style={{
                            position: 'absolute', top: 4, right: 4, background: colors.success, color: '#fff',
                            padding: '2px 6px', borderRadius: 3, fontSize: 9, fontFamily: fonts.condensed, fontWeight: 700,
                          }}>✓ IMPORTED</div>
                        )}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.name}>
                        {f.name}
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {!isImported ? (
                          <button onClick={() => importOne(f)} disabled={isImporting} style={{
                            flex: 1, background: colors.red, color: '#fff', border: 'none',
                            borderRadius: 4, padding: '4px 8px', fontSize: 11, fontWeight: 700,
                            cursor: isImporting ? 'default' : 'pointer',
                            fontFamily: fonts.body,
                          }}>{isImporting ? 'Importing…' : 'Import'}</button>
                        ) : (
                          <div style={{ flex: 1, fontSize: 10, color: colors.success, fontFamily: fonts.condensed, fontWeight: 700, textAlign: 'center', padding: '4px' }}>In library</div>
                        )}
                        <a href={f.webViewLink} target="_blank" rel="noopener noreferrer" style={{
                          padding: '4px 6px', fontSize: 11, color: colors.textSecondary,
                          border: `1px solid ${colors.border}`, borderRadius: 4, textDecoration: 'none',
                        }} title="Open in Drive">↗</a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Files() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  // Scope filter for the tagged file grid. 'all' is the default;
  // 'league' surfaces just BLW-wide assets so league-event content
  // is one click away regardless of which team's archive you're in.
  const [scopeFilter, setScopeFilter] = useState('all'); // all | player | team | league
  const [storedMedia, setStoredMedia] = useState([]);
  const [thumbUrls, setThumbUrls] = useState({});
  const [dragging, setDragging] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  // When bulk-importing from Drive we hand the modal the selected file
  // metadata in this seed; the modal downloads in batch and runs each
  // through the same heuristic pipeline as a local-folder drop. Cleared
  // when the modal closes.
  const [bulkDriveSeed, setBulkDriveSeed] = useState(null);
  // Lightbox preview for the post-upload Tag & rename list. Stores the
  // media id of the row whose thumbnail was clicked; null when closed.
  // Shared with the tagged-files grid as a unified preview surface so
  // both views feel the same.
  const [untaggedPreviewId, setUntaggedPreviewId] = useState(null);
  const [showTagger, setShowTagger] = useState(true);
  const [previewFile, setPreviewFile] = useState(null); // open preview modal

  // Drive folder state
  const [driveApiKey, setDriveApiKey] = useState(getApiKey());
  const [driveFolders, setDriveFolders] = useState(getSavedFolders());
  const [folderUrlInput, setFolderUrlInput] = useState('');
  const [folderAddError, setFolderAddError] = useState('');

  // Roster for Layer 1 heuristic matching
  const [roster, setRoster] = useState([]);

  // Bulk AI auto-tag progress
  const [bulkAiProgress, setBulkAiProgress] = useState(null); // { done, total, failed }

  // Cloud backup state — tracks the one-shot library sync when the user
  // clicks "Back up library to cloud". `backupProgress` shape:
  //   { stage, done, total, results } when running / done, or null when idle.
  const [backupProgress, setBackupProgress] = useState(null);
  const [backupError, setBackupError] = useState(null);
  const runBackup = useCallback(async () => {
    setBackupError(null);
    setBackupProgress({ stage: 'starting', done: 0, total: 0 });
    try {
      const results = await backupLibraryToCloud({
        onProgress: (p) => setBackupProgress(p),
      });
      setBackupProgress({ stage: 'done', results });
      const totalOk = Object.values(results).reduce((s, k) => s + (k.ok || 0), 0);
      const totalFail = Object.values(results).reduce((s, k) => s + (k.fail || 0), 0);
      if (totalFail === 0) {
        toast.success('Backup complete', { detail: `${totalOk} records mirrored to Supabase` });
      } else {
        toast.warn(`Backup finished with ${totalFail} failures`, { detail: `${totalOk} records uploaded; see summary below` });
      }
    } catch (err) {
      setBackupError(err.message || 'Backup failed');
      setBackupProgress(null);
      toast.error('Backup failed', { detail: err.message?.slice(0, 80) });
    }
  }, [toast]);

  // Manual "pull fresh from cloud" — same call as the throttled auto-hydrate
  // on app mount but with force:true so it runs even if we ran one <10 min ago.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshReport, setRefreshReport] = useState(null);

  // Bulk-select state — toggling select mode reveals a checkbox per tile.
  // Tiles gain a border when selected; the click target swaps from "preview"
  // to "toggle selection" while we're in select mode.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const toggleSelection = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clearBulkSelection = useCallback(() => setSelectedIds(new Set()), []);
  const exitSelectMode = useCallback(() => { setSelectMode(false); clearBulkSelection(); }, [clearBulkSelection]);

  // Storage meter — fetched alongside the backup banner when cloud is on.
  // Nullable while loading; `{ error }` if the endpoint 500s.
  const [usage, setUsage] = useState(null);
  useEffect(() => {
    if (!supabaseConfigured) return;
    // Phase 5c: cloud-usage now requires an admin/content JWT. Athletes
    // shouldn't be reaching the Files page anyway (role-gated at the route
    // level), but authedFetch handles the token plumbing.
    authedFetch('/api/cloud-usage')
      .then(r => r.ok ? r.json() : r.json().then(j => { throw new Error(j.error || 'usage fetch failed'); }))
      .then(setUsage)
      .catch(err => setUsage({ error: err.message }));
  }, [backupProgress?.stage]); // re-fetch after a successful backup

  const runRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshReport(null);
    try {
      const report = await refreshFromCloud({ force: true });
      setRefreshReport(report);
      // Nudge the stored media list — refreshFromCloud put new records
      // into IDB, but this page read into `storedMedia` state on mount.
      // Re-reading is the simplest way to surface any new arrivals.
      const media = await getAllMedia();
      setStoredMedia(media);
      const urls = {};
      media.forEach(m => { if (m.blob) urls[m.id] = blobToObjectURL(m.blob); });
      setThumbUrls(urls);
    } catch (err) {
      setRefreshReport({ error: err.message });
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshReport(null), 6000);
    }
  }, []);

  useEffect(() => {
    // Preload the full player directory once for heuristic matching. We pull
    // firstName/firstInitial so the heuristic can detect same-lastname
    // collisions and ask for the first initial.
    getAllPlayersDirectory().then(list => {
      setRoster(list.map(p => ({
        team: p.team,
        firstName: p.firstName || '',
        firstInitial: p.firstInitial || (p.firstName || '').charAt(0).toUpperCase(),
        lastName: p.lastName,
        num: p.num || '',
      })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    getAllMedia().then(media => {
      setStoredMedia(media);
      const urls = {};
      media.forEach(m => { if (m.blob) urls[m.id] = blobToObjectURL(m.blob); });
      setThumbUrls(urls);
    });
  }, []);

  const untagged = storedMedia.filter(m => !isProperlyNamed(m.name));
  const tagged = storedMedia.filter(m => isProperlyNamed(m.name));

  // Set of Drive file IDs already imported — so we can show "already in library" badges
  const importedFileIds = useMemo(() => {
    const s = new Set();
    storedMedia.forEach(m => { if (m.driveFileId) s.add(m.driveFileId); });
    return s;
  }, [storedMedia]);

  const allDisplayFiles = tagged.map(m => ({
    id: m.id, name: m.name, team: m.team, type: m.assetType,
    source: m.source || 'local',
    size: m.blob ? `${(m.blob.size / 1024 / 1024).toFixed(1)} MB` : '',
    thumbUrl: thumbUrls[m.id],
    // Scope inferred at read time so legacy records (no scope field
    // before this feature shipped) bucket correctly. Reads the team
    // code so BLW_* records land in 'league' even retroactively.
    scope: m.scope || (m.team === LEAGUE_TEAM_CODE ? 'league'
      : (TEAM_SCOPE_TYPES.has(m.assetType) ? 'team' : 'player')),
  }));

  const filtered = allDisplayFiles.filter(f => {
    if (scopeFilter !== 'all' && f.scope !== scopeFilter) return false;
    if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const scopeCounts = {
    all:     allDisplayFiles.length,
    player:  allDisplayFiles.filter(f => f.scope === 'player').length,
    team:    allDisplayFiles.filter(f => f.scope === 'team').length,
    league:  allDisplayFiles.filter(f => f.scope === 'league').length,
  };

  const handleFiles = useCallback(async (fileList) => {
    const compressOn = getCompressPreference();
    let totalOriginal = 0, totalFinal = 0, savedFiles = 0;
    for (const file of fileList) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;
      // Compress images on the way in. Videos and pass-through types
      // (SVG, GIF) come back unchanged — see image-compress.js for the
      // skip rules. The user can flip the preference off in Settings if
      // they want to archive originals.
      let blobToSave = file;
      let width = 0, height = 0;
      if (compressOn && file.type.startsWith('image/')) {
        try {
          const result = await compressImageBlob(file);
          blobToSave = result.blob;
          width = result.width;
          height = result.height;
          totalOriginal += result.originalBytes;
          totalFinal += result.finalBytes;
          if (result.finalBytes < result.originalBytes) savedFiles++;
        } catch {
          // Compression failed — fall back to the original so upload still succeeds.
          blobToSave = file;
        }
      }
      const record = await saveMedia({ name: file.name, blob: blobToSave, width, height });
      const url = blobToObjectURL(blobToSave);
      setStoredMedia(prev => [record, ...prev]);
      setThumbUrls(prev => ({ ...prev, [record.id]: url }));
    }
    if (savedFiles > 0) {
      const saved = totalOriginal - totalFinal;
      const fmt = (n) => n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / (1024 ** 2)).toFixed(1)} MB`;
      const pct = Math.round((1 - totalFinal / totalOriginal) * 100);
      toast.success(`Compressed ${savedFiles} file${savedFiles === 1 ? '' : 's'} — saved ${fmt(saved)} (${pct}%)`);
    }
  }, [toast]);

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    handleFiles(Array.from(e.dataTransfer.files));
  }, [handleFiles]);

  const handleFileInput = useCallback((e) => {
    handleFiles(Array.from(e.target.files));
    e.target.value = '';
  }, [handleFiles]);

  const handleRename = useCallback(async (id, newName) => {
    const updated = await updateMedia(id, { name: newName });
    setStoredMedia(prev => prev.map(m => m.id === id ? updated : m));
    return updated;
  }, []);

  // Bulk delete — snapshot each record first so a single Undo toast can
  // restore the whole batch in one click. Fires deletions sequentially so
  // IDB + cloud-sync queues don't thunder.
  const bulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const snapshots = ids.map(id => storedMedia.find(m => m.id === id)).filter(Boolean);
    if (snapshots.length === 0) return;
    for (const id of ids) {
      try { await deleteMedia(id); } catch {}
    }
    setStoredMedia(prev => prev.filter(m => !selectedIds.has(m.id)));
    setThumbUrls(prev => {
      const n = { ...prev };
      for (const id of ids) { if (n[id]) URL.revokeObjectURL(n[id]); delete n[id]; }
      return n;
    });
    clearBulkSelection();
    setSelectMode(false);
    toast.info(`Deleted ${snapshots.length} file${snapshots.length === 1 ? '' : 's'}`, {
      duration: 10000,
      action: {
        label: 'UNDO ALL',
        onClick: async () => {
          const restored = [];
          for (const s of snapshots) {
            try {
              const r = await saveMedia({
                name: s.name, blob: s.blob, width: s.width, height: s.height, source: s.source || 'local',
              });
              restored.push(r);
            } catch {}
          }
          setStoredMedia(prev => [...restored, ...prev]);
          setThumbUrls(prev => {
            const n = { ...prev };
            for (const r of restored) { if (r.blob) n[r.id] = blobToObjectURL(r.blob); }
            return n;
          });
          toast.success(`Restored ${restored.length} file${restored.length === 1 ? '' : 's'}`);
        },
      },
    });
  }, [selectedIds, storedMedia, clearBulkSelection, toast]);

  const handleDelete = useCallback(async (id) => {
    // Snapshot the record before deleting so Undo can restore it. The blob
    // is preserved in memory — if the user doesn't undo within the toast's
    // lifetime, it's garbage-collected along with the closure.
    const snapshot = storedMedia.find(m => m.id === id);
    await deleteMedia(id);
    setStoredMedia(prev => prev.filter(m => m.id !== id));
    if (thumbUrls[id]) URL.revokeObjectURL(thumbUrls[id]);
    setThumbUrls(prev => { const n = { ...prev }; delete n[id]; return n; });

    if (snapshot) {
      toast.info(`Deleted ${snapshot.name}`, {
        duration: 8000,
        action: {
          label: 'UNDO',
          onClick: async () => {
            try {
              // saveMedia generates a new id — that's OK, the intent is "make
              // it come back", we don't need identity preservation.
              const restored = await saveMedia({
                name: snapshot.name,
                blob: snapshot.blob,
                width: snapshot.width,
                height: snapshot.height,
                source: snapshot.source || 'local',
              });
              setStoredMedia(prev => [restored, ...prev]);
              if (restored.blob) {
                setThumbUrls(prev => ({ ...prev, [restored.id]: blobToObjectURL(restored.blob) }));
              }
              toast.success('Restored');
            } catch (err) {
              toast.error('Couldn\'t restore', { detail: err.message });
            }
          },
        },
      });
    }
  }, [storedMedia, thumbUrls, toast]);

  // ─── AI auto-tag — single file + bulk ─────────────────────────────────────
  // The parent owns the AI calls so we can reliably know when each finishes
  // and pace the bulk run. Results flow into TagRows via the `tagHints` map.
  const [tagHints, setTagHints] = useState({}); // fileId → AI result or { error }
  const [aiBusyIds, setAiBusyIds] = useState(new Set());

  const runAiForFile = useCallback(async (fileId) => {
    const record = storedMedia.find(m => m.id === fileId);
    if (!record?.blob) return { error: 'No blob available' };
    setAiBusyIds(prev => new Set(prev).add(fileId));
    try {
      const result = await autoTagBlob(record.blob);
      setTagHints(prev => ({ ...prev, [fileId]: result }));
      return result;
    } catch (err) {
      const errObj = { error: err.message || String(err) };
      setTagHints(prev => ({ ...prev, [fileId]: errObj }));
      return errObj;
    } finally {
      setAiBusyIds(prev => { const n = new Set(prev); n.delete(fileId); return n; });
    }
  }, [storedMedia]);

  const runBulkAiTag = useCallback(async () => {
    const targets = storedMedia.filter(m => !isProperlyNamed(m.name) && m.blob);
    if (targets.length === 0) return;
    setBulkAiProgress({ done: 0, total: targets.length, failed: 0 });
    let done = 0, failed = 0;
    for (const t of targets) {
      const result = await runAiForFile(t.id);
      done++;
      if (result?.error) failed++;
      setBulkAiProgress({ done, total: targets.length, failed });
    }
    // Keep the progress visible briefly, then clear
    setTimeout(() => setBulkAiProgress(null), 4000);
  }, [storedMedia, runAiForFile]);

  // ─── Google Drive handlers ────────────────────────────────────────────────
  const addDriveFolder = () => {
    setFolderAddError('');
    const folderId = extractFolderId(folderUrlInput);
    if (!folderId) {
      setFolderAddError('Could not find a folder ID in that URL. Paste the full "drive.google.com/drive/folders/..." share link.');
      return;
    }
    if (driveFolders.find(f => f.folderId === folderId)) {
      setFolderAddError('That folder is already added.');
      return;
    }
    const updated = saveFolder({
      folderId,
      url: folderUrlInput.trim(),
      name: `Drive Folder (${folderId.slice(0, 6)}…)`,
    });
    setDriveFolders(updated);
    setFolderUrlInput('');
  };

  const handleDriveRemove = (folderId) => {
    setDriveFolders(removeFolder(folderId));
  };

  const handleDriveRename = (folderId, newName) => {
    setDriveFolders(renameFolder(folderId, newName));
  };

  // Import a single Drive file into the local media store
  const importDriveFile = useCallback(async (file) => {
    const blob = await downloadFileAsBlob(file.id);
    // Preserve filename so the existing naming-convention parser still works
    const record = await saveMedia({
      name: file.name,
      blob,
      width: file.imageMediaMetadata?.width || 0,
      height: file.imageMediaMetadata?.height || 0,
      driveFileId: file.id,
      source: 'gdrive',
    });
    const url = blobToObjectURL(blob);
    setStoredMedia(prev => [record, ...prev]);
    setThumbUrls(prev => ({ ...prev, [record.id]: url }));
    return record;
  }, []);

  // ─── Export library manifest ──────────────────────────────────────────────
  // Downloads a JSON manifest of every stored file's metadata (name, tags,
  // Drive source IDs, timestamps, sizes). Blobs are NOT included — the manifest
  // is a recovery MAP: Drive-imported files can be re-imported via driveFileId;
  // drag-dropped files are listed so the user knows what was there.
  const exportLibraryManifest = useCallback(() => {
    const manifest = {
      manifestVersion: 1,
      exportedAt: new Date().toISOString(),
      app: 'BLW Content Hub',
      totalFiles: storedMedia.length,
      notes: 'Drive-sourced files can be re-imported via driveFileId from the same shared folder. Drag-drop files must be re-uploaded manually.',
      files: storedMedia.map(m => ({
        id: m.id,
        name: m.name,
        team: m.team || null,
        num: m.num || null,
        firstInitial: m.firstInitial || null,
        player: m.player || null,
        assetType: m.assetType || null,
        scope: m.scope || null,
        variant: m.variant || null,
        source: m.source || 'local',
        driveFileId: m.driveFileId || null,
        width: m.width || 0,
        height: m.height || 0,
        sizeBytes: m.blob ? m.blob.size : null,
        createdAt: m.createdAt || null,
      })),
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blw-library-manifest-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [storedMedia]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="FILES" subtitle="Upload, tag, and manage team media assets — files persist in your browser">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: fonts.body, fontSize: 13, color: colors.success, fontWeight: 600 }}>
            {storedMedia.length} stored
          </span>
          {untagged.length > 0 && (
            <span style={{ fontFamily: fonts.body, fontSize: 13, color: colors.warning, fontWeight: 600 }}>
              {untagged.length} untagged
            </span>
          )}
          <OutlineButton
            onClick={exportLibraryManifest}
            disabled={storedMedia.length === 0}
            style={{ padding: '6px 12px', fontSize: 12 }}
          >
            ⬇ Export manifest
          </OutlineButton>
        </div>
      </PageHeader>

      {/* Cloud storage banner — the tone shifts based on whether Supabase
          is configured and whether a backup is running. */}
      {supabaseConfigured ? (
        <Card style={{
          border: `1px solid rgba(14,165,233,0.35)`,
          background: 'rgba(14,165,233,0.08)',
          display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 22, lineHeight: 1 }}>☁️</div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontFamily: fonts.body, fontSize: 14, fontWeight: 700, color: '#075985', marginBottom: 2 }}>
              Cloud backup is available
            </div>
            <div style={{ fontSize: 13, color: '#075985', lineHeight: 1.5 }}>
              New uploads are already syncing to the cloud automatically. Click the button to back up everything
              already in this browser — media, overlays, effects, requests, and settings. You can rerun this any
              time; it's idempotent.
            </div>
            {/* Storage meter — visible-at-a-glance sense of how much headroom
                you have against Supabase's plan storage limit (currently
                Pro: 100 GB). The cap value comes from /api/cloud-usage so
                a future plan change is one constant edit, no UI work. */}
            {usage && !usage.error && usage.storage && (() => {
              const used = usage.storage.total.bytes;
              const cap = usage.limits?.storageBytes || (1024 ** 3);
              const pct = Math.min(100, Math.round((used / cap) * 100));
              const fmt = (n) => n < 1024 ? `${n} B`
                : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB`
                : n < 1024 ** 3 ? `${(n / (1024 ** 2)).toFixed(1)} MB`
                : `${(n / (1024 ** 3)).toFixed(2)} GB`;
              const barColor = pct >= 90 ? '#DC2626' : pct >= 70 ? '#F59E0B' : '#0EA5E9';
              return (
                <div style={{ marginTop: 10, fontSize: 11, fontFamily: fonts.condensed, color: '#075985' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>
                      CLOUD STORAGE · {usage.storage.total.count} files
                    </span>
                    <span style={{ fontWeight: 700 }}>
                      {fmt(used)} / {fmt(cap)} <span style={{ opacity: 0.7 }}>({pct}%)</span>
                    </span>
                  </div>
                  <div style={{
                    width: '100%', height: 6, background: 'rgba(14,165,233,0.12)',
                    borderRadius: 999, overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${Math.max(pct, 1)}%`, height: '100%',
                      background: barColor, transition: 'width 0.3s ease',
                    }} />
                  </div>
                  <div style={{ marginTop: 3, opacity: 0.7, fontSize: 10 }}>
                    {Object.entries(usage.tables || {}).filter(([k]) => ['media','requests','request_comments','manual_players'].includes(k)).map(([k, v]) =>
                      `${k.replace('_',' ')}: ${v.rows ?? '—'}`
                    ).join(' · ')}
                  </div>
                </div>
              );
            })()}
            {usage?.byTeam && Object.keys(usage.byTeam).length > 0 && (
              <PerTeamBreakdown byTeam={usage.byTeam} />
            )}
            <CompressionToggle />
            {usage?.error && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#991B1B' }}>
                Couldn't load usage meter: {usage.error}
              </div>
            )}
            {backupProgress?.stage === 'done' && backupProgress.results && (() => {
              const r = backupProgress.results;
              const totalFail = Object.values(r).reduce((s, k) => s + (k.fail || 0), 0);
              const totalSkipped = (r.media.skipped || 0) + (r.overlays.skipped || 0) + (r.effects.skipped || 0);
              // Per-kind summary helper. For blob kinds we include the
              // "skipped because already uploaded" count so it's clear that
              // a "0/0" reading means "everything was already in the cloud",
              // not "nothing happened".
              const blobSummary = (kind, label) => {
                const k = r[kind];
                const totalAttempted = (k.ok || 0) + (k.fail || 0);
                const skipped = k.skipped || 0;
                const totalSeen = totalAttempted + skipped;
                if (totalSeen === 0) return `${label}: —`;
                const skipPart = skipped > 0 ? ` (+${skipped} already in cloud)` : '';
                return `${label}: ${k.ok}/${totalAttempted}${skipPart}`;
              };
              return (
                <div style={{
                  marginTop: 8, padding: 10,
                  background: totalFail === 0 ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                  border: `1px solid ${totalFail === 0 ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.35)'}`,
                  borderRadius: radius.sm,
                  fontSize: 12, color: totalFail === 0 ? '#15803D' : '#92400E',
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    {totalFail === 0 ? '✓ Backup complete' : '⚠ Backup finished with some failures'}
                    {totalSkipped > 0 && (
                      <span style={{ fontWeight: 400, fontFamily: fonts.condensed, marginLeft: 8, opacity: 0.85 }}>
                        · {totalSkipped} already in cloud, skipped
                      </span>
                    )}
                  </div>
                  <div style={{ fontFamily: fonts.condensed, fontSize: 11, letterSpacing: 0.3 }}>
                    {blobSummary('media', 'Media')} · {blobSummary('overlays', 'Overlays')} ·
                    {' '}{blobSummary('effects', 'Effects')} · Requests: {r.requests.ok}/{r.requests.ok + r.requests.fail} ·
                    Comments: {r.comments.ok}/{r.comments.ok + r.comments.fail} · Players: {r.manualPlayers.ok}/{r.manualPlayers.ok + r.manualPlayers.fail} ·
                    Layout: {r.fieldOverrides.ok}/{r.fieldOverrides.ok + r.fieldOverrides.fail}
                  </div>
                </div>
              );
            })()}
            {backupProgress && backupProgress.stage !== 'done' && backupProgress.stage !== 'starting' && (
              <div style={{ marginTop: 8, fontFamily: fonts.condensed, fontSize: 11, color: '#075985' }}>
                Uploading {backupProgress.stage}… {backupProgress.done || 0}/{backupProgress.total || 0}
                {backupProgress.skipped > 0 && (
                  <span style={{ opacity: 0.7 }}> ({backupProgress.skipped} already in cloud, skipped)</span>
                )}
                {backupProgress.record && <span style={{ opacity: 0.7 }}> — {backupProgress.record}</span>}
              </div>
            )}
            {backupError && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>
                Error: {backupError}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
            <RedButton
              onClick={runBackup}
              disabled={!!backupProgress && backupProgress.stage !== 'done'}
              style={{ padding: '8px 16px', fontSize: 12 }}
            >
              {backupProgress && backupProgress.stage !== 'done' ? 'Backing up…' : '☁ Back up library to cloud'}
            </RedButton>
            <OutlineButton
              onClick={runRefresh}
              disabled={refreshing}
              title="Force-pull the latest records from Supabase now (bypasses the 10-min throttle)"
              style={{ padding: '6px 12px', fontSize: 11 }}
            >
              {refreshing ? '↻ Refreshing…' : '↻ Refresh from cloud'}
            </OutlineButton>
            {refreshReport && !refreshReport.error && (
              <div style={{ fontSize: 10, color: '#075985', fontFamily: fonts.condensed, textAlign: 'center' }}>
                Media +{refreshReport.media?.newBlobs || 0} · Requests {refreshReport.requests?.fetched || 0}
              </div>
            )}
            {refreshReport?.error && (
              <div style={{ fontSize: 10, color: '#991B1B', textAlign: 'center' }}>
                Refresh failed: {refreshReport.error}
              </div>
            )}
          </div>
        </Card>
      ) : (
        <Card style={{
          border: `1px solid ${colors.warningBorder}`,
          background: colors.warningBg,
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ fontSize: 22, lineHeight: 1 }}>⚠️</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: fonts.body, fontSize: 14, fontWeight: 700, color: '#92400E', marginBottom: 2 }}>
              Files are currently stored in your browser
            </div>
            <div style={{ fontSize: 13, color: '#92400E', lineHeight: 1.5 }}>
              Supabase isn't configured for this deployment yet, so files live only in this browser.
              Use <strong>Export manifest</strong> above to back up your file metadata in the meantime.
            </div>
          </div>
        </Card>
      )}

      {/* Upload Zone */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'stretch' }}>
        <label style={{ cursor: 'pointer' }}>
          <input type="file" multiple accept="image/*,video/*" onChange={handleFileInput} style={{ display: 'none' }} />
          <div onDrop={handleDrop} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} style={{
            border: `2px dashed ${dragging ? colors.red : colors.border}`,
            borderRadius: radius.lg, padding: 32, textAlign: 'center',
            background: dragging ? colors.redLight : colors.white, transition: 'all 0.2s',
            height: '100%',
          }}>
            <div style={{ fontSize: 32, marginBottom: 6, opacity: 0.4 }}>📂</div>
            <div style={{ fontFamily: fonts.body, fontSize: 16, fontWeight: 700, color: colors.text }}>
              {dragging ? 'Drop files here' : 'Drag & drop files'}
            </div>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4 }}>
              or click to browse · Upload with any filename — tag and rename below
            </div>
          </div>
        </label>
        {/* Bulk import — drag a folder, eyeball a checklist, commit. */}
        <button onClick={() => setBulkOpen(true)} style={{
          padding: '24px 20px', borderRadius: radius.lg,
          background: colors.white, color: colors.text,
          border: `2px solid ${colors.border}`, cursor: 'pointer',
          textAlign: 'center', minWidth: 180,
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = colors.red; e.currentTarget.style.color = colors.red; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.color = colors.text; }}
        >
          <div style={{ fontSize: 28, marginBottom: 6, opacity: 0.4 }}>📁</div>
          <div style={{ fontFamily: fonts.body, fontSize: 14, fontWeight: 700 }}>Bulk import folder</div>
          <div style={{ fontSize: 10, marginTop: 4, fontFamily: fonts.condensed, letterSpacing: 0.4, textTransform: 'uppercase', opacity: 0.7 }}>
            Pre-flight check + batch commit
          </div>
        </button>
      </div>
      <BulkImportModal
        open={bulkOpen}
        onClose={() => { setBulkOpen(false); setBulkDriveSeed(null); }}
        roster={roster}
        driveSeed={bulkDriveSeed}
        onImported={(records) => {
          // Mirror handleFiles' state update so the freshly imported
          // files appear immediately without waiting for a re-mount.
          if (!records?.length) return;
          setStoredMedia(prev => [...records, ...prev]);
          const urls = {};
          records.forEach(r => { if (r.blob) urls[r.id] = blobToObjectURL(r.blob); });
          setThumbUrls(prev => ({ ...prev, ...urls }));
        }}
      />

      {/* UNTAGGED FILES — Bulk Tagger */}
      {untagged.length > 0 && (
        <Card style={{ border: `1px solid ${colors.warningBorder}`, background: colors.warningBg }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <SectionHeading style={{ margin: 0, color: '#92400E' }}>
                Tag & rename ({untagged.length} file{untagged.length !== 1 ? 's' : ''})
              </SectionHeading>
              <div style={{ fontSize: 11, color: '#92400E', fontFamily: fonts.condensed, marginTop: 2 }}>
                Filename heuristics auto-fill rows on load · click ✨ to AI-tag one · or use "AI-tag all" below
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {bulkAiProgress && (
                <span style={{ fontSize: 11, fontFamily: fonts.condensed, color: '#92400E', fontWeight: 700 }}>
                  {bulkAiProgress.done}/{bulkAiProgress.total}
                  {bulkAiProgress.failed > 0 && ` · ${bulkAiProgress.failed} failed`}
                </span>
              )}
              <button
                onClick={runBulkAiTag}
                disabled={!!bulkAiProgress}
                title="Run Claude vision AI on every untagged file"
                style={{
                  background: bulkAiProgress ? colors.border : '#EEF2FF',
                  color: bulkAiProgress ? colors.textMuted : '#4F46E5',
                  border: `1px solid ${bulkAiProgress ? colors.border : '#C7D2FE'}`,
                  borderRadius: radius.sm, padding: '4px 12px',
                  fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                  cursor: bulkAiProgress ? 'default' : 'pointer',
                }}
              >
                {bulkAiProgress ? `AI-tagging…` : `✨ AI-tag all (${untagged.length})`}
              </button>
              <button onClick={() => setShowTagger(!showTagger)} style={{
                background: 'none', border: `1px solid ${colors.warningBorder}`,
                color: '#92400E', borderRadius: radius.sm, padding: '4px 12px',
                fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}>{showTagger ? 'Hide' : 'Show'}</button>
            </div>
          </div>

          {showTagger && (
            <div style={{ background: colors.white, borderRadius: radius.base, padding: 10, border: `1px solid ${colors.border}` }}>
              <div style={{ display: 'flex', gap: 8, padding: '4px 10px 8px', fontSize: 9, fontFamily: fonts.condensed, color: colors.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>
                <div style={{ width: 48 }} />
                <div style={{ width: 160 }}>Original</div>
                <div style={{ width: 90 }}>Scope</div>
                <div style={{ width: 80 }}>Team</div>
                <div style={{ width: 186 }}>Player (# · F · Lastname) / Variant</div>
                <div style={{ width: 130 }}>Asset Type</div>
                <div style={{ flex: 1 }}>New Name</div>
              </div>
              {untagged.map(file => {
                // Look up the raw blob from storedMedia so TagRow can send to /api/auto-tag
                const raw = storedMedia.find(m => m.id === file.id);
                return (
                  <TagRow
                    key={file.id}
                    file={file}
                    thumbUrl={thumbUrls[file.id]}
                    blobRef={raw?.blob}
                    roster={roster}
                    tagHint={tagHints[file.id]}
                    aiBusy={aiBusyIds.has(file.id)}
                    onUpdate={handleRename}
                    onDelete={handleDelete}
                    onRequestAiTag={runAiForFile}
                    onPreview={setUntaggedPreviewId}
                  />
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Google Drive Folder Browser */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <SectionHeading style={{ margin: 0 }}>Google Drive folders</SectionHeading>
            <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, marginTop: 2 }}>
              Browse and import from publicly-shared Drive folders. Files you import become part of your local library.
            </div>
          </div>
          {driveFolders.length > 0 && (
            <span style={{ fontFamily: fonts.condensed, fontSize: 12, color: colors.textSecondary, fontWeight: 600 }}>
              {driveFolders.length} folder{driveFolders.length === 1 ? '' : 's'} connected
            </span>
          )}
        </div>

        {!driveApiKey ? (
          <div style={{
            padding: 14, background: colors.warningBg, border: `1px solid ${colors.warningBorder}`,
            borderRadius: radius.base, fontSize: 13, color: '#92400E',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Drive API key required</div>
            <div style={{ fontSize: 12, lineHeight: 1.6 }}>
              Add a Google Drive API key in <Link to="/settings" style={{ color: colors.red, fontWeight: 700 }}>Settings</Link> to
              browse and import from Drive folders. One-time setup, about 5 minutes.
            </div>
          </div>
        ) : (
          <>
            <Label>Add a Drive Folder</Label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              <input
                type="text" value={folderUrlInput}
                onChange={e => { setFolderUrlInput(e.target.value); setFolderAddError(''); }}
                onKeyDown={e => e.key === 'Enter' && addDriveFolder()}
                placeholder="https://drive.google.com/drive/folders/..."
                style={{ ...inputStyle, flex: 1 }}
              />
              <RedButton onClick={addDriveFolder} disabled={!folderUrlInput.trim()} style={{ whiteSpace: 'nowrap' }}>
                Add Folder
              </RedButton>
            </div>
            {folderAddError && (
              <div style={{ fontSize: 11, color: '#B91C1C', marginTop: 4, marginBottom: 8 }}>{folderAddError}</div>
            )}
            <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 12 }}>
              Folder must be shared as <strong>"Anyone with the link can view"</strong> in Drive.
            </div>

            {driveFolders.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: colors.textMuted, fontSize: 13, background: colors.bg, borderRadius: radius.base }}>
                No Drive folders connected yet. Paste a folder share link above to get started.
              </div>
            )}

            {driveFolders.map(folder => (
              <DriveFolderPanel
                key={folder.folderId}
                folder={folder}
                importedFileIds={importedFileIds}
                onImport={importDriveFile}
                onRemove={handleDriveRemove}
                onRename={handleDriveRename}
                onBulkImport={(driveFiles) => {
                  setBulkDriveSeed({ driveFiles });
                  setBulkOpen(true);
                }}
              />
            ))}
          </>
        )}
      </Card>

      {/* Search + bulk-select toggle */}
      <Card style={{ padding: 14 }}>
        {/* Scope filter — All / Player / Team / League. Lets users jump
            straight to BLW-wide content (All-Star photos, championship
            shots, league branding) without filename search gymnastics. */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {[
            { id: 'all',    label: `All · ${scopeCounts.all}` },
            { id: 'player', label: `Player · ${scopeCounts.player}` },
            { id: 'team',   label: `Team · ${scopeCounts.team}` },
            { id: 'league', label: `League · ${scopeCounts.league}`, accent: true },
          ].map(t => (
            <button key={t.id} onClick={() => setScopeFilter(t.id)} style={{
              padding: '5px 12px', borderRadius: radius.sm,
              fontSize: 11, fontWeight: 700, fontFamily: fonts.condensed,
              letterSpacing: 0.4, textTransform: 'uppercase',
              background: scopeFilter === t.id ? colors.red : (t.accent ? 'rgba(220,38,38,0.06)' : colors.white),
              color: scopeFilter === t.id ? '#fff' : (t.accent ? colors.red : colors.textSecondary),
              border: `1px solid ${scopeFilter === t.id ? colors.red : (t.accent ? `${colors.red}33` : colors.border)}`,
              cursor: 'pointer',
            }}>{t.label}</button>
          ))}
        </div>
        <input type="text" placeholder="Search by filename, team, or player..." value={search}
          onChange={e => setSearch(e.target.value)} style={inputStyle} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.condensed }}>
            {filtered.length} tagged file{filtered.length !== 1 ? 's' : ''} found
          </div>
          <button
            onClick={() => { if (selectMode) exitSelectMode(); else setSelectMode(true); }}
            style={{
              background: selectMode ? colors.redLight : colors.bg,
              border: `1px solid ${selectMode ? colors.redBorder : colors.border}`,
              color: selectMode ? colors.red : colors.textSecondary,
              borderRadius: radius.sm, padding: '4px 12px',
              fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
              cursor: 'pointer',
            }}
          >
            {selectMode ? '✕ EXIT SELECT' : '☑ SELECT MULTIPLE'}
          </button>
        </div>
      </Card>

      {/* Tagged File Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {filtered.map((f) => {
          const t = getTeam(f.team);
          const isLocal = f.source === 'local';
          const isSelected = selectedIds.has(f.id);
          return (
            <Card
              key={f.id}
              onClick={() => {
                if (selectMode) { toggleSelection(f.id); return; }
                if (f.thumbUrl || f.url) setPreviewFile(f);
              }}
              style={{
                padding: 12, position: 'relative',
                cursor: selectMode ? 'pointer' : ((f.thumbUrl || f.url) ? 'pointer' : 'default'),
                outline: isSelected ? `3px solid ${colors.red}` : 'none',
                boxShadow: isSelected ? '0 0 0 4px rgba(220,38,38,0.15)' : undefined,
                transition: 'outline 0.15s',
              }}
            >
              {selectMode && (
                <div style={{
                  position: 'absolute', top: 6, left: 6,
                  width: 22, height: 22, borderRadius: '50%',
                  background: isSelected ? colors.red : 'rgba(255,255,255,0.95)',
                  border: `2px solid ${isSelected ? colors.red : colors.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 12, fontWeight: 800,
                  zIndex: 5, pointerEvents: 'none',
                }}>
                  {isSelected && '✓'}
                </div>
              )}
              <div style={{
                width: '100%', height: 100, borderRadius: radius.base, marginBottom: 8,
                background: f.thumbUrl ? `url(${f.thumbUrl}) center/cover` : t ? `linear-gradient(135deg, ${t.color}22, ${t.color}08)` : colors.bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
                border: `1px solid ${colors.borderLight}`,
              }}>
                {!f.thumbUrl && <span style={{ fontSize: 28, opacity: 0.5 }}>{typeIcons[f.type] || '📄'}</span>}
                <div style={{
                  position: 'absolute', top: 6, right: 6,
                  background: `${sourceColors[f.source]}15`, borderRadius: 4, padding: '2px 6px',
                  fontSize: 9, fontFamily: fonts.condensed, color: sourceColors[f.source], fontWeight: 700,
                }}>{sourceLabels[f.source]?.toUpperCase() || 'FILE'}</div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{f.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {f.scope === 'league' ? (
                    <span style={{
                      padding: '2px 7px', borderRadius: radius.full,
                      background: colors.redLight, color: colors.red,
                      fontFamily: fonts.condensed, fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                      border: `1px solid ${colors.red}33`,
                    }} title="League-wide asset">BLW</span>
                  ) : (
                    t && <TeamChip teamId={t.id} small withLogo />
                  )}
                  <span style={{ color: colors.textMuted, fontSize: 9, fontFamily: fonts.condensed, fontWeight: 600 }}>{f.type}</span>
                </div>
                {f.size && <span style={{ fontSize: 10, color: colors.textMuted }}>{f.size}</span>}
              </div>
              {f.url && (
                <a href={f.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{
                  display: 'block', marginTop: 8, fontSize: 11, fontWeight: 700, color: colors.red,
                  textDecoration: 'none', textAlign: 'center', padding: '4px 0', borderTop: `1px solid ${colors.divider}`,
                }}>Open in Cloud ↗</a>
              )}
              {isLocal && (
                <button onClick={e => { e.stopPropagation(); handleDelete(f.id); }} style={{
                  position: 'absolute', top: 4, left: 4, width: 20, height: 20, borderRadius: radius.full,
                  background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', cursor: 'pointer',
                  fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>✕</button>
              )}
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && untagged.length === 0 && (
        <Card style={{ textAlign: 'center', padding: 40, color: colors.textMuted }}>
          No files yet. Upload files above to get started.
        </Card>
      )}

      {/* Bulk-select floating action bar — only visible when the user has
          actually selected something. Sticks to the bottom center of the
          viewport so it stays reachable without scrolling. */}
      {selectMode && selectedIds.size > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 20, left: '50%', transform: 'translateX(-50%)',
          background: colors.text, color: '#fff',
          padding: '10px 16px', borderRadius: radius.full,
          boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
          display: 'flex', alignItems: 'center', gap: 10,
          zIndex: 150, maxWidth: 'calc(100vw - 32px)',
          fontFamily: fonts.body,
        }}>
          <span style={{ fontFamily: fonts.condensed, fontSize: 12, fontWeight: 800, letterSpacing: 0.6 }}>
            {selectedIds.size} SELECTED
          </span>
          <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.25)' }} />
          <button
            onClick={() => {
              const allIds = new Set(filtered.map(f => f.id));
              setSelectedIds(allIds);
            }}
            style={{
              background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff', padding: '4px 10px', borderRadius: radius.sm,
              fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
              cursor: 'pointer',
            }}
          >SELECT ALL ({filtered.length})</button>
          <button
            onClick={clearBulkSelection}
            style={{
              background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff', padding: '4px 10px', borderRadius: radius.sm,
              fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
              cursor: 'pointer',
            }}
          >CLEAR</button>
          <button
            onClick={() => {
              if (confirm(`Delete ${selectedIds.size} file${selectedIds.size === 1 ? '' : 's'}? You can undo right after.`)) {
                bulkDelete();
              }
            }}
            style={{
              background: colors.red, border: 'none',
              color: '#fff', padding: '6px 14px', borderRadius: radius.sm,
              fontFamily: fonts.condensed, fontSize: 12, fontWeight: 800, letterSpacing: 0.6,
              cursor: 'pointer',
            }}
          >🗑 DELETE</button>
          <button
            onClick={exitSelectMode}
            style={{
              background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.65)',
              padding: 0, cursor: 'pointer', fontSize: 16, lineHeight: 1,
              width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            title="Exit select mode"
          >✕</button>
        </div>
      )}

      {/* Lightbox preview for the Tag & rename list. Untagged rows are
          ordered as `untagged` (a derived view of storedMedia); we navigate
          within that same array so prev/next stay scoped to what's visible. */}
      {untaggedPreviewId && (() => {
        const idx = untagged.findIndex(m => m.id === untaggedPreviewId);
        const item = idx >= 0 ? untagged[idx] : null;
        if (!item) return null;
        const goPrev = () => setUntaggedPreviewId(untagged[(idx - 1 + untagged.length) % untagged.length].id);
        const goNext = () => setUntaggedPreviewId(untagged[(idx + 1) % untagged.length].id);
        const isVideo = /\.(mp4|webm|mov)$/i.test(item.name || '');
        return (
          <PreviewLightbox
            open={true}
            url={thumbUrls[item.id]}
            blob={!thumbUrls[item.id] ? item.blob : null}
            isVideo={isVideo}
            caption={item.name}
            position={`${idx + 1} / ${untagged.length}`}
            onClose={() => setUntaggedPreviewId(null)}
            onPrev={untagged.length > 1 ? goPrev : null}
            onNext={untagged.length > 1 ? goNext : null}
          />
        );
      })()}

      {/* Tagged-file preview — uses the shared PreviewLightbox so the
          tagged grid and the untagged "Tag & rename" list have identical
          UX (ESC to close, ←/→ to nav, blob fallback when thumbUrl is
          missing, etc.). The previous bespoke modal had a card whose
          background read `colors.white` — fine in light mode, dark navy
          in dark mode — which made the modal disappear visually against
          the rgba(0,0,0,0.85) backdrop. PreviewLightbox uses opaque
          dark chrome and an actions slot for the Download CTA. */}
      {previewFile && (() => {
        const idx = filtered.findIndex(f => f.id === previewFile.id);
        const item = idx >= 0 ? filtered[idx] : previewFile;
        const fallbackBlob = storedMedia.find(m => m.id === item.id)?.blob || null;
        const isVideo = /\.(mp4|webm|mov)$/i.test(item.name || '');
        const goPrev = filtered.length > 1
          ? () => setPreviewFile(filtered[(idx - 1 + filtered.length) % filtered.length])
          : null;
        const goNext = filtered.length > 1
          ? () => setPreviewFile(filtered[(idx + 1) % filtered.length])
          : null;
        const t = getTeam(item.team);
        const captionMeta = [
          item.name,
          t ? t.name : item.team,
          item.type,
          item.size,
          sourceLabels[item.source],
        ].filter(Boolean).join(' · ');
        return (
          <PreviewLightbox
            open
            url={item.thumbUrl}
            blob={!item.thumbUrl ? fallbackBlob : null}
            isVideo={isVideo}
            caption={captionMeta}
            position={filtered.length > 1 && idx >= 0 ? `${idx + 1} / ${filtered.length}` : ''}
            onClose={() => setPreviewFile(null)}
            onPrev={goPrev}
            onNext={goNext}
            actions={item.thumbUrl ? (
              <a
                href={item.thumbUrl}
                download={item.name}
                style={{
                  background: colors.red, color: '#fff',
                  border: '1px solid rgba(255,255,255,0.4)',
                  borderRadius: radius.sm, padding: '4px 10px',
                  fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
                  letterSpacing: 0.5, textTransform: 'uppercase',
                  textDecoration: 'none', whiteSpace: 'nowrap',
                }}
              >⬇ Download</a>
            ) : null}
          />
        );
      })()}
    </div>
  );
}

// Per-team storage chart for the Files page. Shows each BLW team as a
// row with its file count, used bytes, and a horizontal bar normalized
// to whichever team is using the most space. Helps spot which team's
// archive is bloated (oversized originals, duplicates) at a glance.
function PerTeamBreakdown({ byTeam }) {
  const fmt = (n) => n < 1024 ? `${n} B`
    : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB`
    : n < 1024 ** 3 ? `${(n / (1024 ** 2)).toFixed(1)} MB`
    : `${(n / (1024 ** 3)).toFixed(2)} GB`;
  // Sort by bytes descending, drop the OTHER bucket to the bottom.
  // Sort: BLW (league) first as the league-wide bucket, teams by bytes
  // descending, then OTHER at the bottom for legacy/unparsed names.
  const entries = Object.entries(byTeam).sort((a, b) => {
    if (a[0] === 'BLW') return -1;
    if (b[0] === 'BLW') return 1;
    if (a[0] === 'OTHER') return 1;
    if (b[0] === 'OTHER') return -1;
    return b[1].bytes - a[1].bytes;
  });
  const max = Math.max(1, ...entries.map(([, v]) => v.bytes));
  return (
    <div style={{
      marginTop: 12, padding: 10,
      background: 'rgba(14,165,233,0.06)',
      border: '1px solid rgba(14,165,233,0.18)',
      borderRadius: radius.sm, fontSize: 11, fontFamily: fonts.condensed, color: '#075985',
    }}>
      <div style={{ fontWeight: 700, letterSpacing: 0.5, marginBottom: 6 }}>
        BREAKDOWN BY TEAM · MEDIA BUCKET
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {entries.map(([team, v]) => {
          const t = getTeam(team);
          const pct = (v.bytes / max) * 100;
          const isLeague = team === 'BLW';
          const label = isLeague ? 'League-wide (BLW)'
            : t ? t.name
            : (team === 'OTHER' ? 'Unparsed / legacy' : team);
          const barColor = isLeague ? colors.red
            : t?.color || '#0EA5E9';
          return (
            <div key={team} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 80px 60px', gap: 8, alignItems: 'center' }} title={label}>
              <span style={{ fontWeight: 700, color: barColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {team}
              </span>
              <div style={{ height: 6, background: 'rgba(14,165,233,0.10)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.max(pct, 2)}%`, height: '100%',
                  background: barColor,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <span style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(v.bytes)}</span>
              <span style={{ textAlign: 'right', opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{v.count} {v.count === 1 ? 'file' : 'files'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compression preference toggle. ON by default (recommended for almost
// everyone). Surfaces in the storage card so it's discoverable right
// where the consequences (used bytes) are visible.
function CompressionToggle() {
  const [on, setOn] = useState(getCompressPreference());
  const flip = () => {
    const next = !on;
    setOn(next);
    setCompressPreference(next);
  };
  return (
    <div style={{
      marginTop: 10, padding: '8px 10px',
      background: on ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.10)',
      border: `1px solid ${on ? 'rgba(34,197,94,0.30)' : 'rgba(245,158,11,0.35)'}`,
      borderRadius: radius.sm,
      fontSize: 11, fontFamily: fonts.condensed,
      color: on ? '#15803D' : '#92400E',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
    }}>
      <span>
        <strong style={{ letterSpacing: 0.5 }}>AUTO-COMPRESSION</strong>{' '}
        {on
          ? 'on · resizing images to ≤1920 px and re-encoding @ 85% on upload'
          : 'OFF · uploading originals — fine for archival, will eat storage'}
      </span>
      <button onClick={flip} style={{
        padding: '4px 10px', borderRadius: radius.sm,
        background: 'transparent', color: 'inherit',
        border: '1px solid currentColor', cursor: 'pointer',
        fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
        fontFamily: 'inherit',
      }}>
        Turn {on ? 'off' : 'on'}
      </button>
    </div>
  );
}
