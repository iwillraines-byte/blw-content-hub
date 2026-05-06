// Resources — central hub for SOPs, video training, FAQ, brand
// guidelines, and team assets. v4.5.16 ships a clean shell with
// stub sections that the master admin can populate via copy/paste.
// v4.5.20: master admin can append custom links/files to any section
// via /api/app-settings (key="resources-extras"); a platform intro
// write-up sits at the top of the page for new athletes + admins.
//
// Architecture note: every section is rendered from a single config
// array (RESOURCE_SECTIONS) so adding a new resource is a one-line
// edit. Each item supports markdown-style links, embedded iframes
// (Loom / YouTube), and downloadable file refs from /public/brand
// or external URLs. Athletes see all sections; admins also see a
// hidden "Operations" group for internal-only material.

import { useEffect, useState } from 'react';
import { Card, PageHeader, SectionHeading } from '../components';
import { colors, fonts, radius } from '../theme';
import { useAuth } from '../auth';
import { authedFetch } from '../authed-fetch';

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
    summary: 'Find your role, then jump to the surface you need.',
    items: [
      {
        kind: 'link',
        title: 'What each role can do',
        detail: 'Master / admin / content / athlete — capabilities and limits, side by side.',
        url: '#role-permissions',
        icon: '◑',
      },
      {
        kind: 'link',
        title: 'Open the Studio',
        detail: 'Pick a template, drop in a photo, ship a post.',
        url: '/generate',
        icon: '✦',
      },
      {
        kind: 'link',
        title: 'Open Files',
        detail: 'Upload, tag, and browse media. Drive sync keeps it in step with the shared folders.',
        url: '/files',
        icon: '📁',
      },
      {
        kind: 'link',
        title: 'File a request',
        detail: 'Need something the team should do? Drop it in the Requests queue.',
        url: '/requests',
        icon: '📥',
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
      { kind: 'link', title: 'Open team logos folder', detail: 'Public Drive folder with every team\'s logo files.', url: null, icon: '◫' },
      { kind: 'link', title: 'Headshot library', detail: 'Sorted by team. Update via Files → Drive sync.', url: null, icon: '◉' },
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

// v4.5.20: Platform intro for athletes and admins. Anchored at the top
// of the Resources page above the section grid. Athletes get the
// athlete-flavored block; admins get the admin-flavored one. We render
// both side-by-side so an athlete reading the page can also see how
// the league operates above them — context builds buy-in.
const ATHLETE_INTRO = [
  'BLW Studio is your home base for everything content-related — your headshots, your stats, your highlight clips, and your league-wide presence. The platform is built so the work of telling your story is mostly done for you.',
  'Start at your player page (open your team from the sidebar, then click your name). Fill in your About-me — vibe, walk-up music, fun facts. Every AI-drafted caption about you reads from this block, so what you write here becomes the voice the league uses to talk about you.',
  'When you want to post something, hit the Studio. Pick a template, your photo, and a layout — the app handles the rest. Downloaded posts get logged automatically so the league can track activity. Need a custom graphic? File it in Requests and the content team will pick it up.',
];

const ADMIN_INTRO = [
  'BLW Studio is the production engine for league-wide content. The home Dashboard surfaces AI-drafted ideas tied to live stats; each idea is one click away from the Studio compositor.',
  'Files is your media library — drag in photos, let auto-tag classify them, and they become available everywhere a player or team page asks for assets. Drive folders sync into this same library so partners can drop into a shared folder and we see it instantly.',
  'Each team page surfaces a per-team monthly content gauge (configurable target, master-admin only), social handles you can edit inline, the live roster, and the team\'s recent uploads. Player pages do the same one level down — every athlete\'s identity, stats, and media in one place.',
  'Requests is the work queue — anything that can\'t be self-served by an athlete files here. PEOPLE & ROLES gates everything: athletes see only their team, content sees league-wide, master admin owns everything.',
];

export default function Resources() {
  const { role } = useAuth();
  const isAthlete = role === 'athlete';
  const isAdmin = role === 'master_admin' || role === 'admin' || role === 'content';
  const isMaster = role === 'master_admin';
  const visibleSections = RESOURCE_SECTIONS.filter(s => !s.adminOnly || isAdmin);

  // v4.5.20: Cloud-stored extras per section. Master admin reads + writes
  // via /api/app-settings; everyone else reads. Shape: { [sectionId]: [items...] }
  const [extras, setExtras] = useState({});
  // v4.5.37: Cloud-stored hidden built-in items. Master admin can hide a
  // placeholder ("Coming soon" stub) so it disappears for every viewer
  // until a real resource lands. Shape: { [sectionId]: [titleString, ...] }
  // — keyed by item title because the items themselves are baked into
  // RESOURCE_SECTIONS code, no stable id otherwise. Stored under
  // /api/app-settings key="resources-hidden".
  const [hiddenItems, setHiddenItems] = useState({});
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await authedFetch('/api/app-settings?key=resources-extras');
        if (!res.ok) return;
        const data = await res.json();
        if (cancel) return;
        setExtras(data?.value || {});
      } catch { /* silent */ }
      try {
        const res2 = await authedFetch('/api/app-settings?key=resources-hidden');
        if (!res2.ok) return;
        const data2 = await res2.json();
        if (cancel) return;
        setHiddenItems(data2?.value || {});
      } catch { /* silent */ }
    })();
    return () => { cancel = true; };
  }, []);

  const saveHiddenItems = async (next) => {
    const res = await authedFetch('/api/app-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'resources-hidden', value: next }),
    });
    if (!res.ok) throw new Error('Save failed');
    setHiddenItems(next);
  };

  const hideBuiltIn = async (sectionId, title) => {
    const list = hiddenItems[sectionId] || [];
    if (list.includes(title)) return;
    const next = { ...hiddenItems, [sectionId]: [...list, title] };
    await saveHiddenItems(next);
  };

  const restoreAllBuiltIns = async (sectionId) => {
    if (!hiddenItems[sectionId]?.length) return;
    const next = { ...hiddenItems, [sectionId]: [] };
    await saveHiddenItems(next);
  };

  const saveExtras = async (next) => {
    const res = await authedFetch('/api/app-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'resources-extras', value: next }),
    });
    if (!res.ok) throw new Error('Save failed');
    setExtras(next);
  };

  const addExtra = async (sectionId, item) => {
    const next = {
      ...extras,
      [sectionId]: [...(extras[sectionId] || []), { ...item, addedAt: Date.now() }],
    };
    await saveExtras(next);
  };

  const removeExtra = async (sectionId, idx) => {
    const list = (extras[sectionId] || []).slice();
    list.splice(idx, 1);
    const next = { ...extras, [sectionId]: list };
    await saveExtras(next);
  };

  return (
    <div>
      <PageHeader
        title="RESOURCES"
        subtitle="SOPs, training, FAQs, and brand assets. Bookmark this page."
      />

      {/* Platform intro — short prose introducing BLW Studio. Athlete and
          admin variants render side-by-side so the audience always sees
          their lane, plus the other lane for context. */}
      <Card>
        <SectionHeading>Welcome to BLW Studio</SectionHeading>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          marginTop: 6,
        }}>
          {[
            { label: 'For athletes', body: ATHLETE_INTRO, accent: colors.accent, primary: isAthlete },
            { label: 'For admins',   body: ADMIN_INTRO,   accent: colors.red,    primary: isAdmin && !isAthlete },
          ].map(block => (
            <div key={block.label} style={{
              padding: 14,
              borderRadius: radius.base,
              background: block.primary ? `${block.accent}08` : colors.bg,
              border: `1px solid ${block.primary ? `${block.accent}33` : colors.borderLight}`,
            }}>
              <div style={{
                fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
                letterSpacing: 1, color: block.accent, marginBottom: 8,
                textTransform: 'uppercase',
              }}>{block.label}</div>
              {block.body.map((p, i) => (
                <p key={i} style={{
                  fontSize: 13, lineHeight: 1.65, color: colors.textSecondary,
                  margin: i === 0 ? '0 0 10px' : '0 0 10px',
                }}>{p}</p>
              ))}
            </div>
          ))}
        </div>
      </Card>

      {/* v4.5.42: Role permissions reference — replaces the
          long-standing placeholder items in the "Getting started"
          section with concrete, role-by-role coverage. Renders for
          everyone (athletes benefit from seeing what staff can /
          can't do). */}
      <Card id="role-permissions" style={{ scrollMarginTop: 80 }}>
        <SectionHeading>What each role can do</SectionHeading>
        <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 16, lineHeight: 1.55, maxWidth: '70ch' }}>
          BLW Studio has four roles. Your role lives on your profile and is set by the master admin. You always see the surfaces relevant to your tier — surfaces above your tier are simply hidden, not just disabled.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {[
            {
              role: 'Master admin',
              accent: colors.red,
              tagline: 'You are the operator. Owns the league.',
              can: [
                'Everything below + add/remove admins, change roles, grant 6h temp access',
                'Edit Drive API key (other admins inherit it cloud-shared)',
                'Hide posts from public feeds',
                'Edit player vitals + nicknames (✎ Edit player info on player pages)',
                'Mark cells in team content calendars',
                'Hide / restore Resources placeholders',
                'Run player bio CSV imports + roster diagnostics + raw API inspector',
              ],
              cant: ['Nothing — you have full access by definition.'],
            },
            {
              role: 'Admin',
              accent: '#0EA5E9',
              tagline: 'Trusted operator. Most full-app capability.',
              can: [
                'Everything in Studio (templates, overlays, effects, downloads, HD exports)',
                'Files: upload, tag, edit, delete media',
                'Requests: pick up, status-flip, comment, notify requesters',
                'Browse every team page + player page + Game Center',
                'Access Resources + see admin-only sections',
              ],
              cant: [
                'Edit the Drive API key (read-only — inherits master\'s)',
                'Hide posts from feeds (master only)',
                'Edit player vitals (master only)',
                'Mark content-calendar cells (master only)',
                'Manage other admins or change roles (master only)',
              ],
            },
            {
              role: 'Content',
              accent: '#22C55E',
              tagline: 'Day-to-day production. Posts content for the league.',
              can: [
                'Studio + every template + downloads',
                'Files: upload, tag, edit own + team media',
                'Requests: pick up, status-flip, comment',
                'Browse every team page + player page + Game Center',
                'Resources, including admin-tier SOPs',
              ],
              cant: [
                'People & Roles, trades, bio imports, diagnostics (master only)',
                'Drive key edits (read-only)',
                'Hide posts from feeds (master only)',
                'Edit player vitals (master only)',
              ],
            },
            {
              role: 'Athlete',
              accent: '#F59E0B',
              tagline: 'Player or coach. Self-serve for your own content.',
              can: [
                'View every team + player page + Game Center',
                'Edit your own About-me on your player page (feeds AI captions)',
                'Generate posts in Studio scoped to your team',
                'Upload + tag media for your team',
                'File requests with the master admin (DM card in Settings)',
                'See your own request history',
              ],
              cant: [
                'See requests filed by other athletes',
                'Browse Files across other teams\' uploads',
                'Edit profile photos / vitals on player pages (admins handle this)',
                'Use Drive sync, overlay/effect uploads, or master diagnostics',
              ],
            },
          ].map(r => (
            <div key={r.role} style={{
              background: `${r.accent}06`,
              border: `1px solid ${r.accent}33`,
              borderRadius: radius.base,
              padding: 14,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div>
                <div style={{
                  fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
                  letterSpacing: 0.8, color: r.accent, textTransform: 'uppercase',
                  marginBottom: 4,
                }}>{r.role}</div>
                <div style={{ fontSize: 12, color: colors.textSecondary, fontStyle: 'italic', lineHeight: 1.4 }}>
                  {r.tagline}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: colors.text, marginBottom: 4 }}>Can:</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: colors.textSecondary }}>
                  {r.can.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: colors.text, marginBottom: 4 }}>Can't:</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: colors.textMuted }}>
                  {r.cant.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* v4.5.42: Master-admin-only pre-flight checklist for onboarding
          a new external user. Lives in Resources so it doesn't clutter
          Settings; gated to master so admins can't see what's expected
          of them before being onboarded. */}
      {isMaster && (
        <Card id="onboard-preflight" style={{ scrollMarginTop: 80 }}>
          <SectionHeading>Pre-flight: onboard a new admin</SectionHeading>
          <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 14, lineHeight: 1.55, maxWidth: '70ch' }}>
            Run through this list once per new admin you bring on. Each item answers a real question that\'s tripped up an onboarding before. Keep it open in a tab while they have their first session.
          </div>
          <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13, lineHeight: 1.7, color: colors.text }}>
            <li><strong>Decide the role</strong> — admin (full access bar master tools) or content (production-only). When in doubt, start at content; promote later via People & Roles.</li>
            <li><strong>Invite from Settings → People &amp; Roles</strong> — paste their email, set role, optionally pin them to a team. Magic-link email sends immediately.</li>
            <li><strong>Confirm they got the email</strong> — first-time invitations sometimes land in Promotions. Tell them to search "BLW Studio" in their inbox.</li>
            <li><strong>Tell them how to click it</strong> — corporate email security tools (Outlook 365, Mimecast, Barracuda) sometimes pre-click links to scan for malware, which burns the token before the human does. If they\'re on a managed work email, ask them to (a) click within 30 minutes of receipt, (b) NOT forward the email, and (c) copy the link into a fresh browser tab if their email client tries to "preview" it. Returning sign-in links also need to be opened on the same device that requested them (PKCE protects against scanners but means same-device-same-browser).</li>
            <li><strong>Watch them land</strong> — first dashboard view shows the one-time welcome card. They\'ll see role + first action ("Open the Studio →"). If the card doesn\'t appear they\'re probably master-tier by mistake — check People & Roles.</li>
            <li><strong>Verify role gating</strong> — have them click around: Settings should hide People &amp; Roles + bio import + diagnostics; Drive key shows read-only; Studio works fully; Files works fully. Nothing should 401 or 500.</li>
            <li><strong>Verify Drive sync</strong> — your Drive API key auto-syncs to them on sign-in. Within 60s of their first session they should see overlays + saved folders. If empty, hit Settings → Google Drive → Sync now in your master session.</li>
            <li><strong>Run a test post together</strong> — a real Studio export + download. Tells you AI endpoints work, file save works, generate-log writes work. Their post lands in the dashboard recent strip.</li>
            <li><strong>Point them at Resources</strong> — they\'ll find the role permissions reference, FAQ, and how-tos here.</li>
            <li><strong>Wait a day before granting more</strong> — don\'t bump content → admin until they\'ve been in for 24 hours. Cheap insurance.</li>
          </ol>
          <div style={{
            marginTop: 14, padding: 12, background: colors.bg, borderRadius: radius.base,
            border: `1px solid ${colors.borderLight}`, fontSize: 12, color: colors.textSecondary, lineHeight: 1.55,
          }}>
            <strong style={{ color: colors.text }}>If something\'s off:</strong>{' '}
            ask the new admin to hard-refresh (⌘⇧R), then check People &amp; Roles to confirm their assigned role + team. Most "I can\'t see X" issues resolve from a refresh + a role/team correction.
          </div>
        </Card>
      )}

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

      {visibleSections.map(section => {
        const sectionExtras = extras[section.id] || [];
        const hiddenForSection = hiddenItems[section.id] || [];
        const hiddenSet = new Set(hiddenForSection);
        const visibleBuiltIns = section.items.filter(it => !hiddenSet.has(it.title));
        return (
          <Card key={section.id} id={section.id} style={{ scrollMarginTop: 80 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
              <SectionHeading>{section.title}</SectionHeading>
              {isMaster && hiddenForSection.length > 0 && (
                <button
                  onClick={() => restoreAllBuiltIns(section.id)}
                  title={`Restore ${hiddenForSection.length} hidden placeholder${hiddenForSection.length === 1 ? '' : 's'}`}
                  style={{
                    background: 'none', border: `1px solid ${colors.borderLight}`,
                    color: colors.textMuted, cursor: 'pointer',
                    borderRadius: radius.sm, padding: '3px 9px',
                    fontFamily: fonts.condensed, fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                  }}
                >↺ RESTORE {hiddenForSection.length} HIDDEN</button>
              )}
            </div>
            <div style={{
              fontSize: 13, color: colors.textSecondary, lineHeight: 1.6,
              marginBottom: 14, maxWidth: '60ch',
            }}>
              {section.summary}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visibleBuiltIns.map((item, i) => (
                <ResourceItem
                  key={i}
                  item={item}
                  // v4.5.37: Master admin can hide built-in placeholders
                  // ("Coming soon" stubs from RESOURCE_SECTIONS). Hides
                  // for every viewer until restored. The actual
                  // RESOURCE_SECTIONS code stays untouched — we record
                  // the hidden title in the cloud config so a future
                  // copy refresh doesn't lose the hide state.
                  removable={isMaster}
                  removeLabel="Hide"
                  onRemove={() => {
                    if (window.confirm(`Hide "${item.title}" from this section? Master admin only — you can restore it from the section header.`)) {
                      hideBuiltIn(section.id, item.title);
                    }
                  }}
                />
              ))}
              {sectionExtras.map((item, i) => (
                <ResourceItem
                  key={`extra-${i}`}
                  item={item}
                  removable={isMaster}
                  onRemove={() => removeExtra(section.id, i)}
                />
              ))}
              {visibleBuiltIns.length === 0 && sectionExtras.length === 0 && (
                <div style={{
                  fontSize: 12, color: colors.textMuted, fontStyle: 'italic',
                  padding: '12px 14px', background: colors.bg,
                  borderRadius: radius.base, border: `1px dashed ${colors.borderLight}`,
                }}>
                  Nothing in this section yet.
                  {isMaster && ' Use the “+ Add resource” button below to drop in a link.'}
                </div>
              )}
            </div>
            {isMaster && (
              <ResourceAdder onAdd={(item) => addExtra(section.id, item)} />
            )}
          </Card>
        );
      })}
    </div>
  );
}

