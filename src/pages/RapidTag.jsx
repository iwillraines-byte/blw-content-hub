// Rapid Tag — blast through onsite photos in Shade and categorize them by
// Team → Player → Type in a few taps. AI pre-fills the guess (team + type, plus
// player when a jersey number is visible); you confirm or correct, and it
// writes straight back to the Shade asset's metadata, then auto-advances.
//
// Master-admin only. Pulls its queue from the auto-updating
// "BLW WEEK 1 ALL PHOTOS" collection, showing only assets without a Player tag.

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, PageHeader, SectionHeading, TeamLogo } from '../components';
import { colors, fonts, radius } from '../theme';
import { TEAMS, getTeam, getTeamAbbr, CANONICAL_ROSTER_2026 } from '../data';
import { authedJson } from '../authed-fetch';
import { compressImageBlob } from '../image-compress';
import { saveMedia, buildPlayerFilename, buildTeamFilename } from '../media-store';

const CONTENT_TYPES = ['Headshot', 'Action', 'Hitting', 'Pitching', 'Celebration', 'Candid', 'Hype', 'Team'];

// Map a Content Type to the BLW assetType used in filenames / gallery grouping.
const CONTENT_TYPE_TO_ASSET = {
  Headshot: 'HEADSHOT', Action: 'ACTION', Hitting: 'HITTING', Pitching: 'PITCHING',
  Celebration: 'CELEBRATION', Candid: 'CANDID', Hype: 'HYPE', Team: 'TEAMPHOTO',
};

const pad2 = (n) => String(n || '').padStart(2, '0');
const teamRoster = (teamId) => CANONICAL_ROSTER_2026.filter(p => p.team === teamId);

// Compress a full Shade original to high quality but ≤ 4MB (presigned upload
// handles it; keeps it well under the user's 5MB ceiling). Tries progressively
// gentler passes and takes the first that fits, so most land at 3000–4096px.
async function compressForImport(blob) {
  const passes = [
    { maxDimension: 4096, quality: 0.95 },
    { maxDimension: 3840, quality: 0.92 },
    { maxDimension: 3200, quality: 0.90 },
    { maxDimension: 2560, quality: 0.88 },
  ];
  let last = null;
  for (const p of passes) {
    const r = await compressImageBlob(blob, p);
    last = r;
    if (r.finalBytes <= 4 * 1024 * 1024) return r;
  }
  return last;
}

// Download a Shade original, compress it, and save into BLW Media tagged to the
// player (or team) — exactly like a manual upload, just sourced from Shade.
async function importOne({ asset, sel }) {
  const { url } = await authedJson('/api/shade', { method: 'POST', body: { action: 'download', assetId: asset.id } });
  const resp = await fetch(url); // R2 signed URL — CORS-open
  if (!resp.ok) throw new Error(`download HTTP ${resp.status}`);
  const full = await resp.blob();
  const c = await compressForImport(full);
  const ext = (c.blob.type === 'image/png') ? 'png' : 'jpg';
  const assetType = CONTENT_TYPE_TO_ASSET[sel.type] || 'ACTION';
  let filename;
  if (sel.player) {
    const lastName = sel.player.split(/\s+/).slice(-1)[0].toUpperCase();
    const firstInitial = sel.player.charAt(0).toUpperCase();
    const entry = CANONICAL_ROSTER_2026.find(p => p.team === sel.team && p.name === sel.player);
    filename = buildPlayerFilename({ team: sel.team, num: entry?.num || '', firstInitial, lastName, assetType, ext });
  } else {
    filename = buildTeamFilename({ team: sel.team, assetType, ext });
  }
  await saveMedia({ name: filename, blob: c.blob, width: c.width, height: c.height, source: 'shade' });
}

// Resolve a player from team + jersey number — only when it's unambiguous.
function playerForNum(teamId, num) {
  if (!teamId || !num) return null;
  const n = pad2(num);
  const matches = teamRoster(teamId).filter(p => pad2(p.num) === n);
  return matches.length === 1 ? matches[0].name : null;
}

