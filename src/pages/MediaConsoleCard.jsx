// Media Console (v5.2.0) — master_admin only.
//
// One place to see the health of every image the app depends on, and to fix
// the ones that are broken, instead of chasing photo bugs back into the code:
//   • Library health — how many media blobs are cloud-synced vs stuck local-
//     only vs cloud-missing, with one-click bulk repair + re-download.
//   • Broken pins — profile photos pointing at media that isn't in the cloud
//     (the "blank on a new device" bug), with a one-click unpin.
//   • Player photos at a glance — all 70 canonical players, their resolved
//     avatar + a health dot, linking to the player page to set/replace.
//   • Team branding assets — which logo / wordmark files each team has.
//
// Everything here reuses the existing media store + cloud reader; the only new
// server surface is GET /api/media-health.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  getAllMedia, resyncMedia, resyncAllLocalOnlyMedia, deleteMedia,
  resolvePlayerAvatar, blobToObjectURL,
} from '../media-store';
import { getAllManualPlayers, upsertManualPlayer } from '../player-store';
import { refreshFromCloud } from '../cloud-reader';
import { CANONICAL_ROSTER_2026, TEAMS, getTeam, slugify, playerSlug } from '../data';
import { Card, SectionHeading, RedButton, OutlineButton } from '../components';
import { colors, fonts, radius } from '../theme';
import { authedFetch } from '../authed-fetch';
import { useToast } from '../toast';

const TEAM_LOGO_TYPES = ['LOGO_PRIMARY', 'LOGO_DARK', 'LOGO_LIGHT', 'LOGO_ICON', 'WORDMARK', 'TEAMPHOTO'];

// Classify one media record's cloud-sync health.
function mediaHealth(m) {
  if (!m) return 'missing';
  if (m.cloudBlobMissing) return 'cloud-missing';
  if (!m.cloudSyncedAt) return 'local-only';
  return 'synced';
}

const HEALTH_META = {
  synced:         { dot: '#16A34A', label: 'In the cloud' },
  'local-only':   { dot: '#B45309', label: 'Local only — not uploaded' },
  'cloud-missing':{ dot: '#B91C1C', label: 'Cloud image missing' },
  auto:           { dot: '#0369A1', label: 'Auto-matched (no explicit pin)' },
  blank:          { dot: '#9CA3AF', label: 'No photo' },
  missing:        { dot: '#B91C1C', label: 'Broken pin' },
};

// Find the manual_players row for a canonical player, disambiguating cousins
// by jersey number then first name (mirrors getPlayerByTeamLastName / the
// v5.1.6 identity anchor).
function findManualRow(rows, { team, lastName, firstName, num }) {
  const ln = String(lastName || '').toLowerCase();
  const sameTeamLast = rows.filter(r =>
    r.team === team && String(r.lastName || '').toLowerCase() === ln
  );
  if (sameTeamLast.length <= 1) return sameTeamLast[0] || null;
  const nn = num ? String(num).replace(/^0+/, '') : '';
  if (nn) {
    const byNum = sameTeamLast.find(r => String(r.num || '').replace(/^0+/, '') === nn);
    if (byNum) return byNum;
  }
  const fn = String(firstName || '').toLowerCase();
  if (fn) {
    const byFn = sameTeamLast.find(r => String(r.firstName || '').toLowerCase() === fn);
    if (byFn) return byFn;
  }
  return sameTeamLast[0] || null;
}

