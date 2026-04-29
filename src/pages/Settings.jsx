import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { TEAMS, API_CONFIG, getTeam } from '../data';
import { Card, PageHeader, SectionHeading, Label, RedButton, OutlineButton, inputStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { GIT_COMMIT, BUILD_LABEL, formattedBuildDate } from '../version';
import { getApiKey, setApiKey, clearApiKey } from '../drive-api';
import { fetchRecentGenerates } from '../cloud-sync';
import { useAuth } from '../auth';
import PeopleAdminCard from './PeopleAdmin';
import TypographyCard from './TypographyCard';
import ThemeModeCard from './ThemeModeCard';
import PlayerBioImportCard from './PlayerBioImportCard';
import PlayerTradesCard from './PlayerTradesCard';
import RosterDiagnosticCard from './RosterDiagnosticCard';
import RawApiInspectorCard from './RawApiInspectorCard';

export default function Settings() {
  const { role } = useAuth();
  const [driveKey, setDriveKey] = useState('');
  const [driveKeyDraft, setDriveKeyDraft] = useState('');
  const [driveKeyMasked, setDriveKeyMasked] = useState(true);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    const k = getApiKey();
    setDriveKey(k);
    setDriveKeyDraft(k);
  }, []);

  const saveDriveKey = () => {
    setApiKey(driveKeyDraft);
    setDriveKey(driveKeyDraft);
  };

  const removeDriveKey = () => {
    clearApiKey();
    setDriveKey('');
    setDriveKeyDraft('');
  };

  const maskedKey = driveKey
    ? `${driveKey.slice(0, 6)}${'•'.repeat(Math.max(0, driveKey.length - 10))}${driveKey.slice(-4)}`
    : '';

  // Master-only Settings cards. The legacy 'admin' tier no longer
  // surfaces these (collapsed into master_admin per the role-model
  // simplification — only the master operator handles trades, bio
  // imports, people management, and raw-API debugging).
  const isMaster = role === 'master_admin';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="SETTINGS" subtitle="Team colors, integrations, and configuration" />

      {/* People admin — master_admin only. */}
      {isMaster && <PeopleAdminCard />}

      {/* Player bio import — master_admin only. Pulls a published Google
          Sheet CSV into manual_players so player pages show vitals. */}
      {isMaster && <PlayerBioImportCard />}

      {/* Player team overrides — master_admin only. Trades, FA signings,
          retirements that the source-of-truth API doesn't know about. */}
      {isMaster && <PlayerTradesCard />}

      {/* Roster diagnostic — master_admin only. Shows which canonical
          players are or aren't matching against the API and surfaces
          likely name mismatches so we can add aliases. */}
      {isMaster && <RosterDiagnosticCard />}

      {/* Raw API inspector — master_admin only. Hits GSS endpoints
          directly with no caching/normalization to verify what the API
          actually returns for a given player. */}
      {isMaster && <RawApiInspectorCard />}

      {/* Appearance + Typography — personal preferences, visible to everyone */}
      <ThemeModeCard />
      <TypographyCard />

      <Card>
        <SectionHeading>API status</SectionHeading>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: 14,
          background: API_CONFIG.isLive ? colors.successBg : colors.warningBg,
          border: `1px solid ${API_CONFIG.isLive ? colors.successBorder : colors.warningBorder}`,
          borderRadius: radius.base,
        }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: API_CONFIG.isLive ? colors.success : colors.warning }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: API_CONFIG.isLive ? '#15803D' : '#92400E' }}>
              {API_CONFIG.isLive ? 'Live API Active' : 'Using Cached Data'}
            </div>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
              {API_CONFIG.isLive
                ? `Connected to ${API_CONFIG.baseUrl}`
                : 'Add VITE_PWB_API_KEY to Vercel environment variables for live data'}
            </div>
          </div>
        </div>
      </Card>

      {/* Google Drive Connection */}
      <Card>
        <SectionHeading>Google Drive</SectionHeading>
        <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 12, lineHeight: 1.6 }}>
          Connect Google Drive to browse and import assets from publicly-shared folders.
          Your API key is stored locally in your browser. It never leaves this device.
        </div>

        <Label>Drive API Key</Label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            type={driveKeyMasked && driveKey === driveKeyDraft ? 'password' : 'text'}
            value={driveKeyDraft}
            onChange={e => setDriveKeyDraft(e.target.value)}
            placeholder="AIzaSy..."
            style={{ ...inputStyle, flex: 1, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}
            autoComplete="off"
            spellCheck={false}
          />
          <RedButton onClick={saveDriveKey} disabled={!driveKeyDraft.trim() || driveKeyDraft === driveKey}>
            {driveKey ? 'Update' : 'Save'}
          </RedButton>
          {driveKey && (
            <OutlineButton onClick={removeDriveKey}>Remove</OutlineButton>
          )}
        </div>

        {driveKey && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
            background: colors.successBg, border: `1px solid ${colors.successBorder}`,
            borderRadius: radius.base, fontSize: 12, marginBottom: 8,
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: colors.success }} />
            <span style={{ flex: 1, color: '#15803D', fontWeight: 700 }}>Key saved</span>
            <code style={{ fontSize: 11, color: '#15803D', fontFamily: 'ui-monospace, Menlo, monospace' }}>{maskedKey}</code>
            <button onClick={() => setDriveKeyMasked(!driveKeyMasked)} style={{
              background: 'none', border: `1px solid ${colors.successBorder}`, color: '#15803D',
              padding: '2px 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer', fontWeight: 700,
            }}>{driveKeyMasked ? 'Show' : 'Hide'}</button>
          </div>
        )}

        <button onClick={() => setShowInstructions(!showInstructions)} style={{
          background: 'none', border: 'none', color: colors.red,
          fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0,
          fontFamily: fonts.body, textDecoration: 'underline',
        }}>
          {showInstructions ? 'Hide setup instructions' : 'How do I get a Drive API key?'}
        </button>

        {showInstructions && (
          <div style={{
            marginTop: 12, padding: 14, background: colors.bg, borderRadius: radius.base,
            border: `1px solid ${colors.borderLight}`, fontSize: 13, lineHeight: 1.7, color: colors.text,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>One-time Google Cloud setup (about 5 minutes)</div>
            <ol style={{ paddingLeft: 18, margin: 0 }}>
              <li>Go to <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" style={{ color: colors.red, fontWeight: 700 }}>console.cloud.google.com</a> and sign in.</li>
              <li>Create a new project (top-left dropdown → "New Project"). Name it anything; "BLW Content Hub" works.</li>
              <li>In the search bar, type <strong>"Google Drive API"</strong> → click it → click <strong>Enable</strong>.</li>
              <li>Left sidebar → <strong>APIs &amp; Services → Credentials</strong>.</li>
              <li>Click <strong>+ Create Credentials → API key</strong>. Copy the key shown.</li>
              <li><strong>Restrict the key</strong> (recommended):
                <ul style={{ paddingLeft: 18, marginTop: 4 }}>
                  <li>Click the new key → <strong>Application restrictions → HTTP referrers</strong>.</li>
                  <li>Add: <code style={{ background: colors.muted, padding: '1px 5px', borderRadius: 3 }}>https://your-vercel-domain.vercel.app/*</code></li>
                  <li>Add: <code style={{ background: colors.muted, padding: '1px 5px', borderRadius: 3 }}>http://localhost:5173/*</code></li>
                  <li>Under <strong>API restrictions → Restrict key</strong>, select only <strong>Google Drive API</strong>.</li>
                </ul>
              </li>
              <li>Paste the key into the field above and click Save.</li>
            </ol>
            <div style={{ marginTop: 10, padding: 10, background: colors.warningBg, border: `1px solid ${colors.warningBorder}`, borderRadius: 6, color: '#92400E', fontSize: 12 }}>
              <strong>Note:</strong> This key only works on folders you share as "Anyone with the link can view". Private folders require OAuth (not supported yet).
            </div>
          </div>
        )}
      </Card>

      <Card>
        <SectionHeading>Team colors</SectionHeading>
        {TEAMS.map(t => (
          <div key={t.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            background: colors.bg, borderRadius: radius.base, marginBottom: 4,
            border: `1px solid ${colors.borderLight}`,
          }}>
            <span style={{ width: 28, height: 28, borderRadius: 6, background: t.color, border: `1px solid ${colors.border}` }} />
            <span style={{ width: 28, height: 28, borderRadius: 6, background: t.accent, border: `1px solid ${colors.border}` }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>{t.name}</div>
              {t.owner && <div style={{ fontSize: 10, color: colors.textMuted }}>Owner: {t.owner}</div>}
            </div>
            <code style={{ fontSize: 11, color: colors.text, background: colors.muted, padding: '3px 8px', borderRadius: 4, fontWeight: 600 }}>{t.color}</code>
            <code style={{ fontSize: 11, color: colors.text, background: colors.muted, padding: '3px 8px', borderRadius: 4, fontWeight: 600 }}>{t.accent}</code>
          </div>
        ))}
      </Card>

      <Card>
        <SectionHeading>Other integrations</SectionHeading>
        {[
          { name: 'prowiffleball.com API', desc: 'Player & team stats', status: API_CONFIG.isLive ? 'Connected' : 'Not configured', color: '#DD3C3C' },
          { name: 'Metricool', desc: 'Social media scheduling & analytics', status: 'Not connected', color: '#6366F1' },
          { name: 'Slack', desc: 'Team notifications', status: 'Not connected', color: '#E01E5A' },
        ].map((x, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
            background: colors.bg, borderRadius: radius.base, marginBottom: 4,
            border: `1px solid ${colors.borderLight}`,
          }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: x.status === 'Connected' ? colors.success : colors.border }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>{x.name}</div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>{x.desc}</div>
            </div>
            <span style={{ fontSize: 10, fontFamily: fonts.condensed, fontWeight: 600, color: x.status === 'Connected' ? '#15803D' : colors.textMuted }}>{x.status}</span>
          </div>
        ))}
      </Card>

      {/* Download history — full list of generated posts (currently across
          everyone, per-user scoping lands in Phase 5). Paginated client-side
          to 50 most recent so the page doesn't blow up when there are 1000s. */}
      <DownloadHistoryCard />

      <Card>
        <SectionHeading>About</SectionHeading>
        <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.7 }}>
          <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ color: colors.red }}>BLW Content Hub</strong>
            {/* Live build label — auto-rolls every Vercel deploy via
                VERCEL_GIT_COMMIT_SHA. Hover for the full build date.
                The SHA is just a fingerprint, not a clickable link. */}
            <span
              title={`Built ${formattedBuildDate()}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                background: colors.bg, border: `1px solid ${colors.borderLight}`,
                padding: '2px 8px', borderRadius: radius.sm,
                color: colors.textSecondary,
              }}
            >
              {GIT_COMMIT === 'dev' ? 'dev build' : BUILD_LABEL}
            </span>
          </div>
          <div>Content management and graphic generation tool for Big League Wiffle Ball.</div>
          <div style={{ marginTop: 8 }}>Managing content for 9 of 10 BLW teams. Season launch: May 1, 2026.</div>
          <div style={{ marginTop: 8 }}>Graphics are downloaded and scheduled via <strong>Metricool</strong> for social media publishing.</div>
        </div>
      </Card>
    </div>
  );
}

function DownloadHistoryCard() {
  const [history, setHistory] = useState(null); // null = loading, [] = empty
  const [visible, setVisible] = useState(20);

  useEffect(() => {
    fetchRecentGenerates(100).then(setHistory);
  }, []);

  const buildRegenerateLink = (post) => {
    const params = new URLSearchParams();
    if (post.templateType) params.set('template', post.templateType);
    if (post.team) params.set('team', post.team);
    if (post.settings?.fields) {
      for (const [k, v] of Object.entries(post.settings.fields)) {
        if (v != null && v !== '') params.set(k, v);
      }
    }
    return `/generate?${params.toString()}`;
  };

  const fmtDate = (d) => {
    if (!d) return '';
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <SectionHeading style={{ margin: 0 }}>Download history</SectionHeading>
        <span style={{ fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, color: colors.textMuted, letterSpacing: 0.5 }}>
          {history == null ? 'LOADING…' : `${history.length} POST${history.length === 1 ? '' : 'S'}`}
        </span>
      </div>
      {history != null && history.length === 0 && (
        <div style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center', padding: 20 }}>
          No downloads yet. Head to <Link to="/generate" style={{ color: colors.red }}>Generate</Link> and make your first post.
        </div>
      )}
      {history != null && history.length > 0 && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {history.slice(0, visible).map(post => {
              const team = post.team ? getTeam(post.team) : null;
              return (
                <div key={post.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: 8, borderRadius: radius.sm,
                  border: `1px solid ${colors.borderLight}`,
                  background: colors.bg,
                }}>
                  {/* Thumbnail */}
                  <div style={{
                    width: 48, height: 48, borderRadius: radius.sm, overflow: 'hidden',
                    flexShrink: 0, background: '#1A1A22',
                    border: `1px solid ${colors.borderLight}`,
                  }}>
                    {post.thumbnailUrl ? (
                      <img src={post.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{
                        width: '100%', height: '100%',
                        background: team ? `linear-gradient(135deg, ${team.color}, ${team.dark})` : colors.bg,
                      }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {team && (
                        <span style={{
                          background: team.color, color: team.accent,
                          padding: '1px 6px', borderRadius: 3,
                          fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
                        }}>{team.id}</span>
                      )}
                      <span>{post.templateType || '—'}</span>
                      <span style={{ color: colors.textMuted, fontWeight: 400, fontSize: 11 }}>·  {post.platform || '—'}</span>
                    </div>
                    <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, letterSpacing: 0.3, marginTop: 2 }}>
                      {fmtDate(post.createdAt)}
                    </div>
                  </div>
                  <Link
                    to={buildRegenerateLink(post)}
                    title="Re-open in Generate with this composition pre-filled"
                    style={{
                      background: colors.redLight,
                      border: `1px solid ${colors.redBorder}`,
                      color: colors.red,
                      borderRadius: radius.sm, padding: '5px 10px',
                      fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
                      textDecoration: 'none', whiteSpace: 'nowrap',
                    }}
                  >↺ REGENERATE</Link>
                </div>
              );
            })}
          </div>
          {visible < history.length && (
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              <OutlineButton onClick={() => setVisible(v => v + 20)} style={{ padding: '6px 14px', fontSize: 11 }}>
                Load more ({history.length - visible} more)
              </OutlineButton>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
