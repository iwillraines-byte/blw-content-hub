// Vercel serverless function: BLW content idea generator.
//
// Claude Haiku is prompted with the current BLW state — teams, standings, top
// batters, top pitchers, biggest rank movers — and asked to return a batch of
// sharp, specific content ideas scoped to a real BLW team or player. Ideas
// are deep-linkable into /generate because the return shape includes a
// templateId and pre-fill fields matching the Generate page's URL params.
//
// Env vars required in Vercel:
//   ANTHROPIC_API_KEY  — from console.anthropic.com
//   ANTHROPIC_MODEL    — optional, defaults to claude-haiku-4-5
//
// Request body (POST, JSON):
// {
//   "context": {
//     "teams":      [{ id, name, record, rank, color, accent }],
//     "batting":    [{ name, team, ops_plus, avg, hr, obp, slg, currentRank }, ...],
//     "pitching":   [{ name, team, fip, era, w, l, k, ip, currentRank }, ...],
//     "rankings":   [{ name, currentRank, rankChange }, ...]
//   },
//   "count":        8,                       // how many ideas, default 6
//   "seedIdea":     { headline, team, ... }  // optional — "More Like This" seed
// }
//
// Response:
// {
//   "ideas": [
//     { id, headline, description, team, templateId, prefill: {...}, angle }
//   ],
//   "usage": { input_tokens, output_tokens, cache_read_tokens }
// }

import { getServiceClient } from './_supabase.js';
import { persistIdeas } from './content-ideas.js';

const DEFAULT_MODEL = 'claude-haiku-4-5';
// Bumped from 1200 — each idea now ships a narrative paragraph, stat pills,
// and three caption variants. Six ideas at the new shape lands around
// 2.4k–2.8k output tokens.
const MAX_OUTPUT_TOKENS = 3200;

const TEMPLATE_CATALOG = `TEMPLATE CATALOG (map each idea to exactly one templateId):
- player-stat   → "Team/Player News" — three centered lines stacked symmetrically. Prefill: line1, line2, line3.
                  Convention: line1 = the WHO (player name, team name, or short subject), line2 = the WHAT (the news / stat / verb), line3 = optional context (jersey + team, date, supporting note). Each line should fit under ~28 characters in ALL CAPS for typographic balance — keep lines punchy and roughly equal length so they read as a stacked headline.
- gameday       → pre-game matchup hype. Prefill: homeTeam, awayTeam, homeRecord, awayRecord, date, time, venue
- score         → final score graphic. Prefill: homeTeam, awayTeam, homeScore, awayScore, result, mvp
- hype          → motivational/hype graphic, often a player quote. Prefill: playerName, number
- highlight     → highlight callout. Prefill: playerName, statLine
- batting-leaders  → BLW-wide batting leaderboard. Prefill: (none, uses live data)
- pitching-leaders → BLW-wide pitching leaderboard. Prefill: (none)
- standings       → current league standings graphic. Prefill: (none, optional team to spotlight)
`;

