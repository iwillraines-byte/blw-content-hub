// Admin-only tool for managing team-affiliation overrides — trades, FA
// signings, retirements, anything where the source-of-truth Grand Slam
// API still reports the wrong team.
//
// Each override is a row in `manual_players` with the new team set.
// The data layer treats those rows as authoritative when assembling
// rosters and resolving player pages.
//
// Two flows in one card:
//   1. "Apply 2026 preset trades" — one-click bulk import of the 18
//      hand-curated trades baked into the server endpoint.
//   2. Per-player editor — search any known player, set a new team,
//      or revoke an existing override (returns them to API team).

import { useEffect, useMemo, useState } from 'react';
import { Card, SectionHeading, Label, RedButton, OutlineButton, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { TEAMS, fetchAllData, fetchTeamRosterFromApi } from '../data';
import { authedJson } from '../authed-fetch';
import { useToast } from '../toast';
import { refreshFromCloud } from '../cloud-reader';

export default function PlayerTradesCard() {
  const toast = useToast();
  const [overrides, setOverrides] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);  // [{ name, team }]
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [applyingPreset, setApplyingPreset] = useState(false);

  // Load known overrides + a roster of all known players (API + manual)
  // so the search is comprehensive.
  const reload = async () => {
    try {
      const data = await authedJson('/api/admin-player-trades', {
        method: 'POST',
        body: { action: 'list' },
      });
      setOverrides(data.overrides || []);
    } catch (err) {
      toast.error('Failed to load overrides', { detail: err.message });
    }
  };
  useEffect(() => { reload(); }, []);

  // Build a flat name+team list once: stats players from every team +
  // existing overrides. Used by the search dropdown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch the league-wide stats (already cached after dashboard load)
        const data = await fetchAllData();
        const seen = new Set();
        const list = [];
        for (const p of (data?.batting || [])) {
          if (!p?.name || seen.has(p.name)) continue;
          seen.add(p.name);
          list.push({ name: p.name, apiTeam: p.team });
        }
        for (const p of (data?.pitching || [])) {
          if (!p?.name || seen.has(p.name)) continue;
          seen.add(p.name);
          list.push({ name: p.name, apiTeam: p.team });
        }
        // Pull every team's roster too — covers players who haven't
        // accumulated stats but are on the roster (rookies, late signings).
        const rosters = await Promise.all(TEAMS.map(t => fetchTeamRosterFromApi(t.id).catch(() => [])));
        for (let i = 0; i < TEAMS.length; i++) {
          const teamId = TEAMS[i].id;
          for (const p of (rosters[i] || [])) {
            const name = p?.name || `${p?.firstName || ''} ${p?.lastName || ''}`.trim();
            if (!name || seen.has(name)) continue;
            seen.add(name);
            list.push({ name, apiTeam: teamId });
          }
        }
        if (!cancelled) {
          list.sort((a, b) => a.name.localeCompare(b.name));
          setAllPlayers(list);
        }
      } catch {
        // Non-fatal — search just won't autocomplete from the API
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Map of normalized name → override row, for "current team" badge in search.
  const overrideByName = useMemo(() => {
    const m = new Map();
    for (const o of overrides) {
      const fullName = `${o.first_name || ''} ${o.last_name || ''}`.trim().toLowerCase();
      m.set(fullName, o);
      // Also key by lastname-only so a single-token search hits.
      m.set((o.last_name || '').toLowerCase(), o);
    }
    return m;
  }, [overrides]);

  // Filter the player list by the search box.
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return allPlayers
      .filter(p => p.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [search, allPlayers]);

  // Quickly resolve "what team is this player REALLY on" — override beats API.
  const currentTeam = (player) => {
    const o = overrideByName.get(player.name.toLowerCase());
    if (o?.team) return { team: o.team, source: 'override' };
    return { team: player.apiTeam, source: 'api' };
  };

  // After ANY mutation we need to (a) re-fetch the override list for the
  // UI, and (b) force a cloud-hydrate so the new manual_players rows
  // land in local IDB — otherwise team rosters and player pages won't
  // see the change until the next 10-min throttled auto-hydrate.
  const refreshAfterMutation = async () => {
    await reload();
    try { await refreshFromCloud({ force: true }); } catch {}
  };

  const assign = async (name, team) => {
    setBusy(true);
    try {
      await authedJson('/api/admin-player-trades', {
        method: 'POST',
        body: { action: 'assign', name, team },
      });
      toast.success(`${name} → ${team}`);
      await refreshAfterMutation();
    } catch (err) {
      toast.error('Assign failed', { detail: err.message });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (name) => {
    if (!confirm(`Remove team override for ${name}? They'll return to whatever team the API has them on.`)) return;
    setBusy(true);
    try {
      await authedJson('/api/admin-player-trades', {
        method: 'POST',
        body: { action: 'revoke', name },
      });
      toast.success(`Override removed for ${name}`);
      await refreshAfterMutation();
    } catch (err) {
      toast.error('Revoke failed', { detail: err.message });
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = async () => {
    if (!confirm('Apply the 2026 preset trades (18 players)? This is idempotent — re-running just re-asserts the assignments.')) return;
    setApplyingPreset(true);
    try {
      const res = await authedJson('/api/admin-player-trades', {
        method: 'POST',
        body: { action: 'apply-preset', preset: 'trades-2026' },
      });
      const sc = res.successCount ?? res.results?.length ?? 0;
      const ec = res.errorCount ?? 0;
      if (ec === 0) toast.success(`Preset applied — ${sc} trades`);
      else toast.warn(`Preset finished with ${ec} errors`, { detail: res.errors?.map(e => e.name).join(', ') });
      await refreshAfterMutation();
    } catch (err) {
      toast.error('Preset failed', { detail: err.message });
    } finally {
      setApplyingPreset(false);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <SectionHeading style={{ marginBottom: 0 }}>Player team overrides</SectionHeading>
        <span style={{
          fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 1,
          color: colors.textMuted, textTransform: 'uppercase',
        }}>
          {overrides.length} active
        </span>
      </div>
      <p style={{ fontSize: 12, color: colors.textSecondary, margin: '2px 0 14px', lineHeight: 1.5 }}>
        The Grand Slam API doesn't reflect mid-season trades, FA signings, or retirements. Use this tool to assign a player to a different team — every roster + player page on the app will respect the override immediately.
      </p>

      {/* Preset button */}
      <div style={{
        padding: 12, marginBottom: 12, borderRadius: radius.base,
        background: colors.bg, border: `1px solid ${colors.borderLight}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ flex: '1 1 240px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>2026 preset trades</div>
          <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
            Bulk-applies the 18 hand-curated trades for the current season. Idempotent — safe to re-run.
          </div>
        </div>
        <RedButton onClick={applyPreset} disabled={applyingPreset || busy} style={{ padding: '8px 16px', fontSize: 12 }}>
          {applyingPreset ? 'Applying…' : '⚡ Apply 2026 trades'}
        </RedButton>
      </div>

      {/* Search */}
      <Label>Find a player</Label>
      <input
        type="search"
        placeholder="Type a name — Brody Livingston, Konnor Jaso, …"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ ...inputStyle, fontSize: 13 }}
      />

      {matches.length > 0 && (
        <div style={{
          marginTop: 8, border: `1px solid ${colors.borderLight}`, borderRadius: radius.base,
          maxHeight: 320, overflowY: 'auto',
        }}>
          {matches.map(p => {
            const { team: curTeam, source } = currentTeam(p);
            return (
              <div key={p.name} style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) 110px 130px auto',
                gap: 10, alignItems: 'center',
                padding: 8, borderBottom: `1px solid ${colors.divider}`,
                background: colors.white,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.condensed, letterSpacing: 0.4 }}>
                    API team: {p.apiTeam || '?'}
                  </div>
                </div>
                <div>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '2px 8px', borderRadius: radius.full,
                    background: source === 'override' ? colors.redLight : colors.bg,
                    color: source === 'override' ? colors.red : colors.textSecondary,
                    border: `1px solid ${source === 'override' ? colors.redBorder : colors.borderLight}`,
                    fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                  }}>
                    {source === 'override' ? '↪' : '✓'} {curTeam}
                  </span>
                </div>
                <select
                  value={curTeam}
                  onChange={e => e.target.value && assign(p.name, e.target.value)}
                  disabled={busy}
                  style={{ ...selectStyle, fontSize: 11, padding: '5px 6px' }}
                >
                  {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id} — {t.name}</option>)}
                </select>
                {source === 'override' && (
                  <button
                    onClick={() => revoke(p.name)}
                    disabled={busy}
                    title="Remove the override (returns to API team)"
                    style={{
                      background: 'transparent', border: `1px solid ${colors.border}`,
                      color: colors.textSecondary, padding: '4px 8px', borderRadius: radius.sm,
                      cursor: 'pointer', fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                      letterSpacing: 0.4, textTransform: 'uppercase',
                    }}>↶ Revert</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Existing overrides table */}
      {overrides.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: colors.text }}>
            Active overrides ({overrides.length})
          </summary>
          <div style={{
            marginTop: 8, border: `1px solid ${colors.borderLight}`, borderRadius: radius.base,
            maxHeight: 360, overflowY: 'auto',
          }}>
            {overrides.map(o => {
              const fullName = `${o.first_name || ''} ${o.last_name || ''}`.trim();
              return (
                <div key={o.id} style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) 70px 130px auto',
                  gap: 10, alignItems: 'center',
                  padding: 8, borderBottom: `1px solid ${colors.divider}`,
                }}>
                  <div style={{ fontSize: 13, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {fullName || o.last_name}
                  </div>
                  <div style={{
                    fontFamily: fonts.condensed, fontSize: 10, color: colors.textMuted, letterSpacing: 0.4,
                  }}>
                    #{o.num || '—'}
                  </div>
                  <select
                    value={o.team}
                    onChange={e => assign(fullName || o.last_name, e.target.value)}
                    disabled={busy}
                    style={{ ...selectStyle, fontSize: 11, padding: '5px 6px' }}
                  >
                    {TEAMS.map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
                  </select>
                  <button
                    onClick={() => revoke(fullName || o.last_name)}
                    disabled={busy}
                    style={{
                      background: 'transparent', border: `1px solid ${colors.border}`,
                      color: colors.textSecondary, padding: '4px 8px', borderRadius: radius.sm,
                      cursor: 'pointer', fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                      letterSpacing: 0.4, textTransform: 'uppercase',
                    }}>✕ Remove</button>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </Card>
  );
}
