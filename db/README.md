# Database migrations

SQL files here are run **manually** in the Supabase SQL Editor. They are
numbered so you run them in order; re-running is safe (every statement is
`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`).

## How to run

1. Go to [supabase.com](https://supabase.com) → your project → **SQL Editor** (left sidebar)
2. Click **New query**
3. Open the file you want to run (e.g. `001_initial_schema.sql`), copy its entire contents
4. Paste into the editor
5. Click **Run** (bottom right) or `Cmd+Enter`
6. Expected result: "Success. No rows returned"

## Migrations

| File | Purpose | Phase |
|------|---------|-------|
| `001_initial_schema.sql` | Tables + storage buckets + default-deny RLS | 1 |

## After running

Visit **`/api/cloud-health`** on your deployed site (or locally) to confirm
the schema is reachable. Expected response shape:

```json
{
  "configured": true,
  "ready": true,
  "tables": { "media": { "ok": true, "rows": 0 }, ... },
  "buckets": { "media": { "ok": true }, ... }
}
```

If `ready: false`, the `notes` array tells you what's missing.