export default function RapidTag() {
  const [config, setConfig] = useState(null);
  const [collections, setCollections] = useState([]);
  const [folders, setFolders] = useState([]);
  // Active tagging source: a collection (curated bin) OR a folder (raw intake
  // drop). Shape: { type:'collection'|'folder', value, label }. value is the
  // collection id or the folder path. The ref mirror lets the stable loadBatch
  // callback read the live selection without re-creating itself.
  const [source, setSource] = useState(null);
  const sourceRef = useRef(null);
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState({ team: null, player: null, type: null });
  const [ai, setAi] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  // Background import: tagging stays snappy while full images download +
  // compress + save into BLW Media. Capped concurrency so we don't fire a
  // dozen 30MB downloads at once.
  const importQ = useRef([]);
  const workers = useRef(0);
  const [imp, setImp] = useState({ pending: 0, done: 0, failed: 0 });
  const pump = useCallback(() => {
    const MAX = 2;
    while (workers.current < MAX && importQ.current.length) {
      const job = importQ.current.shift();
      workers.current++;
      importOne(job)
        .then(() => setImp(s => ({ ...s, done: s.done + 1, pending: Math.max(0, s.pending - 1) })))
        .catch(e => { console.warn('[rapid-tag import]', e); setImp(s => ({ ...s, failed: s.failed + 1, pending: Math.max(0, s.pending - 1) })); })
        .finally(() => { workers.current--; pump(); });
    }
  }, []);

  const current = queue[idx] || null;
  const sourceLabel = source?.label || config?.collection || 'Shade';
  const sourceKey = source ? `${source.type === 'folder' ? 'f' : 'c'}:${source.value}` : '';

  const loadBatch = useCallback(async (off, src = sourceRef.current) => {
    if (off === 0) setLoading(true); else setLoadingMore(true);
    try {
      const params = new URLSearchParams({ action: 'queue', offset: String(off), limit: '24' });
      if (src?.type === 'folder') params.set('folderPath', src.value);
      else if (src?.type === 'collection' && src.value) params.set('collectionId', src.value);
      const r = await authedJson(`/api/shade?${params.toString()}`);
      setQueue(prev => (off === 0 ? r.assets : [...prev, ...r.assets]));
      setOffset(off + (r.assets?.length || 0));
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); setLoadingMore(false); }
  }, []);

  // Switch the collection/folder we're tagging from — reset the queue + reload.
  const switchSource = useCallback((src) => {
    if (!src || (sourceRef.current && sourceRef.current.type === src.type && sourceRef.current.value === src.value)) return;
    sourceRef.current = src;
    setSource(src);
    setQueue([]); setIdx(0); setOffset(0);
    setSel({ team: null, player: null, type: null }); setAi(null); setErr(null);
    loadBatch(0, src);
  }, [loadBatch]);

  // Initial: config + collection/folder lists + first batch.
  useEffect(() => {
    (async () => {
      try {
        const cfg = await authedJson('/api/shade?action=config');
        setConfig(cfg);
        if (cfg.connected) {
          const def = { type: 'collection', value: cfg.defaultCollectionId || null, label: cfg.collection || 'All photos' };
          sourceRef.current = def;
          setSource(def);
          // Best-effort source lists — the queue still loads if these fail.
          authedJson('/api/shade?action=collections').then(r => setCollections(r.collections || [])).catch(() => {});
          authedJson('/api/shade?action=folders').then(r => setFolders(r.folders || [])).catch(() => {});
          await loadBatch(0, def);
        } else setLoading(false);
      } catch (e) { setErr(e.message); setLoading(false); }
    })();
  }, [loadBatch]);

  // Translate a picker <option> value ("c:<id>" / "f:<path>") into a source.
  const pickSource = useCallback((key) => {
    if (!key) return;
    if (key.startsWith('c:')) {
      const id = key.slice(2);
      const c = collections.find(x => x.id === id);
      switchSource({ type: 'collection', value: id, label: c?.name || 'Collection' });
    } else if (key.startsWith('f:')) {
      const path = key.slice(2);
      const f = folders.find(x => x.path === path);
      switchSource({ type: 'folder', value: path, label: f?.name || path });
    }
  }, [collections, folders, switchSource]);

  // On each new image: reset selection, fetch the AI suggestion, pre-fill.
  useEffect(() => {
    if (!current) return;
    setSel({ team: null, player: null, type: null });
    setAi(null);
    let cancelled = false;
    (async () => {
      setAiLoading(true);
      try {
        const s = await authedJson('/api/shade', {
          method: 'POST',
          body: {
            action: 'suggest',
            previewUrl: current.previewUrl,
            teams: TEAMS.map(t => ({ id: t.id, name: t.name, color: t.color, accent: t.accent })),
          },
        });
        if (cancelled || s?.error) return;
        setAi(s);
        const t = s.team && getTeam(s.team) ? s.team : null;
        setSel({
          team: t,
          player: playerForNum(t, s.num),
          type: CONTENT_TYPES.includes(s.contentType) ? s.contentType : null,
        });
      } catch { /* AI is best-effort */ }
      finally { if (!cancelled) setAiLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [current?.id]);

  // Prefetch more when within 4 of the end.
  useEffect(() => {
    if (config?.connected && queue.length && idx >= queue.length - 4 && !loadingMore) {
      loadBatch(offset);
    }
  }, [idx]); // eslint-disable-line

  const saveAndNext = useCallback(async () => {
    if (!current || !sel.team || !sel.type || tagging) return;
    setTagging(true);
    try {
      await authedJson('/api/shade', {
        method: 'POST',
        body: { action: 'tag', assetId: current.id, team: sel.team, player: sel.player, contentType: sel.type },
      });
      // Queue the BLW Media import (download original → compress → saveMedia) in
      // the background so the next photo is ready instantly.
      importQ.current.push({ asset: current, sel: { ...sel } });
      setImp(s => ({ ...s, pending: s.pending + 1 }));
      pump();
      setDoneCount(c => c + 1);
      setIdx(i => i + 1);
    } catch (e) { setErr(e.message); }
    finally { setTagging(false); }
  }, [current, sel, tagging, pump]);

  // N/A — photo has no athlete (crowd, venue, staff, sponsor). Marks Content
  // Type "N/A" (so it leaves the queue) and advances. No team/player needed.
  const markNA = useCallback(async () => {
    if (!current || tagging) return;
    setTagging(true);
    try {
      await authedJson('/api/shade', {
        method: 'POST',
        body: { action: 'tag', assetId: current.id, contentType: 'N/A' },
      });
      setDoneCount(c => c + 1);
      setIdx(i => i + 1);
    } catch (e) { setErr(e.message); }
    finally { setTagging(false); }
  }, [current, tagging]);

  // Keyboard: Enter saves, N marks N/A, S skips, ← back.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Enter') { e.preventDefault(); saveAndNext(); }
      else if (e.key.toLowerCase() === 'n') markNA();
      else if (e.key.toLowerCase() === 's') setIdx(i => i + 1);
      else if (e.key === 'ArrowLeft') setIdx(i => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveAndNext, markNA]);

  // ─── States ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div>
        <PageHeader title="Rapid Tag" subtitle="Categorize onsite photos straight into Shade" />
        <Card><div style={{ padding: 40, textAlign: 'center', color: colors.textSecondary }}>Loading the photo queue from Shade…</div></Card>
      </div>
    );
  }

  if (config && !config.connected) {
    return (
      <div>
        <PageHeader title="Rapid Tag" subtitle="Categorize onsite photos straight into Shade" />
        <Card>
          <div style={{ padding: 28, maxWidth: 560 }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>🔌</div>
            <SectionHeading style={{ margin: '0 0 8px' }}>Connect Shade</SectionHeading>
            <p style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 1.6, margin: '0 0 12px' }}>
              Add your Shade API key so the widget can read the photo queue and write tags back.
            </p>
            <ol style={{ fontSize: 13, color: colors.text, lineHeight: 1.8, paddingLeft: 18, margin: 0 }}>
              <li>In Shade: <strong>Settings → API Keys</strong> → create a key (starts with <code>sk_…</code>)</li>
              <li>In Vercel: add an env var <code>SHADE_API_KEY</code> with that value (Production)</li>
              <li>Redeploy, then refresh this page</li>
            </ol>
          </div>
        </Card>
      </div>
    );
  }

  if (!current) {
    return (
      <div>
        <PageHeader title="Rapid Tag" subtitle="Categorize onsite photos straight into Shade" />
        <Card>
          <div style={{ padding: 44, textAlign: 'center' }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>🎉</div>
            <SectionHeading style={{ margin: '0 0 6px' }}>All caught up</SectionHeading>
            <p style={{ fontSize: 14, color: colors.textSecondary }}>
              No untagged photos left in <strong>{sourceLabel}</strong>{doneCount > 0 ? ` — you tagged ${doneCount} this session.` : '.'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 12 }}>
              <SourcePicker collections={collections} folders={folders} value={sourceKey} onPick={pickSource} centered />
              <button onClick={() => { setIdx(0); loadBatch(0); }} style={btnStyle(colors.red, '#fff')}>Refresh queue</button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const aiBadge = (match) => match ? (
    <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 999, padding: '1px 6px', letterSpacing: 0.5 }}>✨ AI</span>
  ) : null;

  return (
    <div>
      <PageHeader
        title="Rapid Tag"
        subtitle={`Tagging "${sourceLabel}" · ✓ ${doneCount} tagged · ⬆ ${imp.done} imported${imp.pending ? ` (${imp.pending} in flight)` : ''}${imp.failed ? ` · ⚠ ${imp.failed} failed` : ''}`}
      />
      <SourcePicker collections={collections} folders={folders} value={sourceKey} onPick={pickSource} />
      {err && (
        <Card style={{ marginBottom: 12, background: '#FEF2F2', border: '1px solid #FECACA' }}>
          <div style={{ padding: 10, fontSize: 12, color: '#991B1B' }}>⚠ {err}</div>
        </Card>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Photo */}
        <Card style={{ flex: '1 1 420px', minWidth: 320, padding: 0, overflow: 'hidden' }}>
          <div style={{ position: 'relative', background: '#0B0D10', aspectRatio: '3 / 2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src={current.previewUrl} alt={current.name}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
            {aiLoading && (
              <div style={{ position: 'absolute', top: 10, right: 10, fontSize: 11, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.55)', borderRadius: 999, padding: '3px 10px' }}>✨ AI looking…</div>
            )}
          </div>
          <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.name}</span>
            {ai?.reasoning && <span style={{ fontSize: 11, color: colors.textSecondary, fontStyle: 'italic', textAlign: 'right', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ai.reasoning}</span>}
          </div>
        </Card>

        {/* Controls */}
        <Card style={{ flex: '1 1 420px', minWidth: 320 }}>
          {/* Team */}
          <SectionHeading style={{ margin: '0 0 8px' }}>1 · Team {aiBadge(ai?.team && ai.team === sel.team)}</SectionHeading>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {TEAMS.map(t => {
              const active = sel.team === t.id;
              return (
                <button key={t.id}
                  onClick={() => setSel(s => ({ ...s, team: t.id, player: playerForNum(t.id, ai?.num) }))}
                  title={t.name}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                    padding: '5px 9px', borderRadius: radius.sm,
                    background: active ? t.color : colors.white,
                    color: active ? (t.accent || '#fff') : colors.text,
                    border: `1.5px solid ${active ? t.color : colors.borderLight}`,
                    fontFamily: fonts.condensed, fontSize: 12, fontWeight: 700,
                  }}>
                  <TeamLogo teamId={t.id} size={16} rounded="square" />
                  {getTeamAbbr(t)}
                </button>
              );
            })}
          </div>

          {/* Player */}
          <SectionHeading style={{ margin: '0 0 8px' }}>2 · Player {aiBadge(sel.player && ai?.num)}</SectionHeading>
          {!sel.team ? (
            <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>Pick a team first.</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {teamRoster(sel.team).map(p => {
                const active = sel.player === p.name;
                return (
                  <button key={p.name}
                    onClick={() => setSel(s => ({ ...s, player: active ? null : p.name }))}
                    style={{
                      cursor: 'pointer', padding: '5px 10px', borderRadius: radius.sm,
                      background: active ? colors.red : colors.white,
                      color: active ? '#fff' : colors.text,
                      border: `1.5px solid ${active ? colors.red : colors.borderLight}`,
                      fontFamily: fonts.body, fontSize: 12, fontWeight: active ? 800 : 600,
                    }}>
                    {p.name}{p.num ? <span style={{ opacity: 0.6, marginLeft: 4 }}>#{pad2(p.num)}</span> : null}
                  </button>
                );
              })}
              <button
                onClick={() => setSel(s => ({ ...s, player: null }))}
                style={{
                  cursor: 'pointer', padding: '5px 10px', borderRadius: radius.sm,
                  background: sel.player == null ? colors.text : colors.white,
                  color: sel.player == null ? '#fff' : colors.textMuted,
                  border: `1.5px solid ${sel.player == null ? colors.text : colors.borderLight}`,
                  fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                }}>No single player</button>
            </div>
          )}

          {/* Type */}
          <SectionHeading style={{ margin: '0 0 8px' }}>3 · Type {aiBadge(ai?.contentType && ai.contentType === sel.type)}</SectionHeading>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
            {CONTENT_TYPES.map(ty => {
              const active = sel.type === ty;
              return (
                <button key={ty}
                  onClick={() => setSel(s => ({ ...s, type: ty }))}
                  style={{
                    cursor: 'pointer', padding: '5px 11px', borderRadius: radius.sm,
                    background: active ? colors.text : colors.white,
                    color: active ? '#fff' : colors.text,
                    border: `1.5px solid ${active ? colors.text : colors.borderLight}`,
                    fontFamily: fonts.condensed, fontSize: 12, fontWeight: 700,
                  }}>{ty}</button>
              );
            })}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={saveAndNext} disabled={!sel.team || !sel.type || tagging}
              style={{ ...btnStyle(colors.red, '#fff'), opacity: (!sel.team || !sel.type || tagging) ? 0.5 : 1, flex: '1 1 auto' }}>
              {tagging ? 'Saving…' : '✓ Save & Next'} <span style={{ opacity: 0.7, fontSize: 11 }}>↵</span>
            </button>
            <button onClick={markNA} disabled={tagging}
              title="No athlete in this photo (crowd, venue, staff, sponsor) — mark N/A and move on"
              style={btnStyle('#FEF3C7', '#92400E', '#FDE68A')}>N/A · not a player</button>
            <button onClick={() => setIdx(i => i + 1)} style={btnStyle(colors.bg, colors.textSecondary, colors.border)}>Skip</button>
            <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
              style={{ ...btnStyle(colors.bg, colors.textSecondary, colors.border), opacity: idx === 0 ? 0.4 : 1 }}>← Back</button>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed }}>
            Image {idx + 1} of {queue.length} loaded{loadingMore ? ' · loading more…' : ''} · ↵ save · N n/a · S skip · ← back
          </div>
        </Card>
      </div>
    </div>
  );
}

