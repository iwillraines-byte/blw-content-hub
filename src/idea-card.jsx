// IdeaCard — the dashboard's content drafting unit.
//
// An idea isn't a list-item anymore. It's a draft. Each card carries:
//   1. Header   — angle pill + AI badge + team chip
//   2. Headline — confident, editorial
//   3. Narrative — 2-3 sentences of why it's post-worthy
//   4. Stat pills — the literal numbers you'd put on a graphic
//   5. Actions — Send to Requests / Open in Generate / Draft captions
//   6. (Expanded) Caption drafts — Instagram / Twitter / Story tabs with
//      editable text, Copy, and Regenerate.
//
// Backwards compat: deterministic (non-AI) suggestions don't include
// `narrative` / `dataPoints` / `captions`. We fall back to `description` for
// the body, hide the stat-pill row if empty, and replace the caption tabs
// with a "Draft captions" CTA that calls /api/captions on demand.
//
// Team color drift: we read `team.color` from the BLW team registry and pass
// it down as inline tokens (background tint, border, accent). The card is
// already inside a TeamThemeScope when relevant, but for the per-card
// drift (each idea may belong to a different team within the same dashboard
// view) we apply explicit per-card colors here rather than CSS vars.

import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getTeam } from './data';
import { TeamChip } from './components';
import { colors, fonts, radius } from './theme';
import { useToast } from './toast';
import { authedFetch } from './authed-fetch';
import { getFeedback, setFeedback } from './idea-feedback-store';

// Angle taxonomy matches the menu in api/ideas.js — every angle a new
// idea ships with should fall into one of these. Legacy angles from
// older saved ideas (leader, hype, matchup, milestone, mover, deep-dive)
// still resolve via the fallback in the angle-label lookup below, so
// the 14-day rolling content_ideas store stays readable across the
// schema change.
const ANGLE_LABELS = {
  // Current taxonomy
  'stat-spotlight': 'STAT SPOTLIGHT',
  contrarian:       'CONTRARIAN',
  comparison:       'COMPARISON',
  arc:              'TRAJECTORY',
  storyline:        'STORYLINE',
  undertold:        'UNDERTOLD',
  character:        'CHARACTER',
  prediction:       'PREDICTION',
  // Legacy angles — still readable on older cards in the rolling store.
  leader:    'LEADER',
  hype:      'HYPE',
  matchup:   'MATCHUP',
  milestone: 'MILESTONE',
  mover:     'MOVER',
  'deep-dive': 'DEEP DIVE',
};

const PLATFORM_TABS = [
  { key: 'instagram', label: 'Instagram', icon: '◐' },
  { key: 'twitter',   label: 'X / Twitter', icon: '✕' },
  { key: 'story',     label: 'Story',     icon: '▣' },
];

