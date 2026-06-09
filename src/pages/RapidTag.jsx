// Rapid Tag — blast through onsite photos in Shade and categorize them by
// Team → Player → Type in a few taps. AI pre-fills the guess (team + type, plus
// player when a jersey number is visible); you confirm or correct, and it
// writes straight back to the Shade asset's metadata, then auto-advances.
//
// Master-admin only. Pulls its queue from the auto-updating
// "BLW WEEK 1 ALL PHOTOS" collection, showing only assets without a Player tag.

import { useState, useEffect, useCallback } from 'react';
import { Card, PageHeader, SectionHeading, TeamLogo } from '../components';
import { colors, fonts, radius } from '../theme';
import { TEAMS, getTeam, getTeamAbbr, CANONICAL_ROSTER_2026 } from '../data';
import { authedJson } from '../authed-fetch';

const CONTENT_TYPES = ['Headshot', 'Action', 'Hitting', 'Pitching', 'Celebration', 'Candid', 'Hype', 'Team'];

const pad2 = (n) => String(n || '').padStart(2, '0');
const teamRoster = (teamId) => CANONICAL_ROSTER_2026.filter(p => p.team === teamId);

// Resolve a player from team + jersey number — only when it's unambiguous.
function playerForNum(teamId, num) {
  if (!teamId || !num) return null;
  const n = pad2(num);
  const matches = teamRoster(teamId).filter(p => pad2(p.num) === n);
  return matches.length === 1 ? matches[0].name : null;
}

export default function RapidTag() {
  const [config, setConfig] = useState(null);
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

  const current = queue[idx] || null;

  const loadBatch = useCallback(async (off) => {
    if (off === 0) setLoading(true); else setLoadingMore(true);
    try {
      const r = await authedJson(`/api/shade?action=queue&offset=${off}&limit=24`);
      setQueue(prev => (off === 0 ? r.assets : [...prev, ...r.assets]));
      setOffset(off + (r.assets?.length || 0));
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); setLoadingMore(false); }
  }, []);

  // Initial: config + first batch.
  useEffect(() => {
    (async () => {
      try {
        const cfg = await authedJson('/api/shade?action=config');
        setConfig(cfg);
        if (cfg.connected) await loadBatch(0);
        else setLoading(false);
      } catch (e) { setErr(e.message); setLoading(false); }
    })();
  }, [loadBatch]);

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
      setDoneCount(c => c + 1);
      setIdx(i => i + 1);
    } catch (e) { setErr(e.message); }
    finally { setTagging(false); }
  }, [current, sel, tagging]);

  // Keyboard: Enter saves, S skips, ← back.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Enter') { e.preventDefault(); saveAndNext(); }
      else if (e.key.toLowerCase() === 's') setIdx(i => i + 1);
      else if (e.key === 'ArrowLeft') setIdx(i => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveAndNext]);

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
              No untagged photos left in the queue{doneCount > 0 ? ` — you tagged ${doneCount} this session.` : '.'}
            </p>
            <button onClick={() => { setIdx(0); loadBatch(0); }} style={btnStyle(colors.red, '#fff')}>Refresh queue</button>
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
        subtitle={`Tagging "${config?.collection || 'Shade'}" · ✓ ${doneCount} done this session`}
      />
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
            <button onClick={() => setIdx(i => i + 1)} style={btnStyle(colors.bg, colors.textSecondary, colors.border)}>Skip</button>
            <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
              style={{ ...btnStyle(colors.bg, colors.textSecondary, colors.border), opacity: idx === 0 ? 0.4 : 1 }}>← Back</button>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed }}>
            Image {idx + 1} of {queue.length} loaded{loadingMore ? ' · loading more…' : ''} · ↵ save · S skip · ← back
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
