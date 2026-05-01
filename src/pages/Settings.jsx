import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { TEAMS, API_CONFIG, getTeam } from '../data';
import { Card, PageHeader, SectionHeading, Label, RedButton, OutlineButton, inputStyle } from '../components';
import { colors, fonts, radius } from '../theme';
import { GIT_COMMIT, BUILD_LABEL, formattedBuildDate } from '../version';
import ChangelogModal from '../changelog-modal';
import { getApiKey, setApiKey, clearApiKey, pushDriveToCloud, getSavedFolders } from '../drive-api';
import { authedFetch } from '../authed-fetch';
import { fetchRecentGenerates } from '../cloud-sync';
import { useAuth } from '../auth';
import { getRequests, saveRequests } from '../requests-store';
import { useToast } from '../toast';
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
  // Changelog popup — driven by the version chip in the About card.
  const [changelogOpen, setChangelogOpen] = useState(false);

  useEffect(() => {
    const k = getApiKey();
    setDriveKey(k);
    setDriveKeyDraft(k);
  }, []);

  // v4.5.11: one-time auto-push for master accounts that already had
  // a key saved locally before cloud-sync existed. Without this, the
  // Update button stays disabled (draft === saved) so they can't
  // trigger a manual push, and cloud stays empty for new admins. We
  // only push when cloud is genuinely empty so we never overwrite a
  // newer config from another master session.
  useEffect(() => {
    if (role !== 'master_admin') return;
    const localKey = getApiKey();
    const localFolders = getSavedFolders();
    if (!localKey && !localFolders.length) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch('/api/app-settings?key=drive');
        if (!res.ok || cancelled) return;
        const json = await res.json();
        const cloud = json?.value || null;
        const cloudEmpty = !cloud
          || (!cloud.apiKey && (!Array.isArray(cloud.folders) || !cloud.folders.length));
        if (!cloudEmpty) return;
        // Cloud is empty + we have local data → push.
        setCloudSyncStatus('syncing');
        const result = await pushDriveToCloud();
        if (cancelled) return;
        setCloudSyncStatus(result.ok ? 'synced' : 'error');
        if (result.ok) setTimeout(() => setCloudSyncStatus(null), 3000);
      } catch { /* silent — UI shows the static cloud-shared chip */ }
    })();
    return () => { cancelled = true; };
  }, [role]);

  // v4.5.10: Drive config is cloud-synced for master_admin. Saving
  // pushes the new key (and current folder list) into Supabase via
  // /api/app-settings so every other admin auto-pulls it on sign-in.
  // Non-master users save to localStorage only — server enforces the
  // role gate either way.
  const [cloudSyncStatus, setCloudSyncStatus] = useState(null); // null | 'syncing' | 'synced' | 'error'
  const saveDriveKey = async () => {
    setApiKey(driveKeyDraft);
    setDriveKey(driveKeyDraft);
    if (role === 'master_admin') {
      setCloudSyncStatus('syncing');
      const result = await pushDriveToCloud();
      setCloudSyncStatus(result.ok ? 'synced' : 'error');
      if (result.ok) {
        // Auto-clear the synced indicator after a few seconds.
        setTimeout(() => setCloudSyncStatus(null), 3000);
      }
    }
  };

  const removeDriveKey = async () => {
    clearApiKey();
    setDriveKey('');
    setDriveKeyDraft('');
    if (role === 'master_admin') {
      // Push the empty state to cloud so other admins also lose access.
      setCloudSyncStatus('syncing');
      const result = await pushDriveToCloud();
      setCloudSyncStatus(result.ok ? 'synced' : 'error');
      if (result.ok) setTimeout(() => setCloudSyncStatus(null), 3000);
    }
  };

  const maskedKey = driveKey
    ? `${driveKey.slice(0, 6)}${'•'.repeat(Math.max(0, driveKey.length - 10))}${driveKey.slice(-4)}`
    : '';

  // Master-only Settings cards. The legacy 'admin' tier no longer
  // surfaces these (collapsed into master_admin per the role-model
  // simplification — only the master operator handles trades, bio
  // imports, people management, and raw-API debugging).
  const isMaster = role === 'master_admin';
  const isAthlete = role === 'athlete';

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

      {/* v4.5.16: Athlete-only DM card. Routes a message to the master
          admin via the Requests queue (type='message'). Athletes get a
          clean form with no priority / template noise — just type and
          send. Admin sees it land in their existing requests inbox. */}
      {isAthlete && <AthleteMessageCard />}

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
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 12, flexWrap: 'wrap', marginBottom: 4,
        }}>
          <SectionHeading style={{ margin: 0 }}>Google Drive</SectionHeading>
          {/* v4.5.10: cloud-sync status pip — only visible to master_admin
              since they're the only ones who can push to the shared
              config. Other admins read-only inherit it. */}
          {isMaster && (
            <span style={{
              fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
              letterSpacing: 0.5, padding: '3px 9px', borderRadius: 999,
              background: cloudSyncStatus === 'syncing' ? 'rgba(14,165,233,0.15)'
                : cloudSyncStatus === 'synced' ? 'rgba(16,185,129,0.15)'
                : cloudSyncStatus === 'error' ? 'rgba(220,38,38,0.15)'
                : 'rgba(14,165,233,0.10)',
              color: cloudSyncStatus === 'syncing' ? '#0369A1'
                : cloudSyncStatus === 'synced' ? '#065F46'
                : cloudSyncStatus === 'error' ? '#991B1B'
                : '#0369A1',
            }}>
              {cloudSyncStatus === 'syncing' ? '↻ SYNCING TO CLOUD'
                : cloudSyncStatus === 'synced' ? '✓ SYNCED · ALL ADMINS'
                : cloudSyncStatus === 'error' ? '✕ SYNC FAILED'
                : '☁ CLOUD-SHARED · MASTER WRITES'}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 12, lineHeight: 1.6 }}>
          {isMaster
            ? 'Connect Google Drive to browse and import assets. As master admin, your saved key + folder list auto-syncs to every other admin who signs in — they don\'t need to paste anything themselves.'
            : 'Drive config is set by the master admin and inherited by every signed-in admin. If you don\'t see folders below, ask the master admin to populate this section.'}
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
          {/* v4.5.11: master can force a re-push at any time, even when
              the draft matches the saved value. Useful after the
              v4.5.10 migration to push a previously-saved key into
              the cloud without having to "tweak then untweak" it. */}
          {isMaster && driveKey && (
            <OutlineButton
              onClick={async () => {
                setCloudSyncStatus('syncing');
                const result = await pushDriveToCloud();
                setCloudSyncStatus(result.ok ? 'synced' : 'error');
                if (result.ok) setTimeout(() => setCloudSyncStatus(null), 3000);
              }}
              disabled={cloudSyncStatus === 'syncing'}
              title="Push current key + folder list to the shared cloud config"
            >
              {cloudSyncStatus === 'syncing' ? 'Syncing…' : 'Sync now'}
            </OutlineButton>
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

      {/* v4.5.16: removed "Team colors" card — replaced by per-team
          brand guidelines that will live under Resources. The codebase
          still uses team.color tokens internally; this UI was
          purely informational. */}
      {/* v4.5.16: removed "Other integrations" card — all surfaces
          listed there (prowiffleball API, Metricool, Slack) are
          covered by their primary cards or are aspirational. The
          card was redundant. */}

      {/* Download history — full list of generated posts (currently across
          everyone, per-user scoping lands in Phase 5). Paginated client-side
          to 50 most recent so the page doesn't blow up when there are 1000s. */}
      <DownloadHistoryCard />

      <Card>
        <SectionHeading>About</SectionHeading>
        <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.7 }}>
          <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ color: colors.red }}>BLW Studio</strong>
            {/* Version chip — semver + build date. Click to open the
                full changelog. The chip stays small + monospace so it
                reads as a build fingerprint, not a primary CTA, but
                the cursor + caret signal it's interactive. */}
            <button
              type="button"
              onClick={() => setChangelogOpen(true)}
              title={`Built ${formattedBuildDate()}${GIT_COMMIT !== 'dev' ? ` · ${GIT_COMMIT}` : ''} — click to see release notes`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                background: colors.bg, border: `1px solid ${colors.borderLight}`,
                padding: '2px 8px', borderRadius: radius.sm,
                color: colors.textSecondary,
                cursor: 'pointer',
              }}
            >
              {GIT_COMMIT === 'dev' ? 'dev build' : BUILD_LABEL}
              <span style={{ opacity: 0.5 }}>↗</span>
            </button>
          </div>
          <p style={{ marginTop: 0, marginBottom: 12 }}>
            The pinnacle of wiffleball meets the pinnacle of media production tools. BLW Studio is a proprietary, fully customized, content generation tool made to propel the league and its athletes to the highest echelon of what this sport has to offer.
          </p>
          <p style={{ marginBottom: 12 }}>
            BLW Studio content can be uploaded, stored, edited, downloaded, and posted more efficiently and easily than any tool on the market. Athletes have the ability to create and upload content to BLW Studio to help grow the league, its media database, and their own platforms.
          </p>
          <p style={{ marginBottom: 0 }}>
            BLW Studio is also powered by a unique AI that's been trained on this league and will continue to improve exponentially over time. BLW Studio's statistics are derived from Grand Slam Systems' public API key and for even better and more insightful stats, visit{' '}
            <a
              href="https://prowiffleball.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: colors.red, fontWeight: 700, textDecoration: 'none' }}
            >
              prowiffleball.com
            </a>.
          </p>
        </div>
      </Card>
      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
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

