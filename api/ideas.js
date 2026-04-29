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
- player-stat   → single-player stat card. Prefill: playerName, number, statLine, teamName
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
  const { context = {}, count = 6, seedIdea = null, leagueContext = '' } = body || {};

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

  const rankMovers = (context.rankings || [])
    .filter(r => Math.abs(r.rankChange || 0) >= 3)
    .slice(0, 6)
    .map(r => `- ${r.name}: ${r.rankChange > 0 ? 'UP' : 'DOWN'} ${Math.abs(r.rankChange)} spots → now #${r.currentRank}`)
    .join('\n');

  // Master-admin-supplied free text — trades, draft results, storylines,
  // rivalries, anything that isn't in the live stats. Highest priority
  // signal: the AI is told to PREFER these angles over generic stat cards.
  const trimmedLeagueContext = (leagueContext || '').trim().slice(0, 6000);
  const leagueNarrativesBlock = trimmedLeagueContext
    ? `LEAGUE NARRATIVES (master admin notes — these are the most important signal for this batch; build ideas around these storylines wherever possible):
${trimmedLeagueContext}`
    : '(no admin narratives provided — lean on the stat data above and pull from a wide variety of teams/players)';

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

ANGLE MIX (this is critical):
- AT LEAST HALF of the ideas you generate must hook off NARRATIVE — trades, signings, draft storylines, team chemistry, rivalries, comeback arcs, locker-room dynamics — drawn from the LEAGUE NARRATIVES block when present.
- The remaining ideas can be stat-led, but pick UNDERTOLD angles: a mid-tier player heating up, a team with a quietly improving record, a sleeper having a great month. Don't reflexively spotlight the OPS+ leader yet again.
- ACROSS THE BATCH you must reference at least 4 DIFFERENT teams. Never produce two ideas about the same player.
- If a LEAGUE NARRATIVE explicitly names a player or team (e.g., "Caleb Jeter signed with Dallas"), you MUST give that storyline at least one idea — in fact, prioritise it as the lead idea.

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
      "angle": "leader | hype | matchup | milestone | mover | deep-dive",
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
- Variety: don't generate multiple ideas about the same player. Spread across teams.
- "angle" must be one of: leader, hype, matchup, milestone, mover, deep-dive.
- templateId must come from the catalog above — no inventing new ones.
- prefill keys must match the template's fields. If unsure of a field, omit it.
- dataPoints are the literal numbers you'd pin to a graphic — keep each ≤ 18 chars.
- All three caption variants tell the same story but in the right register for the platform. They don't cross-reference each other.
- Hashtags belong only on the instagram caption (and inline on twitter, sparingly). The story variant is hashtag-free.
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

${leagueNarrativesBlock}`;

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

  const userInstruction = seedIdea
    ? `${stateBlock}

Generate ${count} more content ideas in the SAME register as this seed. Vary the angle and specifics — don't duplicate the seed itself.${seedScopeBlock}
SEED IDEA:
${JSON.stringify(seedIdea, null, 2)}`
    : `${stateBlock}

Generate ${count} fresh content ideas drawing on the BLW state above. Lean heavily on the LEAGUE NARRATIVES if any are provided. Hit a variety of teams and undertold angles.`;

  const anthropicBody = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
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
