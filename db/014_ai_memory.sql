-- v4.7.0: AI Memory — structured knowledge store the AI prompt pipeline
-- pulls from on every /api/ideas + /api/captions call. Master populates
-- it manually (Train AI page → free-form textarea), via chat-style
-- ingest that distills natural-language input into structured rows,
-- or by answering AI-generated questions about gaps in its own context.
--
-- Scope taxonomy:
--   league  — applies to every generation (sport mechanics, league
--             rules, BLW history, tone constraints, voice rules)
--   team    — applies when generating for a specific team (identity,
--             rivalries, recent storylines, team-specific tone)
--   player  — applies when generating about a specific player (career
--             arc, family ties, signature plays, jersey lore)
--   rule    — wiffle-ball-specific game mechanics + rules
--   history — past seasons, milestones, all-star history, trades
--   style   — voice / tone examples + anti-examples
--
-- Weight (1-5) gates inclusion under token budget. Weight 5 always
-- ships; 3 ships if budget allows; 1 ships only when keyword-matched
-- to the active generation context.

CREATE TABLE IF NOT EXISTS public.ai_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       TEXT NOT NULL CHECK (scope IN ('league','team','player','rule','history','style')),
  scope_id    TEXT,             -- team_id (e.g. 'LAN') or player slug (e.g. 'logan-rose'); NULL for league/rule/history/style
  question    TEXT,             -- optional — what prompted this answer (NULL when master just types a memory directly)
  answer      TEXT NOT NULL,    -- the memory body
  weight      INT  NOT NULL DEFAULT 3 CHECK (weight BETWEEN 1 AND 5),
  source      TEXT NOT NULL DEFAULT 'manual'  -- 'manual' | 'chat-distill' | 'ai-question-answer'
              CHECK (source IN ('manual','chat-distill','ai-question-answer')),
  added_by    UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_memory_scope_idx ON public.ai_memory(scope, scope_id);
CREATE INDEX IF NOT EXISTS ai_memory_weight_idx ON public.ai_memory(weight DESC);
CREATE INDEX IF NOT EXISTS ai_memory_created_idx ON public.ai_memory(created_at DESC);

-- RLS
ALTER TABLE public.ai_memory ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user can read (memory feeds AI prompts that any
-- authed user might trigger via /api/ideas or /api/captions; the prompts
-- themselves are server-rendered, so this is effectively a read-only
-- shared context — no PII risk).
DROP POLICY IF EXISTS ai_memory_read ON public.ai_memory;
CREATE POLICY ai_memory_read ON public.ai_memory FOR SELECT TO authenticated USING (true);

-- Write: master_admin only. (admin tier exists in the enum but isn't granted
-- today — kept as a future hook.)
DROP POLICY IF EXISTS ai_memory_write ON public.ai_memory;
CREATE POLICY ai_memory_write ON public.ai_memory FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('master_admin','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('master_admin','admin')));

-- Trigger to bump updated_at on any update
CREATE OR REPLACE FUNCTION public.tg_ai_memory_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ai_memory_touch_updated_at ON public.ai_memory;
CREATE TRIGGER ai_memory_touch_updated_at
BEFORE UPDATE ON public.ai_memory
FOR EACH ROW EXECUTE FUNCTION public.tg_ai_memory_touch_updated_at();

GRANT SELECT ON public.ai_memory TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ai_memory TO authenticated;
