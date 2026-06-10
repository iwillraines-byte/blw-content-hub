// ─── Request conversation thread (v4.15.0) ───────────────────────────────────
// Replaces the buried comments toggle with a real two-way conversation:
// chronological bubbles (mine right, theirs left, role-tinted), status
// changes rendered as centered system pills, declines as a structured
// reason card. The composer writes through the existing saveComments
// dual-write (localStorage + Supabase) so nothing about persistence moved.

import { useEffect, useRef, useState } from 'react';
import { colors, fonts, radius } from './theme';
import { RedButton, inputStyle } from './components';

const roleTints = {
  admin:   { bg: '#DBEAFE', text: '#1E40AF' },
  team:    { bg: '#D1FAE5', text: '#065F46' },
  athlete: { bg: '#FEF3C7', text: '#92400E' },
  owner:   { bg: '#EDE9FE', text: '#5B21B6' },
};

export function RequestThread({ request, comments, meUserId, onSend, sendDisabled = false }) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);
  const sorted = [...(comments || [])].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  // Keep the newest message in view when the thread grows.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [sorted.length]);

  const send = () => {
    const text = draft.trim();
    if (!text || sendDisabled) return;
    onSend?.(text);
    setDraft('');
  };

  return (
    <div style={{
      marginTop: 12, paddingTop: 12,
      borderTop: `1px solid ${colors.divider}`,
    }}>
      <div
        ref={scrollRef}
        style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          maxHeight: 340, overflowY: 'auto',
          padding: '2px 4px', marginBottom: 10,
        }}
      >
        {sorted.length === 0 && (
          <div style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', padding: '8px 0' }}>
            No messages yet — start the conversation below.
          </div>
        )}
        {sorted.map(c => {
          // System pills — status flips render centered + muted so the
          // human conversation stays the visual focus.
          if (c.kind === 'status') {
            return (
              <div key={c.id} style={{ textAlign: 'center' }}>
                <span style={{
                  display: 'inline-block',
                  fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                  letterSpacing: 0.5, color: colors.textMuted,
                  background: colors.bg, border: `1px solid ${colors.borderLight}`,
                  borderRadius: 999, padding: '3px 10px',
                }}>{c.text}{c.time ? ` · ${c.time}` : ''}</span>
              </div>
            );
          }
          if (c.kind === 'decline') {
            return (
              <div key={c.id} style={{
                background: 'rgba(220,38,38,0.06)',
                border: '1px solid rgba(220,38,38,0.25)',
                borderRadius: radius.base, padding: '10px 12px',
              }}>
                <div style={{
                  fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
                  letterSpacing: 0.7, color: '#991B1B', marginBottom: 4,
                  textTransform: 'uppercase',
                }}>Declined{c.time ? ` · ${c.time}` : ''}</div>
                <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.5 }}>{c.text}</div>
              </div>
            );
          }
          const mine = !!meUserId && c.authorUserId === meUserId;
          const tint = roleTints[c.role] || roleTints.admin;
          return (
            <div key={c.id} style={{
              display: 'flex', flexDirection: 'column',
              alignItems: mine ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2,
                flexDirection: mine ? 'row-reverse' : 'row',
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: colors.text }}>
                  {mine ? 'You' : (c.author || 'Unknown')}
                </span>
                {c.role && (
                  <span style={{
                    fontSize: 9, fontFamily: fonts.condensed, fontWeight: 800,
                    padding: '1px 7px', borderRadius: 999,
                    background: tint.bg, color: tint.text,
                    textTransform: 'uppercase', letterSpacing: 0.4,
                  }}>{c.role}</span>
                )}
                <span style={{ fontSize: 10, color: colors.textMuted }}>{c.time}</span>
              </div>
              <div style={{
                maxWidth: '78%',
                background: mine ? 'rgba(220,38,38,0.07)' : colors.bg,
                border: `1px solid ${mine ? 'rgba(220,38,38,0.2)' : colors.borderLight}`,
                borderRadius: mine ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                padding: '8px 12px',
                fontSize: 13.5, color: colors.text, lineHeight: 1.5,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>{c.text}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder={`Message ${request?.requester && meUserId !== request?.requesterUserId ? request.requester : 'the team'}…`}
          style={{ ...inputStyle, flex: 1 }}
          disabled={sendDisabled}
        />
        <RedButton onClick={send} disabled={!draft.trim() || sendDisabled} style={{ padding: '8px 16px', fontSize: 12 }}>
          Send
        </RedButton>
      </div>
    </div>
  );
}
