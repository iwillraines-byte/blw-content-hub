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

const DEFAULT_MODEL = 'claude-haiku-4-5';
const MAX_OUTPUT_TOKENS = 1200;

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
  const { context = {}, count = 6, seedIdea = null } = body || {};

  // ─── Build the cacheable system prompt ─────────────────────────────────────
  // This chunk is stable across a single session, so cache it so "More Like
  // This" follow-up calls within 5 minutes hit the prompt cache.
  const teamLines = (context.teams || []).map(t =>
    `- ${t.id} (${t.name}): ${t.record || '0-0'}, rank #${t.rank || '?'}${t.color ? `, color ${t.color}` : ''}`
  ).join('\n');

  const topBatters = (context.batting || []).slice(0, 8).map(b =>
    `- ${b.name} (${b.team}): OPS+ ${b.ops_plus}, AVG ${b.avg}, ${b.hr || 0} HR${b.currentRank != null ? `, overall rank #${b.currentRank}` : ''}`
  ).join('\n');

  const topPitchers = (context.pitching || []).slice(0, 8).map(p =>
    `- ${p.name} (${p.team}): FIP ${typeof p.fip === 'number' ? p.fip.toFixed(2) : p.fip}, ${p.era} ERA, ${p.w || 0}-${p.l || 0}, ${p.ip} IP${p.currentRank != null ? `, overall rank #${p.currentRank}` : ''}`
  ).join('\n');

  const rankMovers = (context.rankings || [])
    .filter(r => Math.abs(r.rankChange || 0) >= 3)
    .slice(0, 6)
    .map(r => `- ${r.name}: ${r.rankChange > 0 ? 'UP' : 'DOWN'} ${Math.abs(r.rankChange)} spots → now #${r.currentRank}`)
    .join('\n');

  const systemPrompt = `You are the content strategist for Big League Wiffle Ball (BLW), a 10-team competitive wiffle ball league. You generate sharp, specific, post-worthy content ideas for the league's social channels. Your ideas are rooted in real data — current standings, leaderboards, notable performances — not generic "go team" fluff.

TONE:
- Punchy, modern, data-forward
- Specific to a real player or team
- One ideas per concept — don't bundle
- Never invent stats; use only the numbers provided below

BLW CURRENT STATE:

TEAMS:
${teamLines || '(none)'}

TOP BATTERS (by OPS+):
${topBatters || '(none)'}

TOP PITCHERS (by FIP, lower = better):
${topPitchers || '(none)'}

BIGGEST RANK MOVERS:
${rankMovers || '(none notable this week)'}

${TEMPLATE_CATALOG}

REQUIRED OUTPUT SHAPE — return ONLY a JSON object, no markdown, no code fence:
{
  "ideas": [
    {
      "id": "short-slug",
      "headline": "One punchy sentence (≤ 110 chars) that reads well as a card title",
      "description": "One specific sentence explaining the angle — what makes this post-worthy right now",
      "team": "LAN" | "AZS" | ... | "BLW",     // "BLW" for league-wide concepts
      "templateId": "player-stat" | "gameday" | ...,
      "angle": "leader | hype | matchup | milestone | mover | deep-dive",
      "prefill": { /* matches the template's fields */ }
    }
  ]
}

RULES:
- NEVER fabricate stats. Use only numbers from the data above.
- Each idea must reference a real team or real player from the data.
- Variety: don't generate 5 ideas about the same player. Spread across teams.
- "angle" must be one of: leader, hype, matchup, milestone, mover, deep-dive.
- templateId must come from the catalog above — no inventing new ones.
- prefill keys must match the template's fields. If unsure of a field, omit it.
`;

  // ─── User-facing instruction (varies by request, not cached) ───────────────
  const userInstruction = seedIdea
    ? `Generate ${count} more content ideas IN THE SAME STYLE as this seed idea. Vary the angle, team, and specifics — don't duplicate it.

SEED IDEA:
${JSON.stringify(seedIdea, null, 2)}`
    : `Generate ${count} fresh content ideas drawing on the current BLW state. Hit a variety of angles and teams.`;

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

    res.status(200).json({
      ideas: Array.isArray(parsed.ideas) ? parsed.ideas : [],
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
