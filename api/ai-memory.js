// AI Memory endpoint — CRUD + the Claude-backed distill / suggest-questions
// helpers for the Train AI page.
//
// Routes:
//   GET    /api/ai-memory                           — list all rows (auth required)
//   GET    /api/ai-memory?scope=team&scope_id=LAN   — filter by scope
//   POST   /api/ai-memory                           — { scope, scope_id?, question?, answer, weight? }
//   PATCH  /api/ai-memory?id=...                    — update fields
//   DELETE /api/ai-memory?id=...                    — remove a row
//   POST   /api/ai-memory?action=distill            — { message } → uses Claude to extract structured rows
//                                                     returns { proposed: [{ scope, scope_id, answer, weight, source }] }
//   POST   /api/ai-memory?action=suggest-questions  — { focus? } → returns { questions: [{ text, scope, scope_id }] }
//
// Writes are master_admin only (RLS enforces too; we double-check here so
// the response is a clean 403 instead of a generic Supabase RLS error).

import { getServiceClient, requireUser, requireRole } from './_supabase.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_IDEAS_MODEL || 'claude-haiku-4-5';

const VALID_SCOPES = new Set(['league','team','player','rule','history','style']);

function bad(res, code, msg, detail) {
  res.status(code).json({ error: msg, ...(detail ? { detail } : {}) });
}

async function callClaude({ system, userMessage, max_tokens = 1500 }) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing on server');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`anthropic ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return j?.content?.[0]?.text || '';
}

// Coerce a JSON-ish string from Claude into a parsed object. Tolerates
// markdown fences + occasional prose preamble that the model sometimes
// emits despite "JSON only" instructions.
function extractJSON(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  // Find the first { or [
  const start = Math.min(
    ...['{', '['].map(c => candidate.indexOf(c)).filter(i => i >= 0)
  );
  if (!Number.isFinite(start)) return null;
  const body = candidate.slice(start);
  try { return JSON.parse(body); } catch { return null; }
}

