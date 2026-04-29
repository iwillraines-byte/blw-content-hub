// Vercel serverless function: Layer 2 auto-tagging via Claude vision API.
//
// Accepts either:
//   - a Google Drive fileId (server fetches bytes from Drive)
//   - a base64-encoded image (browser pre-resizes and sends)
//
// Calls Anthropic's Messages API with a vision-capable Haiku model. Uses prompt
// caching on the roster/teams context so bulk runs are cheap (only pay full
// input tokens on the first call; subsequent calls within 5 min hit the cache).
//
// Env vars required in Vercel:
//   ANTHROPIC_API_KEY  — from console.anthropic.com
//   ANTHROPIC_MODEL    — optional, defaults to claude-haiku-4-5
//
// Request body (POST, JSON):
// {
//   "image":   { "base64": "...", "mediaType": "image/jpeg" }  |
//              { "driveFileId": "1AbC...", "driveApiKey": "AIza..." },
//   "teams":   [{ id, name, colors, ... }],
//   "roster":  [{ team, lastName, num }, ...]
// }
//
// Response:
// {
//   "team": "LAN" | null,
//   "num": "03" | null,
//   "lastName": "JASO" | null,
//   "assetType": "HEADSHOT" | null,
//   "confidence": "high" | "medium" | "low",
//   "reasoning": "brief explanation",
//   "usage": { input_tokens, output_tokens, cache_read_tokens }
// }

const DEFAULT_MODEL = 'claude-haiku-4-5';
const MAX_OUTPUT_TOKENS = 300;

