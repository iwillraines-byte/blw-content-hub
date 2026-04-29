// Pager — minimal page-of-N control used by the content-ideas surfaces
// (dashboard, team page, player page). Renders nothing when there's only
// one page so it disappears for typical small lists.
//
// Pairs with `useIdeaPagination` below: the hook owns the page state and
// the slicing math, so callers just spread its return into the Pager and
// render `<list>.map(...)` over the sliced array.

import { useState, useEffect, useMemo, useRef } from 'react';
import { colors, fonts, radius } from './theme';

export const IDEAS_PAGE_SIZE = 4;

// usage:
//   const { page, totalPages, pageItems, setPage, pagerProps } = useIdeaPagination(ideas);
//   {pageItems.map(...)}
//   <Pager {...pagerProps} />
export function useIdeaPagination(items, pageSize = IDEAS_PAGE_SIZE) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil((items?.length || 0) / pageSize));

  // When the list grows from a prepend (e.g., "More about Jaso" returned
  // 3 fresh ideas), the user almost always wants to see the new ones, not
  // sit on whatever page they were on. Detect a head-of-list change and
  // jump back to page 0. Other length changes (deletes, refetch shrinking)
  // just clamp to a valid page.
  const lastFirstId = useRef(items?.[0]?.id || null);
  useEffect(() => {
    const firstId = items?.[0]?.id || null;
    if (firstId !== lastFirstId.current && lastFirstId.current !== null) {
      // head changed — likely a prepend. Reset to page 0.
      setPage(0);
    }
    lastFirstId.current = firstId;
  }, [items]);
  useEffect(() => {
    if (page >= totalPages) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  const pageItems = useMemo(() => {
    if (!Array.isArray(items)) return [];
    return items.slice(page * pageSize, (page + 1) * pageSize);
  }, [items, page, pageSize]);

  return {
    page,
    totalPages,
    pageItems,
    setPage,
    pagerProps: {
      page,
      totalPages,
      onPrev: () => setPage(p => Math.max(0, p - 1)),
      onNext: () => setPage(p => Math.min(totalPages - 1, p + 1)),
      total: items?.length || 0,
      pageSize,
    },
  };
}

export function Pager({ page, totalPages, onPrev, onNext, total, pageSize = IDEAS_PAGE_SIZE }) {
  if (totalPages <= 1) return null;
  const start = page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);
  const atStart = page === 0;
  const atEnd = page >= totalPages - 1;

  return (
    <div
      role="navigation"
      aria-label="Pagination"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, marginTop: 12, padding: '8px 4px',
        borderTop: `1px solid ${colors.borderLight}`,
      }}
    >
      <span className="tnum" style={{
        fontFamily: fonts.condensed,
        fontSize: 11, fontWeight: 700,
        letterSpacing: 0.4, color: colors.textMuted,
      }}>
        {start}–{end} of {total}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          type="button"
          onClick={onPrev}
          disabled={atStart}
          aria-label="Previous page"
          style={navBtnStyle(atStart)}
        >‹</button>
        <span className="tnum" style={{
          fontFamily: fonts.condensed,
          fontSize: 11, fontWeight: 700,
          letterSpacing: 0.4, color: colors.textSecondary,
          minWidth: 56, textAlign: 'center',
        }}>
          Page {page + 1} / {totalPages}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={atEnd}
          aria-label="Next page"
          style={navBtnStyle(atEnd)}
        >›</button>
      </div>
    </div>
  );
}

function navBtnStyle(disabled) {
  return {
    background: disabled ? colors.bg : colors.white,
    border: `1px solid ${colors.borderLight}`,
    color: disabled ? colors.textMuted : colors.text,
    width: 28, height: 28, borderRadius: radius.sm,
    fontSize: 16, lineHeight: 1, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'inherit',
    transition: 'background 160ms ease',
  };
}
