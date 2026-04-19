import { useState, useCallback, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { TEAMS, getTeam } from '../data';
import { Card, PageHeader, SectionHeading, Label, RedButton, OutlineButton, TeamChip, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { saveMedia, getAllMedia, deleteMedia, updateMedia, blobToObjectURL } from '../media-store';
import {
  getApiKey, getSavedFolders, saveFolder, removeFolder, renameFolder,
  extractFolderId, listFolderFiles, downloadFileAsBlob,
} from '../drive-api';

const ASSET_TYPES = ['HEADSHOT', 'ACTION', 'ACTION2', 'PORTRAIT', 'HIGHLIGHT', 'HIGHLIGHT2', 'INTERVIEW', 'LOGO_PRIMARY', 'LOGO_DARK', 'LOGO_LIGHT', 'LOGO_ICON', 'WORDMARK', 'TEAMPHOTO', 'VENUE'];
const typeIcons = { HEADSHOT: '👤', ACTION: '📸', ACTION2: '📸', HIGHLIGHT: '🎬', HIGHLIGHT2: '🎬', LOGO_PRIMARY: '🎨', LOGO_DARK: '🎨', LOGO_LIGHT: '🎨', LOGO_ICON: '🎨', PORTRAIT: '🖼️', INTERVIEW: '🎤', WORDMARK: '✏️', TEAMPHOTO: '👥', VENUE: '🏟️', FILE: '📄', LINK: '🔗' };
const sourceLabels = { local: 'Local', gdrive: 'Google Drive' };
const sourceColors = { local: colors.red, gdrive: '#34A853' };

// Check if file follows naming convention: at least TEAM_##_LASTNAME_TYPE
function isProperlyNamed(name) {
  const parts = name.replace(/\.[^.]+$/, '').split('_');
  if (parts.length < 4) return false;
  const teamMatch = TEAMS.some(t => t.id === parts[0].toUpperCase());
  const numMatch = /^\d{2}$/.test(parts[1]);
  return teamMatch && numMatch;
}

function TagRow({ file, thumbUrl, onUpdate, onDelete }) {
  const [tagTeam, setTagTeam] = useState('');
  const [tagNum, setTagNum] = useState('');
  const [tagName, setTagName] = useState('');
  const [tagType, setTagType] = useState('HEADSHOT');
  const [saving, setSaving] = useState(false);

  const ext = file.name.split('.').pop() || 'png';
  const preview = tagTeam && tagNum && tagName
    ? `${tagTeam}_${tagNum.padStart(2, '0')}_${tagName.toUpperCase()}_${tagType}.${ext}`
    : null;

  const apply = async () => {
    if (!preview) return;
    setSaving(true);
    const updated = await onUpdate(file.id, preview);
    setSaving(false);
  };

  const compact = { fontSize: 12, padding: '5px 8px', fontFamily: fonts.body };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
      background: colors.white, border: `1px solid ${colors.border}`,
      borderRadius: radius.base, marginBottom: 6,
    }}>
      {/* Thumbnail */}
      <div style={{
        width: 48, height: 48, borderRadius: radius.sm, flexShrink: 0,
        background: thumbUrl ? `url(${thumbUrl}) center/cover` : colors.bg,
        border: `1px solid ${colors.borderLight}`,
      }} />

      {/* Original name */}
      <div style={{ minWidth: 120, maxWidth: 160, flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.condensed, marginBottom: 2 }}>ORIGINAL</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
      </div>

      {/* Tag inputs */}
      <select value={tagTeam} onChange={e => setTagTeam(e.target.value)} style={{ ...selectStyle, ...compact, width: 80 }}>
        <option value="">Team</option>
        {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
      </select>

      <input type="text" value={tagNum} onChange={e => setTagNum(e.target.value.replace(/\D/g, '').slice(0, 2))}
        placeholder="##" maxLength={2} style={{ ...inputStyle, ...compact, width: 44, textAlign: 'center' }} />

      <input type="text" value={tagName} onChange={e => setTagName(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
        placeholder="LASTNAME" style={{ ...inputStyle, ...compact, width: 100 }} />

      <select value={tagType} onChange={e => setTagType(e.target.value)} style={{ ...selectStyle, ...compact, width: 110 }}>
        {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      {/* Preview + Apply */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {preview && (
          <div style={{ fontSize: 10, color: colors.success, fontFamily: fonts.condensed, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            → {preview}
          </div>
        )}
      </div>

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
function DriveFolderPanel({ folder, importedFileIds, onImport, onRemove, onRename }) {
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

export default function Files({ teamFilter }) {
  const [search, setSearch] = useState('');
  const [storedMedia, setStoredMedia] = useState([]);
  const [thumbUrls, setThumbUrls] = useState({});
  const [dragging, setDragging] = useState(false);
  const [showTagger, setShowTagger] = useState(true);
  const [previewFile, setPreviewFile] = useState(null); // open preview modal

  // Drive folder state
  const [driveApiKey, setDriveApiKey] = useState(getApiKey());
  const [driveFolders, setDriveFolders] = useState(getSavedFolders());
  const [folderUrlInput, setFolderUrlInput] = useState('');
  const [folderAddError, setFolderAddError] = useState('');

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
  }));

  const filtered = allDisplayFiles.filter(f => {
    if (teamFilter !== 'ALL' && f.team !== teamFilter && f.team !== 'BLW') return false;
    if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleFiles = useCallback(async (fileList) => {
    for (const file of fileList) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;
      const record = await saveMedia({ name: file.name, blob: file, width: 0, height: 0 });
      const url = blobToObjectURL(file);
      setStoredMedia(prev => [record, ...prev]);
      setThumbUrls(prev => ({ ...prev, [record.id]: url }));
    }
  }, []);

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

  const handleDelete = useCallback(async (id) => {
    await deleteMedia(id);
    setStoredMedia(prev => prev.filter(m => m.id !== id));
    if (thumbUrls[id]) URL.revokeObjectURL(thumbUrls[id]);
    setThumbUrls(prev => { const n = { ...prev }; delete n[id]; return n; });
  }, [thumbUrls]);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="FILES" subtitle="Upload, tag, and manage team media assets — files persist in your browser">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontFamily: fonts.condensed, fontSize: 12, color: colors.success, fontWeight: 600 }}>
            {storedMedia.length} stored
          </span>
          {untagged.length > 0 && (
            <span style={{ fontFamily: fonts.condensed, fontSize: 12, color: colors.warning, fontWeight: 600 }}>
              {untagged.length} untagged
            </span>
          )}
        </div>
      </PageHeader>

      {/* Upload Zone */}
      <label style={{ cursor: 'pointer' }}>
        <input type="file" multiple accept="image/*,video/*" onChange={handleFileInput} style={{ display: 'none' }} />
        <div onDrop={handleDrop} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} style={{
          border: `2px dashed ${dragging ? colors.red : colors.border}`,
          borderRadius: radius.lg, padding: 32, textAlign: 'center',
          background: dragging ? colors.redLight : colors.white, transition: 'all 0.2s',
        }}>
          <div style={{ fontSize: 32, marginBottom: 6, opacity: 0.4 }}>📂</div>
          <div style={{ fontFamily: fonts.heading, fontSize: 18, color: colors.text, letterSpacing: 1 }}>
            {dragging ? 'DROP FILES HERE' : 'DRAG & DROP FILES'}
          </div>
          <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4 }}>
            or click to browse · Upload with any filename — tag and rename below
          </div>
        </div>
      </label>

      {/* UNTAGGED FILES — Bulk Tagger */}
      {untagged.length > 0 && (
        <Card style={{ border: `1px solid ${colors.warningBorder}`, background: colors.warningBg }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <SectionHeading style={{ margin: 0, color: '#92400E' }}>
                TAG & RENAME ({untagged.length} FILE{untagged.length !== 1 ? 'S' : ''})
              </SectionHeading>
              <div style={{ fontSize: 11, color: '#92400E', fontFamily: fonts.condensed, marginTop: 2 }}>
                These files need team/player/type tags to work with the content generator
              </div>
            </div>
            <button onClick={() => setShowTagger(!showTagger)} style={{
              background: 'none', border: `1px solid ${colors.warningBorder}`,
              color: '#92400E', borderRadius: radius.sm, padding: '4px 12px',
              fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}>{showTagger ? 'Hide' : 'Show'}</button>
          </div>

          {showTagger && (
            <div style={{ background: colors.white, borderRadius: radius.base, padding: 10, border: `1px solid ${colors.border}` }}>
              <div style={{ display: 'flex', gap: 8, padding: '4px 10px 8px', fontSize: 9, fontFamily: fonts.condensed, color: colors.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>
                <div style={{ width: 48 }} />
                <div style={{ width: 140 }}>Original</div>
                <div style={{ width: 80 }}>Team</div>
                <div style={{ width: 44 }}>#</div>
                <div style={{ width: 100 }}>Last Name</div>
                <div style={{ width: 110 }}>Asset Type</div>
                <div style={{ flex: 1 }}>New Name</div>
              </div>
              {untagged.map(file => (
                <TagRow
                  key={file.id}
                  file={file}
                  thumbUrl={thumbUrls[file.id]}
                  onUpdate={handleRename}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Google Drive Folder Browser */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <SectionHeading style={{ margin: 0 }}>GOOGLE DRIVE FOLDERS</SectionHeading>
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
              />
            ))}
          </>
        )}
      </Card>

      {/* Search */}
      <Card style={{ padding: 14 }}>
        <input type="text" placeholder="Search by filename, team, or player..." value={search}
          onChange={e => setSearch(e.target.value)} style={inputStyle} />
        <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 8, fontFamily: fonts.condensed }}>
          {filtered.length} tagged file{filtered.length !== 1 ? 's' : ''} found
        </div>
      </Card>

      {/* Tagged File Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {filtered.map((f) => {
          const t = getTeam(f.team);
          const isLocal = f.source === 'local';
          return (
            <Card
              key={f.id}
              onClick={() => { if (f.thumbUrl || f.url) setPreviewFile(f); }}
              style={{ padding: 12, position: 'relative', cursor: (f.thumbUrl || f.url) ? 'pointer' : 'default' }}
            >
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
                  {t && <TeamChip teamId={t.id} small withLogo />}
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

      {/* Preview Modal */}
      {previewFile && (
        <div
          onClick={() => setPreviewFile(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: colors.white, borderRadius: radius.lg, padding: 20,
              maxWidth: 900, maxHeight: '90vh', width: '100%',
              display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: fonts.heading, fontSize: 20, color: colors.text, letterSpacing: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {previewFile.name}
                </div>
                <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, marginTop: 2 }}>
                  {(() => {
                    const t = getTeam(previewFile.team);
                    return [
                      t ? t.name : previewFile.team,
                      previewFile.type,
                      previewFile.size,
                      sourceLabels[previewFile.source],
                    ].filter(Boolean).join(' · ');
                  })()}
                </div>
              </div>
              {previewFile.thumbUrl && (
                <a
                  href={previewFile.thumbUrl}
                  download={previewFile.name}
                  style={{
                    background: colors.red, color: '#fff', padding: '10px 16px',
                    borderRadius: radius.base, fontFamily: fonts.body,
                    fontSize: 13, fontWeight: 700, textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  ⬇ Download
                </a>
              )}
              {previewFile.url && !previewFile.thumbUrl && (
                <a
                  href={previewFile.url} target="_blank" rel="noopener noreferrer"
                  style={{
                    background: colors.red, color: '#fff', padding: '10px 16px',
                    borderRadius: radius.base, fontFamily: fonts.body,
                    fontSize: 13, fontWeight: 700, textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Open in Cloud ↗
                </a>
              )}
              <button onClick={() => setPreviewFile(null)} style={{
                background: 'none', border: `1px solid ${colors.border}`,
                borderRadius: radius.base, width: 36, height: 36,
                fontSize: 18, cursor: 'pointer', color: colors.textSecondary,
              }}>✕</button>
            </div>
            <div style={{
              flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#0F1624', borderRadius: radius.base, padding: 16, overflow: 'hidden',
            }}>
              {previewFile.thumbUrl ? (
                previewFile.name.match(/\.(mp4|webm|mov)$/i) ? (
                  <video src={previewFile.thumbUrl} controls style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: radius.sm }} />
                ) : (
                  <img src={previewFile.thumbUrl} alt={previewFile.name} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: radius.sm }} />
                )
              ) : (
                <div style={{ color: 'rgba(255,255,255,0.5)', fontFamily: fonts.condensed, fontSize: 14, textAlign: 'center' }}>
                  Preview not available for this file.
                  {previewFile.url && <div style={{ marginTop: 8 }}>Click "Open in Cloud" to view.</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