export default async function handler(req, res) {
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
  const { image, teams = [], roster = [] } = body || {};

  if (!image || (!image.base64 && !image.driveFileId)) {
    res.status(400).json({ error: 'image.base64 or image.driveFileId required' });
    return;
  }

  // ─── Resolve image to base64 + mediaType ────────────────────────────────
  let b64, mediaType;
  try {
    if (image.base64) {
      b64 = image.base64;
      mediaType = image.mediaType || 'image/jpeg';
    } else {
      // Fetch from Drive server-side
      const driveUrls = image.driveApiKey
        ? [
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(image.driveFileId)}?alt=media&key=${encodeURIComponent(image.driveApiKey)}`,
            `https://drive.google.com/uc?export=download&id=${encodeURIComponent(image.driveFileId)}`,
          ]
        : [`https://drive.google.com/uc?export=download&id=${encodeURIComponent(image.driveFileId)}`];

      let fetched = null, err = null;
      for (const url of driveUrls) {
        try {
          const r = await fetch(url, { headers: { 'User-Agent': 'BLW-AutoTag/1.0' }, redirect: 'follow' });
          if (r.ok) {
            const ct = r.headers.get('content-type') || '';
            if (!ct.startsWith('text/html')) {
              const buf = Buffer.from(await r.arrayBuffer());
              fetched = { buf, ct };
              break;
            }
          }
          err = `HTTP ${r.status} from ${url.split('?')[0]}`;
        } catch (e) {
          err = e.message;
        }
      }
      if (!fetched) throw new Error(err || 'Drive fetch failed');
      b64 = fetched.buf.toString('base64');
      mediaType = fetched.ct.startsWith('image/') ? fetched.ct : 'image/jpeg';
    }
  } catch (err) {
    res.status(502).json({ error: 'Failed to load image', detail: err.message });
    return;
  }

  // Anthropic requires specific image types
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(mediaType)) {
    mediaType = 'image/jpeg'; // best guess — Anthropic will reject if it can't parse
  }

  // ─── Build the system prompt (cacheable) ────────────────────────────────
  const teamLines = teams.map(t =>
    `- ${t.id} (${t.name}): primary color ${t.color}, accent ${t.accent}`
  ).join('\n');

  // Group roster by team for clarity
  const rosterByTeam = {};
  for (const p of roster) {
    if (!p.team || !p.lastName) continue;
    if (!rosterByTeam[p.team]) rosterByTeam[p.team] = [];
    rosterByTeam[p.team].push(p);
  }
  // Roster lines now include first initial + first name so the model
  // can resolve cousin pairs (Logan/Luke Rose, Paul/Will Marshall)
  // and ALWAYS attach a firstInitial to its response. Format:
  //   - LAN: K.JASO #03 (Konnor), J.ROBLES #15 (Jordan)
  // Stable sort by lastName so the cache key stays consistent across
  // calls (token cache hit rate matters at bulk-run scale).
  const rosterLines = Object.entries(rosterByTeam).map(([teamId, players]) => {
    const sorted = [...players].sort((a, b) => {
      const lnCmp = (a.lastName || '').localeCompare(b.lastName || '');
      if (lnCmp !== 0) return lnCmp;
      return (a.firstInitial || '').localeCompare(b.firstInitial || '');
    });
    const list = sorted.map(p => {
      const FI = p.firstInitial ? `${p.firstInitial}.` : '';
      const num = p.num ? ` #${p.num}` : '';
      const fn = p.firstName ? ` (${p.firstName})` : '';
      return `${FI}${p.lastName}${num}${fn}`;
    }).join(', ');
    return `- ${teamId}: ${list}`;
  }).join('\n');

  const systemPrompt = `You are a sports photo analyzer for Big League Wiffle Ball (BLW). Analyze photos and return strict JSON tagging data — no commentary outside the JSON.

TEAMS (abbreviation, full name, primary + accent hex colors):
${teamLines}

ROSTERS BY TEAM (for player identification via jersey number cross-reference):
${rosterLines}

YOUR TASK:
Look at the photo. Identify (when visible with reasonable certainty):
1. team — BLW team abbreviation (e.g. "LAN", "AZS"). Look at jersey colors, logos, uniform details. Match to the TEAMS list above.
2. num — Jersey number as a 2-digit string (e.g. "03", "27").
   ALWAYS attempt to OCR the jersey number, even if it's small,
   partial, or rotated. Common locations: chest, back, sleeves, hat,
   helmet. Single-digit numbers should be 0-padded ("3" → "03"). If
   you see TWO digits clearly, return both. If you can read one digit
   confidently and the other is obscured, return null for num and add
   a candidate row that lists every roster player whose number starts
   with the visible digit.
3. lastName — Player's last name in UPPERCASE (e.g. "JASO"). Resolve
   via team + jersey number lookup against the roster list above.
4. firstInitial — The player's first-name initial as a single uppercase
   letter (e.g. "K" for Konnor Jaso). REQUIRED whenever you return a
   lastName — pull it from the roster row that matches your team+num.
   Two players on a team can share a lastName (cousin pairs), so the
   firstInitial is what disambiguates them. NEVER omit this when
   lastName is present and the team's roster list above has it.
5. assetType — One of: HEADSHOT (close-up portrait of a face, typically indoor/studio), ACTION (gameplay: batting, pitching, fielding, running), PORTRAIT (posed, not close-up), HIGHLIGHT (video thumbnail or cinematic composite), INTERVIEW (player being interviewed or talking to media), TEAMPHOTO (group photo of team), VENUE (stadium / field / ballpark with no player focus), LOGO_PRIMARY / LOGO_DARK / LOGO_LIGHT (logo graphic), WORDMARK (team text/wordmark graphic).
6. confidence — "high" if certain, "medium" if probable, "low" if best guess.
7. candidates — When you can't identify a single player but partial signals
   are present, return a short list of up to 5 plausible roster matches.
   Each candidate is { "team": "LAN", "firstInitial": "K", "lastName": "JASO",
   "num": "03", "score": 0–1, "why": "one short reason" }. The score
   reflects how confident you are this is the player; the top candidate
   should mirror the top-level fields when confidence is medium+. Always
   include firstInitial when the candidate references a real roster row.

INTUITION RULES (this is what makes you useful — use them):
- If the jersey NUMBER is legible but the TEAM is ambiguous, list ALL
  roster entries league-wide who wear that number as candidates. Use
  uniform color, hat style, background, or any partial logo glimpse to
  rank them. The team field at the top level can stay null if uncertain;
  candidates carries the breadth.
- If the TEAM is visible (clear logo, uniform color, hat) but the
  jersey number is occluded, return the team and list a small candidate
  set of the most prominent players on that roster — favor pitchers if
  the photo is a pitching action, batters if batting, etc. Don't list
  every roster member; cap at 5.
- If the photo is a HEADSHOT with a clear team uniform but no number,
  scan the team's roster for anyone whose face you've seen before
  ONLY through media context (the photo itself); never invent an
  identity from facial features alone — but you CAN suggest candidates
  the team's roster has, with low scores, so the user can pick.
- When no partial info is present (e.g. a stadium-only shot with no
  uniforms), candidates can be empty.
- Always prefer null + candidates over a wrong concrete guess. The user
  can pick from candidates faster than they can correct a wrong tag.

GENERAL RULES:
- Use null for any top-level field you cannot determine confidently.
- The top-level (team, num, lastName) should ONLY be filled when
  confidence is medium or high. Candidates exists for everything else.
- The reasoning string is one sentence — what you saw and why it
  pointed you to those candidates.

Return ONLY this JSON shape (no markdown, no code fence):
{"team": "LAN"|null, "num": "03"|null, "lastName": "JASO"|null, "firstInitial": "K"|null, "assetType": "HEADSHOT"|null, "confidence": "high"|"medium"|"low", "reasoning": "one-sentence summary", "candidates": [{"team":"LAN","firstInitial":"K","lastName":"JASO","num":"03","score":0.85,"why":"matches"}]}`;

  // ─── Build Messages API request with prompt caching on system prompt ────
  const anthropicBody = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text: 'Analyze this photo and return the JSON.' },
        ],
      },
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

    // Extract the text content from the response
    const textBlock = (data.content || []).find(c => c.type === 'text');
    if (!textBlock) {
      res.status(502).json({ error: 'No text in Anthropic response', raw: data });
      return;
    }

    // Parse the JSON from model output — it should be pure JSON but be defensive
    let parsed;
    try {
      // Strip any markdown code fences just in case
      const cleaned = textBlock.text.trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/```\s*$/, '');
      parsed = JSON.parse(cleaned);
    } catch (err) {
      res.status(502).json({
        error: 'Could not parse model JSON',
        modelOutput: textBlock.text.slice(0, 500),
      });
      return;
    }

    // Build a normalized roster lookup keyed by team|lastName so we
    // can server-fill firstInitial + num when the model returned a
    // confident lastName but forgot the disambiguator. Defensive
    // because the model SOMETIMES drops fields even when explicitly
    // told to include them — cross-referencing the roster is free
    // and produces a more complete tag for the UI to apply.
    const rosterByTeamLast = new Map(); // "TEAM|LASTNAME" → [{num, fi, fn}]
    for (const p of roster) {
      if (!p.team || !p.lastName) continue;
      const key = `${p.team}|${String(p.lastName).toUpperCase()}`;
      const list = rosterByTeamLast.get(key) || [];
      list.push({
        num: (p.num || '').padStart(2, '0'),
        firstInitial: (p.firstInitial || (p.firstName || '').charAt(0) || '').toUpperCase(),
        firstName: p.firstName || '',
      });
      rosterByTeamLast.set(key, list);
    }
    const rosterLookup = new Set(
      [...rosterByTeamLast.entries()].flatMap(([key, list]) => list.map(r => `${key}|${r.num}`))
    );

    // Resolve firstInitial: prefer model's answer, fall back to roster
    // when team + lastName + num pinpoint a single record. If multiple
    // roster entries share the team+lastName (cousin pair) AND the model
    // didn't return num, leave firstInitial null so the UI prompts the
    // user to pick — same flow we use for ambiguous heuristic results.
    const resolveFirstInitial = (team, lastName, num, modelFi) => {
      if (modelFi) return String(modelFi).toUpperCase().slice(0, 1);
      if (!team || !lastName) return null;
      const key = `${team}|${String(lastName).toUpperCase()}`;
      const list = rosterByTeamLast.get(key) || [];
      if (list.length === 0) return null;
      if (num) {
        const exact = list.find(r => r.num === String(num).padStart(2, '0'));
        if (exact?.firstInitial) return exact.firstInitial;
      }
      // Single-record team+lastname → return that initial.
      if (list.length === 1) return list[0].firstInitial || null;
      return null;
    };
    // Resolve num: same idea — if model gave team + lastName + firstInitial
    // but no jersey, look the player up and fill it in.
    const resolveNum = (team, lastName, firstInitial, modelNum) => {
      if (modelNum) return String(modelNum).padStart(2, '0');
      if (!team || !lastName) return null;
      const key = `${team}|${String(lastName).toUpperCase()}`;
      const list = rosterByTeamLast.get(key) || [];
      if (list.length === 0) return null;
      if (firstInitial) {
        const fi = String(firstInitial).toUpperCase().slice(0, 1);
        const exact = list.find(r => r.firstInitial === fi);
        if (exact?.num && exact.num !== '00') return exact.num;
      }
      if (list.length === 1 && list[0].num && list[0].num !== '00') return list[0].num;
      return null;
    };

    const rawCandidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    const candidates = rawCandidates
      .map(c => {
        const team = c.team || null;
        const lastName = c.lastName ? String(c.lastName).toUpperCase() : null;
        const num = c.num ? String(c.num).padStart(2, '0') : null;
        const firstInitial = resolveFirstInitial(team, lastName, num, c.firstInitial);
        return {
          team,
          firstInitial,
          lastName,
          num: num || resolveNum(team, lastName, firstInitial, null),
          score: typeof c.score === 'number' ? Math.max(0, Math.min(1, c.score)) : 0,
          why: typeof c.why === 'string' ? c.why : '',
        };
      })
      .filter(c => {
        // Keep candidates that match a real roster row when team/last
        // are present. Allow team-or-num-only candidates through (the
        // user can complete them in the tag editor).
        if (c.team && c.lastName) {
          // Allow num to be missing on a real lastname match — some
          // candidates are "this looks like Jaso, jersey unclear."
          for (const rosterKey of rosterLookup) {
            if (rosterKey.startsWith(`${c.team}|${c.lastName}|`)) return true;
          }
          return false;
        }
        return true;
      })
      .slice(0, 5);

    // Top-level fields: server-fill firstInitial + num the same way.
    const topTeam = parsed.team || null;
    const topLastName = parsed.lastName ? String(parsed.lastName).toUpperCase() : null;
    const topFi = resolveFirstInitial(topTeam, topLastName, parsed.num, parsed.firstInitial);
    const topNum = parsed.num
      ? String(parsed.num).padStart(2, '0')
      : resolveNum(topTeam, topLastName, topFi, null);

    // Normalize + return with usage stats
    res.status(200).json({
      team: topTeam,
      num: topNum || null,
      lastName: topLastName,
      firstInitial: topFi,
      assetType: parsed.assetType || null,
      confidence: parsed.confidence || 'low',
      reasoning: parsed.reasoning || '',
      candidates,
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

// Vercel body size limit — images can be large
export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};