export default async function handler(req, res) {
  const ctx = await requireUser(req, res);
  if (!ctx) return;
  const sb = getServiceClient();
  if (!sb) return bad(res, 503, 'Supabase not configured');

  const isWriter = ['master_admin','admin'].includes(ctx.profile?.role);

  // ─── GET — list / filter ───────────────────────────────────────────────────
  if (req.method === 'GET') {
    const scope = req.query?.scope ? String(req.query.scope) : null;
    const scopeId = req.query?.scope_id ? String(req.query.scope_id) : null;
    let q = sb.from('ai_memory').select('*').order('weight', { ascending: false }).order('created_at', { ascending: false });
    if (scope) q = q.eq('scope', scope);
    if (scopeId) q = q.eq('scope_id', scopeId);
    const { data, error } = await q;
    if (error) return bad(res, 500, 'list failed', error.message);
    return res.status(200).json({ memories: data || [] });
  }

  // ─── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (requireRole(res, ctx.profile, ['master_admin','admin'])) return;
    const id = req.query?.id ? String(req.query.id) : null;
    if (!id) return bad(res, 400, 'id query param required');
    const { error } = await sb.from('ai_memory').delete().eq('id', id);
    if (error) return bad(res, 500, 'delete failed', error.message);
    return res.status(200).json({ ok: true });
  }

  // ─── PATCH ─────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    if (requireRole(res, ctx.profile, ['master_admin','admin'])) return;
    const id = req.query?.id ? String(req.query.id) : null;
    if (!id) return bad(res, 400, 'id query param required');
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const patch = {};
    if (typeof body?.answer === 'string') patch.answer = body.answer.slice(0, 4000);
    if (typeof body?.question === 'string') patch.question = body.question.slice(0, 500);
    if (typeof body?.weight === 'number') {
      const w = Math.max(1, Math.min(5, Math.round(body.weight)));
      patch.weight = w;
    }
    if (typeof body?.scope === 'string' && VALID_SCOPES.has(body.scope)) patch.scope = body.scope;
    if ('scope_id' in (body || {})) patch.scope_id = body.scope_id || null;
    if (Object.keys(patch).length === 0) return bad(res, 400, 'nothing to update');
    const { data, error } = await sb.from('ai_memory').update(patch).eq('id', id).select('*').maybeSingle();
    if (error) return bad(res, 500, 'patch failed', error.message);
    return res.status(200).json({ memory: data });
  }

  // ─── POST — create | distill | suggest-questions ───────────────────────────
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return bad(res, 405, 'Method not allowed');
  }

  if (!isWriter) return bad(res, 403, 'Forbidden', `role '${ctx.profile?.role || 'none'}' cannot write memories`);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const action = req.query?.action ? String(req.query.action) : null;

  // ─── Phase 2: distill — natural-language ingest ───────────────────────────
  if (action === 'distill') {
    const message = String(body?.message || '').trim();
    if (!message) return bad(res, 400, 'message required');
    try {
      const system = `You are a memory librarian for an AI content tool. The user is going to write you natural-language notes about their wiffle ball league (BLW). Your job: extract DISCRETE, STANDALONE memory rows from their message. Each row should be one self-contained fact, rule, story, or stylistic guideline.

For each row, pick:
  scope: 'league' (anything BLW-wide — sport rules, league mechanics, league-wide history, tone constraints)
       | 'team'   (specific to one team — their identity, recent storylines, rivalries)
       | 'player' (specific to one player — career arc, family ties, signature plays, jersey lore)
       | 'rule'   (wiffle-ball-specific game mechanics — pitch types, ball physics, strike zone)
       | 'history'(past seasons, milestones, all-star history, trades, controversies)
       | 'style'  (voice / tone examples + anti-examples)

  scope_id: team code ('LAN', 'AZS', 'LV', 'NYG', 'DAL', 'BOS', 'PHI', 'CHI', 'MIA', 'SDO')
            OR player slug ('logan-rose', 'cam-smith', etc.) when relevant
            OR null for league/rule/history/style

  weight (1-5): 5=load-bearing context that should ALWAYS ship in prompts;
                3=useful context (default);
                1=situational nice-to-have

  answer: the actual memory text. 1-3 sentences, plain prose, no markdown.

Output STRICT JSON: { "rows": [ { "scope": "...", "scope_id": "..." | null, "answer": "...", "weight": 3 }, ... ] }
Do NOT wrap in markdown fences. No commentary. JSON only.`;
      const raw = await callClaude({ system, userMessage: message, max_tokens: 2000 });
      const parsed = extractJSON(raw);
      const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
      const cleaned = rows
        .filter(r => r && VALID_SCOPES.has(r.scope) && typeof r.answer === 'string' && r.answer.trim())
        .map(r => ({
          scope: r.scope,
          scope_id: r.scope_id || null,
          answer: String(r.answer).slice(0, 4000),
          weight: Math.max(1, Math.min(5, Math.round(Number(r.weight) || 3))),
          source: 'chat-distill',
        }));
      return res.status(200).json({ proposed: cleaned });
    } catch (err) {
      return bad(res, 500, 'distill failed', err.message);
    }
  }

  // ─── Phase 3: suggest-questions — gaps in the model's knowledge ───────────
  if (action === 'suggest-questions') {
    // Pull a short snapshot of existing memories so the model can see what's
    // already covered and ask for what's missing.
    const { data: existing } = await sb.from('ai_memory')
      .select('scope, scope_id, answer')
      .order('weight', { ascending: false })
      .limit(40);
    const existingBlock = (existing || []).map(m =>
      `[${m.scope}${m.scope_id ? `:${m.scope_id}` : ''}] ${m.answer.slice(0, 200)}`
    ).join('\n') || '(none yet)';
    const focusBlock = body?.focus ? `\nFOCUS REQUESTED: ${String(body.focus).slice(0, 200)}` : '';
    try {
      const system = `You are an AI content tool's "knowledge gap analyzer" for the BLW (Big League Wiffle Ball) league. The master admin is going to fill out memory rows that you'll use later when generating social posts. Your job: based on the existing memory rows below, propose 5-8 SPECIFIC, ANSWERABLE questions the master should answer next to make your future generations dramatically better.

Good questions are SPECIFIC and ELICIT FACTS. Bad questions are vague.
  Good: "What pitch types are common in BLW that don't exist in MLB?"
  Bad:  "Tell me about pitches."
  Good: "Logan Rose has the same first initial as his cousin Luke — what's their backstory and on-field dynamic?"
  Bad:  "Tell me about the Rose family."

Cover gaps across these dimensions:
  - Sport mechanics (rule, league-wide game format)
  - Team identity / voice / recent storylines
  - Specific players who feel under-documented in the current memory
  - Stylistic constraints (overused phrases, banned moves, target tone)
  - Historical context (championships, signature games, controversies)

For each question, output:
  text: the question
  scope: which scope the answer would belong to ('league'|'team'|'player'|'rule'|'history'|'style')
  scope_id: team code or player slug when applicable, otherwise null

Output STRICT JSON: { "questions": [ { "text": "...", "scope": "...", "scope_id": "..." | null }, ... ] }
JSON only. No commentary. No markdown fences.`;
      const userMsg = `EXISTING MEMORY ROWS (${(existing || []).length} total):\n${existingBlock}${focusBlock}\n\nNow generate the 5-8 questions.`;
      const raw = await callClaude({ system, userMessage: userMsg, max_tokens: 1500 });
      const parsed = extractJSON(raw);
      const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
      const cleaned = questions
        .filter(q => q && typeof q.text === 'string' && q.text.trim() && VALID_SCOPES.has(q.scope))
        .slice(0, 12)
        .map(q => ({
          text: String(q.text).slice(0, 500),
          scope: q.scope,
          scope_id: q.scope_id || null,
        }));
      return res.status(200).json({ questions: cleaned });
    } catch (err) {
      return bad(res, 500, 'suggest-questions failed', err.message);
    }
  }

  // ─── Plain POST — create a row ────────────────────────────────────────────
  const { scope, scope_id = null, question = null, answer, weight = 3, source = 'manual' } = body || {};
  if (!scope || !VALID_SCOPES.has(scope)) return bad(res, 400, 'valid scope required');
  if (!answer || typeof answer !== 'string' || !answer.trim()) return bad(res, 400, 'answer required');
  const row = {
    scope,
    scope_id: scope_id || null,
    question: question ? String(question).slice(0, 500) : null,
    answer: String(answer).slice(0, 4000),
    weight: Math.max(1, Math.min(5, Math.round(Number(weight) || 3))),
    source: ['manual','chat-distill','ai-question-answer'].includes(source) ? source : 'manual',
    added_by: ctx.user.id,
  };
  const { data, error } = await sb.from('ai_memory').insert(row).select('*').maybeSingle();
  if (error) return bad(res, 500, 'insert failed', error.message);
  return res.status(201).json({ memory: data });
}
