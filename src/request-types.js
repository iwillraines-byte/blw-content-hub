// Single source of truth for request types — drives the type-picker in
// the new RequestModal, the per-card type badge on the Requests page,
// and the field-routing logic that decides which inputs to render for
// each type. Adding a new type means appending one entry here; the
// modal + cards pick it up automatically.
//
// Each type owns:
//   id        — stable string stored on the row's `type` column
//   label     — what the human sees in the picker + on the badge
//   icon      — emoji prefix for visual distinction (matches the rest of the app's icon vocabulary)
//   summary   — one-sentence description shown under the picker tile
//   palette   — { bg, fg, border } token references; the badge tints
//               with these so each type has a consistent visual identity
//               across the page
//   fields    — array of additional fields to render for this type
//               beyond the universal title / description / priority /
//               needBy / requesterEmail. Each field has { key, label,
//               kind, placeholder, required }.
//   audience  — 'staff' | 'athlete' | 'all' — gates which roles can
//               PICK this type from the modal (server still enforces
//               who can SEE which requests).

import { colors } from './theme';

export const REQUEST_TYPES = [
  {
    id: 'content',
    label: 'Content',
    icon: '🎨',
    summary: 'Graphics, videos, social posts. Tied to a team and (optionally) a player.',
    palette: { bg: colors.accentSoft, fg: colors.accent, border: colors.accentBorder },
    audience: 'all',
    fields: [
      { key: 'team', label: 'Team', kind: 'team', required: true },
      { key: 'playerLastName', label: 'Player', kind: 'player', required: false },
      { key: 'template', label: 'Template', kind: 'template', required: false },
      { key: 'athleteInput', label: "Athlete's input (optional)", kind: 'textarea', placeholder: "Anything the player wants on their post — references, jokes, walk-up vibe, photos to use…", required: false },
    ],
  },
  {
    id: 'profile-update',
    label: 'Profile update',
    icon: '✎',
    summary: 'Fix or update a player profile — bio, photo, jersey number, social handles.',
    palette: { bg: colors.infoBg, fg: colors.infoText, border: colors.infoBorder },
    audience: 'all',
    fields: [
      { key: 'team', label: 'Team', kind: 'team', required: true },
      { key: 'playerLastName', label: 'Player', kind: 'player', required: true },
      { key: 'profileField', label: 'What to change', kind: 'select', options: [
        { value: 'photo', label: 'Profile photo' },
        { value: 'nickname', label: 'Nickname' },
        { value: 'jersey', label: 'Jersey number' },
        { value: 'instagram', label: 'Instagram handle' },
        { value: 'bio', label: 'Bio / fun facts' },
        { value: 'other', label: 'Something else (describe below)' },
      ], required: true },
    ],
  },
  {
    id: 'bug',
    label: 'Bug',
    icon: '⚠',
    summary: 'Something is broken. Tell us where in the tool and how to reproduce it.',
    palette: { bg: colors.redLight, fg: colors.dangerText, border: colors.redBorder },
    audience: 'all',
    fields: [
      { key: 'whereInApp', label: 'Where in the app', kind: 'text', placeholder: 'e.g. Generate page, Custom mode, "Open in Generate" button' },
      { key: 'reproSteps', label: 'How to reproduce', kind: 'textarea', placeholder: '1. Click X\n2. See Y\n3. Expected Z but got W' },
    ],
  },
  {
    id: 'template',
    label: 'Template',
    icon: '🧩',
    summary: 'Pitch a new graphic template — what it shows, when it would get used.',
    palette: { bg: colors.warningBg, fg: colors.warningText, border: colors.warningBorder },
    audience: 'staff',
    fields: [
      { key: 'templateConcept', label: 'What the template shows', kind: 'textarea', placeholder: 'e.g. "Win-streak counter graphic — team logo, current streak length, last opponent."', required: true },
      { key: 'whenUsed', label: 'When would it get posted', kind: 'text', placeholder: 'e.g. After every game where streak ≥ 3' },
    ],
  },
  {
    id: 'feature',
    label: 'Feature',
    icon: '✨',
    summary: 'New tool capability — what it does, why it matters.',
    palette: { bg: colors.successBg, fg: colors.successText, border: colors.successBorder },
    audience: 'staff',
    fields: [
      { key: 'featureWhat', label: 'What the feature does', kind: 'textarea', placeholder: 'e.g. "Auto-export Story format alongside the Feed export"', required: true },
      { key: 'featureWhy', label: 'Why it matters', kind: 'textarea', placeholder: 'What is hard or impossible today that this fixes?' },
    ],
  },
  {
    id: 'integration',
    label: 'Integration / Game',
    icon: '🔌',
    summary: 'Connect a new external service or league event (Metricool, Notion, all-star game…).',
    palette: { bg: colors.bg, fg: colors.textSecondary, border: colors.border },
    audience: 'staff',
    fields: [
      { key: 'externalTool', label: 'Tool or event', kind: 'text', placeholder: 'e.g. Metricool, Notion, All-Star Game' },
      { key: 'whatToConnect', label: 'What needs to flow', kind: 'textarea', placeholder: 'e.g. "Pull Notion content calendar into the dashboard." Or "All-Star game scoreboard format."' },
    ],
  },
];

export function getRequestType(id) {
  return REQUEST_TYPES.find(t => t.id === id) || REQUEST_TYPES[0];
}

// Filter the picker by who's looking. Athletes only see types that
// are 'all' or 'athlete' explicitly. Staff sees everything. The
// server still enforces what they can SEE in the queue independently.
export function visibleRequestTypes(role) {
  if (role === 'athlete') return REQUEST_TYPES.filter(t => t.audience === 'all' || t.audience === 'athlete');
  return REQUEST_TYPES;
}

// Priority taxonomy. Critical added in v4.4.0 — used for "this is
// blocking content from going out" kind of urgency. UI maps these to
// dot colors so the queue reads at a glance.
export const PRIORITY_LEVELS = [
  { id: 'critical', label: 'Critical', dotColor: '#7C2D12', description: 'Blocking — content can\'t ship without it' },
  { id: 'high',     label: 'High',     dotColor: '#EF4444', description: 'Soon — needs attention this week' },
  { id: 'medium',   label: 'Medium',   dotColor: '#F59E0B', description: 'When you can — no hard deadline' },
  { id: 'low',      label: 'Low',      dotColor: '#22C55E', description: 'Nice-to-have, eventually' },
];

export function getPriority(id) {
  return PRIORITY_LEVELS.find(p => p.id === id) || PRIORITY_LEVELS[2];
}
