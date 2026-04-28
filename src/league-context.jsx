// League Context — the master-admin-editable narrative blob that grounds
// the AI tools (ideas + captions) in trades, draft results, storylines,
// rivalries, and anything else that isn't in the live stats feed.
//
// `useLeagueContext()` fetches once on mount (against /api/league-context)
// and exposes the value + a save() helper. The dashboard's idea generator
// reads this and forwards it to /api/ideas; the LeagueContextCard renders
// the editing UI for master admins only.

import { useState, useEffect, useCallback, useRef } from 'react';
import { authedFetch } from './authed-fetch';
import { useAuth } from './auth';
import { Card, SectionHeading } from './components';
import { colors, fonts, radius } from './theme';
import { useToast } from './toast';

const ENDPOINT = '/api/league-context';
const MAX_CHARS = 8000;

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useLeagueContext() {
  const { user, role } = useAuth();
  const [notes, setNotes] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [updatedBy, setUpdatedBy] = useState(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const fetchedFor = useRef(null); // user.id we last fetched for

  // Fetch when the user's session resolves. Don't fetch unauthenticated —
  // the endpoint requires a Bearer token and would 401.
  useEffect(() => {
    if (!user?.id) return;
    if (fetchedFor.current === user.id) return;
    fetchedFor.current = user.id;
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch(ENDPOINT);
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setNotes(data.notes || '');
          setUpdatedAt(data.updated_at || null);
          setUpdatedBy(data.updated_by || null);
          setTableMissing(!!data.tableMissing);
        }
      } catch {
        // Silent — the dashboard works fine without league context.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const save = useCallback(async (newNotes) => {
    if (role !== 'master_admin') {
      throw new Error('Only master admins can edit league context');
    }
    setSaving(true);
    try {
      const res = await authedFetch(ENDPOINT, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes: newNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setNotes(data.notes || newNotes);
      setUpdatedAt(data.updated_at || new Date().toISOString());
      setUpdatedBy(data.updated_by || null);
      setTableMissing(false);
      return data;
    } finally {
      setSaving(false);
    }
  }, [role]);

  return { notes, updatedAt, updatedBy, tableMissing, loaded, saving, save };
}

// ─── Card ───────────────────────────────────────────────────────────────────
//
// Editable surface on the dashboard. Renders nothing for non-master-admins —
// they don't need to know it's there; their idea generation just gets the
// benefit. Master admins see a collapsible card with last-updated metadata,
// a textarea, and a Save button.

export function LeagueContextCard({ ctx }) {
  const { role } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [bootstrapped, setBootstrapped] = useState(false);

  // Seed the textarea once the fetch resolves.
  useEffect(() => {
    if (!ctx.loaded || bootstrapped) return;
    setDraft(ctx.notes || '');
    setBootstrapped(true);
  }, [ctx.loaded, ctx.notes, bootstrapped]);

  // Keep draft in sync if the upstream notes change AFTER bootstrap (rare —
  // e.g., another admin edited from a different session).
  useEffect(() => {
    if (!bootstrapped) return;
    if (draft === ctx.notes) return;
    // Only blow away the draft if user hasn't started typing — heuristic:
    // local draft length differs by ≤ 3 chars from upstream → still in sync.
  }, [ctx.notes]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (role !== 'master_admin') return null;

  const dirty = draft !== (ctx.notes || '');
  const charsLeft = MAX_CHARS - draft.length;
  const formatStamp = () => {
    if (!ctx.updatedAt) return 'Never edited';
    try {
      const d = new Date(ctx.updatedAt);
      const ago = Date.now() - d.getTime();
      if (ago < 60_000) return 'Just now';
      const mins = Math.floor(ago / 60_000);
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch { return ctx.updatedAt; }
  };

  const handleSave = async () => {
    try {
      await ctx.save(draft);
      toast.success('League context saved', { detail: 'Next batch of ideas will use this' });
    } catch (err) {
      toast.error('Couldn\'t save', { detail: err.message?.slice(0, 80) });
    }
  };

  const previewText = (ctx.notes || '').replace(/\s+/g, ' ').trim();
  const preview = previewText.length > 140 ? previewText.slice(0, 137) + '…' : previewText;

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header — clickable to toggle */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '14px 18px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: radius.sm,
            background: 'rgba(124,58,237,0.10)', color: '#7C3AED',
            fontSize: 13,
          }}>✦</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 8,
              flexWrap: 'wrap',
            }}>
              <SectionHeading style={{ margin: 0 }}>League context</SectionHeading>
              <span style={{
                fontFamily: fonts.condensed,
                fontSize: 10, fontWeight: 700,
                letterSpacing: 0.5, color: colors.textMuted,
              }}>ADMIN ONLY · feeds the AI tools</span>
            </div>
            {!open && (
              <div style={{
                fontSize: 12, color: colors.textSecondary,
                marginTop: 4, lineHeight: 1.4,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {preview || (
                  <span style={{ color: colors.textMuted, fontStyle: 'italic' }}>
                    No notes yet. Click to add trades, draft results, storylines.
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span className="tnum" style={{
            fontFamily: fonts.condensed,
            fontSize: 10, fontWeight: 700,
            color: colors.textMuted, letterSpacing: 0.4,
          }}>{formatStamp()}</span>
          <span style={{
            display: 'inline-block',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 160ms ease',
            color: colors.textMuted, fontSize: 11,
          }}>▾</span>
        </div>
      </button>

      {/* Expanded body */}
      <div style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        transition: 'grid-template-rows 220ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ padding: '0 18px 16px', borderTop: `1px solid ${colors.borderLight}` }}>
            <p style={{
              fontSize: 12, color: colors.textSecondary,
              margin: '12px 0 10px', lineHeight: 1.5,
              maxWidth: '60ch',
            }}>
              Free-form notes the AI uses when drafting ideas and captions. Trades, draft results, storylines, rivalries, callouts on quiet contributors. Anything not in the live stats feed.
            </p>

            {ctx.tableMissing && (
              <div style={{
                background: colors.warningBg || '#FEF3C7',
                border: `1px solid ${colors.warningBorder || '#FCD34D'}`,
                color: '#92400E',
                padding: '8px 12px', borderRadius: radius.sm,
                fontSize: 11, marginBottom: 10, lineHeight: 1.5,
              }}>
                <strong>Setup:</strong> Run the <code>CREATE TABLE league_context</code> statement from <code>api/league-context.js</code> in your Supabase SQL editor, then reload.
              </div>
            )}

            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS))}
              placeholder={EXAMPLE_PLACEHOLDER}
              spellCheck
              style={{
                width: '100%',
                minHeight: 180,
                fontFamily: fonts.body,
                fontSize: 13,
                lineHeight: 1.55,
                color: colors.text,
                background: colors.white,
                border: `1px solid ${colors.borderLight}`,
                borderRadius: radius.base,
                padding: '10px 12px',
                outline: 'none',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />

            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 10, marginTop: 8, flexWrap: 'wrap',
            }}>
              <span className="tnum" style={{
                fontFamily: fonts.condensed,
                fontSize: 11, fontWeight: 600,
                color: charsLeft < 200 ? colors.warning || '#D97706' : colors.textMuted,
                letterSpacing: 0.3,
              }}>
                {charsLeft.toLocaleString()} chars left
                {ctx.updatedBy && ` · last edit by ${ctx.updatedBy}`}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setDraft(ctx.notes || '')}
                  disabled={!dirty}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${colors.borderLight}`,
                    color: dirty ? colors.textSecondary : colors.textMuted,
                    borderRadius: radius.sm, padding: '6px 12px',
                    fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                    letterSpacing: 0.4,
                    cursor: dirty ? 'pointer' : 'not-allowed',
                  }}
                >Reset</button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!dirty || ctx.saving || ctx.tableMissing}
                  style={{
                    background: dirty && !ctx.saving ? '#7C3AED' : colors.bg,
                    border: 'none',
                    color: dirty && !ctx.saving ? '#fff' : colors.textMuted,
                    borderRadius: radius.sm, padding: '6px 14px',
                    fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800,
                    letterSpacing: 0.5,
                    cursor: dirty && !ctx.saving && !ctx.tableMissing ? 'pointer' : 'not-allowed',
                  }}
                >{ctx.saving ? 'SAVING…' : 'SAVE CONTEXT'}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

const EXAMPLE_PLACEHOLDER = `Examples of what to put here:

Trades & signings:
- Caleb Jeter signed with Dallas (3/12) — was the FA prize of the offseason. Pandas were 4-8 before this.
- Konnor Jaso traded LV → LAN, Preston Kolm went the other way.

Draft:
- 2026 draft won by Vegas — surprise pick of Jordan Robles 1st overall.
- Naturals over-drafted on pitching, may pivot at deadline.

Storylines:
- Sapphires are quietly 6-2 since the Aaron Reed call-up. No one's talking about them.
- Jaso vs Witty rivalry brewing — three plate appearances ended in stare-downs last week.

Anything specific or weird about THIS season:
- Park factor changes at Phoenix mean HR totals are 18% higher there.
- Three teams are tied for 4th, so the wildcard race is tight.`;