function btnStyle(bg, fg, border) {
  return {
    background: bg, color: fg, border: `1px solid ${border || bg}`,
    borderRadius: radius.sm, padding: '9px 16px', cursor: 'pointer',
    fontFamily: fonts.condensed, fontSize: 13, fontWeight: 800, letterSpacing: 0.4,
  };
}

// Source selector — pick which Shade collection (curated bin) OR raw intake
// folder (dated drop) the queue pulls from. Option values are prefixed
// "c:" (collection id) / "f:" (folder path) so one <select> spans both.
// Hidden until there's more than one source to choose. `centered` lays it
// out for the empty-state card.
function SourcePicker({ collections, folders, value, onPick, centered = false }) {
  const total = (collections?.length || 0) + (folders?.length || 0);
  if (total < 2) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      justifyContent: centered ? 'center' : 'flex-start',
      marginBottom: centered ? 0 : 14,
    }}>
      <span style={{
        fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800,
        letterSpacing: 0.6, color: colors.textMuted, textTransform: 'uppercase',
      }}>📁 Tagging from</span>
      <select
        value={value || ''}
        onChange={e => onPick(e.target.value)}
        style={{
          fontFamily: fonts.body, fontSize: 13, fontWeight: 600,
          padding: '6px 10px', background: colors.white,
          border: `1px solid ${colors.border}`, borderRadius: radius.sm,
          color: colors.text, cursor: 'pointer', maxWidth: 340,
        }}
      >
        {collections?.length > 0 && (
          <optgroup label="Collections">
            {collections.map(c => (
              <option key={c.id} value={`c:${c.id}`}>
                {c.name}{c.count != null ? ` (${c.count})` : ''}
              </option>
            ))}
          </optgroup>
        )}
        {folders?.length > 0 && (
          <optgroup label="Intake folders">
            {folders.map(f => (
              <option key={f.path} value={`f:${f.path}`}>{f.name}</option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
