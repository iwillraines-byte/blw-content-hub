// Vercel serverless function: BLW caption drafter.
//
// Two callers:
//
// 1. A deterministic (non-AI) suggestion needs captions for the first time.
//    POST `{ idea }` with no `platform` and we return all three variants.
//
// 2. An AI idea already has captions but the user wants to rewrite ONE
//    platform without paying for a full idea re-roll. POST `{ idea, platform }`
//    and we return just `{ captions: { [platform]: "..." } }` so the client
//    can patch the existing object without disturbing the others.
//
// Cheap by design: shorter prompt, smaller token budget, no full league
// context — the idea itself carries the angle.
//
// Env: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (optional).
//
// Request body:
// {
//   "idea":     { headline, narrative?, description?, team, dataPoints?, angle? },
//   "platform": "instagram" | "twitter" | "story"          // optional
// }
//
// Response:
// {
//   "captions": { "instagram": "...", "twitter": "...", "story": "..." },
//   "usage":    { input_tokens, output_tokens }
// }

import { requireUser } from './_supabase.js';
import { checkRateLimit } from './_rate-limit.js';

const DEFAULT_MODEL = 'claude-haiku-4-5';
const MAX_OUTPUT_TOKENS = 800;

const VALID_PLATFORMS = new Set(['instagram', 'twitter', 'story']);

const PLATFORM_BRIEFS = {
  instagram: 'INSTAGRAM caption: 3-6 lines, may use emoji sparingly, ends with 4-7 hashtags on a new line. Lead with the hook, then the story, then the stat. ≤ 500 chars total.',
  twitter:   'TWITTER/X caption: single punchy tweet ≤ 240 chars. One stat, one verb, one closer. May use 1-2 hashtags inline.',
  story:     'INSTAGRAM STORY copy: vertical-story copy, ≤ 90 chars, big text on a graphic. No hashtags.',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST required' });
    return;
  }

  // v4.5.37 (security audit): require a valid Supabase session JWT.
  // Pre-fix the endpoint was unauthenticated — anyone with the URL
  // could spam Anthropic credits. Caption rewrites are cheap per call
  // but trivially DoS-able at scale.
  const ctx = await requireUser(req, res);
  if (!ctx) return;
  // v4.5.38 (security audit I2): hourly rate limit by role.
  if (await checkRateLimit(ctx, 'captions', res)) return;

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
  const { idea, platform, leagueContext = '', athleteVoice = null } = body || {};
  if (!idea || !idea.headline) {
    res.status(400).json({ error: 'idea (with headline) is required' });
    return;
  }
  // Master-admin narrative context — same blob /api/ideas uses. Caps to keep
  // this endpoint cheap; rewrites should be quick.
  const trimmedLeagueContext = (leagueContext || '').trim().slice(0, 3000);

  // v4.5.17: Athlete voice — when the idea spotlights a player whose
  // self-authored "About me" exists, ground the caption in their actual
  // voice (vibe, references, walk-up music, fun facts, content notes).
  // Keeps captions on-brand AND personal at the same time. Trim each
  // field so the prompt stays compact.
  const athleteVoiceBlock = (() => {
    if (!athleteVoice || typeof athleteVoice !== 'object') return '';
    const lines = [];
    if (athleteVoice.vibe) lines.push(`VIBE: ${String(athleteVoice.vibe).slice(0, 240)}`);
    if (athleteVoice.references) lines.push(`REFERENCES: ${String(athleteVoice.references).slice(0, 240)}`);
    if (athleteVoice.walkupMusic) lines.push(`WALK-UP MUSIC: ${String(athleteVoice.walkupMusic).slice(0, 120)}`);
    if (athleteVoice.funFacts) lines.push(`FUN FACTS: ${String(athleteVoice.funFacts).slice(0, 320)}`);
    if (athleteVoice.contentPrefs) lines.push(`CONTENT NOTES: ${String(athleteVoice.contentPrefs).slice(0, 240)}`);
    if (!lines.length) return '';
    return `\n\nATHLETE VOICE — self-authored notes from this player. Use these to ground tone and vocabulary; they are how the player describes themselves:\n${lines.join('\n')}`;
  })();
  if (platform && !VALID_PLATFORMS.has(platform)) {
    res.status(400).json({ error: `platform must be one of ${[...VALID_PLATFORMS].join(', ')}` });
    return;
  }

  // Single-platform regen → only ask for that one. Otherwise ask for all three.
  const platformsToWrite = platform ? [platform] : ['instagram', 'twitter', 'story'];
  const briefs = platformsToWrite.map(p => `- ${PLATFORM_BRIEFS[p]}`).join('\n');

  // The idea carries everything we need — keep the prompt tight.
  const ideaSummary = [
    `HEADLINE: ${idea.headline}`,
    idea.narrative   ? `STORY: ${idea.narrative}` : null,
    !idea.narrative && idea.description ? `STORY: ${idea.description}` : null,
    idea.team        ? `TEAM: ${idea.team}` : null,
    idea.angle       ? `ANGLE: ${idea.angle}` : null,
    Array.isArray(idea.dataPoints) && idea.dataPoints.length
      ? `STATS: ${idea.dataPoints.join(' · ')}`
      : null,
  ].filter(Boolean).join('\n');

  const systemPrompt = `You write social copy for Big League Wiffle Ball (BLW), a 10-team competitive wiffle ball league.

TONE:
- Confident, modern, data-forward
- Occasionally playful, never corny
- No "Let's gooo." No "Who's ready?" No clichés
- Never invent stats; use only the numbers in the idea

OUTPUT — return ONLY JSON, no markdown, no code fence:
{
  "captions": {
${platformsToWrite.map(p => `    "${p}": "..."`).join(',\n')}
  }
}

PLATFORM BRIEFS:
${briefs}
`;

  const narrativeBlock = trimmedLeagueContext
    ? `\n\nLEAGUE NARRATIVES (use these to ground tone/specifics if relevant):\n${trimmedLeagueContext}`
    : '';

  const userInstruction = `Write the requested caption${platformsToWrite.length === 1 ? '' : 's'} for this idea:

${ideaSummary}${narrativeBlock}${athleteVoiceBlock}`;

  const anthropicBody = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: [{ type: 'text', text: systemPrompt }],
    messages: [{ role: 'user', content: userInstruction }],
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
      captions: parsed.captions || {},
      usage: {
        input_tokens: data.usage?.input_tokens || 0,
        output_tokens: data.usage?.output_tokens || 0,
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