function ResourceItem({ item, removable = false, onRemove = null, removeLabel = 'Remove' }) {
  const icon = item.icon
    || (item.kind === 'video' ? '▶'
      : item.kind === 'link' ? '↗'
      : item.kind === 'file' ? '⬇'
      : '◧');

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
        {removable && onRemove && (
          <button
            onClick={onRemove}
            title={`${removeLabel} this placeholder (master admin)`}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: colors.textMuted, padding: '0 6px',
              fontSize: 14,
            }}
          >✕</button>
        )}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 8,
      borderRadius: radius.base,
      border: `1px solid ${colors.borderLight}`,
      background: colors.white,
      transition: 'border-color 0.15s',
    }}>
      <a
        href={item.url}
        target={item.kind === 'video' || item.kind === 'link' || item.kind === 'file' ? '_blank' : undefined}
        rel={item.kind === 'video' || item.kind === 'link' || item.kind === 'file' ? 'noreferrer' : undefined}
        style={{
          flex: 1, display: 'flex', alignItems: 'baseline', gap: 12,
          padding: '10px 14px',
          textDecoration: 'none', color: 'inherit',
        }}
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
      {removable && onRemove && (
        <button
          onClick={() => {
            if (window.confirm(`Remove "${item.title}" from this section?`)) onRemove();
          }}
          title="Remove this resource (master admin)"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: colors.textMuted, padding: '0 12px',
            fontSize: 14,
          }}
        >✕</button>
      )}
    </div>
  );
}