export default function IdeaCard({
  idea,
  onQueue,           // (idea) => void
  onOpenInGenerate,  // (idea) => void
  onMoreLikeThis,    // (idea) => void           (optional)
  onIdeaUpdate,      // (ideaId, patch) => void   parent merges patch into idea
  onDelete,          // v4.7.8: (idea) => void   master-only delete; if absent we hide the button
  onThumbDownNote,   // v4.7.8: (idea, note) => void   athlete fallback: send their "what was wrong" note to Requests
  queuedRequestId,   // string | null
  ideasLoading,      // boolean — disables "More like this"
  leagueContext = '', // master-admin notes — forwarded to /api/captions
  athleteVoice = null, // v4.5.17: self-authored "about me" for the spotlit player
  isMaster = false,  // v4.7.8: gates the delete button
  isAthlete = false, // v4.7.8: gates the thumbs-down note prompt
}) {
  const toast = useToast();
  const team = idea.team && idea.team !== 'BLW' ? getTeam(idea.team) : null;

  // Color tokens for THIS card (per-card drift; the parent scope may already
  // be tinted to a different team). Subtle: 6% bg, 25% border, full accent.
  const accent     = team?.color || colors.border;
  const accentDark = team?.dark  || team?.color || colors.text;
  const bgTint     = team ? `${team.color}0F` : colors.bg;
  const borderTint = team ? `${team.color}3D` : colors.borderLight;

  const [expanded, setExpanded] = useState(false);
  const [activePlatform, setActivePlatform] = useState('instagram');
  // v4.5.68: thumbs feedback. Reads + writes via idea-feedback-store
  // (localStorage today; can graduate to a Supabase column when the
  // server prompt actually consumes the signal). The current vote
  // tints the chip so the user sees their previous pick.
  const [vote, setVote] = useState(() => getFeedback(idea.id)?.vote || null);
  // v4.7.8: athlete thumbs-down inline note. When an athlete down-votes
  // an idea, we open a small inline textarea so they can explain WHAT
  // was wrong — wrong stat, wrong tone, wrong player angle, etc. That
  // note gets sent to Requests so the content team can act on the
  // feedback. Pre-fix the down-vote was a silent signal the athlete
  // had no way to elaborate on.
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [sendingNote, setSendingNote] = useState(false);
  const castVote = (v) => {
    const next = vote === v ? null : v; // toggle off if same vote re-clicked
    setVote(next);
    setFeedback(idea, next);
    if (next === 'down' && isAthlete && onThumbDownNote) {
      setNoteOpen(true);
    } else {
      setNoteOpen(false);
    }
  };
  const submitNote = async () => {
    if (!noteText.trim()) return;
    setSendingNote(true);
    try {
      await onThumbDownNote?.(idea, noteText.trim());
      setNoteOpen(false);
      setNoteText('');
    } finally { setSendingNote(false); }
  };
  // Edit overrides — keyed by platform. Once the user types, we hold their
  // text locally until they Copy or Regenerate.
  const [edits, setEdits] = useState({});
  const [regenerating, setRegenerating] = useState(null); // platform key | null
  const [draftingCaptions, setDraftingCaptions] = useState(false);
  const textareaRef = useRef(null);

  const queued = !!queuedRequestId;
  const hasCaptions = !!(idea.captions && Object.keys(idea.captions).length);
  const angleLabel = idea.angle ? (ANGLE_LABELS[idea.angle] || idea.angle.toUpperCase()) : null;
  const body = idea.narrative || idea.description || '';
  const stats = Array.isArray(idea.dataPoints) ? idea.dataPoints.filter(Boolean) : [];

  // Auto-resize the active textarea on mount + on edit so the user always
  // sees the full caption without inner scrollbars.
  useEffect(() => {
    if (!expanded || !hasCaptions) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [expanded, activePlatform, edits, hasCaptions, idea.captions]);

  const currentText = (() => {
    if (edits[activePlatform] != null) return edits[activePlatform];
    return idea.captions?.[activePlatform] || '';
  })();

  // ─── Actions ──────────────────────────────────────────────────────────────

  const draftCaptions = async () => {
    setDraftingCaptions(true);
    try {
      // v4.5.52: was plain fetch — broke after v4.5.37 added requireUser
      // to /api/captions. authedFetch attaches the JWT.
      const res = await authedFetch('/api/captions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea, leagueContext, athleteVoice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      onIdeaUpdate?.(idea.id, { captions: data.captions || {} });
      setExpanded(true);
      toast.success('Caption drafts ready', { detail: 'Edit, copy, or regenerate any variant' });
    } catch (err) {
      toast.error('Couldn\'t draft captions', { detail: err.message?.slice(0, 80) });
    } finally {
      setDraftingCaptions(false);
    }
  };

  const regeneratePlatform = async (platform) => {
    setRegenerating(platform);
    try {
      // v4.5.52: was plain fetch — broke after v4.5.37 added requireUser.
      const res = await authedFetch('/api/captions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea, platform, leagueContext, athleteVoice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const newText = data.captions?.[platform];
      if (newText) {
        onIdeaUpdate?.(idea.id, {
          captions: { ...(idea.captions || {}), [platform]: newText },
        });
        // Clear any local edit for this platform — the regen replaces it.
        setEdits(prev => {
          const next = { ...prev }; delete next[platform]; return next;
        });
      }
    } catch (err) {
      toast.error('Couldn\'t rewrite caption', { detail: err.message?.slice(0, 80) });
    } finally {
      setRegenerating(null);
    }
  };

  const copyCurrent = async () => {
    if (!currentText) return;
    try {
      await navigator.clipboard.writeText(currentText);
      toast.success('Copied', { detail: `${PLATFORM_TABS.find(p => p.key === activePlatform)?.label} caption on clipboard` });
    } catch {
      toast.error('Copy failed', { detail: 'Clipboard blocked by browser' });
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <article
      style={{
        background: colors.white,
        // Tinted strip on top instead of a side stripe — confident, editorial.
        borderRadius: radius.lg,
        border: `1px solid ${borderTint}`,
        overflow: 'hidden',
        transition: 'border-color 160ms ease, box-shadow 160ms ease',
        boxShadow: expanded ? '0 4px 12px rgba(17, 24, 39, 0.06), 0 1px 3px rgba(17, 24, 39, 0.04)' : '0 1px 2px rgba(17, 24, 39, 0.03)',
      }}
    >
      {/* Top tinted band carries the angle label + team chip. The band itself
          is the team color cue, so the body underneath stays calm. */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, padding: '8px 14px',
        background: bgTint,
        borderBottom: `1px solid ${borderTint}`,
        minHeight: 28,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {angleLabel && (
            <span style={{
              fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
              letterSpacing: 0.8, color: accentDark,
            }}>{angleLabel}</span>
          )}
          {idea.aiGenerated && (
            <span style={{
              fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
              letterSpacing: 0.7, color: '#7C3AED',
              background: 'rgba(124,58,237,0.10)',
              padding: '2px 6px', borderRadius: 3,
            }}>✨ AI</span>
          )}
        </div>
        {team
          ? <TeamChip teamId={idea.team} small withLogo />
          : <span style={{
              fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
              letterSpacing: 0.8, color: colors.textMuted,
            }}>BLW · LEAGUE</span>
        }
      </header>

      {/* Body — clickable to expand when captions are available */}
      <div
        onClick={() => { if (hasCaptions) setExpanded(e => !e); }}
        style={{
          padding: '14px 16px 12px',
          cursor: hasCaptions ? 'pointer' : 'default',
        }}
      >
        <h3 style={{
          margin: 0,
          fontFamily: fonts.heading,
          fontSize: 17, fontWeight: 700,
          letterSpacing: 0.1, lineHeight: 1.25,
          color: colors.text,
        }}>{idea.headline}</h3>
        {body && (
          <p style={{
            margin: '8px 0 0',
            fontSize: 13, lineHeight: 1.55,
            color: colors.textSecondary,
            // Cap line length for readability — narratives can be 280 chars.
            maxWidth: '60ch',
          }}>{body}</p>
        )}

        {/* Stat pills — tabular nums, team-tinted, sit on a baseline below
            the narrative. Empty → row is omitted entirely. */}
        {stats.length > 0 && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 6,
            marginTop: 10,
          }}>
            {stats.map((s, i) => (
              <span
                key={i}
                className="tnum"
                style={{
                  fontFamily: fonts.condensed,
                  fontSize: 11, fontWeight: 700,
                  letterSpacing: 0.3, color: accentDark,
                  background: team ? `${team.color}1A` : colors.bg,
                  border: `1px solid ${team ? `${team.color}33` : colors.borderLight}`,
                  padding: '3px 8px', borderRadius: radius.sm,
                }}
              >{s}</span>
            ))}
          </div>
        )}
      </div>

      {/* Action row — primary CTAs sit here always. Caption controls live
          below in the expanded panel. The expand chevron only appears when
          captions exist (or after they're drafted). */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
        padding: '0 14px 12px',
      }}>
        {queued ? (
          <span style={{
            display: 'inline-flex', alignItems: 'stretch',
            borderRadius: radius.sm, overflow: 'hidden',
            border: '1px solid rgba(34,197,94,0.4)',
          }}>
            <span style={{
              background: 'rgba(34,197,94,0.12)', color: '#15803D',
              padding: '5px 10px', fontFamily: fonts.condensed,
              fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
              display: 'inline-flex', alignItems: 'center',
            }}>✓ Queued</span>
            <Link
              to={`/requests?id=${queuedRequestId}`}
              style={{
                background: '#15803D', color: '#fff',
                padding: '5px 10px', textDecoration: 'none',
                fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                letterSpacing: 0.4, display: 'inline-flex', alignItems: 'center',
              }}
            >View request →</Link>
          </span>
        ) : (
          <button
            onClick={() => onQueue?.(idea)}
            title="File this as a tracked pending request"
            style={{
              background: colors.white,
              border: `1px solid ${colors.border}`,
              color: colors.textSecondary,
              borderRadius: radius.sm, padding: '5px 10px',
              fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', letterSpacing: 0.4,
            }}
          >Send to Requests</button>
        )}

        <button
          onClick={() => onOpenInGenerate?.(idea)}
          title="Open Generate with team, template, and fields pre-filled"
          style={{
            background: accent, color: '#fff', border: 'none',
            borderRadius: radius.sm, padding: '5px 10px',
            fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
            cursor: 'pointer', letterSpacing: 0.4,
          }}
        >Open in Generate →</button>

        {/* v4.5.68: thumbs feedback. Up = "more like this please",
            down = "avoid this pattern". Stored locally for now;
            future server prompt will read getRecentFeedback() to
            bias generations. Toggling the active chip clears the
            vote. Tooltip surfaces the why. */}
        <span style={{ display: 'inline-flex', gap: 4, marginLeft: 4 }}>
          <button
            onClick={() => castVote('up')}
            title={vote === 'up' ? 'You gave this 👍 — click again to clear' : 'Tell the AI: more ideas like this'}
            style={{
              background: vote === 'up' ? '#ECFDF5' : 'transparent',
              border: `1px solid ${vote === 'up' ? '#22C55E' : colors.border}`,
              color: vote === 'up' ? '#15803D' : colors.textSecondary,
              borderRadius: radius.sm, padding: '4px 8px', cursor: 'pointer',
              fontSize: 12, lineHeight: 1, fontFamily: fonts.condensed,
            }}
          >👍</button>
          <button
            onClick={() => castVote('down')}
            title={vote === 'down' ? 'You gave this 👎 — click again to clear' : 'Tell the AI: avoid this angle'}
            style={{
              background: vote === 'down' ? '#FEF2F2' : 'transparent',
              border: `1px solid ${vote === 'down' ? '#EF4444' : colors.border}`,
              color: vote === 'down' ? '#991B1B' : colors.textSecondary,
              borderRadius: radius.sm, padding: '4px 8px', cursor: 'pointer',
              fontSize: 12, lineHeight: 1, fontFamily: fonts.condensed,
            }}
          >👎</button>
        </span>

        {/* Push the right-side actions to the far edge */}
        <span style={{ flex: 1 }} />

        {idea.aiGenerated && onMoreLikeThis && (() => {
          // Label the button by the actual scope of the regen so the user
          // knows whether they're getting more about the SAME player, the
          // SAME team, or just BLW-wide variants.
          const playerName = (idea?.prefill?.playerName || '').trim();
          const playerLast = playerName ? playerName.split(/\s+/).pop() : '';
          const isPlayer = !!playerLast;
          const isTeam = !!(idea.team && idea.team !== 'BLW');
          const label = isPlayer
            ? `+ More about ${playerLast}`
            : isTeam
              ? `+ More about ${idea.team}`
              : '+ More like this';
          const tip = isPlayer
            ? `Generate 3 more ideas about ${playerName}`
            : isTeam
              ? `Generate 3 more ideas scoped to ${idea.team}`
              : 'Generate 3 more ideas in the same style';
          return (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMoreLikeThis(idea); }}
              disabled={ideasLoading}
              title={tip}
              style={{
                background: 'transparent',
                border: `1px solid ${colors.borderLight}`,
                color: colors.textSecondary,
                borderRadius: radius.sm, padding: '5px 9px',
                fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                cursor: ideasLoading ? 'wait' : 'pointer',
              }}
            >{label}</button>
          );
        })()}

        {/* v4.7.8: master-only delete. Sits all the way at the right so it
            doesn't compete with the primary CTAs and reads as a destructive
            action. Confirms before firing — the underlying dismissIdea
            does a hard DELETE on the row, not a soft-hide. */}
        {isMaster && onDelete && (
          <button
            onClick={(e) => {
              e.preventDefault(); e.stopPropagation();
              if (window.confirm('Delete this idea? Cannot be undone.')) onDelete(idea);
            }}
            title="Master admin — permanently remove this idea"
            style={{
              background: 'transparent',
              border: `1px solid ${colors.border}`,
              color: colors.textMuted,
              borderRadius: radius.sm, padding: '5px 9px',
              fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
              cursor: 'pointer',
            }}
          >🗑</button>
        )}

        {hasCaptions ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
            title={expanded ? 'Hide captions' : 'Show caption drafts'}
            style={{
              background: 'transparent',
              border: `1px solid ${colors.borderLight}`,
              color: colors.textSecondary,
              borderRadius: radius.sm, padding: '5px 9px',
              fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            <span>{expanded ? 'Hide captions' : 'Show captions'}</span>
            <span style={{
              display: 'inline-block',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 160ms ease',
              fontSize: 9,
            }}>▾</span>
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); draftCaptions(); }}
            disabled={draftingCaptions}
            title="Use AI to draft Instagram / Twitter / Story captions for this idea"
            style={{
              background: 'rgba(124,58,237,0.10)',
              border: '1px solid rgba(124,58,237,0.30)',
              color: '#7C3AED',
              borderRadius: radius.sm, padding: '5px 10px',
              fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
              cursor: draftingCaptions ? 'wait' : 'pointer',
            }}
          >{draftingCaptions ? '… DRAFTING' : '✨ DRAFT CAPTIONS'}</button>
        )}
      </div>

      {/* v4.7.8: athlete thumbs-down note prompt. Opens inline below the
          action row when an athlete clicks 👎 so they can elaborate on
          what was wrong. Note goes to the requests inbox tied to the
          idea so content staff sees the specific complaint, not just
          the silent down-vote signal. */}
      {noteOpen && (
        <div style={{
          marginTop: 10, padding: 12,
          background: '#FEF2F2', border: '1px solid #FCA5A5',
          borderRadius: radius.base,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#991B1B', marginBottom: 4 }}>
            What was wrong with this one?
          </div>
          <div style={{ fontSize: 11, color: '#991B1B', lineHeight: 1.5, marginBottom: 8, opacity: 0.85 }}>
            Tell the content team specifically — wrong stat, wrong tone, wrong angle, missing context. Lands in the requests inbox so they can act on it.
          </div>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="e.g. The HR count is wrong — that was last season. Or: this angle frames me as a slugger but I think of myself as a contact hitter."
            rows={3}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: 8, borderRadius: radius.sm,
              border: '1px solid #FCA5A5', background: '#FFFFFF',
              fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5,
              resize: 'vertical', minHeight: 60,
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={submitNote}
              disabled={sendingNote || !noteText.trim()}
              style={{
                background: '#DC2626', color: '#fff', border: 'none',
                borderRadius: radius.sm, padding: '6px 14px',
                fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
                cursor: sendingNote || !noteText.trim() ? 'not-allowed' : 'pointer',
                opacity: sendingNote || !noteText.trim() ? 0.6 : 1,
              }}
            >{sendingNote ? 'Sending…' : 'Send to content team'}</button>
            <button
              onClick={() => { setNoteOpen(false); setNoteText(''); }}
              disabled={sendingNote}
              style={{
                background: 'transparent', color: '#991B1B', border: '1px solid #FCA5A5',
                borderRadius: radius.sm, padding: '6px 14px',
                fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
                cursor: sendingNote ? 'not-allowed' : 'pointer',
              }}
            >Skip</button>
          </div>
        </div>
      )}

      {/* Caption drafts panel — tabs + editable textarea + copy/regen.
          Animated open/close via display + grid-template-rows trick. */}
      {hasCaptions && (
        <div
          style={{
            display: 'grid',
            gridTemplateRows: expanded ? '1fr' : '0fr',
            transition: 'grid-template-rows 220ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          <div style={{ overflow: 'hidden' }}>
            <div style={{
              padding: '14px 16px 16px',
              background: colors.bg,
              borderTop: `1px solid ${colors.borderLight}`,
            }}>
              {/* Tabs */}
              <div role="tablist" style={{
                display: 'flex', gap: 4,
                background: colors.white,
                border: `1px solid ${colors.borderLight}`,
                borderRadius: radius.base,
                padding: 3,
                marginBottom: 10,
              }}>
                {PLATFORM_TABS.map(p => {
                  const active = p.key === activePlatform;
                  const empty = !idea.captions?.[p.key];
                  return (
                    <button
                      key={p.key}
                      role="tab"
                      aria-selected={active}
                      onClick={() => setActivePlatform(p.key)}
                      style={{
                        flex: 1,
                        background: active ? accent : 'transparent',
                        color: active ? '#fff' : (empty ? colors.textMuted : colors.text),
                        border: 'none',
                        borderRadius: radius.sm,
                        padding: '6px 10px',
                        fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                        letterSpacing: 0.4,
                        cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        transition: 'background 160ms ease, color 160ms ease',
                      }}
                    >
                      <span style={{ opacity: active ? 1 : 0.7 }}>{p.icon}</span>
                      <span>{p.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Editable caption */}
              <div style={{
                position: 'relative',
                background: colors.white,
                border: `1px solid ${colors.borderLight}`,
                borderRadius: radius.base,
                padding: '10px 12px',
              }}>
                <textarea
                  ref={textareaRef}
                  value={currentText}
                  onChange={(e) => setEdits(prev => ({ ...prev, [activePlatform]: e.target.value }))}
                  spellCheck={true}
                  placeholder={idea.captions?.[activePlatform] ? '' : 'No draft yet for this platform'}
                  style={{
                    width: '100%',
                    minHeight: 60,
                    border: 'none',
                    outline: 'none',
                    resize: 'none',
                    fontFamily: fonts.body,
                    fontSize: 13,
                    lineHeight: 1.55,
                    color: colors.text,
                    background: 'transparent',
                  }}
                />
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 8, marginTop: 8, paddingTop: 8,
                  borderTop: `1px dashed ${colors.borderLight}`,
                }}>
                  <span className="tnum" style={{
                    fontFamily: fonts.condensed,
                    fontSize: 10, fontWeight: 600,
                    color: colors.textMuted, letterSpacing: 0.3,
                  }}>{currentText.length} char{currentText.length === 1 ? '' : 's'}{edits[activePlatform] != null ? ' · edited' : ''}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => regeneratePlatform(activePlatform)}
                      disabled={regenerating === activePlatform}
                      title="Rewrite this caption with AI"
                      style={{
                        background: 'transparent',
                        border: `1px solid ${colors.borderLight}`,
                        color: colors.textSecondary,
                        borderRadius: radius.sm, padding: '4px 9px',
                        fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                        letterSpacing: 0.4,
                        cursor: regenerating === activePlatform ? 'wait' : 'pointer',
                      }}
                    >{regenerating === activePlatform ? '…' : '↻'} Rewrite</button>
                    <button
                      onClick={copyCurrent}
                      disabled={!currentText}
                      style={{
                        background: accent, color: '#fff', border: 'none',
                        borderRadius: radius.sm, padding: '4px 11px',
                        fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
                        letterSpacing: 0.5,
                        cursor: currentText ? 'pointer' : 'not-allowed',
                        opacity: currentText ? 1 : 0.6,
                      }}
                    >Copy</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