export default async function handler(req, res) {
  // CORS headers so the page can call this from localhost during dev + from
  // the deployed domain in prod.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST required' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured in Vercel environment variables' });
    return;
  }
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { context = {}, count = 6, seedIdea = null, leagueContext = '', team: scopeTeam = null } = body || {};

  // ─── Build the cacheable system prompt ─────────────────────────────────────
  // This chunk is stable across a single session, so cache it so "More Like
  // This" follow-up calls within 5 minutes hit the prompt cache.
  const teamLines = (context.teams || []).map(t =>
    `- ${t.id} (${t.name}): ${t.record || '0-0'}, rank #${t.rank || '?'}${t.color ? `, color ${t.color}` : ''}`
  ).join('\n');

  // ─── Stratified player sampling — fixes the "same names every time" bias ──
  //
  // The previous prompt fed top-8 by OPS+ / top-8 by FIP. Same names every
  // call → same ideas every call. Now we mix three buckets so the model sees
  // a wider name pool:
  //   1. Top tier   — the actual leaders (3 names)
  //   2. Mid tier   — ~25th-50th percentile (3 names, randomised)
  //   3. Sleeper    — bottom of the qualified pool (1 name)
  //                   Often surfaces comeback / "due" angles.
  // The randomisation seed comes from Date.now() so each call rotates.
  function stratifiedSample(arr, topN, midN, sleeperN) {
    if (!arr.length) return [];
    const top = arr.slice(0, topN);
    const midStart = Math.floor(arr.length * 0.25);
    const midEnd = Math.floor(arr.length * 0.60);
    const midPool = arr.slice(midStart, midEnd);
    // Fisher-Yates shuffle the mid pool for rotation.
    for (let i = midPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [midPool[i], midPool[j]] = [midPool[j], midPool[i]];
    }
    const mid = midPool.slice(0, midN);
    const sleeper = arr.slice(-sleeperN);
    // Dedupe on name in case the buckets overlap on small populations.
    const seen = new Set();
    const out = [];
    for (const x of [...top, ...mid, ...sleeper]) {
      const key = (x.name || '').toLowerCase();
      if (key && !seen.has(key)) { seen.add(key); out.push(x); }
    }
    return out;
  }

  const battingSample = stratifiedSample(context.batting || [], 3, 3, 1);
  const pitchingSample = stratifiedSample(context.pitching || [], 3, 3, 1);

  const topBatters = battingSample.map(b =>
    `- ${b.name} (${b.team}): OPS+ ${b.ops_plus}, AVG ${b.avg}, ${b.hr || 0} HR${b.currentRank != null ? `, overall rank #${b.currentRank}` : ''}`
  ).join('\n');

  const topPitchers = pitchingSample.map(p =>
    `- ${p.name} (${p.team}): FIP ${typeof p.fip === 'number' ? p.fip.toFixed(2) : p.fip}, ${p.era} ERA, ${p.w || 0}-${p.l || 0}, ${p.ip} IP${p.currentRank != null ? `, overall rank #${p.currentRank}` : ''}`
  ).join('\n');

  // ─── Athlete voice — self-authored vibe / references / content prefs ───
  // The AthleteVoiceCard on the player page lets athletes (and master
  // admin) author free-form notes that should color any content
  // featuring that player. Only renders for players actually in the
  // batting/pitching sample so we don't dump every voice block on
  // every call (token cost). Pulled by lookup against the keyed map
  // the client sends as context.athleteVoices.
  const athleteVoices = context.athleteVoices && typeof context.athleteVoices === 'object'
    ? context.athleteVoices
    : {};
  const sampledPlayers = [...battingSample, ...pitchingSample];
  const voiceLines = [];
  const seenVoiceKeys = new Set();
  for (const p of sampledPlayers) {
    const last = (p.name || '').split(/\s+/).pop().toUpperCase();
    const key = `${(p.team || '').toUpperCase()}|${last}`;
    if (seenVoiceKeys.has(key)) continue;
    seenVoiceKeys.add(key);
    const v = athleteVoices[key];
    if (!v || typeof v !== 'object') continue;
    const summary = [
      v.vibe && `vibe: ${String(v.vibe).slice(0, 200)}`,
      v.references && `references: ${String(v.references).slice(0, 200)}`,
      v.walkupMusic && `walkup: ${String(v.walkupMusic).slice(0, 100)}`,
      v.funFacts && `fun facts: ${String(v.funFacts).slice(0, 240)}`,
      v.contentPrefs && `content notes: ${String(v.contentPrefs).slice(0, 240)}`,
    ].filter(Boolean).join('; ');
    if (summary) voiceLines.push(`- ${p.name} (${p.team}): ${summary}`);
  }
  const athleteVoiceBlock = voiceLines.length
    ? `ATHLETE VOICE — self-authored notes from the players themselves (their vibe, the references they love, what they DO and DON'T want on their accounts). Use these to color captions and angle choices for the relevant player. They're a stronger signal than stats alone because they capture the player's IDENTITY:\n${voiceLines.join('\n')}\n`
    : '';

  const rankMovers = (context.rankings || [])
    .filter(r => Math.abs(r.rankChange || 0) >= 3)
    .slice(0, 6)
    .map(r => `- ${r.name}: ${r.rankChange > 0 ? 'UP' : 'DOWN'} ${Math.abs(r.rankChange)} spots → now #${r.currentRank}`)
    .join('\n');

  // Master-admin-supplied free text — trades, draft results, storylines,
  // rivalries, anything that isn't in the live stats. Treated as RESEARCH
  // material, not as content to paraphrase. The reframing in the block
  // header is intentional — earlier prompts that said "build ideas around
  // these storylines" got us 4 near-identical headlines that just
  // restated each note as a question, which was exactly what we didn't
  // want. Now we tell the model to use these as background context for
  // creative leaps, not assignments to summarise.
  const trimmedLeagueContext = (leagueContext || '').trim().slice(0, 6000);
  const leagueNarrativesBlock = trimmedLeagueContext
    ? `LEAGUE NARRATIVES (background research — NOT a list of assignments):
The notes below are reference material for context. They are NOT prompts to paraphrase. Don't quote them verbatim. Don't write a headline that essentially restates a note as a question or sentence. Instead:
  • Find the SECOND-ORDER observation (what the note implies, what it predicts, what it changes about a stat ranking).
  • Tie a note to a stat number from the data above to make a sharper claim.
  • Look for tension between two notes (e.g., a trade + a slumping team).
  • You can ignore notes that don't fit the angles you're picking — quality over coverage.

${trimmedLeagueContext}`
    : '(no admin narratives provided — lean on the stat data above. Spread across different teams and undertold angles.)';

  // ─── Cached system prompt (the "how to do the job") ───────────────────────
  // Static across all calls — tone, angle rules, output shape, template
  // catalog. Per-call data (player samples, league narratives) goes in the
  // user message below so cache stays warm.
  const systemPrompt = `You are the content strategist for Big League Wiffle Ball (BLW), a 10-team competitive wiffle ball league. You generate sharp, specific, post-worthy content drafts for the league's social channels. Each idea ships ready-to-post: a clear angle, supporting stat pills, and three caption variants for different platforms.

TONE:
- Punchy, modern, data-forward
- Specific to a real player or team
- One concept per idea — don't bundle
- Never invent stats; use only the numbers provided in the user message
- Captions sound like a sports brand that respects its audience: confident, occasionally playful, never corny. No "Let's gooo." No "Who's ready?"

ANGLE DIVERSITY (this is the most important rule — read it twice):

Each idea in a batch MUST take a different ANGLE TYPE. Pick from this menu and use each TYPE at most once per batch. If you can't fit four different types, generate fewer ideas — quality > quota.

  1. STAT SPOTLIGHT — a single number tells the story (a leader, a milestone, a "first since…" moment). Best for: top performers, round-number records.
  2. CONTRARIAN TAKE — a fact that runs counter to expectation. ("This team is 4-8 but their OPS+ is top-3", "Everyone's watching Jaso, but the second-best OPS+ on his team is…").
  3. COMPARISON / RIVALRY — two players, two teams, or this player vs. the league. ("Jeter's FIP since Dallas trade vs. before").
  4. ARC / TRAJECTORY — a player or team trending up or down. Comebacks, slumps, breakouts. Use rank movers when relevant.
  5. STORYLINE ECHO — a creative leap from the LEAGUE NARRATIVES that ties context to a stat. (Not "Jeter signed with Dallas — what does it mean?" — instead "Pandas had baseball's worst FIP before March 12. Now they're top half. One name moved that needle.")
  6. UNDERTOLD — a mid-tier player or quietly excellent team that's been overlooked. Pull from the mid-tier and sleeper buckets in the player sample.
  7. CHARACTER / VIBE — a fun-fact, rookie story, nickname, or personality angle. Lighter register, less data-heavy.
  8. PREDICTION / WATCH — what to keep an eye on next week. ("Five more HRs and Jaso passes the league record.")

ANTI-PARAPHRASE RULE:
- If your headline could be rewritten as a sentence directly from the LEAGUE NARRATIVES, REWRITE the headline. Headlines are creative leaps from the data, not summaries of it.
- If two headlines in the same batch share a verb, a name, AND a stat, one of them is a duplicate — pick a different angle.

TEAM SPREAD:
- Reference at least 4 DIFFERENT teams across the batch unless explicitly scoped (see SEED SCOPE in the user message).
- Never produce two ideas about the same player in the same batch (unless seed-scoped to that player).

CREATIVE LEAP — ONE-SHOT EXAMPLE:

Suppose the LEAGUE NARRATIVES says: "Caleb Jeter signed with Dallas Pandas (3/12). Pandas were 4-8 before; now 6-9. Jeter ranked top-3 FIP in BLW last season."

WRONG (literal paraphrase, low value):
  headline: "Caleb Jeter joins Dallas — what does it mean for the Pandas?"
  narrative: "Caleb Jeter, an elite pitcher, signed with the Dallas Pandas..."

RIGHT (creative leap, anchored in stats):
  headline: "Two starts in. Pandas FIP dropped 1.40 points."
  narrative: "Dallas had a bottom-three rotation FIP before the Jeter trade. After two of his starts, they're rotation-FIP league average. The signing isn't the story — the math behind it is."

The RIGHT version uses the narrative as RESEARCH (knowing the trade context), pulls a SPECIFIC NUMBER from the stat data (FIP), and frames the angle as a CLAIM you'd actually want to read on a graphic. That's the bar.

${TEMPLATE_CATALOG}

REQUIRED OUTPUT SHAPE — return ONLY a JSON object, no markdown, no code fence:
{
  "ideas": [
    {
      "id": "short-slug",
      "headline": "One punchy sentence (≤ 110 chars) that reads well as a card title",
      "narrative": "Two to three sentences (≤ 280 chars total) explaining WHY this is post-worthy right now — the story behind the angle. Reads like a beat-writer's lede, not a stat sheet.",
      "team": "LAN" | "AZS" | ... | "BLW",     // "BLW" for league-wide concepts
      "templateId": "player-stat" | "gameday" | ...,
      "angle": "stat-spotlight | contrarian | comparison | arc | storyline | undertold | character | prediction",
      "dataPoints": ["171 OPS+", "3 HR", "+5 spots"],   // 2-4 short stat pills, ≤ 18 chars each
      "captions": {
        "instagram": "Long-form caption (3-6 lines), can use emoji sparingly, ends with 4-7 hashtags on a new line. Lead with the hook, then the story, then the stat. ≤ 500 chars.",
        "twitter":   "Single punchy tweet ≤ 240 chars. One stat, one verb, one closer. May use 1-2 hashtags inline.",
        "story":     "Vertical-story copy, ≤ 90 chars. Big text on a graphic. No hashtags."
      },
      "prefill": { /* matches the template's fields */ }
    }
  ]
}

RULES:
- NEVER fabricate stats. Use only numbers from the user message.
- Each idea must reference a real team or real player from the data provided.
- Variety: don't generate multiple ideas about the same player. Each idea picks a different ANGLE TYPE from the menu above.
- "angle" must be one of: stat-spotlight, contrarian, comparison, arc, storyline, undertold, character, prediction.
- templateId must come from the catalog above — no inventing new ones.
- prefill keys must match the template's fields. If unsure of a field, omit it.
- dataPoints are the literal numbers you'd pin to a graphic — keep each ≤ 18 chars.
- All three caption variants tell the same story but in the right register for the platform. They don't cross-reference each other.
- Hashtags belong only on the instagram caption (and inline on twitter, sparingly). The story variant is hashtag-free.
- Quality bar: would a sports beat-writer share this on their personal account? If not, rewrite or skip it.
`;

  // ─── Per-call user message (NOT cached — randomised samples + dynamic context) ─
  const stateBlock = `BLW CURRENT STATE:

TEAMS:
${teamLines || '(none)'}

PLAYER SAMPLE — BATTING (a stratified mix — top performers, mid-pack, and a sleeper. Picked specifically to widen your pool beyond just stat leaders. Different names appear each call):
${topBatters || '(none)'}

PLAYER SAMPLE — PITCHING (same stratification — top, mid, sleeper):
${topPitchers || '(none)'}

BIGGEST RANK MOVERS:
${rankMovers || '(none notable this week)'}

${athleteVoiceBlock}${leagueNarrativesBlock}`;

  // Extract the seed's scoping signals so we can lock follow-up ideas to
  // the SAME team (and same player when the seed is player-scoped). The
  // previous prompt explicitly told the model to "vary the team" — exact
  // opposite of what users actually want when they hit "More like this."
  const seedTeam = seedIdea?.team && seedIdea.team !== 'BLW' ? seedIdea.team : null;
  const seedPlayerName = (seedIdea?.prefill?.playerName || '').trim();
  const seedPlayerLast = seedPlayerName ? seedPlayerName.split(/\s+/).pop() : '';

  const seedScopeBlock = (() => {
    if (!seedIdea) return '';
    const parts = [];
    if (seedTeam) parts.push(`MUST scope every idea to team ${seedTeam}. Do NOT pick a different team.`);
    if (seedPlayerLast) parts.push(`The seed is about ${seedPlayerName}. Generate ideas focused on ${seedPlayerLast} — different angles on the same player (a stat highlight, a hype moment, a comparison, a milestone) — OR on their direct teammates on ${seedTeam || 'their team'}. Do NOT switch to other teams' players.`);
    if (!seedPlayerLast && seedTeam) parts.push(`Spread across different players and storylines on ${seedTeam}. Don't repeat the seed's exact angle.`);
    // The system prompt's "at least 4 different teams" rule explicitly does
    // NOT apply to seeded regenerations — the whole point is to drill into
    // one team or one player.
    parts.push('IGNORE the system prompt rule about referencing at least 4 different teams. This regeneration is intentionally narrow-scoped.');
    return parts.length ? `\nSEED SCOPE — REQUIRED:\n- ${parts.join('\n- ')}\n` : '';
  })();

  // Top-level team scope from the dashboard's team picker — independent
  // of seed scoping (a user can pick a team, hit Generate, then later
  // hit "More like this" on one of those ideas to drill in further).
  // When supplied, locks ALL ideas in this batch to that team and waives
  // the spread-across-4-teams rule. seedScopeBlock takes precedence
  // structurally because it's about a specific seed, but in practice
  // they collapse to "this batch is about TEAM X" either way.
  const upperScopeTeam = scopeTeam && typeof scopeTeam === 'string' && scopeTeam !== 'BLW'
    ? scopeTeam.toUpperCase() : null;
  const teamScopeBlock = (!seedIdea && upperScopeTeam)
    ? `\nTEAM SCOPE — REQUIRED:\n- Every idea in this batch MUST be about team ${upperScopeTeam} or a player on team ${upperScopeTeam}. Do NOT pick a different team.\n- Spread across DIFFERENT players and DIFFERENT angle types on ${upperScopeTeam}. Don't repeat the same player.\n- IGNORE the system prompt rule about referencing at least 4 different teams.\n`
    : '';

  const userInstruction = seedIdea
    ? `${stateBlock}

Generate ${count} more content ideas in the SAME register as this seed. Each must take a DIFFERENT ANGLE TYPE from the menu in the system prompt — no duplicates of the seed's angle either.${seedScopeBlock}
SEED IDEA:
${JSON.stringify(seedIdea, null, 2)}`
    : `${stateBlock}
${teamScopeBlock}
Generate ${count} fresh content ideas. CRITICAL: each idea must take a different ANGLE TYPE from the menu in the system prompt. Treat the LEAGUE NARRATIVES as research, not as a checklist — you don't have to use every note. Pick the most post-worthy angles you can find, even if they're tangential to what's in the notes.`;

  const anthropicBody = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    // High temperature for content ideation — we want variance across the
    // batch, not consensus. The angle-diversity rule + anti-paraphrase
    // rule in the system prompt enforce STRUCTURE; the temperature gives
    // us creative WIDTH within that structure. Output is JSON-validated
    // downstream so high temp doesn't risk format breakage.
    temperature: 1,
    system: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      { role: 'user', content: userInstruction },
    ],
  };

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
    });

    const rawText = await upstream.text();
    let data;
    try { data = JSON.parse(rawText); } catch { data = null; }

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: 'Anthropic API error',
        status: upstream.status,
        detail: data?.error?.message || rawText.slice(0, 500),
      });
      return;
    }

    const textBlock = (data.content || []).find(c => c.type === 'text');
    if (!textBlock) {
      res.status(502).json({ error: 'No text in Anthropic response', raw: data });
      return;
    }

    let parsed;
    try {
      const cleaned = textBlock.text.trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/```\s*$/, '');
      parsed = JSON.parse(cleaned);
    } catch (err) {
      res.status(502).json({
        error: 'Could not parse model JSON',
        modelOutput: textBlock.text.slice(0, 800),
      });
      return;
    }

    const ideasOut = Array.isArray(parsed.ideas) ? parsed.ideas : [];

    // Stamp every idea with a globally unique id (the AI-emitted slug like
    // "leader-jaso-ops" can collide across batches) and tag as AI-sourced.
    // Then persist to content_ideas so the dashboard, team pages, and
    // player pages can read them back. Soft-fail: persistence errors don't
    // bounce the user — the ideas still come back in the response.
    const stamped = ideasOut.map((i, idx) => ({
      ...i,
      id: i.id ? `ai-${Date.now()}-${i.id}` : `ai-${Date.now()}-${idx}`,
      source: 'ai',
      aiGenerated: true,
    }));
    try {
      const sb = getServiceClient();
      if (sb && stamped.length) {
        const result = await persistIdeas(sb, stamped, { createdBy: 'ai-generator' });
        if (result.errors.length) {
          console.warn('[content-ideas] persist soft-failed', result.errors[0]);
        }
      }
    } catch (err) {
      console.warn('[content-ideas] persist threw', err?.message);
    }

    res.status(200).json({
      ideas: stamped,
      usage: {
        input_tokens: data.usage?.input_tokens || 0,
        output_tokens: data.usage?.output_tokens || 0,
        cache_read_tokens: data.usage?.cache_read_input_tokens || 0,
        cache_creation_tokens: data.usage?.cache_creation_input_tokens || 0,
      },
    });
  } catch (err) {
    res.status(502).json({ error: 'Upstream fetch failed', detail: err.message });
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
};
