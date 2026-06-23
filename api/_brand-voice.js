// Shared helpers for injecting per-team BRAND VOICE (authored on the Team
// page, stored in app_settings under key brand-voice-{TEAMID}, value { text })
// into the AI prompts. Used by /api/ideas and /api/captions so the two stay
// consistent (same cap, same boundary-safe trim).

const VOICE_CAP = 1200;

// Trim a voice guideline to a budget WITHOUT cutting mid-rule. Brand voice is
// negation-heavy ("never lead with personality", "avoid em-dashes"); a hard
// character slice can drop the operative clause and leave a dangling fragment
// the model misreads. So we slice to the cap, then back up to the last
// sentence/line boundary in the tail, and flag that we truncated.
export function clampVoice(text, max = VOICE_CAP) {
  const s = String(text || '').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const boundary = Math.max(
    cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('\n'),
  );
  const trimmed = (boundary > max * 0.5 ? cut.slice(0, boundary + 1) : cut).trim();
  return `${trimmed} …(truncated)`;
}
