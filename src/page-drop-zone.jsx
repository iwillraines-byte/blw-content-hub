// PageDropZone — drag-anywhere upload affordance for player + team pages.
//
// v4.5.27: When you're already on Konnor Jaso's player page and his
// new headshot lands in your downloads folder, dropping it into the
// page should "just work" — team + lastName + first initial all come
// from the URL, you only pick the asset type. Same idea on team pages
// for team-scoped assets (TEAMPHOTO, VENUE, LOGO).
//
// How it works:
//   1. Window-level dragenter/over/leave/drop listeners — drop ANY-
//      where on the page, not just on a small target.
//   2. On dragenter → render a full-screen brand-red overlay so the
//      drop target is impossible to miss.
//   3. On drop → run client-side compression (same pipeline as Files
//      page), then show an asset-type picker. User clicks → file
//      saves with a constructed filename like
//      `LAN_03_K.JASO_HEADSHOT.jpg` — that's the canonical naming
//      convention so every downstream lookup (avatar resolver,
//      gallery, generate-page picker) finds it without any other
//      changes.
//   4. Multiple files in one drop apply the same asset type. Cuts the
//      decision count to one even on a 10-file drop.
//
// Mounting:
//   Wrap the page tree in <PageDropZone team={team} player={player|null}>.
//   The component renders {children} unchanged — it just adds the
//   document-level handlers + overlay portal.

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { saveMedia, blobToObjectURL, buildPlayerFilename, buildTeamFilename } from './media-store';
import { compressImageBlob, getCompressPreference } from './image-compress';
import { useToast } from './toast';
import { colors, fonts, radius } from './theme';

// Asset types per scope. Keep the list TIGHT — these are the ones an
// admin actually picks at drop time. Power users can still rename
// later from the Files page if they need an obscure type.
const PLAYER_ASSET_TYPES = [
  { id: 'HEADSHOT', label: 'Headshot', icon: '◉', hint: 'Studio portrait, face only' },
  { id: 'PORTRAIT', label: 'Portrait', icon: '◧', hint: 'Posed shot, 3/4 length' },
  { id: 'HITTING',  label: 'Hitting',  icon: '⚡', hint: 'At-bat / swing / contact' },
  { id: 'PITCHING', label: 'Pitching', icon: '↗', hint: 'Windup / release / mound' },
  { id: 'ACTION',   label: 'Other action', icon: '⚙', hint: 'Fielding / running / reaction' },
];

const TEAM_ASSET_TYPES = [
  { id: 'TEAMPHOTO', label: 'Team photo', icon: '◫', hint: 'Full roster shot' },
  { id: 'VENUE',     label: 'Venue',      icon: '⌂', hint: 'Stadium / field' },
  { id: 'LOGO_PRIMARY', label: 'Logo',    icon: '◉', hint: 'Logo / wordmark' },
];

