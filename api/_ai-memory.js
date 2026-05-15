// Shared helper — pulls AI memory rows scoped to the active generation
// context and formats them as a system-prompt block.
//
// Scoping rules:
//   • league/rule/history/style → always included (these are BLW canon)
//   • team       → included when scopeTeam matches OR when the active
//                  generation references a player on that team
//   • player     → included when scopePlayer slug matches OR when the
//                  active sample includes that player by name
//
// Weight gating under token budget (defensive — most leagues will fit
// easily in the cache layer):
//   weight 5 — ALWAYS ship (capped at MAX_W5)
//   weight 3-4 — ship next (capped at MAX_W34)
//   weight 1-2 — only ship if there's room (capped at MAX_W12)
//
// Output is the literal block we paste into the system prompt under
// LEAGUE MEMORY. Returns '' when there are zero scoped rows.

const MAX_W5  = 50;
const MAX_W34 = 30;
const MAX_W12 = 15;

function slugifyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function fetchMemoryBlock(sb, {
  scopeTeam = null,      // 'LAN' | null
  scopePlayer = null,    // { name, lastName, firstInitial, team } | null
  sampledPlayers = [],   // array of { name, team } the prompt is sampling
} = {}) {
  if (!sb) return '';
  try {
    // One fetch, sorted by weight desc, then dedup-by-id client side.
    const { data, error } = await sb
      .from('ai_memory')
      .select('id, scope, scope_id, answer, weight')
      .order('weight', { ascending: false })
      .order('updated_at', { ascending: false });
    if (error || !Array.isArray(data) || data.length === 0) return '';

    // Build scope_id whitelist from the active generation.
    const teamSet = new Set();
    const playerSlugSet = new Set();
    if (scopeTeam) teamSet.add(String(scopeTeam).toUpperCase());
    if (scopePlayer?.team) teamSet.add(String(scopePlayer.team).toUpperCase());
    if (scopePlayer?.lastName) {
      const fnFirst = (scopePlayer.firstName || '').trim().split(/\s+/)[0] || '';
      const slug = fnFirst ? `${slugifyName(fnFirst)}-${slugifyName(scopePlayer.lastName)}` : slugifyName(scopePlayer.lastName);
      if (slug) playerSlugSet.add(slug);
    }
    for (const p of sampledPlayers) {
      if (p?.team) teamSet.add(String(p.team).toUpperCase());
      if (p?.name) {
        const parts = p.name.trim().split(/\s+/);
        const fnFirst = parts[0] || '';
        const last = parts[parts.length - 1] || '';
        const slug = fnFirst && last ? `${slugifyName(fnFirst)}-${slugifyName(last)}` : slugifyName(last || fnFirst);
        if (slug) playerSlugSet.add(slug);
      }
    }

    const relevant = data.filter(m => {
      if (m.scope === 'league' || m.scope === 'rule' || m.scope === 'history' || m.scope === 'style') return true;
      if (m.scope === 'team') return m.scope_id && teamSet.has(String(m.scope_id).toUpperCase());
      if (m.scope === 'player') return m.scope_id && playerSlugSet.has(String(m.scope_id).toLowerCase());
      return false;
    });
    if (relevant.length === 0) return '';

    // Apply weight caps so a wildly-populated memory store doesn't blow
    // out token budget. Stable ordering: weight desc, then updated_at
    // already applied above.
    const w5  = relevant.filter(m => m.weight === 5).slice(0, MAX_W5);
    const w34 = relevant.filter(m => m.weight === 3 || m.weight === 4).slice(0, MAX_W34);
    const w12 = relevant.filter(m => m.weight === 1 || m.weight === 2).slice(0, MAX_W12);

    const fmt = (rows, label) => {
      if (rows.length === 0) return '';
      const lines = rows.map(m => {
        const tag = m.scope_id ? `${m.scope.toUpperCase()}:${m.scope_id}` : m.scope.toUpperCase();
        return `- [${tag}] ${m.answer.replace(/\s+/g, ' ').trim()}`;
      });
      return `\n${label}:\n${lines.join('\n')}`;
    };

    return `LEAGUE MEMORY — master-curated context the AI must use when generating. These are FACTS about BLW (rules, identity, lore, voice constraints, player stories). Lean on them. The higher-priority rows should drive your angle choices first.
${fmt(w5,  'PRIORITY 5 — load-bearing context (always apply)')}${fmt(w34, 'PRIORITY 3-4 — strong supporting context')}${fmt(w12, 'PRIORITY 1-2 — situational nice-to-have')}
`;
  } catch {
    // Memory table may not exist on a fresh deploy (migration pending);
    // silently degrade so the prompt pipeline still works without it.
    return '';
  }
}
