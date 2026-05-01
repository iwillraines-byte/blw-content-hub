// Resources — central hub for SOPs, video training, FAQ, brand
// guidelines, and team assets. v4.5.16 ships a clean shell with
// stub sections that the master admin can populate via copy/paste.
//
// Architecture note: every section is rendered from a single config
// array (RESOURCE_SECTIONS) so adding a new resource is a one-line
// edit. Each item supports markdown-style links, embedded iframes
// (Loom / YouTube), and downloadable file refs from /public/brand
// or external URLs. Athletes see all sections; admins also see a
// hidden "Operations" group for internal-only material.

import { Card, PageHeader, SectionHeading } from '../components';
import { colors, fonts, radius } from '../theme';
import { useAuth } from '../auth';

// Resource section schema:
//   id           — slug (used for anchor links + storage keys)
//   title        — display heading
//   summary      — one-line description shown collapsed
//   adminOnly    — gates the section to master/admin/content roles
//   items[]      — list of resources inside the section
//
// Item schema:
//   kind  — 'doc' | 'video' | 'link' | 'file'
//   title — what the user sees
//   detail — optional supporting copy
//   url   — link to open / iframe to embed (videos)
//   icon  — optional emoji prefix (defaults by kind)
const RESOURCE_SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting started',
    summary: 'New to BLW Studio? Start here.',
    items: [
      {
        kind: 'doc',
        title: 'Welcome to BLW Studio',
        detail: 'A 60-second tour of the dashboard, the Studio, and where to find what you need. Coming soon — drop your copy in src/pages/Resources.jsx.',
        url: null,
      },
    ],
  },
  {
    id: 'how-to',
    title: 'How-to guides',
    summary: 'Step-by-step walkthroughs for the most common workflows.',
    items: [
      { kind: 'doc', title: 'Generating a player stat post', detail: 'From dashboard idea → finished PNG.', url: null },
      { kind: 'doc', title: 'Uploading and tagging media', detail: 'How auto-tag works and how to fix a wrong tag.', url: null },
      { kind: 'doc', title: 'Requesting custom content', detail: 'When to use the Requests queue vs. self-serve in Studio.', url: null },
      { kind: 'doc', title: 'Editing your About-me', detail: 'Athletes only — how your About-me feeds the AI captions about you.', url: null },
    ],
  },
  {
    id: 'faq',
    title: 'Frequently asked questions',
    summary: 'Answers to the questions admins and athletes ask most.',
    items: [
      { kind: 'doc', title: 'Why don\'t I see overlays from another admin?', detail: 'Cloud sync runs every 60 seconds — also force-refreshes on team-select. If still missing, check Settings → Google Drive is configured.', url: null },
      { kind: 'doc', title: 'How do I tag a photo with a different player?', detail: 'On the Files page, click the AI tag chip and pick a different "Roster" suggestion, or edit the team / number / lastName fields directly.', url: null },
      { kind: 'doc', title: 'What\'s the difference between a Stat Leader and a Player of the Game template?', detail: 'Stat Leader = single-stat spotlight (top OPS+, top HR, etc.). Player of the Game = standout-game spotlight after a single performance.', url: null },
      { kind: 'doc', title: 'How do I add my Instagram handle to my profile?', detail: 'Athletes — open your player page from your team\'s roster. The IG handle field lives inside the About card.', url: null },
      { kind: 'doc', title: 'What does "View as" do?', detail: 'Master admin can preview the app from another role\'s perspective without signing out. Server permissions still match your real account.', url: null },
      { kind: 'doc', title: 'Can I bulk-upload overlays?', detail: 'Yes — drag a folder of PNGs into the Upload modal in Studio → Custom mode. Each file becomes its own overlay record.', url: null },
      { kind: 'doc', title: 'How does temp-access work?', detail: 'Master admin can grant a 6-hour master grant to any invited email. The countdown banner is visible to that user. Self-revokes when the timer hits zero.', url: null },
      { kind: 'doc', title: 'Where do my changes save?', detail: 'Most edits sync to Supabase within seconds (overlays, profile photos, About-me, requests). Local-only state — like your typography pick — is per-browser.', url: null },
      { kind: 'doc', title: 'Why is my media tagged "OTHER"?', detail: 'The auto-tag couldn\'t resolve the team from the filename. Open the file and pick the right team from the dropdown — it\'ll re-tag and the team breakdown updates.', url: null },
      { kind: 'doc', title: 'Who can see my requests?', detail: 'Master admins, admins, and content team. As an athlete you only see your own requests; everyone else sees the full queue.', url: null },
    ],
  },
  {
    id: 'brand-guidelines',
    title: 'Brand guidelines',
    summary: 'Logo usage, color palettes, and tone-of-voice for each team.',
    items: [
      { kind: 'doc', title: 'BLW master brand kit', detail: 'Logos, palette, and tone. Drop guidelines here in src/pages/Resources.jsx.', url: null },
      { kind: 'doc', title: 'Team-by-team brand sheets', detail: 'Each team\'s color tokens + logo lockup specs.', url: null },
    ],
  },
  {
    id: 'team-assets',
    title: 'Team assets',
    summary: 'Downloadable logos, headshots, action photos.',
    items: [
      { kind: 'link', title: 'Open team logos folder', detail: 'Public Drive folder with every team\'s logo files.', url: null, icon: '🗂️' },
      { kind: 'link', title: 'Headshot library', detail: 'Sorted by team. Update via Files → Drive sync.', url: null, icon: '📸' },
    ],
  },
  {
    id: 'video-training',
    title: 'Video training',
    summary: 'Short clips walking through specific workflows.',
    items: [
      { kind: 'video', title: 'Studio walkthrough', detail: 'Coming soon — record a Loom and paste the URL.', url: null },
      { kind: 'video', title: 'Auto-tag explained', detail: 'How the AI looks at your photo and what it\'s really doing.', url: null },
    ],
  },
  {
    id: 'sops',
    title: 'Standard operating procedures',
    summary: 'Internal playbooks for the content team.',
    adminOnly: true,
    items: [
      { kind: 'doc', title: 'Weekly content cadence', detail: 'How many posts per team per week, who owns drafting, who owns publishing.', url: null },
      { kind: 'doc', title: 'On-call coverage for game days', detail: 'Who\'s monitoring the Requests queue during live games.', url: null },
      { kind: 'doc', title: 'Trade-day workflow', detail: 'Master admin runs the trade migration; content team updates posts within 24 hours.', url: null },
    ],
  },
];

