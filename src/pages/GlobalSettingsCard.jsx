// Global settings console (v5.2.0) — master_admin only.
//
// One surface for the settings that affect EVERY account and page, backed by
// the existing app_settings key/value store (GET readable by all, POST master
// only), hydrated on login. Today it manages:
//   • team-branding — per-team color overrides that flow through getTeam() into
//     every team page, chip, and themed surface across all accounts.
//   • monthly-post-targets — the per-team content goal the dashboard reads.
// (Hero headlines and Google Drive keep their own dedicated cards above.)
import { useState, useEffect, useCallback } from 'react';
import { TEAMS, applyTeamBrandingOverride } from '../data';
import { Card, SectionHeading, RedButton, OutlineButton, inputStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { authedFetch } from '../authed-fetch';
import { useToast } from '../toast';

const HEX = /^#[0-9a-fA-F]{6}$/;

async function getSetting(key) {
  try {
    const res = await authedFetch(`/api/app-settings?key=${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const j = await res.json();
    return j?.value ?? null;
  } catch { return null; }
}
async function putSetting(key, value) {
  const res = await authedFetch('/api/app-settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export default function GlobalSettingsCard() {
  const toast = useToast();
  // brand[teamId] = { color, accent, dark } — starts from code defaults,
  // overlaid with any saved override.
  const [brand, setBrand] = useState({});
  const [targets, setTargets] = useState({});
  const [savingBrand, setSavingBrand] = useState(false);
  const [savingTargets, setSavingTargets] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const [ov, tg] = await Promise.all([getSetting('team-branding'), getSetting('monthly-post-targets')]);
      if (cancel) return;
      const seed = {};
      for (const t of TEAMS) {
        const o = (ov && ov[t.id]) || {};
        seed[t.id] = {
          color: o.color || t.color,
          accent: o.accent || t.accent,
          dark: o.dark || t.dark,
        };
      }
      setBrand(seed);
      setTargets(tg && typeof tg === 'object' ? tg : {});
      setLoaded(true);
    })();
    return () => { cancel = true; };
  }, []);

  const setField = (teamId, field, val) =>
    setBrand(b => ({ ...b, [teamId]: { ...b[teamId], [field]: val } }));

  const resetTeam = (teamId) => {
    const t = TEAMS.find(x => x.id === teamId);
    if (t) setBrand(b => ({ ...b, [teamId]: { color: t.color, accent: t.accent, dark: t.dark } }));
  };

  const saveBrand = useCallback(async () => {
    setSavingBrand(true);
    try {
      // Store only the teams whose colors DIFFER from the code default, so the
      // override stays minimal and future default changes still show through.
      const override = {};
      for (const t of TEAMS) {
        const b = brand[t.id] || {};
        const diff = {};
        for (const f of ['color', 'accent', 'dark']) {
          const v = String(b[f] || '').trim();
          if (v && HEX.test(v) && v.toLowerCase() !== String(t[f]).toLowerCase()) diff[f] = v;
        }
        if (Object.keys(diff).length) override[t.id] = diff;
      }
      await putSetting('team-branding', override);
      applyTeamBrandingOverride(override); // take effect immediately, no reload
      toast.success(Object.keys(override).length ? `Saved color overrides for ${Object.keys(override).length} team(s)` : 'Cleared all color overrides');
    } catch (e) {
      toast.error("Couldn't save team colors", { detail: String(e?.message || e).slice(0, 90) });
    } finally { setSavingBrand(false); }
  }, [brand, toast]);

  const saveTargets = useCallback(async () => {
    setSavingTargets(true);
    try {
      const clean = {};
      for (const [k, v] of Object.entries(targets)) {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n > 0) clean[k] = n;
      }
      await putSetting('monthly-post-targets', clean);
      toast.success('Saved monthly post targets');
    } catch (e) {
      toast.error("Couldn't save targets", { detail: String(e?.message || e).slice(0, 90) });
    } finally { setSavingTargets(false); }
  }, [targets, toast]);

  return (
    <Card>
      <SectionHeading>Global settings</SectionHeading>
      <p style={{ fontSize: 12.5, color: colors.textSecondary, margin: '6px 0 14px', lineHeight: 1.5 }}>
        Settings that apply to <strong>every account and page</strong>. Saved to the cloud and inherited on every sign-in.
      </p>

      {/* Team colors */}
      <div style={{ fontFamily: fonts.condensed, fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.text, marginBottom: 8 }}>
        Team colors
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {TEAMS.map(t => {
          const b = brand[t.id] || {};
          const changed = ['color', 'accent', 'dark'].some(f => String(b[f] || '').toLowerCase() !== String(t[f]).toLowerCase());
          return (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ width: 42, fontWeight: 700, fontSize: 12 }}>{t.id}</span>
              {['color', 'accent', 'dark'].map(f => (
                <span key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 10, color: colors.textMuted, width: 42, textAlign: 'right' }}>{f}</span>
                  <input
                    type="color"
                    value={HEX.test(b[f] || '') ? b[f] : '#000000'}
                    onChange={e => setField(t.id, f, e.target.value)}
                    style={{ width: 26, height: 26, padding: 0, border: `1px solid ${colors.border}`, borderRadius: 4, background: 'none', cursor: 'pointer' }}
                    aria-label={`${t.id} ${f} color`}
                  />
                  <input
                    value={b[f] || ''}
                    onChange={e => setField(t.id, f, e.target.value)}
                    style={{ ...inputStyle, width: 82, fontFamily: fonts.condensed, fontSize: 11, padding: '3px 6px' }}
                    aria-label={`${t.id} ${f} hex`}
                  />
                </span>
              ))}
              {changed && (
                <button onClick={() => resetTeam(t.id)} title="Reset to default" style={{
                  background: 'none', border: `1px solid ${colors.border}`, color: colors.textMuted,
                  borderRadius: 4, fontSize: 10, padding: '2px 6px', cursor: 'pointer',
                }}>reset</button>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 12 }}>
        <RedButton onClick={saveBrand} disabled={savingBrand || !loaded}>{savingBrand ? 'Saving…' : 'Save team colors'}</RedButton>
      </div>

      {/* Monthly post targets */}
      <div style={{ fontFamily: fonts.condensed, fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.text, margin: '18px 0 8px' }}>
        Monthly post targets
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
        {TEAMS.map(t => (
          <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ width: 42, fontWeight: 700 }}>{t.id}</span>
            <input
              type="number" min="0"
              value={targets[t.id] ?? ''}
              onChange={e => setTargets(tg => ({ ...tg, [t.id]: e.target.value }))}
              style={{ ...inputStyle, width: 64, padding: '4px 6px' }}
              aria-label={`${t.id} monthly post target`}
            />
          </label>
        ))}
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <OutlineButton onClick={saveTargets} disabled={savingTargets || !loaded}>{savingTargets ? 'Saving…' : 'Save targets'}</OutlineButton>
      </div>
    </Card>
  );
}
