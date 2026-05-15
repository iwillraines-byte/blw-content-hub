// Train AI — master-only page for populating the ai_memory store that
// /api/ideas + /api/captions inject into their prompts on every call.
//
// Three workflows live here:
//
//   1. Manual entry — pick scope + scope_id, type an answer, weight it,
//      save. Direct CRUD against /api/ai-memory.
//
//   2. Chat-style ingest — write natural-language notes about BLW; the
//      server distills the message into discrete structured rows the
//      master can edit + accept before they commit.
//
//   3. AI-suggested questions — server asks Claude "given the existing
//      memory, what 5-8 questions should the master answer to make
//      future generations dramatically better?"; the master answers in
//      one-liners and each answer commits as a new row.
//
// Memory rows are scoped (league / team / player / rule / history /
// style) and weighted 1-5. Higher weight ships in every prompt; lower
// weight ships when relevant. The Memory inspector at the bottom shows
// everything currently in the store, grouped by scope, with inline
// edit + delete + weight-bump.
//
// Read access is open to any auth'd user (RLS allows it so the AI prompts
// can fetch the rows server-side); write access is master_admin only.

import { useEffect, useMemo, useState } from 'react';
import { TEAMS } from '../data';
import { Card, PageHeader, SectionHeading, Label, RedButton, OutlineButton, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { authedFetch } from '../authed-fetch';
import { useAuth } from '../auth';
import { useToast } from '../toast';

const SCOPES = [
  { id: 'league',  label: 'League',  hint: 'Applies to every generation' },
  { id: 'team',    label: 'Team',    hint: 'Pick a team below' },
  { id: 'player',  label: 'Player',  hint: 'Type the player slug' },
  { id: 'rule',    label: 'Rule',    hint: 'Wiffle ball game mechanics' },
  { id: 'history', label: 'History', hint: 'Past seasons, milestones' },
  { id: 'style',   label: 'Style',   hint: 'Voice rules, anti-examples' },
];

const SCOPE_COLORS = {
  league:  '#7C3AED',
  team:    '#0EA5E9',
  player:  '#DC2626',
  rule:    '#059669',
  history: '#D97706',
  style:   '#DB2777',
};

export default function TrainAI() {
  const { role } = useAuth();
  const toast = useToast();
  const isMaster = role === 'master_admin' || role === 'admin';

  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);

  // Manual entry form
  const [scope, setScope] = useState('league');
  const [scopeId, setScopeId] = useState('');
  const [answer, setAnswer] = useState('');
  const [weight, setWeight] = useState(3);
  const [saving, setSaving] = useState(false);

  // Chat ingest
  const [chatMessage, setChatMessage] = useState('');
  const [chatProposed, setChatProposed] = useState(null); // [rows]
  const [chatBusy, setChatBusy] = useState(false);

  // AI-suggested questions
  const [suggestedQuestions, setSuggestedQuestions] = useState([]);
  const [questionFocus, setQuestionFocus] = useState('');
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [answeringId, setAnsweringId] = useState(null); // question index being answered inline
  const [questionAnswers, setQuestionAnswers] = useState({});

  useEffect(() => { reload(); }, []);
  const reload = async () => {
    setLoading(true);
    try {
      const res = await authedFetch('/api/ai-memory');
      const json = await res.json();
      if (res.ok) setMemories(json.memories || []);
      else toast.error('Couldn\'t load memories', { detail: json.error });
    } finally { setLoading(false); }
  };

  const saveManual = async () => {
    if (!answer.trim()) return;
    setSaving(true);
    try {
      const res = await authedFetch('/api/ai-memory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope,
          scope_id: scopeId.trim() || null,
          answer: answer.trim(),
          weight,
          source: 'manual',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setAnswer('');
      setScopeId('');
      setWeight(3);
      await reload();
      toast.success('Memory saved');
    } catch (err) { toast.error('Save failed', { detail: err.message?.slice(0, 80) }); }
    finally { setSaving(false); }
  };

  const distillChat = async () => {
    if (!chatMessage.trim()) return;
    setChatBusy(true); setChatProposed(null);
    try {
      const res = await authedFetch('/api/ai-memory?action=distill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: chatMessage }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setChatProposed((json.proposed || []).map((r, i) => ({ ...r, _localId: i, _selected: true })));
      if ((json.proposed || []).length === 0) {
        toast.info('Nothing extractable yet', { detail: 'Try writing the note as discrete facts.' });
      }
    } catch (err) { toast.error('Distill failed', { detail: err.message?.slice(0, 80) }); }
    finally { setChatBusy(false); }
  };

  const commitChatProposed = async () => {
    if (!Array.isArray(chatProposed) || chatProposed.length === 0) return;
    const selected = chatProposed.filter(r => r._selected);
    if (selected.length === 0) return;
    setChatBusy(true);
    let ok = 0, fail = 0;
    for (const r of selected) {
      try {
        const res = await authedFetch('/api/ai-memory', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            scope: r.scope,
            scope_id: r.scope_id || null,
            answer: r.answer,
            weight: r.weight ?? 3,
            source: 'chat-distill',
          }),
        });
        if (res.ok) ok++; else fail++;
      } catch { fail++; }
    }
    setChatBusy(false);
    setChatMessage('');
    setChatProposed(null);
    await reload();
    toast.success(`Committed ${ok} memor${ok === 1 ? 'y' : 'ies'}${fail ? ` · ${fail} failed` : ''}`);
  };

  const requestQuestions = async () => {
    setSuggestBusy(true); setSuggestedQuestions([]);
    try {
      const res = await authedFetch('/api/ai-memory?action=suggest-questions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ focus: questionFocus || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setSuggestedQuestions(json.questions || []);
      if ((json.questions || []).length === 0) {
        toast.info('No new questions surfaced');
      }
    } catch (err) { toast.error('Couldn\'t suggest questions', { detail: err.message?.slice(0, 80) }); }
    finally { setSuggestBusy(false); }
  };

  const answerQuestion = async (idx) => {
    const q = suggestedQuestions[idx];
    const a = questionAnswers[idx];
    if (!q || !a?.trim()) return;
    try {
      const res = await authedFetch('/api/ai-memory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: q.scope,
          scope_id: q.scope_id || null,
          question: q.text,
          answer: a.trim(),
          weight: 3,
          source: 'ai-question-answer',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setSuggestedQuestions(prev => prev.filter((_, i) => i !== idx));
      setQuestionAnswers(prev => {
        const n = { ...prev };
        delete n[idx];
        return n;
      });
      setAnsweringId(null);
      await reload();
      toast.success('Memory saved');
    } catch (err) { toast.error('Save failed', { detail: err.message?.slice(0, 80) }); }
  };

  const removeMemory = async (id) => {
    if (!window.confirm('Remove this memory? Cannot be undone.')) return;
    try {
      const res = await authedFetch(`/api/ai-memory?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMemories(prev => prev.filter(m => m.id !== id));
      toast.success('Removed');
    } catch (err) { toast.error('Couldn\'t remove', { detail: err.message?.slice(0, 80) }); }
  };

  const bumpWeight = async (m, delta) => {
    const next = Math.max(1, Math.min(5, m.weight + delta));
    if (next === m.weight) return;
    try {
      const res = await authedFetch(`/api/ai-memory?id=${m.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weight: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setMemories(prev => prev.map(x => x.id === m.id ? { ...x, weight: next } : x));
    } catch (err) { toast.error('Couldn\'t update weight', { detail: err.message?.slice(0, 80) }); }
  };

  const groupedMemories = useMemo(() => {
    const groups = {};
    for (const m of memories) {
      const k = m.scope_id ? `${m.scope}:${m.scope_id}` : m.scope;
      (groups[k] = groups[k] || []).push(m);
    }
    return groups;
  }, [memories]);

  const totalsByScope = useMemo(() => {
    const out = { league: 0, team: 0, player: 0, rule: 0, history: 0, style: 0 };
    for (const m of memories) out[m.scope] = (out[m.scope] || 0) + 1;
    return out;
  }, [memories]);

  if (!isMaster) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <PageHeader title="TRAIN AI" subtitle="Master admin only" />
        <Card>
          <div style={{ padding: 24, color: colors.textSecondary, fontSize: 13 }}>
            Training the AI is a master-admin tool. Ask your master admin to populate the league memory and your generations will improve automatically.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        title="TRAIN AI"
        subtitle="Curate the league memory the AI reads on every content generation"
      >
        <div style={{ fontFamily: fonts.condensed, fontSize: 11, color: colors.textMuted, letterSpacing: 0.4 }}>
          {memories.length} TOTAL · L{totalsByScope.league} T{totalsByScope.team} P{totalsByScope.player} R{totalsByScope.rule} H{totalsByScope.history} S{totalsByScope.style}
        </div>
      </PageHeader>

      {/* ─── Phase 3: AI-suggested questions ─────────────────────────────────── */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
          <SectionHeading style={{ margin: 0 }}>Let the AI ask</SectionHeading>
          <span style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 0.5 }}>
            HIGHEST-LEVERAGE WAY TO TRAIN
          </span>
        </div>
        <div style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 1.55, marginBottom: 10 }}>
          The model looks at what it already knows about BLW and proposes the questions where filling in your answer would help future generations most. Answer any that resonate; skip the rest.
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <input
            value={questionFocus}
            onChange={e => setQuestionFocus(e.target.value)}
            placeholder="Optional focus — e.g. 'wiffle ball rules', 'LAN identity', 'pitch types'"
            style={{ ...inputStyle, flex: '1 1 280px' }}
          />
          <RedButton onClick={requestQuestions} disabled={suggestBusy} style={{ padding: '8px 14px', fontSize: 12 }}>
            {suggestBusy ? 'Thinking…' : '✦ Suggest questions'}
          </RedButton>
        </div>
        {suggestedQuestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {suggestedQuestions.map((q, i) => (
              <div key={i} style={{
                border: `1px solid ${colors.borderLight}`,
                borderRadius: radius.base,
                padding: 12,
                background: colors.bg,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', marginBottom: answeringId === i ? 8 : 0 }}>
                  <div style={{ fontSize: 13, color: colors.text, lineHeight: 1.5 }}>
                    <ScopeChip scope={q.scope} scopeId={q.scope_id} /> {q.text}
                  </div>
                  {answeringId !== i && (
                    <button onClick={() => setAnsweringId(i)} style={{
                      background: 'transparent', border: `1px solid ${colors.border}`,
                      color: colors.accent, borderRadius: radius.sm, padding: '4px 10px',
                      cursor: 'pointer', fontSize: 11, fontFamily: fonts.condensed, fontWeight: 700, letterSpacing: 0.4,
                    }}>Answer</button>
                  )}
                </div>
                {answeringId === i && (
                  <div>
                    <textarea
                      autoFocus
                      value={questionAnswers[i] || ''}
                      onChange={e => setQuestionAnswers(prev => ({ ...prev, [i]: e.target.value }))}
                      placeholder="Type your answer. 1-3 sentences."
                      rows={3}
                      style={{ ...inputStyle, width: '100%', resize: 'vertical', minHeight: 60, fontSize: 13, lineHeight: 1.5 }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <RedButton onClick={() => answerQuestion(i)} disabled={!questionAnswers[i]?.trim()} style={{ padding: '6px 12px', fontSize: 12 }}>Save</RedButton>
                      <OutlineButton onClick={() => { setAnsweringId(null); }} style={{ padding: '6px 12px', fontSize: 12 }}>Cancel</OutlineButton>
                      <button onClick={() => {
                        setSuggestedQuestions(prev => prev.filter((_, idx) => idx !== i));
                        setAnsweringId(null);
                      }} style={{
                        marginLeft: 'auto',
                        background: 'transparent', border: 'none', color: colors.textMuted,
                        cursor: 'pointer', fontSize: 11, fontFamily: fonts.condensed, letterSpacing: 0.4,
                      }}>Skip this question</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ─── Phase 2: Chat-style ingest ───────────────────────────────────────── */}
      <Card>
        <SectionHeading style={{ margin: '0 0 6px' }}>Tell the AI in your own words</SectionHeading>
        <div style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 1.55, marginBottom: 10 }}>
          Write naturally — multiple facts, multiple players, multiple rules. The AI distills your message into discrete memory rows you can review before they commit.
        </div>
        <textarea
          value={chatMessage}
          onChange={e => setChatMessage(e.target.value)}
          placeholder="e.g. So Cam Smith on MIA — he was the second-overall pick last year, came over from a rec league. His thing is line-drive contact. Connor Smith on SDO is unrelated, despite the name. PHI's identity is 'the city's team' — gritty, blue-collar tone. Wiffle ball pitches in BLW are riser, drop, slider, screwball — no curveballs because the ball shape physics."
          rows={6}
          style={{ ...inputStyle, width: '100%', resize: 'vertical', minHeight: 120, fontSize: 13, lineHeight: 1.5 }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <RedButton onClick={distillChat} disabled={chatBusy || !chatMessage.trim()} style={{ padding: '8px 14px', fontSize: 12 }}>
            {chatBusy ? 'Distilling…' : '✦ Distill into memories'}
          </RedButton>
          {chatProposed && (
            <OutlineButton onClick={() => { setChatProposed(null); setChatMessage(''); }} style={{ padding: '8px 14px', fontSize: 12 }}>
              Discard
            </OutlineButton>
          )}
        </div>
        {Array.isArray(chatProposed) && (
          <div style={{ marginTop: 14, padding: 12, background: colors.bg, borderRadius: radius.base, border: `1px dashed ${colors.borderLight}` }}>
            <div style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, color: colors.textMuted, letterSpacing: 0.6, marginBottom: 8, textTransform: 'uppercase' }}>
              Proposed memories · {chatProposed.length} {chatProposed.length === 1 ? 'row' : 'rows'}
            </div>
            {chatProposed.length === 0 && (
              <div style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic' }}>Nothing extractable. Try writing as discrete facts ("X is Y. A is B.").</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {chatProposed.map((r) => (
                <div key={r._localId} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  background: r._selected ? colors.white : 'transparent',
                  border: `1px solid ${r._selected ? colors.borderLight : colors.divider}`,
                  borderRadius: radius.base, padding: 10,
                }}>
                  <input
                    type="checkbox"
                    checked={r._selected}
                    onChange={() => setChatProposed(prev => prev.map(x => x._localId === r._localId ? { ...x, _selected: !x._selected } : x))}
                    style={{ marginTop: 3 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                      <ScopeChip scope={r.scope} scopeId={r.scope_id} />
                      <span style={{ fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 0.4 }}>
                        WEIGHT {r.weight}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.45, color: colors.text }}>{r.answer}</div>
                  </div>
                </div>
              ))}
            </div>
            {chatProposed.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <RedButton
                  onClick={commitChatProposed}
                  disabled={chatBusy || chatProposed.filter(r => r._selected).length === 0}
                  style={{ padding: '8px 14px', fontSize: 12 }}
                >
                  {chatBusy
                    ? 'Saving…'
                    : `Commit ${chatProposed.filter(r => r._selected).length} memor${chatProposed.filter(r => r._selected).length === 1 ? 'y' : 'ies'}`}
                </RedButton>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ─── Phase 1: Manual entry ───────────────────────────────────────────── */}
      <Card>
        <SectionHeading style={{ margin: '0 0 6px' }}>Add a memory directly</SectionHeading>
        <div style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 1.55, marginBottom: 10 }}>
          For when you know exactly what you want to capture. Skip the AI middleman.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) minmax(140px, 1fr) 100px', gap: 10, marginBottom: 8 }}>
          <div>
            <Label>Scope</Label>
            <select value={scope} onChange={e => { setScope(e.target.value); setScopeId(''); }} style={selectStyle}>
              {SCOPES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <Label>{scope === 'team' ? 'Team' : scope === 'player' ? 'Player slug' : 'Scope target'}</Label>
            {scope === 'team' ? (
              <select value={scopeId} onChange={e => setScopeId(e.target.value)} style={selectStyle}>
                <option value="">— Choose team —</option>
                {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id} · {t.name}</option>)}
              </select>
            ) : scope === 'player' ? (
              <input
                value={scopeId}
                onChange={e => setScopeId(e.target.value)}
                placeholder="e.g. logan-rose"
                style={inputStyle}
              />
            ) : (
              <input
                value=""
                disabled
                placeholder={SCOPES.find(s => s.id === scope)?.hint}
                style={{ ...inputStyle, color: colors.textMuted, background: colors.bg }}
              />
            )}
          </div>
          <div>
            <Label>Weight</Label>
            <select value={weight} onChange={e => setWeight(Number(e.target.value))} style={selectStyle}>
              <option value={5}>5 — always</option>
              <option value={4}>4 — strong</option>
              <option value={3}>3 — default</option>
              <option value={2}>2 — light</option>
              <option value={1}>1 — situational</option>
            </select>
          </div>
        </div>
        <textarea
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          placeholder="Type the memory — 1-3 sentences, plain prose. Example: 'Wiffle ball pitches in BLW are riser, drop, slider, and screwball. Curveballs don\'t happen because the ball is too light.'"
          rows={4}
          style={{ ...inputStyle, width: '100%', resize: 'vertical', minHeight: 80, fontSize: 13, lineHeight: 1.5 }}
        />
        <div style={{ marginTop: 8 }}>
          <RedButton
            onClick={saveManual}
            disabled={saving || !answer.trim() || (scope === 'team' && !scopeId) || (scope === 'player' && !scopeId)}
            style={{ padding: '8px 16px', fontSize: 12 }}
          >
            {saving ? 'Saving…' : 'Save memory'}
          </RedButton>
        </div>
      </Card>

      {/* ─── Memory inspector ────────────────────────────────────────────────── */}
      <Card>
        <SectionHeading style={{ margin: '0 0 6px' }}>Current memory · {memories.length}</SectionHeading>
        <div style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 1.55, marginBottom: 10 }}>
          Everything the AI sees today. Weight up the rows that should always ship; weight down (or delete) anything stale.
        </div>
        {loading ? (
          <div style={{ padding: 20, color: colors.textMuted, fontSize: 12 }}>Loading…</div>
        ) : memories.length === 0 ? (
          <div style={{ padding: 24, color: colors.textMuted, fontSize: 13, textAlign: 'center', background: colors.bg, borderRadius: radius.base, border: `1px dashed ${colors.borderLight}` }}>
            No memories yet. Start with "Let the AI ask" above for the fastest fill.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {Object.entries(groupedMemories).map(([key, rows]) => (
              <div key={key}>
                <div style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, color: colors.textMuted, letterSpacing: 0.8, marginBottom: 6, textTransform: 'uppercase' }}>
                  {key} · {rows.length}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {rows.map(m => (
                    <div key={m.id} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: 10, border: `1px solid ${colors.borderLight}`, borderRadius: radius.base,
                    }}>
                      <div style={{
                        width: 26, textAlign: 'center', fontFamily: fonts.condensed, fontWeight: 800,
                        fontSize: 14, color: weightColor(m.weight),
                      }}>
                        {m.weight}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.5, color: colors.text }}>
                        {m.answer}
                        {m.question && (
                          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4, fontStyle: 'italic' }}>
                            Q: {m.question}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => bumpWeight(m, +1)} title="Weight up" style={miniBtn}>↑</button>
                        <button onClick={() => bumpWeight(m, -1)} title="Weight down" style={miniBtn}>↓</button>
                        <button onClick={() => removeMemory(m.id)} title="Remove" style={{ ...miniBtn, color: colors.red }}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ScopeChip({ scope, scopeId }) {
  const c = SCOPE_COLORS[scope] || colors.textMuted;
  return (
    <span style={{
      display: 'inline-block',
      background: `${c}18`, color: c, border: `1px solid ${c}44`,
      borderRadius: 4, padding: '2px 7px',
      fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
      marginRight: 4,
    }}>
      {scope}{scopeId ? ` · ${scopeId}` : ''}
    </span>
  );
}

function weightColor(w) {
  if (w >= 5) return '#7C2D12';
  if (w >= 3) return '#15803D';
  return '#6B7280';
}

const miniBtn = {
  background: 'transparent', border: `1px solid ${colors.border}`,
  color: colors.textSecondary, cursor: 'pointer',
  borderRadius: radius.sm, padding: '2px 8px',
  fontSize: 11, fontFamily: fonts.condensed, fontWeight: 700,
};
