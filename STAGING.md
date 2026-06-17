# Shipping v5 — staging workflow

Every v5 phase ships through a Vercel **preview (staging) deploy** that you review
before anything reaches production. Production is the `main` branch.

## Per-phase flow

1. **Branch** off `main`:
   ```
   git checkout main && git pull
   git checkout -b v5/<phase>      # e.g. v5/foundation-tokens
   ```
2. **Build the phase** — all commits land on the branch only.
3. **Push** → Vercel builds a preview URL:
   ```
   git push -u origin v5/<phase>
   ```
4. **Review on staging** (see *Verify as master* below). Iterate on the branch;
   every push refreshes the preview.
5. **Approve → production** — merge into `main`, version, tag:
   ```
   git checkout main
   git merge --no-ff v5/<phase>
   git push                        # main deploys to production
   ```

Nothing reaches `main` / production without your staging sign-off.

## One-time: Vercel Preview environment

Preview deploys need the same environment the app uses. In the Vercel project →
Settings → Environment Variables, confirm these are enabled for the **Preview**
scope (not only Production):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- any others production relies on (e.g. `RESEND_API_KEY`, `NOTIFY_EMAIL`, league/GSS vars)

Optionally pin the latest v5 preview to a stable URL so you always check the same
link:

```
vercel alias set <preview-deployment-url> blw-v5.vercel.app
```

## Verify as master_admin

- **On staging (authoritative).** The preview uses the real Supabase, so just log
  in with your real master account — every master-gated surface renders with real
  role and data. This is the per-phase check before merge.
- **Locally, full fidelity.** Copy `.env.example` → `.env.local`, fill the three
  vars, run `vercel dev`, log in as master.
- **Locally, UI only.** `npm run dev` shows public surfaces; master-gated ones
  need one of the two paths above.