export default function MediaConsoleCard() {
  const toast = useToast();
  const [media, setMedia] = useState([]);
  const [manual, setManual] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(null); // 'repair' | 'redownload' | 'scan' | id
  const [orphans, setOrphans] = useState(null); // null = not scanned yet
  const [repairReport, setRepairReport] = useState(null);

  const load = useCallback(async () => {
    const [m, mp] = await Promise.all([getAllMedia(), getAllManualPlayers()]);
    setMedia(m || []);
    setManual(mp || []);
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Library health counts.
  const counts = useMemo(() => {
    const c = { total: media.length, synced: 0, 'local-only': 0, 'cloud-missing': 0 };
    for (const m of media) { const h = mediaHealth(m); if (c[h] != null) c[h]++; }
    return c;
  }, [media]);

  const byId = useMemo(() => {
    const map = new Map();
    for (const m of media) map.set(m.id, m);
    return map;
  }, [media]);

  const runRepair = useCallback(async () => {
    setBusy('repair'); setRepairReport(null);
    try {
      const report = await resyncAllLocalOnlyMedia();
      setRepairReport(report);
      await load();
      toast[report.failed > 0 ? 'error' : 'success'](
        report.total === 0 ? 'All media already in the cloud' : `Re-synced ${report.synced}/${report.total}`,
        report.failed > 0 ? { detail: `${report.failed} still failing` } : undefined,
      );
    } catch (e) {
      toast.error('Repair failed', { detail: String(e?.message || e).slice(0, 100) });
    } finally { setBusy(null); }
  }, [load, toast]);

  const runRedownload = useCallback(async () => {
    setBusy('redownload');
    try {
      await refreshFromCloud({ force: true });
      await load();
      toast.success('Re-pulled media from the cloud');
    } catch (e) {
      toast.error('Re-download failed', { detail: String(e?.message || e).slice(0, 100) });
    } finally { setBusy(null); }
  }, [load, toast]);

  const runScan = useCallback(async () => {
    setBusy('scan');
    try {
      const res = await authedFetch('/api/media-health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setOrphans(Array.isArray(j?.orphans) ? j.orphans : []);
    } catch (e) {
      toast.error('Scan failed', { detail: String(e?.message || e).slice(0, 100) });
      setOrphans([]);
    } finally { setBusy(null); }
  }, [toast]);

  const resyncOne = useCallback(async (id) => {
    setBusy(id);
    try {
      const rec = await resyncMedia(id);
      await load();
      toast[rec?.cloudSyncedAt ? 'success' : 'error'](
        rec?.cloudSyncedAt ? 'Re-synced' : 'Still not synced',
        rec?.cloudSyncError ? { detail: String(rec.cloudSyncError).slice(0, 100) } : undefined,
      );
    } catch (e) {
      toast.error('Re-sync failed', { detail: String(e?.message || e).slice(0, 100) });
    } finally { setBusy(null); }
  }, [load, toast]);

  const unpinOrphan = useCallback(async (row) => {
    setBusy(row.id);
    try {
      const res = await upsertManualPlayer({
        team: row.team,
        lastName: String(row.name || '').split(' ').pop(),
        firstName: String(row.name || '').split(' ').slice(0, -1).join(' '),
        num: row.num,
        updates: { profile_media_id: null },
        awaitCloud: true,
      });
      if (res?.cloud && res.cloud.ok === false) throw new Error(res.cloud.error || 'cloud sync failed');
      setOrphans(prev => (prev || []).filter(o => o.id !== row.id));
      await load();
      toast.success(`Unpinned ${row.name}`);
    } catch (e) {
      toast.error('Unpin failed', { detail: String(e?.message || e).slice(0, 100) });
    } finally { setBusy(null); }
  }, [load, toast]);

  // ── Player photo grid (all 70) ──────────────────────────────────────────────
  // Cousin flags per team so the avatar resolver disambiguates correctly.
  const rosterHealth = useMemo(() => {
    const lnCount = new Map();     // team|LN → count
    const lnFiCount = new Map();   // team|LN|FI → count
    for (const c of CANONICAL_ROSTER_2026) {
      const parts = String(c.name).trim().split(/\s+/);
      const ln = parts.slice(1).join(' ').toUpperCase();
      const fi = (parts[0] || '').charAt(0).toUpperCase();
      lnCount.set(`${c.team}|${ln}`, (lnCount.get(`${c.team}|${ln}`) || 0) + 1);
      lnFiCount.set(`${c.team}|${ln}|${fi}`, (lnFiCount.get(`${c.team}|${ln}|${fi}`) || 0) + 1);
    }
    return CANONICAL_ROSTER_2026.map(c => {
      const parts = String(c.name).trim().split(/\s+/);
      const firstName = parts[0] || '';
      const lastName = parts.slice(1).join(' ');
      const LN = lastName.toUpperCase();
      const FI = firstName.charAt(0).toUpperCase();
      const row = findManualRow(manual, { team: c.team, lastName, firstName, num: c.num });
      const profileMediaId = row?.profile_media_id || row?.profileMediaId || null;
      const player = { team: c.team, lastName, firstInitial: FI, num: c.num, firstName, name: c.name };
      const avatar = resolvePlayerAvatar(player, media, {
        profileMediaId,
        lastnameUnique: lnCount.get(`${c.team}|${LN}`) === 1,
        fiUnique: lnFiCount.get(`${c.team}|${LN}|${FI}`) === 1,
      });
      let health;
      if (profileMediaId) {
        const m = byId.get(profileMediaId);
        health = !m ? 'missing' : mediaHealth(m);
      } else {
        health = avatar?.blob ? 'auto' : 'blank';
      }
      return { c, firstName, lastName, avatar, health, slug: playerSlug(player) };
    });
  }, [manual, media, byId]);

  // Object URLs for the avatars actually shown, revoked on change/unmount.
  const avatarUrls = useMemo(() => {
    const urls = {};
    for (const r of rosterHealth) {
      if (r.avatar?.blob && !urls[r.avatar.id]) {
        try { urls[r.avatar.id] = blobToObjectURL(r.avatar.blob); } catch { /* skip */ }
      }
    }
    return urls;
  }, [rosterHealth]);
  useEffect(() => () => { Object.values(avatarUrls).forEach(u => { try { URL.revokeObjectURL(u); } catch {} }); }, [avatarUrls]);

  const rosterProblems = rosterHealth.filter(r => r.health === 'blank' || r.health === 'missing' || r.health === 'cloud-missing').length;

  // ── Team branding assets ────────────────────────────────────────────────────
  const teamAssets = useMemo(() => {
    return TEAMS.map(t => {
      const owned = media.filter(m =>
        (m.scope === 'team' || TEAM_LOGO_TYPES.includes((m.assetType || '').toUpperCase())) &&
        String(m.team || '').toUpperCase() === t.id
      );
      const have = new Set(owned.map(m => (m.assetType || '').toUpperCase()));
      return { t, have, count: owned.length };
    });
  }, [media]);

  return (
    <Card>
      <SectionHeading>Media console</SectionHeading>
      <p style={{ fontSize: 12.5, color: colors.textSecondary, margin: '6px 0 14px', lineHeight: 1.5 }}>
        The health of every image the app depends on — and one-click fixes. Changes here sync to the cloud and reach every account.
      </p>

      {/* Library health */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <Stat label="Total media" value={counts.total} />
        <Stat label="In the cloud" value={counts.synced} dot={HEALTH_META.synced.dot} />
        <Stat label="Local only" value={counts['local-only']} dot={HEALTH_META['local-only'].dot} />
        <Stat label="Cloud missing" value={counts['cloud-missing']} dot={HEALTH_META['cloud-missing'].dot} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <RedButton onClick={runRepair} disabled={!!busy} style={{ padding: '7px 14px', fontSize: 12 }}>
          {busy === 'repair' ? '⛑ Repairing…' : '⛑ Repair unsynced media'}
        </RedButton>
        <OutlineButton onClick={runRedownload} disabled={!!busy} style={{ padding: '7px 14px', fontSize: 12 }}>
          {busy === 'redownload' ? '↓ Re-downloading…' : '↓ Re-download missing blobs'}
        </OutlineButton>
        <OutlineButton onClick={runScan} disabled={!!busy} style={{ padding: '7px 14px', fontSize: 12 }}>
          {busy === 'scan' ? '⌕ Scanning…' : '⌕ Scan for broken pins'}
        </OutlineButton>
      </div>
      {repairReport && !repairReport.error && (
        <div style={{ fontSize: 11.5, color: repairReport.failed > 0 ? '#92400E' : '#065F46', fontFamily: fonts.condensed, marginBottom: 6 }}>
          {repairReport.total === 0 ? 'All media already in the cloud ✓'
            : `Re-synced ${repairReport.synced}/${repairReport.total}${repairReport.failed > 0 ? ` · ${repairReport.failed} still failing` : ''}`}
        </div>
      )}

      {/* Broken pins (orphan scan result) */}
      {orphans && (
        <div style={{ marginTop: 10, marginBottom: 6 }}>
          {orphans.length === 0 ? (
            <div style={{ fontSize: 12, color: '#065F46', fontWeight: 700 }}>No broken profile-photo pins ✓</div>
          ) : (
            <div style={{ border: `1px solid ${colors.border}`, borderRadius: radius.base, overflow: 'hidden' }}>
              <div style={{ padding: '6px 10px', background: 'rgba(185,28,28,0.08)', fontSize: 11.5, fontWeight: 700, color: '#991B1B' }}>
                {orphans.length} broken pin{orphans.length === 1 ? '' : 's'} — profile photo points at media not in the cloud
              </div>
              {orphans.map(o => (
                <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderTop: `1px solid ${colors.borderLight}`, fontSize: 12 }}>
                  <span style={{ flex: 1 }}>
                    <strong>{o.name}</strong> <span style={{ color: colors.textMuted }}>· {o.team}{o.num ? ` #${o.num}` : ''} · {o.reason === 'media-missing' ? 'media not in cloud' : 'no stored blob'}</span>
                  </span>
                  <OutlineButton onClick={() => unpinOrphan(o)} disabled={busy === o.id} style={{ padding: '3px 10px', fontSize: 11 }}>
                    {busy === o.id ? 'Unpinning…' : 'Unpin'}
                  </OutlineButton>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Player photos at a glance */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <div style={{ fontFamily: fonts.condensed, fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.text }}>
            Player photos ({CANONICAL_ROSTER_2026.length})
          </div>
          {rosterProblems > 0 && (
            <span style={{ fontSize: 11, color: '#991B1B', fontWeight: 700 }}>{rosterProblems} need attention</span>
          )}
          <span style={{ fontSize: 11, color: colors.textMuted }}>· click a player to set/replace</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(66px, 1fr))', gap: 8 }}>
          {rosterHealth.map(r => {
            const url = r.avatar?.blob ? avatarUrls[r.avatar.id] : null;
            const meta = HEALTH_META[r.health] || HEALTH_META.blank;
            const team = getTeam(r.c.team);
            return (
              <Link
                key={`${r.c.team}-${r.slug}`}
                to={`/teams/${r.c.team}/players/${r.slug}`}
                title={`${r.c.name} · ${r.c.team}${r.c.num ? ` #${r.c.num}` : ''} — ${meta.label}`}
                style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
              >
                <div style={{
                  position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: radius.base,
                  overflow: 'hidden', border: `1px solid ${colors.borderLight}`,
                  background: url ? `url(${url}) center/cover` : `linear-gradient(135deg, ${team?.color || '#333'}30, ${team?.color || '#333'}10)`,
                }}>
                  <span style={{
                    position: 'absolute', top: 3, right: 3, width: 9, height: 9, borderRadius: '50%',
                    background: meta.dot, boxShadow: '0 0 0 1.5px #fff',
                  }} />
                  {!url && (
                    <span style={{
                      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: fonts.condensed, fontWeight: 700, fontSize: 15, color: team?.color || colors.textMuted, opacity: 0.7,
                    }}>{r.firstName.charAt(0)}{r.lastName.charAt(0)}</span>
                  )}
                </div>
                <span style={{ fontSize: 9.5, fontFamily: fonts.condensed, color: colors.textMuted, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.lastName}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Team branding assets */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontFamily: fonts.condensed, fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.text, marginBottom: 8 }}>
          Team branding assets
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
          {teamAssets.map(({ t, have, count }) => (
            <div key={t.id} style={{ border: `1px solid ${colors.borderLight}`, borderRadius: radius.base, padding: '8px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: t.color }} />
                <span style={{ fontWeight: 700, fontSize: 12 }}>{t.id}</span>
                <span style={{ fontSize: 10.5, color: count > 0 ? colors.textMuted : '#B45309', marginLeft: 'auto' }}>{count} file{count === 1 ? '' : 's'}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {TEAM_LOGO_TYPES.map(ty => (
                  <span key={ty} title={ty} style={{
                    fontFamily: fonts.condensed, fontSize: 8.5, fontWeight: 700, letterSpacing: 0.3,
                    padding: '1px 4px', borderRadius: 3,
                    background: have.has(ty) ? 'rgba(22,163,74,0.12)' : 'rgba(0,0,0,0.05)',
                    color: have.has(ty) ? '#15803D' : colors.textMuted,
                  }}>{ty.replace('LOGO_', '').replace('_', '')}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 6 }}>
          Upload or replace logos in <Link to="/files" style={{ color: colors.accent }}>Files</Link> (name them <code>{'{TEAM}_LOGO_PRIMARY.png'}</code>, etc.). Colors are set in Global settings below.
        </div>
      </div>

      {!loaded && <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 10 }}>Loading media…</div>}
    </Card>
  );
}

function Stat({ label, value, dot }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 12px',
      border: `1px solid ${colors.borderLight}`, borderRadius: radius.base, minWidth: 96,
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontFamily: fonts.condensed, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.textMuted }}>
        {dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />}
        {label}
      </span>
      <span style={{ fontSize: 20, fontWeight: 800, fontFamily: fonts.heading, color: colors.text }}>{value}</span>
    </div>
  );
}