export default function Resources() {
  const { role } = useAuth();
  const isAdmin = role === 'master_admin' || role === 'admin' || role === 'content';
  const visibleSections = RESOURCE_SECTIONS.filter(s => !s.adminOnly || isAdmin);

  return (
    <div>
      <PageHeader
        title="RESOURCES"
        subtitle="SOPs, training, FAQs, and brand assets. Bookmark this page."
      />

      {/* Anchor index — quick jump for long pages */}
      <Card>
        <div style={{
          fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
          color: colors.textMuted, letterSpacing: 0.6, marginBottom: 8,
          textTransform: 'uppercase',
        }}>JUMP TO</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {visibleSections.map(s => (
            <a
              key={s.id}
              href={`#${s.id}`}
              style={{
                fontFamily: fonts.body, fontSize: 12, fontWeight: 600,
                padding: '6px 12px', borderRadius: radius.full,
                background: colors.bg, color: colors.textSecondary,
                border: `1px solid ${colors.borderLight}`,
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              {s.title}
            </a>
          ))}
        </div>
      </Card>

      {visibleSections.map(section => (
        <Card key={section.id} id={section.id} style={{ scrollMarginTop: 80 }}>
          <SectionHeading>{section.title}</SectionHeading>
          <div style={{
            fontSize: 13, color: colors.textSecondary, lineHeight: 1.6,
            marginBottom: 14, maxWidth: '60ch',
          }}>
            {section.summary}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {section.items.map((item, i) => (
              <ResourceItem key={i} item={item} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function ResourceItem({ item }) {
  const icon = item.icon
    || (item.kind === 'video' ? '▶'
      : item.kind === 'link' ? '↗'
      : item.kind === 'file' ? '⬇'
      : '📄');

  // No URL set yet — render as a faded "coming soon" preview tile.
  if (!item.url) {
    return (
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 12,
        padding: '10px 14px',
        background: colors.bg, borderRadius: radius.base,
        border: `1px dashed ${colors.borderLight}`,
        opacity: 0.7,
      }}>
        <span style={{ fontSize: 16 }} aria-hidden="true">{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: fonts.body, fontSize: 13, fontWeight: 600, color: colors.text,
          }}>{item.title}</div>
          {item.detail && (
            <div style={{
              fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 1.5,
            }}>{item.detail}</div>
          )}
        </div>
        <span style={{
          fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700,
          letterSpacing: 0.5, color: colors.textMuted,
          background: colors.white, padding: '2px 8px', borderRadius: 999,
          border: `1px solid ${colors.borderLight}`, whiteSpace: 'nowrap',
        }}>COMING SOON</span>
      </div>
    );
  }

  return (
    <a
      href={item.url}
      target={item.kind === 'video' || item.kind === 'link' ? '_blank' : undefined}
      rel={item.kind === 'video' || item.kind === 'link' ? 'noreferrer' : undefined}
      style={{
        display: 'flex', alignItems: 'baseline', gap: 12,
        padding: '10px 14px',
        background: colors.white, borderRadius: radius.base,
        border: `1px solid ${colors.borderLight}`,
        textDecoration: 'none', color: 'inherit',
        transition: 'border-color 0.15s, transform 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = colors.accent; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = colors.borderLight; }}
    >
      <span style={{ fontSize: 16 }} aria-hidden="true">{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: fonts.body, fontSize: 13, fontWeight: 700, color: colors.text,
        }}>{item.title}</div>
        {item.detail && (
          <div style={{
            fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 1.5,
          }}>{item.detail}</div>
        )}
      </div>
    </a>
  );
}
