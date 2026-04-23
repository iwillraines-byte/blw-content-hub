// Cmd+K / Ctrl+K quick switcher. Fuzzy-searches across teams, players,
// templates, and top-level pages. Lives at the app root so any page can
// trigger the modal via keyboard.
//
// Scoring: tokens in the query must all appear as substrings of the item
// label (case-insensitive). Earlier token matches rank higher. Ties broken
// by kind priority (page > team > player > template).

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TEAMS, TEMPLATES, getAllPlayers, playerSlug } from './data';
import { TEMPLATE_TYPES } from './template-config';
import { colors, fonts, radius } from './theme';

const PAGES = [
  { id: 'page:dashboard',    label: 'Dashboard',      path: '/dashboard',   icon: '⌂',  hint: 'Home' },
  { id: 'page:generate',     label: 'Generate',       path: '/generate',    icon: '✎',  hint: 'Create a new graphic' },
  { id: 'page:requests',     label: 'Requests',       path: '/requests',    icon: '☰',  hint: 'Track content requests' },
  { id: 'page:game-center',  label: 'ProWiffle Stats', path: '/game-center', icon: '◈', hint: 'Batting / pitching leaders' },
  { id: 'page:files',        label: 'Files',          path: '/files',       icon: '◫',  hint: 'Upload + tag media' },
  { id: 'page:settings',     label: 'Settings',       path: '/settings',    icon: '⚙',  hint: 'API keys, connected accounts' },
];

// Kind priority for tie-breaking — lower = surfaces first.
const KIND_PRIORITY = { page: 0, team: 1, player: 2, template: 3 };

// Score a single item against the query. Returns null if any token misses.
function score(label, tokens) {
  const l = label.toLowerCase();
  let total = 0;
  for (const t of tokens) {
    const idx = l.indexOf(t);
    if (idx === -1) return null;
    total += idx;             // earlier matches = smaller score = better
    total += l.length - t.length; // shorter labels rank higher
  }
  return total;
}

export function QuickSwitcher() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Global hotkey — Cmd+K on Mac, Ctrl+K elsewhere.
  useEffect(() => {
    const onKey = (e) => {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(v => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus the input whenever the modal opens.
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    } else {
      setCursor(0);
    }
  }, [open]);

  // Build the item universe once. Players list is large-ish (200+) but
  // filtering is trivial on a substring match, so we don't memoise aggressively.
  const allItems = useMemo(() => {
    const items = [];
    for (const p of PAGES) items.push({ ...p, kind: 'page' });
    for (const t of TEAMS) {
      items.push({
        id: `team:${t.id}`, kind: 'team',
        label: `${t.id} · ${t.name}`, icon: t.id,
        hint: `${t.record} · rank #${t.rank}`,
        path: `/teams/${t.slug}`,
        color: t.color,
      });
    }
    try {
      const players = getAllPlayers();
      for (const p of players) {
        const team = TEAMS.find(t => t.id === p.team);
        if (!team) continue;
        items.push({
          id: `player:${p.team}:${p.name}`,
          kind: 'player',
          label: p.name,
          icon: p.num ? `#${p.num}` : '👤',
          hint: `${team.name} · ${p.statType || 'roster'}`,
          path: `/teams/${team.slug}/players/${playerSlug(p)}`,
          color: team.color,
        });
      }
    } catch {}
    for (const [key, t] of Object.entries(TEMPLATE_TYPES)) {
      items.push({
        id: `template:${key}`,
        kind: 'template',
        label: `Generate · ${t.name}`,
        icon: t.icon || '✎',
        hint: t.description || 'Open Generate with this template',
        path: `/generate?template=${key}`,
      });
    }
    return items;
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Empty query: surface pages + favorite starting points.
      return allItems.filter(i => i.kind === 'page' || i.kind === 'template').slice(0, 10);
    }
    const tokens = q.split(/\s+/).filter(Boolean);
    const scored = [];
    for (const item of allItems) {
      const s = score(item.label, tokens);
      if (s == null) continue;
      scored.push({ item, score: s, kindRank: KIND_PRIORITY[item.kind] ?? 9 });
    }
    scored.sort((a, b) => a.kindRank - b.kindRank || a.score - b.score);
    return scored.slice(0, 25).map(x => x.item);
  }, [query, allItems]);

  const pick = useCallback((item) => {
    if (!item) return;
    setOpen(false);
    setQuery('');
    setCursor(0);
    navigate(item.path);
  }, [navigate]);

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => Math.min(results.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(results[cursor]);
    }
  };

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'rgba(17,24,39,0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 'max(12vh, 60px) 16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.white, borderRadius: radius.lg,
          width: 560, maxWidth: '100%',
          boxShadow: '0 30px 80px rgba(0,0,0,0.35)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100vh - 24vh)',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${colors.border}` }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={onInputKey}
            placeholder="Jump to a team, player, template, or page…"
            style={{
              width: '100%', border: 'none', outline: 'none',
              fontFamily: fonts.body, fontSize: 16, background: 'transparent',
              color: colors.text,
            }}
          />
        </div>
        <div style={{ overflowY: 'auto', padding: '6px 0' }}>
          {results.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
              No matches. Try a player's last name or a team code.
            </div>
          ) : results.map((item, i) => {
            const active = i === cursor;
            return (
              <div
                key={item.id}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(item)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 16px', cursor: 'pointer',
                  background: active ? colors.bg : 'transparent',
                  borderLeft: `3px solid ${active ? colors.red : 'transparent'}`,
                }}
              >
                <span style={{
                  width: 32, height: 32, borderRadius: radius.sm,
                  background: item.color ? item.color : colors.bg,
                  color: item.color ? '#fff' : colors.textSecondary,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
                  flexShrink: 0,
                }}>{item.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.label}
                  </div>
                  {item.hint && (
                    <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, letterSpacing: 0.3 }}>
                      {item.hint}
                    </div>
                  )}
                </div>
                <span style={{
                  fontFamily: fonts.condensed, fontSize: 9, fontWeight: 700,
                  color: colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase',
                  flexShrink: 0,
                }}>{item.kind}</span>
              </div>
            );
          })}
        </div>
        <div style={{
          padding: '8px 16px', borderTop: `1px solid ${colors.borderLight}`,
          display: 'flex', alignItems: 'center', gap: 12,
          fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted,
          letterSpacing: 0.5,
        }}>
          <span>↑↓ to navigate</span>
          <span>↵ to open</span>
          <span>ESC to close</span>
          <span style={{ flex: 1 }} />
          <span>⌘K</span>
        </div>
      </div>
    </div>
  );
}
