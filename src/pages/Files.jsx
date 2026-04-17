import { useState, useCallback, useEffect } from 'react';
import { TEAMS, getTeam } from '../data';
import { Card, PageHeader, SectionHeading, Label, RedButton, inputStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { saveMedia, getAllMedia, deleteMedia, blobToObjectURL } from '../media-store';

const MOCK_FILES = [
  { name: 'LAN_00_TEAM_LOGO_PRIMARY.png', team: 'LAN', type: 'LOGO', source: 'dropbox', size: '2.4 MB' },
  { name: 'LAN_01_WITTY_HEADSHOT.png', team: 'LAN', type: 'HEADSHOT', source: 'dropbox', size: '1.8 MB' },
  { name: 'LAN_01_WITTY_HIGHLIGHT.mp4', team: 'LAN', type: 'HIGHLIGHT', source: 'gdrive', size: '45 MB' },
  { name: 'LAN_03_JASO_HEADSHOT.png', team: 'LAN', type: 'HEADSHOT', source: 'dropbox', size: '1.6 MB' },
  { name: 'LAN_08_ROBLES_HEADSHOT.png', team: 'LAN', type: 'HEADSHOT', source: 'dropbox', size: '1.7 MB' },
  { name: 'AZS_00_TEAM_LOGO_PRIMARY.png', team: 'AZS', type: 'LOGO', source: 'dropbox', size: '2.1 MB' },
  { name: 'AZS_02_LEDET_HEADSHOT.png', team: 'AZS', type: 'HEADSHOT', source: 'dropbox', size: '1.9 MB' },
  { name: 'AZS_02_LEDET_ACTION.jpg', team: 'AZS', type: 'ACTION', source: 'gdrive', size: '3.2 MB' },
  { name: 'DAL_26_ROSE_HEADSHOT.png', team: 'DAL', type: 'HEADSHOT', source: 'dropbox', size: '1.5 MB' },
  { name: 'BOS_13_DALBEY_HEADSHOT.png', team: 'BOS', type: 'HEADSHOT', source: 'dropbox', size: '1.4 MB' },
  { name: 'MIA_18_HERNANDEZ_HEADSHOT.png', team: 'MIA', type: 'HEADSHOT', source: 'dropbox', size: '1.7 MB' },
  { name: 'SDO_16_ROTH_HEADSHOT.png', team: 'SDO', type: 'HEADSHOT', source: 'dropbox', size: '1.6 MB' },
  { name: 'LVS_28_STAGGS_HEADSHOT.png', team: 'LVS', type: 'HEADSHOT', source: 'dropbox', size: '1.5 MB' },
];

const typeIcons = { HEADSHOT: '👤', ACTION: '📸', HIGHLIGHT: '🎬', LOGO: '🎨', PORTRAIT: '🖼️', FILE: '📄', LINK: '🔗' };
const sourceLabels = { dropbox: 'Dropbox', gdrive: 'Google Drive', local: 'Local', link: 'Cloud Link' };
const sourceColors = { dropbox: '#0061FF', gdrive: '#34A853', local: colors.red, link: '#8B5CF6' };

export default function Files({ teamFilter }) {
  const [search, setSearch] = useState('');
  const [storedMedia, setStoredMedia] = useState([]);
  const [thumbUrls, setThumbUrls] = useState({});
  const [cloudLinks, setCloudLinks] = useState([]);
  const [linkInput, setLinkInput] = useState('');
  const [dragging, setDragging] = useState(false);

  // Load persisted media from IndexedDB on mount
  useEffect(() => {
    getAllMedia().then(media => {
      setStoredMedia(media);
      const urls = {};
      media.forEach(m => { if (m.blob) urls[m.id] = blobToObjectURL(m.blob); });
      setThumbUrls(urls);
    });
    return () => Object.values(thumbUrls).forEach(URL.revokeObjectURL);
  }, []);

  const allFiles = [
    ...storedMedia.map(m => ({
      id: m.id, name: m.name, team: m.team, type: m.assetType,
      source: 'local', size: m.blob ? `${(m.blob.size / 1024 / 1024).toFixed(1)} MB` : '',
      thumbUrl: thumbUrls[m.id],
    })),
    ...cloudLinks.map((l, i) => ({ id: `link-${i}`, name: l.name || l.url, team: 'BLW', type: 'LINK', source: 'link', url: l.url, size: '' })),
    ...MOCK_FILES.map((f, i) => ({ ...f, id: `mock-${i}` })),
  ];

  const filtered = allFiles.filter(f => {
    if (teamFilter !== 'ALL' && f.team !== teamFilter && f.team !== 'BLW') return false;
    if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;
      const record = await saveMedia({
        name: file.name,
        blob: file,
        width: 0,
        height: 0,
      });
      const url = blobToObjectURL(file);
      setStoredMedia(prev => [record, ...prev]);
      setThumbUrls(prev => ({ ...prev, [record.id]: url }));
    }
  }, []);

  const handleDragOver = useCallback((e) => { e.preventDefault(); setDragging(true); }, []);
  const handleDragLeave = useCallback(() => setDragging(false), []);

  const handleFileInput = useCallback(async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;
      const record = await saveMedia({ name: file.name, blob: file, width: 0, height: 0 });
      const url = blobToObjectURL(file);
      setStoredMedia(prev => [record, ...prev]);
      setThumbUrls(prev => ({ ...prev, [record.id]: url }));
    }
    e.target.value = '';
  }, []);

  const handleDelete = useCallback(async (id) => {
    await deleteMedia(id);
    setStoredMedia(prev => prev.filter(m => m.id !== id));
    if (thumbUrls[id]) { URL.revokeObjectURL(thumbUrls[id]); }
    setThumbUrls(prev => { const n = { ...prev }; delete n[id]; return n; });
  }, [thumbUrls]);

  const addCloudLink = () => {
    if (!linkInput.trim()) return;
    const isDropbox = linkInput.includes('dropbox.com');
    const isGDrive = linkInput.includes('drive.google.com');
    const name = isDropbox ? 'Dropbox Shared File' : isGDrive ? 'Google Drive File' : 'Cloud File';
    setCloudLinks(prev => [{ name, url: linkInput.trim(), source: isDropbox ? 'dropbox' : isGDrive ? 'gdrive' : 'link' }, ...prev]);
    setLinkInput('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="FILES" subtitle="Upload, link, and manage team media assets — files persist in your browser">
        <span style={{ fontFamily: fonts.condensed, fontSize: 12, color: colors.success, fontWeight: 600 }}>
          {storedMedia.length} file{storedMedia.length !== 1 ? 's' : ''} stored
        </span>
      </PageHeader>

      {/* Upload Zone */}
      <label style={{ cursor: 'pointer' }}>
        <input type="file" multiple accept="image/*,video/*" onChange={handleFileInput} style={{ display: 'none' }} />
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          style={{
            border: `2px dashed ${dragging ? colors.red : colors.border}`,
            borderRadius: radius.lg, padding: 40, textAlign: 'center',
            background: dragging ? colors.redLight : colors.white,
            transition: 'all 0.2s',
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.4 }}>📂</div>
          <div style={{ fontFamily: fonts.heading, fontSize: 20, color: colors.text, letterSpacing: 1 }}>
            {dragging ? 'DROP FILES HERE' : 'DRAG & DROP FILES'}
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: 4 }}>
            or click to browse · Naming convention: TEAM_##_LASTNAME_TYPE.ext
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 8 }}>
            Files are saved to your browser and persist across sessions
          </div>
        </div>
      </label>

      {/* Cloud Link Input */}
      <Card>
        <Label>Paste Cloud Share Link</Label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="text" value={linkInput} onChange={e => setLinkInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCloudLink()}
            placeholder="Paste a Dropbox or Google Drive share link..." style={{ ...inputStyle, flex: 1 }} />
          <RedButton onClick={addCloudLink} disabled={!linkInput.trim()} style={{ whiteSpace: 'nowrap' }}>Add Link</RedButton>
        </div>
        {cloudLinks.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {cloudLinks.map((l, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                background: colors.bg, borderRadius: radius.base, border: `1px solid ${colors.border}`,
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                  background: `${sourceColors[l.source]}15`, color: sourceColors[l.source], fontFamily: fonts.condensed }}>
                  {l.source === 'dropbox' ? 'DROPBOX' : l.source === 'gdrive' ? 'GDRIVE' : 'LINK'}
                </span>
                <span style={{ flex: 1, fontSize: 12, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.url}</span>
                <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, color: colors.red, textDecoration: 'none' }}>Open ↗</a>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Search */}
      <Card style={{ padding: 14 }}>
        <input type="text" placeholder="Search by filename, team, or player..." value={search}
          onChange={e => setSearch(e.target.value)} style={inputStyle} />
        <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 8, fontFamily: fonts.condensed }}>
          {filtered.length} file{filtered.length !== 1 ? 's' : ''} found
        </div>
      </Card>

      {/* File Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {filtered.map((f) => {
          const t = getTeam(f.team);
          const isLocal = f.source === 'local';
          return (
            <Card key={f.id} style={{ padding: 12, position: 'relative' }}>
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
                  {t && <span style={{ background: t.color, color: t.accent, padding: '1px 6px', borderRadius: 4, fontSize: 9, fontFamily: fonts.condensed, fontWeight: 700 }}>{t.id}</span>}
                  <span style={{ color: colors.textMuted, fontSize: 9, fontFamily: fonts.condensed, fontWeight: 600 }}>{f.type}</span>
                </div>
                {f.size && <span style={{ fontSize: 10, color: colors.textMuted }}>{f.size}</span>}
              </div>
              {f.url && (
                <a href={f.url} target="_blank" rel="noopener noreferrer" style={{
                  display: 'block', marginTop: 8, fontSize: 11, fontWeight: 700, color: colors.red,
                  textDecoration: 'none', textAlign: 'center', padding: '4px 0', borderTop: `1px solid ${colors.divider}`,
                }}>Open in Cloud ↗</a>
              )}
              {isLocal && (
                <button onClick={() => handleDelete(f.id)} style={{
                  position: 'absolute', top: 4, left: 4, width: 20, height: 20, borderRadius: radius.full,
                  background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', cursor: 'pointer',
                  fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>✕</button>
              )}
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <Card style={{ textAlign: 'center', padding: 40, color: colors.textMuted }}>
          No files found. Upload files above or paste a cloud share link.
        </Card>
      )}
    </div>
  );
}
