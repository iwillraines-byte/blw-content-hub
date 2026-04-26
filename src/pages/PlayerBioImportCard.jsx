// Admin-only card in Settings for ingesting player bios. Three input
// modes, all routed through the same /api/players-sheet-sync endpoint:
//
//   📁 Upload   — pick a CSV file from disk; client reads it and sends
//                 contents in the request body. Most private path —
//                 nothing is publicly hosted.
//   📋 Paste    — paste CSV text into a textarea. Same privacy as Upload.
//   🔗 URL      — server fetches a published Google Sheet CSV URL.
//                 CONVENIENT but the URL is a permanent shared secret;
//                 anyone who learns it can read the whole sheet.
//
// Flow regardless of mode:
//   1. Admin chooses input + provides CSV
//   2. Clicks "Preview" — server runs dryRun=true, returns mapping +
//      privacy triage + per-row outcomes
//   3. Optionally edit column mapping
//   4. Clicks "Apply" — server runs dryRun=false, writes to Supabase
//
// Column overrides persist per-browser. CSV text is NEVER persisted to
// localStorage so closing the tab discards it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, SectionHeading, Label, RedButton, OutlineButton, inputStyle, selectStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { authedJson } from '../authed-fetch';
import { useToast } from '../toast';

const LS_URL = 'blw_bio_sheet_url_v1';
const LS_MAP = 'blw_bio_sheet_map_v1';
const LS_MODE = 'blw_bio_sheet_mode_v1';

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
  // Default mode = upload (most private). Persisted so a returning admin
  // sees the same UI shape they last used.
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(LS_MODE) || 'upload'; } catch { return 'upload'; }
  });
  const [csvUrl, setCsvUrl] = useState(() => { try { return localStorage.getItem(LS_URL) || ''; } catch { return ''; } });
  // CSV body — populated either by file upload or by direct paste. Never
  // persisted to localStorage so the data evaporates with the tab close.
  const [csvText, setCsvText] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [overrideMap, setOverrideMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_MAP) || '{}'); } catch { return {}; }
  });
  const [preview, setPreview] = useState(null);      // last preview response
  const [applied, setApplied] = useState(null);      // last apply response
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showMapping, setShowMapping] = useState(false);
  const fileInputRef = useRef(null);

  const persistUrl = (v) => { try { localStorage.setItem(LS_URL, v); } catch {} };
  const persistMap = (m) => { try { localStorage.setItem(LS_MAP, JSON.stringify(m)); } catch {} };
  const setModeAndPersist = (m) => {
    setMode(m);
    try { localStorage.setItem(LS_MODE, m); } catch {}
    setPreview(null);
    setApplied(null);
  };

  const onFilePicked = async (file) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      toast.error('CSV is over 4MB — strip non-bio columns and try again');
      return;
    }
    try {
      const text = await file.text();
      setCsvText(text);
      setCsvFileName(file.name);
      setPreview(null);
      setApplied(null);
    } catch (err) {
      toast.error('Could not read file', { detail: err.message });
    }
  };

  const headers = preview?.headers || [];
  const detectedMap = preview?.detectedMap || {};
  const effectiveMap = useMemo(() => ({ ...detectedMap, ...overrideMap }), [detectedMap, overrideMap]);

  // Build the request body once based on the active input mode. csvText
  // wins on the server side — for url mode we omit it and only send the
  // url. Always trims whitespace.
  const buildBody = (dryRun) => {
    const base = { columnMap: overrideMap, dryRun };
    if (mode === 'url') return { ...base, csvUrl: csvUrl.trim() };
    // If the user pasted from Sheets (tab-separated by default) and there
    // are no commas at all, convert tabs to commas so our parser sees CSV.
    let body = csvText;
    if (mode === 'paste' && body.includes('\t') && !body.includes(',')) {
      body = body.replace(/\t/g, ',');
    }
    return { ...base, csvText: body };
  };

  const inputReady = () => {
    if (mode === 'url') return csvUrl.trim().length > 0;
    return csvText.trim().length > 0;
  };

  const runPreview = async () => {
    if (!inputReady()) {
      toast.error(mode === 'url' ? 'Add a CSV URL first' : 'Add a CSV first');
      return;
    }
    setLoading(true);
    setApplied(null);
    try {
      const res = await authedJson('/api/players-sheet-sync', { method: 'POST', body: buildBody(true) });
      setPreview(res);
      if (mode === 'url') persistUrl(csvUrl.trim());
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
    if (!inputReady()) { toast.error('CSV is no longer in memory — re-upload'); return; }
    if (!confirm(`Apply ${preview.summary.created + preview.summary.updated} changes to manual_players? This writes to the cloud.`)) return;
    setApplying(true);
    try {
      const res = await authedJson('/api/players-sheet-sync', { method: 'POST', body: buildBody(false) });
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

      {/* Privacy banner — recommends private modes, warns about URL mode. */}
      <div style={{
        padding: 10, marginBottom: 12, borderRadius: radius.base,
        background: colors.infoBg, border: `1px solid ${colors.infoBorder}`,
        fontSize: 12, color: colors.text, lineHeight: 1.5,
      }}>
        <strong>🛡 Privacy:</strong> The app is gated by login — only invited users see player pages. <strong>Upload</strong> and <strong>Paste</strong> never expose your sheet to anyone — the CSV travels straight from your browser to our database. <strong>URL mode</strong> requires you to publish the sheet, which makes it readable by anyone who learns the URL — only use it if your sheet has no PII. Email / phone / address columns are <strong>refused server-side</strong> regardless of mode.
      </div>

      {/* Mode picker — segmented control */}
      <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: colors.bg,
        border: `1px solid ${colors.borderLight}`, borderRadius: radius.full, marginBottom: 12 }}>
        {[
          { id: 'upload', icon: '📁', label: 'Upload CSV' },
          { id: 'paste',  icon: '📋', label: 'Paste CSV' },
          { id: 'url',    icon: '🔗', label: 'Publish URL' },
        ].map(m => {
          const active = mode === m.id;
          return (
            <button key={m.id} onClick={() => setModeAndPersist(m.id)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: radius.full,
              background: active ? colors.white : 'transparent',
              color: active ? colors.text : colors.textSecondary,
              border: `1px solid ${active ? colors.border : 'transparent'}`,
              cursor: 'pointer',
              fontFamily: fonts.body, fontSize: 12, fontWeight: active ? 700 : 500,
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              transition: 'all 0.12s',
            }}>
              <span>{m.icon}</span>{m.label}
            </button>
          );
        })}
      </div>

      {/* Mode-specific input panels */}
      {mode === 'upload' && (
        <div>
          <Label>CSV file</Label>
          <div style={{
            padding: 14, border: `2px dashed ${colors.border}`, borderRadius: radius.base,
            background: colors.bg, textAlign: 'center',
          }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={e => onFilePicked(e.target.files?.[0])}
              style={{ display: 'none' }}
            />
            <button onClick={() => fileInputRef.current?.click()} style={{
              padding: '8px 16px', background: colors.white, border: `1px solid ${colors.border}`,
              borderRadius: radius.base, cursor: 'pointer',
              fontFamily: fonts.body, fontSize: 13, fontWeight: 600, color: colors.text,
            }}>📁 Choose CSV file</button>
            <div style={{ marginTop: 8, fontSize: 11, color: colors.textSecondary }}>
              {csvFileName ? <>Loaded: <strong>{csvFileName}</strong> ({csvText.length.toLocaleString()} chars)</> : <>In Google Sheets: <strong>File → Download → Comma-separated values (.csv)</strong></>}
            </div>
          </div>
        </div>
      )}

      {mode === 'paste' && (
        <div>
          <Label>Paste CSV (with headers in row 1)</Label>
          <textarea
            placeholder={`Team,First Name,Last Name,Height,Weight,Bats,Throws,Birthplace\nLAN,Konnor,Jaso,73,195,L,R,Long Beach CA\n...`}
            value={csvText}
            onChange={e => { setCsvText(e.target.value); setCsvFileName(''); setPreview(null); setApplied(null); }}
            rows={8}
            style={{
              width: '100%', boxSizing: 'border-box', padding: 10,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11,
              background: colors.white, color: colors.text,
              border: `1px solid ${colors.border}`, borderRadius: radius.base, resize: 'vertical',
            }}
          />
          <div style={{ marginTop: 4, fontSize: 11, color: colors.textSecondary }}>
            In Sheets: select all rows including the header → <strong>Cmd/Ctrl + C</strong> → paste here. We'll convert tabs to commas automatically if needed.
          </div>
        </div>
      )}

      {mode === 'url' && (
        <div>
          <div style={{
            padding: 10, marginBottom: 8, borderRadius: radius.base,
            background: 'rgba(245, 158, 11, 0.10)', border: `1px solid rgba(245, 158, 11, 0.35)`,
            fontSize: 12, color: '#92400E', lineHeight: 1.5,
          }}>
            <strong>⚠ Heads up:</strong> Publishing a sheet to the web creates a permanent URL anyone with the link can read. Once leaked, the only way to revoke it is to manually unpublish in Google Sheets. <strong>Only use this mode for a sheet that contains no PII</strong> (consider building a filtered second sheet via <code>=IMPORTRANGE(...)</code>).
          </div>
          <Label>Published CSV URL</Label>
          <input
            type="url"
            placeholder="https://docs.google.com/spreadsheets/d/…/pub?output=csv"
            value={csvUrl}
            onChange={e => setCsvUrl(e.target.value)}
            style={{ ...inputStyle, fontSize: 12 }}
          />
        </div>
      )}

      {/* If user pasted with tabs (Sheets default copy format), auto-convert
          to commas before sending. Cheap, idempotent — only affects the
          send, not the textarea contents. */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <OutlineButton onClick={runPreview} disabled={loading || !inputReady()} style={{ flex: '1 1 140px' }}>
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

          {/* Privacy / column triage panel — shows what got through and
              what's being intentionally ignored. Most important visual
              for an admin worried about PII. */}
          {preview.headerCategories && (
            <div style={{
              padding: 10, marginBottom: 10, borderRadius: radius.base,
              background: colors.bg, border: `1px solid ${colors.borderLight}`,
            }}>
              <div style={{
                fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
                color: colors.textSecondary, letterSpacing: 1, textTransform: 'uppercase',
                marginBottom: 8,
              }}>What's getting through</div>
              <HeaderRow
                icon="✓"
                color={colors.success}
                label="Imported"
                items={preview.headerCategories.mapped}
                emptyText="(none yet — adjust the mapping below)"
              />
              <HeaderRow
                icon="🛡"
                color={colors.red}
                label="Refused (PII)"
                items={preview.headerCategories.piiBlocked}
                emptyText="(no PII columns detected — good)"
                bold
              />
              <HeaderRow
                icon="○"
                color={colors.textMuted}
                label="Ignored"
                items={preview.headerCategories.unmapped}
                emptyText="(every column was mapped or refused)"
              />
              {preview.blockedOverrides && preview.blockedOverrides.length > 0 && (
                <div style={{
                  marginTop: 8, padding: 8, borderRadius: radius.sm,
                  background: 'rgba(221,60,60,0.08)', border: `1px solid ${colors.redBorder}`,
                  fontSize: 11, color: '#991B1B',
                }}>
                  <strong>Refused {preview.blockedOverrides.length} mapping override(s)</strong> — these tried to point at a PII header so we dropped them: {preview.blockedOverrides.map(o => `${o.field}→${o.header}`).join(', ')}.
                </div>
              )}
            </div>
          )}

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
                      {headers
                        .filter(h => !preview.headerCategories?.piiBlocked?.includes(h))
                        .map(h => <option key={h} value={h}>{h}</option>)}
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

// One row in the privacy/triage panel — icon + colored label + a wrap of
// header chips. `bold=true` makes the label visually heavier so the
// "Refused (PII)" row reads as the safety-net it is.
function HeaderRow({ icon, color, label, items, emptyText, bold }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '4px 0' }}>
      <div style={{
        flexShrink: 0, width: 110, display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: fonts.condensed, fontSize: 10, fontWeight: bold ? 800 : 700,
        color, letterSpacing: 0.5, textTransform: 'uppercase',
      }}>
        <span style={{ fontSize: 12 }}>{icon}</span>
        {label} ({items.length})
      </div>
      <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {items.length === 0
          ? <span style={{ fontSize: 11, color: colors.textMuted, fontStyle: 'italic' }}>{emptyText}</span>
          : items.map(h => (
              <span key={h} style={{
                padding: '2px 8px', borderRadius: radius.full,
                background: colors.white, color: colors.text,
                border: `1px solid ${colors.borderLight}`,
                fontSize: 10, fontFamily: fonts.body,
                whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis',
              }} title={h}>{h}</span>
            ))
        }
      </div>
    </div>
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