export function PageDropZone({ team, player = null, onUploaded, children }) {
  const [dragActive, setDragActive] = useState(false);
  const [pickerFiles, setPickerFiles] = useState(null); // File[] awaiting type selection
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  // Window-level drag handlers. Counter-pattern (incrementing depth on
  // dragenter, decrementing on dragleave) avoids the dragleave/dragenter
  // flicker as the cursor moves between child elements.
  useEffect(() => {
    if (!team) return undefined;
    let depth = 0;
    const onEnter = (e) => {
      // Only react to file drags — ignore in-page text/element drags.
      if (!e.dataTransfer?.types?.includes('Files')) return;
      depth++;
      setDragActive(true);
    };
    const onOver = (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragActive(false);
    };
    const onDrop = (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      depth = 0;
      setDragActive(false);
      const files = Array.from(e.dataTransfer.files || []).filter(f =>
        f.type.startsWith('image/') || f.type.startsWith('video/')
      );
      if (files.length === 0) {
        toast.warn('Nothing to upload', { detail: 'Only image and video files are supported.' });
        return;
      }
      setPickerFiles(files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [team, toast]);

  // ESC closes the asset-type picker (cancel the drop).
  useEffect(() => {
    if (!pickerFiles) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !saving) setPickerFiles(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerFiles, saving]);

  // Save all the dropped files with the chosen asset type. Compress
  // each one through the same pipeline the Files page uses, save via
  // saveMedia (which also fires the cloud sync), and toast the result.
  const saveWithType = useCallback(async (assetType) => {
    if (!pickerFiles || !team) return;
    setSaving(true);
    const compressOn = getCompressPreference();
    const playerLastName = (player?.lastName || '').toUpperCase();
    const playerFI = (player?.firstInitial || (player?.firstName || '').charAt(0) || '').toUpperCase();
    const playerNum = player?.num || '';
    let okCount = 0, failCount = 0;
    const savedRecords = [];
    for (const file of pickerFiles) {
      try {
        let blobToSave = file;
        let width = 0, height = 0;
        if (compressOn && file.type.startsWith('image/')) {
          try {
            const result = await compressImageBlob(file);
            blobToSave = result.blob;
            width = result.width;
            height = result.height;
          } catch { /* fall back to original */ }
        }
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const filename = player
          ? buildPlayerFilename({
              team: team.id,
              num: playerNum,
              firstInitial: playerFI,
              lastName: playerLastName,
              assetType,
              ext,
            })
          : buildTeamFilename({
              team: team.id,
              assetType,
              ext,
            });
        const record = await saveMedia({
          name: filename,
          blob: blobToSave,
          width,
          height,
          source: 'page-drop',
        });
        savedRecords.push(record);
        okCount++;
      } catch (err) {
        console.warn('[PageDropZone] save failed', file?.name, err);
        failCount++;
      }
    }
    setSaving(false);
    setPickerFiles(null);
    if (okCount > 0) {
      const subject = player ? player.name || playerLastName : team.name;
      toast.success(
        `Added ${okCount} photo${okCount === 1 ? '' : 's'}`,
        { detail: `Tagged as ${assetType} for ${subject}.` }
      );
      if (onUploaded) onUploaded(savedRecords);
    }
    if (failCount > 0) {
      toast.error(
        `${failCount} upload${failCount === 1 ? '' : 's'} failed`,
        { detail: 'See console for details.' }
      );
    }
  }, [pickerFiles, team, player, toast, onUploaded]);

  // Build the dragover overlay JSX (rendered via portal so it always
  // sits at the top of the stacking context).
  const dragOverlay = dragActive ? (
    <div style={{
      position: 'fixed', inset: 0,
      background: `${team?.color || colors.red}1A`,
      border: `4px dashed ${team?.color || colors.red}`,
      zIndex: 999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
      backdropFilter: 'blur(2px)',
    }}>
      <div style={{
        background: colors.white,
        borderRadius: radius.lg,
        padding: '32px 40px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        textAlign: 'center',
        maxWidth: 480,
      }}>
        <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 12 }}>⤓</div>
        <div style={{
          fontFamily: fonts.heading, fontSize: 24, color: colors.text,
          letterSpacing: 0.5, lineHeight: 1.2, marginBottom: 6,
        }}>
          Drop to add{player ? ` to ${player.name || player.lastName}` : ` to ${team?.name || ''}`}
        </div>
        <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.5 }}>
          {player
            ? `Tagged automatically with ${team?.id} · ${player.lastName}${playerFI(player) ? ` (${playerFI(player)})` : ''}. You'll pick HEADSHOT vs ACTION on drop.`
            : `Saved as a team-scoped asset for ${team?.name}. Pick the asset type on drop.`}
        </div>
      </div>
    </div>
  ) : null;

  // Asset-type picker modal — appears AFTER drop so the user picks
  // the type before files commit. Two-row grid for player types,
  // single-row for team types.
  const assetTypes = player ? PLAYER_ASSET_TYPES : TEAM_ASSET_TYPES;
  const pickerOverlay = pickerFiles ? (
    <div
      onClick={() => !saving && setPickerFiles(null)}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: colors.white, borderRadius: radius.lg,
          maxWidth: 540, width: '100%', maxHeight: '90vh',
          boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{
          padding: '18px 20px',
          borderBottom: `1px solid ${colors.borderLight}`,
        }}>
          <div style={{
            fontFamily: fonts.condensed, fontSize: 10, fontWeight: 800,
            letterSpacing: 1, color: team?.color || colors.red,
            textTransform: 'uppercase', marginBottom: 4,
          }}>
            {pickerFiles.length} file{pickerFiles.length === 1 ? '' : 's'} ready
          </div>
          <h2 style={{
            fontFamily: fonts.heading, fontSize: 22, margin: 0,
            letterSpacing: 0.5, fontWeight: 400, color: colors.text,
          }}>
            What kind of {player ? 'shot' : 'asset'}?
          </h2>
          <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4 }}>
            {player
              ? <>Will be tagged as <strong>{team?.id}</strong> · <strong>{player.lastName}</strong> ({pickerFiles.length} file{pickerFiles.length === 1 ? '' : 's'})</>
              : <>Will be tagged as a <strong>{team?.name}</strong> team asset</>
            }
          </div>
        </div>

        <div style={{
          padding: 16,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
          overflowY: 'auto',
        }}>
          {assetTypes.map(t => (
            <button
              key={t.id}
              onClick={() => saveWithType(t.id)}
              disabled={saving}
              style={{
                background: colors.white,
                border: `1px solid ${colors.border}`,
                borderRadius: radius.base,
                padding: '14px 12px',
                cursor: saving ? 'wait' : 'pointer',
                textAlign: 'left',
                display: 'flex', flexDirection: 'column', gap: 4,
                transition: 'border-color 160ms ease, background 160ms ease, transform 80ms ease',
              }}
              onMouseEnter={e => {
                if (saving) return;
                e.currentTarget.style.borderColor = team?.color || colors.red;
                e.currentTarget.style.background = `${team?.color || colors.red}08`;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = colors.border;
                e.currentTarget.style.background = colors.white;
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18, color: team?.color || colors.red }}>{t.icon}</span>
                <span style={{
                  fontFamily: fonts.body, fontSize: 14, fontWeight: 700,
                  color: colors.text,
                }}>{t.label}</span>
              </div>
              <div style={{
                fontSize: 11, color: colors.textSecondary, lineHeight: 1.4,
                fontFamily: fonts.body,
              }}>{t.hint}</div>
            </button>
          ))}
        </div>

        <div style={{
          padding: 14, borderTop: `1px solid ${colors.borderLight}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        }}>
          <span style={{
            fontFamily: fonts.condensed, fontSize: 11, color: colors.textMuted,
            letterSpacing: 0.4,
          }}>
            {saving ? 'Saving…' : 'Pick a type to save · ESC to cancel'}
          </span>
          <button
            onClick={() => !saving && setPickerFiles(null)}
            disabled={saving}
            style={{
              background: 'none', border: `1px solid ${colors.border}`,
              color: colors.textSecondary, cursor: saving ? 'wait' : 'pointer',
              borderRadius: radius.sm, padding: '6px 14px',
              fontFamily: fonts.condensed, fontSize: 11, fontWeight: 700,
              letterSpacing: 0.4,
            }}
          >Cancel</button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {children}
      {dragOverlay && createPortal(dragOverlay, document.body)}
      {pickerOverlay && createPortal(pickerOverlay, document.body)}
    </>
  );
}

// Small helper — extract the player's first initial without breaking
// when firstInitial is missing but firstName is set.
function playerFI(p) {
  return (p?.firstInitial || (p?.firstName || '').charAt(0) || '').toUpperCase();
}
