// Shade Photos — a player's onsite photos pulled live from Shade by the tags
// applied in Rapid Tag. Closes the loop: tag in Rapid Tag → appears here under
// the player. Staff-only (reads go through the master-keyed /api/shade bridge);
// renders nothing when Shade isn't connected or the player has no tagged photos.

import { useState, useEffect } from 'react';
import { Card, SectionHeading } from './components';
import { colors, fonts, radius } from './theme';
import { useAuth, isStaffRole } from './auth';
import { authedJson } from './authed-fetch';

export function ShadePlayerGallery({ playerName }) {
  const { role } = useAuth();
  const [state, setState] = useState({ loading: true, assets: [], err: null, connected: true });

  useEffect(() => {
    if (!playerName || !isStaffRole(role)) { setState(s => ({ ...s, loading: false })); return; }
    let cancelled = false;
    (async () => {
      try {
        const cfg = await authedJson('/api/shade?action=config');
        if (cancelled) return;
        if (!cfg.connected) { setState({ loading: false, assets: [], err: null, connected: false }); return; }
        const r = await authedJson('/api/shade', { method: 'POST', body: { action: 'player', player: playerName } });
        if (cancelled) return;
        setState({ loading: false, assets: r.assets || [], err: null, connected: true });
      } catch (e) {
        if (!cancelled) setState({ loading: false, assets: [], err: e.message, connected: true });
      }
    })();
    return () => { cancelled = true; };
  }, [playerName, role]);

  if (!isStaffRole(role)) return null;           // staff only
  if (!state.connected) return null;             // Shade not wired up — stay quiet
  if (state.loading) {
    return <Card><div style={{ padding: 16, color: colors.textSecondary, fontSize: 13 }}>Loading Shade photos…</div></Card>;
  }
  if (state.err) {
    return <Card><div style={{ padding: 12, fontSize: 12, color: '#991B1B' }}>Shade photos couldn’t load: {state.err}</div></Card>;
  }
  if (!state.assets.length) return null;          // nothing tagged to this player yet

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <SectionHeading style={{ margin: 0 }}>Shade Photos</SectionHeading>
        <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed }}>
          {state.assets.length} from onsite drops
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
        {state.assets.map(a => (
          <a key={a.id} href={a.previewUrl} target="_blank" rel="noreferrer"
            title={a.name}
            style={{
              display: 'block', aspectRatio: '3 / 2', borderRadius: radius.sm,
              overflow: 'hidden', background: '#0B0D10', border: `1px solid ${colors.borderLight}`,
            }}>
            <img src={a.previewUrl} alt={a.name} loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </a>
        ))}
      </div>
    </Card>
  );
}
