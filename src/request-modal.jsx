// New request modal — replaces the inline "+ New Request" form on the
// Requests page. Single progressive form (not multi-step) so the user
// sees the whole shape of what they're submitting at a glance:
//
//   1. Type picker — radio cards with icon + summary, full-width grid.
//   2. Type-specific fields — render dynamically from
//      REQUEST_TYPES[type].fields. Player/team selectors auto-pin
//      for athlete role.
//   3. Universal: title, description, priority, needBy.
//   4. Submit footer — primary CTA, cancel, helper text confirming
//      the email the notification will land at.
//
// Submission persists to localStorage via the existing requests-store
// + flows up to Supabase via the cloud-sync upsert path. The server
// stamps requester_user_id + requester_email from the JWT so the
// client can't spoof who sent it (and athletes get auto-pinned to
// their own email).

import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Card, Label, RedButton, OutlineButton, TeamLogo, inputStyle, selectStyle } from './components';
import { colors, fonts, radius } from './theme';
import { TEAMS, TEMPLATES, getTeam } from './data';
import { useAuth } from './auth';
import { REQUEST_TYPES, PRIORITY_LEVELS, getRequestType, visibleRequestTypes } from './request-types';
import { getRequests, saveRequests } from './requests-store';

export function RequestModal({ open, onClose, onSubmitted, defaultType = 'content', defaultTeam = '', roster = [] }) {
  const { user, role, teamId: profileTeamId } = useAuth();
  const isAthlete = role === 'athlete';

  // Type picker — gated by audience. Athletes see content + profile +
  // bug. Staff sees everything. Default depends on caller (Files page
  // could open with 'bug' pre-selected, dashboard with 'content', etc.)
  const allowedTypes = useMemo(() => visibleRequestTypes(role), [role]);
  const [type, setType] = useState(() => {
    const fallback = allowedTypes[0]?.id || 'content';
    return allowedTypes.some(t => t.id === defaultType) ? defaultType : fallback;
  });
  const typeConfig = getRequestType(type);

  // Universal fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [needBy, setNeedBy] = useState('');

  // Type-specific dynamic fields. Stored as a flat object; the keys
  // map 1:1 to REQUEST_TYPES[type].fields so we serialize cleanly to
  // the request's `note` and any future per-type columns.
  const [fieldValues, setFieldValues] = useState({});

  // Athletes get auto-pinned to their team. Reset when the modal
  // opens so a stale value from a previous session doesn't leak in.
  useEffect(() => {
    if (!open) return;
    if (isAthlete && profileTeamId) {
      setFieldValues(v => ({ ...v, team: profileTeamId }));
    } else if (defaultTeam) {
      setFieldValues(v => ({ ...v, team: defaultTeam }));
    }
  }, [open, isAthlete, profileTeamId, defaultTeam]);

  // ESC closes when not submitting
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !submitting) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, submitting]);

  if (!open) return null;

  // Validation — every type requires title + description, plus any
  // fields marked required:true in the type config. We surface the
  // submit disabled state rather than throwing toasts mid-typing —
  // the user can read the form and see what's missing.
  const requiredMissing = (() => {
    if (!title.trim()) return 'Add a short title';
    if (!description.trim()) return 'Describe what you need';
    for (const f of typeConfig.fields || []) {
      if (f.required && !fieldValues[f.key]) return `Missing: ${f.label}`;
    }
    return null;
  })();

  const handleSubmit = async () => {
    if (requiredMissing) return;
    setSubmitting(true);
    const now = new Date();
    // Compose the full request record. `note` carries human-readable
    // prose so legacy surfaces (the existing Requests page card
    // preview) still render something meaningful even before we wire
    // the new layout for every type. Type-specific fields encoded as
    // a fenced JSON suffix at the end of `note` so they round-trip
    // through cloud-sync without needing per-type columns yet.
    const flatFields = Object.entries(fieldValues)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    const noteProse = [title, description, flatFields].filter(Boolean).join('\n\n');

    const newReq = {
      id: crypto.randomUUID(),
      type,
      team: fieldValues.team || (isAthlete ? profileTeamId : '') || 'BLW',
      template: fieldValues.template || '',
      title: title.trim(),
      status: 'pending',
      priority,
      requester: isAthlete ? (user?.email?.split('@')[0] || 'Athlete') : 'You',
      requesterEmail: user?.email || '',
      requesterUserId: user?.id || null,
      playerLastName: fieldValues.playerLastName || '',
      playerFirstInitial: fieldValues.playerFirstInitial || '',
      needBy: needBy || null,
      date: now.toLocaleString(undefined, { month: 'short', day: 'numeric' }),
      createdAt: now.getTime(),
      note: noteProse,
    };

    const next = [newReq, ...getRequests()];
    saveRequests(next);
    setSubmitting(false);
    onSubmitted?.(newReq);
    // Reset for next open
    setTitle(''); setDescription(''); setPriority('medium'); setNeedBy('');
    setFieldValues({});
    onClose?.();
  };

  const setF = (key, value) => setFieldValues(prev => ({ ...prev, [key]: value }));

  // v4.5.55: Portal to document.body — see BulkImportModal for the full
  // explainer. Short version: the .route-enter transform wrapper in
  // App.jsx captures position:fixed, so an unportaled modal lands
  // off-screen on tall pages.
  const overlay = (
    <div
      onClick={onClose}
      role="dialog"
      aria-label="New request"
      style={{
        position: 'fixed', inset: 0, zIndex: 250,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '5vh 16px',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720,
          background: colors.white,
          borderRadius: radius.lg,
          boxShadow: '0 28px 60px rgba(0,0,0,0.3), 0 6px 14px rgba(0,0,0,0.12)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px',
          borderBottom: `1px solid ${colors.borderLight}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontFamily: fonts.heading, fontSize: 22, margin: 0, letterSpacing: 1, fontWeight: 400 }}>
              New request
            </h2>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
              {isAthlete
                ? 'Tell us what you need — we\'ll email you when it\'s done.'
                : 'Pick a type, fill in the details, ship it.'}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 22, color: colors.textSecondary, padding: '2px 8px',
          }}>✕</button>
        </div>

        {/* Body — scrolls when content exceeds viewport */}
        <div style={{
          padding: 22,
          display: 'flex', flexDirection: 'column', gap: 20,
          overflowY: 'auto',
          maxHeight: 'calc(90vh - 140px)',
        }}>
          {/* Type picker — radio cards, full-bleed within the modal so
              the user reads it as the primary choice. Two-column grid
              on desktop, single column on narrow widths. */}
          <div>
            <Label style={{ marginBottom: 8 }}>Request type</Label>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 8,
            }}>
              {allowedTypes.map(t => {
                const active = type === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setType(t.id)}
                    style={{
                      textAlign: 'left',
                      padding: 12,
                      borderRadius: radius.base,
                      background: active ? t.palette.bg : colors.white,
                      border: `1px solid ${active ? t.palette.border : colors.borderLight}`,
                      cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', gap: 4,
                      transition: 'background 160ms ease, border-color 160ms ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span aria-hidden="true" style={{ fontSize: 14 }}>{t.icon}</span>
                      <span style={{
                        fontFamily: fonts.body, fontSize: 13, fontWeight: 700,
                        color: active ? t.palette.fg : colors.text,
                      }}>{t.label}</span>
                    </div>
                    <div style={{
                      fontFamily: fonts.condensed, fontSize: 11, lineHeight: 1.4,
                      color: colors.textSecondary,
                    }}>{t.summary}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title — universal, the headline of the request */}
          <div>
            <Label>Title</Label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="One sentence that says what this is"
              style={{ ...inputStyle, marginTop: 4 }}
              maxLength={140}
            />
          </div>

          {/* Type-specific fields */}
          {(typeConfig.fields || []).map(f => (
            <DynamicField
              key={f.key}
              field={f}
              value={fieldValues[f.key] || ''}
              onChange={v => setF(f.key, v)}
              roster={roster}
              isAthlete={isAthlete}
              athleteTeam={profileTeamId}
              currentTeam={fieldValues.team || ''}
            />
          ))}

          {/* Description — universal, free-form context */}
          <div>
            <Label>Description</Label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={isAthlete
                ? 'Anything we should know — references, vibe, photos to use, examples you like.'
                : 'Add context — links, screenshots, examples, deadlines.'}
              style={{ ...inputStyle, marginTop: 4, minHeight: 100, resize: 'vertical' }}
              maxLength={2000}
            />
          </div>

          {/* Priority + needBy row — paired because they're both
              "when does this matter" signals. Two-column on desktop,
              stacked on narrow viewports. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
          }}>
            <div>
              <Label>Priority</Label>
              <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                {PRIORITY_LEVELS.map(p => {
                  const active = priority === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setPriority(p.id)}
                      title={p.description}
                      style={{
                        padding: '6px 10px',
                        borderRadius: radius.sm,
                        background: active ? p.dotColor : colors.white,
                        color: active ? '#fff' : colors.textSecondary,
                        border: `1px solid ${active ? p.dotColor : colors.borderLight}`,
                        cursor: 'pointer',
                        fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
                        letterSpacing: 0.4, textTransform: 'uppercase',
                        transition: 'background 160ms ease',
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <Label>Needed by (optional)</Label>
              <input
                type="date"
                value={needBy}
                onChange={e => setNeedBy(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                style={{ ...inputStyle, marginTop: 4 }}
              />
            </div>
          </div>

          {/* Email confirmation — show the user where the notification
              will land. Pulled from auth profile, never editable here
              (would let an athlete redirect their own notifications
              elsewhere — bad). */}
          {user?.email && (
            <div style={{
              padding: 10,
              background: colors.bg,
              border: `1px solid ${colors.borderLight}`,
              borderRadius: radius.sm,
              fontSize: 12, color: colors.textSecondary,
              fontFamily: fonts.condensed, letterSpacing: 0.3,
            }}>
              ✉ Notifications about this request will go to <strong style={{ color: colors.text }}>{user.email}</strong>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 22px',
          borderTop: `1px solid ${colors.borderLight}`,
          display: 'flex', alignItems: 'center', gap: 10,
          background: colors.bg,
        }}>
          <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.condensed, flex: 1 }}>
            {requiredMissing
              ? <>⚠ {requiredMissing}</>
              : 'Ready to send.'}
          </span>
          <OutlineButton onClick={onClose} disabled={submitting}>Cancel</OutlineButton>
          <RedButton onClick={handleSubmit} disabled={!!requiredMissing || submitting}>
            {submitting ? 'Submitting…' : 'Submit request'}
          </RedButton>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

// ─── Dynamic field renderer ────────────────────────────────────────────────
// Looks at a field config and picks the right input. Centralized here
// so the modal body stays declarative — adding a new field type means
// adding one branch here, not editing the modal.
function DynamicField({ field, value, onChange, roster, isAthlete, athleteTeam, currentTeam }) {
  const { kind, key, label, options, placeholder, required } = field;

  if (kind === 'team') {
    // Athletes are pinned to their own team — render as a read-only
    // chip + locked select so they understand WHY they can't change it.
    const t = athleteTeam ? getTeam(athleteTeam) : null;
    if (isAthlete && t) {
      return (
        <div>
          <Label>{label}{required && ' *'}</Label>
          <div style={{
            marginTop: 4,
            padding: '8px 10px',
            background: colors.bg,
            border: `1px solid ${colors.borderLight}`,
            borderRadius: radius.sm,
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 13, color: colors.textSecondary,
          }}>
            <TeamLogo teamId={t.id} size={20} rounded="square" />
            <span style={{ fontWeight: 700, color: colors.text }}>{t.name}</span>
            <span style={{
              marginLeft: 'auto',
              fontFamily: fonts.condensed, fontSize: 9, fontWeight: 800,
              letterSpacing: 0.5, color: colors.textMuted,
            }}>YOUR TEAM</span>
          </div>
        </div>
      );
    }
    return (
      <div>
        <Label>{label}{required && ' *'}</Label>
        <select value={value} onChange={e => onChange(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
          <option value="">Select team…</option>
          {/* v4.5.61: "League-wide" option for requests that aren't tied
              to a single team (all-star content, league branding, etc.) */}
          <option value="BLW">League-wide (BLW)</option>
          {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
    );
  }

  if (kind === 'player') {
    // Roster filter follows the team selection above. Lastnames only —
    // the request's player_first_initial column captures the FI when
    // we add it to the modal flow later. For now, the lastname is
    // enough for the staff to find the right player.
    const teamFiltered = currentTeam && currentTeam !== 'BLW'
      ? roster.filter(p => p.team === currentTeam)
      : [];
    const sorted = [...teamFiltered].sort((a, b) => (a.lastName || '').localeCompare(b.lastName || ''));
    const placeholder = currentTeam === 'BLW'
      ? 'Pick a player (or leave on "Any player")'
      : currentTeam ? 'Select player…' : 'Pick a team first';
    return (
      <div>
        <Label>{label}{required && ' *'}</Label>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ ...selectStyle, marginTop: 4 }}
          disabled={!currentTeam}
        >
          <option value="">{placeholder}</option>
          {/* v4.5.61: "Any player" option — used when the request is
              cross-roster (best home runs across BLW, league
              all-star recap, etc.). Selecting it sends the request
              with playerLastName='*' so the queue badge reads "Any". */}
          {currentTeam && <option value="*">Any player</option>}
          {sorted.map(p => (
            <option key={`${p.firstInitial}|${p.lastName}|${p.num}`} value={p.lastName.toUpperCase()}>
              {p.firstInitial ? `${p.firstInitial}.` : ''}{p.lastName}{p.num ? ` #${p.num}` : ''}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (kind === 'template') {
    return (
      <div>
        <Label>{label}{required && ' *'}</Label>
        <select value={value} onChange={e => onChange(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
          <option value="">Select template…</option>
          {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
        </select>
      </div>
    );
  }

  if (kind === 'select') {
    return (
      <div>
        <Label>{label}{required && ' *'}</Label>
        <select value={value} onChange={e => onChange(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
          <option value="">Select…</option>
          {(options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }

  if (kind === 'textarea') {
    return (
      <div>
        <Label>{label}{required && ' *'}</Label>
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder || ''}
          style={{ ...inputStyle, marginTop: 4, minHeight: 80, resize: 'vertical' }}
          maxLength={1500}
        />
      </div>
    );
  }

  // text (default)
  return (
    <div>
      <Label>{label}{required && ' *'}</Label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || ''}
        style={{ ...inputStyle, marginTop: 4 }}
      />
    </div>
  );
}