// Master-admin only — collapsed by default, expands to a 4-field
// inline form (kind, title, url, detail). New entries persist via
// /api/app-settings.
function ResourceAdder({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('link');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [detail, setDetail] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!title.trim()) { setErr('Title is required.'); return; }
    if (!url.trim())   { setErr('URL is required.'); return; }
    setErr('');
    setSaving(true);
    try {
      await onAdd({ kind, title: title.trim(), url: url.trim(), detail: detail.trim() });
      setTitle(''); setUrl(''); setDetail(''); setOpen(false);
    } catch (e) {
      setErr(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          marginTop: 10,
          background: colors.bg, border: `1px dashed ${colors.border}`,
          color: colors.textSecondary, cursor: 'pointer',
          borderRadius: radius.sm, padding: '7px 14px',
          fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
        }}
      >+ Add resource</button>
    );
  }

  const inputStyle = {
    padding: '7px 10px',
    border: `1px solid ${colors.border}`, borderRadius: radius.sm,
    fontFamily: fonts.body, fontSize: 12, color: colors.text,
    background: colors.white,
    width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={{
      marginTop: 10,
      padding: 12, borderRadius: radius.base,
      background: colors.bg, border: `1px solid ${colors.border}`,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{
        fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
        color: colors.textSecondary, letterSpacing: 0.8,
      }}>NEW RESOURCE</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={kind} onChange={e => setKind(e.target.value)} style={{ ...inputStyle, width: 120 }}>
          <option value="link">Link</option>
          <option value="doc">Document</option>
          <option value="video">Video</option>
          <option value="file">File / download</option>
        </select>
        <input
          type="text" value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Title"
          style={{ ...inputStyle, flex: '2 1 200px' }}
        />
      </div>
      <input
        type="url" value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="URL — paste a Drive share, Loom, Notion page, or any direct file URL"
        style={inputStyle}
      />
      <input
        type="text" value={detail}
        onChange={e => setDetail(e.target.value)}
        placeholder="Optional one-line description"
        style={inputStyle}
      />
      {err && (
        <div style={{ fontSize: 11, color: '#991B1B' }}>{err}</div>
      )}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button
          onClick={() => { setOpen(false); setErr(''); }}
          disabled={saving}
          style={{
            background: 'none', border: `1px solid ${colors.border}`,
            color: colors.textSecondary, cursor: 'pointer',
            borderRadius: radius.sm, padding: '6px 12px',
            fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
          }}
        >Cancel</button>
        <button
          onClick={submit}
          disabled={saving}
          style={{
            background: colors.red, border: `1px solid ${colors.red}`,
            color: '#fff', cursor: saving ? 'wait' : 'pointer',
            borderRadius: radius.sm, padding: '6px 14px',
            fontFamily: fonts.condensed, fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
          }}
        >{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