// Athlete DM-to-admin card. v4.5.16. Athletes get a simple "send a
// message to the admins" form in Settings — single textarea, send
// button, no priority / template / type noise. Routes through the
// existing Requests pipeline as a request with type='message' so the
// master sees it in their normal inbox.
function AthleteMessageCard() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const message = {
        id,
        type: 'message',
        title: text.split(/\n/)[0].slice(0, 80) || 'Athlete message',
        team: profile?.team_id || null,
        template: null,
        status: 'pending',
        priority: 'medium',
        requester: profile?.display_name || user?.email || 'Athlete',
        requesterEmail: user?.email || null,
        requesterUserId: user?.id || null,
        note: text.trim(),
        createdAt: Date.now(),
      };
      const list = getRequests();
      saveRequests([message, ...list]);
      setText('');
      setSent(true);
      toast.success('Message sent', { detail: 'Master admin sees it in the requests inbox' });
      setTimeout(() => setSent(false), 4000);
    } catch (err) {
      toast.error('Couldn\'t send', { detail: err?.message?.slice(0, 80) });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <SectionHeading>Message the admin</SectionHeading>
      <p style={{ fontSize: 12, color: colors.textSecondary, margin: '2px 0 12px', lineHeight: 1.5, maxWidth: '60ch' }}>
        Quick line to the BLW Studio team. Use it for anything: a question, a typo
        you spotted, a content idea, a profile update you'd like made. Lands in
        the master admin's inbox.
      </p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Type your message…"
        rows={4}
        style={{
          ...inputStyle,
          width: '100%', boxSizing: 'border-box',
          minHeight: 90, resize: 'vertical',
          fontFamily: fonts.body,
          marginBottom: 8,
        }}
        disabled={sending}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <RedButton onClick={send} disabled={!text.trim() || sending}>
          {sending ? 'Sending…' : sent ? '✓ Sent' : 'Send'}
        </RedButton>
        <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, letterSpacing: 0.4 }}>
          {profile?.display_name || user?.email || 'You'} → Master admin
        </span>
      </div>
    </Card>
  );
}
