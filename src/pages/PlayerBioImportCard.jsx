// Admin-only card in Settings for ingesting player bios from a published
// Google Sheet (or any CSV URL). Flow:
//   1. Admin pastes the published CSV URL
//   2. Clicks "Preview" — calls /api/players-sheet-sync with dryRun=true,
//      sees auto-detected column mapping + row-by-row summary
//   3. If anything looks wrong, expand mapping editor + override columns
//   4. Clicks "Apply" — same endpoint with dryRun=false, writes to Supabase
//
// The CSV URL + column overrides persist per-browser (localStorage) so
// the next import reuses the same config without retyping.

import { useEffect, useMemo, useState } from 'react';
import { Card, SectionHeading, Label, RedButton, OutlineButton, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { authedJson } from '../authed-fetch';
import { useToast } from '../toast';

const LS_URL = 'blw_bio_sheet_url_v1';
const LS_MAP = 'blw_bio_sheet_map_v1';

// Target fields in the order we display them in the mapping editor.
// Labels match Supabase column-ish names so admins can match their
// sheet headers intuitively.
const FIELDS = [
  { key: 'team',       label: 'Team',          required: true,  desc: 'Team id or name — e.g. "LAN" or "Los Angeles Naturals"' },
  { key: 'firstName',  label: 'First Name',    required: false },
  { key: 'lastName',   label: 'Last Name',     required: true,  desc: 'Required (or provide Full Name)' },
  { key: 'fullName',   label: 'Full Name',     required: false, desc: 'Alternative to first + last — we\'ll split it' },
  { key: 'num',        label: 'Jersey Number', required: false },
  { key: 'position',   label: 'Position',      required: false },
  { key: 'heightIn',   label: 'Height',        required: false, desc: "Accepts 73, 6'1\", 6 ft 1 in" },
  { key: 'weightLbs',  label: 'Weight (lbs)',  required: false },
  { key: 'birthdate',  label: 'Birthdate',     required: false, desc: 'Any common date format' },
  { key: 'bats',       label: 'Bats',          required: false, desc: 'R / L / S (switch)' },
  { key: 'throws',     label: 'Throws',        required: false, desc: 'R / L' },
  { key: 'birthplace', label: 'Birthplace',    required: false },
  { key: 'nickname',   label: 'Nickname',      required: false },
];

export default function PlayerBioImportCard() {
  const toast = useToast();
  const [csvUrl, setCsvUrl] = useState(() => { try { return localStorage.getItem(LS_URL) || ''; } catch { return ''; } });
  const [overrideMap, setOverrideMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_MAP) || '{}'); } catch { return {}; }
  });
  const [preview, setPreview] = useState(null);      // last preview response
  const [applied, setApplied] = useState(null);      // last apply response
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showMapping, setShowMapping] = useState(false);

  const persistUrl = (v) => { try { localStorage.setItem(LS_URL, v); } catch {} };
  const persistMap = (m) => { try { localStorage.setItem(LS_MAP, JSON.stringify(m)); } catch {} };

  const headers = preview?.headers || [];
  const detectedMap = preview?.detectedMap || {};
  const effectiveMap = useMemo(() => ({ ...detectedMap, ...overrideMap }), [detectedMap, overrideMap]);

  const runPreview = async () => {
    if (!csvUrl.trim()) { toast.error('Add a CSV URL first'); return; }
    setLoading(true);
    setApplied(null);
    try {
      const res = await authedJson('/api/players-sheet-sync', {
        method: 'POST',
        body: { csvUrl: csvUrl.trim(), columnMap: overrideMap, dryRun: true },
      });
      setPreview(res);
      persistUrl(csvUrl.trim());
      const s = res.summary || {};
      toast.success(
        `Preview: ${s.created || 0} new · ${s.updated || 0} updated · ${s.skipped || 0} skipped`,
        { duration: 4000 },
      );
    } catch (err) {
      toast.error('Preview failed', { detail: err.message?.slice(0, 120) });
      // Still show the error body if it has headers/detectedMap — helps
      // when "Could not detect a TEAM column" so the admin can remap.
      if (err.body?.headers) setPreview(err.body);
    } finally {
      setLoading(false);
    }
  };

  const runApply = async () => {
    if (!preview) { toast.error('Run Preview first'); return; }
    if (!confirm(`Apply ${preview.summary.created + preview.summary.updated} changes to manual_players? This writes to the cloud.`)) return;
    setApplying(true);
    try {
      const res = await authedJson('/api/players-sheet-sync', {
        method: 'POST',
        body: { csvUrl: csvUrl.trim(), columnMap: overrideMap, dryRun: false },
      });
      setApplied(res);
      const s = res.summary || {};
      toast.success(`Applied: ${s.created || 0} created · ${s.updated || 0} updated`);
    } catch (err) {
      toast.error('Apply failed', { detail: err.message?.slice(0, 120) });
    } finally {
      setApplying(false);
    }
  };

  const updateOverride = (field, header) => {
    const next = { ...overrideMap };
    if (!header) delete next[field];
    else next[field] = header;
    setOverrideMap(next);
    persistMap(next);
  };

  const resetOverrides = () => {
    setOverrideMap({});
    persistMap({});
  };

  const summary = preview?.summary;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <SectionHeading style={{ marginBottom: 0 }}>Player bio import</SectionHeading>
        <span style={{
          fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 1,
          color: colors.textMuted, textTransform: 'uppercase',
        }}>
          admin only
        </span>
      </div>

      <p style={{ fontSize: 12, color: colors.textSecondary, margin: '2px 0 14px', lineHeight: 1.6 }}>
        Pulls a published Google Sheet (or any CSV) into <code>manual_players</code> — height/weight/birthdate/bats/throws/birthplace/nickname — so player pages show vitals. Matches existing rows by team + last name (disambiguated by first initial). <strong>Preview</strong> shows what would change without writing; <strong>Apply</strong> commits.
      </p>

      <details style={{ marginBottom: 12, fontSize: 12, color: colors.textSecondary }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, color: colors.text }}>
          How to publish your sheet as CSV →
        </summary>
        <ol style={{ margin: '8px 0 0 20px', padding: 0, lineHeight: 1.6 }}>
          <li>In Google Sheets: <strong>File → Share → Publish to web</strong></li>
          <li>Content: pick the tab with responses. Format: <strong>Comma-separated values (.csv)</strong></li>
          <li>Click <strong>Publish</strong>, copy the generated URL (ends in <code>output=csv</code>)</li>
          <li>Paste it below and hit Preview</li>
        </ol>
      </details>

      <Label>Published CSV URL</Label>
      <input
        type="url"
        placeholder="https://docs.google.com/spreadsheets/d/…/pub?output=csv"
        value={csvUrl}
        onChange={e => setCsvUrl(e.target.value)}
        style={{ ...inputStyle, fontSize: 12 }}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <OutlineButton onClick={runPreview} disabled={loading || !csvUrl.trim()} style={{ flex: '1 1 140px' }}>
          {loading ? 'Fetching…' : '👁 Preview'}
        </OutlineButton>
        <RedButton onClick={runApply} disabled={!preview || applying} style={{ flex: '1 1 140px' }}>
          {applying ? 'Applying…' : `Apply${summary ? ` (${(summary.created || 0) + (summary.updated || 0)} rows)` : ''}`}
        </RedButton>
      </div>

      {/* Detected mapping summary */}
      {preview && (
        <div style={{ marginTop: 14 }}>
          {/* Summary chips */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <SummaryChip label="Sheet rows"    value={preview.rowsInSheet} />
            <SummaryChip label="Would create"  value={summary?.created || 0} tone="success" />
            <SummaryChip label="Would update"  value={summary?.updated || 0} tone="info" />
            <SummaryChip label="Skipped"       value={summary?.skipped || 0} tone={summary?.skipped ? 'warn' : null} />
            {preview.dryRun && (
              <span style={{
                padding: '3px 10px', borderRadius: radius.full,
                background: 'rgba(251, 191, 36, 0.12)', color: '#92400E',
                border: '1px solid rgba(251, 191, 36, 0.4)',
                fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
              }}>PREVIEW — no writes yet</span>
            )}
          </div>

          {/* Toggle mapping editor */}
          <button onClick={() => setShowMapping(v => !v)} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            color: colors.red, fontSize: 12, fontWeight: 700, textDecoration: 'underline',
            marginBottom: 8,
          }}>
            {showMapping ? 'Hide' : 'Edit'} column mapping ({Object.keys(effectiveMap).length} mapped / {headers.length} headers)
          </button>

          {showMapping && (
            <div style={{
              padding: 12, marginBottom: 10,
              background: colors.bg, borderRadius: radius.base,
              border: `1px solid ${colors.borderLight}`,
            }}>
              <p style={{ fontSize: 11, color: colors.textSecondary, margin: '0 0 10px', lineHeight: 1.5 }}>
                We auto-detected these columns. Override any that look wrong, then hit Preview again.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                {FIELDS.map(f => (
                  <div key={f.key}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                      color: colors.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase',
                      marginBottom: 3,
                    }}>
                      {f.label}
                      {f.required && <span style={{ color: colors.red }}>*</span>}
                      {detectedMap[f.key] && !overrideMap[f.key] && (
                        <span title="Auto-detected" style={{ color: colors.success, fontSize: 10 }}>✓</span>
                      )}
                    </div>
                    <select
                      value={effectiveMap[f.key] || ''}
                      onChange={e => updateOverride(f.key, e.target.value)}
                      style={{ ...selectStyle, fontSize: 11, padding: '4px 6px' }}
                    >
                      <option value="">— not mapped —</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                    {f.desc && (
                      <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2, lineHeight: 1.3 }}>{f.desc}</div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                <button onClick={resetOverrides} style={{
                  background: 'none', border: `1px solid ${colors.border}`, padding: '4px 10px',
                  borderRadius: radius.sm, cursor: 'pointer', fontSize: 11, color: colors.textSecondary,
                }}>Reset overrides</button>
                <button onClick={runPreview} disabled={loading} style={{
                  background: colors.white, border: `1px solid ${colors.red}`, padding: '4px 10px',
                  borderRadius: radius.sm, cursor: 'pointer', fontSize: 11, color: colors.red, fontWeight: 700,
                }}>{loading ? 'Fetching…' : '↻ Re-preview'}</button>
              </div>
            </div>
          )}

          {/* Per-row audit — collapsed by default, first 12 visible */}
          {preview.rows && preview.rows.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: colors.text }}>
                Row-by-row results ({preview.rows.length} shown)
              </summary>
              <div style={{
                marginTop: 8, maxHeight: 280, overflowY: 'auto',
                border: `1px solid ${colors.borderLight}`, borderRadius: radius.base,
                background: colors.bg,
              }}>
                {preview.rows.map((r, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '50px 90px 1fr',
                    gap: 8, padding: '6px 10px',
                    borderBottom: i < preview.rows.length - 1 ? `1px solid ${colors.divider}` : 'none',
                    fontSize: 11,
                  }}>
                    <span style={{ color: colors.textMuted, fontFamily: fonts.condensed }}>#{r.row}</span>
                    <span style={{
                      fontFamily: fonts.condensed, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
                      color: r.status === 'created' ? colors.success
                           : r.status === 'updated' ? colors.info
                           : colors.warning,
                    }}>{r.status}</span>
                    <span style={{ color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.record?.first_name || ''} {r.record?.last_name || ''}
                      {r.record?.team && <span style={{ color: colors.textMuted }}> · {r.record.team}</span>}
                      {r.reason && <span style={{ color: colors.warning, marginLeft: 6 }}>— {r.reason}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {applied && (
        <div style={{
          marginTop: 12, padding: 10, borderRadius: radius.base,
          background: colors.successBg, border: `1px solid ${colors.successBorder}`,
          fontSize: 12, color: colors.text,
        }}>
          ✓ Applied — created {applied.summary.created}, updated {applied.summary.updated}, skipped {applied.summary.skipped}. Hard-refresh a player page to see the new vitals.
        </div>
      )}
    </Card>
  );
}

function SummaryChip({ label, value, tone }) {
  const palette = {
    success: { bg: 'rgba(34, 197, 94, 0.12)',  fg: '#15803D', bd: 'rgba(34, 197, 94, 0.3)'  },
    info:    { bg: 'rgba(59, 130, 246, 0.12)', fg: '#1D4ED8', bd: 'rgba(59, 130, 246, 0.3)' },
    warn:    { bg: 'rgba(251, 191, 36, 0.12)', fg: '#92400E', bd: 'rgba(251, 191, 36, 0.4)' },
  }[tone] || { bg: colors.bg, fg: colors.text, bd: colors.borderLight };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 10px', borderRadius: radius.full,
      background: palette.bg, color: palette.fg,
      border: `1px solid ${palette.bd}`,
      fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
    }}>
      <span style={{ fontFamily: fonts.heading, fontSize: 14, lineHeight: 1 }}>{value}</span>
      {label}
    </span>
  );
}
