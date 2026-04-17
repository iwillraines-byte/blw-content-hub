import { TEAMS, API_CONFIG } from '../data';
import { Card, PageHeader, SectionHeading } from '../components';
import { colors, fonts, radius } from '../theme';

export default function Settings() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="SETTINGS" subtitle="Team colors, integrations, and configuration" />

      <Card>
        <SectionHeading>API STATUS</SectionHeading>
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

      <Card>
        <SectionHeading>TEAM COLORS (FROM OFFICIAL LOGOS)</SectionHeading>
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
        <SectionHeading>INTEGRATIONS</SectionHeading>
        {[
          { name: 'Dropbox', desc: 'Team logos & brand assets', status: 'Not connected', color: '#0061FF' },
          { name: 'Google Drive', desc: 'Player photos & videos', status: 'Not connected', color: '#34A853' },
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
            <button style={{
              background: `${x.color}10`, border: `1px solid ${x.color}30`, color: x.color,
              borderRadius: radius.base, padding: '6px 14px', fontFamily: fonts.body,
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}>{x.status === 'Connected' ? 'Manage' : 'Connect'}</button>
          </div>
        ))}
      </Card>

      <Card>
        <SectionHeading>ABOUT</SectionHeading>
        <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.7 }}>
          <div style={{ marginBottom: 6 }}><strong style={{ color: colors.red }}>BLW Content Hub</strong> — Version 2.0</div>
          <div>Content management and graphic generation tool for Big League Wiffle Ball.</div>
          <div style={{ marginTop: 8 }}>Managing content for 9 of 10 BLW teams. Season launch: May 1, 2026.</div>
          <div style={{ marginTop: 8 }}>Graphics are downloaded and scheduled via <strong>Metricool</strong> for social media publishing.</div>
        </div>
      </Card>
    </div>
  );
}
